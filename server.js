const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { initDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pottery-app-dev-secret-change-in-prod';
const db = initDB();

// Stripe setup (optional — works without keys, just disables payments)
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
let stripe = null;
if (STRIPE_SECRET) {
  stripe = require('stripe')(STRIPE_SECRET);
}

const UPLOADS_DIR = path.join(__dirname, 'data', 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const allowed = /jpeg|jpg|png|gif|webp|heic|mp4|mov|webm/;
    cb(null, allowed.test(ext) || file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/'));
  }
});

// Stripe webhook needs raw body — must be BEFORE express.json()
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), (req, res) => {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return res.status(400).send('Stripe not configured');
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, req.headers['stripe-signature'], STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook sig verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      const purchaseType = session.metadata?.purchaseType;
      if (!userId) break;

      if (purchaseType === 'subscription') {
        const tier = session.metadata.tier;
        db.prepare('UPDATE users SET tier=?, stripe_customer_id=?, stripe_subscription_id=? WHERE id=?')
          .run(tier, session.customer, session.subscription, userId);
        // Top tier gets 10 free tokens monthly
        if (tier === 'top') {
          db.prepare('UPDATE users SET forum_tokens = forum_tokens + 10 WHERE id=?').run(userId);
        }
      } else if (purchaseType === 'token_pack') {
        const amount = parseInt(session.metadata.tokenAmount) || 0;
        db.prepare('UPDATE users SET forum_tokens = forum_tokens + ? WHERE id=?').run(amount, userId);
        db.prepare('INSERT INTO token_purchases (id, user_id, amount, price_paid, purchase_type) VALUES (?,?,?,?,?)')
          .run(uuidv4(), userId, amount, session.amount_total / 100, 'pack');
      } else if (purchaseType === 'unlimited_pass') {
        const until = new Date();
        until.setDate(until.getDate() + 30);
        db.prepare('UPDATE users SET unlimited_tokens_until=? WHERE id=?').run(until.toISOString(), userId);
        db.prepare('INSERT INTO token_purchases (id, user_id, amount, price_paid, purchase_type) VALUES (?,?,?,?,?)')
          .run(uuidv4(), userId, 0, session.amount_total / 100, 'unlimited_30day');
      } else if (purchaseType === 'merchant') {
        // Record merchant purchase
        const productId = session.metadata.productId;
        db.prepare('INSERT INTO merchant_orders (id, user_id, product_id, price_paid, status, stripe_session_id) VALUES (?,?,?,?,?,?)')
          .run(uuidv4(), userId, productId, session.amount_total / 100, 'completed', session.id);
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      const user = db.prepare('SELECT id FROM users WHERE stripe_subscription_id=?').get(sub.id);
      if (user && sub.status !== 'active' && sub.status !== 'trialing') {
        db.prepare('UPDATE users SET tier=? WHERE id=?').run('free', user.id);
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      const user = db.prepare('SELECT id FROM users WHERE stripe_subscription_id=?').get(sub.id);
      if (user) {
        db.prepare('UPDATE users SET tier=?, stripe_subscription_id=NULL WHERE id=?').run('free', user.id);
      }
      break;
    }
  }
  res.json({ received: true });
});

app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(UPLOADS_DIR));
app.use(express.static(path.join(__dirname, 'public')));

// Auth middleware
function auth(req, res, next) {
  const t = req.headers.authorization?.replace('Bearer ', '');
  if (!t) return res.status(401).json({ error: 'Not authenticated' });
  try { const d = jwt.verify(t, JWT_SECRET); req.userId = d.userId; req.userTier = d.tier; next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}
// Refresh tier from DB (since Stripe might have updated it)
function refreshTier(req, res, next) {
  const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  if (u) req.userTier = u.tier;
  next();
}
function requireTier(min) {
  const lv = { free: 0, basic: 1, mid: 2, top: 3 };
  return (req, res, next) => {
    const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
    const currentTier = u?.tier || req.userTier;
    if (lv[currentTier] >= lv[min]) { req.userTier = currentTier; return next(); }
    res.status(403).json({ error: `Requires ${min} tier or above` });
  };
}
function getPieceCount(uid) { return db.prepare('SELECT COUNT(*) as c FROM pieces WHERE user_id=?').get(uid).c; }

// ============ AUTH ============
app.post('/api/auth/register', (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Email already registered' });
    const id = uuidv4(), hash = bcrypt.hashSync(password, 10);
    db.prepare('INSERT INTO users (id,email,password_hash,display_name) VALUES (?,?,?,?)').run(id, email, hash, displayName || email.split('@')[0]);
    const token = jwt.sign({ userId: id, tier: 'free' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, email, displayName: displayName || email.split('@')[0], tier: 'free' } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body;
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ userId: u.id, tier: u.tier }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: u.id, email: u.email, displayName: u.display_name, tier: u.tier } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/me', auth, (req, res) => {
  const u = db.prepare('SELECT id,email,display_name,bio,location,website,avatar_filename,is_private,tier,forum_tokens,unlimited_tokens_until,unit_system,temp_unit,created_at FROM users WHERE id=?').get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  res.json({ user: { ...u, displayName: u.display_name, pieceCount: getPieceCount(req.userId) } });
});

// ============ USER PROFILE ============
app.put('/api/profile', auth, (req, res) => {
  const { displayName, bio, location, website, isPrivate, unitSystem, tempUnit } = req.body;
  db.prepare(`UPDATE users SET display_name=?,bio=?,location=?,website=?,is_private=?,unit_system=?,temp_unit=?,updated_at=datetime('now') WHERE id=?`)
    .run(displayName, bio, location, website, isPrivate ? 1 : 0, unitSystem || 'imperial', tempUnit || 'fahrenheit', req.userId);
  res.json({ success: true });
});

