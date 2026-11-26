import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SETTINGS,
  validateSettings,
  shouldSendOnEnter,
} from "../shared/domain.mjs";
import {
  newNotes,
  changeNotes,
  validateNotes,
  plainDocument,
} from "../shared/notes.mjs";
import {
  newUsage,
  changeUsage,
  summarizeUsage,
  usageRange,
} from "../shared/usage.mjs";
import { createLocalArchive } from "../electron/local-archive.mjs";

test("Enter preference keeps newlines, modifier shortcuts, IME and repeat handling separate", () => {
  assert.equal(validateSettings({}).enterBehavior, "newline");
  const enter = { key: "Enter", nativeEvent: {} };
  assert.equal(Boolean(shouldSendOnEnter(enter, "newline")), false);
  assert.equal(shouldSendOnEnter({ ...enter, ctrlKey: true }, "newline"), true);
  assert.equal(shouldSendOnEnter({ ...enter, metaKey: true }, "newline"), true);
  assert.equal(shouldSendOnEnter(enter, "send"), true);
  for (const event of [
    { ...enter, shiftKey: true },
    { ...enter, altKey: true },
    { ...enter, nativeEvent: { isComposing: true } },
    { ...enter, nativeEvent: { keyCode: 229 } },
  ])
    assert.equal(Boolean(shouldSendOnEnter(event, "send")), false);
  assert.throws(() => validateSettings({ enterBehavior: "bad" }));
});
test("Tutorial reset only changes its flags", () => {
  const old = validateSettings({
    ...DEFAULT_SETTINGS,
    name: "Reviewer",
    onboarded: true,
    enterBehavior: "send",
    tutorialStatus: "complete",
    tutorialStep: 4,
  });
  const reset = validateSettings({
    ...old,
    tutorialStatus: "new",
    tutorialStep: 0,
  });
  assert.equal(reset.name, old.name);
  assert.equal(reset.onboarded, true);
  assert.equal(reset.enterBehavior, "send");
});
test("Legacy notebook migrates all text and references without changing its input", () => {
  const old = [
    {
      id: "old",
      title: "Original",
      body: "Line one\n\nLine three",
      source: "https://example.org/source",
      status: "hypothesis",
      updatedAt: "2026-10-01T10:00:00Z",
    },
  ];
  const copy = structuredClone(old),
    state = newNotes(old);
  assert.deepEqual(old, copy);
  assert.equal(state.notes[0].body, old[0].body);
  assert.deepEqual(state.notes[0].legacy, {
    source: old[0].source,
    status: "hypothesis",
  });
  assert.throws(() => newNotes([{ id: "broken" }]));
});
test("Notes support rich text, folders, pinning, Trash and restore", () => {
  let state = changeNotes(newNotes(), {
    type: "create-folder",
    name: "Examples",
  });
  const folderId = state.folders[0].id;
  state = changeNotes(state, { type: "create-note", folderId });
  const id = state.notes[0].id;
  const paragraph = {
    type: "paragraph",
    content: [{ type: "text", text: "Finished", marks: [{ type: "bold" }] }],
  };
  const task = {
    type: "taskItem",
    attrs: { checked: true },
    content: [paragraph],
  };
  const doc = {
    type: "doc",
    content: [
      {
        type: "heading",
        attrs: { level: 2 },
        content: [{ type: "text", text: "Heading" }],
      },
      { type: "taskList", content: [task] },
    ],
  };
  state = changeNotes(state, { type: "save-note", id, title: "Test", doc });
  assert.match(state.notes[0].body, /Finished/);
  assert.match(JSON.stringify(state.notes[0].doc), /bold/);
  state = changeNotes(state, { type: "pin-note", id, pinned: true });
  assert.equal(state.notes[0].pinned, true);
  state = changeNotes(state, { type: "delete-folder", id: folderId });
  assert.equal(state.notes[0].folderId, null);
  assert.throws(() => changeNotes(state, { type: "delete-note", id }));
  state = changeNotes(state, { type: "trash-note", id });
  assert.ok(state.notes[0].deletedAt);
  state = changeNotes(state, { type: "restore-note", id });
  assert.equal(state.notes[0].deletedAt, null);
  state = changeNotes(changeNotes(state, { type: "trash-note", id }), {
    type: "delete-note",
    id,
  });
  assert.equal(state.notes.length, 0);
});
test("Notes reject executable links, unexpected document nodes and bad archive content", () => {
  const s = changeNotes(newNotes(), { type: "create-note" }),
    id = s.notes[0].id;
  const doc = plainDocument("link");
  doc.content[0].content[0].marks = [
    { type: "link", attrs: { href: "javascript:alert(1)" } },
  ];
  assert.throws(() =>
    changeNotes(s, { type: "save-note", id, title: "Unsafe", doc }),
  );
  assert.throws(() =>
    changeNotes(s, {
      type: "save-note",
      id,
      title: "Image",
      doc: {
        type: "doc",
        content: [{ type: "image", attrs: { src: "https://example.org" } }],
      },
    }),
  );
  assert.throws(() =>
    validateNotes({ ...s, notes: [{ ...s.notes[0], body: "does not match" }] }),
  );
});
test("Serialized notes save/reopen and retain in-memory edits on disk failure", async () => {
  let disk = null,
    fail = false;
  const options = {
    read: async () => disk,
    write: async (s) => {
      if (fail) throw Error("disk");
      disk = structuredClone(s);
    },
    initial: () => newNotes(),
    validate: validateNotes,
    reduce: changeNotes,
  };
  const store = createLocalArchive(options);
  let state = await store.action({ type: "create-note" });
  const id = state.notes[0].id;
  const a = store.action({
    type: "save-note",
    id,
    title: "One",
    doc: plainDocument("first"),
  });
  const b = store.action({
    type: "save-note",
    id,
    title: "Two",
    doc: plainDocument("second"),
  });
  await a;
  await b;
  assert.equal(
    (await createLocalArchive(options).snapshot()).notes[0].body,
    "second",
  );
  fail = true;
  state = await store.action({
    type: "save-note",
    id,
    title: "Three",
    doc: plainDocument("retained"),
  });
  assert.ok(state.storageError);
  assert.equal(state.notes[0].body, "retained");
  assert.equal(disk.notes[0].body, "second");
  fail = false;
  state = await store.action({ type: "pin-note", id, pinned: true });
  assert.equal(state.storageError, "");
  assert.equal(disk.notes[0].body, "retained");
});
test("Usage counts each provider receipt once and keeps unknown interrupted calls", () => {
  let s = { ...newUsage(), startedAt: "2026-11-01T00:00:00.000Z" };
  s = changeUsage(s, {
    type: "begin",
    id: "one",
    kind: "chat",
    at: "2026-11-10T10:00:00Z",
  });
  const complete = {
    type: "finish",
    id: "one",
    usage: { input: 100, output: 25, cacheRead: 30, cacheWrite: 10 },
  };
  s = changeUsage(s, complete);
  s = changeUsage(s, complete);
  s = changeUsage(s, {
    type: "begin",
    id: "two",
    kind: "module",
    at: "2026-11-11T10:00:00Z",
  });
  s = changeUsage(s, { type: "recover" });
  const total = summarizeUsage(
    s,
    { usagePeriod: "month" },
    new Date(2026, 10, 25),
  );
  assert.equal(total.total, 165);
  assert.equal(total.requests, 1);
  assert.equal(total.unknown, 1);
  assert.equal(total.groups.module.unknown, 1);
});
test("Usage distinguishes calendar months, rolling days and inclusive custom end dates", () => {
  const now = new Date(2026, 10, 25, 12);
  const month = usageRange({ usagePeriod: "month" }, now);
  assert.equal(month.start.getDate(), 1);
  assert.equal(month.start.getMonth(), 10);
  const prev = usageRange({ usagePeriod: "previous" }, now);
  assert.equal(prev.start.getMonth(), 9);
  assert.equal(prev.end.getMonth(), 10);
  const rolling = usageRange({ usagePeriod: "14days" }, now);
  assert.equal(rolling.start.getDate(), 11);
  assert.equal(rolling.start.getHours(), 12);
  const custom = usageRange(
    { usagePeriod: "custom", usageFrom: "2026-11-01", usageTo: "2026-11-25" },
    now,
  );
  assert.equal(custom.end.getDate(), 26);
  assert.equal(
    usageRange(
      { usagePeriod: "custom", usageFrom: "2026-02-30", usageTo: "2026-03-05" },
      now,
    ),
    null,
  );
});
