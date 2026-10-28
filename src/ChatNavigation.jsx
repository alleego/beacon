import React, { useEffect, useState } from "react";
import {
  Search,
  Folder,
  FolderOpen,
  FolderPlus,
  Plus,
  MoreHorizontal,
  MessageSquare,
  ChevronRight,
  Trash2,
} from "lucide-react";

function Tool({ label, children, ...props }) {
  return (
    <button
      type="button"
      className="icon-button"
      title={label}
      aria-label={label}
      {...props}
    >
      {children}
    </button>
  );
}

export default function ChatNavigation({
  workspace,
  activeId,
  pendingId,
  onSelect,
  onCreate,
  onManage,
  disabled,
}) {
  const [query, setQuery] = useState("");
  const [closed, setClosed] = useState([]);
  const activeProject = workspace?.chats.find(
    (c) => c.id === activeId,
  )?.projectId;
  useEffect(() => {
    if (activeProject)
      setClosed((ids) => ids.filter((id) => id !== activeProject));
  }, [activeId, activeProject]);
  if (!workspace) return null;
  const q = query.trim().toLowerCase();
  const matches = (c) =>
    !q ||
    `${c.title} ${c.draft} ${c.messages.map((m) => m.content).join(" ")}`
      .toLowerCase()
      .includes(q);
  const ordered = [...workspace.chats].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const row = (chat) => (
    <div
      className={`chat-row ${chat.parentChatId ? "specialist-chat" : ""} ${activeId === chat.id ? "selected" : ""}`}
      data-chat-id={chat.id}
      key={chat.id}
    >
      <button
        type="button"
        className="chat-select"
        aria-label={`Open chat: ${chat.title}`}
        aria-current={activeId === chat.id ? "page" : undefined}
        title={chat.title}
        disabled={disabled}
        onClick={() => onSelect(chat.id)}
      >
        <MessageSquare size={14} />
        <span>{chat.title}</span>
        {(chat.pending || pendingId === chat.id) && (
          <span className="response-dot" aria-label="Response in progress" />
        )}
      </button>
      <Tool
        label={`Chat options: ${chat.title}`}
        disabled={disabled}
        onClick={() => onManage({ kind: "edit-chat", item: chat })}
      >
        <MoreHorizontal size={16} />
      </Tool>
    </div>
  );
  const projects = workspace.projects
    .map((project) => {
      const projectMatches = q && project.name.toLowerCase().includes(q);
      const chats = ordered.filter(
        (c) => c.projectId === project.id && (projectMatches || matches(c)),
      );
      if (q && !projectMatches && !chats.length) return null;
      const open = Boolean(q) || !closed.includes(project.id);
      return (
        <section className="chat-project" key={project.id}>
          <div className="project-row">
            <button
              type="button"
              className="project-toggle"
              aria-label={`Project: ${project.name}`}
              aria-expanded={open}
              title={project.name}
              onClick={() =>
                setClosed((ids) =>
                  open
                    ? [...ids, project.id]
                    : ids.filter((id) => id !== project.id),
                )
              }
            >
              {open ? <FolderOpen size={15} /> : <Folder size={15} />}
              <span>{project.name}</span>
              <ChevronRight size={13} className={open ? "expanded" : ""} />
            </button>
            <Tool
              label={`New chat in ${project.name}`}
              disabled={disabled}
              onClick={() => onCreate(project.id)}
            >
              <Plus size={15} />
            </Tool>
            <Tool
              label={`Project options: ${project.name}`}
              disabled={disabled}
              onClick={() => onManage({ kind: "edit-project", item: project })}
            >
              <MoreHorizontal size={15} />
            </Tool>
          </div>
          {open && (
            <div className="project-chats">
              {chats.map(row)}
              {!chats.length && <p className="chat-empty">No chats</p>}
            </div>
          )}
        </section>
      );
    })
    .filter(Boolean);
  const recent = ordered.filter((c) => c.projectId === null && matches(c));
  return (
    <div className="chat-navigation">
      <label className="chat-search">
        <Search size={14} />
        <input
          aria-label="Search chats and projects"
          placeholder="Search chats"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </label>
      <div className="chat-group-heading">
        <span>Projects</span>
        <Tool
          label="New project"
          disabled={disabled}
          onClick={() => onManage({ kind: "create-project" })}
        >
          <FolderPlus size={16} />
        </Tool>
      </div>
      {projects}
      {!projects.length && (
        <p className="chat-empty">
          {q ? "No matching projects" : "No projects yet"}
        </p>
      )}
      <div className="chat-group-heading">
        <span>Chats</span>
        <span className="muted">{recent.length}</span>
      </div>
      {recent.map(row)}
      {!recent.length && (
        <p className="chat-empty">
          {q ? "No matching chats" : "No ungrouped chats"}
        </p>
      )}
    </div>
  );
}

export function ChatDialog({
  dialog,
  workspace,
  pendingId,
  Modal,
  run,
  onAction,
  onManage,
  onClose,
}) {
  const { kind, item } = dialog;
  const [name, setName] = useState(item?.title || item?.name || "");
  const [projectId, setProjectId] = useState(item?.projectId || "");
  const [working, setWorking] = useState(false);
  const deleting = kind.startsWith("delete-");
  const isChat = kind.endsWith("chat");
  const title = {
    "create-project": "New project",
    "edit-project": "Project settings",
    "edit-chat": "Chat settings",
    "delete-chat": "Delete chat?",
    "delete-project": "Delete project?",
  }[kind];
  const submit = async (event) => {
    event.preventDefault();
    if (working) return;
    setWorking(true);
    await run(async () => {
      await onAction({
        type: kind === "edit-project" ? "rename-project" : kind,
        id: item?.id,
        name,
        projectId: projectId || null,
      });
      onClose();
    });
    setWorking(false);
  };
  return (
    <Modal title={title} onClose={working ? undefined : onClose}>
      <form onSubmit={submit}>
        <div className="modal-body">
          {deleting ? (
            <p>
              {isChat
                ? `Delete "${item.title}" and its saved messages and draft from this device? This cannot be undone.`
                : `Delete the "${item.name}" folder? Its chats will be kept under Chats.`}
            </p>
          ) : (
            <>
              <label className="field">
                {isChat ? "Chat name" : "Project name"}
                <input
                  autoFocus
                  required
                  maxLength={isChat ? 120 : 80}
                  value={name}
                  disabled={working}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              {isChat && (
                <label className="field">
                  Project
                  <select
                    aria-label="Project"
                    value={projectId}
                    disabled={working}
                    onChange={(e) => setProjectId(e.target.value)}
                  >
                    <option value="">No project</option>
                    {workspace.projects.map((p) => (
                      <option value={p.id} key={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </>
          )}
        </div>
        <footer>
          {!deleting && item && (
            <Tool
              label={isChat ? "Delete chat" : "Delete project"}
              disabled={
                working || (isChat && (item.pending || pendingId === item.id))
              }
              onClick={() =>
                onManage({
                  kind: isChat ? "delete-chat" : "delete-project",
                  item,
                })
              }
            >
              <Trash2 size={17} />
            </Tool>
          )}
          <button type="button" disabled={working} onClick={onClose}>
            Cancel
          </button>
          <button
            className="primary"
            type="submit"
            disabled={working || (!deleting && !name.trim())}
          >
            {working
              ? "Saving..."
              : deleting
                ? "Delete"
                : kind === "create-project"
                  ? "Create project"
                  : "Save"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
