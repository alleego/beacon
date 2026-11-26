import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url),
  root = path.resolve("."),
  out = path.join(root, "test-results");
await fs.mkdir(out, { recursive: true });
const data = await fs.mkdtemp(path.join(out, "upgrade-profile-"));
const legacy = [
  {
    id: "old-note",
    title: "Original note",
    body: "Preserved notebook content",
    source: "https://example.org/reference",
    status: "verified",
    updatedAt: "2026-10-01T10:00:00Z",
  },
];
await fs.writeFile(path.join(data, "notes.json"), JSON.stringify(legacy));
const env = {
  ...process.env,
  WORK_TEAM_TEST_DATA: data,
  WORK_TEAM_TEST_HIDDEN: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
let app, page;
const errors = [];
const launch = async () => {
  app = await electron.launch({
    executablePath: require("electron"),
    args: [root],
    cwd: root,
    env,
    timeout: 60000,
  });
  page = await app.firstWindow();
  page.on("pageerror", (e) => errors.push(e.message));
};
const close = async () => {
  await app.evaluate(({ app }) => {
    setTimeout(() => app.exit(0), 50);
  });
  await app.close();
  app = null;
};
const snapshot = () => page.evaluate(() => window.workTeam.notes());
const saved = async (text) =>
  page.waitForFunction(
    async (text) =>
      (await window.workTeam.notes()).notes.some((n) => n.body.includes(text)),
    text,
  );
const screenshot = async (name) => {
  await page.waitForTimeout(200);
  const bytes = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage())
      .toPNG()
      .toString("base64"),
  );
  await fs.writeFile(path.join(out, name), Buffer.from(bytes, "base64"));
};
try {
  await launch();
  await page.getByLabel("Your name", { exact: true }).fill("Upgrade Reviewer");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Set up Claude later", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Quick start", exact: true })
    .waitFor();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  assert.equal((await snapshot()).notes[0].body, "Preserved notebook content");
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await page.getByLabel("Folder name", { exact: true }).fill("My notes");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page
    .getByRole("button", { name: "New note", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Note title", { exact: true })
    .fill("Release checklist");
  await page
    .getByLabel("Note body", { exact: true })
    .fill("Synthetic note for the new editor.");
  await saved("Synthetic note");
  const state = await snapshot(),
    note = state.notes.find((n) => n.title === "Release checklist");
  assert.notEqual(note.id,"old-note");
  assert.equal(state.notes.find(n=>n.id==="old-note").title,"Original note");
  await page
    .getByLabel("Note folder", { exact: true })
    .selectOption(state.folders[0].id);
  await page.getByRole("button", { name: "Pin note", exact: true }).click();
  await page.getByLabel("Note body", { exact: true }).press("Control+End");
  await page.getByLabel("Note body", { exact: true }).press("Enter");
  await page.getByRole("button", { name: "Checklist", exact: true }).click();
  await page
    .getByLabel("Note body", { exact: true })
    .pressSequentially("Review changes");
  await saved("Review changes");
  await page.waitForFunction(async () =>
    JSON.stringify((await window.workTeam.notes()).notes).includes("taskList"),
  );
  await screenshot("beacon-0.4-notes-desktop.png");
  await page
    .getByRole("button", { name: "Attach note to chat", exact: true })
    .click();
  await page.getByRole("button", { name: "Add to draft", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message Claude", exact: true })
    .waitFor();
  assert.match(
    await page
      .getByRole("textbox", { name: "Message Claude", exact: true })
      .inputValue(),
    /Review changes/,
  );
  const ws = await page.evaluate(() => window.workTeam.workspace());
  assert.equal(
    ws.chats.find((c) => c.id === ws.activeChatId).messages.length,
    0,
  );
  await page.getByRole("button", { name: "Notes", exact: true }).click();
  await page
    .getByRole("button", { name: "Move note to Trash", exact: true })
    .click();
  await page.getByRole("button", { name: "Trash", exact: true }).click();
  await page.getByRole("button", { name: "Restore", exact: true }).click();
  await page.getByRole("button", { name: "All notes", exact: true }).click();
  await page.getByLabel("Search notes", { exact: true }).fill("Release");
  await page.getByRole("button", { name: /Release checklist/ }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await screenshot("beacon-0.4-notes-mobile.png");
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await page
    .getByRole("button", { name: "Usage details", exact: true })
    .click();
  await page
    .getByLabel("Reporting period", { exact: true })
    .selectOption("custom");
  await page.getByLabel("From", { exact: true }).fill("2026-11-01");
  await page.getByLabel("Through", { exact: true }).fill("2026-11-25");
  await page.getByRole("tab", { name: "Behavior", exact: true }).click();
  await page.getByLabel("Enter key", { exact: true }).selectOption("send");
  await page
    .getByRole("button", { name: "Reset tutorial progress", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Replay quick start", exact: true })
    .click();
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await page.getByRole("button", { name: "Skip", exact: true }).click();
  const before = await page.evaluate(() => window.workTeam.bootstrap());
  assert.equal(before.settings.tutorialStatus, "dismissed");
  assert.equal(before.settings.name, "Upgrade Reviewer");
  assert.ok((await snapshot()).notes.find((n) => n.id === note.id));
  const encrypted = await fs.readFile(path.join(data, "notes.encrypted"));
  assert.equal(encrypted.includes(Buffer.from("Synthetic note")), false);
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(data, "notes.json"), "utf8")),
    legacy,
  );
  await close();
  await launch();
  await page.getByRole("button", { name: "Notes", exact: true }).waitFor();
  const restored = await page.evaluate(() => window.workTeam.bootstrap());
  assert.equal(restored.settings.enterBehavior, "send");
  assert.equal(restored.settings.usagePeriod, "custom");
  assert.equal(
    restored.notes.notes.find((n) => n.id === note.id).deletedAt,
    null,
  );
  assert.ok(restored.notes.notes.find((n) => n.id === note.id).pinned);
  assert.equal(
    await page
      .getByRole("dialog", { name: "Quick start", exact: true })
      .count(),
    0,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Upgrade UI passed: legacy notes preserved, encrypted notes, folders, autosave, formatting, pin, Trash/restore, explicit draft attachment, settings, guide skip/replay/reset, restart persistence, narrow layout. No live model/SSH requests.",
  );
} catch (error) {
  console.error("Page errors:", errors);
  console.error("Visible dialog:", await page.locator("dialog[open]").innerText().catch(()=>"none"));
  throw error;
} finally {
  if (app) await close();
}
