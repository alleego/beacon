import React, { useEffect, useRef, useState } from "react";
import {
  MessageSquare,
  BookOpen,
  NotebookPen,
  Settings,
  Plus,
  Send,
  Square,
  Copy,
  Download,
  X,
  Upload,
  Check,
  ArrowUpRight,
  ChevronRight,
  ShieldCheck,
  Server,
  CircleHelp,
  PanelLeftClose,
  Menu,
  Trash2,
  FolderOpen,
  Sun,
  Moon,
  Monitor,
  Terminal,
  Search,
  FileText,
} from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { DEFAULT_SETTINGS, PROVIDER, safeLink, shouldSendOnEnter } from "../shared/domain.mjs";
import { api } from "./bridge";
import Library from "./Library";
import { Modules, Investigations, ModuleAccess } from "./Modules";
import ChatNavigation, { ChatDialog } from "./ChatNavigation";
import Notes from "./Notes";
import Usage, { UsageBadge } from "./Usage";
import QuickStart, { QuickStartSettings } from "./QuickStart";

const APP_VERSION = __APP_VERSION__;
const EMPTY_MESSAGES = [];

const links = [["Vertex documentation", "https://cloud.google.com/vertex-ai/docs"]];
const ErrorContext = React.createContext("");
const quickPrompts = [
  {
    icon: Search,
    title: "Review evidence",
    text: "Help me review this Storage evidence. Separate confirmed facts, hypotheses, and the next focused checks.\n\n",
  },
  {
    icon: Terminal,
    title: "Check a command",
    text: "Review this command for the specified product and version. Explain what it does, its risks, and how to verify the result.\n\n",
  },
  {
    icon: FileText,
    title: "Draft a response",
    text: "Help me draft a concise, warm response using only the evidence below. Keep it practical and collaborative. Do not invent a root cause.\n\n",
  },
];
function IconButton({ label, children, ...props }) {
  return (
    <button className="icon-button" aria-label={label} title={label} {...props}>
      {children}
    </button>
  );
}
function Modal({ title, children, onClose, className = "" }) {
  const ref = useRef();
  const error = React.useContext(ErrorContext);
  useEffect(() => {
    const d = ref.current;
    d.showModal();
    return () => d.close();
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`modal ${className}`}
      onCancel={(e) => {
        e.preventDefault();
        onClose?.();
      }}
    >
      <header>
        <h2>{title}</h2>
        {onClose && (
          <IconButton label="Close dialog" onClick={onClose}>
            <X size={20} />
          </IconButton>
        )}
      </header>
      {error && (
        <div role="alert" className="error-banner">
          {error}
        </div>
      )}
      {children}
    </dialog>
  );
}

