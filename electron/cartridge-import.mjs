import {randomUUID} from 'node:crypto';
import {encryptedCartridge,decryptCartridge} from './cartridge-crypto.mjs';
import {parseCartridge} from './modules.mjs';

// Pending ciphertext lives in memory only. Plaintext goes directly to encrypted storage.
export function createCartridgeImporter({approve,install}) {
  let pending=null,busy=false;
  function cancel(token) {
    if(pending && (!token || pending.token===token)) {clearTimeout(pending.timer);pending.bytes.fill(0);pending=null;}
  }
  async function accept(bytes,stillValid=()=>true) {
    const m=parseCartridge(bytes);
    if(!stillValid())return null;
    if(!await approve(m) || !stillValid())return null;
    return install(bytes);
  }
  return {
    cancel,
    async begin(bytes) {
      if(busy)throw new Error('An import is already running.');
      cancel();
      if(!encryptedCartridge(bytes)) {busy=true;try{return await accept(bytes);}finally{busy=false;bytes.fill(0);}}
      const token=randomUUID();
      const timer=setTimeout(()=>cancel(token),10*60*1000);timer.unref?.();
      pending={token,bytes:Buffer.from(bytes),timer};bytes.fill(0);
      return {needsUnlock:true,token};
    },
    async unlock({token,password}) {
      if(busy)throw new Error('An import is already running.');
      if(!pending || pending.token!==token)throw new Error('Import expired. Choose the cartridge again.');
      const current=pending,encrypted=Buffer.from(current.bytes);
      let plain;
      busy=true;
      try {
        plain=await decryptCartridge(encrypted,password);
        const result=await accept(plain,()=>pending===current);
        cancel(token);return result;
      }finally{plain?.fill(0);encrypted.fill(0);busy=false;password='';}
    },
  };
}
