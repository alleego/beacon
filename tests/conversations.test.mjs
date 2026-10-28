import test from "node:test";
import assert from "node:assert/strict";
import {
  newWorkspace,
  validateWorkspace,
  changeWorkspace,
  beginTurn,
  finishTurn,
  recoverWorkspace,
  findChat,
} from "../shared/conversations.mjs";
import {
  createConversationStore,
  sendConversation,
} from "../electron/conversations.mjs";

const answer = (text = "Synthetic response") => ({
  text,
  usage: { input: 3, output: 4 },
  truncated: false,
});
function fixture(saved = null) {
  let disk = saved;
  let fail = false;
  const storage = {
    read: async () => structuredClone(disk),
    write: async (value) => {
      if (fail) throw new Error("Disk unavailable");
      disk = structuredClone(value);
    },
  };
  return {
    store: createConversationStore(storage),
    storage,
    disk: () => disk,
    fail: (value) => {
      fail = value;
    },
  };
}

test("projects organize chats without changing their drafts or messages", () => {
  let s = newWorkspace();
  const first = s.activeChatId;
  s = changeWorkspace(s, { type: "create-project", name: "Storage investigation" });
  const project = s.projects[0].id;
  s = changeWorkspace(s, {
    type: "save-draft",
    id: first,
    draft: "Unsent local evidence",
  });
  s = changeWorkspace(s, {
    type: "edit-chat",
    id: first,
    name: "Storage health",
    projectId: project,
  });
  s = changeWorkspace(s, { type: "create-chat", projectId: project });
  assert.equal(s.chats.length, 2);
  assert.equal(findChat(s, first).draft, "Unsent local evidence");
  assert.equal(findChat(s, s.activeChatId).draft, "");
  s = changeWorkspace(s, { type: "rename-project", id: project, name: "Storage" });
  s = changeWorkspace(s, { type: "delete-project", id: project });
  assert.equal(s.projects.length, 0);
  assert.equal(s.chats.length, 2);
  assert.ok(s.chats.every((c) => c.projectId === null));
  s = changeWorkspace(s, { type: "delete-chat", id: first });
  s = changeWorkspace(s, { type: "delete-chat", id: s.activeChatId });
  assert.equal(s.chats.length, 1);
  assert.equal(s.chats[0].title, "New chat");
});

test("pending replies stay with their originating chat after selection, rename and folder changes", async () => {
  const { store } = fixture();
  let s = await store.snapshot();
  const first = s.activeChatId;
  await store.action({ type: "create-project", name: "Storage" });
  let release;
  let started;
  const ready = new Promise((resolve) => {
    started = resolve;
  });
  const response = sendConversation(
    store,
    { chatId: first, content: "First question" },
    async (messages) => {
      assert.deepEqual(messages, [{ role: "user", content: "First question" }]);
      started();
      await new Promise((resolve) => {
        release = resolve;
      });
      return answer();
    },
  );
  await ready;
  await assert.rejects(
    store.action({ type: "delete-chat", id: first }),
    /Stop/,
  );
  await assert.rejects(
    store.action({ type: "save-draft", id: first, draft: "overwrite" }),
    /Wait/,
  );
  await assert.rejects(
    sendConversation(store, { chatId: first, content: "Duplicate" }, async () =>
      answer(),
    ),
    /already running/,
  );
  s = await store.action({ type: "create-chat" });
  const second = s.activeChatId;
  await store.action({
    type: "save-draft",
    id: second,
    draft: "Separate draft",
  });
  await store.action({
    type: "edit-chat",
    id: first,
    name: "Original",
    projectId: s.projects[0].id,
  });
  release();
  s = await response;
  assert.equal(s.activeChatId, second);
  assert.equal(findChat(s, second).draft, "Separate draft");
  assert.equal(findChat(s, second).messages.length, 0);
  assert.equal(findChat(s, first).messages[1].content, "Synthetic response");
  assert.equal(findChat(s, first).title, "Original");
  assert.equal(findChat(s, first).projectId, s.projects[0].id);
});

test("provider context includes only the chosen chat, even in a shared project", async () => {
  const { store } = fixture();
  let s = await store.snapshot();
  const first = s.activeChatId;
  s = await store.action({ type: "create-project", name: "Shared folder" });
  const projectId = s.projects[0].id;
  await store.action({ type: "move-chat", id: first, projectId });
  await sendConversation(
    store,
    { chatId: first, content: "ALPHA evidence" },
    async () => answer("ALPHA answer"),
  );
  s = await store.action({ type: "create-chat", projectId });
  const second = s.activeChatId;
  await sendConversation(
    store,
    { chatId: second, content: "BETA evidence" },
    async (messages) => {
      assert.deepEqual(messages, [{ role: "user", content: "BETA evidence" }]);
      return answer("BETA answer");
    },
  );
  await sendConversation(
    store,
    { chatId: first, content: "ALPHA followup" },
    async (messages) => {
      assert.deepEqual(
        messages.map((m) => m.content),
        ["ALPHA evidence", "ALPHA answer", "ALPHA followup"],
      );
      assert.ok(!JSON.stringify(messages).includes("BETA"));
      return answer();
    },
  );
});

