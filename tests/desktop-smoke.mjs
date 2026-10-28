import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createServer } from "node:http";
const require = createRequire(import.meta.url);
const root = path.resolve(".");
const { version } = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8"),
);
const output = path.join(root, "test-results");
await fs.mkdir(output, { recursive: true });
const data = await fs.mkdtemp(path.join(output, "desktop-profile-"));
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

try {
  app = await launch();
  const page = await app.firstWindow();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.getByLabel("Your name", { exact: true }).fill("Test Reviewer");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page
    .getByRole("button", { name: "Set up Claude later", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "What are we working on?" })
    .waitFor();
  assert.equal(await page.title(), "Beacon");
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].getTitle(),
    ),
    "Beacon",
  );
  assert.equal(await app.evaluate(({ app }) => app.getPath("userData")), data);
  assert.equal(await page.locator(".brand strong").innerText(), "Beacon");
  assert.equal(
    await page.getByRole("button", { name: "Settings", exact: true }).count(),
    1,
  );
  assert.equal(
    await page
      .locator(".topbar")
      .getByRole("button", { name: "Settings", exact: true })
      .count(),
    0,
  );
  assert.equal(
    await page
      .locator("body")
      .innerText()
      .then(
        (text) =>
          /support workspace|Work Team/i.test(text) ||
          text.includes(`v${version}`),
      ),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .isEnabled(),
    false,
  );
  await capture(page, { path: path.join(output, "desktop-dark.png") });
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("tab", { name: "Local data", exact: true }).click();
  await page
    .getByText(`v${version} (local preview)`, { exact: true })
    .waitFor();
  await page.getByRole("tab", { name: "Appearance", exact: true }).click();
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.getByLabel("Font family").selectOption("sans");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "light");
  await page
    .getByRole("button", { name: "Learning notebook", exact: true })
    .click();
  await page.getByLabel("Title", { exact: true }).fill("Test-only observation");
  await page
    .getByLabel("Note", { exact: true })
    .fill("This is a synthetic local test, not customer information.");
  await page.getByRole("button", { name: "Save note", exact: true }).click();
  await page.getByText("Saved locally", { exact: true }).waitFor();
  await page.getByRole("button", { name: /^API library/ }).click();
  await page.getByText("Raw specification pending", { exact: true }).waitFor();
  const fixture = path.join(output, "test-only-openapi.json");
  await fs.writeFile(
    fixture,
    JSON.stringify({
      openapi: "3.0.3",
      info: { title: "TEST ONLY", version: "1" },
      paths: {
        "/test/cases": {
          post: { summary: "Create test case" },
          get: {
            summary: "Test response",
            tags: ["Test"],
            responses: {
              200: {
                description: "Test data",
                content: {
                  "application/json": {
                    schema: { $ref: "#/components/schemas/Case" },
                  },
                },
              },
            },
          },
        },
        "/test/sftp/token/reset": { get: { summary: "Reset test token" } },
      },
      components: {
        schemas: {
          Case: { type: "object", properties: { number: { type: "string" } } },
        },
      },
    }),
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, fixture);
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await page.getByText("TEST ONLY", { exact: true }).waitFor();
  await page
    .getByText("API library: offline reference. Live access off.", { exact: true })
    .waitFor();
  assert.equal(
    await page.getByRole("button", { name: /POST \/test\/cases/ }).count(),
    0,
  );
  assert.equal(
    await page.getByRole("button", { name: /GET \/test\/sftp/ }).count(),
    0,
  );
  await page.getByRole("button", { name: /GET \/test\/cases/ }).click();
  await page.getByText("Test response", { exact: true }).last().waitFor();
  await page.getByLabel("API access category").selectOption("blocked");
  await page.getByRole("button", { name: /POST \/test\/cases/ }).click();
  await page
    .getByText("Blocked: only reviewed GET requests may be enabled", {
      exact: true,
    })
    .waitFor();
  await page.getByRole("button", { name: /GET \/test\/sftp/ }).click();
  await page
    .getByText("Blocked: GET may change state or manage credentials", {
      exact: true,
    })
    .waitFor();
  await capture(page, { path: path.join(output, "api-read-only.png") });
  await page
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth > window.innerWidth,
    ),
    false,
  );
  await capture(page, {
    path: path.join(output, "api-read-only-mobile.png"),
  });
  await page.setViewportSize({ width: 1280, height: 850 });
  await page.getByRole("button", { name: "Open sidebar", exact: true }).click();
  assert.equal(
    (await page.evaluate(() => window.workTeam.library())).operations.length,
    3,
  );
  await page.getByRole("button", { name: "Schemas", exact: true }).click();
  await page.getByRole("button", { name: "Case", exact: true }).click();
  await page.getByRole("heading", { name: "Case", exact: true }).waitFor();
  assert.ok((await page.locator(".json-node").count()) > 0);
  await capture(page, { path: path.join(output, "api-import.png") });
  const bootstrap = await page.evaluate(() => window.workTeam.bootstrap());
  assert.equal(bootstrap.connection.imported, false);
  assert.equal(bootstrap.settings.name, "Test Reviewer");
  assert.equal(bootstrap.notes.length, 1);
  assert.equal(await page.evaluate(() => typeof window.require), "undefined");
  assert.equal(await page.evaluate(() => typeof window.process), "undefined");
  await assert.rejects(
    () =>
      page.evaluate(() => window.workTeam["open-link"]("http://example.org")),
    /HTTPS/,
  );
  await assert.rejects(
    () =>
      page.evaluate(() =>
        window.workTeam["open-link"](
          "file:///private",
        ),
      ),
    /HTTPS/,
  );
  let networkCalls = 0;
  const server = createServer((_req, res) => {
    networkCalls++;
    res.end("must not be reached");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const localUrl = `http://127.0.0.1:${server.address().port}/test-case`;
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
      const result = await app.evaluate(
        async ({ session }, { url, method }) => {
          try {
            await session.defaultSession.fetch(url, { method });
            return "allowed";
          } catch {
            return "blocked";
          }
        },
        { url: localUrl, method },
      );
      assert.equal(result, "blocked");
    }
    assert.equal(networkCalls, 0);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  const refused = await page.evaluate(async () => {
    const workspace = await window.workTeam.workspace();
    return window.workTeam.chat({
      chatId: workspace.activeChatId,
      content: "test",
    });
  });
  assert.match(
    refused.chats.find((c) => c.id === refused.activeChatId).error,
    /credential/,
  );
  assert.equal(
    refused.chats.find((c) => c.id === refused.activeChatId).messages.length,
    0,
  );
  const keyFile = path.join(output, "test-only-credential.json");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  await fs.writeFile(
    keyFile,
    JSON.stringify(
      {
        api_key: "TEST-OUTER-KEY-MUST-NOT-BE-STORED",
        service_account_key_data: {
          type: "service_account",
          project_id: "work-team-test",
          client_email: "test@work-team-test.iam.gserviceaccount.com",
          private_key: privateKey,
          private_key_id: "test-only",
          token_uri: "https://oauth2.googleapis.com/token",
        },
      },
      null,
      2,
    ).replace(/\n +/g, (match) => "\n" + "\u00a0".repeat(match.length - 1)),
  );
  await app.evaluate(({ dialog }, file) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [file],
    });
  }, keyFile);
  const imported = await page.evaluate(() =>
    window.workTeam["import-credential"](),
  );
  assert.equal(imported.project, "work-team-test");
  assert.equal(imported.private_key, undefined);
  const ciphertext = await fs.readFile(path.join(data, "credential.encrypted"));
  assert.ok(!ciphertext.includes(Buffer.from("PRIVATE KEY")));
  assert.ok(!ciphertext.includes(Buffer.from("TEST-OUTER-KEY")));
  assert.ok(!ciphertext.includes(Buffer.from("work-team-test")));
  await closeHiddenApp(app);
  app = null;
  app = await launch();
  const restored = await app.firstWindow();
  await restored
    .getByRole("heading", { name: "What are we working on?" })
    .waitFor();
  assert.equal(
    await restored.locator("html").getAttribute("data-theme"),
    "light",
  );
  const after = await restored.evaluate(() => window.workTeam.bootstrap());
  assert.equal(after.notes.length, 1);
  assert.equal(after.connection.imported, true);
  assert.equal(after.connection.project, "work-team-test");
  await restored.evaluate(() => window.workTeam["remove-credential"]());
  assert.equal(
    (await restored.evaluate(() => window.workTeam.bootstrap())).connection
      .imported,
    false,
  );
  await assert.rejects(
    () => fs.stat(path.join(data, "credential.encrypted")),
    /ENOENT/,
  );
  await restored
    .getByRole("button", { name: "Collapse sidebar", exact: true })
    .click();
  await restored.setViewportSize({ width: 390, height: 844 });
  await capture(restored, { path: path.join(output, "mobile-light.png") });
  const overflow = await restored.evaluate(
    () => document.documentElement.scrollWidth > window.innerWidth,
  );
  assert.equal(overflow, false);
  await restored.setViewportSize({ width: 1280, height: 850 });
  await restored
    .getByRole("button", { name: "Open sidebar", exact: true })
    .click();
  await restored.getByRole("button", { name: "Settings", exact: true }).click();
  await restored.getByRole("button", { name: "Dark", exact: true }).click();
  await restored.getByLabel("Text size", { exact: true }).fill("20");
  await capture(restored, { path: path.join(output, "settings-large.png") });
  assert.deepEqual(errors, []);
  console.log(
    "Desktop smoke passed: onboarding, settings, persistence, notes, raw import, schemas, GET/blocked reference views, OS-encrypted credential round-trip/removal, no-secret renderer, unsafe link rejection, session network denial (zero loopback server requests), unauthenticated chat gate, responsive overflow. No live provider request was made.",
  );
  console.log(`Screenshots: ${output}`);
} finally {
  if (app) await closeHiddenApp(app);
}
