const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { initDB } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pottery-app-dev-secret-change-in-prod';
const db = initDB();

// Nodemailer setup for newsletter emails
let transporter = null;
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });
} else {
  console.warn('⚠️  SMTP not configured — newsletter emails will be skipped');
}

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
// Prevent browser caching of HTML/JS/CSS so updates show immediately
app.use(express.static(path.join(__dirname, 'public'), {
  etag: false,
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
    }
  }
}));

// Simple analytics — track page views
app.post('/api/analytics/pageview', (req, res) => {
  try {
    const { path: pagePath, referrer } = req.body;
    const ua = req.headers['user-agent'] || '';
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.ip || '';
    // Extract user from token if present
    let userId = null;
    const t = req.headers.authorization?.replace('Bearer ', '');
    if (t) { try { const d = jwt.verify(t, JWT_SECRET); userId = d.userId; } catch {} }
    db.prepare('INSERT INTO page_views (path, referrer, user_agent, ip, user_id) VALUES (?,?,?,?,?)')
      .run(pagePath || '/', referrer || null, ua, ip, userId);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); /* don't fail on analytics */ }
});

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
  // New simplified tiers: free=0, starter=1
  // Backward compat: basic/mid/top all treated as >= starter
  const lv = { free: 0, starter: 1, basic: 1, mid: 2, top: 3 };
  const minLv = min === 'starter' ? 1 : (lv[min] || 0);
  return (req, res, next) => {
    const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
    const currentTier = u?.tier || req.userTier;
    if ((lv[currentTier] || 0) >= minLv) { req.userTier = currentTier; return next(); }
    res.status(403).json({ error: `Requires ${min} tier or above` });
  };
}
function getPieceCount(uid) { return db.prepare('SELECT COUNT(*) as c FROM pieces WHERE user_id=?').get(uid).c; }

// Helper: generate unique referral code
function generateReferralCode() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 8; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (db.prepare('SELECT id FROM users WHERE referral_code=?').get(code));
  return code;
}