test("failures, cancellation and app interruption restore drafts without retries", async () => {
  const { store, storage } = fixture();
  const first = (await store.snapshot()).activeChatId;
  let calls = 0;
  const s = await sendConversation(
    store,
    { chatId: first, content: "Keep my question" },
    async () => {
      calls++;
      throw new Error("Request cancelled. Nothing was retried.");
    },
  );
  assert.equal(calls, 1);
  assert.equal(findChat(s, first).messages.length, 0);
  assert.equal(findChat(s, first).draft, "Keep my question");
  assert.match(findChat(s, first).error, /cancelled/);
  await store.begin({ chatId: first, content: "Interrupted question" });
  const reopened = createConversationStore(storage);
  const restored = findChat(await reopened.snapshot(), first);
  assert.equal(restored.pending, null);
  assert.equal(restored.draft, "Interrupted question");
  assert.match(restored.error, /interrupted/);
});

test("serialized saves persist the latest draft and survive reopening", async () => {
  const { store, storage } = fixture();
  const first = (await store.snapshot()).activeChatId;
  await Promise.all(
    ["a", "ab", "abc"].map((draft) =>
      store.action({ type: "save-draft", id: first, draft }),
    ),
  );
  const restored = await createConversationStore(storage).snapshot();
  assert.equal(findChat(restored, first).draft, "abc");
  assert.equal(restored.revision, 3);
});

test("failed storage never triggers a billable request or silently discards a completed reply", async () => {
  const f = fixture();
  const first = (await f.store.snapshot()).activeChatId;
  f.fail(true);
  let calls = 0;
  await assert.rejects(
    sendConversation(
      f.store,
      { chatId: first, content: "No storage" },
      async () => {
        calls++;
        return answer();
      },
    ),
    /Disk/,
  );
  assert.equal(calls, 0);
  f.fail(false);
  const result = await sendConversation(
    f.store,
    { chatId: first, content: "Save result" },
    async () => {
      calls++;
      f.fail(true);
      return answer("Keep this reply");
    },
  );
  assert.equal(calls, 1);
  assert.match(result.storageError, /only in memory/);
  assert.equal(findChat(result, first).messages[1].content, "Keep this reply");
  f.fail(false);
  const saved = await f.store.action({
    type: "rename-chat",
    id: first,
    name: "Saved now",
  });
  assert.equal(saved.storageError, "");
  assert.equal(
    findChat(f.disk(), first).messages[1].content,
    "Keep this reply",
  );
});

test("invalid actions, names, references and corrupt archives cannot overwrite valid state", async () => {
  const f = fixture();
  const s = await f.store.snapshot();
  for (const action of [
    { type: "complete", response: answer() },
    { type: "rename-chat", id: s.activeChatId, name: " " },
    { type: "create-project", name: "x".repeat(81) },
    { type: "move-chat", id: s.activeChatId, projectId: "missing" },
    { type: "save-draft", id: s.activeChatId, draft: "x".repeat(40001) },
    { type: "select-chat", id: "missing" },
  ])
    await assert.rejects(f.store.action(action));
  assert.equal((await f.store.snapshot()).revision, 0);
  const broken = { ...newWorkspace(), schemaVersion: 999 };
  const damaged = fixture(broken);
  await assert.rejects(damaged.store.snapshot(), /not been overwritten/);
  assert.deepEqual(damaged.disk(), broken);
  const badRef = newWorkspace();
  badRef.chats[0].projectId = "missing";
  assert.throws(() => validateWorkspace(badRef));
});

test("context limits are checked before sending and manually renamed titles are retained", () => {
  let s = newWorkspace();
  const id = s.activeChatId;
  s = changeWorkspace(s, { type: "rename-chat", id, name: "My title" });
  for (let i = 0; i < 12; i++)
    s = finishTurn(
      beginTurn(s, { chatId: id, content: `Question ${i}` }),
      id,
      answer(),
    );
  assert.equal(findChat(s, id).title, "My title");
  assert.throws(
    () => beginTurn(s, { chatId: id, content: "One more" }),
    /context limit/,
  );
  assert.equal(recoverWorkspace(s), s);
});

test("storage reserves space for a reply before starting a model request", () => {
  const s = newWorkspace();
  const base = s.chats[0];
  const content = "x".repeat(100000);
  s.chats.push(...Array.from({ length: 330 }, (_, i) => ({ ...base, id: `archive-${i}`, messages: [{ role: "user", content: "Archived question" }, { role: "assistant", content }] })));
  validateWorkspace(s);
  assert.throws(() => beginTurn(s, { chatId: base.id, content: "New question" }), /nearly full/);
  assert.equal(base.pending, null);
});