function Connection({ connection, setConnection, run, busy }) {
  const [testing, setTesting] = useState(false);
  const [confirmTest, setConfirmTest] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const importKey = () =>
    run(async () => {
      const result = await api["import-credential"]();
      if (result) setConnection(result);
    });
  const test = async () => {
    setConfirmTest(false);
    setTesting(true);
    await run(async () => {
      const result = await api["test-connection"]();
      setConnection((c) => ({ ...c, ...result }));
    });
    setTesting(false);
  };
  return (
    <div className="connection-section">
      <div className="connection-summary">
        <Server size={21} />
        <div>
          <strong>Claude on Google Vertex</strong>
          <p>
            {PROVIDER.model} <span className="muted">/ {PROVIDER.region}</span>
          </p>
        </div>
        <span className={`badge ${connection.tested ? "green" : "neutral"}`}>
          {connection.tested
            ? "Verified this session"
            : connection.imported
              ? "Imported, not tested"
              : "Not connected"}
        </span>
      </div>
      {connection.project && (
        <p className="project">
          Project <code>{connection.project}</code>
        </p>
      )}
      {connection.error && (
        <p role="alert" className="error-inline">
          {connection.error}
        </p>
      )}
      <p className="muted">
        Use your own Google Vertex JSON file. It is encrypted on this
        device, not shared with teammates.
      </p>
      <div className="actions">
        <button onClick={importKey} disabled={busy || testing}>
          <Upload size={16} />
          {connection.imported ? "Replace credential" : "Import credential"}
        </button>
        <button
          onClick={() => setConfirmTest(true)}
          disabled={!connection.imported || busy || testing}
        >
          {testing ? "Testing..." : "Test connection"}
        </button>
        {connection.imported && (
          <IconButton
            label="Remove saved credential"
            disabled={busy || testing}
            onClick={() => setConfirmRemove(true)}
          >
            <Trash2 size={16} />
          </IconButton>
        )}
      </div>
      {confirmTest && (
        <Modal
          title="Test Claude connection"
          onClose={() => setConfirmTest(false)}
        >
          <div className="modal-body">
            <p>
              This sends a short test message to your Google Vertex project. A
              small amount of API usage may be billed. No case information is
              included.
            </p>
          </div>
          <footer>
            <button onClick={() => setConfirmTest(false)}>Cancel</button>
            <button className="primary" onClick={test}>
              Run test
            </button>
          </footer>
        </Modal>
      )}
      {confirmRemove && (
        <Modal
          title="Remove credential from this device?"
          onClose={() => setConfirmRemove(false)}
        >
          <div className="modal-body">
            <p>
              You will need to import your file again to use Claude. This does
              not revoke the credential at Google.
            </p>
          </div>
          <footer>
            <button onClick={() => setConfirmRemove(false)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                setConfirmRemove(false);
                run(async () =>
                  setConnection(await api["remove-credential"]()),
                );
              }}
            >
              Remove
            </button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

function SettingsPanel({
  settings,
  onSave,
  onClose,
  connection,
  setConnection,
  run,
  busy,
  desktop,
  initialTab = "Appearance",
  usageData,
  onTutorial,
  onResetTutorial,
  onContinueTutorial,
}) {
  const [tab, setTab] = useState(initialTab);
  return (
    <Modal title="Settings" onClose={onClose} className="settings-modal">
      <div className="modal-tabs" role="tablist">
        {["Appearance", "Behavior", "Usage", "Profile", "Connection", "Modules", "Local data"].map((t) => (
          <button
            role="tab"
            aria-selected={tab === t}
            key={t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="modal-body" role="tabpanel">
        {tab === "Appearance" && (
          <>
            <h3>Window appearance</h3>
            <div className="theme-options">
              {[
                ["dark", Moon, "Dark"],
                ["light", Sun, "Light"],
                ["system", Monitor, "System"],
              ].map(([v, Icon, label]) => (
                <button
                  key={v}
                  aria-pressed={settings.theme === v}
                  onClick={() => onSave({ ...settings, theme: v })}
                >
                  <Icon size={18} />
                  {label}
                  {settings.theme === v && <Check size={16} />}
                </button>
              ))}
            </div>
            <label className="field-label">Accent</label>
            <div className="swatches">
              {[
                ["#ee0000", "Red"],
                ["#c9190b", "Deep red"],
                ["#0066cc", "Blue"],
                ["#009596", "Teal"],
              ].map(([v, label]) => (
                <button
                  title={label}
                  aria-label={label}
                  aria-pressed={settings.accent === v}
                  style={{ backgroundColor: v }}
                  key={v}
                  onClick={() => onSave({ ...settings, accent: v })}
                >
                  {settings.accent === v && <Check size={17} />}
                </button>
              ))}
            </div>
            <hr />
            <label className="field">
              Font family
              <select
                value={settings.font}
                onChange={(e) => onSave({ ...settings, font: e.target.value })}
              >
                <option value="system">System</option>
                <option value="sans">Arial / Helvetica</option>
                <option value="mono">Monospace</option>
              </select>
            </label>
            <label className="field">
              Text size <strong>{settings.fontSize} px</strong>
              <input
                aria-label="Text size"
                type="range"
                min="13"
                max="20"
                step="1"
                value={settings.fontSize}
                onChange={(e) =>
                  onSave({ ...settings, fontSize: Number(e.target.value) })
                }
              />
            </label>
            <label className="field">
              Line spacing
              <select
                value={settings.lineHeight}
                onChange={(e) =>
                  onSave({ ...settings, lineHeight: Number(e.target.value) })
                }
              >
                <option value="1.45">Compact</option>
                <option value="1.65">Comfortable</option>
                <option value="1.85">Spacious</option>
              </select>
            </label>
            <label className="check-row">
              <input
                type="checkbox"
                checked={settings.rememberWindow}
                onChange={(e) =>
                  onSave({ ...settings, rememberWindow: e.target.checked })
                }
              />
              Remember window size
            </label>
            <div className="text-sample">
              <span className="eyebrow">PREVIEW</span>
              <p>The cluster is healthy. Let us check the node logs next.</p>
              <code>Review evidence and suggest next steps</code>
            </div>
          </>
        )}
        {tab === "Profile" && (
          <>
            <label className="field">
              Your name
              <input
                maxLength="80"
                value={settings.name}
                onChange={(e) => onSave({ ...settings, name: e.target.value })}
              />
            </label>
            <p className="muted">
              Your profile belongs to this device. It is not automatically
              included in messages sent to Claude.
            </p>
          </>
        )}
        {tab === "Behavior" && <>
          <label className="field">Enter key<select aria-label="Enter key" value={settings.enterBehavior} onChange={e => onSave({...settings,enterBehavior:e.target.value})}><option value="newline">Create a new line</option><option value="send">Send the message</option></select></label>
          <hr/><h3>Quick start</h3>
          <QuickStartSettings onReplay={onTutorial} onReset={onResetTutorial}/>
          {settings.tutorialStatus === "active" && <button onClick={onContinueTutorial}>Continue quick start</button>}
        </>}
        {tab === "Usage" && <Usage data={usageData} settings={settings} onSave={onSave}/>}
        {tab === "Connection" && (
          <Connection {...{ connection, setConnection, run, busy }} />
        )}
        {tab === "Modules" && <Modules run={run} />}
        {tab === "Local data" && (
          <>
            <h3>On this device</h3>
            <dl className="facts">
              <div>
                <dt>App version</dt>
                <dd>v{APP_VERSION} (local preview)</dd>
              </div>
              <div>
                <dt>Credentials</dt>
                <dd>OS-encrypted, per user</dd>
              </div>
              <div>
                <dt>Conversations</dt>
                <dd>
                  {desktop
                    ? "Chats, drafts and projects: OS-encrypted on this device"
                    : "Chats, drafts and projects: browser-local storage"}
                </dd>
              </div>
              <div>
                <dt>Notes and usage</dt>
                <dd>{desktop ? "OS-encrypted on this device" : "Browser-local preview"}</dd>
              </div>
              <div>
                <dt>Original notebook</dt>
                <dd>Any pre-upgrade notes.json is kept unchanged for recovery</dd>
              </div>
              <div>
                <dt>Telemetry</dt>
                <dd>Not collected by this app</dd>
              </div>
            </dl>
            <button onClick={() => run(() => api["open-data"]())}>
              <FolderOpen size={16} />
              Open data folder
            </button>
            <hr />
            <h3>When you send to Claude</h3>
            <p className="muted">
              Only the chat you send from is included in the Google Vertex
              request. Project folders do not share chat context. Investigation chats share findings with their master review. Account and
              cloud retention rules apply. Only submit data you are authorized
              to share.
            </p>
          </>
        )}
      </div>
      <footer>
        <span className="muted">Changes save automatically</span>
        <button onClick={onClose}>Done</button>
      </footer>
    </Modal>
  );
}

export default function App() {
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [connection, setConnection] = useState({ imported: false });
  const [desktop, setDesktop] = useState(false);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState("chat");
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab] = useState("Appearance");
  const [showTutorial, setShowTutorial] = useState(false);
  const [usageData, setUsageData] = useState(null);
  const [showWelcome, setShowWelcome] = useState(false);
  const [setupStep, setSetupStep] = useState(1);
  const [setupName, setSetupName] = useState("");
  const [sidebar, setSidebar] = useState(true);
  const [workspace, setWorkspace] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [installedModules, setInstalledModules] = useState([]);
  const [evidenceFocus, setEvidenceFocus] = useState(null);
  const [drafts, setDrafts] = useState({});
  const [pendingTurn, setPendingTurn] = useState(null);
  const [draftSaves, setDraftSaves] = useState(0);
  const [draftError, setDraftError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [notes, setNotes] = useState(null);
  const notesRef = useRef(null);
  const [library, setLibrary] = useState(null);
  const [chatDialog, setChatDialog] = useState(null);
  const workspaceRef = useRef(null);
  const draftQueue = useRef(Promise.resolve());
  const activeChat = workspace?.chats.find(
    (c) => c.id === workspace.activeChatId,
  );
  const activeProject = workspace?.projects.find(
    (p) => p.id === activeChat?.projectId,
  );
  const messages = activeChat?.messages || EMPTY_MESSAGES;
  const input = activeChat ? (drafts[activeChat.id] ?? activeChat.draft) : "";
  const pending =
    activeChat?.pending?.question ||
    (pendingTurn?.chatId === activeChat?.id ? pendingTurn?.question : "") ||
    "";
  const usage = activeChat?.usage;
  const endRef = useRef();
  const submitLock = useRef(false);
  const cancelledSend = useRef(false);
  const settingsQueue = useRef(Promise.resolve());
  const acceptWorkspace = (next) => {
    if (
      next &&
      (!workspaceRef.current || next.revision > workspaceRef.current.revision ||
        (next.revision === workspaceRef.current.revision && next.storageError !== workspaceRef.current.storageError))
    ) {
      workspaceRef.current = next;
      setWorkspace(next);
    }
    return next;
  };
  const acceptNotes = next => {
    if (!notesRef.current || next.revision >= notesRef.current.revision) {notesRef.current = next; setNotes(next);}
    return next;
  };
  const notesAction = async action => acceptNotes(await api["notes-action"](action));
  const refreshInvestigations = async () => {
    const state = await api.modules();
    setJobs(state.jobs);
    setInstalledModules(state.modules);
    acceptWorkspace(await api.workspace());
  };
  useEffect(() => {
    let live = true;
    const poll = async () => { try {
      const data = await api.modules();
      const ws = await api.workspace();
      if (live) { setJobs(data.jobs); setInstalledModules(data.modules); acceptWorkspace(ws); if (data.storageError) setError(data.storageError); }
    } catch (e) { if (live) setError(e.message); } };
    void poll();
    const timer = setInterval(poll, 1500);
    return () => { live = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    let live = true;
    const refresh = async () => {try {const data = await api.usage(); if (live) setUsageData(data);}catch(e){if(live) setError(e.message);}};
    void refresh();
    const timer = setInterval(refresh, 10000);
    return () => {live = false; clearInterval(timer);};
  }, []);
  const mutateWorkspace = async (action) =>
    acceptWorkspace(await api["workspace-action"](action));
  const setInput = (value) => {
    if (!activeChat || pending) return;
    const id = activeChat.id;
    setDrafts((old) => ({ ...old, [id]: value }));
    setDraftSaves((n) => n + 1);
    const save = mutateWorkspace({ type: "save-draft", id, draft: value });
    draftQueue.current = save;
    void save
      .then(
        () => setDraftError(false),
        (e) => {
          setDraftError(true);
          setError(e.message);
        },
      )
      .finally(() => setDraftSaves((n) => Math.max(0, n - 1)));
  };
  const run = async (task) => {
    setError("");
    try {
      return await task();
    } catch (e) {
      setError(e.message);
      return undefined;
    }
  };
  useEffect(() => {
    let live = true;
    api
      .bootstrap()
      .then(async (data) => {
        if (!live) return;
        setSettings(data.settings);
        setConnection(data.connection);
        acceptNotes(data.notes);
        setUsageData(data.usage);
        setDesktop(data.desktop);
        acceptWorkspace(data.workspace);
        setShowWelcome(!data.settings.onboarded);
        setLoading(false);
        try {
          const lib = await api.library();
          if (live) setLibrary(lib);
        } catch (e) {
          if (live) setError(e.message);
        }
      })
      .catch((e) => {
        if (live) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    document.title = "Beacon";
    root.dataset.theme = settings.theme;
    root.style.setProperty("--accent", settings.accent);
    root.style.setProperty("--base-size", `${settings.fontSize}px`);
    root.style.setProperty("--line-height", settings.lineHeight);
    root.style.setProperty(
      "--font",
      settings.font === "mono"
        ? '"Cascadia Code", "SFMono-Regular", Consolas, monospace'
        : settings.font === "sans"
          ? "Arial, Helvetica, sans-serif"
          : '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    );
  }, [settings]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, pending]);
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(""), 2500);
      return () => clearTimeout(timer);
    }
  }, [toast]);
  const saveSettings = (next) => {
    setSettings(next);
    settingsQueue.current = settingsQueue.current
      .catch(() => {})
      .then(() => api["save-settings"](next));
    return settingsQueue.current.catch((e) => {
      setError(e.message);
      throw e;
    });
  };
  const safeSave = (next) => {
    void saveSettings(next).catch(() => {});
  };
  const openSettings = tab => {setSettingsTab(tab);setShowSettings(true);};
  const replayTutorial = () => {
    safeSave({...settings,tutorialStatus:"active",tutorialStep:0});
    setShowSettings(false);setShowTutorial(true);
  };
  const send = async (e) => {
    e?.preventDefault();
    if (submitLock.current || !input.trim() || !activeChat || pending) return;
    if (!connection.imported || !settings.name) {
      setShowSettings(true);
      return;
    }
    submitLock.current = true;
    cancelledSend.current = false;
    setBusy(true);
    setError("");
    const question = input.trim();
    const chatId = activeChat.id;
    try {
      await draftQueue.current;
      if (cancelledSend.current) return;
      setPendingTurn({ chatId, question });
      setDrafts((old) => ({ ...old, [chatId]: "" }));
      const next = await api.chat({ chatId, content: question });
      acceptWorkspace(next);
      const completed = next.chats.find((c) => c.id === chatId);
      setDrafts((old) => ({ ...old, [chatId]: completed.draft }));
      if (workspaceRef.current.activeChatId !== chatId)
        setToast(
          completed.error
            ? `Response stopped in ${completed.title}`
            : `Response saved to ${completed.title}`,
        );
    } catch (e) {
      setError(e.message);
      setDrafts((old) => ({ ...old, [chatId]: question }));
    } finally {
      setBusy(false);
      setPendingTurn(null);
      submitLock.current = false;
    }
  };
  const copy = (text) =>
    run(async () => {
      await api.copy(text);
      setToast("Copied");
    });
  const switchView = (v) => {
    setView(v);
    if (window.innerWidth < 900) setSidebar(false);
  };
  const exportChat = () =>
    run(async () => {
      const result = await api["export-chat"](
        messages
          .map(
            (m) => `## ${m.role === "user" ? "You" : "Claude"}\n\n${m.content}`,
          )
          .join("\n\n"),
      );
      if (result) setToast("Conversation exported");
    });
  const newChat = (projectId = null) =>
    run(async () => {
      await draftQueue.current;
      await mutateWorkspace({ type: "create-chat", projectId });
      switchView("chat");
    });
  const selectChat = (id) =>
    run(async () => {
      await draftQueue.current;
      await mutateWorkspace({ type: "select-chat", id });
      switchView("chat");
    });
  const attachNote = async (note, target) => {
    await draftQueue.current;
    const text = `\n\n[Attached note: ${note.title || "Untitled note"}]\n${note.body}\n[End of attached note]`;
    const existing = target === "new" ? null : workspaceRef.current?.chats.find(c=>c.id===target);
    if (target !== "new" && !existing) throw new Error("Chat not found.");
    if (existing?.pending) throw new Error("Wait for this chat's response before attaching a note.");
    const draft = `${existing?.draft || ""}${text}`.trim();
    if (draft.length > 40000) throw new Error("This note is too large for the chat draft. Attach a shorter note.");
    const next = await mutateWorkspace(target === "new" ? {type:"create-chat",projectId:null} : {type:"select-chat",id:target});
    const id = next.activeChatId;
    await mutateWorkspace({type:"save-draft",id,draft});
    setDrafts(old=>({...old,[id]:draft}));
    switchView("chat");setToast("Note added to draft. Nothing sent.");
  };
  const openEvidence = (href) => run(async () => {
    const match = /^#evidence-([a-f0-9-]{36})-(E[0-9]+)$/.exec(href || "");
    const job = match && jobs.find(j => j.id === match[1] && (j.chatId === activeChat?.id || j.children.some(c => c.chatId === activeChat?.id)));
    if (!job) throw new Error("This evidence link does not belong to the current investigation.");
    const records = await api["investigation-evidence"]({id: job.id});
    const record = records.find(e => e.id === match[2]);
    if (!record) throw new Error("The cited evidence was not found. Treat this citation as unverified.");
    setEvidenceFocus(record);
  });
  return (
    <ErrorContext.Provider value={error || workspace?.storageError || ""}>
      <div className={`app ${sidebar ? "" : "sidebar-collapsed"}`}>
        {sidebar && (
          <aside className="sidebar">
            <div className="brand">
              <span className="brand-symbol">
                <Terminal size={22} />
              </span>
              <div>
                <strong>Beacon</strong>
              </div>
              <IconButton
                label="Collapse sidebar"
                onClick={() => setSidebar(false)}
              >
                <PanelLeftClose size={17} />
              </IconButton>
            </div>
            <button
              className="new-chat"
              onClick={() => newChat()}
              disabled={!workspace}
            >
              <Plus size={17} />
              New chat
            </button>
            <div className="sidebar-scroll">
              <nav aria-label="Workspace">
                {[
                  ["chat", MessageSquare, "Claude"],
                  ["library", BookOpen, "API library"],
                  ["notes", NotebookPen, "Notes"],
                ].map(([id, Icon, label]) => (
                  <React.Fragment key={id}>
                    <button
                      aria-current={view === id ? "page" : undefined}
                      className={view === id ? "active" : ""}
                      onClick={() => switchView(id)}
                    >
                      <Icon size={18} />
                      {label}
                      {id === "library" && (
                        <span className="nav-count">
                          {library ? library.operations.length : "0"}
                        </span>
                      )}
                    </button>
                    {id === "chat" && (
                      <ChatNavigation
                        workspace={workspace}
                        activeId={view === "chat" ? activeChat?.id : null}
                        pendingId={pendingTurn?.chatId}
                        onSelect={selectChat}
                        onCreate={newChat}
                        onManage={setChatDialog}
                        disabled={loading}
                      />
                    )}
                  </React.Fragment>
                ))}
              </nav>
              <div className="sidebar-links">
                <p className="eyebrow">REFERENCES</p>
                {links.map(([label, url]) => (
                  <button
                    key={url}
                    onClick={() => run(() => api["open-link"](url))}
                  >
                    {label}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            </div>
            <div className="sidebar-bottom">
              <UsageBadge data={usageData} settings={settings} onClick={()=>openSettings("Usage")}/>
              <div className="connection-dot">
                <span className={connection.imported ? "connected" : ""} />
                {connection.imported
                  ? "Credential imported"
                  : "Claude not connected"}
              </div>
              <button
                className="profile-button"
                aria-label="Settings"
                title="Settings"
                onClick={() => openSettings("Appearance")}
              >
                <span className="avatar">
                  {settings.name ? settings.name[0].toUpperCase() : "U"}
                </span>
                <span>
                  <strong>{settings.name || "Your profile"}</strong>
                  <small>Settings & connection</small>
                </span>
                <Settings size={18} />
              </button>
            </div>
          </aside>
        )}
        <main>
          <header className="topbar">
            <div>
              {!sidebar && (
                <IconButton
                  label="Open sidebar"
                  onClick={() => setSidebar(true)}
                >
                  <Menu size={19} />
                </IconButton>
              )}
              <span>Workspace</span>
              <ChevronRight size={13} />
              <strong>
                {view === "chat"
                  ? "Claude"
                  : view === "library"
                    ? "API library"
                    : "Notes"}
              </strong>
            </div>
            <div className="topbar-access">
              {installedModules.filter(m => m.enabled).map(m => <ModuleAccess key={m.id} module={m} compact refresh={refreshInvestigations} run={run} />)}
              <span className="local-label">
                <ShieldCheck size={14} />
                {desktop ? "Cases: read-only" : "Browser preview"}
              </span>
            </div>
          </header>
          {(error || workspace?.storageError) && (
            <div role="alert" className="error-banner">
              <span>{error || workspace.storageError}</span>
              <IconButton label="Dismiss error" onClick={() => setError("")}>
                <X size={17} />
              </IconButton>
            </div>
          )}
          {!loading && notes && <div hidden={view !== "notes"} className="notes-surface"><Notes data={notes} onAction={notesAction} onAttach={attachNote} Modal={Modal} chats={workspace?.chats || []}/></div>}
          {loading ? (
            <div className="loading">Opening workspace...</div>
          ) : view === "library" ? (
            <Library {...{ library, setLibrary, run }} />
          ) : view === "notes" ? null : (
            <section className="chat-page">
              <div className="chat-header">
                <div>
                  <h1>{activeChat?.title || "New chat"}</h1>
                  <p>
                    {activeProject && (
                      <>
                        <span>{activeProject.name}</span>
                        <span className="separator"> / </span>
                      </>
                    )}
                    {PROVIDER.model} <span className="separator">/</span> Google
                    Vertex
                  </p>
                </div>
                <div className="actions">
                  <span className="badge neutral">
                    {messages.length / 2} turns
                  </span>
                  <IconButton
                    label="Export conversation"
                    disabled={!messages.length}
                    onClick={exportChat}
                  >
                    <Download size={17} />
                  </IconButton>
                </div>
              </div>
              <Investigations jobs={jobs} chatId={activeChat?.id} selectChat={selectChat} run={run} refresh={refreshInvestigations} Modal={Modal} />
              <div className="conversation" aria-live="polite">
                {!messages.length && !pending ? (
                  <div className="chat-start">
                    <span className="workspace-mark">
                      <MessageSquare size={29} strokeWidth={1.5} />
                    </span>
                    <p className="eyebrow">
                      {settings.name
                        ? `HELLO, ${settings.name.toUpperCase()}`
                        : "YOUR WORKSPACE"}
                    </p>
                    <h2>What are we working on?</h2>
                    <div className="prompt-grid">
                      {quickPrompts.map(({ icon: Icon, title, text }) => (
                        <button key={title} onClick={() => setInput(text)}>
                          <Icon size={21} />
                          <strong>{title}</strong>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    </div>
                    {!connection.imported && (
                      <div className="connect-notice">
                        <Server size={18} />
                        <span>Claude connection pending</span>
                        <button
                          className="text-link"
                          onClick={() => setShowSettings(true)}
                        >
                          Set up <ChevronRight size={14} />
                        </button>
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="message-list">
                    {messages.map((m, i) => (
                      <article key={i} className={`message ${m.role}`}>
                        <header>
                          <span className={`message-avatar ${m.role}`}>
                            {m.role === "user" ? (
                              (settings.name[0] || "Y").toUpperCase()
                            ) : (
                              <MessageSquare size={15} />
                            )}
                          </span>
                          <strong>
                            {m.role === "user"
                              ? settings.name || "You"
                              : "Claude"}
                          </strong>
                          <IconButton
                            label={`Copy ${m.role === "user" ? "your message" : "Claude response"} ${Math.floor(i / 2) + 1}`}
                            onClick={() => copy(m.content)}
                          >
                            <Copy size={14} />
                          </IconButton>
                        </header>
                        <div className="message-content">
                          <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: ({ href, children }) =>
                                /^#evidence-[a-f0-9-]{36}-E[0-9]+$/.test(href || "") ? (
                                  <button className="text-link" onClick={() => openEvidence(href)}>{children}</button>
                                ) : safeLink(href) ? (
                                  <button
                                    className="text-link"
                                    onClick={() =>
                                      run(() => api["open-link"](href))
                                    }
                                  >
                                    {children}
                                  </button>
                                ) : (
                                  <span>
                                    {children} ({href})
                                  </span>
                                ),
                              img: () => <span>[Remote image omitted]</span>,
                            }}
                          >
                            {m.content}
                          </ReactMarkdown>
                        </div>
                        {m.truncated && (
                          <p className="error-inline">
                            Response reached its output limit.
                          </p>
                        )}
                      </article>
                    ))}
                    {pending && (
                      <>
                        <article className="message user">
                          <header>
                            <strong>{settings.name || "You"}</strong>
                          </header>
                          <p className="preserve">{pending}</p>
                        </article>
                        <div className="thinking">
                          <span />
                          Waiting for Claude...
                        </div>
                      </>
                    )}
                    <div ref={endRef} />
                  </div>
                )}
              </div>
              <div className="composer-wrap">
                {busy && pendingTurn && !pending && (
                  <div className="notice">
                    <span>Another chat is responding</span>
                    <button
                      className="text-link"
                      type="button"
                      onClick={() => selectChat(pendingTurn.chatId)}
                    >
                      View response <ChevronRight size={14} />
                    </button>
                  </div>
                )}
                {activeChat?.error && (
                  <p role="alert" className="error-inline">
                    {activeChat.error}
                  </p>
                )}
                <form className="composer" onSubmit={send}>
                  <textarea
                    aria-label="Message Claude"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    rows="3"
                    maxLength="40000"
                    placeholder={
                      connection.imported
                        ? "Message Claude..."
                        : "Connect your own Claude access in Settings to begin..."
                    }
                    disabled={Boolean(pending) || !activeChat}
                    onKeyDown={(e) => {
                      if (!shouldSendOnEnter(e, settings.enterBehavior)) return;
                      e.preventDefault();
                      if (!e.repeat) void send();
                    }}
                  />
                  <div className="composer-bottom">
                    <span>
                      {input.length.toLocaleString()} / 40,000
                    </span>
                    {busy ? (
                      <IconButton
                        type="button"
                        label="Stop response"
                        onClick={() => {
                          cancelledSend.current = true;
                          run(() => api.cancel());
                        }}
                      >
                        <Square size={18} />
                      </IconButton>
                    ) : (
                      <IconButton
                        type="submit"
                        className="send-button"
                        label="Send message"
                        disabled={
                          !input.trim() ||
                          !connection.imported ||
                          !settings.name ||
                          busy ||
                          !activeChat ||
                          Boolean(pending)
                        }
                      >
                        <Send size={18} />
                      </IconButton>
                    )}
                  </div>
                </form>
                <div className="composer-meta">
                  <span>
                    Sent to your Google Vertex project. Review responses
                    before use.
                  </span>
                  <span role="status">
                    {draftSaves
                      ? "Saving draft..."
                      : draftError || workspace?.storageError
                        ? "Not saved"
                        : workspace
                          ? "Saved locally"
                          : ""}
                  </span>
                  {usage && (
                    <span>
                      Total tokens: {usage.input.toLocaleString()} in /{" "}
                      {usage.output.toLocaleString()} out
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}
        </main>
        {evidenceFocus && <Modal title={`Evidence ${evidenceFocus.id}`} onClose={() => setEvidenceFocus(null)}>
          <div className="modal-body evidence-view"><p>{evidenceFocus.source}</p><p>Collected: {evidenceFocus.collectedAt}</p><pre>{evidenceFocus.text}</pre></div>
        </Modal>}
        {showSettings && (
          <SettingsPanel
            key={settingsTab}
            {...{ settings, connection, setConnection, run, busy, desktop }}
            initialTab={settingsTab}
            usageData={usageData}
            onTutorial={replayTutorial}
            onContinueTutorial={()=>{setShowSettings(false);setShowTutorial(true);}}
            onResetTutorial={()=>{safeSave({...settings,tutorialStatus:"new",tutorialStep:0});setToast("Tutorial progress reset");}}
            onSave={safeSave}
            onClose={() => setShowSettings(false)}
          />
        )}
        {showTutorial && !showWelcome && !showSettings && <QuickStart settings={settings} onSave={safeSave} onClose={()=>setShowTutorial(false)} Modal={Modal} onOpen={target=>{
          setShowTutorial(false);
          if (["chat","notes"].includes(target)) switchView(target);
          else openSettings(target);
        }}/>}
        {showWelcome && !loading && (
          <Modal title="Set up your workspace" className="welcome-modal">
            <div className="setup-progress">
              <span className={setupStep === 1 ? "current" : ""}>
                1 <span>Your profile</span>
              </span>
              <span className={setupStep === 2 ? "current" : ""}>
                2 <span>Claude access</span>
              </span>
            </div>
            <div className="modal-body">
              {setupStep === 1 ? (
                <>
                  <h3>Welcome to Beacon</h3>
                  <label className="field">
                    Your name
                    <input
                      autoFocus
                      maxLength="80"
                      placeholder="First and last name"
                      value={setupName}
                      onChange={(e) => setSetupName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && setupName.trim()) {
                          void run(async () => {
                            await saveSettings({
                              ...settings,
                              name: setupName.trim(),
                            });
                            setSetupStep(2);
                          });
                        }
                      }}
                    />
                  </label>
                  <p className="muted">This profile stays on your device.</p>
                </>
              ) : (
                <Connection {...{ connection, setConnection, run, busy }} />
              )}
            </div>
            <footer>
              {setupStep === 1 ? (
                <button
                  className="primary"
                  disabled={!setupName.trim()}
                  onClick={() =>
                    run(async () => {
                      await saveSettings({
                        ...settings,
                        name: setupName.trim(),
                      });
                      setSetupStep(2);
                    })
                  }
                >
                  Continue
                  <ChevronRight size={16} />
                </button>
              ) : (
                <>
                  <button onClick={() => setSetupStep(1)}>Back</button>
                  <button
                    className="primary"
                    onClick={() =>
                      run(async () => {
                        await saveSettings({ ...settings, onboarded: true });
                        setShowWelcome(false);
                        if (settings.tutorialStatus === "new") setShowTutorial(true);
                      })
                    }
                  >
                    {connection.imported
                      ? "Open workspace"
                      : "Set up Claude later"}
                  </button>
                </>
              )}
            </footer>
          </Modal>
        )}
        {chatDialog && workspace && (
          <ChatDialog
            key={`${chatDialog.kind}-${chatDialog.item?.id || "new"}`}
            dialog={chatDialog}
            workspace={workspace}
            pendingId={pendingTurn?.chatId}
            Modal={Modal}
            run={run}
            onAction={mutateWorkspace}
            onManage={setChatDialog}
            onClose={() => setChatDialog(null)}
          />
        )}
        {toast && (
          <div role="status" className="toast">
            <Check size={16} />
            {toast}
          </div>
        )}
      </div>
    </ErrorContext.Provider>
  );
}