app.post('/api/profile/avatar', auth, upload.single('avatar'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const old = db.prepare('SELECT avatar_filename FROM users WHERE id=?').get(req.userId);
  if (old?.avatar_filename) { const p = path.join(UPLOADS_DIR, old.avatar_filename); if (fs.existsSync(p)) fs.unlinkSync(p); }
  db.prepare('UPDATE users SET avatar_filename=? WHERE id=?').run(req.file.filename, req.userId);
  res.json({ filename: req.file.filename });
});

app.get('/api/profile/:id', auth, (req, res) => {
  const u = db.prepare('SELECT id,display_name,bio,location,website,avatar_filename,is_private,tier,created_at FROM users WHERE id=?').get(req.params.id);
  if (!u) return res.status(404).json({ error: 'Not found' });
  const blocked = db.prepare('SELECT id FROM blocked_users WHERE (user_id=? AND blocked_user_id=?) OR (user_id=? AND blocked_user_id=?)').get(req.userId, req.params.id, req.params.id, req.userId);
  if (blocked) return res.status(403).json({ error: 'Blocked' });
  if (u.is_private && u.id !== req.userId) return res.json({ user: { id: u.id, displayName: u.display_name, isPrivate: true } });
  res.json({ user: { ...u, displayName: u.display_name } });
});

app.post('/api/block/:userId', auth, (req, res) => {
  try { db.prepare('INSERT OR IGNORE INTO blocked_users (id,user_id,blocked_user_id) VALUES (?,?,?)').run(uuidv4(), req.userId, req.params.userId); res.json({ success: true }); }
  catch (e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/block/:userId', auth, (req, res) => {
  db.prepare('DELETE FROM blocked_users WHERE user_id=? AND blocked_user_id=?').run(req.userId, req.params.userId);
  res.json({ success: true });
});

// ============ STRIPE BILLING ============
const PRICE_CONFIG = {
  basic: { amount: 995, name: "Basic Plan — $9.95/mo" },
  mid: { amount: 1295, name: "Mid Plan — $12.95/mo" },
  top: { amount: 1995, name: "Top Plan — $19.95/mo" },
  'basic-yearly': { amount: 9500, name: "Basic Plan — $95/year (save $24.40!)", tier: 'basic' },
  'mid-yearly': { amount: 12500, name: "Mid Plan — $125/year (save $30.40!)", tier: 'mid' },
  'top-yearly': { amount: 19000, name: "Top Plan — $190/year (save $49.40!)", tier: 'top' }
};
const TOKEN_PACKS = {
  pack20: { amount: 299, tokens: 20, name: "20 Forum Tokens" },
  pack50: { amount: 499, tokens: 50, name: "50 Forum Tokens" },
  pack120: { amount: 999, tokens: 120, name: "120 Forum Tokens" }
};

app.get('/api/billing/plans', (req, res) => {
  res.json({
    plans: [
      { id: 'free', name: 'Free', price: 0, yearlyPrice: 0, features: ['20 pieces', '1 photo each', 'Personal clay & glaze library', 'Basic search', 'Forum (browse only)', 'Can buy tokens to post'] },
      { id: 'basic', name: 'Basic', price: 9.95, yearlyPrice: 95.00, yearlySavings: 24.40, features: ['Unlimited pieces', '3 photos each', 'Firing logs', 'Forum access (read & post with tokens)', 'Cancel anytime'] },
      { id: 'mid', name: 'Mid', price: 12.95, yearlyPrice: 125.00, yearlySavings: 30.40, features: ['Everything in Basic', 'Glaze recipes', 'Cost tracking', 'Multi-studio', 'Export/print', "Potter's Cheat Sheet", 'Cancel anytime'] },
      { id: 'top', name: 'Top', price: 19.95, yearlyPrice: 190.00, yearlySavings: 49.40, features: ['Everything in Mid', 'Community Glaze Library', 'Sales tracking', 'Import/export data', '10 free tokens/month', 'Cancel anytime'] }
    ],
    tokenPacks: [
      { id: 'pack20', tokens: 20, price: 2.99 },
      { id: 'pack50', tokens: 50, price: 4.99 },
      { id: 'pack120', tokens: 120, price: 9.99 }
    ],
    unlimitedPass: { price: 4.99, days: 30 },
    stripeEnabled: !!stripe
  });
});

app.post('/api/billing/checkout', auth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured yet — coming soon!' });
  const { plan } = req.body;
  const config = PRICE_CONFIG[plan];
  if (!config) return res.status(400).json({ error: 'Invalid plan' });
  const isYearly = plan.includes('-yearly');
  const actualTier = config.tier || plan;

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{
        price_data: {
          currency: 'usd',
          recurring: { interval: isYearly ? 'year' : 'month' },
          product_data: { name: config.name },
          unit_amount: config.amount,
        },
        quantity: 1,
      }],
      metadata: { userId: req.userId, purchaseType: 'subscription', tier: actualTier, billing: isYearly ? 'yearly' : 'monthly' },
      success_url: `${APP_URL}?upgraded=${actualTier}`,
      cancel_url: `${APP_URL}?cancelled=true`,
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/billing/tokens', auth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured yet — coming soon!' });
  const { packId } = req.body;
  const pack = TOKEN_PACKS[packId];
  if (!pack) return res.status(400).json({ error: 'Invalid pack' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: pack.name },
          unit_amount: pack.amount,
        },
        quantity: 1,
      }],
      metadata: { userId: req.userId, purchaseType: 'token_pack', tokenAmount: pack.tokens.toString() },
      success_url: `${APP_URL}?tokens=purchased`,
      cancel_url: `${APP_URL}?cancelled=true`,
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/billing/unlimited-pass', auth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured yet — coming soon!' });
  const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  if (u.tier === 'free') return res.status(403).json({ error: 'Unlimited posting pass requires a paid subscription' });

  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Unlimited Posting Pass — 30 days' },
          unit_amount: 499,
        },
        quantity: 1,
      }],
      metadata: { userId: req.userId, purchaseType: 'unlimited_pass' },
      success_url: `${APP_URL}?pass=purchased`,
      cancel_url: `${APP_URL}?cancelled=true`,
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/billing/cancel', auth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured' });
  const u = db.prepare('SELECT stripe_subscription_id FROM users WHERE id=?').get(req.userId);
  if (!u?.stripe_subscription_id) return res.status(400).json({ error: 'No active subscription' });
  try {
    await stripe.subscriptions.cancel(u.stripe_subscription_id);
    db.prepare('UPDATE users SET tier=?, stripe_subscription_id=NULL WHERE id=?').run('free', req.userId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ ADMIN ============
const ADMIN_EMAIL = 'christinaworkmanpottery@gmail.com';
function isAdmin(req) {
  const u = db.prepare('SELECT email FROM users WHERE id=?').get(req.userId);
  return u?.email === ADMIN_EMAIL;
}

app.post('/api/admin/set-unlimited', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { userId, email } = req.body;
  const target = userId || (email ? db.prepare('SELECT id FROM users WHERE email=?').get(email)?.id : null);
  if (!target) return res.status(404).json({ error: 'User not found' });
  const until = new Date(); until.setFullYear(until.getFullYear() + 100);
  db.prepare('UPDATE users SET unlimited_tokens_until=?, forum_tokens=999999 WHERE id=?').run(until.toISOString(), target);
  res.json({ success: true, message: 'Unlimited tokens set' });
});

app.post('/api/admin/give-tokens', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { email, amount } = req.body;
  if (!email || !amount) return res.status(400).json({ error: 'Email and amount required' });
  const u = db.prepare('SELECT id FROM users WHERE email=?').get(email);
  if (!u) return res.status(404).json({ error: 'User not found' });
  db.prepare('UPDATE users SET forum_tokens = forum_tokens + ? WHERE id=?').run(amount, u.id);
  res.json({ success: true });
});

