import { getSchema } from "@tiptap/core";
import { noteExtensions } from "./note-editor.mjs";
import { safeLink } from "./domain.mjs";

const schema = getSchema(noteExtensions());
export const MAX_NOTES_BYTES = 32 * 1024 * 1024;
export function plainDocument(text = "") {
  return {
    type: "doc",
    content: text
      .split("\n")
      .map((line) => ({
        type: "paragraph",
        ...(line ? { content: [{ type: "text", text: line }] } : {}),
      })),
  };
}
function cleanDocument(doc) {
  if (!doc || JSON.stringify(doc).length > 600000)
    throw new Error("This note is too large.");
  let count = 0;
  function inspect(node, depth = 0) {
    if (!node || typeof node !== "object" || depth > 40 || ++count > 30000)
      throw new Error("Invalid note formatting.");
    for (const mark of node.marks || []) {
      if (mark.type === "link" && !safeLink(mark.attrs?.href))
        throw new Error(
          "Notes links must use HTTPS without embedded credentials.",
        );
    }
    for (const child of node.content || []) inspect(child, depth + 1);
  }
  inspect(doc);
  const parsed = schema.nodeFromJSON(doc);
  if (parsed.type.name !== "doc") throw new Error("Invalid note document.");
  parsed.check();
  const body = parsed.textBetween(0, parsed.content.size, "\n");
  if (body.length > 200000)
    throw new Error("Keep each note under 200,000 characters.");
  return { doc: parsed.toJSON(), body };
}
export function newNotes(legacy = [], now = new Date().toISOString()) {
  if (!Array.isArray(legacy))
    throw new Error("The old notebook could not be read. It was not changed.");
  return validateNotes({
    schemaVersion: 1,
    revision: 0,
    folders: [],
    notes: legacy.map((n) => {
      if (
        typeof n.body !== "string" ||
        typeof n.title !== "string" ||
        typeof n.id !== "string"
      )
        throw new Error(
          "The old notebook contains an invalid note. It was not changed.",
        );
      return {
        id: n.id,
        title: n.title,
        ...cleanDocument(plainDocument(n.body)),
        folderId: null,
        pinned: false,
        deletedAt: null,
        createdAt: n.updatedAt || now,
        updatedAt: n.updatedAt || now,
        legacy: { source: n.source || "", status: n.status || "" },
      };
    }),
  });
}
export function validateNotes(state) {
  if (
    !state ||
    state.schemaVersion !== 1 ||
    !Number.isSafeInteger(state.revision) ||
    state.revision < 0 ||
    !Array.isArray(state.folders) ||
    !Array.isArray(state.notes) ||
    state.notes.length > 2000 ||
    state.folders.length > 200 ||
    JSON.stringify(state).length > MAX_NOTES_BYTES
  )
    throw new Error(
      "Notes storage is invalid or full. Original data was not changed.",
    );
  const ids = new Set();
  for (const item of [...state.folders, ...state.notes]) {
    if (!item || typeof item.id !== "string" || ids.has(item.id))
      throw new Error("Invalid note identifier.");
    ids.add(item.id);
  }
  for (const folder of state.folders)
    if (
      typeof folder.name !== "string" ||
      !folder.name.trim() ||
      folder.name.length > 80
    )
      throw new Error("Folder name must be 1 to 80 characters.");
  for (const note of state.notes) {
    if (
      typeof note.title !== "string" ||
      note.title.length > 160 ||
      !Number.isFinite(Date.parse(note.updatedAt)) ||
      !Number.isFinite(Date.parse(note.createdAt)) ||
      (note.deletedAt !== null &&
        !Number.isFinite(Date.parse(note.deletedAt))) ||
      typeof note.pinned !== "boolean" ||
      (note.folderId !== null &&
        !state.folders.some((f) => f.id === note.folderId))
    )
      throw new Error("Invalid saved note.");
    const clean = cleanDocument(note.doc);
    if (
      note.legacy &&
      (typeof note.legacy.source !== "string" ||
        typeof note.legacy.status !== "string")
    )
      throw new Error("Invalid original notebook details.");
    if (note.body !== clean.body)
      throw new Error("Note text does not match its document.");
  }
  return state;
}
export function changeNotes(state, action, now = new Date().toISOString()) {
  const next = structuredClone(state);
  const note = () => {
    const n = next.notes.find((n) => n.id === action.id);
    if (!n) throw new Error("Note not found.");
    return n;
  };
  const folder = () => {
    const f = next.folders.find((f) => f.id === action.id);
    if (!f) throw new Error("Folder not found.");
    return f;
  };
  const targetFolder = (id) => {
    if (id !== null && !next.folders.some((f) => f.id === id))
      throw new Error("Folder not found.");
    return id;
  };
  switch (action?.type) {
    case "create-note":
      next.notes.unshift({
        id: crypto.randomUUID(),
        title: "",
        ...cleanDocument(plainDocument()),
        folderId: targetFolder(action.folderId || null),
        pinned: false,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      break;
    case "save-note": {
      const n = note();
      if (n.deletedAt) throw new Error("Restore this note before editing.");
      if (typeof action.title !== "string")
        throw new Error("Invalid note title.");
      Object.assign(n, {
        title: action.title,
        ...cleanDocument(action.doc),
        updatedAt: now,
      });
      break;
    }
    case "pin-note":
      note().pinned = Boolean(action.pinned);
      break;
    case "move-note":
      note().folderId = targetFolder(action.folderId);
      break;
    case "trash-note":
      note().deletedAt = now;
      break;
    case "restore-note":
      note().deletedAt = null;
      break;
    case "delete-note":
      if (!note().deletedAt) throw new Error("Move the note to Trash first.");
      next.notes = next.notes.filter((n) => n.id !== action.id);
      break;
    case "create-folder":
      next.folders.push({ id: crypto.randomUUID(), name: action.name?.trim() });
      break;
    case "rename-folder":
      folder().name = action.name?.trim();
      break;
    case "delete-folder":
      folder();
      next.folders = next.folders.filter((f) => f.id !== action.id);
      next.notes.forEach((n) => {
        if (n.folderId === action.id) n.folderId = null;
      });
      break;
    default:
      throw new Error("Unknown notes action.");
  }
  next.revision++;
  return validateNotes(next);
}
