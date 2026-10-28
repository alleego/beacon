import {randomBytes, scrypt, createCipheriv, createDecipheriv} from 'node:crypto';
import {promisify} from 'node:util';
import {parseCartridge} from './modules.mjs';

const derive = promisify(scrypt);
const format = 'beacon-encrypted-module';
const aad = Buffer.from('beacon-encrypted-module/v1/scrypt-32768-8-1/aes-256-gcm');
export const MAX_CARTRIDGE_FILE = 2 * 1024 * 1024;
const keyFor = (password,salt) => derive(password,salt,32,{N:32768,r:8,p:1,maxmem:64*1024*1024});
const validPassword = p => typeof p === 'string' && Buffer.byteLength(p) > 0 && Buffer.byteLength(p) <= 1024;
function decode(value, length) {
  if(typeof value !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value))throw new Error('Invalid encrypted cartridge.');
  const b=Buffer.from(value,'base64');
  if(b.toString('base64')!==value || (length && b.length!==length))throw new Error('Invalid encrypted cartridge.');
  return b;
}
export function encryptedCartridge(bytes) {
  if(bytes.length>MAX_CARTRIDGE_FILE)throw new Error('Cartridge file exceeds 2 MB.');
  let e;try {e=JSON.parse(bytes.toString('utf8'));}catch{throw new Error('Invalid cartridge file.');}
  if(e?.format!==format)return false;
  if(e.version!==1 || e.kdf!=='scrypt-32768-8-1' || e.cipher!=='aes-256-gcm')throw new Error('Unsupported encrypted cartridge.');
  decode(e.salt,16);decode(e.iv,12);decode(e.tag,16);
  const data=decode(e.data);
  if(!data.length || data.length>1024*1024)throw new Error('Invalid encrypted cartridge size.');
  return true;
}
export async function encryptCartridge(bytes,password) {
  parseCartridge(bytes);
  if(!validPassword(password) || password.length<12)throw new Error('Use a cartridge password of at least 12 characters.');
  const salt=randomBytes(16),iv=randomBytes(12),key=await keyFor(password,salt);
  try {
    const cipher=createCipheriv('aes-256-gcm',key,iv,{authTagLength:16});cipher.setAAD(aad);
    const data=Buffer.concat([cipher.update(bytes),cipher.final()]);
    return Buffer.from(JSON.stringify({format,version:1,kdf:'scrypt-32768-8-1',cipher:'aes-256-gcm',
      salt:salt.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')}));
  }finally{key.fill(0);}
}
export async function decryptCartridge(bytes,password) {
  if(!encryptedCartridge(bytes))throw new Error('This cartridge is not encrypted.');
  if(!validPassword(password))throw new Error('Enter the cartridge password.');
  const e=JSON.parse(bytes.toString('utf8')),key=await keyFor(password,decode(e.salt,16));
  let partial,plain;
  try {
    const decipher=createDecipheriv('aes-256-gcm',key,decode(e.iv,12),{authTagLength:16});
    decipher.setAAD(aad);decipher.setAuthTag(decode(e.tag,16));
    partial=decipher.update(decode(e.data));
    plain=Buffer.concat([partial,decipher.final()]);
    parseCartridge(plain);
    return plain;
  }catch{plain?.fill(0);throw new Error('Could not unlock cartridge. Check the password or obtain an unchanged file from its author.');}
  finally{key.fill(0);partial?.fill(0);}
}
