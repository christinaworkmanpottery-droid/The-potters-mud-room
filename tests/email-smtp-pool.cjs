'use strict';
const net=require('node:net'),assert=require('node:assert/strict'),Database=require('better-sqlite3'),nodemailer=require('nodemailer');
const {createReliableMailer}=require('../lib/reliable-mail');
(async()=>{
 let connections=0,auths=0,messages=0;const sockets=new Set();
 const server=net.createServer(socket=>{connections++;sockets.add(socket);socket.on('close',()=>sockets.delete(socket));let buffer='',data=false;socket.write('220 fixture SMTP\r\n');
 socket.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\r\n'))>=0){const line=buffer.slice(0,end);buffer=buffer.slice(end+2);if(data){if(line==='.') {data=false;messages++;socket.write('250 queued\r\n');}continue;}
 if(/^EHLO/.test(line))socket.write('250-fixture\r\n250 AUTH PLAIN\r\n');else if(/^AUTH/.test(line)){auths++;socket.write('235 authenticated\r\n');}else if(/^DATA/.test(line)){data=true;socket.write('354 send data\r\n');}else if(/^QUIT/.test(line))socket.end('221 bye\r\n');else socket.write('250 ok\r\n');}});});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const db=new Database(':memory:');
 const mailer=createReliableMailer(db,nodemailer,{host:'127.0.0.1',port:server.address().port,secure:false,ignoreTLS:true,auth:{user:'fixture',pass:'synthetic'}},{noTimer:true});
 try {await Promise.all(Array.from({length:3},(_,i)=>mailer.sendMail({from:'fixture@local.test',to:i+'@local.test',subject:'SMTP test',text:'fixture'})));assert.equal(messages,3);assert.equal(connections,1);assert.equal(auths,1);console.log('PASS real Nodemailer SMTP fixture: 3 messages, 1 connection, 1 authentication');}
 finally{mailer.close();for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
