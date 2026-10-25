# 📊 QuickPolls

A small, realistic 3-tier app for practicing **Docker, Kubernetes and CI/CD**.
Create polls, vote, and watch results update live.

**Intentionally missing:** Dockerfiles, docker-compose, Kubernetes manifests, Helm charts and CI pipelines. Writing those is your job.

```
 ┌──────────────┐   /api/*   ┌──────────────┐   SQL   ┌──────────────┐
 │  web (React) │ ─────────▶ │ api (Node.js)│ ──────▶ │  PostgreSQL  │
 │  static SPA  │            │  Express 5   │         │      16      │
 └──────────────┘            └──────────────┘         └──────────────┘
```

| Service | Path | Tech | Port | Build output |
|---|---|---|---|---|
| Frontend | `web/` | React 19 + Vite | 5173 (dev) | static files in `web/dist/` |
| Backend | `api/` | Node.js 22+ / Express 5 | 3000 | runs from source |
| Database | n/a | PostgreSQL 16 | 5432 | use the official image |

---

## Running locally (without containers)

You need Node.js 22+ and a PostgreSQL database (user/password/db `polls`/`polls`/`polls`, or set `DATABASE_URL`).

```bash
# API
cd api
npm install
npm start          # creates tables automatically, listens on :3000

# Frontend (second terminal)
cd web
npm install
npm run dev        # http://localhost:5173, proxies /api to localhost:3000
```

### Useful commands

| | `api/` | `web/` |
|---|---|---|
| Install (CI-friendly) | `npm ci` | `npm ci` |
| Unit tests (no DB needed) | `npm test` | `npm test` |
| Lint | `npm run lint` | n/a |
| Build | n/a | `npm run build` → `dist/` |
| Production start | `npm start` | serve `dist/` with any static server |
| Run DB migrations only | `npm run migrate` | n/a |

---

## API configuration (environment variables)

| Variable | Default | Notes |
|---|---|---|
| `PORT` | `3000` | |
| `DATABASE_URL` | `postgres://polls:polls@localhost:5432/polls` | Full connection string |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | n/a | Used instead of `DATABASE_URL` when `PGHOST` is set (good fit for a Secret) |
| `APP_VERSION` | `dev` | Shown in the UI footer. Set it to the image tag / git SHA |
| `RUN_MIGRATIONS` | `true` | Set `false` if you run `npm run migrate` as a separate Job/initContainer |
| `CORS_ORIGIN` | (empty) | Only needed if the frontend calls the API from a different origin |
| `ENABLE_CHAOS` | `false` | Enables the chaos endpoints below |
| `SHUTDOWN_TIMEOUT_MS` | `10000` | Max time for graceful shutdown after SIGTERM |

If the database isn't reachable at startup, the API retries migrations 10 times (3s apart) and then **exits with code 1**.

## Frontend configuration (runtime, not build-time)

`web/public/config.js` is copied untouched into `dist/config.js` and loaded at page load:

```js
window.__APP_CONFIG__ = { apiBaseUrl: "", environment: "local" };
```

- `apiBaseUrl: ""` means the browser calls `/api/...` on the **same origin**, so whatever serves the frontend (nginx, an Ingress, etc.) must route `/api` to the API service.
- `environment` is shown as a badge in the header. Swap the file per environment without rebuilding.

---

## API endpoints

| Method | Path | Description |
|---|---|---|
| GET | `/healthz` | **Liveness**: always 200 unless the process is broken |
| GET | `/readyz` | **Readiness**: 200 only if PostgreSQL is reachable, otherwise 503 |
| GET | `/metrics` | Prometheus metrics (HTTP latency histogram, votes, polls, Node.js runtime) |
| GET | `/api/info` | Version, **hostname** (= pod name in k8s), uptime |
| GET | `/api/stats` | Totals: `{ polls, openPolls, votes }` |
| GET | `/api/polls` | List polls. Query: `search`, `sort` (`newest`/`oldest`/`popular`), `status` (`all`/`open`/`closed`) |
| POST | `/api/polls` | `{ "question": "...", "options": ["a","b"], "allowMultiple": false, "closesInMinutes": 60 }` (last two optional) |
| GET | `/api/polls/:id` | Poll with results (+ `myVotes` when `X-Voter-Id` is sent) |
| POST | `/api/polls/:id/vote` | `{ "optionId": 3 }` or `{ "optionIds": [3, 4] }` for multiple-choice polls |
| POST | `/api/polls/:id/close` | Close a poll now (no more votes) |
| DELETE | `/api/polls/:id` | Delete a poll |

