import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { checkAccess, accessFailure } from "../electron/access-check.mjs";

const connection = {host:"fixture.example", user:"tester", relay:"relay-fixture", config:"C:/safe path/ssh_config"};
function fakeSpawn(run) {
  return (_command, args, options) => {
    assert.equal(options.windowsHide, true);
    assert.equal(options.stdio[0], "ignore");
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.kill = () => setImmediate(() => child.emit("close", 1));
    setImmediate(() => run(child, args)); return child;
  };
}
test("access check verifies remote nonce through saved relay; harmless stderr is not failure", async () => {
  const result = await checkAccess(connection, null, {spawnProcess:fakeSpawn((c, args) => {
    assert.ok(args.includes(connection.config));
    assert.match(args.at(-1), /StrictHostKeyChecking=yes/);
    const relay = args.at(-1).match(/BEACON_RELAY_[a-f0-9]+/)[0];
    const remote = args.at(-1).match(/BEACON_REMOTE_[a-f0-9]+/)[0];
    c.stderr.write("WARNING: algorithm warning\n/private/path/never-expose\n");
    c.stdout.write(relay+"\n"+remote+"\n"); c.emit("close", 0);
  })});
  assert.equal(result.state, "reachable"); assert.equal(result.stage, "remote");
  assert.ok(result.checkedAt); assert.ok(!JSON.stringify(result).includes("private/path"));
});
test("relay DNS and downstream authentication failures are distinguished and sanitized", async () => {
  const relay = await checkAccess(connection, null, {spawnProcess:fakeSpawn(c => {
    c.stderr.write("ssh: Could not resolve hostname private.example: No such host"); c.emit("close",255);
  })});
  assert.equal(relay.stage,"relay"); assert.equal(relay.state,"unreachable");
  assert.ok(!JSON.stringify(relay).includes("private.example"));
  const remote = await checkAccess(connection, null, {spawnProcess:fakeSpawn((c,args) => {
    c.stdout.write(args.at(-1).match(/BEACON_RELAY_[a-f0-9]+/)[0]+"\n");
    c.stderr.write("user@private.example: Permission denied (publickey)"); c.emit("close",255);
  })});
  assert.equal(remote.stage,"remote"); assert.equal(remote.state,"auth-required");
});
test("exit zero without remote marker is not success; direct mode has no relay", async () => {
  const r = await checkAccess({...connection,relay:""},null,{spawnProcess:fakeSpawn((c,args)=>{
    assert.ok(!args.at(-1).includes("BEACON_RELAY")); c.stdout.write("banner\n"); c.emit("close",0);
  })});
  assert.equal(r.state,"failed"); assert.equal(r.stage,"remote");
  assert.equal(accessFailure("Host key verification failed.","remote").state,"host-key");
});
test("checks have a deadline and honour cancellation", async () => {
  const r = await checkAccess(connection,null,{spawnProcess:fakeSpawn(()=>{}),timeoutMs:10});
  assert.equal(r.state,"unreachable");
  const controller = new AbortController(); controller.abort();
  const cancelled = await checkAccess(connection,controller.signal,{spawnProcess:()=>{throw new Error("must not spawn");}});
  assert.equal(cancelled.state,"cancelled");
});