// ============ PROMO CODES ============
// Redeem a promo code
app.post('/api/promo/redeem', auth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Enter a promo code' });
  const promo = db.prepare('SELECT * FROM promo_codes WHERE code=? AND is_active=1').get(code.trim().toUpperCase());
  if (!promo) return res.status(404).json({ error: 'Invalid promo code' });
  if (promo.expires_at && new Date(promo.expires_at) < new Date()) return res.status(400).json({ error: 'This code has expired' });
  if (promo.max_uses > 0 && promo.times_used >= promo.max_uses) return res.status(400).json({ error: 'This code has been fully redeemed' });
  const existing = db.prepare('SELECT id FROM promo_redemptions WHERE promo_code_id=? AND user_id=?').get(promo.id, req.userId);
  if (existing) return res.status(400).json({ error: 'You already used this code' });

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + (promo.duration_days || 30));

  db.prepare('INSERT INTO promo_redemptions (id, promo_code_id, user_id, expires_at) VALUES (?,?,?,?)').run(uuidv4(), promo.id, req.userId, expiresAt.toISOString());
  db.prepare('UPDATE promo_codes SET times_used = times_used + 1 WHERE id=?').run(promo.id);
  db.prepare('UPDATE users SET tier=? WHERE id=?').run(promo.tier, req.userId);

  const token = jwt.sign({ userId: req.userId, tier: promo.tier }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, tier: promo.tier, expiresAt: expiresAt.toISOString(), token, message: 'Welcome! You now have ' + promo.tier.toUpperCase() + ' access for ' + promo.duration_days + ' days!' });
});

// Create a promo code (admin only — Christina)
app.post('/api/promo/create', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { code, tier, durationDays, maxUses, expiresAt } = req.body;
  if (!code || !tier) return res.status(400).json({ error: 'Code and tier required' });
  const id = uuidv4();
  try {
    db.prepare('INSERT INTO promo_codes (id, code, tier, duration_days, max_uses, created_by, expires_at) VALUES (?,?,?,?,?,?,?)')
      .run(id, code.trim().toUpperCase(), tier, durationDays || 30, maxUses || 0, req.userId, expiresAt || null);
    res.json({ id, code: code.trim().toUpperCase() });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: e.message });
  }
});

// List promo codes (admin)
app.get('/api/promo/codes', auth, (req, res) => {
  const codes = db.prepare('SELECT * FROM promo_codes WHERE created_by=? ORDER BY created_at DESC').all(req.userId);
  res.json(codes);
});

// ============ CLAY BODIES ============
app.get('/api/clay-bodies', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM clay_bodies WHERE user_id=? ORDER BY name').all(req.userId));
});

