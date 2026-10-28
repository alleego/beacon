import { validateMessages } from "./domain.mjs";

export const MAX_WORKSPACE_BYTES = 32 * 1024 * 1024;
const stamp = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const text = (v, limit, blank = false) =>
  typeof v === "string" && v.length <= limit && (blank || v.trim().length > 0);
const validId = (id) => text(id, 100) && /^[\w-]+$/.test(id);
const date = (v) => typeof v === "string" && Number.isFinite(Date.parse(v));

export function newChat(projectId = null, now = stamp(), id = uid()) {
  return {
    id,
    projectId,
    title: "New chat",
    autoTitle: true,
    draft: "",
    messages: [],
    pending: null,
    error: "",
    usage: null,
    createdAt: now,
    updatedAt: now,
  };
}

export function newWorkspace() {
  const chat = newChat();
  return {
    schemaVersion: 1,
    revision: 0,
    projects: [],
    chats: [chat],
    activeChatId: chat.id,
  };
}

export function validateWorkspace(value) {
  const bad = () => {
    throw new Error(
      "The saved chats could not be read. The original file has not been overwritten.",
    );
  };
  if (
    !value ||
    value.schemaVersion !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    value.revision < 0 ||
    !Array.isArray(value.chats) ||
    !value.chats.length ||
    value.chats.length > 500 ||
    !Array.isArray(value.projects) ||
    value.projects.length > 100
  )
    bad();
  const projects = new Set();
  const chats = new Set();
  for (const p of value.projects) {
    if (
      !p ||
      !validId(p.id) ||
      projects.has(p.id) ||
      !text(p.name, 80) ||
      !date(p.createdAt)
    )
      bad();
    projects.add(p.id);
  }
  for (const c of value.chats) {
    if (
      !c ||
      !validId(c.id) ||
      chats.has(c.id) ||
      (c.projectId !== null && !projects.has(c.projectId)) ||
      !text(c.title, 120) ||
      typeof c.autoTitle !== "boolean" ||
      !text(c.draft, 40000, true) ||
      !text(c.error, 1000, true) ||
      !date(c.createdAt) ||
      !date(c.updatedAt) ||
      !Array.isArray(c.messages) ||
      c.messages.length > 24 ||
      c.messages.length % 2 !== 0
    )
      bad();
    if (
      c.messages.some(
        (m, i) =>
          !m ||
          m.role !== (i % 2 === 0 ? "user" : "assistant") ||
          !text(m.content, 100000) ||
          (m.truncated !== undefined && typeof m.truncated !== "boolean"),
      )
    )
      bad();
    if (
      c.pending !== null &&
      (!c.pending ||
        !text(c.pending.question, 40000) ||
        !date(c.pending.startedAt))
    )
      bad();
    if (
      c.usage !== null &&
      (!c.usage ||
        !Number.isSafeInteger(c.usage.input) ||
        c.usage.input < 0 ||
        !Number.isSafeInteger(c.usage.output) ||
        c.usage.output < 0)
    )
      bad();
    chats.add(c.id);
  }
  if (!chats.has(value.activeChatId)) bad();
  if (
    new TextEncoder().encode(JSON.stringify(value)).length > MAX_WORKSPACE_BYTES
  )
    throw new Error(
      "Local chat storage is full. Export and delete older chats before adding more.",
    );
  return value;
}

export function findChat(state, id) {
  const chat = state.chats.find((c) => c.id === id);
  if (!chat) throw new Error("This chat no longer exists.");
  return chat;
}

