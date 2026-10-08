'use strict';
// Disposable, loopback-only test account. Never imports a production DB or keys.
const fixture=require('./fixture.cjs'),crypto=require('node:crypto'),bcrypt=require('bcryptjs');
(async()=>{
 await fixture.start('1','1','1');
 const password=crypto.randomBytes(18).toString('base64url');
 fixture.state.db.prepare("UPDATE users SET password_hash=? WHERE id='a'").run(bcrypt.hashSync(password,10));
 console.log('Synthetic QL Assistant test only. Expected latest firing: 2026-10-01.');
 console.log('Local URL: '+fixture.state.base+'/#qlAssistant');
 console.log('Email: a@example.invalid');console.log('Temporary password: '+password);
 console.log('Loopback HTTP is not an iPhone test link. Use only a trusted, isolated HTTPS staging route for an iPhone test; no production database or secrets.');
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{await fixture.stop();process.exit()});
})().catch(async e=>{console.error(e);await fixture.stop();process.exitCode=1});
