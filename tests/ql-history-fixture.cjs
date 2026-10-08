const Database=require('better-sqlite3');
const {migrate}=require('../ql/relationships.cjs');
function fixture(t,migrated=true){const db=new Database(':memory:');t.after(()=>db.close());db.pragma('foreign_keys=ON');
 db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY);CREATE TABLE pieces(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,clay_body_id TEXT,date_started TEXT,created_at TEXT);
 CREATE TABLE clay_bodies(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT,created_at TEXT);
 CREATE TABLE glazes(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT,brand TEXT,glaze_type TEXT,created_at TEXT);
 CREATE TABLE piece_glazes(id TEXT PRIMARY KEY,piece_id TEXT NOT NULL,glaze_id TEXT,coats INTEGER,application_method TEXT,layer_order INTEGER,notes TEXT,custom_name TEXT);
 CREATE TABLE firing_logs(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,piece_id TEXT,date TEXT,notes TEXT,created_at TEXT);
 CREATE TABLE test_tiles(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT,glaze_name TEXT,clay_name TEXT,created_at TEXT);
 CREATE TABLE pricing_calculations(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,name TEXT,inputs_json TEXT NOT NULL,result_json TEXT NOT NULL,created_at TEXT);
 CREATE TABLE contacts(id TEXT PRIMARY KEY,user_id TEXT NOT NULL);
 CREATE TABLE sales(id TEXT PRIMARY KEY,user_id TEXT NOT NULL,piece_id TEXT,date TEXT,price REAL,contact_id TEXT,created_at TEXT);
 CREATE TABLE piece_photos(id TEXT PRIMARY KEY,piece_id TEXT NOT NULL,filename TEXT,original_name TEXT,stage TEXT,sort_order INTEGER,created_at TEXT);`);
 for(const u of ['a','b'])db.prepare('INSERT INTO users VALUES(?)').run(u);
 if(migrated)migrate(db);return db;}
function seed(db){db.prepare("INSERT INTO clay_bodies VALUES('clay-a','a','Porcelain','2026-01-01')").run();
 db.prepare("INSERT INTO pieces VALUES('piece-a','a','clay-a','2026-01-02','2026-01-02')").run();
 db.prepare("INSERT INTO pieces VALUES('piece-b','b',NULL,NULL,'2026-01-02')").run();
 db.prepare("INSERT INTO glazes VALUES('glaze-a','a','Blue','Brand','commercial','2026-01-03')").run();
 db.prepare("INSERT INTO glazes VALUES('glaze-b','b','Foreign','Brand','commercial','2026-01-03')").run();
 db.prepare("INSERT INTO piece_glazes VALUES('layer-a','piece-a','glaze-a',2,'brush',1,NULL,NULL)").run();
 db.prepare("INSERT INTO piece_glazes VALUES('manual-a','piece-a',NULL,3,'brush',2,'note','Hand mixed')").run();
 db.prepare("INSERT INTO firing_logs VALUES('fire-legacy','a','piece-a','2026-02-01','legacy','2026-02-01')").run();
 db.prepare("INSERT INTO firing_logs VALUES('fire-shared','a',NULL,'2026-03-01','shared','2026-03-01')").run();
 db.prepare("INSERT INTO firing_logs VALUES('fire-b','b',NULL,'2026-03-02','foreign','2026-03-02')").run();
 db.prepare("INSERT INTO test_tiles VALUES('tile-a','a','Tile','Blue','Porcelain','2026-02-10')").run();
 db.prepare("INSERT INTO pricing_calculations VALUES('price-a','a','Retail','{}','{}','2026-02-15')").run();
 db.prepare("INSERT INTO sales VALUES('sale-a','a','piece-a','2026-04-01',75,NULL,'2026-04-01')").run();
 db.prepare("INSERT INTO piece_photos VALUES('photo-a','piece-a','a.jpg','original.jpg','finished',0,'2026-01-05')").run();}

module.exports={fixture,seed};