// ============ AUTH ============
app.post('/api/auth/register', (req, res) => {
  try {
    const { password, displayName, referredBy } = req.body;
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Email already registered' });
    const id = uuidv4(), hash = bcrypt.hashSync(password, 10);
    const refCode = generateReferralCode();
    db.prepare('INSERT INTO users (id,email,password_hash,display_name,referral_code,referred_by) VALUES (?,?,?,?,?,?)')
      .run(id, email, hash, displayName || email.split('@')[0], refCode, referredBy || null);

    // Process referral rewards — both get 1 free month of starter
    if (referredBy) {
      const referrer = db.prepare('SELECT id FROM users WHERE referral_code=?').get(referredBy);
      if (referrer) {
        // Give referrer 1 free month of starter (or extend if already on starter)
        const referrerUser = db.prepare('SELECT tier, free_months_remaining FROM users WHERE id=?').get(referrer.id);
        const refFreeMonths = (referrerUser?.free_months_remaining || 0) + 1;
        db.prepare('UPDATE users SET tier = CASE WHEN tier = \'free\' THEN \'starter\' ELSE tier END, free_months_remaining = ? WHERE id=?').run(refFreeMonths, referrer.id);
        // Give new user 1 free month of starter
        db.prepare('UPDATE users SET tier = \'starter\', free_months_remaining = 1 WHERE id=?').run(id);
        db.prepare('INSERT INTO referral_rewards (id, referrer_id, referred_id, reward_type) VALUES (?,?,?,?)').run(uuidv4(), referrer.id, id, 'free_month');
      }
    }

    // Ensure all existing users have referral codes (backfill)
    const usersWithoutCodes = db.prepare('SELECT id FROM users WHERE referral_code IS NULL').all();
    usersWithoutCodes.forEach(u => {
      db.prepare('UPDATE users SET referral_code=? WHERE id=?').run(generateReferralCode(), u.id);
    });

    const token = jwt.sign({ userId: id, tier: 'free' }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id, email, displayName: displayName || email.split('@')[0], tier: 'free' } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const { password } = req.body;
    const email = (req.body.email || '').trim().toLowerCase();
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(email);
    if (!u || !bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ userId: u.id, tier: u.tier }, JWT_SECRET, { expiresIn: '30d' });
    res.json({ token, user: { id: u.id, email: u.email, displayName: u.display_name, tier: u.tier } });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.get('/api/auth/me', auth, (req, res) => {
  const u = db.prepare('SELECT id,email,display_name,username,bio,location,website,avatar_filename,is_private,tier,unit_system,temp_unit,referral_code,newsletter_subscribed,created_at FROM users WHERE id=?').get(req.userId);
  if (!u) return res.status(404).json({ error: 'Not found' });
  // Ensure referral code exists
  if (!u.referral_code) {
    const code = generateReferralCode();
    db.prepare('UPDATE users SET referral_code=? WHERE id=?').run(code, req.userId);
    u.referral_code = code;
  }
  // Get referral stats
  const referralStats = db.prepare('SELECT COUNT(*) as count FROM referral_rewards WHERE referrer_id=?').get(req.userId);
  res.json({ user: { ...u, displayName: u.display_name, pieceCount: getPieceCount(req.userId), referralCount: referralStats?.count || 0, freeMonthsRemaining: u.free_months_remaining || 0, newsletterSubscribed: u.newsletter_subscribed } });
});

// Change password
app.put('/api/auth/password', auth, (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password required' });
    const u = db.prepare('SELECT password_hash FROM users WHERE id=?').get(req.userId);
    if (!u || !bcrypt.compareSync(currentPassword, u.password_hash)) return res.status(401).json({ error: 'Current password is incorrect' });
    const newHash = bcrypt.hashSync(newPassword, 10);
    db.prepare('UPDATE users SET password_hash=?,updated_at=datetime(\'now\') WHERE id=?').run(newHash, req.userId);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Delete account — permanently removes user and all their data
app.delete('/api/account', auth, (req, res) => {
  try {
    const uid = req.userId;
    // Prevent admin from accidentally deleting their own account
    const u = db.prepare('SELECT email FROM users WHERE id=?').get(uid);
    if (u?.email === ADMIN_EMAIL) return res.status(403).json({ error: 'Admin account cannot be deleted from here' });
    // Delete all user data in order (respecting foreign keys)
    db.prepare('DELETE FROM promo_redemptions WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM referral_rewards WHERE referrer_id=? OR referred_id=?').run(uid, uid);
    db.prepare('DELETE FROM combo_comments WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM combo_likes WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM forum_replies WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM forum_posts WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM reviews WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM messages WHERE from_user_id=? OR to_user_id=?').run(uid, uid);
    db.prepare('DELETE FROM notifications WHERE user_id=? OR from_user_id=?').run(uid, uid);
    db.prepare('DELETE FROM piece_photos WHERE piece_id IN (SELECT id FROM pieces WHERE user_id=?)').run(uid);
    db.prepare('DELETE FROM piece_glazes WHERE piece_id IN (SELECT id FROM pieces WHERE user_id=?)').run(uid);
    db.prepare('DELETE FROM sales WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM glaze_clay_tests WHERE glaze_id IN (SELECT id FROM glazes WHERE user_id=?)').run(uid);
    db.prepare('DELETE FROM pieces WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM glaze_combos WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM firing_logs WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM glazes WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM glaze_chemicals WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM clay_bodies WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM goals WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM projects WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM events WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM contacts WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM blocked_users WHERE user_id=? OR blocked_user_id=?').run(uid, uid);
    db.prepare('DELETE FROM merchant_orders WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM featured_potter WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM page_views WHERE user_id=?').run(uid);
    db.prepare('DELETE FROM users WHERE id=?').run(uid);
    res.json({ success: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ============ USER PROFILE ============
app.put('/api/profile', auth, (req, res) => {
  const { displayName, username, bio, location, website, isPrivate, unitSystem, tempUnit } = req.body;
  db.prepare(`UPDATE users SET display_name=?,username=?,bio=?,location=?,website=?,is_private=?,unit_system=?,temp_unit=?,updated_at=datetime('now') WHERE id=?`)
    .run(displayName, username || null, bio, location, website, isPrivate ? 1 : 0, unitSystem || 'imperial', tempUnit || 'fahrenheit', req.userId);
  res.json({ success: true });
});

// Newsletter subscription toggle
app.put('/api/profile/newsletter', auth, (req, res) => {
  try {
    const { subscribed } = req.body;
    db.prepare('UPDATE users SET newsletter_subscribed=?, updated_at=datetime(\'now\') WHERE id=?')
      .run(subscribed ? 1 : 0, req.userId);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
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
  starter: { amount: 695, name: "Starter Plan — $6.95/mo" },
  'starter-yearly': { amount: 6950, name: "Starter Plan — $69.50/year (save $14!)", tier: 'starter' },
  'starter-founding': { amount: 348, name: "Starter Plan — Founding Rate $3.48/mo", tier: 'starter' },
  'starter-founding-yearly': { amount: 3475, name: "Starter Plan — Founding Rate $34.75/year", tier: 'starter' },
  // Legacy plans (kept for backward compat with existing Stripe subscriptions)
  basic: { amount: 995, name: "Basic Plan — $9.95/mo" },
  mid: { amount: 1295, name: "Mid Plan — $12.95/mo" },
  top: { amount: 1995, name: "Top Plan — $19.95/mo" },
  'basic-yearly': { amount: 9500, name: "Basic Plan — $95/year (save $24.40!)", tier: 'basic' },
  'mid-yearly': { amount: 12500, name: "Mid Plan — $125/year (save $30.40!)", tier: 'mid' },
  'top-yearly': { amount: 19000, name: "Top Plan — $190/year (save $49.40!)", tier: 'top' }
};

app.get('/api/billing/plans', (req, res) => {
  res.json({
    foundingMember: true,
    plans: [
      { id: 'free', name: 'Free', price: 0, yearlyPrice: 0, features: ['20 pieces', '1 photo each', 'Personal clay & glaze library', 'Basic search', 'Community forum access'] },
      { id: 'starter', name: 'Starter', price: 6.95, yearlyPrice: 69.50, foundingPrice: 3.48, foundingYearly: 34.75, features: ['Unlimited pieces', '3 photos each', 'Firing logs', 'Glaze recipes', 'Cost tracking', 'Multi-studio', 'Export/print', 'Community glaze library', 'Sales tracking', 'Full forum access (read & post)', 'Cancel anytime'] }
    ],
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

// Admin dashboard — see all members, signups, cancellations, tiers
app.get('/api/admin/members', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const members = db.prepare(`SELECT id, email, display_name, tier, billing_period, plan_expires_at, 
      avatar_filename, created_at, updated_at, stripe_customer_id, stripe_subscription_id 
      FROM users ORDER BY created_at DESC`).all();
    const stats = {
      total: members.length,
      byTier: { free: 0, basic: 0, mid: 0, top: 0 },
      recent7d: 0,
      recent30d: 0
    };
    const now = Date.now();
    members.forEach(m => {
      stats.byTier[m.tier || 'free']++;
      const age = now - new Date(m.created_at).getTime();
      if (age < 7 * 86400000) stats.recent7d++;
      if (age < 30 * 86400000) stats.recent30d++;
    });
    res.json({ members, stats });
  } catch(err) {
    console.error('Admin members error:', err.message);
    res.status(500).json({ error: 'Failed to load members: ' + err.message });
  }
});

// Admin: view orders
app.get('/api/admin/orders', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const orders = db.prepare(`SELECT mo.*, u.email, u.display_name, mp.name as product_name 
      FROM merchant_orders mo 
      JOIN users u ON mo.user_id = u.id 
      LEFT JOIN merchant_products mp ON mo.product_id = mp.id 
      ORDER BY mo.created_at DESC`).all();
    res.json(orders);
  } catch(e) { res.json([]); }
});

// Admin: analytics
app.get('/api/admin/analytics', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const today = db.prepare("SELECT COUNT(*) as c FROM page_views WHERE created_at >= datetime('now', '-1 day')").get().c;
    const week = db.prepare("SELECT COUNT(*) as c FROM page_views WHERE created_at >= datetime('now', '-7 day')").get().c;
    const month = db.prepare("SELECT COUNT(*) as c FROM page_views WHERE created_at >= datetime('now', '-30 day')").get().c;
    const total = db.prepare("SELECT COUNT(*) as c FROM page_views").get().c;
    const byDay = db.prepare("SELECT date(created_at) as day, COUNT(*) as views FROM page_views WHERE created_at >= datetime('now', '-30 day') GROUP BY day ORDER BY day").all();
    const topReferrers = db.prepare("SELECT referrer, COUNT(*) as c FROM page_views WHERE referrer IS NOT NULL AND referrer != '' GROUP BY referrer ORDER BY c DESC LIMIT 20").all();
    const topPages = db.prepare("SELECT path, COUNT(*) as c FROM page_views GROUP BY path ORDER BY c DESC LIMIT 10").all();
    const uniqueIPs = db.prepare("SELECT COUNT(DISTINCT ip) as c FROM page_views WHERE created_at >= datetime('now', '-30 day')").get().c;
    const signupsByDay = db.prepare("SELECT date(created_at) as day, COUNT(*) as signups FROM users WHERE created_at >= datetime('now', '-30 day') GROUP BY day ORDER BY day").all();
    res.json({ today, week, month, total, byDay, topReferrers, topPages, uniqueIPs, signupsByDay });
  } catch(e) { res.json({ today:0, week:0, month:0, total:0, byDay:[], topReferrers:[], topPages:[], uniqueIPs:0, signupsByDay:[] }); }
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

  if (promo.promo_type === 'tokens') {
    // Token promos are no longer supported — treat as a generic redemption
    const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
    const token = jwt.sign({ userId: req.userId, tier: u.tier }, JWT_SECRET, { expiresIn: '30d' });
    return res.json({ success: true, promoType: 'tokens', token, message: 'Promo code redeemed!' });
  }

  db.prepare('UPDATE users SET tier=? WHERE id=?').run(promo.tier, req.userId);
  const token = jwt.sign({ userId: req.userId, tier: promo.tier }, JWT_SECRET, { expiresIn: '30d' });
  res.json({ success: true, promoType: 'tier', tier: promo.tier, expiresAt: expiresAt.toISOString(), token, message: 'Welcome! You now have ' + promo.tier.toUpperCase() + ' access for ' + promo.duration_days + ' days!' });
});

// Create a promo code (admin only — Christina)
app.post('/api/promo/create', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { code, promoType, tier, tokenAmount, durationDays, maxUses, expiresAt } = req.body;
  const type = promoType || 'tier';
  if (!code) return res.status(400).json({ error: 'Code required' });
  if (type === 'tier' && !tier) return res.status(400).json({ error: 'Tier required for tier promos' });
  if (type === 'tokens' && !tokenAmount) return res.status(400).json({ error: 'Token amount required' });
  const id = uuidv4();
  try {
    db.prepare('INSERT INTO promo_codes (id, code, promo_type, tier, token_amount, duration_days, max_uses, created_by, expires_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, code.trim().toUpperCase(), type, type === 'tier' ? tier : 'basic', type === 'tokens' ? (tokenAmount || 0) : 0, durationDays || 30, maxUses || 0, req.userId, expiresAt || null);
    res.json({ id, code: code.trim().toUpperCase(), promoType: type });
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

// ============ DISCOUNT CODES (Shop) ============
app.post('/api/admin/discount/create', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { code, discountPct, maxUses, expiresAt } = req.body;
  if (!code || !discountPct) return res.status(400).json({ error: 'Code and discount percentage required' });
  const id = uuidv4();
  try {
    db.prepare('INSERT INTO discount_codes (id, code, discount_pct, max_uses, expires_at) VALUES (?,?,?,?,?)')
      .run(id, code.trim().toUpperCase(), discountPct, maxUses || 0, expiresAt || null);
    res.json({ id, code: code.trim().toUpperCase(), discountPct });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'Code already exists' });
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/discount/codes', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const codes = db.prepare('SELECT * FROM discount_codes ORDER BY created_at DESC').all();
    res.json(codes);
  } catch(err) {
    // Table might not exist yet
    res.json([]);
  }
});

app.post('/api/shop/apply-discount', auth, (req, res) => {
  const { code } = req.body;
  if (!code) return res.status(400).json({ error: 'Enter a discount code' });
  const discount = db.prepare('SELECT * FROM discount_codes WHERE code=? AND is_active=1').get(code.trim().toUpperCase());
  if (!discount) return res.status(404).json({ error: 'Invalid discount code' });
  if (discount.expires_at && new Date(discount.expires_at) < new Date()) return res.status(400).json({ error: 'This code has expired' });
  if (discount.max_uses > 0 && discount.times_used >= discount.max_uses) return res.status(400).json({ error: 'This code has been fully redeemed' });
  res.json({ valid: true, discountPct: discount.discount_pct, code: discount.code });
});

// ============ PROFILE PHOTO ============
app.post('/api/profile/photo', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file' });
  const old = db.prepare('SELECT profile_photo FROM users WHERE id=?').get(req.userId);
  if (old?.profile_photo) { const p = path.join(UPLOADS_DIR, old.profile_photo); if (fs.existsSync(p)) fs.unlinkSync(p); }
  db.prepare('UPDATE users SET profile_photo=?, avatar_filename=? WHERE id=?').run(req.file.filename, req.file.filename, req.userId);
  res.json({ filename: req.file.filename });
});

// ============ EXPORT (all tiers — glazes and pieces) ============
app.get('/api/export/glazes', auth, (req, res) => {
  const glazes = db.prepare('SELECT * FROM glazes WHERE user_id=? ORDER BY name').all(req.userId);
  let csv = 'Name,Type,Brand,SKU,Color,Cone Range,Atmosphere,Surface,Opacity,Recipe Status,Stock Status,Source,Source URL,In Stock,Buy URL,Notes\n';
  glazes.forEach(g => { csv += `"${(g.name||'').replace(/"/g,'""')}","${g.glaze_type||''}","${(g.brand||'').replace(/"/g,'""')}","${g.sku||''}","${(g.color_description||'').replace(/"/g,'""')}","${g.cone_range||''}","${g.atmosphere||''}","${g.surface||''}","${g.opacity||''}","${g.recipe_status||''}","${g.stock_status||''}","${(g.source||'').replace(/"/g,'""')}","${g.source_url||''}","${g.in_stock?'Yes':'No'}","${g.buy_url||''}","${(g.notes||'').replace(/"/g,'""')}"\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-glazes.csv');
  res.send(csv);
});

app.get('/api/export/clay-bodies', auth, (req, res) => {
  const clays = db.prepare('SELECT * FROM clay_bodies WHERE user_id=? ORDER BY name').all(req.userId);
  let csv = 'Name,Brand,Type,Wet Color,Fired Color,Shrinkage %,Absorption %,Cone Range,Cost Per Bag,Bag Weight,Source,Source URL,In Stock,Buy URL,Notes\n';
  clays.forEach(c => { csv += `"${(c.name||'').replace(/"/g,'""')}","${(c.brand||'').replace(/"/g,'""')}","${c.clay_type||''}","${c.color_wet||''}","${c.color_fired||''}","${c.shrinkage_pct||''}","${c.absorption_pct||''}","${c.cone_range||''}","${c.cost_per_bag||''}","${c.bag_weight||''}","${(c.source||'').replace(/"/g,'""')}","${c.source_url||''}","${c.in_stock?'Yes':'No'}","${c.buy_url||''}","${(c.notes||'').replace(/"/g,'""')}"\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-clay-bodies.csv');
  res.send(csv);
});

app.get('/api/export/firing-logs', auth, (req, res) => {
  const firings = db.prepare('SELECT fl.*,p.title as piece_title FROM firing_logs fl LEFT JOIN pieces p ON fl.piece_id=p.id WHERE fl.user_id=? ORDER BY fl.date DESC').all(req.userId);
  let csv = 'Date,Piece,Type,Cone,Temperature,Atmosphere,Kiln,Speed,Hold,Hold Duration,Results,Notes\n';
  firings.forEach(f => { csv += `"${f.date||''}","${(f.piece_title||'').replace(/"/g,'""')}","${f.firing_type||''}","${f.cone||''}","${f.temperature||''}","${f.atmosphere||''}","${(f.kiln_name||'').replace(/"/g,'""')}","${f.firing_speed||''}","${f.hold_used?'Yes':'No'}","${f.hold_duration||''}","${(f.results||'').replace(/"/g,'""')}","${(f.notes||'').replace(/"/g,'""')}"\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-firing-logs.csv');
  res.send(csv);
});

// ============ CLAY BODIES ============
app.get('/api/clay-bodies', auth, (req, res) => {
  const clays = db.prepare('SELECT * FROM clay_bodies WHERE user_id=? ORDER BY name').all(req.userId);
  const getPhotos = db.prepare('SELECT * FROM clay_photos WHERE clay_id=? ORDER BY sort_order');
  clays.forEach(c => { c.photos = getPhotos.all(c.id); });
  res.json(clays);
});

app.post('/api/clay-bodies', auth, (req, res) => {
  const { name, brand, colorWet, colorFired, shrinkagePct, absorptionPct, coneRange, clayType, costPerBag, bagWeight, source, sourceUrl, inStock, buyUrl, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO clay_bodies (id,user_id,name,brand,color_wet,color_fired,shrinkage_pct,absorption_pct,cone_range,clay_type,cost_per_bag,bag_weight,source,source_url,in_stock,buy_url,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, name, brand, colorWet, colorFired, shrinkagePct, absorptionPct||null, coneRange, clayType, costPerBag, bagWeight, source||null, sourceUrl||null, inStock!==undefined?(inStock?1:0):1, buyUrl||null, notes);
  res.json({ id, name });
});

app.put('/api/clay-bodies/:id', auth, (req, res) => {
  const { name, brand, colorWet, colorFired, shrinkagePct, absorptionPct, coneRange, clayType, costPerBag, bagWeight, source, sourceUrl, inStock, buyUrl, notes } = req.body;
  const r = db.prepare(`UPDATE clay_bodies SET name=?,brand=?,color_wet=?,color_fired=?,shrinkage_pct=?,absorption_pct=?,cone_range=?,clay_type=?,cost_per_bag=?,bag_weight=?,source=?,source_url=?,in_stock=?,buy_url=?,notes=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(name, brand, colorWet, colorFired, shrinkagePct, absorptionPct||null, coneRange, clayType, costPerBag, bagWeight, source||null, sourceUrl||null, inStock!==undefined?(inStock?1:0):1, buyUrl||null, notes, req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.delete('/api/clay-bodies/:id', auth, (req, res) => {
  // Delete clay photos files
  const photos = db.prepare('SELECT filename FROM clay_photos WHERE clay_id=?').all(req.params.id);
  photos.forEach(p => { const f = path.join(UPLOADS_DIR, p.filename); if (fs.existsSync(f)) fs.unlinkSync(f); });
  db.prepare('DELETE FROM clay_photos WHERE clay_id=?').run(req.params.id);
  const r = db.prepare('DELETE FROM clay_bodies WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Clay photo upload
app.post('/api/clay-bodies/:id/photos', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo' });
  const count = db.prepare('SELECT COUNT(*) as c FROM clay_photos WHERE clay_id=?').get(req.params.id).c;
  if (count >= 2) return res.status(403).json({ error: 'Max 2 photos per clay (raw & bisque)' });
  const id = uuidv4();
  db.prepare('INSERT INTO clay_photos (id,clay_id,filename,original_name,photo_label,notes,sort_order) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.params.id, req.file.filename, req.file.originalname, req.body.label||null, req.body.notes||null, count);
  res.json({ id, filename: req.file.filename });
});

// Clay photo delete
app.delete('/api/clay-photos/:id', auth, (req, res) => {
  const ph = db.prepare('SELECT cp.* FROM clay_photos cp JOIN clay_bodies cb ON cp.clay_id=cb.id WHERE cp.id=? AND cb.user_id=?').get(req.params.id, req.userId);
  if (!ph) return res.status(404).json({ error: 'Not found' });
  const f = path.join(UPLOADS_DIR, ph.filename); if (fs.existsSync(f)) fs.unlinkSync(f);
  db.prepare('DELETE FROM clay_photos WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Clay stock toggle
app.put('/api/clay-bodies/:id/stock', auth, (req, res) => {
  const { inStock } = req.body;
  db.prepare('UPDATE clay_bodies SET in_stock=? WHERE id=? AND user_id=?').run(inStock ? 1 : 0, req.params.id, req.userId);
  res.json({ success: true });
});

// ============ GLAZES ============
app.get('/api/glazes', auth, (req, res) => {
  const glazes = db.prepare('SELECT * FROM glazes WHERE user_id=? ORDER BY name').all(req.userId);
  const getIng = db.prepare('SELECT * FROM glaze_ingredients WHERE glaze_id=? ORDER BY sort_order');
  const getPhotos = db.prepare('SELECT * FROM glaze_photos WHERE glaze_id=? ORDER BY sort_order');
  const getClayTests = db.prepare('SELECT * FROM glaze_clay_tests WHERE glaze_id=? ORDER BY created_at DESC');
  glazes.forEach(g => { if (g.glaze_type === 'recipe') g.ingredients = getIng.all(g.id); g.photos = getPhotos.all(g.id); g.clay_tests = getClayTests.all(g.id); });
  res.json(glazes);
});

app.post('/api/glazes', auth, (req, res) => {
  const { name, glazeType, brand, sku, colorDescription, coneRange, atmosphere, surface, opacity, recipeStatus, recipeNotes, stockStatus, source, sourceUrl, inStock, buyUrl, notes, ingredients } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO glazes (id,user_id,name,glaze_type,brand,sku,color_description,cone_range,atmosphere,surface,opacity,recipe_status,recipe_notes,stock_status,source,source_url,in_stock,buy_url,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, name, glazeType || 'commercial', brand, sku, colorDescription, coneRange, atmosphere, surface, opacity||null, recipeStatus||null, recipeNotes||null, stockStatus||null, source||null, sourceUrl||null, inStock!==undefined?(inStock?1:0):1, buyUrl||null, notes);
  if (glazeType === 'recipe' && ingredients?.length) {
    const ins = db.prepare('INSERT INTO glaze_ingredients (id,glaze_id,ingredient_name,percentage,amount,sort_order) VALUES (?,?,?,?,?,?)');
    ingredients.forEach((i, idx) => ins.run(uuidv4(), id, i.name, i.percentage, i.amount, idx));
  }
  res.json({ id, name });
});

app.put('/api/glazes/:id', auth, (req, res) => {
  const { name, glazeType, brand, sku, colorDescription, coneRange, atmosphere, surface, opacity, recipeStatus, recipeNotes, stockStatus, source, sourceUrl, inStock, buyUrl, notes, ingredients } = req.body;
  const r = db.prepare(`UPDATE glazes SET name=?,glaze_type=?,brand=?,sku=?,color_description=?,cone_range=?,atmosphere=?,surface=?,opacity=?,recipe_status=?,recipe_notes=?,stock_status=?,source=?,source_url=?,in_stock=?,buy_url=?,notes=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(name, glazeType, brand, sku, colorDescription, coneRange, atmosphere, surface, opacity||null, recipeStatus||null, recipeNotes||null, stockStatus||null, source||null, sourceUrl||null, inStock!==undefined?(inStock?1:0):1, buyUrl||null, notes, req.params.id, req.userId);
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
  db.prepare('INSERT INTO glaze_photos (id,glaze_id,filename,original_name,photo_label,notes,sort_order) VALUES (?,?,?,?,?,?,?)').run(id, req.params.id, req.file.filename, req.file.originalname, req.body.label||null, req.body.notes||null, count);
  res.json({ id, filename: req.file.filename });
});

// Glaze photo delete
app.delete('/api/glaze-photos/:id', auth, (req, res) => {
  const ph = db.prepare('SELECT gp.* FROM glaze_photos gp JOIN glazes g ON gp.glaze_id=g.id WHERE gp.id=? AND g.user_id=?').get(req.params.id, req.userId);
  if (!ph) return res.status(404).json({ error: 'Not found' });
  const f = path.join(UPLOADS_DIR, ph.filename); if (fs.existsSync(f)) fs.unlinkSync(f);
  db.prepare('DELETE FROM glaze_photos WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// Glaze stock toggle
app.put('/api/glazes/:id/stock', auth, (req, res) => {
  const { stockStatus } = req.body;
  db.prepare('UPDATE glazes SET stock_status=? WHERE id=? AND user_id=?').run(stockStatus||null, req.params.id, req.userId);
  res.json({ success: true });
});

// ============ GLAZE CLAY BODY TESTS ============
app.get('/api/glazes/:id/clay-tests', auth, (req, res) => {
  const glaze = db.prepare('SELECT id FROM glazes WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!glaze) return res.status(404).json({ error: 'Glaze not found' });
  const tests = db.prepare('SELECT * FROM glaze_clay_tests WHERE glaze_id=? ORDER BY created_at DESC').all(req.params.id);
  res.json(tests);
});

app.post('/api/glazes/:id/clay-tests', auth, upload.single('photo'), (req, res) => {
  const glaze = db.prepare('SELECT id FROM glazes WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!glaze) return res.status(404).json({ error: 'Glaze not found' });
  const { clay_body_id, clay_name, result_notes } = req.body;
  let finalClayName = clay_name || null;
  let finalClayBodyId = clay_body_id || null;
  // If clay_body_id provided, look up the name from clay_bodies table
  if (finalClayBodyId) {
    const clay = db.prepare('SELECT name FROM clay_bodies WHERE id=?').get(finalClayBodyId);
    if (clay) finalClayName = clay.name;
    else finalClayBodyId = null; // invalid clay_body_id, treat as manual
  }
  if (!finalClayName) return res.status(400).json({ error: 'Clay name or clay body selection required' });
  const id = uuidv4();
  const photoFilename = req.file ? req.file.filename : null;
  db.prepare('INSERT INTO glaze_clay_tests (id,glaze_id,clay_body_id,clay_name,result_notes,photo_filename) VALUES (?,?,?,?,?,?)')
    .run(id, req.params.id, finalClayBodyId, finalClayName, result_notes || null, photoFilename);
  res.json({ id, clay_name: finalClayName });
});

app.delete('/api/glazes/:id/clay-tests/:testId', auth, (req, res) => {
  const glaze = db.prepare('SELECT id FROM glazes WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!glaze) return res.status(404).json({ error: 'Glaze not found' });
  const test = db.prepare('SELECT photo_filename FROM glaze_clay_tests WHERE id=? AND glaze_id=?').get(req.params.testId, req.params.id);
  if (!test) return res.status(404).json({ error: 'Test not found' });
  if (test.photo_filename) {
    const f = path.join(UPLOADS_DIR, test.photo_filename);
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
  db.prepare('DELETE FROM glaze_clay_tests WHERE id=?').run(req.params.testId);
  res.json({ success: true });
});

// Shopping list — all out-of-stock clays and glazes
app.get('/api/shopping-list', auth, (req, res) => {
  const clays = db.prepare('SELECT id,name,brand,source,source_url,buy_url FROM clay_bodies WHERE user_id=? AND in_stock=0').all(req.userId);
  const glazes = db.prepare('SELECT id,name,brand,source,source_url,buy_url,stock_status FROM glazes WHERE user_id=? AND (stock_status=? OR in_stock=0)').all(req.userId, 'need-to-buy');
  res.json({ clays, glazes });
});

// ============ GLAZE CHEMICALS INVENTORY ============
app.get('/api/glaze-chemicals', auth, (req, res) => {
  res.json(db.prepare('SELECT * FROM glaze_chemicals WHERE user_id=? ORDER BY name').all(req.userId));
});

app.post('/api/glaze-chemicals', auth, (req, res) => {
  const { name, quantity, unit, source, sourceUrl, inStock, notes } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const id = uuidv4();
  db.prepare('INSERT INTO glaze_chemicals (id,user_id,name,quantity,unit,source,source_url,in_stock,notes) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, name, quantity||null, unit||'oz', source||null, sourceUrl||null, inStock!==undefined?(inStock?1:0):1, notes||null);
  res.json({ id, name });
});

app.put('/api/glaze-chemicals/:id', auth, (req, res) => {
  const { name, quantity, unit, source, sourceUrl, inStock, notes } = req.body;
  const r = db.prepare(`UPDATE glaze_chemicals SET name=?,quantity=?,unit=?,source=?,source_url=?,in_stock=?,notes=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(name, quantity||null, unit||'oz', source||null, sourceUrl||null, inStock!==undefined?(inStock?1:0):1, notes||null, req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

app.delete('/api/glaze-chemicals/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM glaze_chemicals WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// ============ PIECES ============
app.get('/api/pieces', auth, (req, res) => {
  const { status, clayBodyId, search, limit, offset, excludeCasualties } = req.query;
  let sql = 'SELECT p.*, cb.name as clay_body_name FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id WHERE p.user_id=?';
  const params = [req.userId];
  if (excludeCasualties) { sql += " AND p.status NOT IN ('broken','recycled')"; }
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
  const { title, description, clayBodyId, studio, status, form, technique, dimensions, weight, materialCost, firingCost, dateStarted, notes, glazeIds, casualtyType, casualtyNotes, casualtyLesson } = req.body;
  const id = uuidv4();
  const isCasualty = (status === 'broken' || status === 'recycled');
  db.prepare('INSERT INTO pieces (id,user_id,title,description,clay_body_id,studio,status,form,technique,dimensions,weight,material_cost,firing_cost,date_started,notes,casualty_type,casualty_notes,casualty_lesson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, title, description, clayBodyId, studio, status || 'in-progress', form, technique, dimensions, weight, materialCost, firingCost, dateStarted, notes, isCasualty ? (casualtyType || null) : null, isCasualty ? (casualtyNotes || null) : null, isCasualty ? (casualtyLesson || null) : null);
  if (glazeIds?.length) {
    const ins = db.prepare('INSERT INTO piece_glazes (id,piece_id,glaze_id,coats,application_method,layer_order) VALUES (?,?,?,?,?,?)');
    glazeIds.forEach((g, i) => ins.run(uuidv4(), id, g.glazeId, g.coats || 1, g.method, i));
  }
  res.json({ id });
});

app.put('/api/pieces/:id', auth, (req, res) => {
  const { title, description, clayBodyId, studio, status, form, technique, dimensions, weight, materialCost, firingCost, salePrice, dateStarted, dateCompleted, dateSold, notes, glazeIds, casualtyType, casualtyNotes, casualtyLesson } = req.body;
  const isCasualty = (status === 'broken' || status === 'recycled');
  const r = db.prepare(`UPDATE pieces SET title=?,description=?,clay_body_id=?,studio=?,status=?,form=?,technique=?,dimensions=?,weight=?,material_cost=?,firing_cost=?,sale_price=?,date_started=?,date_completed=?,date_sold=?,notes=?,casualty_type=?,casualty_notes=?,casualty_lesson=?,updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(title, description, clayBodyId, studio, status, form, technique, dimensions, weight, materialCost, firingCost, salePrice, dateStarted, dateCompleted, dateSold, notes, isCasualty ? (casualtyType || null) : null, isCasualty ? (casualtyNotes || null) : null, isCasualty ? (casualtyLesson || null) : null, req.params.id, req.userId);
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

// Update piece photo stage
app.put('/api/photos/:id/stage', auth, (req, res) => {
  const { stage } = req.body;
  const ph = db.prepare('SELECT pp.* FROM piece_photos pp JOIN pieces p ON pp.piece_id=p.id WHERE pp.id=? AND p.user_id=?').get(req.params.id, req.userId);
  if (!ph) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE piece_photos SET stage=? WHERE id=?').run(stage, req.params.id);
  res.json({ success: true });
});

// ============ FIRING LOGS ============
app.get('/api/firing-logs', auth, (req, res) => {
  const { sort } = req.query;
  let sql = 'SELECT fl.*,p.title as piece_title FROM firing_logs fl LEFT JOIN pieces p ON fl.piece_id=p.id WHERE fl.user_id=?';
  let orderBy = 'ORDER BY fl.date DESC'; // default
  if (sort === 'created_date') orderBy = 'ORDER BY fl.created_at DESC';
  else if (sort === 'firing_type') orderBy = 'ORDER BY fl.firing_type ASC, fl.date DESC';
  else if (sort === 'cone') orderBy = 'ORDER BY fl.cone ASC, fl.date DESC';
  else orderBy = 'ORDER BY fl.date DESC'; // 'firing_date' is default
  sql += ' ' + orderBy;
  const firings = db.prepare(sql).all(req.userId);
  const result = firings.map(f => {
    const photos = db.prepare('SELECT id,filename FROM firing_photos WHERE firing_id=? ORDER BY sort_order ASC').all(f.id);
    return { ...f, photos };
  });
  res.json(result);
});

app.post('/api/firing-logs', auth, requireTier('starter'), (req, res) => {
  const { pieceId, firingType, cone, temperature, atmosphere, kilnName, schedule, duration, firingSpeed, customSpeedDetail, holdUsed, holdDuration, date, results, notes, firingTime, firingMode, loadDescription, firingModeNotes } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO firing_logs (id,user_id,piece_id,firing_type,cone,temperature,atmosphere,kiln_name,schedule,duration,firing_speed,custom_speed_detail,hold_used,hold_duration,date,results,notes,firing_time,firing_mode,load_description,firing_mode_notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, pieceId, firingType, cone, temperature, atmosphere, kilnName, schedule, duration, firingSpeed, customSpeedDetail || null, holdUsed ? 1 : 0, holdDuration, date, results, notes, firingTime || null, firingMode || 'kiln-load', loadDescription || null, firingModeNotes || null);
  res.json({ id });
});

// Edit firing log
app.put('/api/firing-logs/:id', auth, (req, res) => {
  const { pieceId, firingType, cone, temperature, atmosphere, kilnName, schedule, duration, firingSpeed, customSpeedDetail, holdUsed, holdDuration, date, results, notes, firingTime, firingMode, loadDescription, firingModeNotes } = req.body;
  db.prepare('UPDATE firing_logs SET piece_id=?,firing_type=?,cone=?,temperature=?,atmosphere=?,kiln_name=?,schedule=?,duration=?,firing_speed=?,custom_speed_detail=?,hold_used=?,hold_duration=?,date=?,results=?,notes=?,firing_time=?,firing_mode=?,load_description=?,firing_mode_notes=? WHERE id=? AND user_id=?')
    .run(pieceId || null, firingType, cone, temperature, atmosphere, kilnName, schedule, duration, firingSpeed, customSpeedDetail || null, holdUsed ? 1 : 0, holdDuration, date, results, notes, firingTime || null, firingMode || 'kiln-load', loadDescription || null, firingModeNotes || null, req.params.id, req.userId);
  res.json({ success: true });
});

// Delete firing log
app.delete('/api/firing-logs/:id', auth, (req, res) => {
  db.prepare('DELETE FROM firing_logs WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// Firing photos upload
app.post('/api/firing-logs/:id/photos', auth, upload.array('photos', 3), (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files uploaded' });
  const photos = [];
  req.files.forEach((file, idx) => {
    const photoId = uuidv4();
    db.prepare('INSERT INTO firing_photos (id,firing_id,filename,original_name,sort_order) VALUES (?,?,?,?,?)')
      .run(photoId, req.params.id, file.filename, file.originalname, idx);
    photos.push({ id: photoId, filename: file.filename });
  });
  res.json(photos);
});

// Get firing photos
app.get('/api/firing-logs/:id/photos', auth, (req, res) => {
  const photos = db.prepare('SELECT * FROM firing_photos WHERE firing_id=? ORDER BY sort_order').all(req.params.id);
  res.json(photos);
});

// Delete firing photo
app.delete('/api/firing-photos/:id', auth, (req, res) => {
  const photo = db.prepare('SELECT fp.filename,fp.firing_id,fl.user_id FROM firing_photos fp JOIN firing_logs fl ON fp.firing_id=fl.id WHERE fp.id=?').get(req.params.id);
  if (!photo || photo.user_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });
  db.prepare('DELETE FROM firing_photos WHERE id=?').run(req.params.id);
  try { fs.unlinkSync(path.join(UPLOADS_DIR, photo.filename)); } catch(e) { /* ignore */ }
  res.json({ success: true });
});

// Export firing logs as CSV
app.get('/api/export/firing-logs', auth, (req, res) => {
  const firings = db.prepare('SELECT fl.*,p.title as piece_title FROM firing_logs fl LEFT JOIN pieces p ON fl.piece_id=p.id WHERE fl.user_id=? ORDER BY fl.date DESC').all(req.userId);
  let csv = 'Date,Firing Type,Cone,Temperature,Kiln,Duration,Firing Time,Atmosphere,Results,Load Description,Notes\n';
  firings.forEach(f => {
    csv += `"${f.date||''}","${f.firing_type||''}","${f.cone||''}","${f.temperature||''}","${(f.kiln_name||'').replace(/"/g,'""')}","${f.duration||''}","${f.firing_time||''}","${f.atmosphere||''}","${(f.results||'').replace(/"/g,'""')}","${(f.load_description||'').replace(/"/g,'""')}","${(f.notes||'').replace(/"/g,'""')}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-firing-logs.csv');
  res.send(csv);
});

// ============ SALES ============
app.get('/api/sales', auth, requireTier('starter'), (req, res) => {
  const { dateFrom, dateTo } = req.query;
  let sql = 'SELECT s.*,p.title as piece_title FROM sales s LEFT JOIN pieces p ON s.piece_id=p.id WHERE s.user_id=?';
  const params = [req.userId];
  if (dateFrom) { sql += ' AND s.date >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND s.date <= ?'; params.push(dateTo); }
  sql += ' ORDER BY s.date DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/sales', auth, requireTier('starter'), (req, res) => {
  const { pieceId, date, price, venue, venueType, buyerName, notes, quantity, itemDescription, eventName } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO sales (id,user_id,piece_id,date,price,venue,venue_type,buyer_name,notes,quantity,item_description,event_name) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, pieceId || null, date, price, venue, venueType, buyerName, notes, quantity || 1, itemDescription || null, eventName || null);
  if (pieceId) db.prepare(`UPDATE pieces SET status='sold',sale_price=?,date_sold=?,updated_at=datetime('now') WHERE id=? AND user_id=?`).run(price, date, pieceId, req.userId);
  res.json({ id });
});

// Bulk sale creation
app.post('/api/sales/bulk', auth, requireTier('starter'), (req, res) => {
  const { eventName, date, venueType, lineItems } = req.body;
  if (!lineItems || !Array.isArray(lineItems)) return res.status(400).json({ error: 'Invalid line items' });
  const salesIds = [];
  lineItems.forEach(item => {
    const id = uuidv4();
    db.prepare('INSERT INTO sales (id,user_id,date,price,venue_type,quantity,item_description,event_name) VALUES (?,?,?,?,?,?,?,?)')
      .run(id, req.userId, date, item.priceEach, venueType, item.quantity, item.itemDescription, eventName);
    salesIds.push(id);
  });
  res.json({ ids: salesIds });
});

app.get('/api/sales/summary', auth, requireTier('starter'), (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as count, SUM(price) as total FROM sales WHERE user_id=?').get(req.userId);
  const byVenue = db.prepare('SELECT venue_type,COUNT(*) as count,SUM(price) as total FROM sales WHERE user_id=? GROUP BY venue_type').all(req.userId);
  const byMonth = db.prepare(`SELECT strftime('%Y-%m',date) as month,COUNT(*) as count,SUM(price) as total FROM sales WHERE user_id=? GROUP BY month ORDER BY month DESC LIMIT 12`).all(req.userId);
  res.json({ total, byVenue, byMonth });
});

app.get('/api/sales/export', auth, requireTier('starter'), (req, res) => {
  const { dateFrom, dateTo } = req.query;
  let sql = 'SELECT s.*,p.title as piece_title FROM sales s LEFT JOIN pieces p ON s.piece_id=p.id WHERE s.user_id=?';
  const params = [req.userId];
  if (dateFrom) { sql += ' AND s.date >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND s.date <= ?'; params.push(dateTo); }
  sql += ' ORDER BY s.date DESC';
  const sales = db.prepare(sql).all(...params);
  let csv = 'Date,Item Description,Event,Quantity,Price Each,Total,Venue Type,Venue,Buyer,Notes\n';
  sales.forEach(s => { 
    const total = (s.quantity || 1) * (s.price || 0);
    csv += `"${s.date||''}","${(s.item_description||s.piece_title||'').replace(/"/g,'""')}","${(s.event_name||'').replace(/"/g,'""')}","${s.quantity||1}","${s.price||0}","${total}","${s.venue_type||''}","${(s.venue||'').replace(/"/g,'""')}","${(s.buyer_name||'').replace(/"/g,'""')}","${(s.notes||'').replace(/"/g,'""')}"\n`; 
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-sales.csv');
  res.send(csv);
});

app.get('/api/export/pieces', auth, requireTier('starter'), (req, res) => {
  const pieces = db.prepare('SELECT p.*,cb.name as clay_body_name FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id WHERE p.user_id=? ORDER BY p.updated_at DESC').all(req.userId);
  let csv = 'Title,Clay Body,Status,Technique,Form,Studio,Date Started,Date Completed,Material Cost,Firing Cost,Sale Price,Notes\n';
  pieces.forEach(p => { csv += `"${(p.title||'').replace(/"/g,'""')}","${(p.clay_body_name||'').replace(/"/g,'""')}","${p.status||''}","${p.technique||''}","${(p.form||'').replace(/"/g,'""')}","${(p.studio||'').replace(/"/g,'""')}","${p.date_started||''}","${p.date_completed||''}","${p.material_cost||''}","${p.firing_cost||''}","${p.sale_price||''}","${(p.notes||'').replace(/"/g,'""')}"\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-pieces.csv');
  res.send(csv);
});

// ============ COMMUNITY GLAZE COMBOS ============
app.get('/api/community/combos', auth, requireTier('starter'), (req, res) => {
  const { search, cone, atmosphere, filter } = req.query;
  let sql = 'SELECT gc.*,u.display_name as author FROM glaze_combos gc JOIN users u ON gc.user_id=u.id WHERE ';
  const params = [];
  
  // Handle filter: "Community Shared", "My Private Combos", "All My Combos"
  if (filter === 'my-private') {
    sql += 'gc.user_id=? AND gc.is_shared=0';
    params.push(req.userId);
  } else if (filter === 'all-my') {
    sql += 'gc.user_id=?';
    params.push(req.userId);
  } else {
    // Default: Community Shared
    sql += 'gc.is_shared=1';
  }
  
  if (search) { sql += ' AND (gc.name LIKE ? OR gc.description LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  if (cone) { sql += ' AND gc.cone=?'; params.push(cone); }
  if (atmosphere) { sql += ' AND gc.atmosphere=?'; params.push(atmosphere); }
  sql += ' ORDER BY gc.likes DESC, gc.created_at DESC';
  const combos = db.prepare(sql).all(...params);
  const getL = db.prepare('SELECT * FROM glaze_combo_layers WHERE combo_id=? ORDER BY layer_order');
  const getLike = db.prepare('SELECT id FROM combo_likes WHERE combo_id=? AND user_id=?');
  const getCommentCount = db.prepare('SELECT COUNT(*) as c FROM combo_comments WHERE combo_id=?');
  combos.forEach(c => {
    c.layers = getL.all(c.id);
    c.user_liked = !!getLike.get(c.id, req.userId);
    c.comment_count = getCommentCount.get(c.id).c;
  });
  res.json(combos);
});

app.post('/api/community/combos', auth, requireTier('starter'), upload.array('photos', 2), (req, res) => {
  const { name, clayBodyName, cone, atmosphere, description, notes, isShared, layers } = req.body;
  const parsedLayers = typeof layers === 'string' ? JSON.parse(layers) : layers;
  const id = uuidv4();
  const photo1 = req.files?.[0]?.filename || null;
  const photo2 = req.files?.[1]?.filename || null;
  db.prepare('INSERT INTO glaze_combos (id,user_id,name,clay_body_name,cone,atmosphere,description,notes,is_shared,photo_filename,photo_filename2) VALUES (?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, name, clayBodyName, cone, atmosphere, description, notes, isShared === 'true' || isShared === true ? 1 : 0, photo1, photo2);
  if (parsedLayers?.length) {
    const ins = db.prepare('INSERT INTO glaze_combo_layers (id,combo_id,glaze_name,brand,coats,application_method,layer_order) VALUES (?,?,?,?,?,?,?)');
    parsedLayers.forEach((l, i) => ins.run(uuidv4(), id, l.glazeName, l.brand, l.coats || 1, l.method, i));
  }
  res.json({ id });
});

// Edit combo (owner only)
app.put('/api/community/combos/:id', auth, upload.array('photos', 2), (req, res) => {
  const combo = db.prepare('SELECT user_id FROM glaze_combos WHERE id=?').get(req.params.id);
  if (!combo || combo.user_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });
  
  const { name, clayBodyName, cone, atmosphere, description, notes, isShared, layers } = req.body;
  const photo1 = req.files?.[0]?.filename || null;
  const photo2 = req.files?.[1]?.filename || null;
  
  db.prepare('UPDATE glaze_combos SET name=?,clay_body_name=?,cone=?,atmosphere=?,description=?,notes=?,is_shared=?,photo_filename=COALESCE(?,photo_filename),photo_filename2=COALESCE(?,photo_filename2),updated_at=datetime(\'now\') WHERE id=?')
    .run(name, clayBodyName, cone, atmosphere, description, notes, isShared === 'true' || isShared === true ? 1 : 0, photo1, photo2, req.params.id);
  
  if (layers) {
    const parsedLayers = typeof layers === 'string' ? JSON.parse(layers) : layers;
    db.prepare('DELETE FROM glaze_combo_layers WHERE combo_id=?').run(req.params.id);
    if (parsedLayers?.length) {
      const ins = db.prepare('INSERT INTO glaze_combo_layers (id,combo_id,glaze_name,brand,coats,application_method,layer_order) VALUES (?,?,?,?,?,?,?)');
      parsedLayers.forEach((l, i) => ins.run(uuidv4(), req.params.id, l.glazeName, l.brand, l.coats || 1, l.method, i));
    }
  }
  res.json({ success: true });
});

// Delete combo (owner only)
app.delete('/api/community/combos/:id', auth, (req, res) => {
  const combo = db.prepare('SELECT user_id FROM glaze_combos WHERE id=?').get(req.params.id);
  if (!combo || combo.user_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });
  db.prepare('DELETE FROM glaze_combos WHERE id=?').run(req.params.id);
  res.json({ success: true });
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

app.post('/api/forum/posts', auth, upload.array('photos', 5), (req, res) => {
  const { title, body, categoryId } = req.body;
  if (!title || !body) return res.status(400).json({ error: 'Title and body required' });
  const id = uuidv4();
  db.prepare('INSERT INTO forum_posts (id,user_id,category_id,title,body) VALUES (?,?,?,?,?)').run(id, req.userId, categoryId, title, body);
  if (req.files?.length) {
    const ins = db.prepare('INSERT INTO forum_photos (id,post_id,filename,original_name) VALUES (?,?,?,?)');
    req.files.forEach(f => ins.run(uuidv4(), id, f.filename, f.originalname));
  }
  res.json({ id });
});

app.post('/api/forum/posts/:id/reply', auth, upload.array('photos', 3), (req, res) => {
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'Reply body required' });
  const id = uuidv4();
  db.prepare('INSERT INTO forum_replies (id,post_id,user_id,body) VALUES (?,?,?,?)').run(id, req.params.id, req.userId, body);
  db.prepare(`UPDATE forum_posts SET reply_count=reply_count+1, updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  notifyForumReply(req.params.id, req.userId);
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
  const recentPieces = db.prepare("SELECT p.*,cb.name as clay_body_name FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id WHERE p.user_id=? AND p.status NOT IN ('broken','recycled') ORDER BY p.updated_at DESC LIMIT 5").all(req.userId);
  const totalClays = db.prepare('SELECT COUNT(*) as c FROM clay_bodies WHERE user_id=?').get(req.userId).c;
  const totalGlazes = db.prepare('SELECT COUNT(*) as c FROM glazes WHERE user_id=?').get(req.userId).c;

  const getPh = db.prepare('SELECT * FROM piece_photos WHERE piece_id=? ORDER BY sort_order LIMIT 1');
  const getGl = db.prepare('SELECT pg.*,g.name as glaze_name,g.brand,g.glaze_type FROM piece_glazes pg JOIN glazes g ON pg.glaze_id=g.id WHERE pg.piece_id=? ORDER BY pg.layer_order');
  recentPieces.forEach(p => { p.primaryPhoto = getPh.get(p.id) || null; p.glazes = getGl.all(p.id); });

  const stats = { totalPieces, byStatus, recentPieces, totalClays, totalGlazes, tier };

  // Casualty count
  stats.totalCasualties = db.prepare("SELECT COUNT(*) as c FROM pieces WHERE user_id=? AND status IN ('broken','recycled')").get(req.userId).c;

  if (tier !== 'free') {
    const sales = db.prepare('SELECT COUNT(*) as count, SUM(price) as total FROM sales WHERE user_id=?').get(req.userId);
    stats.sales = sales;
  }
  res.json(stats);
});

// ============ CASUALTIES ============
app.get('/api/casualties', auth, (req, res) => {
  const pieces = db.prepare(`SELECT p.*, cb.name as clay_body_name 
    FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id 
    WHERE p.user_id=? AND p.status IN ('broken','recycled') 
    ORDER BY p.updated_at DESC`).all(req.userId);
  const getGl = db.prepare('SELECT pg.*,g.name as glaze_name,g.brand,g.glaze_type FROM piece_glazes pg JOIN glazes g ON pg.glaze_id=g.id WHERE pg.piece_id=? ORDER BY pg.layer_order');
  const getPh = db.prepare('SELECT * FROM piece_photos WHERE piece_id=? ORDER BY sort_order LIMIT 1');
  pieces.forEach(p => { p.glazes = getGl.all(p.id); p.primaryPhoto = getPh.get(p.id) || null; });
  res.json(pieces);
});

// ============ REVIEWS ============
app.post('/api/reviews', auth, (req, res) => {
  try {
    const { rating, body } = req.body;
    if (!rating || !body) return res.status(400).json({ error: 'Rating and review text required' });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
    const existing = db.prepare('SELECT id FROM reviews WHERE user_id=?').get(req.userId);
    if (existing) return res.status(409).json({ error: 'You already submitted a review. You can edit it instead.' });
    const id = uuidv4();
    db.prepare('INSERT INTO reviews (id, user_id, rating, body) VALUES (?,?,?,?)').run(id, req.userId, rating, body);
    res.json({ id, message: 'Review submitted! It will appear on the site once approved.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/reviews', (req, res) => {
  try {
    const { featured } = req.query;
    let sql = 'SELECT r.*, u.display_name, u.avatar_filename FROM reviews r JOIN users u ON r.user_id=u.id WHERE r.is_approved=1';
    if (featured === '1') sql += ' AND r.is_featured=1';
    sql += ' ORDER BY r.is_featured DESC, r.created_at DESC LIMIT 20';
    res.json(db.prepare(sql).all());
  } catch(e) { res.json([]); }
});

app.get('/api/reviews/mine', auth, (req, res) => {
  try {
    const review = db.prepare('SELECT * FROM reviews WHERE user_id=?').get(req.userId);
    res.json(review || null);
  } catch(e) { res.json(null); }
});

app.put('/api/reviews/:id', auth, (req, res) => {
  try {
    const { rating, body } = req.body;
    if (!rating || !body) return res.status(400).json({ error: 'Rating and review text required' });
    if (rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
    const review = db.prepare('SELECT * FROM reviews WHERE id=? AND user_id=?').get(req.params.id, req.userId);
    if (!review) return res.status(404).json({ error: 'Review not found' });
    db.prepare('UPDATE reviews SET rating=?, body=?, is_approved=0 WHERE id=?').run(rating, body, req.params.id);
    res.json({ success: true, message: 'Review updated! It will be re-reviewed before appearing.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/reviews', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const reviews = db.prepare('SELECT r.*, u.display_name, u.email FROM reviews r JOIN users u ON r.user_id=u.id ORDER BY r.created_at DESC').all();
    res.json(reviews);
  } catch(e) { res.json([]); }
});

app.post('/api/admin/reviews/:id/approve', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const current = db.prepare('SELECT is_approved FROM reviews WHERE id=?').get(req.params.id);
    const newVal = current?.is_approved ? 0 : 1;
    db.prepare('UPDATE reviews SET is_approved=? WHERE id=?').run(newVal, req.params.id);
    res.json({ success: true, is_approved: newVal });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/reviews/:id/feature', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const current = db.prepare('SELECT is_featured FROM reviews WHERE id=?').get(req.params.id);
    const newVal = current?.is_featured ? 0 : 1;
    db.prepare('UPDATE reviews SET is_featured=? WHERE id=?').run(newVal, req.params.id);
    res.json({ success: true, is_featured: newVal });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.delete('/api/admin/reviews/:id', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    db.prepare('DELETE FROM reviews WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============ COMBO LIKES & COMMENTS ============
app.post('/api/community/combos/:id/like', auth, (req, res) => {
  try {
    const existing = db.prepare('SELECT id FROM combo_likes WHERE combo_id=? AND user_id=?').get(req.params.id, req.userId);
    if (existing) {
      db.prepare('DELETE FROM combo_likes WHERE id=?').run(existing.id);
      db.prepare('UPDATE glaze_combos SET likes=MAX(0,likes-1) WHERE id=?').run(req.params.id);
      res.json({ liked: false });
    } else {
      db.prepare('INSERT INTO combo_likes (id,combo_id,user_id) VALUES (?,?,?)').run(uuidv4(), req.params.id, req.userId);
      db.prepare('UPDATE glaze_combos SET likes=likes+1 WHERE id=?').run(req.params.id);
      // Notify combo owner
      const combo = db.prepare('SELECT user_id,name FROM glaze_combos WHERE id=?').get(req.params.id);
      if (combo && combo.user_id !== req.userId) {
        const fromUser = db.prepare('SELECT display_name FROM users WHERE id=?').get(req.userId);
        db.prepare('INSERT INTO notifications (id,user_id,type,message,link,from_user_id) VALUES (?,?,?,?,?,?)')
          .run(uuidv4(), combo.user_id, 'combo_like', (fromUser?.display_name||'Someone') + ' liked your glaze combo "' + combo.name + '"', 'community', req.userId);
      }
      res.json({ liked: true });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/community/combos/:id/comments', auth, (req, res) => {
  const comments = db.prepare(`SELECT cc.*, u.display_name as author_name, u.avatar_filename as author_avatar 
    FROM combo_comments cc JOIN users u ON cc.user_id=u.id WHERE cc.combo_id=? ORDER BY cc.created_at`).all(req.params.id);
  res.json(comments);
});

app.post('/api/community/combos/:id/comments', auth, (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Comment required' });
  const id = uuidv4();
  db.prepare('INSERT INTO combo_comments (id,combo_id,user_id,body) VALUES (?,?,?,?)').run(id, req.params.id, req.userId, body.trim());
  // Notify combo owner
  const combo = db.prepare('SELECT user_id,name FROM glaze_combos WHERE id=?').get(req.params.id);
  if (combo && combo.user_id !== req.userId) {
    const fromUser = db.prepare('SELECT display_name FROM users WHERE id=?').get(req.userId);
    db.prepare('INSERT INTO notifications (id,user_id,type,message,link,from_user_id) VALUES (?,?,?,?,?,?)')
      .run(uuidv4(), combo.user_id, 'combo_comment', (fromUser?.display_name||'Someone') + ' commented on your glaze combo "' + combo.name + '"', 'community', req.userId);
  }
  res.json({ id });
});

app.delete('/api/community/comments/:id', auth, (req, res) => {
  const c = db.prepare('SELECT user_id FROM combo_comments WHERE id=?').get(req.params.id);
  if (!c) return res.status(404).json({ error: 'Not found' });
  if (c.user_id !== req.userId && !isAdmin(req)) return res.status(403).json({ error: 'Not yours' });
  db.prepare('DELETE FROM combo_comments WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ============ FORUM LIKES & NOTIFICATIONS ============
// Like a forum post
app.post('/api/forum/posts/:id/like', auth, (req, res) => {
  // reuse combo_likes pattern — store in a generic way
  try {
    const existing = db.prepare('SELECT id FROM combo_likes WHERE combo_id=? AND user_id=?').get('fp_'+req.params.id, req.userId);
    if (existing) {
      db.prepare('DELETE FROM combo_likes WHERE id=?').run(existing.id);
      res.json({ liked: false });
    } else {
      db.prepare('INSERT INTO combo_likes (id,combo_id,user_id) VALUES (?,?,?)').run(uuidv4(), 'fp_'+req.params.id, req.userId);
      // Notify post author
      const post = db.prepare('SELECT user_id,title FROM forum_posts WHERE id=?').get(req.params.id);
      if (post && post.user_id !== req.userId) {
        const fromUser = db.prepare('SELECT display_name FROM users WHERE id=?').get(req.userId);
        db.prepare('INSERT INTO notifications (id,user_id,type,message,link,from_user_id) VALUES (?,?,?,?,?,?)')
          .run(uuidv4(), post.user_id, 'forum_like', (fromUser?.display_name||'Someone') + ' liked your post "' + post.title + '"', 'forum', req.userId);
      }
      res.json({ liked: true });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Notify on forum reply (add to existing reply endpoint is complex, so add a post-reply notification hook)
// We'll add notifications inside the existing reply endpoint via a helper
function notifyForumReply(postId, replyUserId) {
  try {
    const post = db.prepare('SELECT user_id,title FROM forum_posts WHERE id=?').get(postId);
    if (post && post.user_id !== replyUserId) {
      const fromUser = db.prepare('SELECT display_name FROM users WHERE id=?').get(replyUserId);
      db.prepare('INSERT INTO notifications (id,user_id,type,message,link,from_user_id) VALUES (?,?,?,?,?,?)')
        .run(uuidv4(), post.user_id, 'forum_reply', (fromUser?.display_name||'Someone') + ' replied to your post "' + post.title + '"', 'forumPost_'+postId, replyUserId);
    }
  } catch(e) { /* silent */ }
}

// ============ NOTIFICATIONS ============
app.get('/api/notifications', auth, (req, res) => {
  const notifs = db.prepare('SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50').all(req.userId);
  const unread = db.prepare('SELECT COUNT(*) as c FROM notifications WHERE user_id=? AND is_read=0').get(req.userId).c;
  res.json({ notifications: notifs, unread });
});

app.post('/api/notifications/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE user_id=?').run(req.userId);
  res.json({ success: true });
});

app.post('/api/notifications/:id/read', auth, (req, res) => {
  db.prepare('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ============ IN-APP MESSAGING ============
app.get('/api/messages', auth, (req, res) => {
  // Get conversation list (latest message per conversation partner)
  const conversations = db.prepare(`
    SELECT m.*, 
      CASE WHEN m.from_user_id=? THEN m.to_user_id ELSE m.from_user_id END as partner_id,
      u.display_name as partner_name, u.avatar_filename as partner_avatar
    FROM messages m
    JOIN users u ON u.id = CASE WHEN m.from_user_id=? THEN m.to_user_id ELSE m.from_user_id END
    WHERE m.from_user_id=? OR m.to_user_id=?
    ORDER BY m.created_at DESC
  `).all(req.userId, req.userId, req.userId, req.userId);
  // Deduplicate to latest per partner
  const seen = new Set();
  const convos = [];
  conversations.forEach(c => {
    if (!seen.has(c.partner_id)) { seen.add(c.partner_id); convos.push(c); }
  });
  const unread = db.prepare('SELECT COUNT(*) as c FROM messages WHERE to_user_id=? AND is_read=0').get(req.userId).c;
  res.json({ conversations: convos, unread });
});

app.get('/api/messages/:userId', auth, (req, res) => {
  const msgs = db.prepare(`SELECT m.*, u.display_name as from_name, u.avatar_filename as from_avatar
    FROM messages m JOIN users u ON m.from_user_id=u.id
    WHERE (m.from_user_id=? AND m.to_user_id=?) OR (m.from_user_id=? AND m.to_user_id=?)
    ORDER BY m.created_at`).all(req.userId, req.params.userId, req.params.userId, req.userId);
  // Mark as read
  db.prepare('UPDATE messages SET is_read=1 WHERE to_user_id=? AND from_user_id=?').run(req.userId, req.params.userId);
  const partner = db.prepare('SELECT id,display_name,avatar_filename FROM users WHERE id=?').get(req.params.userId);
  res.json({ messages: msgs, partner });
});

app.post('/api/messages/:userId', auth, (req, res) => {
  const { body } = req.body;
  if (!body?.trim()) return res.status(400).json({ error: 'Message required' });
  // Check not blocked
  const blocked = db.prepare('SELECT id FROM blocked_users WHERE (user_id=? AND blocked_user_id=?) OR (user_id=? AND blocked_user_id=?)').get(req.userId, req.params.userId, req.params.userId, req.userId);
  if (blocked) return res.status(403).json({ error: 'Cannot message this user' });
  const id = uuidv4();
  db.prepare('INSERT INTO messages (id,from_user_id,to_user_id,body) VALUES (?,?,?,?)').run(id, req.userId, req.params.userId, body.trim());
  // Notify recipient
  const fromUser = db.prepare('SELECT display_name FROM users WHERE id=?').get(req.userId);
  db.prepare('INSERT INTO notifications (id,user_id,type,message,link,from_user_id) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), req.params.userId, 'message', (fromUser?.display_name||'Someone') + ' sent you a message', 'messages_'+req.userId, req.userId);
  res.json({ id });
});

// ============ ADMIN: CANCEL MEMBERSHIP & SEARCH ============
app.post('/api/admin/members/:id/cancel', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    db.prepare(`UPDATE users SET tier='free', stripe_subscription_id=NULL, plan_expires_at=NULL, billing_period=NULL WHERE id=?`).run(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/members/search', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { q } = req.query;
  if (!q) return res.json([]);
  const members = db.prepare(`SELECT id, email, display_name, tier, billing_period, plan_expires_at, created_at 
    FROM users WHERE email LIKE ? OR display_name LIKE ? ORDER BY created_at DESC LIMIT 20`).all('%'+q+'%', '%'+q+'%');
  res.json(members);
});

// ============ COMMUNITY MEMBERS ============
app.get('/api/community/members', auth, (req, res) => {
  try {
    const members = db.prepare(`
      SELECT id, display_name, username, avatar_filename, bio, location, website, is_private, created_at 
      FROM users ORDER BY display_name ASC LIMIT 200
    `).all();
    const result = members.map(m => {
      if (m.is_private) return { id: m.id, display_name: m.username || m.display_name, avatar_filename: m.avatar_filename, bio: null, location: null, website: null, is_private: 1 };
      return { ...m, display_name: m.username || m.display_name };
    });
    res.json(result);
  } catch(e) {
    // Fallback if username column doesn't exist yet
    const members = db.prepare(`
      SELECT id, display_name, avatar_filename, bio, location, website, is_private, created_at 
      FROM users ORDER BY display_name ASC LIMIT 200
    `).all();
    const result = members.map(m => {
      if (m.is_private) return { id: m.id, display_name: m.display_name, avatar_filename: m.avatar_filename, bio: null, location: null, website: null, is_private: 1 };
      return m;
    });
    res.json(result);
  }
});

// ============ GOALS ============
app.get('/api/goals', auth, (req, res) => {
  const goals = db.prepare('SELECT * FROM goals WHERE user_id=? ORDER BY due_date ASC, updated_at DESC').all(req.userId);
  res.json(goals);
});

app.post('/api/goals', auth, requireTier('starter'), (req, res) => {
  const { title, description, status, dueDate, priority } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO goals (id,user_id,title,description,status,due_date,priority) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.userId, title, description, status || 'active', dueDate || null, priority || 'medium');
  res.json({ id });
});

app.put('/api/goals/:id', auth, (req, res) => {
  const { title, description, status, dueDate, priority } = req.body;
  db.prepare('UPDATE goals SET title=?,description=?,status=?,due_date=?,priority=?,updated_at=datetime(\'now\') WHERE id=? AND user_id=?')
    .run(title, description, status, dueDate, priority, req.params.id, req.userId);
  res.json({ success: true });
});

app.delete('/api/goals/:id', auth, (req, res) => {
  db.prepare('DELETE FROM goals WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ============ PROJECTS ============
app.get('/api/projects', auth, (req, res) => {
  const projects = db.prepare('SELECT * FROM projects WHERE user_id=? ORDER BY due_date ASC, updated_at DESC').all(req.userId);
  const result = projects.map(p => {
    const photos = db.prepare('SELECT id,filename FROM project_photos WHERE project_id=? ORDER BY sort_order ASC').all(p.id);
    return { ...p, photos };
  });
  res.json(result);
});

app.post('/api/projects', auth, requireTier('starter'), (req, res) => {
  const { title, description, status, dueDate } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO projects (id,user_id,title,description,status,due_date) VALUES (?,?,?,?,?,?)')
    .run(id, req.userId, title, description, status || 'active', dueDate || null);
  res.json({ id });
});

app.put('/api/projects/:id', auth, (req, res) => {
  const { title, description, status, dueDate } = req.body;
  db.prepare('UPDATE projects SET title=?,description=?,status=?,due_date=?,updated_at=datetime(\'now\') WHERE id=? AND user_id=?')
    .run(title, description, status, dueDate, req.params.id, req.userId);
  res.json({ success: true });
});

app.delete('/api/projects/:id', auth, (req, res) => {
  db.prepare('DELETE FROM projects WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: true });
});

app.post('/api/projects/:id/photos', auth, upload.array('photos', 5), (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare('SELECT user_id FROM projects WHERE id=?').get(projectId);
  if (!project || project.user_id !== req.userId) return res.status(403).json({ error: 'Unauthorized' });
  for (const f of req.files) {
    const photoId = uuidv4();
    db.prepare('INSERT INTO project_photos (id,project_id,filename,original_name) VALUES (?,?,?,?)')
      .run(photoId, projectId, f.filename, f.originalname);
  }
  res.json({ success: true });
});

app.get('/api/projects/:id/photos', auth, (req, res) => {
  const projectId = req.params.id;
  const project = db.prepare('SELECT user_id FROM projects WHERE id=?').get(projectId);
  if (!project || project.user_id !== req.userId) return res.status(403).json({ error: 'Unauthorized' });
  const photos = db.prepare('SELECT id,filename FROM project_photos WHERE project_id=? ORDER BY sort_order ASC').all(projectId);
  res.json(photos);
});

app.delete('/api/project-photos/:id', auth, (req, res) => {
  const photo = db.prepare('SELECT p.project_id, pr.user_id FROM project_photos p JOIN projects pr ON p.project_id=pr.id WHERE p.id=?').get(req.params.id);
  if (!photo || photo.user_id !== req.userId) return res.status(403).json({ error: 'Unauthorized' });
  const filename = db.prepare('SELECT filename FROM project_photos WHERE id=?').get(req.params.id)?.filename;
  if (filename) {
    try { fs.unlinkSync(path.join(uploadsDir, filename)); } catch(e) {}
  }
  db.prepare('DELETE FROM project_photos WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ============ EVENTS ============
app.get('/api/events', auth, (req, res) => {
  const events = db.prepare('SELECT * FROM events WHERE user_id=? ORDER BY event_date ASC').all(req.userId);
  res.json(events);
});

app.post('/api/events', auth, requireTier('starter'), (req, res) => {
  const { title, description, eventDate, startTime, endTime, location } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO events (id,user_id,title,description,event_date,start_time,end_time,location) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.userId, title, description, eventDate, startTime || null, endTime || null, location || null);
  res.json({ id });
});

app.put('/api/events/:id', auth, (req, res) => {
  const { title, description, eventDate, startTime, endTime, location } = req.body;
  db.prepare('UPDATE events SET title=?,description=?,event_date=?,start_time=?,end_time=?,location=?,updated_at=datetime(\'now\') WHERE id=? AND user_id=?')
    .run(title, description, eventDate, startTime, endTime, location, req.params.id, req.userId);
  res.json({ success: true });
});

app.delete('/api/events/:id', auth, (req, res) => {
  db.prepare('DELETE FROM events WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// Events export as iCalendar (.ics)
app.get('/api/events/export/ics', auth, (req, res) => {
  const events = db.prepare('SELECT * FROM events WHERE user_id=? ORDER BY event_date ASC').all(req.userId);
  let ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//The Potter's Mud Room//EN
CALSCALE:GREGORIAN
METHOD:PUBLISH
X-WR-CALNAME:Events
X-WR-TIMEZONE:UTC
`;
  events.forEach(e => {
    const dtstart = (e.event_date + (e.start_time ? 'T' + e.start_time.replace(/:/g, '') : 'T000000')).replace(/-/g, '');
    const dtend = (e.event_date + (e.end_time ? 'T' + e.end_time.replace(/:/g, '') : 'T235959')).replace(/-/g, '');
    ics += `BEGIN:VEVENT
DTSTART:${dtstart}Z
DTEND:${dtend}Z
SUMMARY:${e.title.replace(/[,;\\]/g, '\\$&')}
DESCRIPTION:${(e.description || '').replace(/[,;\\]/g, '\\$&')}
LOCATION:${(e.location || '').replace(/[,;\\]/g, '\\$&')}
END:VEVENT
`;
  });
  ics += 'END:VCALENDAR';
  res.setHeader('Content-Type', 'text/calendar');
  res.setHeader('Content-Disposition', 'attachment; filename=events.ics');
  res.send(ics);
});

// ============ CONTACTS ============
app.get('/api/contacts', auth, (req, res) => {
  const contacts = db.prepare('SELECT * FROM contacts WHERE user_id=? ORDER BY name ASC').all(req.userId);
  res.json(contacts);
});

app.post('/api/contacts', auth, requireTier('starter'), (req, res) => {
  const { name, email, phone, notes } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO contacts (id,user_id,name,email,phone,notes) VALUES (?,?,?,?,?,?)')
    .run(id, req.userId, name, email || null, phone || null, notes || null);
  res.json({ id });
});

app.put('/api/contacts/:id', auth, (req, res) => {
  const { name, email, phone, notes } = req.body;
  db.prepare('UPDATE contacts SET name=?,email=?,phone=?,notes=?,updated_at=datetime(\'now\') WHERE id=? AND user_id=?')
    .run(name, email, phone, notes, req.params.id, req.userId);
  res.json({ success: true });
});

app.delete('/api/contacts/:id', auth, (req, res) => {
  db.prepare('DELETE FROM contacts WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ success: true });
});

// ============ PUBLIC PROFILE (limited info) ============
app.get('/api/users/:id/profile', auth, (req, res) => {
  const user = db.prepare('SELECT id, display_name, avatar_filename, bio, location, website, is_private, created_at FROM users WHERE id=?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'User not found' });
  // If private, only show basic info
  if (user.is_private && user.id !== req.userId) {
    res.json({ id: user.id, display_name: user.display_name, avatar_filename: user.avatar_filename, is_private: true });
  } else {
    res.json(user);
  }
});

// ============ REFERRAL STATS ============
app.get('/api/referrals/stats', auth, (req, res) => {
  try {
    const stats = db.prepare('SELECT COUNT(*) as count FROM referral_rewards WHERE referrer_id=?').get(req.userId);
    const referrals = db.prepare(`SELECT rr.*, u.display_name, u.email, u.created_at as user_joined 
      FROM referral_rewards rr JOIN users u ON rr.referred_id=u.id 
      WHERE rr.referrer_id=? ORDER BY rr.created_at DESC LIMIT 20`).all(req.userId);
    const user = db.prepare('SELECT referral_code, free_months_remaining FROM users WHERE id=?').get(req.userId);
    res.json({ referralCode: user?.referral_code, count: stats?.count || 0, freeMonthsRemaining: user?.free_months_remaining || 0, referrals });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============ SHAREABLE GLAZE COMBOS (Public) ============
// Helper: generate unique share ID
function generateShareId() {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let code;
  do {
    code = '';
    for (let i = 0; i < 10; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (db.prepare('SELECT id FROM glaze_combos WHERE share_id=?').get(code));
  return code;
}

// Toggle combo public/private
app.put('/api/community/combos/:id/public', auth, (req, res) => {
  try {
    const combo = db.prepare('SELECT user_id, share_id, is_public FROM glaze_combos WHERE id=?').get(req.params.id);
    if (!combo || combo.user_id !== req.userId) return res.status(403).json({ error: 'Not authorized' });
    const newPublic = req.body.isPublic ? 1 : 0;
    let shareId = combo.share_id;
    if (newPublic && !shareId) shareId = generateShareId();
    db.prepare('UPDATE glaze_combos SET is_public=?, share_id=? WHERE id=?').run(newPublic, shareId, req.params.id);
    res.json({ success: true, isPublic: newPublic, shareId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Public combo endpoint (no auth required)
app.get('/api/combos/public/:shareId', (req, res) => {
  try {
    const combo = db.prepare(`SELECT gc.*, u.display_name as author, u.avatar_filename as author_avatar 
      FROM glaze_combos gc JOIN users u ON gc.user_id=u.id 
      WHERE gc.share_id=? AND gc.is_public=1`).get(req.params.shareId);
    if (!combo) return res.status(404).json({ error: 'Combo not found or is private' });
    const layers = db.prepare('SELECT * FROM glaze_combo_layers WHERE combo_id=? ORDER BY layer_order').all(combo.id);
    combo.layers = layers;
    res.json(combo);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============ BLOG SYSTEM ============
// Public: list published blog posts
app.get('/api/blog/posts', (req, res) => {
  try {
    const posts = db.prepare('SELECT id, title, slug, excerpt, author, published_at FROM blog_posts WHERE is_published=1 ORDER BY published_at DESC').all();
    res.json(posts);
  } catch(e) { res.json([]); }
});

// Public: get single blog post by slug
app.get('/api/blog/posts/:slug', (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM blog_posts WHERE slug=? AND is_published=1').get(req.params.slug);
    if (!post) return res.status(404).json({ error: 'Post not found' });
    res.json(post);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: list all blog posts (including unpublished)
app.get('/api/admin/blog/posts', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const posts = db.prepare('SELECT * FROM blog_posts ORDER BY created_at DESC').all();
    res.json(posts);
  } catch(e) { res.json([]); }
});

// Admin: create blog post
app.post('/api/admin/blog/posts', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { title, slug, content, excerpt, author, isPublished } = req.body;
    if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
    const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const id = uuidv4();
    db.prepare('INSERT INTO blog_posts (id, title, slug, content, excerpt, author, is_published) VALUES (?,?,?,?,?,?,?)')
      .run(id, title, finalSlug, content, excerpt || content.substring(0, 200) + '...', author || 'Christina Workman', isPublished ? 1 : 0);
    res.json({ id, slug: finalSlug });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'A post with that slug already exists' });
    res.status(500).json({ error: e.message });
  }
});

// Admin: update blog post
app.put('/api/admin/blog/posts/:id', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { title, slug, content, excerpt, author, isPublished } = req.body;
    db.prepare(`UPDATE blog_posts SET title=?, slug=?, content=?, excerpt=?, author=?, is_published=?, updated_at=datetime('now') WHERE id=?`)
      .run(title, slug, content, excerpt, author || 'Christina Workman', isPublished ? 1 : 0, req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: delete blog post
app.delete('/api/admin/blog/posts/:id', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    db.prepare('DELETE FROM blog_posts WHERE id=?').run(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: publish blog post (set is_published=1)
app.put('/api/admin/blog/:id/publish', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    db.prepare(`UPDATE blog_posts SET is_published=1, updated_at=datetime('now') WHERE id=?`)
      .run(req.params.id);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============ FEATURED POTTER ============
// Public: get current featured potter
app.get('/api/featured-potter', (req, res) => {
  try {
    const featured = db.prepare(`SELECT fp.*, u.display_name, u.avatar_filename, u.profile_photo, u.bio
      FROM featured_potter fp JOIN users u ON fp.user_id=u.id 
      ORDER BY fp.featured_date DESC LIMIT 1`).get();
    if (!featured) return res.json(null);
    const pieceCount = db.prepare('SELECT COUNT(*) as c FROM pieces WHERE user_id=?').get(featured.user_id)?.c || 0;
    res.json({ ...featured, pieceCount });
  } catch(e) { res.json(null); }
});

// Admin: set featured potter
app.post('/api/admin/featured-potter', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { userId, quote } = req.body;
    if (!userId) return res.status(400).json({ error: 'User ID required' });
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(userId);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const id = uuidv4();
    db.prepare('INSERT INTO featured_potter (id, user_id, quote) VALUES (?,?,?)').run(id, userId, quote || null);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: get featured potter history
app.get('/api/admin/featured-potter', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const history = db.prepare(`SELECT fp.*, u.display_name, u.email 
      FROM featured_potter fp JOIN users u ON fp.user_id=u.id 
      ORDER BY fp.featured_date DESC LIMIT 20`).all();
    res.json(history);
  } catch(e) { res.json([]); }
});

// ============ NEWSLETTER SIGNUP ============
// Public: subscribe
app.post('/api/newsletter/subscribe', (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) return res.status(400).json({ error: 'Valid email required' });
    const existing = db.prepare('SELECT id, is_active FROM newsletter_subscribers WHERE email=?').get(email);
    if (existing) {
      if (existing.is_active) return res.json({ success: true, message: 'You\'re already subscribed!' });
      db.prepare('UPDATE newsletter_subscribers SET is_active=1 WHERE id=?').run(existing.id);
      return res.json({ success: true, message: 'Welcome back! You\'re re-subscribed.' });
    }
    const id = uuidv4();
    db.prepare('INSERT INTO newsletter_subscribers (id, email) VALUES (?,?)').run(id, email);
    res.json({ success: true, message: 'You\'re in! Watch your inbox for pottery tips.' });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.json({ success: true, message: 'You\'re already subscribed!' });
    res.status(500).json({ error: e.message });
  }
});

// Admin: view subscribers
app.get('/api/admin/newsletter', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const subscribers = db.prepare('SELECT * FROM newsletter_subscribers WHERE is_active=1 ORDER BY subscribed_at DESC').all();
    const total = subscribers.length;
    res.json({ subscribers, total });
  } catch(e) { res.json({ subscribers: [], total: 0 }); }
});

// Admin: export subscribers as CSV
app.get('/api/admin/newsletter/export', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const subscribers = db.prepare('SELECT email, subscribed_at FROM newsletter_subscribers WHERE is_active=1 ORDER BY subscribed_at DESC').all();
    let csv = 'Email,Subscribed At\n';
    subscribers.forEach(s => { csv += `"${s.email}","${s.subscribed_at}"\n`; });
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=newsletter-subscribers.csv');
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: get subscriber count
app.get('/api/admin/newsletter/subscribers', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const result = db.prepare('SELECT COUNT(*) as count FROM users WHERE newsletter_subscribed=1').get();
    res.json({ count: result.count || 0 });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: get newsletter send history
app.get('/api/admin/newsletter/history', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const sends = db.prepare(`
      SELECT ns.id, ns.blog_post_id, ns.sent_at, ns.recipients_count, bp.title, bp.slug
      FROM newsletter_sends ns
      JOIN blog_posts bp ON ns.blog_post_id = bp.id
      ORDER BY ns.sent_at DESC
    `).all();
    res.json(sends);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: send newsletter to all subscribers
app.post('/api/admin/newsletter/send', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { blogPostId } = req.body;
    if (!blogPostId) return res.status(400).json({ error: 'blogPostId required' });

    // Get blog post
    const post = db.prepare('SELECT id, title, slug, excerpt, content FROM blog_posts WHERE id=?').get(blogPostId);
    if (!post) return res.status(404).json({ error: 'Blog post not found' });

    // Get all subscribed users
    const subscribers = db.prepare('SELECT id, email FROM users WHERE newsletter_subscribed=1').all();
    if (subscribers.length === 0) return res.json({ success: true, recipientCount: 0 });

    const notificationId = uuidv4();
    const sendId = uuidv4();
    
    // Send email to each subscriber (if email configured) and create notification
    subscribers.forEach(subscriber => {
      // Create in-app notification
      db.prepare(`
        INSERT INTO notifications (id, user_id, type, message, link, created_at)
        VALUES (?,?,?,?,?,datetime('now'))
      `).run(uuidv4(), subscriber.id, 'newsletter', post.title, '/blog/' + post.slug);

      // Send email if configured
      if (transporter) {
        const mailOptions = {
          from: process.env.SMTP_USER || 'thepottersmudroom@gmail.com',
          to: subscriber.email,
          subject: 'New from The Potter\'s Mud Room: ' + post.title,
          html: `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <div style="background: linear-gradient(135deg, #8B7355 0%, #A0826D 100%); padding: 20px; text-align: center; color: white;">
                <h2 style="margin: 0;">New from The Potter's Mud Room</h2>
              </div>
              <div style="padding: 20px; border: 1px solid #ddd; border-top: none;">
                <h3 style="color: #333; margin-top: 0;">${post.title}</h3>
                <p style="color: #666; line-height: 1.6;">${post.excerpt || post.content.substring(0, 300)}</p>
                <div style="text-align: center; margin: 20px 0;">
                  <a href="https://thepottersmudroom.com/blog/${post.slug}" style="background: #8B7355; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Read Now</a>
                </div>
              </div>
              <div style="padding: 10px 20px; background: #f5f5f5; font-size: 12px; color: #999; text-align: center;">
                <p>The Potter's Mud Room © 2026. <a href="https://thepottersmudroom.com" style="color: #8B7355; text-decoration: none;">Visit our site</a></p>
              </div>
            </div>
          `
        };
        transporter.sendMail(mailOptions).catch(err => {
          console.error('Newsletter email error:', err.message);
        });
      }
    });

    // Record the send
    db.prepare(`
      INSERT INTO newsletter_sends (id, blog_post_id, sent_by, recipients_count)
      VALUES (?,?,?,?)
    `).run(sendId, blogPostId, req.userId, subscribers.length);

    res.json({ success: true, recipientCount: subscribers.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ============ BACKFILL REFERRAL CODES ============
// Ensure all existing users have referral codes at startup
try {
  const usersWithoutCodes = db.prepare('SELECT id FROM users WHERE referral_code IS NULL').all();
  usersWithoutCodes.forEach(u => {
    db.prepare('UPDATE users SET referral_code=? WHERE id=?').run(generateReferralCode(), u.id);
  });
} catch(e) { /* ignore if table doesn't exist yet */ }

// SPA fallback
app.get('*', (req, res) => {
  if (!req.path.startsWith('/api/') && !req.path.startsWith('/uploads/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏺 The Potter's Mud Room running on http://localhost:${PORT}`);
});