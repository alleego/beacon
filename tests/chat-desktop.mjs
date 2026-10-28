import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";

const require = createRequire(import.meta.url);
const root = path.resolve(".");
const output = path.join(root, "test-results");
await fs.mkdir(output, { recursive: true });
const data = await fs.mkdtemp(path.join(output, "chat-profile-"));
const env = {
  ...process.env,
  WORK_TEAM_TEST_DATA: data,
  WORK_TEAM_TEST_HIDDEN: "1",
};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () =>
  electron.launch({
    executablePath: require("electron"),
    args: [root],
    cwd: root,
    env,
    timeout: 60000,
  });
let app;
// Test-only shutdown: a hidden Electron window can keep the debugger transport
// alive after a normal close. All asserted writes are awaited before exiting.
async function closeHiddenApp(instance) {
  await instance.evaluate(({app}) => { setTimeout(() => app.exit(0), 50); }).catch(() => {});
  await instance.close();
}
async function capture(page, options) {
  const visible = await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0]?.isVisible());
  if (visible) await page.screenshot(options);
}

let page;
const state = () => page.evaluate(() => window.workTeam.workspace());
const saveDraft = async (draft) => {
  const activeId = (await state()).activeChatId;
  // The IPC write may finish before React has switched the composer to that chat.
  await page.waitForFunction(id => document.querySelector(".chat-row.selected")?.dataset.chatId === id, activeId);
  await page
    .getByRole("textbox", { name: "Message Claude", exact: true })
    .fill(draft);
  await page.waitForFunction(async (text) => {
    const s = await window.workTeam.workspace();
    return s.chats.find((c) => c.id === s.activeChatId)?.draft === text;
  }, draft);
};
const options = () =>
  page
    .locator(".chat-row.selected")
    .getByRole("button", { name: /^Chat options:/ })
    .click();
const renameChat = async (name, projectId) => {
  await options();
  await page.getByLabel("Chat name", { exact: true }).fill(name);
  if (projectId !== undefined)
    await page.getByLabel("Project", { exact: true }).selectOption(projectId);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
};
const openChat = async (name) => {
  await page.getByRole("button", { name: `Open chat: ${name}`, exact: true }).click();
  await page.getByRole("heading", { name, exact: true }).waitFor();
};
const createProject = async (name) => {
  await page.getByRole("button", { name: "New project", exact: true }).click();
  await page.getByLabel("Project name", { exact: true }).fill(name);
  await page
    .getByRole("button", { name: "Create project", exact: true })
    .click();
  await page
    .getByRole("button", { name: `Project: ${name}`, exact: true })
    .waitFor();
};
const waitDone = async () => {
  await page.waitForFunction(
    () => !document.querySelector('[aria-label="Response in progress"]'),
  );
};

