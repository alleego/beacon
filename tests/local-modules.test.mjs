import test from 'node:test';
import assert from 'node:assert/strict';
import {parseCartridge, moduleReady} from '../electron/modules.mjs';
import {localWorker} from '../electron/local-worker.mjs';
const module = {format:'beacon-module', apiVersion:2, id:'local-fixture', name:'Local fixture', version:'1.0.0',
  description:'Synthetic local fixture', system:'Use synthetic evidence.', capability:'local-node-worker', platform:'darwin',
  setup:{title:'Local setup', steps:['Review local permissions.']},
  topics:[{id:'sample', name:'Sample', prompt:'Review sample.'}], worker:'console.log(JSON.stringify({type:"result",ok:true}));'};
test('local modules require setup, platform compatibility and explicit versioned capability', () => {
  const pack = parseCartridge(Buffer.from(JSON.stringify(module)));
  assert.equal(moduleReady({package:pack},'darwin'),false);
  assert.equal(moduleReady({package:pack,setupHash:pack.hash},'darwin'),true);
  assert.equal(moduleReady({package:pack,setupHash:pack.hash},'linux'),false);
  assert.throws(()=>parseCartridge(Buffer.from(JSON.stringify({...module,setup:null}))));
  assert.throws(()=>parseCartridge(Buffer.from(JSON.stringify({...module,platform:'linux'}))));
  assert.throws(()=>parseCartridge(Buffer.from(JSON.stringify({...module,apiVersion:1}))));
});
test('local runtime passes structured input without inherited provider environment', async () => {
  process.env.BEACON_TEST_SECRET='not-for-modules';
  try {
    const result = await localWorker({...module,platform:process.platform,worker:`
      const input=JSON.parse(Buffer.from(process.argv[2],'base64').toString());
      console.log(JSON.stringify({type:'result',target:input.target,leak:!!process.env.BEACON_TEST_SECRET}));`},
      {target:'00123456'},null,new AbortController().signal);
    assert.equal(result.target,'00123456'); assert.equal(result.leak,false);
  } finally { delete process.env.BEACON_TEST_SECRET; }
});
test('wrong platform, worker failure and cancellation are explicit', async () => {
  await assert.rejects(localWorker({...module,platform:'not-this-platform'},{},null),/requires macOS/);
  await assert.rejects(localWorker({...module,platform:process.platform,worker:"console.log(JSON.stringify({type:'error',message:'Fixture failed'}));process.exitCode=1;"},{},null),/Fixture failed/);
  const controller=new AbortController();controller.abort();
  await assert.rejects(localWorker({...module,platform:process.platform},{},null,controller.signal),/Stopped/);
});
