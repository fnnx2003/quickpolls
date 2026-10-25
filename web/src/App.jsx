import { useCallback, useEffect, useState } from "react";
import { api, environment } from "./api.js";
import { cleanOptions, leaders, percent, pollIdFromHash, timeAgo, timeLeft } from "./utils.js";

const REFRESH_MS = 3000;

const CLOSE_CHOICES = [
  { label: "Never", minutes: null },
  { label: "1 hour", minutes: 60 },
  { label: "1 day", minutes: 24 * 60 },
  { label: "1 week", minutes: 7 * 24 * 60 },
];

export default function App() {
  const [polls, setPolls] = useState([]);
  const [selectedId, setSelectedId] = useState(() => pollIdFromHash(window.location.hash));
  const [filters, setFilters] = useState({ search: "", sort: "newest", status: "all" });
  const [stats, setStats] = useState(null);
  const [error, setError] = useState("");

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

  useEffect(() => {
    refreshPolls();
    const t = setInterval(refreshPolls, REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshPolls]);

  // Keep the selected poll in the URL (#/poll/12) so links can be shared.
  useEffect(() => {
    const onHash = () => setSelectedId(pollIdFromHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  const select = (id) => {
    window.location.hash = id ? `#/poll/${id}` : "";
    setSelectedId(id);
  };

  return (
    <div className="app">
      <header>
        <h1>📊 QuickPolls</h1>
        <span className="badge">{environment}</span>
        {stats && (
          <span className="stats muted">
            {stats.polls} polls · {stats.openPolls} open · {stats.votes} votes
          </span>
        )}
        <ThemeToggle />
      </header>

      {error && <div className="error">{error}</div>}

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

      <BackendInfo />
    </div>
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

function PollDetail({ id, onChange, onDeleted }) {
  const [poll, setPoll] = useState(null);
  const [picked, setPicked] = useState([]); // multi-choice selection before submitting
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [peek, setPeek] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api
        .getPoll(id)
        .then((p) => !cancelled && (setPoll(p), setError("")))
        .catch((err) => !cancelled && setError(err.message));
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [id]);

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

// Polls /api/info so you can see which backend replica answered (watch it change while scaling).
function BackendInfo() {
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
        </>
      ) : (
        "API unreachable"
      )}
    </footer>
  );
}
