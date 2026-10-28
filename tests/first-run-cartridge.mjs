// Clean desktop first-run UI, synthetic credential and encrypted cartridge only.
import {_electron as electron} from 'playwright';
import {createRequire} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {generateKeyPairSync} from 'node:crypto';
import {encryptCartridge} from '../electron/cartridge-crypto.mjs';
const require=createRequire(import.meta.url),root=path.resolve('.');
const output=path.join(root,'test-results');await fs.mkdir(output,{recursive:true});
const base=await fs.mkdtemp(path.join(output,'first-run-'));
const data=path.join(base,'profile'),credential=path.join(base,'synthetic-credential.json'),cartridge=path.join(base,'fixture.beacon-module');
const password='Synthetic-unlock-phrase-8041',marker='PRIVATE_SYNTHETIC_WORKER_MARKER';
const pack={format:'beacon-module',apiVersion:1,id:'fixture-module',name:'Fixture module',version:'1.0.0',description:'Synthetic module only',system:'Use synthetic data',capability:'ssh-python-worker',python:'/usr/bin/python3',worker:`print('${marker}')`,topics:[{id:'overview',name:'Overview',prompt:'Inspect synthetic data'}]};
const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048,privateKeyEncoding:{type:'pkcs8',format:'pem'},publicKeyEncoding:{type:'spki',format:'pem'}});
await fs.writeFile(credential,JSON.stringify({type:'service_account',project_id:'beacon-fixture',client_email:'test@beacon-fixture.iam.gserviceaccount.com',private_key:privateKey,token_uri:'https://oauth2.googleapis.com/token'}));
await fs.writeFile(cartridge,await encryptCartridge(Buffer.from(JSON.stringify(pack)),password));
const env={...process.env,WORK_TEAM_TEST_DATA:data,WORK_TEAM_TEST_HIDDEN:'1'};delete env.ELECTRON_RUN_AS_NODE;
let app,page;
const launch=()=>electron.launch({executablePath:require('electron'),args:[root],cwd:root,env});
async function close(){if(app){await app.evaluate(({app})=>setTimeout(()=>app.exit(0),50)).catch(()=>{});await app.close();app=null;}}
async function choose(file){await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);}
async function until(fn){for(let i=0;i<100;i++){if(await page.evaluate(fn))return;await new Promise(r=>setTimeout(r,100));}throw new Error('UI state did not settle');}
try {
 app=await launch();page=await app.firstWindow();
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setBackgroundThrottling(false));
 await app.evaluate(()=>{globalThis.fetch=async()=>{throw new Error('Network must not run in first-run test');};});
 await page.getByLabel('Your name',{exact:true}).fill('Fixture Teammate');
 await page.getByRole('button',{name:'Continue',exact:true}).evaluate(e=>e.click());
 await choose(credential);
 await page.getByRole('button',{name:'Import credential',exact:true}).evaluate(e=>e.click());
 await page.getByRole('button',{name:'Open workspace',exact:true}).waitFor();
 await page.getByRole('button',{name:'Open workspace',exact:true}).evaluate(e=>e.click());
 await page.getByRole('button',{name:'Settings',exact:true}).evaluate(e=>e.click());
 await page.getByRole('tab',{name:'Modules',exact:true}).evaluate(e=>e.click());
 await app.evaluate(({dialog})=>{globalThis.__trustCount=0;dialog.showMessageBox=async(_w,o)=>{if(o.title!=='Trust this module?')throw new Error('Unexpected confirmation');globalThis.__trustCount++;return {response:1};};});
 await choose(cartridge);
 await page.getByRole('button',{name:'Import module',exact:true}).evaluate(e=>e.click());
 await page.getByLabel('Cartridge password',{exact:true}).fill('wrong-password');
 await page.getByRole('button',{name:'Unlock and review',exact:true}).evaluate(e=>e.click());
 await page.getByText(/Could not unlock cartridge/).waitFor();
 assert.equal(await app.evaluate(()=>globalThis.__trustCount),0);
 assert.equal(await page.getByLabel('Cartridge password',{exact:true}).inputValue(),'');
 assert.equal(await page.evaluate(async()=>(await window.workTeam.modules()).modules.length),0);
 await page.getByRole('button',{name:'Cancel import',exact:true}).evaluate(e=>e.click());
 await page.getByRole('button',{name:'Import module',exact:true}).evaluate(e=>e.click());
 await page.getByLabel('Cartridge password',{exact:true}).fill(password);
 await page.getByRole('button',{name:'Unlock and review',exact:true}).evaluate(e=>e.click());
 await page.getByLabel('Remote host',{exact:true}).waitFor();
 assert.equal(await app.evaluate(()=>globalThis.__trustCount),1);
 assert.equal(await page.getByLabel('Cartridge password',{exact:true}).count(),0);
 await page.getByLabel('Remote host',{exact:true}).fill('fixture.example');
 await page.getByLabel('Your SSH username',{exact:true}).fill('teammate');
 await page.getByRole('button',{name:'Save connection',exact:true}).evaluate(e=>e.click());
 await until(async()=>(await window.workTeam.modules()).modules[0]?.connection?.user==='teammate');
 const m=await page.evaluate(async()=>(await window.workTeam.modules()).modules[0]);
 assert.equal(m.connection.relay,'');assert.equal(m.connection.config,'');
 await page.getByRole('button',{name:'Done',exact:true}).evaluate(e=>e.click());
 await page.locator('.topbar-access').getByRole('button',{name:'Check access for Fixture module'}).waitFor();
 assert.equal(await page.locator('.topbar-access').getByRole('button',{name:'Check access for Fixture module'}).count(),1);
 await close();app=await launch();page=await app.firstWindow();
 await until(async()=>!!(await window.workTeam.bootstrap()).settings.onboarded);
 assert.equal(await page.getByLabel('Your name',{exact:true}).count(),0);
 const saved=await page.evaluate(async()=>({b:await window.workTeam.bootstrap(),m:(await window.workTeam.modules()).modules[0]}));
 assert.equal(saved.b.settings.name,'Fixture Teammate');assert.equal(saved.b.connection.imported,true);
 assert.equal(saved.m.connection.user,'teammate');assert.equal(saved.m.connection.relay,'');
 await close();
 for(const name of await fs.readdir(data)){
   if(!(await fs.stat(path.join(data,name))).isFile())continue;
   const content=await fs.readFile(path.join(data,name));
   for(const secret of [password,marker,privateKey])assert.ok(!content.includes(Buffer.from(secret)),`${name} contains plaintext secret`);
 }
 console.log('Fresh first-run passed: name, credential importer, wrong password/cancel, encrypted cartridge unlock/trust, own direct SSH settings, restart persistence, no plaintext secrets in profile. No real credentials, SSH or model requests.');
} finally {await close();await fs.rm(credential,{force:true});}
