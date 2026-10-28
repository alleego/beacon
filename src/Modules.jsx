import React, { useEffect, useState } from "react";
import { api } from "./bridge";
import { safeLink } from "../shared/domain.mjs";

function ProgressMessage({ text, run }) {
  return <p role="status">{text.split(/(https:\/\/[^\s<>]+)/g).map((part, i) =>
    safeLink(part) ? <button className="text-link" key={i} onClick={() => run(() => api["open-link"](part))}>{part}</button> : part)}</p>;
}

function EvidenceBrowser({ records }) {
  const [group, setGroup] = useState('All');
  const [query, setQuery] = useState('');
  const groups = [...new Set(records.map(e => e.group || e.topic || 'General'))];
  const visible = records.filter(e => (group === 'All' || (e.group || e.topic || 'General') === group) &&
    `${e.title || ''} ${e.source} ${e.text}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="modal-body evidence-view">
    <p className="muted">Saved snapshot excerpts, not live status. Missing or failed captures do not establish health.</p>
    <div className="actions evidence-groups" aria-label="Evidence groups">
      {['All', ...groups].map(name => <button key={name} aria-pressed={group === name} onClick={() => setGroup(name)}>{name}</button>)}
    </div>
    <label className="field">Search collected evidence<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Command, resource or source path" /></label>
    <p className="muted">{visible.length} of {records.length} records</p>
    {visible.map(e => <details key={e.id} className="evidence-record">
      <summary><strong>[{e.id}] {e.title || e.source}</strong>{e.state && <span className={`badge ${e.state === 'captured' ? 'green' : 'neutral'}`}>{e.state.replaceAll('-', ' ')}</span>}</summary>
      <p className="muted">Source: {e.source}<br />Collected: {e.collectedAt}</p><pre>{e.text}</pre>
    </details>)}
    {!visible.length && <p>No records match this view.</p>}
  </div>;
}

export function ModuleAccess({ module: m, refresh, run, compact = false }) {
  const [checking, setChecking] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 15000); return () => clearInterval(timer); }, []);
  const saved = m.access || {state:"unchecked"};
  const a = saved.state === 'reachable' && now - Date.parse(saved.checkedAt) > 120000
    ? {...saved, state:'stale', message:'Last check succeeded. Check again to verify current access.'} : saved;
  const busy = checking || a.state === "checking";
  const configured = m.enabled && !!m.connection;
  const labels = {unchecked:"Not checked", checking:"Checking…", reachable:"Reachable", stale:"Check again",
    unreachable:"Unreachable", "auth-required":"Sign-in needed", "host-key":"Verify host key", failed:"Check failed", cancelled:"Not checked"};
  const check = () => run(async () => {
    setChecking(true);
    try { await api["module-access-check"]({id:m.id}); await refresh(); }
    finally { setChecking(false); }
  });
  const detail = `${a.message || 'Check the saved SSH connection.'}${a.checkedAt ? ` Last checked: ${new Date(a.checkedAt).toLocaleString()}.` : ''}`;
  return <div className={`module-access ${compact ? 'compact' : ''}`}>
    <button type="button" disabled={!configured || busy} onClick={check}
      className={`access-check ${a.state === 'reachable' && !busy ? 'reachable' : ''}`}
      aria-label={`Check access for ${m.name}`} title={`${m.name}. ${detail}`}>
      <span className={busy ? 'progress-ring' : 'access-dot'} aria-hidden="true" />
      {compact ? m.name : 'Remote access'}: {busy ? 'Checking…' : !configured ? 'Set up connection' : labels[a.state] || 'Not checked'}
    </button>
    {!compact && <p className="muted" role="status">{detail}<br />Checks the saved connection without reading case files or calling the model. Click to check again.</p>}
    {compact && a.checkedAt && <small title={detail}>Checked {new Date(a.checkedAt).toLocaleTimeString()}</small>}
  </div>;
}

function ModuleCard({ module: m, refresh, run }) {
  const [connection, setConnection] = useState(m.connection || { host: "", user: "", relay: "", config: "" });
  const edit = (key, value) => setConnection(c => ({ ...c, [key]: value }));
  return <article className="module-card">
    <div className="module-heading"><h3>{m.name} <small>{m.version}</small></h3>
      <label><input type="checkbox" checked={m.enabled} onChange={e => run(async () => {
        await api["module-configure"]({ id: m.id, enabled: e.target.checked }); await refresh();
      })} /> Enabled</label></div>
    <p>{m.description}</p>
    <ModuleAccess module={m} refresh={refresh} run={run} />
    <details><summary>Package fingerprint</summary><code className="fingerprint">{m.hash}</code></details>
    <form onSubmit={e => { e.preventDefault(); run(async () => {
      await api["module-configure"]({id: m.id, connection}); await refresh();
    }); }}>
      <p><strong>{connection.relay ? "Connection through another computer" : "Direct connection (default)"}</strong><br />
        Normally this app connects straight to the remote host using this computer’s SSH setup. No SSH connection back into this computer is needed.</p>
      <label className="field">Remote host<input value={connection.host} onChange={e => edit("host", e.target.value)} required /></label>
      <label className="field">Your SSH username<input value={connection.user} onChange={e => edit("user", e.target.value)} required autoComplete="off" /></label>
      <details><summary>Advanced: optional relay computer</summary>
        <p className="muted">Most users should leave this empty. Use a relay only when the remote host must be reached through another computer. That computer uses its own existing SSH credentials for the second connection. Clear this field to return to a direct connection.</p>
        <label className="field">Relay SSH host or alias<input value={connection.relay} onChange={e => edit("relay", e.target.value)} /></label>
      </details>
      <label className="field">Local SSH config file (optional)<input value={connection.config} onChange={e => edit("config", e.target.value)} /></label>
      <p className="muted">Connect your VPN and sign in manually first. SSH host keys must already be trusted. Passwords and private keys are never entered here.</p>
      <button type="submit">Save connection</button>
    </form>
  </article>;
}

export function Modules({ run }) {
  const [state, setState] = useState({modules: []});
  const [unlock, setUnlock] = useState(null);
  const [password, setPassword] = useState('');
  const [unlockError, setUnlockError] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const refresh = async () => setState(await api.modules());
  useEffect(() => { run(refresh); }, []);
  useEffect(() => {
    const token=unlock?.token;
    return () => { if(token)void api["module-import-cancel"]({token}).catch(()=>{}); };
  }, [unlock?.token]);
  return <div>
    <h3>Optional modules</h3>
    <p>Import one cartridge file from its author. Each module adds its own tools to chat. Disabling a module stops its active work and keeps saved results.</p>
    <button disabled={unlocking} onClick={() => run(async () => {
      setPassword('');setUnlockError('');setUnlock(null);
      const result=await api["module-import"]();
      if(result?.needsUnlock)setUnlock(result);
      await refresh();
    })}>Import module</button>
    {unlock && <form className="module-card" onSubmit={async e=>{
      e.preventDefault();setUnlocking(true);setUnlockError('');
      const secret=password;setPassword('');
      try {await api["module-import-unlock"]({token:unlock.token,password:secret});setUnlock(null);await refresh();}
      catch(error){setUnlockError(error.message);}
      finally{setUnlocking(false);}
    }}>
      <h3>Unlock cartridge</h3>
      <p>Enter the password shared separately by the cartridge's author. It is used locally and is not saved.</p>
      <label className="field">Cartridge password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} autoComplete="off" maxLength={1024} required disabled={unlocking} /></label>
      {unlockError && <p role="alert">{unlockError}</p>}
      <div className="actions"><button type="submit" disabled={unlocking || !password}>{unlocking?'Unlocking…':'Unlock and review'}</button>
        <button type="button" disabled={unlocking} onClick={()=>{setUnlock(null);setPassword('');setUnlockError('');}}>Cancel import</button></div>
    </form>}
    {state.modules.map(m => <ModuleCard key={m.id + m.version} module={m} refresh={refresh} run={run} />)}
    {!state.modules.length && <p className="muted">No modules installed. General chat is ready whenever you connect Vertex.</p>}
  </div>;
}

export function Investigations({ jobs, chatId, selectChat, run, refresh, Modal }) {
  const [evidence, setEvidence] = useState(null);
  const selected = jobs.filter(j => j.chatId === chatId || j.children.some(c => c.chatId === chatId));
  if (!selected.length) return null;
  const action = (name, value) => run(async () => { await api[name](value); await refresh(); });
  return <div className="investigations">
    {selected.map(j => {
      const active = ["queued", "collecting", "awaiting-auth", "analyzing", "reviewing"].includes(j.status);
      return <article className="investigation-card" key={j.id}>
        <div className="module-heading">
          <strong>{active && <span className="progress-ring" role="progressbar" aria-label={j.message} />} {j.target} · {j.depth}</strong>
          <span className={`badge ${j.status === "ready" ? "green" : "neutral"}`}>{j.status}</span>
        </div>
        <ProgressMessage text={j.message} run={run} />
        {j.selectedSource && <p><strong>Snapshot:</strong> {j.selectedSource.label}<br />
          Collection date: {j.selectedSource.capturedAt || "Unknown"} · {j.selectedSource.relevance}</p>}
        {!!j.sources?.length && <details open={j.status === "awaiting-selection"}>
          <summary>{j.status === "awaiting-selection" ? "Choose a snapshot to continue" : "Available snapshots"}</summary>
          <p className="muted">Dates describe capture time when available. A different snapshot opens a separate investigation so findings stay separate.</p>
          {j.sources.map(source => <div className="module-card" key={source.id}>
            <p>{source.label}<br />{source.capturedAt || "Collection date unknown"} · {source.relevance}
              {source.cluster && <> · Cluster: {source.cluster}</>}</p>
            <p className="muted">{source.dateSource}</p>
            <button disabled={active || source.incompletePart} onClick={() => run(async () => {
              if (!j.evidenceCount) await api["investigation-resume"]({id: j.id, sourceId: source.id});
              else {
                const next = await api["investigation-source"]({id: j.id, sourceId: source.id});
                await selectChat(next.chatId);
              }
              await refresh();
            })}>{source.incompletePart ? "Incomplete split part" : j.evidenceCount ? "Inspect in a new chat" : "Inspect this snapshot"}</button>
          </div>)}
        </details>}
        {j.stale && <p className="notice">New specialist findings are available for master review.</p>}
        <div className="investigation-children">
          <button onClick={() => selectChat(j.chatId)} aria-pressed={chatId === j.chatId}>Master chat</button>
          {j.children.map(c => <button key={c.chatId} onClick={() => selectChat(c.chatId)} aria-pressed={chatId === c.chatId}>
            {c.name} {c.summary ? "✓" : "…"}
          </button>)}
        </div>
        <div className="actions">
          {active ? <button onClick={() => action("investigation-stop", {id: j.id})}>Stop investigation</button> :
            j.status !== "ready" && j.status !== "awaiting-selection" && <button onClick={() => action("investigation-resume", {id: j.id})}>Resume unfinished work</button>}
          {!active && j.stale && <button onClick={() => action("investigation-resume", {id: j.id, review: true})}>Refresh master review</button>}
          <button disabled={!j.evidenceCount} onClick={() => run(async () => setEvidence(await api["investigation-evidence"]({id: j.id})))}>Evidence ({j.evidenceCount})</button>
          <button onClick={() => run(async () => api.copy(await api["investigation-handoff"]({id: j.id})))}>Copy handoff</button>
          <button onClick={() => run(async () => api["export-chat"](await api["investigation-handoff"]({id: j.id})))}>Export handoff</button>
        </div>
      </article>;
    })}
    {evidence && <Modal title="Collected evidence" onClose={() => setEvidence(null)}>
      <EvidenceBrowser records={evidence} />
    </Modal>}
  </div>;
}
