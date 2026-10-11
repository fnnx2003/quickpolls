import { useCallback, useEffect, useState } from "react";
import { api, environment } from "./api.js";
import { cleanOptions, percent, timeAgo } from "./utils.js";

const REFRESH_MS = 3000;

export default function App() {
  const [polls, setPolls] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [error, setError] = useState("");

  const refreshPolls = useCallback(async () => {
    try {
      setPolls(await api.listPolls());
      setError("");
    } catch (err) {
      setError(`Can't reach the API: ${err.message}`);
    }
  }, []);

  useEffect(() => {
    refreshPolls();
    const t = setInterval(refreshPolls, REFRESH_MS);
    return () => clearInterval(t);
  }, [refreshPolls]);

  return (
    <div className="app">
      <header>
        <h1>📊 QuickPolls</h1>
        <span className="badge">{environment}</span>
      </header>

      {error && <div className="error">{error}</div>}

      <main>
        <section className="sidebar">
          <CreatePoll
            onCreated={(poll) => {
              refreshPolls();
              setSelectedId(poll.id);
            }}
          />
          <PollList polls={polls} selectedId={selectedId} onSelect={setSelectedId} />
        </section>

        <section className="content">
          {selectedId ? (
            <PollDetail
              key={selectedId}
              id={selectedId}
              onChange={refreshPolls}
              onDeleted={() => {
                setSelectedId(null);
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

function CreatePoll({ onCreated }) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const setOption = (i, value) => setOptions((opts) => opts.map((o, j) => (j === i ? value : o)));

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    try {
      const poll = await api.createPoll(question, cleanOptions(options));
      setQuestion("");
      setOptions(["", ""]);
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
        <input key={i} placeholder={`Option ${i + 1}`} value={opt} onChange={(e) => setOption(i, e.target.value)} />
      ))}
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

function PollList({ polls, selectedId, onSelect }) {
  if (polls.length === 0) return <div className="card muted">No polls yet.</div>;
  return (
    <ul className="poll-list">
      {polls.map((p) => (
        <li key={p.id} className={p.id === selectedId ? "active" : ""} onClick={() => onSelect(p.id)}>
          <div className="q">{p.question}</div>
          <div className="meta">
            {p.totalVotes} votes · {timeAgo(p.createdAt)}
          </div>
        </li>
      ))}
    </ul>
  );
}

function PollDetail({ id, onChange, onDeleted }) {
  const [poll, setPoll] = useState(null);
  const [voted, setVoted] = useState(null);
  const [error, setError] = useState("");

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

  async function vote(optionId) {
    try {
      setPoll(await api.vote(id, optionId));
      setVoted(optionId);
      onChange();
    } catch (err) {
      setError(err.message);
    }
  }

  async function remove() {
    if (!confirm("Delete this poll?")) return;
    try {
      await api.deletePoll(id);
      onDeleted();
    } catch (err) {
      setError(err.message);
    }
  }

  if (error && !poll) return <div className="error">{error}</div>;
  if (!poll) return <div className="muted">Loading…</div>;

  return (
    <div className="card poll">
      <h2>{poll.question}</h2>
      <div className="options">
        {poll.options.map((o) => {
          const pct = percent(o.votes, poll.totalVotes);
          return (
            <button key={o.id} className={`option ${voted === o.id ? "voted" : ""}`} onClick={() => vote(o.id)}>
              <span className="bar" style={{ width: `${pct}%` }} />
              <span className="label">{o.label}</span>
              <span className="count">
                {o.votes} · {pct}%
              </span>
            </button>
          );
        })}
      </div>
      <div className="row between">
        <span className="muted">{poll.totalVotes} total votes · click an option to vote</span>
        <button className="danger" onClick={remove}>
          Delete
        </button>
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
