import test from "node:test";
import assert from "node:assert/strict";
import { parseCartridge, validateConnection } from "../electron/modules.mjs";
import { workerCommand } from "../electron/remote-worker.mjs";
import { createInvestigations, evidenceContext } from "../electron/investigations.mjs";
import { createConversationStore } from "../electron/conversations.mjs";

const pack = {
  format: "beacon-module", apiVersion: 1, id: "fixture-worker", name: "Fixture",
  version: "1.0.0", description: "Synthetic inspection", system: "Inspect synthetic evidence.",
  capability: "ssh-python-worker", python: "/usr/bin/python3", worker: "print('synthetic')",
  topics: [{id: "inventory", name: "Inventory", prompt: "Inspect inventory."}],
};
const bytes = Buffer.from(JSON.stringify(pack));
const connection = {host: "fixture.example.org", user: "fixture", relay: "", config: ""};
const response = {text: "Synthetic finding [E001]", usage: {input: 4, output: 5}};
async function fixture({ask = async () => response, collect, probe} = {}) {
  let saved = null, chatSaved = null;
  const chats = createConversationStore({read: async () => chatSaved, write: async s => { chatSaved = structuredClone(s); }});
  const args = {read: async () => saved, write: async s => { saved = structuredClone(s); }, chats, ask, probe,
    collect: collect || (async () => ({evidence: [{id: "E001", topic: "inventory", source: "/synthetic/status.json", text: "healthy", collectedAt: "2026-01-01T00:00:00Z"}]}))};
  const engine = createInvestigations(args);
  await engine.install(bytes);
  await engine.configure({id: pack.id, connection});
  const chatId = (await chats.snapshot()).activeChatId;
  return {engine, chats, chatId, args, saved: () => saved};
}
async function done(engine, id) {
  for (let i = 0; i < 200; i++) {
    const j = (await engine.snapshot()).jobs.find(j => j.id === id);
    if (["ready", "error", "stopped", "awaiting-selection"].includes(j.status)) return j;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error("Job did not settle");
}

test("cartridges enforce compatibility and SSH arguments cannot inject shell options", () => {
  assert.equal(parseCartridge(bytes).hash.length, 64);
  assert.throws(() => parseCartridge(Buffer.from(JSON.stringify({...pack, apiVersion: 2}))));
  assert.throws(() => validateConnection({...connection, host: "-oProxyCommand=bad"}));
  assert.throws(() => validateConnection({...connection, user: "x;echo bad"}));
  const command = workerCommand(parseCartridge(bytes), {target: "00123456"}, {...connection, relay: "my-relay", config: "C:/folder with spaces/config"});
  assert.ok(command.args.includes("C:/folder with spaces/config"));
  assert.match(command.args.at(-1), /StrictHostKeyChecking=yes/);
  assert.equal(command.stdin, pack.worker);
});

test("investigation persists isolated specialist chat, evidence and master review; resume never repeats completed calls", async () => {
  let calls = 0, collections = 0;
  const systems = [];
  const f = await fixture({ask: async (_messages, _signal, options) => {calls++; systems.push(options.system); return response;}, collect: async () => {
    collections++; return {evidence: [{id: "E001", topic: "inventory", source: "/synthetic", text: "healthy", collectedAt: "2026-01-01"}]};
  }});
  const id = await f.engine.start(f.chatId, {moduleId: pack.id, target: "00123456", depth: "quick"});
  await f.engine.resume(id);
  const result = await done(f.engine, id);
  assert.equal(result.status, "ready", result.message);
  assert.equal(calls, 2); assert.equal(collections, 1);
  const ws = await f.chats.snapshot();
  assert.equal(ws.chats.length, 2);
  assert.equal(ws.chats.find(c => c.id !== f.chatId).parentChatId, f.chatId);
  assert.match(systems[0], /healthy/);
  assert.ok(!ws.chats.find(c => c.id !== f.chatId).messages[0].content.includes('"healthy"'));
  assert.match(await f.engine.context(result.children[0].chatId), /healthy/);
  assert.match(await f.engine.handoff(id), /E001/);
  assert.equal((await f.engine.evidence(id)).length, 1);
  const reopened = createInvestigations(f.args);
  await reopened.resume(id);
  assert.equal((await done(reopened, id)).status, "ready");
  assert.equal(calls, 2); assert.equal(collections, 1);
  await reopened.changed(result.children[0].chatId);
  assert.equal((await reopened.snapshot()).jobs[0].stale, true);
});

test("failed analysis is resumable without repeating collection; disabling module retains work", async () => {
  let fail = true, calls = 0;
  const f = await fixture({ask: async () => { calls++; if (fail) throw new Error("Synthetic provider failure"); return response; }});
  const id = await f.engine.start(f.chatId, {moduleId: pack.id, target: "00123456", depth: "deep"});
  await f.engine.resume(id);
  assert.equal((await done(f.engine, id)).status, "error");
  assert.equal(calls, 1);
  await f.engine.configure({id: pack.id, enabled: false});
  await assert.rejects(f.engine.resume(id), /Enable/);
  assert.equal((await f.engine.evidence(id)).length, 1);
  await f.engine.configure({id: pack.id, enabled: true});
  fail = false;
  await f.engine.resume(id);
  assert.equal((await done(f.engine, id)).status, "ready");
  assert.equal(calls, 3);
});

test("unrelated chat can respond while an investigation chat is pending", async () => {
  const f = await fixture();
  await f.chats.begin({chatId: f.chatId, content: "First"});
  const next = await f.chats.action({type: "create-chat"});
  await f.chats.begin({chatId: next.activeChatId, content: "Second"});
  await f.chats.finish(next.activeChatId, response);
  const ws = await f.chats.snapshot();
  assert.equal(ws.chats.find(c => c.id === f.chatId).pending.question, "First");
  assert.equal(ws.chats.find(c => c.id === next.activeChatId).messages[1].content, response.text);
});

test("ambiguous snapshots pause without billing; selection survives restart and keeps overrides separate", async () => {
  const sources = [{id: "a".repeat(16), label: "first", capturedAt: null}, {id: "b".repeat(16), label: "second", capturedAt: null}];
  let calls = 0;
  const inputs = [];
  const f = await fixture({ask: async () => {calls++; return response;}, collect: async (_m, input) => {
    inputs.push(input);
    if (!input.sourceId) return {selectionRequired: true, sources, note: "Choose a snapshot"};
    return {sources, selectedSource: sources.find(s => s.id === input.sourceId), evidence: [
      {id: "E001", topic: "inventory", source: input.sourceId, text: "selected evidence", collectedAt: "2026-01-01"}]};
  }});
  const id = await f.engine.start(f.chatId, {moduleId: pack.id, target: "00123456", depth: "quick"});
  await f.engine.resume(id);
  assert.equal((await done(f.engine, id)).status, "awaiting-selection");
  assert.equal(calls, 0);
  const reopened = createInvestigations(f.args);
  assert.equal((await reopened.snapshot()).jobs[0].status, "awaiting-selection");
  await assert.rejects(reopened.resume(id, false, "../../wrong"), /available snapshot/);
  await reopened.resume(id, false, sources[1].id);
  assert.equal((await done(reopened, id)).selectedSource.id, sources[1].id);
  assert.equal(inputs[1].existingOnly, true);
  assert.equal(calls, 2);
  const alternate = await reopened.inspectSource(id, sources[0].id);
  assert.notEqual(alternate.chatId, f.chatId);
  assert.equal((await done(reopened, alternate.id)).selectedSource.id, sources[0].id);
  assert.equal((await reopened.snapshot()).jobs.find(j => j.id === id).selectedSource.id, sources[1].id);
  await reopened.shutdown();
});

test("all evidence records reach the model even when the first is large", () => {
  const records = Array.from({length: 15}, (_, i) => ({id: `E${i}`, topic: "inventory", source: "/fixture",
    text: "x".repeat(10000), collectedAt: "2026-01-01"}));
  const result = evidenceContext(records, 16000);
  assert.ok(result.length <= 16000);
  assert.equal(JSON.parse(result).length, records.length);
  assert.ok(JSON.parse(result).every(e => e.contextTruncated && e.text.length > 0));
});

test("access checks deduplicate, expire, and are invalidated by connection edits or restart", async () => {
  let count=0, release;
  const f=await fixture({probe:async (_c,signal)=>{
    count++;
    return new Promise(resolve=>{
      release=()=>resolve({state:"reachable",checkedAt:new Date(Date.now()-121000).toISOString()});
      signal.addEventListener("abort",()=>resolve({state:"cancelled"}),{once:true});
    });
  }});
  const first=f.engine.testAccess(pack.id), second=f.engine.testAccess(pack.id);
  while(!release)await new Promise(r=>setImmediate(r));
  assert.equal((await f.engine.snapshot()).modules[0].access.state,"checking");
  release(); await Promise.all([first,second]); assert.equal(count,1);
  assert.equal((await f.engine.snapshot()).modules[0].access.state,"stale");
  const reopened=createInvestigations(f.args);
  assert.equal((await reopened.snapshot()).modules[0].access.state,"unchecked");
  release=null;
  const pending=f.engine.testAccess(pack.id);
  while(!release)await new Promise(r=>setImmediate(r));
  await f.engine.configure({id:pack.id,connection:{...connection,host:"changed.example"}});
  await pending;
  assert.equal((await f.engine.snapshot()).modules[0].access.state,"unchecked");
  await f.engine.configure({id:pack.id,enabled:false});
  await assert.rejects(f.engine.testAccess(pack.id),/Enable/);
  assert.equal(f.saved().modules[0].access,undefined);
});
