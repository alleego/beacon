import { spawn } from "node:child_process";

// Trusted cartridges execute as the user, not in a sandbox. Never forward
// provider credentials or the parent environment to a module process.
export function localWorker(module, input, _connection, signal, onProgress = () => {}) {
  if (module.platform !== process.platform)
    return Promise.reject(new Error("This module requires macOS on this computer."));
  return new Promise((resolve, reject) => {
    const env = { ELECTRON_RUN_AS_NODE: "1", PATH: "/usr/bin:/bin:/usr/sbin:/sbin" };
    for (const key of ["HOME", "TMPDIR", "LANG"]) if (process.env[key]) env[key] = process.env[key];
    const child = spawn(process.execPath, ["--input-type=commonjs", "-", Buffer.from(JSON.stringify(input)).toString("base64")],
      { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "", bytes = 0, result, failure, settled = false;
    const finish = error => {
      if (settled) return;
      settled = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => { child.kill(); finish(new Error("Stopped. Saved results are retained.")); };
    const timer = setTimeout(() => { child.kill(); finish(new Error("Local module timed out. Check its setup and try again.")); }, 45000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    child.on("error", () => finish(new Error("Could not start the local module.")));
    child.stdin.on("error", () => {});
    child.stderr.on("data", () => { failure = "Local module failed. Check its setup."; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (settled) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 1024 * 1024) { child.kill(); finish(new Error("Local module output exceeded its limit.")); return; }
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === "progress" && typeof event.message === "string") onProgress(event.message.slice(0, 1000), false);
          if (event.type === "result") result = event;
          if (event.type === "error") failure = String(event.message).slice(0, 1000);
        } catch { /* Non-protocol output is never an instruction. */ }
      }
    });
    child.on("close", code => finish(code === 0 && result ? null : new Error(failure || "Local module ended without a result.")));
    child.stdin.end(module.worker);
  });
}

export async function localAccess(module) {
  return { state: module.platform === process.platform ? "reachable" : "failed",
    checkedAt: new Date().toISOString(),
    message: module.platform === process.platform
      ? "Local runtime is available. Application permissions and sign-in are checked when the module runs."
      : "This module requires macOS on this computer." };
}
