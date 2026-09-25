// Explicitly enabled only on the isolated Render acceptance-test service.
if (/(^|[\\/])server\.js$/.test(process.argv[1] || '')) {
const targetService = 'srv-dar9q28473hc73acdqdg';
if (process.env.RENDER_SERVICE_ID !== targetService) {
  throw new Error('Test account setup is restricted to the isolated test service');
}
const email = process.env.TEST_ACCOUNT_EMAIL;
const password = process.env.TEST_ACCOUNT_PASSWORD;
if (!email || !password) throw new Error('Test account credentials are required');
const { initDB } = require('../database');
const bcrypt = require('bcryptjs');
const { randomUUID } = require('crypto');
const db = initDB();
const existing = db.prepare('SELECT id FROM users WHERE email=?').get(email);
if (!existing) {
  db.prepare('INSERT INTO users (id,email,password_hash,display_name,tier,is_private,findable,newsletter_subscribed) VALUES (?,?,?,?,?,1,0,0)')
    .run(randomUUID(), email, bcrypt.hashSync(password, 10), 'Christina — Testing', 'starter');
} else {
  db.prepare("UPDATE users SET tier='starter' WHERE id=?").run(existing.id);
}
db.close();
}
