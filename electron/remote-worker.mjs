import { spawn } from "node:child_process";
import { validateConnection } from "./modules.mjs";

const quote = s => "'" + s.replaceAll("'", "'\\''") + "'";
export function workerCommand(module, input, connection) {
  const remote = `${quote(module.python)} -u - ${quote(Buffer.from(JSON.stringify(input)).toString("base64"))}`;
  return { args: sshCommand(remote, connection), stdin: module.worker };
}

export function sshCommand(remote, connection, relayPrefix = "") {
  const c = validateConnection(connection);
  const args = ["-T", "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=yes",
    "-o", "ConnectTimeout=10", "-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3",
    "-o", "ForwardAgent=no", "-o", "ClearAllForwardings=yes"];
  if (c.config) args.push("-F", c.config);
  if (c.relay) {
    args.push(c.relay, `${relayPrefix}ssh -T -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=10 -o ServerAliveInterval=15 -o ServerAliveCountMax=3 -o ForwardAgent=no -o ClearAllForwardings=yes ${quote(c.user + "@" + c.host)} ${quote(remote)}`);
  } else args.push(`${c.user}@${c.host}`, remote);
  return args;
}

export async function remoteWorker(module, input, connection, signal, onProgress) {
  const { args, stdin } = workerCommand(module, input, connection);
  return new Promise((resolve, reject) => {
    const child = spawn("ssh", args, { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    let buffer = "", bytes = 0, result, failure = "", settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      error ? reject(error) : resolve(result);
    };
    const abort = () => { child.kill(); finish(new Error("Stopped. Saved results are retained.")); };
    const timer = setTimeout(() => { child.kill(); finish(new Error("Worker timed out. Resume after checking the remote session.")); }, 2 * 60 * 60 * 1000);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) { abort(); return; }
    child.on("error", () => finish(new Error("Could not start SSH. Install OpenSSH and check your connection settings.")));
    child.stdin.on("error", () => {});
    child.stderr.on("data", () => { failure = "SSH or the remote worker failed. Check VPN, manual sign-in, host keys, and your SSH configuration."; });
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", chunk => {
      if (settled) return;
      bytes += chunk.length;
      if (bytes > 2 * 1024 * 1024) { child.kill(); finish(new Error("Worker output exceeded its limit.")); return; }
      buffer += chunk.toString("utf8");
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i); buffer = buffer.slice(i + 1);
        try {
          const event = JSON.parse(line);
          if (event.type === "progress" && typeof event.message === "string") onProgress(event.message.slice(0, 1000), event.waitingForAuth === true);
          if (event.type === "result") result = event;
          if (event.type === "error") failure = String(event.message).slice(0, 1000);
        } catch { /* SSH banners and non-protocol output are never interpreted. */ }
      }
    });
    child.on("close", code => finish(code === 0 && result ? null : new Error(failure || "Worker ended without a result. Check remote authentication.")));
    child.stdin.end(stdin);
  });
}
