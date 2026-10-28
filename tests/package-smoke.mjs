import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { listPackage, extractFile } from "@electron/asar";
const archive = process.argv[2] || (process.platform === "darwin"
  ? "release/mac/Beacon.app/Contents/Resources/app.asar"
  : "release/win-unpacked/resources/app.asar");
const entries = listPackage(archive).map(p => p.replaceAll("\\", "/"));
assert.ok(!entries.some(p => /^\/(tests|test-results|knowledge|docs)\//.test(p) || /\.(encrypted|beacon-module)$/.test(p)));
for (const name of ["package.json", "electron/main.cjs", "electron/investigations.mjs", "electron/modules.mjs", "electron/remote-worker.mjs", "electron/access-check.mjs", "electron/cartridge-crypto.mjs", "electron/cartridge-import.mjs", "electron/provider.mjs", "dist/index.html"]) {
  const original = await fs.readFile(name);
  const packaged = extractFile(archive, name);
  if (name === "package.json") assert.equal(JSON.parse(packaged).version, JSON.parse(original).version);
  else assert.deepEqual(packaged, original, `${name} must match the finished source`);
}
console.log("Package audit passed: finished app sources match, no modules, user data, test profiles or knowledge files bundled. No app was launched.");
