import { useCallback, useEffect, useRef, useState } from "react";
import { api, environment } from "./api.js";
import { connectLive } from "./live.js";
import {
  cleanOptions,
  formatDuration,
  leaders,
  pageFromHash,
  percent,
  pollIdFromHash,
  replicaHealth,
  shortVersion,
  timeAgo,
  timeLeft,
  versionSummary,
} from "./utils.js";

const REFRESH_MS = 3000; // polling while live updates are down
const SAFETY_NET_MS = 30000; // slow polling while live, in case an event was missed
const BATCH_MS = 250; // coalesce bursts of events (e.g. a load test) into one refetch
const CLUSTER_REFRESH_MS = 2000;
const GONE_VISIBLE_MS = 30000; // keep vanished replicas on screen for a while, greyed out
const NEW_REPLICA_MS = 30000;

const CLOSE_CHOICES = [
  { label: "Never", minutes: null },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 24 * 60 },
  { label: "1 week", minutes: 7 * 24 * 60 },
];

export default function App() {
  const [polls, setPolls] = useState([]);
  const [selectedId, setSelectedId] = useState(() => pollIdFromHash(window.location.hash));
  const [page, setPage] = useState(() => pageFromHash(window.location.hash));
  const [filters, setFilters] = useState({ search: "", sort: "newest", status: "all" });
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");
  // from = replica that sent the last event; connectedTo = replica holding our SSE connection.
  const [live, setLive] = useState({ status: "connecting", from: null, connectedTo: null });
  // Polls changed in the last batch of live events; PollDetail refetches when its id is in here.
  const [changes, setChanges] = useState({ ids: [], deleted: [] });

  const refreshPolls = useCallback(async () => {
    try {
      const [list, totals] = await Promise.all([api.listPolls(filters), api.stats()]);
      setPolls(list);
      setStats(totals);
      setError("");
    } catch (err) {
      setError(`Can't reach the API: ${err.message}`);
    }
  }, [filters]);

  const isLive = live.status === "live";
  useEffect(() => {
    refreshPolls();
    const t = setInterval(refreshPolls, isLive ? SAFETY_NET_MS : REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshPolls, isLive]);

  // The live connection lives for the whole page; it always calls the latest refreshPolls.
  const refreshRef = useRef(refreshPolls);
  useEffect(() => {
    refreshRef.current = refreshPolls;
  }, [refreshPolls]);

  useEffect(() => {
    let pending = [];
    let timer = null;
    const flush = () => {
      timer = null;
      const batch = pending;
      pending = [];
      setChanges({
        ids: batch.map((e) => e.pollId),
        deleted: batch.filter((e) => e.type === "poll.deleted").map((e) => e.pollId),
      });
      refreshRef.current();
    };

    const stop = connectLive({
      onStatus: (status) => setLive((l) => ({ ...l, status })),
      onEvent: (event) => {
        setLive((l) => ({ ...l, from: event.from }));
        // "hello" arrives on every (re)connect: refetch once to catch anything missed while away.
        if (event.type === "hello") {
          setLive((l) => ({ ...l, connectedTo: event.from }));
          return refreshRef.current();
        }
        pending.push(event);
        timer ??= setTimeout(flush, BATCH_MS);
      },
    });
    return () => {
      stop();
      clearTimeout(timer);
    };
  }, []);

  // Keep the selected poll in the URL (#/poll/12) so links can be shared.
  useEffect(() => {
    const onHash = () => {
      setSelectedId(pollIdFromHash(window.location.hash));
      setPage(pageFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = (id) => {
    window.location.hash = id ? `#/poll/${id}` : "";
    setSelectedId(id);
    setPage("polls");
  };

  return (
    <div className="app">
      <header>
        <h1>📊 QuickPolls</h1>
        <span className="badge">{environment}</span>
        <LiveStatus status={live.status} />
        {stats && (
          <span className="stats muted">
            {stats.polls} polls · {stats.openPolls} open · {stats.votes} votes
          </span>
        )}
        <nav>
          <a href={selectedId ? `#/poll/${selectedId}` : "#/"} className={page === "polls" ? "active" : ""}>
            Polls
          </a>
          <a href="#/cluster" className={page === "cluster" ? "active" : ""}>
            Cluster
          </a>
        </nav>
        <ThemeToggle />
      </header>

      {error && <div className="error">{error}</div>}

      {page === "cluster" ? (
        <ClusterView connectedTo={live.connectedTo} />
      ) : (
        <main>
          <section className="sidebar">
            <CreatePoll
              onCreated={(poll) => {
                refreshPolls();
                select(poll.id);
              }}
            />
            <PollFilters filters={filters} onChange={setFilters} />
            <PollList polls={polls} selectedId={selectedId} onSelect={select} filtered={!!filters.search} />
          </section>

          <section className="content">
            {selectedId ? (
              <PollDetail
                key={selectedId}
                id={selectedId}
                isLive={isLive}
                changes={changes}
                onChange={refreshPolls}
                onDeleted={() => {
                  select(null);
                  refreshPolls();
                }}
              />
            ) : (
              <div className="empty">Pick a poll or create a new one.</div>
            )}
          </section>
        </main>
      )}

      <BackendInfo lastEventFrom={live.from} />
    </div>
  );
}

function LiveStatus({ status }) {
  const text = { live: "Live", connecting: "Reconnecting…", offline: "Polling" };
  const title = {
    live: "Live updates on: changes appear instantly",
    connecting: "Live connection dropped, reconnecting",
    offline: `Live updates unavailable, refreshing every ${REFRESH_MS / 1000}s`,
  };
  return (
    <span className={`live-status ${status}`} title={title[status]}>
      <span className="dot" /> {text[status]}
    </span>
  );
}

function ThemeToggle() {
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem("quickpolls.theme") ?? "system";
    } catch {
      return "system";
    }
  });

  useEffect(() => {
    if (theme === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("quickpolls.theme", theme);
    } catch {
      // storage blocked: the theme just won't be remembered
    }
  }, [theme]);

  const next = { system: "light", light: "dark", dark: "system" };
  const icon = { system: "🖥️", light: "☀️", dark: "🌙" };
  return (
    <button className="secondary theme" title={`Theme: ${theme}`} onClick={() => setTheme(next[theme])}>
      {icon[theme]}
    </button>
  );
}

function CreatePoll({ onCreated }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [closesInMinutes, setClosesInMinutes] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setOption = (i, value) => setOptions((opts) => opts.map((o, j) => (j === i ? value : o)));
  const removeOption = (i) => setOptions((opts) => opts.filter((_, j) => j !== i));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const poll = await api.createPoll({ question, options: cleanOptions(options), allowMultiple, closesInMinutes });
      setQuestion("");
      setOptions(["", ""]);
      setAllowMultiple(false);
      setClosesInMinutes(null);
      setError("");
      onCreated(poll);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2>New poll</h2>
      <input placeholder="Ask something…" value={question} onChange={(e) => setQuestion(e.target.value)} />
      {options.map((opt, i) => (
        <div key={i} className="option-input">
          <input placeholder={`Option ${i + 1}`} value={opt} onChange={(e) => setOption(i, e.target.value)} />
          {options.length > 2 && (
            <button type="button" className="icon" title="Remove option" onClick={() => removeOption(i)}>
              ×
            </button>
          )}
        </div>
      ))}

      <label className="check">
        <input type="checkbox" checked={allowMultiple} onChange={(e) => setAllowMultiple(e.target.checked)} />
        Allow multiple choices
      </label>
      <label className="select">
        Closes after
        <select
          value={closesInMinutes ?? ""}
          onChange={(e) => setClosesInMinutes(e.target.value ? Number(e.target.value) : null)}
        >
          {CLOSE_CHOICES.map((c) => (
            <option key={c.label} value={c.minutes ?? ""}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <div className="row">
        <button type="button" className="secondary" disabled={options.length >= 10} onClick={() => setOptions([...options, ""])}>
          + Option
        </button>
        <button type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create"}
        </button>
      </div>
      {error && <div className="error small">{error}</div>}
    </form>
  );
}

function PollFilters({ filters, onChange }) {
  const set = (key) => (e) => onChange({ ...filters, [key]: e.target.value });
  return (
    <div className="filters">
      <input type="search" placeholder="Search polls…" value={filters.search} onChange={set("search")} />
      <div className="row">
        <select value={filters.sort} onChange={set("sort")}>
          <option value="newest">Newest</option>
          <option value="oldest">Oldest</option>
          <option value="popular">Most votes</option>
        </select>
        <select value={filters.status} onChange={set("status")}>
          <option value="all">All</option>
          <option value="open">Open</option>
          <option value="closed">Closed</option>
        </select>
      </div>
    </div>
  );
}

function PollList({ polls, selectedId, onSelect, filtered }) {
  if (polls.length === 0) return <div className="card muted">{filtered ? "No matching polls." : "No polls yet."}</div>;
  return (
    <ul className="poll-list">
      {polls.map((p) => (
        <li key={p.id} className={p.id === selectedId ? "active" : ""} onClick={() => onSelect(p.id)}>
          <div className="q">{p.question}</div>
          <div className="meta">
            {p.totalVotes} votes · {timeAgo(p.createdAt)}
            {p.allowMultiple && <span className="tag">multi</span>}
            {p.closed && <span className="tag closed">closed</span>}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PollDetail({ id, isLive, changes, onChange, onDeleted }) {
  const [poll, setPoll] = useState(null);
  const [picked, setPicked] = useState([]); // multi-choice selection before submitting
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [peek, setPeek] = useState(false);

  const [deleted, setDeleted] = useState(false);

  // PollDetail is keyed by id, so late responses after unmount are simply dropped by React.
  const load = useCallback(
    () =>
      api
        .getPoll(id)
        .then((p) => (setPoll(p), setError("")))
        .catch((err) => setError(err.message)),
    [id],
  );

  useEffect(() => {
    load();
    const t = setInterval(load, isLive ? SAFETY_NET_MS : REFRESH_MS);
    return () => clearInterval(t);
  }, [load, isLive]);

  useEffect(() => {
    if (changes.deleted.includes(id)) setDeleted(true);
    else if (changes.ids.includes(id)) load();
  }, [changes, id, load]);

  // Auto-close happens on the server clock with no event: refetch right when it should close.
  const closesAt = poll?.closed ? null : poll?.closesAt;
  useEffect(() => {
    if (!closesAt) return;
    const ms = new Date(closesAt).getTime() - Date.now() + 500;
    if (ms > 24 * 60 * 60 * 1000) return; // too far away for setTimeout; polling will get there
    const t = setTimeout(load, Math.max(ms, 0));
    return () => clearTimeout(t);
  }, [closesAt, load]);

  async function run(action) {
    try {
      setPoll(await action());
      setError("");
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  const vote = (optionIds) =>
    run(() => api.vote(id, optionIds)).then(() => {
      setPicked([]);
      setPeek(true); // show results even if the browser has no voter id (storage blocked)
    });
  const close = () => confirm("Close this poll? Nobody will be able to vote anymore.") && run(() => api.closePoll(id));

  async function remove() {
    if (!confirm("Delete this poll?")) return;
    try {
      await api.deletePoll(id);
      onDeleted();
    } catch (err) {
      setError(err.message);
    }
  }

  async function share() {
    const url = `${window.location.origin}${window.location.pathname}#/poll/${id}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      prompt("Copy this link:", url); // clipboard API needs HTTPS outside localhost
    }
  }

  if (deleted) return <div className="empty">This poll was just deleted.</div>;
  if (error && !poll) return <div className="error">{error}</div>;
  if (!poll) return <div className="muted">Loading…</div>;

  const myVotes = poll.myVotes ?? [];
  const hasVoted = myVotes.length > 0;
  // Show results once you voted or the poll is closed; before that, hide counts to avoid bias.
  const showResults = hasVoted || poll.closed || peek;
  const canVote = !poll.closed && (poll.allowMultiple || !hasVoted);
  const winners = poll.closed ? leaders(poll.options) : [];
  const remaining = poll.closesAt && !poll.closed ? timeLeft(poll.closesAt) : null;

  function clickOption(o) {
    if (!canVote || myVotes.includes(o.id)) return;
    if (!poll.allowMultiple) return vote([o.id]);
    setPicked((p) => (p.includes(o.id) ? p.filter((x) => x !== o.id) : [...p, o.id]));
  }

  return (
    <div className="card poll">
      <h2>{poll.question}</h2>
      <div className="poll-meta">
        {poll.closed ? <span className="tag closed">closed</span> : <span className="tag open">open</span>}
        {poll.allowMultiple && <span className="tag">multiple choice</span>}
        {remaining && <span className="muted">closes {remaining}</span>}
      </div>

      <div className="options">
        {poll.options.map((o) => {
          const pct = percent(o.votes, poll.totalVotes);
          const mine = myVotes.includes(o.id);
          const classes = [
            "option",
            mine && "voted",
            picked.includes(o.id) && "picked",
            winners.includes(o.id) && "winner",
            !canVote || mine ? "locked" : "",
          ].filter(Boolean);
          return (
            <button key={o.id} className={classes.join(" ")} onClick={() => clickOption(o)}>
              {showResults && <span className="bar" style={{ width: `${pct}%` }} />}
              <span className="label">
                {poll.allowMultiple && canVote && <span className="box">{mine || picked.includes(o.id) ? "☑" : "☐"}</span>}
                {winners.includes(o.id) && "🏆 "}
                {o.label}
                {mine && <span className="you"> · your vote</span>}
              </span>
              {showResults && (
                <span className="count">
                  {o.votes} · {pct}%
                </span>
              )}
            </button>
          );
        })}
      </div>

      {poll.allowMultiple && canVote && (
        <div className="row">
          <button disabled={picked.length === 0} onClick={() => vote(picked)}>
            Vote{picked.length > 1 ? ` (${picked.length})` : ""}
          </button>
        </div>
      )}

      <div className="row between">
        <span className="muted">
          {poll.totalVotes} total votes
          {canVote && !hasVoted && " · results appear after you vote"}
        </span>
        <div className="row">
          {!showResults && (
            <button className="link" onClick={() => setPeek(true)}>
              Peek
            </button>
          )}
          <button className="secondary" onClick={share}>
            {copied ? "Copied!" : "Share"}
          </button>
          {!poll.closed && (
            <button className="danger" onClick={close}>
              Close
            </button>
          )}
          <button className="danger" onClick={remove}>
            Delete
          </button>
        </div>
      </div>
      {error && <div className="error small">{error}</div>}
    </div>
  );
}

// Every API replica that is alive right now, refreshed every 2s. Run kubectl scale / rollout restart /
// delete pod and watch replicas appear, drain and disappear. Needs Redis to see beyond one replica.
function ClusterView({ connectedTo }) {
  const [data, setData] = useState(null);
  const [gone, setGone] = useState([]); // replicas that vanished recently, with goneAt
  const [error, setError] = useState("");
  const previous = useRef([]);

  useEffect(() => {
    const load = () =>
      api
        .cluster()
        .then((d) => {
          // Only Redis mode gives the full list; in local mode each request may hit a different replica.
          const tracked = d.mode === "redis" ? d.replicas : [];
          const alive = new Set(tracked.map((r) => r.hostname));
          const t = Date.now();
          const vanished = previous.current.filter((r) => !alive.has(r.hostname)).map((r) => ({ ...r, goneAt: t }));
          previous.current = tracked;
          setGone((g) => [...vanished, ...g.filter((r) => !alive.has(r.hostname) && t - r.goneAt < GONE_VISIBLE_MS)]);
          setData(d);
          setError("");
        })
        .catch((err) => setError(err.message));
    load();
    const t = setInterval(load, CLUSTER_REFRESH_MS);
    return () => clearInterval(t);
  }, []);

  if (error && !data) return <div className="error">{error}</div>;
  if (!data) return <div className="muted">Loading…</div>;

  const now = new Date(data.now).getTime();
  const versions = versionSummary(data.replicas);

  return (
    <div className="cluster">
      {data.mode !== "redis" && (
        <div className="notice">
          {data.mode === "local"
            ? "Redis isn't configured (REDIS_URL), so you only see the replica that answered this request. Refresh a few times and watch it change."
            : "Redis is unreachable, so you only see the replica that answered this request."}
        </div>
      )}

      <div className="cluster-summary">
        <span>
          <b>{data.replicas.length}</b> {data.replicas.length === 1 ? "replica" : "replicas"}
        </span>
        <span className="muted">
          {versions.map((v) => `${v.count} × ${shortVersion(v.version)}`).join(" · ")}
        </span>
        {versions.length > 1 && <span className="tag rolling">rolling update in progress</span>}
      </div>

      <div className="replicas">
        {data.replicas.map((r) => (
          <ReplicaCard
            key={r.hostname}
            replica={r}
            now={now}
            servedBy={r.hostname === data.servedBy}
            connected={r.hostname === connectedTo}
          />
        ))}
        {gone.map((r) => (
          <ReplicaCard key={`gone-${r.hostname}`} replica={r} now={now} goneSeconds={(Date.now() - r.goneAt) / 1000} />
        ))}
      </div>
      {error && <div className="error small">{error}</div>}
    </div>
  );
}

const HEALTH_LABEL = {
  ready: "ready",
  "shutting-down": "shutting down",
  "db-down": "database unreachable",
  "not-responding": "not responding",
};

function ReplicaCard({ replica: r, now, servedBy, connected, goneSeconds }) {
  const health = goneSeconds === undefined ? replicaHealth(r, now) : "gone";
  const uptime = now - new Date(r.startedAt).getTime();
  const lastSeen = Math.max(0, Math.round((now - new Date(r.lastSeen).getTime()) / 1000));
  return (
    <div className={`card replica ${health}`}>
      <div className="replica-head">
        <span className={`health-dot ${health}`} />
        <code className="replica-name">{r.hostname}</code>
      </div>
      <div className="replica-tags">
        <span className={`tag health ${health}`}>
          {health === "gone" ? `gone · ${Math.round(goneSeconds)}s ago` : HEALTH_LABEL[health]}
        </span>
        {health !== "gone" && uptime < NEW_REPLICA_MS && <span className="tag new">new</span>}
        {servedBy && <span className="tag">answered this request</span>}
        {connected && <span className="tag">your live connection</span>}
      </div>
      <dl>
        <dt>Version</dt>
        <dd>
          <code>{shortVersion(r.version)}</code>
        </dd>
        <dt>Uptime</dt>
        <dd>{formatDuration(uptime)}</dd>
        <dt>Live connections</dt>
        <dd>{r.liveConnections}</dd>
        <dt>CPU</dt>
        <dd>{r.cpuPercent}%</dd>
        <dt>Memory</dt>
        <dd>{r.memoryMb} MB</dd>
        <dt>Last heartbeat</dt>
        <dd>{lastSeen}s ago</dd>
      </dl>
    </div>
  );
}

// Polls /api/info so you can see which backend replica answered (watch it change while scaling).
// lastEventFrom is the replica that published the last live event: with Redis it can be any of them.
function BackendInfo({ lastEventFrom }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    const load = () => api.info().then(setInfo).catch(() => setInfo(null));
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, []);

  return (
    <footer>
      {info ? (
        <>
          API <b>{info.version}</b> · served by <code>{info.hostname}</code> · up {info.uptimeSeconds}s
          {info.liveUpdates && <> · live via {info.liveUpdates}</>}
          {lastEventFrom && (
            <>
              {" "}
              · last event from <code>{lastEventFrom}</code>
            </>
          )}
        </>
      ) : (
        "API unreachable"
      )}
    </footer>
  );
}
