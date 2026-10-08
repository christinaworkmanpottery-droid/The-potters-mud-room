const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const Database=require('better-sqlite3'),jwt=require('jsonwebtoken');
const root=path.resolve(__dirname,'..');
const unusedAppSource=fs.readFileSync(path.join(root,'public/app.js'),'utf8');
const serverSource=fs.readFileSync(path.join(root,'server.js'),'utf8');
let tmp,server,db,base,secret,tokenA,tokenB,log='';
async function start(){
 tmp=fs.mkdtempSync(path.join(os.tmpdir(),'ql-profile-media-'));
 for(const n of ['server.js','database.js','iap.js','directory-search.js','calendar-export.js','deletion-lifecycle.cjs'])fs.copyFileSync(path.join(root,n),path.join(tmp,n));
 fs.mkdirSync(path.join(tmp,'ql'));for(const n of ['relationships.cjs','piece-history.cjs','piece-editor.cjs','photo-query-safety.cjs','photo-result-confidence.cjs'])fs.copyFileSync(path.join(root,'ql',n),path.join(tmp,'ql',n));
 fs.cpSync(path.join(root,'geodata'),path.join(tmp,'geodata'),{recursive:true});fs.symlinkSync(path.join(root,'node_modules'),path.join(tmp,'node_modules'),'dir');fs.mkdirSync(path.join(tmp,'public/shop'),{recursive:true});fs.copyFileSync(path.join(root,'public/website-utils.js'),path.join(tmp,'public/website-utils.js'));for(const n of ['mud-log-preview.pdf','the-potters-mud-log.pdf'])fs.copyFileSync(path.join(root,'public/shop',n),path.join(tmp,'public/shop',n));
 const port=44000+crypto.randomInt(1000);base='http://127.0.0.1:'+port;secret=crypto.randomBytes(32).toString('hex');
 server=spawn(process.execPath,['server.js'],{cwd:tmp,env:{PATH:process.env.PATH,PORT:String(port),JWT_SECRET:secret,NODE_ENV:'test'},stdio:['ignore','pipe','pipe']});
 server.stdout.on('data',c=>log+=c);server.stderr.on('data',c=>log+=c);
 for(let i=0;i<120&&!log.includes('running on');i++)await new Promise(r=>setTimeout(r,100));assert.ok(log.includes('running on'),log);
 db=new Database(path.join(tmp,'data/pottery.db'));tokenA=jwt.sign({userId:'a'},secret);tokenB=jwt.sign({userId:'b'},secret);
 db.prepare("INSERT INTO users(id,email,password_hash) VALUES('a','a@example.com','x'),('b','b@example.com','x')").run();
 db.prepare("INSERT INTO pieces(id,user_id,title,is_public) VALUES('private-a','a','Private A',0),('public-a','a','Public A',1),('private-b','b','Private B',0),('ambiguous-a','a','Ambiguous A',NULL)").run();
 db.prepare("INSERT INTO piece_photos(id,piece_id,filename,original_name,stage,sort_order) VALUES('photo-private-a','private-a','private-a.jpg','a.jpg','finished',0),('photo-public-a','public-a','public-a.jpg','p.jpg','finished',0),('photo-private-b','private-b','private-b.jpg','b.jpg','finished',0),('photo-ambiguous-a','ambiguous-a','ambiguous-a.jpg','x.jpg','finished',0)").run();
 const up=path.join(tmp,'data/uploads');for(const n of ['private-a.jpg','public-a.jpg','private-b.jpg','ambiguous-a.jpg'])fs.writeFileSync(path.join(up,n),'fixture-'+n);
}
async function stop(){if(db)db.close();if(server&&server.exitCode===null){const p=new Promise(r=>server.once('exit',r));server.kill();await p}if(tmp)fs.rmSync(tmp,{recursive:true,force:true});}
test.after(stop);
const auth=t=>({Authorization:'Bearer '+t});


