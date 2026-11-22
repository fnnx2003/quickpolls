# QuickPolls

A small 3-tier polling app (React web + Node/Express API + PostgreSQL). The user is using it to **learn Docker, Kubernetes, Helm, CI/CD and GitOps (Argo CD)**. The app is the vehicle; the infrastructure is the lesson.

## Language

Talk to the user in **Hebrew**. Keep code, commands, file names and technical terms (Pod, Deployment, Helm, Secret…) in English.

## Hard rule: don't touch infrastructure files

The user writes these themselves to learn. Never edit, create or delete them. Explain what to change and give commands instead:

- `api/Dockerfile`, `web/Dockerfile`, `web/.dockerignore`, `docker-compose.yaml`, `default.conf`
- `api-chart/`, `web-chart/`, `db-chart/`, `argocd/`
- `.github/workflows/`

Claude only changes app code: `api/src`, `api/test`, `web/src`, `web/public`, plus the app sections of `README.md`.

When changing app code, stay compatible with the existing infra:
- No new **required** env vars. New dependencies (e.g. Redis) must be optional and the app must work without them.
- Same ports (API 3000, web served by nginx on 80) and the same `/api/...` paths.
- DB migrations in `api/src/migrate.js` must be idempotent (`IF NOT EXISTS`), because they run on every startup against existing databases.
- In the browser, avoid APIs that need HTTPS outside localhost (`crypto.randomUUID`, guaranteed `navigator.clipboard`), because the site may be served over plain HTTP.

## Git and deploy flow

- Work on a feature branch (e.g. `feature/live-updates`), never directly on `main`.
- **Never commit or push without asking.** A push to `main` triggers CD.
- CI (`.github/workflows/quickpolls-ci.yaml`): builds both images. On push to `main` it pushes `fnnnx/quickpolls-api:<git-sha>` and `fnnnx/quickpolls-web:<git-sha>` to Docker Hub, then commits `Deploy <sha> [skip ci]`, which writes the tag into `api-chart/values.yaml` and `web-chart/values.yaml`.
- Argo CD (`argocd/*.yaml`) watches `main` and deploys the three charts to namespace `quickpolls` on the kind cluster `kind-quickpolls`.
- Image tags are always the git SHA. There is **no `latest` tag** on Docker Hub, and `pullPolicy: IfNotPresent` makes `latest` unreliable anyway. Don't hand-edit tags; CI manages them.
- Both charts read the DB password from Secret `db-secret` (key `password`), which is **not in Git** and must be created per namespace with `kubectl create secret`.
- kind can't see locally built images. To test one without pushing: `kind load docker-image <img>:dev --name quickpolls`, then `helm upgrade ... --set image.tag=dev`.
- Docker Compose builds its own images (`quickpolls-quickpolls-web` / `-api`). Use `docker compose up --build`; a separate `docker build -t` isn't used by compose.

## Local environment (WSL)

- No Linux `node`, and no docker or postgres inside this WSL distro (Docker Desktop is used from Windows). `kubectl` and `helm` work.
- Use Windows Node: `"/mnt/c/Program Files/nodejs/node.exe"`.
- API tests, from `api/`: `node.exe --test test/validation.test.js test/app.test.js` (passing a directory fails). Lint: `node.exe node_modules/eslint/bin/eslint.js .`
- Web tests and build fail from the `\\wsl.localhost` path (Linux esbuild binary + UNC paths). Copy `web/` without `node_modules`/`dist` to a temp dir under `/mnt/c/Users/eyals/AppData/Local/Temp/`, run `npm ci --ignore-scripts` with Windows npm, run `vitest run` and `vite build` there, then delete the copy.
- API tests use a fake `pg` pool (no DB). SQL changes can't be verified locally, so tell the user to try them with `docker compose up --build`.

## Code layout

- `api/src/app.js`: all routes (dependencies injected for tests). `validation.js`: input parsing. `migrate.js`: schema. `config.js`: env vars. `metrics.js`: Prometheus.
- `web/src/App.jsx`: all components. `api.js`: fetch client + per-browser voter id. `utils.js`: pure helpers (unit-tested in `utils.test.js`). `styles.css`: CSS variables, light/dark via `html[data-theme]`.
- Keep the existing style: small modules, short comments explaining *why*, plain React hooks, no new UI libraries without asking.

## Features already built

Merged to `main`:
- Poll settings: multiple choice (`allowMultiple`), auto-close (`closesInMinutes`), manual close (`POST /api/polls/:id/close`).
- One vote per browser: `X-Voter-Id` header + `poll_votes` table, `409` on repeat votes. No header means anonymous, unlimited votes (useful for load tests).
- Results hidden until you vote (with a "Peek" button); winner 🏆 on closed polls.
- List search/sort/status filters; `GET /api/stats` totals in the header.
- Shareable hash links `#/poll/:id`, a Share button, and a light/dark/system theme toggle.
- Live updates: SSE stream `GET /api/events`, event bus in `api/src/events.js`, `web/src/live.js` with fallback to polling. Redis (`redis-chart`, StatefulSet + PVC, Argo app `quickpolls-redis`) is deployed and the API uses `REDIS_URL: redis://quickpolls-redis:6379`.

On branch `cluster-view` (not merged yet):
- Cluster view: `GET /api/cluster` + a "Cluster" tab (`#/cluster`). Each replica heartbeats to Redis (`api/src/cluster.js`); the shared Redis connection lives in `api/src/redis.js`.

## Roadmap (agreed order; each is its own branch)

1. ✅ **Live updates** (done and deployed): one SSE stream `GET /api/events` (`api/src/events.js` = event bus, local or Redis pub/sub via optional `REDIS_URL`), `web/src/live.js` with fallback to polling. Keep-alive every 15s. User's infra: Redis on compose/k8s, a Helm chart, an Argo CD app, `REDIS_URL` on the API, nginx timeouts for long-lived connections. Demo first without Redis on 2+ replicas to see the bug.
1b. 🚧 **Cluster view** (branch `cluster-view`). User's infra ideas: set `APP_VERSION` from the image tag in the api-chart, scale/rollout/delete-pod drills, HPA later.
2. **Rate limiting** in Redis. Note: the API sees the nginx Pod's IP, so nginx must pass `X-Forwarded-For` and the API must trust it. User's infra: HPA, NetworkPolicy.
3. **User accounts** (JWT; only the creator can close/delete). User's infra: Secret handling, Sealed Secrets / External Secrets.
4. **Scheduled jobs** (daily poll, deleting old polls). User's infra: CronJob.
5. **Worker + queue** (export, webhook/email on close). User's infra: a worker Deployment.
6. **Image polls** with MinIO. User's infra: a StatefulSet for object storage.

Front-end only, can go anywhere: comments and reactions, charts, a real router (`/poll/12`, `/explore`, `/me`), QR sharing and embeds, ranked-choice and quiz modes, tags and trending.

When finishing an app feature, list the infra changes the user needs to make, as hints and commands, without writing those files.
