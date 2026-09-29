// Synthetic fixtures only. Never import database.js (it opens a fixed data path).
const schema = require('./schema.json');

function createFixture(db, { legacy = false } = {}) {
  db.pragma('foreign_keys = ON');
  for (const table of schema.tables) {
    let sql = table.sql;
    // Historical shapes before nullable custom glazes and the Underglaze option.
    if (legacy && table.name === 'piece_glazes') sql = sql.replace('glaze_id TEXT,', 'glaze_id TEXT NOT NULL,');
    if (legacy && table.name === 'test_tiles') sql = sql.replace("'underglaze', ", '').replace("'underglaze',", '');
    db.exec(sql);
  }
  for (const owner of ['a', 'b']) {
    db.prepare(`INSERT INTO users(id,email,password_hash,tier,stripe_customer_id,stripe_subscription_id)
      VALUES(?,?,?,'starter',?,?)`).run(owner, `${owner}@example.invalid`, 'synthetic-hash', `customer-${owner}`, `subscription-${owner}`);
    db.prepare('INSERT INTO clay_bodies(id,user_id,name) VALUES(?,?,?)').run(`clay-${owner}`, owner, 'Same name');
    db.prepare('INSERT INTO glazes(id,user_id,name) VALUES(?,?,?)').run(`glaze-${owner}`, owner, 'Same name');
    db.prepare('INSERT INTO glaze_chemicals(id,user_id,name,quantity,unit) VALUES(?,?,?,12.5,?)').run(`material-${owner}`, owner, 'Silica', 'g');
    db.prepare('INSERT INTO glaze_ingredients(id,glaze_id,ingredient_name,amount) VALUES(?,?,?,?)').run(`ingredient-${owner}`, `glaze-${owner}`, 'Silica', '10 g');
    for (const suffix of ['', '-2']) {
      db.prepare('INSERT INTO pieces(id,user_id,title,clay_body_id) VALUES(?,?,?,?)').run(`piece-${owner}${suffix}`, owner, 'Same name', `clay-${owner}`);
    }
    db.prepare('INSERT INTO piece_glazes(id,piece_id,glaze_id,layer_order) VALUES(?,?,?,0)').run(`layer-${owner}`, `piece-${owner}`, `glaze-${owner}`);
    if (!legacy) db.prepare('INSERT INTO piece_glazes(id,piece_id,custom_name,layer_order) VALUES(?,?,?,1)').run(`custom-${owner}`, `piece-${owner}`, 'Handwritten glaze');
    db.prepare('INSERT INTO firing_logs(id,user_id,piece_id,notes) VALUES(?,?,?,?)').run(`firing-${owner}`, owner, `piece-${owner}`, 'Original firing');
    db.prepare('INSERT INTO test_tiles(id,user_id,clay_name,glaze_name,photo_filename,photo_filename2,photo_filename3) VALUES(?,?,?,?,?,?,?)')
      .run(`tile-${owner}`, owner, 'Historical clay', 'Historical glaze', `tile-${owner}.jpg`, `tile-${owner}-2.jpg`, `tile-${owner}-3.jpg`);
    db.prepare('INSERT INTO glaze_clay_tests(id,glaze_id,clay_name,photo_filename) VALUES(?,?,?,?)').run(`test-${owner}`, `glaze-${owner}`, 'Typed clay', `test-${owner}.jpg`);
    db.prepare('INSERT INTO pricing_calculations(id,user_id,inputs_json,result_json,photo_filename) VALUES(?,?,?,?,?)')
      .run(`pricing-${owner}`, owner, '{"hours":2}', '{"price":31.95}', `pricing-${owner}.jpg`);
    db.prepare('INSERT INTO sales(id,user_id,piece_id,price,quantity,image_filename) VALUES(?,?,?,1.5,2,?)')
      .run(`sale-${owner}`, owner, `piece-${owner}`, `sale-${owner}.jpg`);
    for (const [table, column, parent] of [['piece_photos', 'piece_id', 'piece'], ['clay_photos', 'clay_id', 'clay'], ['glaze_photos', 'glaze_id', 'glaze'], ['firing_photos', 'firing_id', 'firing']]) {
      db.prepare(`INSERT INTO ${table}(id,${column},filename) VALUES(?,?,?)`).run(`${parent}-photo-${owner}`, `${parent}-${owner}`, `${parent}-${owner}.jpg`);
    }
  }
  db.prepare('INSERT INTO pieces(id,user_id,title) VALUES(?,?,?)').run('unlinked', 'a', 'No relationships');
}

function snapshot(db) {
  return schema.tables.map(({ name }) => ({
    name,
    sql: db.prepare('SELECT sql FROM sqlite_master WHERE type=? AND name=?').get('table', name).sql,
    rows: db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()
  }));
}

module.exports = { createFixture, snapshot };
