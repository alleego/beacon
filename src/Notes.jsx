import React, { useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import {
  Plus,
  Folder,
  FolderPlus,
  FileText,
  Search,
  Pin,
  Trash2,
  Undo2,
  Redo2,
  Bold,
  Italic,
  Heading2,
  List,
  ListOrdered,
  ListChecks,
  Code2,
  Link,
  Unlink,
  Paperclip,
  MoreHorizontal,
  ArrowLeft,
  Copy,
  Save,
} from "lucide-react";
import { noteExtensions } from "../shared/note-editor.mjs";
import { safeLink } from "../shared/domain.mjs";
import { api } from "./bridge";

function Tool({ label, active, children, ...props }) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      aria-pressed={active}
      {...props}
    >
      {children}
    </button>
  );
}
function NoteEditor({
  note,
  folders,
  onAction,
  onAttach,
  onBack,
  Modal,
  chats,
  storageError,
}) {
  const [title, setTitle] = useState(note.title);
  const titleRef = useRef(note.title);
  const [saving, setSaving] = useState(0);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(null);
  const [link, setLink] = useState("");
  const [target, setTarget] = useState("new");
  const sequence = useRef(0);
  const persist = async (doc, name = titleRef.current) => {
    const seq = ++sequence.current;
    setSaving((n) => n + 1);
    try {
      const result = await onAction({
        type: "save-note",
        id: note.id,
        title: name,
        doc,
      });
      if (seq === sequence.current) setError("");
      return result;
    } catch (e) {
      setError(e.message);
      throw e;
    } finally {
      setSaving((n) => n - 1);
    }
  };
  const editor = useEditor(
    {
      extensions: noteExtensions(),
      content: note.doc,
      editable: !note.deletedAt,
      shouldRerenderOnTransaction: true,
      editorProps: {
        attributes: {
          "aria-label": "Note body",
          role: "textbox",
          "aria-multiline": "true",
        },
      },
      onUpdate: ({ editor }) => {
        void persist(editor.getJSON()).catch(() => {});
      },
    },
    [note.id],
  );
  const action = async (a) => {
    try {
      await onAction(a);
      setError("");
    } catch (e) {
      setError(e.message);
    }
  };
  return (
    <section className="notes-editor">
      <header className="notes-editor-header">
        <Tool label="Back to notes" onClick={onBack}>
          <ArrowLeft size={18} />
        </Tool>
        <span className="note-save-status" role="status">
          {saving
            ? "Saving..."
            : error || storageError
              ? "Not saved to disk"
              : "Saved"}
        </span>
        {!note.deletedAt && (
          <>
            <Tool
              label={note.pinned ? "Unpin note" : "Pin note"}
              active={note.pinned}
              onClick={() =>
                action({ type: "pin-note", id: note.id, pinned: !note.pinned })
              }
            >
              <Pin size={17} />
            </Tool>
            <Tool
              label="Attach note to chat"
              onClick={() => setDialog("attach")}
              disabled={saving > 0 || Boolean(error || storageError)}
            >
              <Paperclip size={17} />
            </Tool>
            <Tool
              label="Move note to Trash"
              onClick={() => action({ type: "trash-note", id: note.id })}
              disabled={saving > 0}
            >
              <Trash2 size={17} />
            </Tool>
          </>
        )}
        {note.deletedAt && (
          <>
            <button
              onClick={() => action({ type: "restore-note", id: note.id })}
            >
              <Undo2 size={16} />
              Restore
            </button>
            <Tool
              label="Delete note permanently"
              onClick={() => setDialog("delete")}
            >
              <Trash2 size={17} />
            </Tool>
          </>
        )}
      </header>
      {(error || storageError) && (
        <div role="alert" className="error-banner">
          <span>{error || storageError}</span>
          <Tool
            label="Retry saving note"
            onClick={() => persist(editor.getJSON()).catch(() => {})}
          >
            <Save size={16} />
          </Tool>
          <Tool
            label="Copy unsaved note"
            onClick={() =>
              api
                .copy(`${titleRef.current}\n\n${editor.getText()}`)
                .catch((e) => setError(e.message))
            }
          >
            <Copy size={16} />
          </Tool>
        </div>
      )}
      <div className="note-heading">
        <input
          aria-label="Note title"
          placeholder="Untitled note"
          maxLength={160}
          readOnly={Boolean(note.deletedAt)}
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            titleRef.current = e.target.value;
            void persist(editor.getJSON(), e.target.value).catch(() => {});
          }}
        />
        <select
          aria-label="Note folder"
          value={note.folderId || ""}
          disabled={Boolean(note.deletedAt)}
          onChange={(e) =>
            action({
              type: "move-note",
              id: note.id,
              folderId: e.target.value || null,
            })
          }
        >
          <option value="">Unfiled</option>
          {folders.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </div>
      {editor && !note.deletedAt && (
        <div
          className="note-toolbar"
          role="toolbar"
          aria-label="Note formatting"
        >
          {[
            [
              "Bold",
              Bold,
              "bold",
              () => editor.chain().focus().toggleBold().run(),
            ],
            [
              "Italic",
              Italic,
              "italic",
              () => editor.chain().focus().toggleItalic().run(),
            ],
            [
              "Heading",
              Heading2,
              "heading",
              () => editor.chain().focus().toggleHeading({ level: 2 }).run(),
            ],
            [
              "Bulleted list",
              List,
              "bulletList",
              () => editor.chain().focus().toggleBulletList().run(),
            ],
            [
              "Numbered list",
              ListOrdered,
              "orderedList",
              () => editor.chain().focus().toggleOrderedList().run(),
            ],
            [
              "Checklist",
              ListChecks,
              "taskList",
              () => editor.chain().focus().toggleTaskList().run(),
            ],
            [
              "Code block",
              Code2,
              "codeBlock",
              () => editor.chain().focus().toggleCodeBlock().run(),
            ],
          ].map(([label, Icon, type, handler]) => (
            <Tool
              key={label}
              label={label}
              active={editor.isActive(type)}
              onClick={handler}
            >
              <Icon size={17} />
            </Tool>
          ))}
          <Tool
            label="Add link"
            active={editor.isActive("link")}
            onClick={() => {
              setLink(editor.getAttributes("link").href || "");
              setDialog("link");
            }}
          >
            <Link size={17} />
          </Tool>
          <Tool
            label="Remove link"
            disabled={!editor.isActive("link")}
            onClick={() => editor.chain().focus().unsetLink().run()}
          >
            <Unlink size={17} />
          </Tool>
          <Tool
            label="Undo"
            disabled={!editor.can().undo()}
            onClick={() => editor.chain().focus().undo().run()}
          >
            <Undo2 size={17} />
          </Tool>
          <Tool
            label="Redo"
            disabled={!editor.can().redo()}
            onClick={() => editor.chain().focus().redo().run()}
          >
            <Redo2 size={17} />
          </Tool>
        </div>
      )}
      <div className="note-body-scroll">
        <EditorContent editor={editor} />
        {(note.legacy?.source || note.legacy?.status) && (
          <details className="legacy-note">
            <summary>Original notebook details</summary>
            {note.legacy.source && <p>{note.legacy.source}</p>}
            {note.legacy.status && <p>{note.legacy.status}</p>}
          </details>
        )}
      </div>
      {dialog === "link" && (
        <Modal title="Link" onClose={() => setDialog(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (safeLink(link)) {
                editor
                  .chain()
                  .focus()
                  .extendMarkRange("link")
                  .setLink({ href: link })
                  .run();
                setDialog(null);
              }
            }}
          >
            <div className="modal-body">
              <label className="field">
                HTTPS URL
                <input
                  autoFocus
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  type="url"
                />
              </label>
            </div>
            <footer>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="primary" disabled={!safeLink(link)}>
                Apply
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {dialog === "delete" && (
        <Modal
          title="Delete this note permanently?"
          onClose={() => setDialog(null)}
        >
          <div className="modal-body">
            <p>This cannot be undone.</p>
          </div>
          <footer>
            <button onClick={() => setDialog(null)}>Cancel</button>
            <button
              className="primary"
              onClick={() => {
                setDialog(null);
                void action({ type: "delete-note", id: note.id });
              }}
            >
              Delete permanently
            </button>
          </footer>
        </Modal>
      )}
      {dialog === "attach" && (
        <Modal title="Attach note to chat" onClose={() => setDialog(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await persist(editor.getJSON());
                await onAttach(
                  {
                    ...note,
                    title: titleRef.current,
                    body: editor.getText({ blockSeparator: "\n" }),
                  },
                  target,
                );
                setDialog(null);
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <div className="modal-body">
              <label className="field">
                Chat
                <select
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                >
                  <option value="new">New chat</option>
                  {chats
                    .filter((c) => !c.pending)
                    .map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                </select>
              </label>
              <p className="muted">
                A text snapshot will be added to the draft. Nothing is sent
                until you send that message.
              </p>
            </div>
            <footer>
              <button type="button" onClick={() => setDialog(null)}>
                Cancel
              </button>
              <button className="primary" disabled={saving > 0}>
                Add to draft
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </section>
  );
}

export default function Notes({ data, onAction, onAttach, Modal, chats }) {
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState(null);
  const [folderDialog, setFolderDialog] = useState(null);
  const [folderName, setFolderName] = useState("");
  const [error, setError] = useState("");
  const [showEditor, setShowEditor] = useState(false);
  const [creating, setCreating] = useState(false);
  if (!data) return null;
  const list = data.notes
    .filter(
      (n) =>
        (filter === "trash" ? Boolean(n.deletedAt) : !n.deletedAt) &&
        (filter === "all" ||
          filter === "trash" ||
          (filter === "pinned" ? n.pinned : n.folderId === filter)) &&
        `${n.title}\n${n.body}`
          .toLocaleLowerCase()
          .includes(search.toLocaleLowerCase()),
    )
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const note = list.find((n) => n.id === selected) || list[0];
  const change = async (action) => {
    try {
      const result = await onAction(action);
      setError("");
      return result;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  };
  const create = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const next = await change({
        type: "create-note",
        folderId: data.folders.some((f) => f.id === filter) ? filter : null,
      });
      setSearch("");
      if (["trash", "pinned"].includes(filter)) setFilter("all");
      setSelected(next.notes[0].id);
      setShowEditor(true);
    } catch {} finally { setCreating(false); }
  };
  const folderModal = (f) => {
    setFolderName(f?.name || "");
    setFolderDialog(f || { id: null });
  };
  return (
    <div className={`notes-page ${showEditor ? "show-note-editor" : ""}`}>
      <aside className="notes-folders" aria-label="Note folders">
        <header>
          <h1>Notes</h1>
          <Tool label="New folder" onClick={() => folderModal(null)}>
            <FolderPlus size={18} />
          </Tool>
        </header>
        {[
          ["all", "All notes", FileText],
          ["pinned", "Pinned", Pin],
          ["trash", "Trash", Trash2],
        ].map(([id, label, Icon]) => (
          <button
            key={id}
            className={filter === id ? "selected" : ""}
            onClick={() => {
              setFilter(id);
              setShowEditor(false);
            }}
          >
            <Icon size={16} />
            <span>{label}</span>
          </button>
        ))}
        <hr />
        {data.folders.map((f) => (
          <div className="notes-folder-row" key={f.id}>
            <button
              title={f.name}
              className={filter === f.id ? "selected" : ""}
              onClick={() => {
                setFilter(f.id);
                setShowEditor(false);
              }}
            >
              <Folder size={16} />
              <span>{f.name}</span>
            </button>
            <Tool
              label={`Folder options: ${f.name}`}
              onClick={() => folderModal(f)}
            >
              <MoreHorizontal size={16} />
            </Tool>
          </div>
        ))}
      </aside>
      <section className="notes-list-panel" aria-label="Notes list">
        <header>
          <strong>
            {filter === "all"
              ? "All notes"
              : filter === "pinned"
                ? "Pinned"
                : filter === "trash"
                  ? "Trash"
                  : data.folders.find((f) => f.id === filter)?.name}
          </strong>
          <Tool label="New note" onClick={create} disabled={creating}>
            <Plus size={19} />
          </Tool>
        </header>
        <label className="notes-search">
          <Search size={16} />
          <input
            aria-label="Search notes"
            placeholder="Search notes"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {error && (
          <p role="alert" className="error-inline">
            {error}
          </p>
        )}
        <div className="notes-list">
          {list.map((n) => (
            <button
              key={n.id}
              className={note?.id === n.id ? "selected" : ""}
              onClick={() => {
                setSelected(n.id);
                setShowEditor(true);
              }}
            >
              <strong>
                {n.pinned && <Pin size={12} />} {n.title || "Untitled note"}
              </strong>
              <span>{n.body.trim().slice(0, 100) || "Empty note"}</span>
              <small>{new Date(n.updatedAt).toLocaleDateString()}</small>
            </button>
          ))}
          {!list.length && (
            <p className="muted notes-empty">
              {search
                ? "No matching notes"
                : filter === "trash"
                  ? "Trash is empty"
                  : "No notes yet"}
            </p>
          )}
        </div>
      </section>
      {creating ? <div className="notes-empty-editor" role="status">Creating note...</div> : note ? (
        <NoteEditor
          key={`${note.id}-${Boolean(note.deletedAt)}`}
          note={note}
          folders={data.folders}
          onAction={change}
          onAttach={onAttach}
          onBack={() => setShowEditor(false)}
          Modal={Modal}
          chats={chats}
          storageError={data.storageError}
        />
      ) : (
        <div className="notes-empty-editor">
          <FileText size={32} />
          <button onClick={create}>
            <Plus size={16} />
            New note
          </button>
        </div>
      )}
      {folderDialog && (
        <Modal
          title={folderDialog.id ? "Folder" : "New folder"}
          onClose={() => setFolderDialog(null)}
        >
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              try {
                await change({
                  type: folderDialog.id ? "rename-folder" : "create-folder",
                  id: folderDialog.id,
                  name: folderName,
                });
                setFolderDialog(null);
              } catch {}
            }}
          >
            <div className="modal-body">
              <label className="field">
                Folder name
                <input
                  autoFocus
                  maxLength={80}
                  value={folderName}
                  onChange={(e) => setFolderName(e.target.value)}
                />
              </label>
              {folderDialog.id && (
                <p className="muted">
                  Removing this folder keeps its notes in All notes.
                </p>
              )}
            </div>
            <footer>
              {folderDialog.id && (
                <Tool
                  label="Remove folder and keep notes"
                  onClick={async () => {
                    try {
                      await change({
                        type: "delete-folder",
                        id: folderDialog.id,
                      });
                      setFilter("all");
                      setFolderDialog(null);
                    } catch {}
                  }}
                >
                  <Trash2 size={17} />
                </Tool>
              )}
              <button type="button" onClick={() => setFolderDialog(null)}>
                Cancel
              </button>
              <button className="primary" disabled={!folderName.trim()}>
                Save
              </button>
            </footer>
          </form>
        </Modal>
      )}
    </div>
  );
}
