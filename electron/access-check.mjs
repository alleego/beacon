import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { sshCommand } from "./remote-worker.mjs";

// Only a fixed nonce is printed. No cartridge code, case files or model calls.
// Never return raw SSH output: it can contain local paths and login details.
export function accessFailure(stderr, stage, timedOut = false) {
  const where = stage === "relay" ? "Relay computer" : "Remote host";
  if (/host key verification failed|remote host identification has changed/i.test(stderr))
    return { state: "host-key", message: `${where}: SSH host-key verification needs attention. Verify the host manually before trusting it.` };
  if (/permission denied|authentication failed|no supported authentication/i.test(stderr))
    return { state: "auth-required", message: `${where}: SSH authentication failed. Renew your sign-in manually, then check again.` };
  if (/could not resolve hostname|name or service not known|nodename nor servname/i.test(stderr))
    return { state: "unreachable", message: `${where}: hostname could not be resolved. Check network access and your saved hostname.` };
  if (timedOut || /timed out|no route to host|network is unreachable|connection refused/i.test(stderr))
    return { state: "unreachable", message: `${where}: connection unavailable. Check power, network/VPN access and SSH availability.` };
  return { state: "failed", message: `${where}: access could not be verified. Check your SSH setup and manual sign-in.` };
}

export function checkAccess(connection, signal, { spawnProcess = spawn, timeoutMs = 30000 } = {}) {
  const nonce = randomUUID().replaceAll("-", "");
  const relayMarker = `BEACON_RELAY_${nonce}`;
  const remoteMarker = `BEACON_REMOTE_${nonce}`;
  const args = sshCommand(`printf '%s\\n' '${remoteMarker}'`, connection,
    `printf '%s\\n' '${relayMarker}'; `);
  return new Promise(resolve => {
    let output = "", stderr = "", ended = false, child, timer;
    const finish = (state) => {
      if (ended) return;
      ended = true; clearTimeout(timer); signal?.removeEventListener("abort", abort);
      resolve({ ...state, checkedAt: new Date().toISOString() });
    };
    const stage = () => connection.relay && !output.split(/\r?\n/).includes(relayMarker) ? "relay" : "remote";
    const abort = () => { child?.kill(); finish({state:"cancelled", stage:stage(), message:"Check cancelled."}); };
    if (signal?.aborted) { abort(); return; }
    try { child = spawnProcess("ssh", args, {windowsHide:true, stdio:["ignore", "pipe", "pipe"]}); }
    catch { finish({state:"failed", stage:"local", message:"Could not start SSH. Check that OpenSSH is installed."}); return; }
    signal?.addEventListener("abort", abort, {once:true});
    timer = setTimeout(() => { child.kill(); finish({...accessFailure(stderr, stage(), true), stage:stage()}); }, timeoutMs);
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", s => { output = (output + s).slice(-65536); });
    child.stderr.on("data", s => { stderr = (stderr + s).slice(-16384); });
    child.on("error", () => finish({state:"failed", stage:"local", message:"Could not start SSH. Check that OpenSSH is installed."}));
    child.on("close", code => {
      const reached = output.split(/\r?\n/).includes(remoteMarker);
      finish(code === 0 && reached
        ? {state:"reachable", stage:"remote", message:"SSH access verified. Case-download authentication is checked separately when needed."}
        : {...accessFailure(stderr, stage()), stage:stage()});
    });
  });
}