**One vote per person:** the web app sends a random per-browser `X-Voter-Id` header. With it, the API allows one vote per single-choice poll (or one per option on multiple-choice polls) and returns `409` for repeats. Requests without the header (e.g. `curl`) stay anonymous and unlimited, which is handy for load tests. Closed polls return `409`.

The schema upgrades itself on startup (or `npm run migrate`): new columns/tables use `IF NOT EXISTS`, so existing databases keep their data.

### Chaos endpoints (`ENABLE_CHAOS=true`)

| Method | Path | What Kubernetes should do |
|---|---|---|
| POST | `/api/chaos/cpu?seconds=60` | CPU spike, so an HPA should scale out |
| POST | `/api/chaos/memory?mb=200` | Leaks memory, so the pod gets OOMKilled once it passes its memory limit |
| POST | `/api/chaos/crash` | Process exits with code 1, so the container restarts (CrashLoopBackOff if repeated) |
| POST | `/api/chaos/unhealthy` | `/healthz` starts returning 500, so the liveness probe restarts the container |

Logs are JSON lines on stdout. The API handles `SIGTERM` gracefully.

---

## Practice roadmap

Work through these roughly in order. Hints only, no solutions.

### 🐳 Docker
- [ ] Dockerfile for `api`: use `npm ci --omit=dev`, run as non-root, and add a `.dockerignore`
- [ ] Multi-stage Dockerfile for `web`: a Node stage runs `npm run build`, then an nginx stage serves `dist/`
- [ ] nginx config: SPA fallback to `index.html`, and proxy `/api` to the API container
- [ ] `docker network` + run all 3 containers by hand, then rewrite it as `docker-compose.yml`
- [ ] Persist Postgres data with a named volume; add `healthcheck` + `depends_on: condition: service_healthy`
- [ ] Compare image sizes: `node:22` vs `node:22-slim` vs `node:22-alpine` vs distroless
- [ ] Pass `APP_VERSION` as a build arg → env var, and watch it in the UI footer

### ☸️ Kubernetes
- [ ] Namespace, then Postgres as a **StatefulSet** + PVC + headless Service
- [ ] DB credentials in a **Secret** (try both `DATABASE_URL` and the `PG*` variables)
- [ ] API **Deployment** (3 replicas) + Service; set `livenessProbe` → `/healthz`, `readinessProbe` → `/readyz`
- [ ] Set resource requests/limits, then trigger `/api/chaos/memory` and watch `OOMKilled`
- [ ] Move migrations to a **Job** or **initContainer** and set `RUN_MIGRATIONS=false`
- [ ] Frontend Deployment + Service; mount `config.js` from a **ConfigMap**
- [ ] **Ingress**: `/` → web, `/api` → api. Watch the footer hostname change across replicas
- [ ] **HPA** on CPU, then hammer `/api/chaos/cpu` and watch it scale
- [ ] Rolling update: change `APP_VERSION`/image tag, use `kubectl rollout status/undo`
- [ ] Kill the DB pod and watch the API go *not ready* (but not restart). That's the readiness vs. liveness difference
- [ ] Package everything as a **Helm chart** or **Kustomize** overlays (dev / prod)
- [ ] Bonus: Prometheus + Grafana scraping `/metrics`; NetworkPolicy so only the API can reach Postgres

### 🔁 CI/CD
- [ ] CI on every PR: `npm ci` → `npm run lint` → `npm test` (api) and `npm ci` → `npm test` → `npm run build` (web)
- [ ] Only build the service whose folder changed (path filters / monorepo matrix)
- [ ] Build & push images tagged with the git SHA (GHCR or Docker Hub), and cache layers
- [ ] Scan images (Trivy) and fail on critical CVEs
- [ ] Integration test in CI: start a Postgres service container, run the API, `curl /readyz`
- [ ] CD: deploy to a kind/minikube cluster or use GitOps (Argo CD / Flux) that watches a manifests repo
- [ ] Promote the same image from dev to prod, never rebuild per environment