app.post('/api/clay-bodies', auth, (req, res) => {
  const { name, brand, colorWet, colorFired, shrinkagePct, coneRange, clayType, costPerBag, bagWeight, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO clay_bodies (id,user_id,name,brand,color_wet,color_fired,shrinkage_pct,cone_range,clay_type,cost_per_bag,bag_weight,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, name, brand, colorWet, colorFired, shrinkagePct, coneRange, clayType, costPerBag, bagWeight, notes);
  res.json({ id, name });
});

app.put('/api/clay-bodies/:id', auth, (req, res) => {
  const { name, brand, colorWet, colorFired, shrinkagePct, coneRange, clayType, costPerBag, bagWeight, notes } = req.body;
  const r = db.prepare(`UPDATE clay_bodies SET name=?,brand=?,color_wet=?,color_fired=?,shrinkage_pct=?,cone_range=?,clay_type=?,cost_per_bag=?,bag_weight=?,notes=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(name, brand, colorWet, colorFired, shrinkagePct, coneRange, clayType, costPerBag, bagWeight, notes, req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.delete('/api/clay-bodies/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM clay_bodies WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ============ GLAZES ============
app.get('/api/glazes', auth, (req, res) => {
  const glazes = db.prepare('SELECT * FROM glazes WHERE user_id=? ORDER BY name').all(req.userId);
  const getIng = db.prepare('SELECT * FROM glaze_ingredients WHERE glaze_id=? ORDER BY sort_order');
  const getPhotos = db.prepare('SELECT * FROM glaze_photos WHERE glaze_id=? ORDER BY sort_order');
  glazes.forEach(g => { if (g.glaze_type === 'recipe') g.ingredients = getIng.all(g.id); g.photos = getPhotos.all(g.id); });
  res.json(glazes);
});

app.post('/api/glazes', auth, (req, res) => {
  const { name, glazeType, brand, sku, colorDescription, coneRange, atmosphere, surface, notes, ingredients } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO glazes (id,user_id,name,glaze_type,brand,sku,color_description,cone_range,atmosphere,surface,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, name, glazeType || 'commercial', brand, sku, colorDescription, coneRange, atmosphere, surface, notes);
  if (glazeType === 'recipe' && ingredients?.length) {
    const ins = db.prepare('INSERT INTO glaze_ingredients (id,glaze_id,ingredient_name,percentage,amount,sort_order) VALUES (?,?,?,?,?,?)');
    ingredients.forEach((i, idx) => ins.run(uuidv4(), id, i.name, i.percentage, i.amount, idx));
  }
  res.json({ id, name });
});

app.put('/api/glazes/:id', auth, (req, res) => {
  const { name, glazeType, brand, sku, colorDescription, coneRange, atmosphere, surface, notes, ingredients } = req.body;
  const r = db.prepare(`UPDATE glazes SET name=?,glaze_type=?,brand=?,sku=?,color_description=?,cone_range=?,atmosphere=?,surface=?,notes=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(name, glazeType, brand, sku, colorDescription, coneRange, atmosphere, surface, notes, req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  if (glazeType === 'recipe') {
    db.prepare('DELETE FROM glaze_ingredients WHERE glaze_id=?').run(req.params.id);
    if (ingredients?.length) {
      const ins = db.prepare('INSERT INTO glaze_ingredients (id,glaze_id,ingredient_name,percentage,amount,sort_order) VALUES (?,?,?,?,?,?)');
      ingredients.forEach((i, idx) => ins.run(uuidv4(), req.params.id, i.name, i.percentage, i.amount, idx));
    }
  }
  res.json({ success: true });
});

app.delete('/api/glazes/:id', auth, (req, res) => {
  db.prepare('DELETE FROM glaze_ingredients WHERE glaze_id=?').run(req.params.id);
  db.prepare('DELETE FROM glaze_photos WHERE glaze_id=?').run(req.params.id);
  const r = db.prepare('DELETE FROM glazes WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.post('/api/glazes/:id/photos', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo' });
  if (req.userTier === 'free') return res.status(403).json({ error: 'Upgrade to add glaze photos' });
  const count = db.prepare('SELECT COUNT(*) as c FROM glaze_photos WHERE glaze_id=?').get(req.params.id).c;
  if (count >= 3) return res.status(403).json({ error: 'Max 3 photos per glaze' });
  const id = uuidv4();
  db.prepare('INSERT INTO glaze_photos (id,glaze_id,filename,original_name,sort_order) VALUES (?,?,?,?,?)').run(id, req.params.id, req.file.filename, req.file.originalname, count);
  res.json({ id, filename: req.file.filename });
});

// ============ PIECES ============
app.get('/api/pieces', auth, (req, res) => {
  const { status, clayBodyId, search, limit, offset } = req.query;
  let sql = 'SELECT p.*, cb.name as clay_body_name FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id WHERE p.user_id=?';
  const params = [req.userId];
  if (status) { sql += ' AND p.status=?'; params.push(status); }
  if (clayBodyId) { sql += ' AND p.clay_body_id=?'; params.push(clayBodyId); }
  if (search) { sql += ' AND (p.title LIKE ? OR p.description LIKE ? OR p.notes LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY p.updated_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
  if (offset) { sql += ' OFFSET ?'; params.push(parseInt(offset)); }
  const pieces = db.prepare(sql).all(...params);
  const getGl = db.prepare('SELECT pg.*,g.name as glaze_name,g.brand,g.glaze_type FROM piece_glazes pg JOIN glazes g ON pg.glaze_id=g.id WHERE pg.piece_id=? ORDER BY pg.layer_order');
  const getPh = db.prepare('SELECT * FROM piece_photos WHERE piece_id=? ORDER BY sort_order');
  pieces.forEach(p => { p.glazes = getGl.all(p.id); p.photos = getPh.all(p.id); });
  res.json(pieces);
});

app.get('/api/pieces/:id', auth, (req, res) => {
  const p = db.prepare('SELECT p.*,cb.name as clay_body_name FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id WHERE p.id=? AND p.user_id=?').get(req.params.id, req.userId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.glazes = db.prepare('SELECT pg.*,g.name as glaze_name,g.brand,g.glaze_type FROM piece_glazes pg JOIN glazes g ON pg.glaze_id=g.id WHERE pg.piece_id=? ORDER BY pg.layer_order').all(p.id);
  p.photos = db.prepare('SELECT * FROM piece_photos WHERE piece_id=? ORDER BY sort_order').all(p.id);
  p.firings = db.prepare('SELECT * FROM firing_logs WHERE piece_id=? ORDER BY date DESC').all(p.id);
  res.json(p);
});

app.post('/api/pieces', auth, (req, res) => {
  const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  if ((u?.tier || 'free') === 'free' && getPieceCount(req.userId) >= 20) return res.status(403).json({ error: 'Free tier limited to 20 pieces. Upgrade to add more!' });
  const { title, description, clayBodyId, studio, status, form, technique, dimensions, weight, materialCost, firingCost, dateStarted, notes, glazeIds } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO pieces (id,user_id,title,description,clay_body_id,studio,status,form,technique,dimensions,weight,material_cost,firing_cost,date_started,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, title, description, clayBodyId, studio, status || 'in-progress', form, technique, dimensions, weight, materialCost, firingCost, dateStarted, notes);
  if (glazeIds?.length) {
    const ins = db.prepare('INSERT INTO piece_glazes (id,piece_id,glaze_id,coats,application_method,layer_order) VALUES (?,?,?,?,?,?)');
    glazeIds.forEach((g, i) => ins.run(uuidv4(), id, g.glazeId, g.coats || 1, g.method, i));
  }
  res.json({ id });
});

app.put('/api/pieces/:id', auth, (req, res) => {
  const { title, description, clayBodyId, studio, status, form, technique, dimensions, weight, materialCost, firingCost, salePrice, dateStarted, dateCompleted, dateSold, notes, glazeIds } = req.body;
  const r = db.prepare(`UPDATE pieces SET title=?,description=?,clay_body_id=?,studio=?,status=?,form=?,technique=?,dimensions=?,weight=?,material_cost=?,firing_cost=?,sale_price=?,date_started=?,date_completed=?,date_sold=?,notes=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(title, description, clayBodyId, studio, status, form, technique, dimensions, weight, materialCost, firingCost, salePrice, dateStarted, dateCompleted, dateSold, notes, req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  if (glazeIds !== undefined) {
    db.prepare('DELETE FROM piece_glazes WHERE piece_id=?').run(req.params.id);
    if (glazeIds?.length) {
      const ins = db.prepare('INSERT INTO piece_glazes (id,piece_id,glaze_id,coats,application_method,layer_order) VALUES (?,?,?,?,?,?)');
      glazeIds.forEach((g, i) => ins.run(uuidv4(), req.params.id, g.glazeId, g.coats || 1, g.method, i));
    }
  }
  res.json({ success: true });
});

app.delete('/api/pieces/:id', auth, (req, res) => {
  const photos = db.prepare('SELECT filename FROM piece_photos WHERE piece_id=?').all(req.params.id);
  photos.forEach(p => { const f = path.join(UPLOADS_DIR, p.filename); if (fs.existsSync(f)) fs.unlinkSync(f); });
  db.prepare('DELETE FROM piece_photos WHERE piece_id=?').run(req.params.id);
  db.prepare('DELETE FROM piece_glazes WHERE piece_id=?').run(req.params.id);
  db.prepare('DELETE FROM firing_logs WHERE piece_id=?').run(req.params.id);
  const r = db.prepare('DELETE FROM pieces WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Piece photos
app.post('/api/pieces/:id/photos', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo' });
  const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const maxPhotos = (u?.tier || 'free') === 'free' ? 1 : 3;
  const count = db.prepare('SELECT COUNT(*) as c FROM piece_photos WHERE piece_id=?').get(req.params.id).c;
  if (count >= maxPhotos) return res.status(403).json({ error: (u?.tier || 'free') === 'free' ? 'Free tier: 1 photo per piece. Upgrade for 3!' : 'Max 3 photos per piece' });
  const id = uuidv4();
  db.prepare('INSERT INTO piece_photos (id,piece_id,filename,original_name,stage,sort_order) VALUES (?,?,?,?,?,?)')
    .run(id, req.params.id, req.file.filename, req.file.originalname, req.body.stage || 'other', count);
  res.json({ id, filename: req.file.filename });
});

app.delete('/api/photos/:id', auth, (req, res) => {
  const ph = db.prepare('SELECT pp.* FROM piece_photos pp JOIN pieces p ON pp.piece_id=p.id WHERE pp.id=? AND p.user_id=?').get(req.params.id, req.userId);
  if (!ph) return res.status(404).json({ error: 'Not found' });
  const f = path.join(UPLOADS_DIR, ph.filename); if (fs.existsSync(f)) fs.unlinkSync(f);
  db.prepare('DELETE FROM piece_photos WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ============ FIRING LOGS ============
app.get('/api/firing-logs', auth, (req, res) => {
  res.json(db.prepare('SELECT fl.*,p.title as piece_title FROM firing_logs fl LEFT JOIN pieces p ON fl.piece_id=p.id WHERE fl.user_id=? ORDER BY fl.date DESC').all(req.userId));
});

app.post('/api/firing-logs', auth, requireTier('basic'), (req, res) => {
  const { pieceId, firingType, cone, temperature, atmosphere, kilnName, schedule, duration, firingSpeed, holdUsed, holdDuration, date, results, notes } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO firing_logs (id,user_id,piece_id,firing_type,cone,temperature,atmosphere,kiln_name,schedule,duration,firing_speed,hold_used,hold_duration,date,results,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, pieceId, firingType, cone, temperature, atmosphere, kilnName, schedule, duration, firingSpeed, holdUsed ? 1 : 0, holdDuration, date, results, notes);
  res.json({ id });
});

// ============ SALES ============
app.get('/api/sales', auth, requireTier('top'), (req, res) => {
  res.json(db.prepare('SELECT s.*,p.title as piece_title FROM sales s LEFT JOIN pieces p ON s.piece_id=p.id WHERE s.user_id=? ORDER BY s.date DESC').all(req.userId));
});

app.post('/api/sales', auth, requireTier('top'), (req, res) => {
  const { pieceId, date, price, venue, venueType, buyerName, notes } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO sales (id,user_id,piece_id,date,price,venue,venue_type,buyer_name,notes) VALUES (?,?,?,?,?,?,?,?,?)').run(id, req.userId, pieceId, date, price, venue, venueType, buyerName, notes);
  if (pieceId) db.prepare(`UPDATE pieces SET status='sold',sale_price=?,date_sold=?,updated_at=datetime('now') WHERE id=? AND user_id=?`).run(price, date, pieceId, req.userId);
  res.json({ id });
});

app.get('/api/sales/summary', auth, requireTier('top'), (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count, SUM(price) as total FROM sales WHERE user_id=?').get(req.userId);
  const byVenue = db.prepare('SELECT venue_type,COUNT(*) as count,SUM(price) as total FROM sales WHERE user_id=? GROUP BY venue_type').all(req.userId);
  const byMonth = db.prepare(`SELECT strftime('%Y-%m',date) as month,COUNT(*) as count,SUM(price) as total FROM sales WHERE user_id=? GROUP BY month ORDER BY month DESC LIMIT 12`).all(req.userId);
  res.json({ total, byVenue, byMonth });
});

app.get('/api/sales/export', auth, requireTier('top'), (req, res) => {
  const sales = db.prepare('SELECT s.*,p.title as piece_title FROM sales s LEFT JOIN pieces p ON s.piece_id=p.id WHERE s.user_id=? ORDER BY s.date DESC').all(req.userId);
  let csv = 'Date,Piece,Price,Venue Type,Venue,Buyer,Notes\n';
  sales.forEach(s => { csv += `"${s.date||''}","${(s.piece_title||'').replace(/"/g,'""')}","${s.price||0}","${s.venue_type||''}","${(s.venue||'').replace(/"/g,'""')}","${(s.buyer_name||'').replace(/"/g,'""')}","${(s.notes||'').replace(/"/g,'""')}"\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-sales.csv');
  res.send(csv);
});

app.get('/api/export/pieces', auth, requireTier('top'), (req, res) => {
  const pieces = db.prepare('SELECT p.*,cb.name as clay_body_name FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id WHERE p.user_id=? ORDER BY p.updated_at DESC').all(req.userId);
  let csv = 'Title,Clay Body,Status,Technique,Form,Studio,Date Started,Date Completed,Material Cost,Firing Cost,Sale Price,Notes\n';
  pieces.forEach(p => { csv += `"${(p.title||'').replace(/"/g,'""')}","${(p.clay_body_name||'').replace(/"/g,'""')}","${p.status||''}","${p.technique||''}","${(p.form||'').replace(/"/g,'""')}","${(p.studio||'').replace(/"/g,'""')}","${p.date_started||''}","${p.date_completed||''}","${p.material_cost||''}","${p.firing_cost||''}","${p.sale_price||''}","${(p.notes||'').replace(/"/g,'""')}"\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-pieces.csv');
  res.send(csv);
});

// ============ COMMUNITY GLAZE COMBOS ============
app.get('/api/community/combos', auth, requireTier('top'), (req, res) => {
  const { search, cone, atmosphere } = req.query;
  let sql = 'SELECT gc.*,u.display_name as author FROM glaze_combos gc JOIN users u ON gc.user_id=u.id WHERE gc.is_shared=1';
  const params = [];
  if (search) { sql += ' AND (gc.name LIKE ? OR gc.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (cone) { sql += ' AND gc.cone=?'; params.push(cone); }
  if (atmosphere) { sql += ' AND gc.atmosphere=?'; params.push(atmosphere); }
  sql += ' ORDER BY gc.likes DESC, gc.created_at DESC';
  const combos = db.prepare(sql).all(...params);
  const getL = db.prepare('SELECT * FROM glaze_combo_layers WHERE combo_id=? ORDER BY layer_order');
  combos.forEach(c => { c.layers = getL.all(c.id); });
  res.json(combos);
});

app.post('/api/community/combos', auth, requireTier('top'), (req, res) => {
  const { name, clayBodyName, cone, atmosphere, description, notes, isShared, layers } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO glaze_combos (id,user_id,name,clay_body_name,cone,atmosphere,description,notes,is_shared) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, name, clayBodyName, cone, atmosphere, description, notes, isShared ? 1 : 0);
  if (layers?.length) {
    const ins = db.prepare('INSERT INTO glaze_combo_layers (id,combo_id,glaze_name,brand,coats,application_method,layer_order) VALUES (?,?,?,?,?,?,?)');
    layers.forEach((l, i) => ins.run(uuidv4(), id, l.glazeName, l.brand, l.coats || 1, l.method, i));
  }
  res.json({ id });
});

// ============ FORUM ============
app.get('/api/forum/categories', auth, (req, res) => {
  const cats = db.prepare('SELECT * FROM forum_categories ORDER BY sort_order').all();
  const countPosts = db.prepare('SELECT COUNT(*) as c FROM forum_posts WHERE category_id=?');
  cats.forEach(c => { c.postCount = countPosts.get(c.id).c; });
  res.json(cats);
});

app.get('/api/forum/posts', auth, (req, res) => {
  const { categoryId, search, limit, offset } = req.query;
  let sql = `SELECT fp.*,u.display_name as author_name,u.avatar_filename as author_avatar,fc.name as category_name
    FROM forum_posts fp JOIN users u ON fp.user_id=u.id LEFT JOIN forum_categories fc ON fp.category_id=fc.id WHERE 1=1`;
  const params = [];
  if (categoryId) { sql += ' AND fp.category_id=?'; params.push(categoryId); }
  if (search) { sql += ' AND (fp.title LIKE ? OR fp.body LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  sql += ` AND fp.user_id NOT IN (SELECT blocked_user_id FROM blocked_users WHERE user_id=?)
           AND fp.user_id NOT IN (SELECT user_id FROM blocked_users WHERE blocked_user_id=?)`;
  params.push(req.userId, req.userId);
  sql += ' ORDER BY fp.is_pinned DESC, fp.updated_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
  if (offset) { sql += ' OFFSET ?'; params.push(parseInt(offset)); }
  const posts = db.prepare(sql).all(...params);
  const getPhotos = db.prepare('SELECT * FROM forum_photos WHERE post_id=?');
  posts.forEach(p => { p.photos = getPhotos.all(p.id); });
  res.json(posts);
});

app.get('/api/forum/posts/:id', auth, (req, res) => {
  const post = db.prepare(`SELECT fp.*,u.display_name as author_name,u.avatar_filename as author_avatar
    FROM forum_posts fp JOIN users u ON fp.user_id=u.id WHERE fp.id=?`).get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE forum_posts SET view_count=view_count+1 WHERE id=?').run(req.params.id);
  post.photos = db.prepare('SELECT * FROM forum_photos WHERE post_id=?').all(post.id);
  post.replies = db.prepare(`SELECT fr.*,u.display_name as author_name,u.avatar_filename as author_avatar
    FROM forum_replies fr JOIN users u ON fr.user_id=u.id WHERE fr.post_id=?
    AND fr.user_id NOT IN (SELECT blocked_user_id FROM blocked_users WHERE user_id=?)
    AND fr.user_id NOT IN (SELECT user_id FROM blocked_users WHERE blocked_user_id=?)
    ORDER BY fr.created_at`).all(post.id, req.userId, req.userId);
  const getReplyPhotos = db.prepare('SELECT * FROM forum_photos WHERE reply_id=?');
  post.replies.forEach(r => { r.photos = getReplyPhotos.all(r.id); });
  res.json(post);
});

function canPost(userId) {
  const u = db.prepare('SELECT forum_tokens,unlimited_tokens_until,tier FROM users WHERE id=?').get(userId);
  if (!u) return false;
  if (u.unlimited_tokens_until && new Date(u.unlimited_tokens_until) > new Date()) return true;
  if (u.forum_tokens > 0) return true;
  return false;
}

function useToken(userId) {
  const u = db.prepare('SELECT forum_tokens,unlimited_tokens_until FROM users WHERE id=?').get(userId);
  if (u.unlimited_tokens_until && new Date(u.unlimited_tokens_until) > new Date()) return true;
  if (u.forum_tokens > 0) {
    db.prepare('UPDATE users SET forum_tokens=forum_tokens-1 WHERE id=?').run(userId);
    return true;
  }
  return false;
}

app.post('/api/forum/posts', auth, upload.array('photos', 3), (req, res) => {
  if (!canPost(req.userId)) return res.status(403).json({ error: 'You need forum tokens to post. Purchase tokens to participate!' });
  const { title, body, categoryId } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  if (!useToken(req.userId)) return res.status(403).json({ error: 'No tokens available' });
  const id = uuidv4();
  db.prepare('INSERT INTO forum_posts (id,user_id,category_id,title,body) VALUES (?,?,?,?,?)').run(id, req.userId, categoryId, title, body);
  if (req.files?.length) {
    const ins = db.prepare('INSERT INTO forum_photos (id,post_id,filename,original_name) VALUES (?,?,?,?)');
    req.files.forEach(f => ins.run(uuidv4(), id, f.filename, f.originalname));
  }
  res.json({ id });
});

app.post('/api/forum/posts/:id/reply', auth, upload.array('photos', 3), (req, res) => {
  if (!canPost(req.userId)) return res.status(403).json({ error: 'You need forum tokens to reply. Purchase tokens to participate!' });
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'Reply body required' });
  if (!useToken(req.userId)) return res.status(403).json({ error: 'No tokens available' });
  const id = uuidv4();
  db.prepare('INSERT INTO forum_replies (id,post_id,user_id,body) VALUES (?,?,?,?)').run(id, req.params.id, req.userId, body);
  db.prepare(`UPDATE forum_posts SET reply_count=reply_count+1, updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  if (req.files?.length) {
    const ins = db.prepare('INSERT INTO forum_photos (id,reply_id,filename,original_name) VALUES (?,?,?,?)');
    req.files.forEach(f => ins.run(uuidv4(), id, f.filename, f.originalname));
  }
  res.json({ id });
});

// Delete own forum post
app.delete('/api/forum/posts/:id', auth, (req, res) => {
  const post = db.prepare('SELECT user_id FROM forum_posts WHERE id=?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  const admin = db.prepare('SELECT email FROM users WHERE id=?').get(req.userId);
  if (post.user_id !== req.userId && admin?.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'You can only delete your own posts' });
  db.prepare('DELETE FROM forum_photos WHERE post_id=?').run(req.params.id);
  db.prepare('DELETE FROM forum_photos WHERE reply_id IN (SELECT id FROM forum_replies WHERE post_id=?)').run(req.params.id);
  db.prepare('DELETE FROM forum_replies WHERE post_id=?').run(req.params.id);
  db.prepare('DELETE FROM forum_posts WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Delete own forum reply
app.delete('/api/forum/replies/:id', auth, (req, res) => {
  const reply = db.prepare('SELECT user_id,post_id FROM forum_replies WHERE id=?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: 'Not found' });
  const admin = db.prepare('SELECT email FROM users WHERE id=?').get(req.userId);
  if (reply.user_id !== req.userId && admin?.email !== ADMIN_EMAIL) return res.status(403).json({ error: 'You can only delete your own replies' });
  db.prepare('DELETE FROM forum_photos WHERE reply_id=?').run(req.params.id);
  db.prepare('DELETE FROM forum_replies WHERE id=?').run(req.params.id);
  db.prepare('UPDATE forum_posts SET reply_count=reply_count-1 WHERE id=?').run(reply.post_id);
  res.json({ success: true });
});

app.get('/api/tokens/balance', auth, (req, res) => {
  const u = db.prepare('SELECT forum_tokens,unlimited_tokens_until FROM users WHERE id=?').get(req.userId);
  const hasUnlimited = u.unlimited_tokens_until && new Date(u.unlimited_tokens_until) > new Date();
  res.json({ tokens: u.forum_tokens, hasUnlimited, unlimitedUntil: u.unlimited_tokens_until });
});

// ============ MERCHANT SHOP ============
app.get('/api/shop/products', (req, res) => {
  const products = db.prepare('SELECT id,name,description,price,product_type,image_filename,is_digital FROM merchant_products WHERE is_active=1 ORDER BY sort_order, created_at').all();
  res.json(products);
});

app.get('/api/shop/products/:id', (req, res) => {
  const p = db.prepare('SELECT * FROM merchant_products WHERE id=? AND is_active=1').get(req.params.id);
  if (!p) return res.status(404).json({ error: 'Not found' });
  res.json(p);
});

app.post('/api/shop/checkout', auth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Payments coming soon!' });
  const { productId } = req.body;
  const product = db.prepare('SELECT * FROM merchant_products WHERE id=? AND is_active=1').get(productId);
  if (!product) return res.status(404).json({ error: 'Product not found' });
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: product.name, description: product.description || undefined },
          unit_amount: Math.round(product.price * 100),
        },
        quantity: 1,
      }],
      metadata: { userId: req.userId, purchaseType: 'merchant', productId },
      success_url: `${APP_URL}?purchased=${productId}`,
      cancel_url: `${APP_URL}?cancelled=true`,
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Admin: manage merchant products (simple — Christina only for now)
app.post('/api/shop/products', auth, upload.single('image'), (req, res) => {
  const { name, description, price, productType, isDigital } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'Name and price required' });
  const id = uuidv4();
  db.prepare('INSERT INTO merchant_products (id,name,description,price,product_type,image_filename,is_digital,sort_order) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, name, description, parseFloat(price), productType || 'other', req.file?.filename || null, isDigital ? 1 : 0, 0);
  res.json({ id });
});

app.put('/api/shop/products/:id', auth, upload.single('image'), (req, res) => {
  const { name, description, price, productType, isDigital, isActive } = req.body;
  const updates = [];
  const params = [];
  if (name !== undefined) { updates.push('name=?'); params.push(name); }
  if (description !== undefined) { updates.push('description=?'); params.push(description); }
  if (price !== undefined) { updates.push('price=?'); params.push(parseFloat(price)); }
  if (productType !== undefined) { updates.push('product_type=?'); params.push(productType); }
  if (isDigital !== undefined) { updates.push('is_digital=?'); params.push(isDigital ? 1 : 0); }
  if (isActive !== undefined) { updates.push('is_active=?'); params.push(isActive ? 1 : 0); }
  if (req.file) { updates.push('image_filename=?'); params.push(req.file.filename); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });
  params.push(req.params.id);
  db.prepare(`UPDATE merchant_products SET ${updates.join(',')} WHERE id=?`).run(...params);
  res.json({ success: true });
});

// ============ DASHBOARD ============
app.get('/api/dashboard', auth, (req, res) => {
  const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const tier = u?.tier || 'free';
  const totalPieces = db.prepare('SELECT COUNT(*) as c FROM pieces WHERE user_id=?').get(req.userId).c;
  const byStatus = db.prepare('SELECT status,COUNT(*) as count FROM pieces WHERE user_id=? GROUP BY status').all(req.userId);
  const recentPieces = db.prepare('SELECT p.*,cb.name as clay_body_name FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id WHERE p.user_id=? ORDER BY p.updated_at DESC LIMIT 5').all(req.userId);
  const totalClays = db.prepare('SELECT COUNT(*) as c FROM clay_bodies WHERE user_id=?').get(req.userId).c;
  const totalGlazes = db.prepare('SELECT COUNT(*) as c FROM glazes WHERE user_id=?').get(req.userId).c;

  const getPh = db.prepare('SELECT * FROM piece_photos WHERE piece_id=? ORDER BY sort_order LIMIT 1');
  const getGl = db.prepare('SELECT pg.*,g.name as glaze_name,g.brand,g.glaze_type FROM piece_glazes pg JOIN glazes g ON pg.glaze_id=g.id WHERE pg.piece_id=? ORDER BY pg.layer_order');
  recentPieces.forEach(p => { p.primaryPhoto = getPh.get(p.id) || null; p.glazes = getGl.all(p.id); });

  const stats = { totalPieces, byStatus, recentPieces, totalClays, totalGlazes, tier };

  if (tier === 'top') {
    const sales = db.prepare('SELECT COUNT(*) as count, SUM(price) as total FROM sales WHERE user_id=?').get(req.userId);
    stats.sales = sales;
  }
  res.json(stats);
});

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/uploads/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏺 The Potter's Mud Room running on http://localhost:${PORT}`);
});