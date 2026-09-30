// Disposable server preload. No network clients or subprocesses are needed by this rehearsal.
'use strict';
const fs=require('node:fs'),path=require('node:path'),net=require('node:net');
if(process.env.NODE_ENV!=='test'||!fs.existsSync(path.join(process.cwd(),'.rehearsal-disposable')))throw Error('Disposable rehearsal marker required');
const deny=kind=>function(){fs.appendFileSync(path.join(process.cwd(),'.outbound-denied'),kind+'\n');throw Error('REHEARSAL_OUTBOUND_DENIED: '+kind)};
net.Socket.prototype.connect=deny('net.connect');
require('node:tls').connect=deny('tls.connect');
require('node:dgram').createSocket=deny('dgram');
for(const api of [require('node:dns'),require('node:dns').promises])for(const key of Object.keys(api))if(/^(lookup|resolve|reverse)/.test(key)&&typeof api[key]==='function')api[key]=deny('dns.'+key);
require('node:dns').lookup=function(host,options,callback){if(host!=='127.0.0.1')return deny('dns.lookup')();if(typeof options==='function')callback=options;process.nextTick(()=>options?.all?callback(null,[{address:'127.0.0.1',family:4}]):callback(null,'127.0.0.1',4));};
globalThis.fetch=deny('fetch');
const cp=require('node:child_process');for(const key of ['spawn','spawnSync','exec','execSync','execFile','execFileSync','fork'])cp[key]=deny('child_process.'+key);
const listen=net.Server.prototype.listen;
net.Server.prototype.listen=function(...args){
 if(typeof args[0]==='object'){args[0]={...args[0],host:'127.0.0.1',port:0};}else{args[0]=0;if(typeof args[1]==='string')args[1]='127.0.0.1';else args.splice(1,0,'127.0.0.1');}
 this.once('listening',()=>{if(this.address().address!=='127.0.0.1')throw Error('Non-loopback listener');fs.writeFileSync(path.join(process.cwd(),'.port'),String(this.address().port));});return listen.apply(this,args);
};
