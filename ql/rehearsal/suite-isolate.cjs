// Existing regression runners spawn their own disposable fixtures. Propagate loopback-only
// networking to every Node child without changing application source or fixture ports.
'use strict';
const net=require('node:net'),dns=require('node:dns'),cp=require('node:child_process');
const local=h=>h===undefined||['127.0.0.1','localhost','::1'].includes(h);
const fail=()=>{throw Error('REGRESSION_OUTBOUND_DENIED')};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){const x=args[0];const o=Array.isArray(x)?x[0]:x;const host=typeof o==='object'?o.host:args[1];if(!local(typeof host==='function'?undefined:host)||typeof o==='string'||o?.path)fail();return connect.apply(this,args);};
const lookup=dns.lookup;dns.lookup=function(host,...args){if(!local(host))fail();return lookup.call(this,host,...args);};
const listen=net.Server.prototype.listen;net.Server.prototype.listen=function(...args){if(args[0]&&typeof args[0]==='object')args[0]={...args[0],host:'127.0.0.1'};else if(typeof args[1]==='string')args[1]='127.0.0.1';else args.splice(1,0,'127.0.0.1');return listen.apply(this,args);};
const fetchOriginal=globalThis.fetch;globalThis.fetch=function(url,...args){if(!local(new URL(typeof url==='string'?url:url.url).hostname))fail();return fetchOriginal(url,...args);};
require('node:dgram').createSocket=fail;
for(const name of ['spawn','spawnSync','execFile','execFileSync']){const original=cp[name];cp[name]=function(file,args,options){if(file!==process.execPath&&!/\/node$/.test(file)&&file!=='node')fail();options={...options,env:{...(options?.env||process.env),NODE_OPTIONS:'--require '+__filename}};return original.call(this,file,args,options);};}
cp.exec=fail;cp.execSync=fail;
