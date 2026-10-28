import { _electron as electron } from "playwright";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
const output = path.resolve("test-results");
await fs.mkdir(output, {recursive: true});
const data = await fs.mkdtemp(path.join(output, "module-profile-"));
await fs.writeFile(path.join(data, "settings.json"), JSON.stringify({name: "Synthetic user", onboarded: true}));
const moduleFile = path.join(data, "fixture.beacon-module");
await fs.writeFile(moduleFile, JSON.stringify({
  format: "beacon-module", apiVersion: 1, id: "fixture-worker", name: "Fixture module",
  version: "1.0.0", description: "Synthetic module for hidden UI checks",
  capability: "ssh-python-worker", python: "/usr/bin/python3",
  system: "Synthetic inspection", worker: "print('fixture')",
  topics: [{id: "inventory", name: "Inventory", prompt: "Inspect synthetic inventory"}],
}));
const env = {...process.env, WORK_TEAM_TEST_DATA: data, WORK_TEAM_TEST_HIDDEN: "1"};
delete env.ELECTRON_RUN_AS_NODE;
const launch = () => electron.launch({executablePath: require("electron"), args: [path.resolve(".")], env});
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
  await page.getByRole("button", {name: "Settings", exact: true}).click();
  await page.getByRole("tab", {name: "Modules", exact: true}).click();
  await app.evaluate(({dialog}, filename) => {
    dialog.showOpenDialog = async () => ({canceled: false, filePaths: [filename]});
    dialog.showMessageBox = async () => ({response: 0});
  }, moduleFile);
  await page.getByRole("button", {name: "Import module", exact: true}).click();
  assert.equal((await page.evaluate(() => window.workTeam.modules())).modules.length, 0);
  await app.evaluate(({dialog}) => { dialog.showMessageBox = async () => ({response: 1}); });
  await page.getByRole("button", {name: "Import module", exact: true}).click();
  await page.getByLabel("Remote host", {exact: true}).fill("fixture.example.org");
  await page.getByLabel("Your SSH username", {exact: true}).fill("fixture-user");
  await page.getByRole("button", {name: "Save connection", exact: true}).click();
  await page.waitForFunction(async () => (await window.workTeam.modules()).modules[0]?.connection?.user === "fixture-user");
  await page.getByLabel("Enabled", {exact: true}).click();
  await page.waitForFunction(async () => !(await window.workTeam.modules()).modules[0].enabled);
  assert.equal(await app.evaluate(({BrowserWindow}) => BrowserWindow.getAllWindows()[0].isVisible()), false);
  await closeHiddenApp(app); app = await launch();
  const restored = await app.firstWindow();
  const saved = await restored.evaluate(() => window.workTeam.modules());
  assert.equal(saved.modules[0].connection.user, "fixture-user");
  assert.equal(saved.modules[0].enabled, false);
  const encrypted = await fs.readFile(path.join(data, "modules.encrypted"));
  assert.equal(encrypted.includes(Buffer.from("fixture-user")), false);
  console.log("Hidden module check passed: trust cancellation/import, settings, disable, encrypted persistence, restart. No network or model calls.");
} finally { if (app) await closeHiddenApp(app); }