try {
  app = await launch();
  page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByLabel("Your name", { exact: true }).fill("Test Reviewer");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Set up Claude later", exact: true })
    .click();
  await createProject("Storage review");
  const projectId = (await state()).projects[0].id;
  await page
    .getByRole("button", { name: "New chat in Storage review", exact: true })
    .click();
  await page.waitForFunction(async (id) => {
    const s = await window.workTeam.workspace();
    return s.chats.find((c) => c.id === s.activeChatId)?.projectId === id;
  }, projectId);
  const alpha = (await state()).activeChatId;
  await saveDraft("ALPHA draft evidence");
  await renameChat("Disk investigation");
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await page.getByRole("heading", { name: "New chat", exact: true }).waitFor();
  const beta = (await state()).activeChatId;
  assert.notEqual(alpha, beta);
  await saveDraft("BETA draft evidence");
  await renameChat("Filesystem follow-up", projectId);
  await page.getByLabel("Search chats and projects").fill("ALPHA draft");
  await page
    .getByRole("button", { name: "Open chat: Disk investigation", exact: true })
    .waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "Open chat: Filesystem follow-up", exact: true })
      .count(),
    0,
  );
  await page.getByLabel("Search chats and projects").fill("");
  await createProject("Storage lab");

  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  const keyFile = path.join(data, "synthetic-credential.json");
  await fs.writeFile(
    keyFile,
    JSON.stringify({
      type: "service_account",
      project_id: "beacon-test-project",
      client_email: "test@beacon-test-project.iam.gserviceaccount.com",
      private_key: privateKey,
      token_uri: "https://oauth2.googleapis.com/token",
    }),
  );
  await app.evaluate(({ dialog }, keyFile) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [keyFile],
    });
  }, keyFile);
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Connection", exact: true }).click();
  await page
    .getByRole("button", { name: "Import credential", exact: true })
    .click();
  await page.getByText("Imported, not tested", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  // Only this isolated test process has a synthetic transport; production code
  // has no fixture mode, model stub, or environment-variable network bypass.
  await app.evaluate(() => {
    globalThis.__providerRequests = [];
    globalThis.__holdReply = true;
    globalThis.fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (init.redirect !== "error" || init.method !== "POST")
        throw new Error("Unexpected test transport options");
      if (url === "https://oauth2.googleapis.com/token")
        return new Response(
          JSON.stringify({
            access_token: "synthetic-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          { headers: { "content-type": "application/json" } },
        );
      if (
        url !==
        "https://aiplatform.googleapis.com/v1/projects/beacon-test-project/locations/global/publishers/anthropic/models/claude-sonnet-4-6:rawPredict"
      )
        throw new Error("Unexpected network destination");
      globalThis.__providerRequests.push(JSON.parse(init.body).messages);
      const count = globalThis.__providerRequests.length;
      if (globalThis.__holdReply)
        await new Promise((resolve, reject) => {
          const abort = () => reject(new DOMException("Aborted", "AbortError"));
          init.signal.addEventListener("abort", abort, { once: true });
          globalThis.__releaseReply = () => {
            init.signal.removeEventListener("abort", abort);
            resolve();
          };
        });
      return new Response(
        JSON.stringify({
          id: `msg_test_${count}`,
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: `Synthetic reply ${count}` }],
          stop_reason: "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 3, output_tokens: 4 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    };
  });
  await openChat("Disk investigation");
  assert.equal(
    await page.getByRole("textbox", { name: "Message Claude" }).inputValue(),
    "ALPHA draft evidence",
  );
  await saveDraft("ALPHA question");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Waiting for Claude...", { exact: true }).waitFor();
  await openChat("Filesystem follow-up");
  assert.equal(
    await page.getByRole("textbox", { name: "Message Claude" }).inputValue(),
    "BETA draft evidence",
  );
  await page
    .getByRole("button", {
      name: "Chat options: Disk investigation",
      exact: true,
    })
    .click();
  assert.equal(
    await page
      .getByRole("button", { name: "Delete chat", exact: true })
      .isEnabled(),
    false,
  );
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await app.evaluate(() => {
    globalThis.__holdReply = false;
    globalThis.__releaseReply();
  });
  await waitDone();
  let saved = await state();
  assert.equal(saved.activeChatId, beta);
  assert.equal(saved.chats.find((c) => c.id === beta).messages.length, 0);
  assert.equal(
    saved.chats.find((c) => c.id === alpha).messages[1].content,
    "Synthetic reply 1",
  );
  await saveDraft("BETA question");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Synthetic reply 2", { exact: true }).waitFor();
  await openChat("Disk investigation");
  await saveDraft("ALPHA followup");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Synthetic reply 3", { exact: true }).waitFor();
  const requests = await app.evaluate(() => globalThis.__providerRequests);
  assert.deepEqual(
    requests.map((messages) => messages.map((m) => m.content)),
    [
      ["ALPHA question"],
      ["BETA question"],
      ["ALPHA question", "Synthetic reply 1", "ALPHA followup"],
    ],
  );
  await app.evaluate(() => {
    globalThis.__holdReply = true;
  });
  await saveDraft("Keep after cancellation");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await page.getByText("Waiting for Claude...", { exact: true }).waitFor();
  await page
    .getByRole("button", { name: "Stop response", exact: true })
    .click();
  await waitDone();
  await page
    .getByText("Request cancelled. Nothing was retried.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Message Claude" }).inputValue(),
    "Keep after cancellation",
  );
  const ciphertext = await fs.readFile(
    path.join(data, "conversations.encrypted"),
  );
  for (const value of [
    "ALPHA",
    "BETA",
    "Storage review",
    "Keep after cancellation",
    "Synthetic reply",
  ])
    assert.equal(ciphertext.includes(Buffer.from(value)), false);
  await closeHiddenApp(app);
  app = null;
  app = await launch();
  page = await app.firstWindow();
  await page
    .getByRole("heading", { name: "Disk investigation", exact: true })
    .waitFor();
  await page.getByText("Synthetic reply 3", { exact: true }).waitFor();
  assert.equal(
    await page.getByRole("textbox", { name: "Message Claude" }).inputValue(),
    "Keep after cancellation",
  );
  assert.equal((await state()).projects.length, 2);
  await page
    .getByRole("button", { name: "Project options: Storage review", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete project", exact: true })
    .click();
  await page
    .getByText(
      'Delete the "Storage review" folder? Its chats will be kept under Chats.',
      { exact: true },
    )
    .waitFor();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  saved = await state();
  assert.equal(saved.chats.length, 3);
  assert.ok(saved.chats.every((c) => c.projectId === null));
  await page
    .getByRole("button", { name: "Project options: Storage lab", exact: true })
    .click();
  await page.getByLabel("Project name", { exact: true }).fill("Storage review");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  const remainingProject = (await state()).projects[0].id;
  await renameChat("Disk investigation", remainingProject);
  await openChat("Filesystem follow-up");
  await options();
  await page.getByRole("button", { name: "Delete chat", exact: true }).click();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.ok((await state()).chats.some((c) => c.id === beta));
  await options();
  await page.getByRole("button", { name: "Delete chat", exact: true }).click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(
    (await state()).chats.some((c) => c.id === beta),
    false,
  );
  await openChat("Disk investigation");
  await saveDraft("Compare the Disk findings");
  await capture(page, {
    path: path.join(output, "beacon-chats-desktop.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await capture(page, {
    path: path.join(output, "beacon-chats-mobile-sidebar.png"),
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await capture(page, { path: path.join(output, "beacon-chats-mobile.png") });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Text size", { exact: true }).fill("20");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await capture(page, {
    path: path.join(output, "beacon-chats-mobile-large.png"),
  });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth,
    ),
    false,
  );
  assert.deepEqual(errors, []);
  console.log(
    "Chat desktop tests passed: project/chat CRUD, move/search, draft persistence, encrypted history, restart, live-reply switching, isolated contexts, cancellation and confirmation gates. All provider responses were synthetic; no network or real credentials used.",
  );
} catch (error) {
  if (page && !page.isClosed()) {
    console.error("Synthetic test workspace:", await state().catch(() => null));
    await capture(page, { path: path.join(output, "chat-test-failure.png") }).catch(() => {});
  }
  throw error;
} finally {
  if (app) await closeHiddenApp(app);
}