let adminToken,jpeg;
const up=()=>path.join(tmp,'data/uploads');
const req=(route,token,opts={})=>fetch(base+route,{...opts,headers:{...(token?auth(token):{}),...opts.headers}});
const image=(id='catalog',priv=false)=>'/api/ql/shop/products/'+id+'/image'+(priv?'':'/public');
const download=id=>'/api/shop/download/'+id;
const product=id=>db.prepare('SELECT * FROM merchant_products WHERE id=?').get(id);
async function mutation(id,token=adminToken,fields={},bytes=jpeg){const fd=new FormData();for(const[k,v]of Object.entries(fields))fd.append(k,v);if(bytes)fd.append('image',new Blob([bytes],{type:'image/jpeg'}),'new.jpg');return req('/api/shop/products'+(id?'/'+id:''),token,{method:id?'PUT':'POST',body:fd});}
test.before(async()=>{
 await start();jpeg=await require('sharp')({create:{width:2,height:2,channels:3,background:'red'}}).jpeg().toBuffer();
 db.prepare("INSERT INTO users(id,email,password_hash) VALUES('admin','christinaworkmanpottery@gmail.com','x')").run();adminToken=jwt.sign({userId:'admin'},secret);
 const insert=db.prepare('INSERT INTO merchant_products(id,name,price,product_type,image_filename,download_filename,is_digital,is_active) VALUES(?,?,3,?,?,?,?,?)');
 insert.run('catalog','Catalog','pdf','catalog.jpg','paid.pdf',1,1);insert.run('draft','Draft','other','draft.jpg',null,0,0);insert.run('ambiguous','Ambiguous','other','ambiguous.jpg',null,0,null);
 insert.run('bundled','Bundled','pdf',null,'the-potters-mud-log.pdf',1,1);insert.run('unbound','Unbound','pdf',null,null,1,1);insert.run('physical','Physical','sticker',null,'paid-other.pdf',0,1);
 for(const n of ['catalog.jpg','draft.jpg','ambiguous.jpg'])fs.writeFileSync(path.join(up(),n),jpeg);
 fs.writeFileSync(path.join(up(),'paid.pdf'),'paid-A');fs.writeFileSync(path.join(up(),'paid-other.pdf'),'paid-B');
 const order=db.prepare('INSERT INTO merchant_orders(id,user_id,product_id,status) VALUES(?,?,?,?)');
 for(const[id,p,status]of [['oa','catalog','completed'],['oa2','catalog','completed'],['refund','catalog','refunded'],['cancel','catalog','cancelled'],['pending','catalog','pending'],['bundle','bundled','completed'],['unbound','unbound','completed'],['physical','physical','completed']])order.run(id,'a',p,status);
});
test('anonymous catalog image with public revalidation and nosniff',async()=>{const r=await req(image());assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),jpeg);assert.equal(r.headers.get('cache-control'),'public, max-age=0, must-revalidate');assert.equal(r.headers.get('x-content-type-options'),'nosniff');});
for(const id of ['draft','ambiguous','missing'])test(id+' is not exposed via public image route',async()=>assert.equal((await req(image(id))).status,404));
test('merchant admin can read inactive private image with private headers',async()=>{const r=await req(image('draft',true),adminToken);assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/private, no-store/);});
test('foreign logged-in member has generic missing behavior',async()=>{const a=await req(image('draft',true),tokenA),b=await req(image('missing',true),tokenA);assert.equal(a.status,404);assert.equal(await a.text(),await b.text());});
test('private route requires authentication',async()=>assert.equal((await req(image('draft',true))).status,401));
test('public and private collision blocks both routes',async()=>{db.prepare("UPDATE merchant_products SET image_filename='catalog.jpg' WHERE id='draft'").run();try{for(const [id,t,priv]of [['catalog',null,false],['draft',adminToken,true]])assert.equal((await req(image(id,priv),t)).status,404);}finally{db.prepare("UPDATE merchant_products SET image_filename='draft.jpg' WHERE id='draft'").run();}});
test('catalog image versus original collision fails closed',async()=>{db.prepare("UPDATE merchant_products SET download_filename='catalog.jpg' WHERE id='catalog'").run();try{assert.equal((await req(image())).status,404);assert.equal((await req(download('oa'),tokenA)).status,404);}finally{db.prepare("UPDATE merchant_products SET download_filename='paid.pdf' WHERE id='catalog'").run();}});
test('other media category collision blocks shop image',async()=>{db.prepare("UPDATE users SET avatar_filename='catalog.jpg' WHERE id='b'").run();try{assert.equal((await req(image())).status,404);}finally{db.prepare("UPDATE users SET avatar_filename=NULL WHERE id='b'").run();}});
test('path traversal and symlink metadata are unavailable',async()=>{fs.symlinkSync(path.join(up(),'catalog.jpg'),path.join(up(),'link.jpg'));for(const f of ['../catalog.jpg','link.jpg']){db.prepare('UPDATE merchant_products SET image_filename=? WHERE id=?').run(f,'draft');assert.equal((await req(image('draft',true),adminToken)).status,404);}db.prepare("UPDATE merchant_products SET image_filename='draft.jpg' WHERE id='draft'").run();});
test('public product JSON omits downloadable original filename',async()=>{for(const route of ['/api/shop/products','/api/shop/products/catalog']){const r=await req(route);const value=await r.text();assert.doesNotMatch(value,/download_filename|paid.pdf/);assert.match(value,/image\/public/);}});
test('preview remains anonymous and distinct from original',async()=>{const r=await req('/shop/mud-log-preview.pdf');assert.equal(r.status,200);assert.deepEqual(Buffer.from(await r.arrayBuffer()),fs.readFileSync(path.join(root,'public/shop/mud-log-preview.pdf')));assert.equal((await req('/shop/the-potters-mud-log.pdf')).status,404);assert.equal((await req('/shop/%74he-potters-mud-log.pdf')).status,404);});
test('valid purchaser receives exact entitled bytes and safe headers',async()=>{const r=await req(download('oa'),tokenA);assert.equal(r.status,200);assert.equal(await r.text(),'paid-A');assert.match(r.headers.get('content-disposition'),/^attachment/);assert.equal(r.headers.get('referrer-policy'),'no-referrer');assert.match(r.headers.get('cache-control'),/private, no-store/);});
for(const [name,t]of [['anonymous',()=>null],['wrong purchaser',()=>tokenB],['merchant without purchase',()=>adminToken]])test(name+' cannot download',async()=>assert.equal((await req(download('oa'),t())).status,404));
for(const id of ['refund','cancel','pending','physical','unbound','missing'])test(id+' order has no valid download entitlement',async()=>assert.equal((await req(download(id),tokenA)).status,404));
test('client supplied user product file and order IDs do not authorize',async()=>{assert.equal((await req(download('oa')+'?userId=a&productId=catalog&filename=paid.pdf&orderId=oa',tokenB)).status,404);const r=await req(download('oa')+'?filename=paid-other.pdf',tokenA);assert.equal(await r.text(),'paid-A');});
test('multiple purchases and repeated requests independently reauthorize',async()=>{for(const id of ['oa','oa2','oa'])assert.equal((await req(download(id),tokenA)).status,200);});
test('unpublishing preserves completed purchase but hides catalog',async()=>{db.prepare("UPDATE merchant_products SET is_active=0 WHERE id='catalog'").run();try{assert.equal((await req(image())).status,404);assert.equal((await req(download('oa'),tokenA)).status,200);}finally{db.prepare("UPDATE merchant_products SET is_active=1 WHERE id='catalog'").run();}});
test('signed email grant works only for exact order and expires',async()=>{const grant=jwt.sign({orderId:'oa',userId:'a'},secret,{expiresIn:'30d'});assert.equal((await req(download('oa')+'?token='+grant)).status,200);assert.equal((await req(download('oa2')+'?token='+grant)).status,404);assert.equal((await req(download('oa')+'?token='+grant,tokenB)).status,404);const expired=jwt.sign({orderId:'oa',userId:'a'},secret,{expiresIn:-1});assert.equal((await req(download('oa')+'?token='+expired)).status,404);});
test('order grant in bearer cannot be used for another order',async()=>{const grant=jwt.sign({orderId:'oa',userId:'a'},secret);assert.equal((await req(download('oa2'),grant)).status,404);});
test('shared original across products fails closed',async()=>{db.prepare("UPDATE merchant_products SET download_filename='paid.pdf' WHERE id='unbound'").run();try{assert.equal((await req(download('oa'),tokenA)).status,404);assert.equal((await req(download('unbound'),tokenA)).status,404);}finally{db.prepare("UPDATE merchant_products SET download_filename=NULL WHERE id='unbound'").run();}});
test('preview cannot substitute for original',async()=>{db.prepare("UPDATE merchant_products SET download_filename='mud-log-preview.pdf' WHERE id='unbound'").run();try{assert.equal((await req(download('unbound'),tokenA)).status,404);}finally{db.prepare("UPDATE merchant_products SET download_filename=NULL WHERE id='unbound'").run();}});
test('bundled original requires explicit product relationship',async()=>{const r=await req(download('bundle'),tokenA);assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/pdf/);assert.equal(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),require('../ql/shop-release-asset.json').sha256);});
test('original resolver rejects two storage candidates',async()=>{fs.writeFileSync(path.join(up(),'the-potters-mud-log.pdf'),'different');try{assert.equal((await req(download('bundle'),tokenA)).status,404);}finally{fs.unlinkSync(path.join(up(),'the-potters-mud-log.pdf'));}});
test('deleted product order fails closed without rewriting order',async()=>{db.pragma('foreign_keys=OFF');const p=product('physical');db.prepare("DELETE FROM merchant_products WHERE id='physical'").run();try{assert.equal((await req(download('physical'),tokenA)).status,404);assert.ok(db.prepare("SELECT 1 FROM merchant_orders WHERE id='physical'").get());}finally{db.prepare('INSERT INTO merchant_products(id,name,price,product_type,is_digital) VALUES(?,?,?,?,?)').run(p.id,p.name,p.price,p.product_type,p.is_digital);db.pragma('foreign_keys=ON');}});
test('global uploads stays unrestricted including known paid upload',async()=>{const r=await req('/uploads/paid.pdf');assert.equal(r.status,200);assert.equal(await r.text(),'paid-A');});
test('foreign mutation denied before upload and ignores forged owner fields',async()=>{const before=fs.readdirSync(up());assert.equal((await mutation('catalog',tokenB,{ownerId:'admin',userId:'admin'})).status,404);assert.equal((await mutation(null,tokenB,{name:'bad',price:'3'})).status,404);assert.deepEqual(fs.readdirSync(up()),before);});
test('missing mutation target rejected before upload',async()=>assert.equal((await mutation('missing')).status,404));
test('malformed image is cleaned without changing product',async()=>{const before=product('draft'),files=fs.readdirSync(up());assert.equal((await mutation('draft',adminToken,{},Buffer.from('not image'))).status,400);assert.deepEqual(product('draft'),before);assert.deepEqual(fs.readdirSync(up()),files);});
test('replacement preserves original and unrelated media with shared-file retention',async()=>{db.prepare("UPDATE users SET profile_photo='draft.jpg' WHERE id='a'").run();const original=product('catalog').download_filename;assert.equal((await mutation('draft')).status,200);assert.ok(fs.existsSync(path.join(up(),'draft.jpg')));assert.equal(product('catalog').download_filename,original);assert.notEqual(product('draft').image_filename,'draft.jpg');});
test('replacement removes unreferenced previous file after commit',async()=>{const old=product('draft').image_filename;assert.equal((await mutation('draft')).status,200);assert.ok(!fs.existsSync(path.join(up(),old)));assert.ok(fs.existsSync(path.join(up(),product('draft').image_filename)));});
test('failed database replacement rolls back and cleans new upload',async()=>{const before=product('draft'),files=fs.readdirSync(up());db.exec("CREATE TRIGGER shop_abort BEFORE UPDATE ON merchant_products BEGIN SELECT RAISE(ABORT,'fixture'); END");try{assert.equal((await mutation('draft')).status,400);assert.deepEqual(product('draft'),before);assert.deepEqual(fs.readdirSync(up()),files);}finally{db.exec('DROP TRIGGER shop_abort');}});
test('unpublish has no physical deletion and correctly parses false',async()=>{const old=product('draft').image_filename;assert.equal((await mutation('draft',adminToken,{isActive:'false'},null)).status,200);assert.equal(product('draft').is_active,0);assert.ok(fs.existsSync(path.join(up(),old)));});
test('creating product never accepts client original filename',async()=>{const r=await mutation(null,adminToken,{name:'new',price:'4',isDigital:'false',download_filename:'paid.pdf'});assert.equal(r.status,200);const {id}=await r.json();assert.equal(product(id).download_filename,null);assert.equal(product(id).is_digital,0);});
function actualUpdateHandler(cleanup) {
 const handlers={},context={app:{post(){},put:(url,...f)=>handlers.update=f.at(-1)},auth(){},requireShopAdmin(){},shopUpload(){},db,uuidv4:()=>crypto.randomUUID(),deletionLifecycle:{cleanupFiles:cleanup},cleanupRequestUploads:files=>require('../deletion-lifecycle.cjs').createDeletionLifecycle(db,up()).cleanupFiles(files.filter(Boolean).map(f=>f.filename))};
 require('node:vm').runInNewContext(serverSource.slice(serverSource.indexOf('function shopBoolean('),serverSource.indexOf('// My Purchases')),context);
 return handlers.update;
}
for(const failure of ['cleanup','response'])test('committed replacement survives '+failure+' failure',()=>{
 const filename='committed-'+failure+'.jpg';fs.writeFileSync(path.join(up(),filename),jpeg);
 const handler=actualUpdateHandler(()=>{assert.equal(product('draft').image_filename,filename);if(failure==='cleanup')throw Error('cleanup');});
 const response={headersSent:false,status(){return this},json(){if(failure==='response')throw Error('transport')}};
 try{handler({params:{id:'draft'},body:{},file:{filename}},response);}catch(e){assert.equal(e.message,'transport');}
 assert.equal(product('draft').image_filename,filename);assert.ok(fs.existsSync(path.join(up(),filename)));
});
test('order-scoped email grant cannot become a merchant editing credential',async()=>{const grant=jwt.sign({orderId:'oa',userId:'admin'},secret);assert.equal((await req(image('draft',true),grant)).status,404);});
test('deleted purchaser cannot use signed email entitlement',async()=>{db.prepare("INSERT INTO users(id,email,password_hash) VALUES('gone','gone@example.com','x')").run();db.prepare("INSERT INTO merchant_orders(id,user_id,product_id,status) VALUES('gone-order','gone','catalog','completed')").run();db.pragma('foreign_keys=OFF');db.prepare("DELETE FROM users WHERE id='gone'").run();db.pragma('foreign_keys=ON');const grant=jwt.sign({orderId:'gone-order',userId:'gone'},secret);assert.equal((await req(download('gone-order')+'?token='+grant)).status,404);});
function merchantWebhook(payment_status,id) {
 const a=serverSource.indexOf("} else if (purchaseType === 'merchant') {")+7,b=serverSource.indexOf("} else if (purchaseType === 'ai_tokens')",a);
 const context={purchaseType:'merchant',session:{payment_status,id,metadata:{productId:'catalog'},amount_total:300},userId:'a',db,uuidv4:()=>crypto.randomUUID(),APP_URL:'https://fixture.invalid',JWT_SECRET:secret,process:{env:{}},console,require:name=>name==='nodemailer'?{createTransport:()=>({sendMail:async()=>{}})}:require(name)};
 require('node:vm').runInNewContext("switch('event'){case 'event': "+serverSource.slice(a,b)+"}}",context);
 return db.prepare('SELECT * FROM merchant_orders WHERE stripe_session_id=?').all(id);
}
test('merchant checkout completion without payment creates no entitlement',()=>{assert.equal(merchantWebhook('unpaid','unpaid-session').length,0);});
test('paid merchant completion is idempotent for repeated webhook',()=>{assert.equal(merchantWebhook('paid','paid-session').length,1);assert.equal(merchantWebhook('paid','paid-session').length,1);});
test('fully discounted completed checkout retains entitlement',()=>assert.equal(merchantWebhook('no_payment_required','free-session').length,1));

