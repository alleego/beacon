import {
  DEFAULT_SETTINGS,
  PROVIDER,
  validateSettings,
  safeLink,
} from "../shared/domain.mjs";
import {
  newWorkspace,
  validateWorkspace,
  changeWorkspace,
} from "../shared/conversations.mjs";
const key = "work-team-preview-settings";
const notesKey = "work-team-preview-notes";
const chatsKey = "beacon-preview-chats";
const previewWorkspace = () => {
  const raw = localStorage.getItem(chatsKey);
  const state =
    raw === null ? newWorkspace() : validateWorkspace(JSON.parse(raw));
  if (raw === null) localStorage.setItem(chatsKey, JSON.stringify(state));
  return state;
};
const read = (k, fallback) => {
  try {
    return JSON.parse(localStorage.getItem(k)) || fallback;
  } catch {
    return fallback;
  }
};
const desktopOnly = () => {
  throw new Error(
    "Open the desktop app for this action. Credentials are never accepted by the browser preview.",
  );
};
const preview = {
  modules: async () => ({modules: [], jobs: []}),
  "module-import": desktopOnly,
  "module-import-unlock": desktopOnly,
  "module-import-cancel": async () => {},
  "module-configure": desktopOnly,
  "module-access-check": desktopOnly,
  "investigation-resume": desktopOnly,
  "investigation-source": desktopOnly,
  "investigation-stop": desktopOnly,
  "investigation-evidence": desktopOnly,
  "investigation-handoff": desktopOnly,
  bootstrap: async () => ({
    settings: read(key, DEFAULT_SETTINGS),
    connection: { imported: false },
    notes: read(notesKey, []),
    workspace: previewWorkspace(),
    provider: PROVIDER,
    desktop: false,
  }),
  "save-settings": async (s) => {
    const v = validateSettings(s);
    localStorage.setItem(key, JSON.stringify(v));
    return v;
  },
  library: async () => null,
  "import-spec": desktopOnly,
  "import-credential": desktopOnly,
  "remove-credential": desktopOnly,
  "test-connection": desktopOnly,
  chat: desktopOnly,
  workspace: async () => previewWorkspace(),
  "workspace-action": async (input) => {
    const next = changeWorkspace(previewWorkspace(), input);
    localStorage.setItem(chatsKey, JSON.stringify(next));
    return next;
  },
  cancel: async () => {},
  "save-note": async (n) => {
    const notes = read(notesKey, []);
    const note = {
      ...n,
      id: n.id || crypto.randomUUID(),
      updatedAt: new Date().toISOString(),
    };
    const next = n.id
      ? notes.map((v) => (v.id === n.id ? note : v))
      : [note, ...notes];
    localStorage.setItem(notesKey, JSON.stringify(next));
    return next;
  },
  "open-link": async (url) => {
    if (!safeLink(url)) throw new Error("Link is not approved.");
    window.open(url, "_blank", "noopener,noreferrer");
  },
  copy: (text) => navigator.clipboard.writeText(text),
  "export-chat": desktopOnly,
  "open-data": desktopOnly,
};
export const api = window.workTeam || preview;