export function changeWorkspace(state, action) {
  const next = structuredClone(state);
  const now = stamp();
  const project = (id) => {
    const p = next.projects.find((p) => p.id === id);
    if (!p) throw new Error("This project no longer exists.");
    return p;
  };
  const title = (v, limit) => {
    if (!text(v, limit))
      throw new Error(`Enter a name of ${limit} characters or fewer.`);
    return v.trim();
  };
  switch (action?.type) {
    case "create-chat": {
      if (next.chats.length >= 500)
        throw new Error(
          "The limit is 500 chats. Export and delete older chats first.",
        );
      const projectId = action.projectId ?? null;
      if (projectId !== null) project(projectId);
      const chat = newChat(projectId, now);
      next.chats.unshift(chat);
      next.activeChatId = chat.id;
      break;
    }
    case "select-chat":
      next.activeChatId = findChat(next, action.id).id;
      break;
    case "save-draft": {
      const chat = findChat(next, action.id);
      if (chat.pending)
        throw new Error("Wait for this response before editing its draft.");
      if (!text(action.draft, 40000, true))
        throw new Error("Draft must be 40,000 characters or fewer.");
      chat.draft = action.draft;
      chat.error = "";
      break;
    }
    case "rename-chat": {
      const chat = findChat(next, action.id);
      chat.title = title(action.name, 120);
      chat.autoTitle = false;
      break;
    }
    case "edit-chat": {
      const chat = findChat(next, action.id);
      chat.title = title(action.name, 120);
      chat.autoTitle = false;
      if (action.projectId !== null) project(action.projectId);
      chat.projectId = action.projectId;
      break;
    }
    case "move-chat": {
      const chat = findChat(next, action.id);
      if (action.projectId !== null) project(action.projectId);
      chat.projectId = action.projectId;
      break;
    }
    case "delete-chat": {
      const chat = findChat(next, action.id);
      if (chat.pending)
        throw new Error("Stop the response before deleting this chat.");
      next.chats = next.chats.filter((c) => c.id !== chat.id);
      if (!next.chats.length) next.chats.push(newChat(null, now));
      if (next.activeChatId === chat.id) next.activeChatId = next.chats[0].id;
      break;
    }
    case "create-project":
      if (next.projects.length >= 100)
        throw new Error("The limit is 100 projects.");
      next.projects.push({
        id: uid(),
        name: title(action.name, 80),
        createdAt: now,
      });
      break;
    case "rename-project":
      project(action.id).name = title(action.name, 80);
      break;
    case "delete-project":
      project(action.id);
      next.projects = next.projects.filter((p) => p.id !== action.id);
      for (const chat of next.chats)
        if (chat.projectId === action.id) chat.projectId = null;
      break;
    default:
      throw new Error("Unknown local chat action.");
  }
  next.revision++;
  return validateWorkspace(next);
}

export function beginTurn(state, { chatId, content } = {}) {
  if (!text(content, 40000))
    throw new Error("Enter a message of 40,000 characters or fewer.");
  if (state.chats.some((c) => c.id === chatId && c.pending))
    throw new Error("A response is already running. Wait or stop it first.");
  const next = structuredClone(state);
  const chat = findChat(next, chatId);
  const question = content.trim();
  validateMessages([
    ...chat.messages.map(({ role, content }) => ({ role, content })),
    { role: "user", content: question },
  ]);
  chat.pending = { question, startedAt: stamp() };
  chat.error = "";
  chat.draft = "";
  if (chat.autoTitle) {
    chat.title = question.replace(/\s+/g, " ").slice(0, 80);
    chat.autoTitle = false;
  }
  chat.updatedAt = stamp();
  // Reserve room for the reply before making a billable request.
  if (new TextEncoder().encode(JSON.stringify(next)).length > MAX_WORKSPACE_BYTES - 1024 * 1024) {
    throw new Error("Local chat storage is nearly full. Export and delete older chats before sending another message.");
  }
  next.revision++;
  return validateWorkspace(next);
}

export function finishTurn(state, chatId, response, error = "") {
  const next = structuredClone(state);
  const chat = findChat(next, chatId);
  if (!chat.pending) throw new Error("This chat has no pending response.");
  if (error) {
    chat.draft = chat.pending.question;
    chat.error = error.slice(0, 1000);
  } else {
    if (!response || !text(response.text, 100000))
      throw new Error("Claude returned an invalid response.");
    chat.messages.push(
      { role: "user", content: chat.pending.question },
      {
        role: "assistant",
        content: response.text,
        truncated: Boolean(response.truncated),
      },
    );
    chat.usage = { input: (chat.usage?.input || 0) + (response.usage?.input || 0), output: (chat.usage?.output || 0) + (response.usage?.output || 0) };
    chat.error = "";
  }
  chat.pending = null;
  chat.updatedAt = stamp();
  next.revision++;
  return validateWorkspace(next);
}

export function recoverWorkspace(state) {
  let next = state;
  for (const c of state.chats)
    if (c.pending)
      next = finishTurn(
        next,
        c.id,
        null,
        "The previous response was interrupted. Your question is back in the draft; nothing was retried.",
      );
  return next;
}