// Release-asset authorization checks use the recovered original, not synthetic PDF bytes.
for(const [label,token] of [['anonymous',()=>null],['wrong purchaser',()=>tokenB],['merchant without purchase',()=>adminToken]])test('tracked original denies '+label,async()=>assert.equal((await req(download('bundle'),token())).status,404));
test('tracked original denies pending order',async()=>{db.prepare("UPDATE merchant_orders SET status='pending' WHERE id='bundle'").run();try{assert.equal((await req(download('bundle'),tokenA)).status,404);}finally{db.prepare("UPDATE merchant_orders SET status='completed' WHERE id='bundle'").run();}});
test('tracked original denies wrong order grant',async()=>{const grant=jwt.sign({orderId:'oa',userId:'a'},secret);assert.equal((await req(download('bundle')+'?token='+grant)).status,404);});
test('tracked original cannot replace unbound product via query',async()=>assert.equal((await req(download('unbound')+'?productId=bundled&filename=the-potters-mud-log.pdf',tokenA)).status,404));
test('tracked original preview has separate hash and PDF MIME',async()=>{const r=await req('/shop/mud-log-preview.pdf');assert.equal(r.status,200);assert.match(r.headers.get('content-type'),/application\/pdf/);assert.notEqual(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),require('../ql/shop-release-asset.json').sha256);});
test('tracked original remains purchased after unpublishing',async()=>{db.prepare("UPDATE merchant_products SET is_active=0 WHERE id='bundled'").run();try{assert.equal((await req('/api/shop/products/bundled')).status,404);const r=await req(download('bundle'),tokenA);assert.equal(r.status,200);assert.equal(crypto.createHash('sha256').update(Buffer.from(await r.arrayBuffer())).digest('hex'),require('../ql/shop-release-asset.json').sha256);}finally{db.prepare("UPDATE merchant_products SET is_active=1 WHERE id='bundled'").run();}});
