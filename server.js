const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// Deploy version tag — used to verify which code is actually running on Render
const DEPLOY_VERSION = 'v9-fix-edit-photo-2026-07-06';
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const crypto = require('crypto');
const { Expo } = require('expo-server-sdk');
const { initDB } = require('./database');

const expo = new Expo();

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'pottery-app-dev-secret-change-in-prod';
const db = initDB();

// AI usage tracking table
db.exec(`CREATE TABLE IF NOT EXISTS ai_usage (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at DATETIME DEFAULT (datetime('now')),
  message TEXT
)`);
db.exec(`CREATE INDEX IF NOT EXISTS idx_ai_usage_user_month ON ai_usage(user_id, created_at)`);

// Migrate all tiers to free/unlimited (starter = unlimited internally)
try {
  db.pragma('ignore_check_constraints = ON');
  db.prepare("UPDATE users SET tier='starter' WHERE tier IN ('basic','mid','top')").run();
  db.prepare("UPDATE users SET tier='starter', billing_period='stripe-monthly' WHERE LOWER(email) IN ('jgk1020@gmail.com','awhiteman96@gmail.com')").run();
  db.pragma('ignore_check_constraints = OFF');
} catch(e) { db.pragma('ignore_check_constraints = OFF'); }

// AI tokens column
try { db.exec("ALTER TABLE users ADD COLUMN ai_tokens INTEGER DEFAULT 0"); } catch(e) { /* already exists */ }
// Potter demographics columns
try { db.exec("ALTER TABLE users ADD COLUMN potter_type TEXT DEFAULT NULL"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN years_experience TEXT DEFAULT NULL"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN studio_type TEXT DEFAULT NULL"); } catch(e) {}
try { db.exec("ALTER TABLE users ADD COLUMN signup_source TEXT DEFAULT NULL"); } catch(e) {}
// Photo search exclusion flag — lets users hide specific pieces from photo search results
try { db.exec("ALTER TABLE pieces ADD COLUMN hide_from_photo_search INTEGER DEFAULT 0"); } catch(e) {}
// Nodemailer setup for newsletter emails
let transporter = null;
function setupTransporter(user, pass, host, port) {
  if (user && pass) {
    const config = host
      ? { host, port: port || 587, secure: false, auth: { user, pass } }
      : { service: 'gmail', auth: { user, pass } };
    transporter = nodemailer.createTransport(config);
    transporter.verify((err) => {
      if (err) console.error('⚠️  SMTP verification failed:', err.message);
      else console.log('✅ SMTP connected as', user, host ? '(via '+host+')' : '(via gmail)');
    });
  }
}

// Try env vars first
if (process.env.SMTP_USER && process.env.SMTP_PASS) {
  setupTransporter(process.env.SMTP_USER, process.env.SMTP_PASS, process.env.SMTP_HOST, parseInt(process.env.SMTP_PORT) || undefined);
} else {
  console.warn('⚠️  SMTP not configured via env — will check database on startup');
}

// Stripe setup (optional — works without keys, just disables payments)
const STRIPE_SECRET = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';
let stripe = null;
if (STRIPE_SECRET) {
  stripe = require('stripe')(STRIPE_SECRET);
}

// OpenAI for Pottery AI assistant
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';
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

// Safe multer wrapper — if multipart parsing fails, continue with JSON body
const safeUpload = (fieldName) => (req, res, next) => {
  const ct = (req.headers['content-type'] || '');
  // If not multipart, skip multer entirely
  if (!ct.includes('multipart/form-data')) return next();
  // Try the primary field name, then fallbacks
  upload.any()(req, res, (err) => {
    if (err) {
      console.warn('[MULTER] Parse error, continuing without file:', err.message);
    }
    // Map any uploaded file to req.file for consistency
    if (req.files && req.files.length > 0) {
      req.file = req.files[0];
    }
    next();
  });
};

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
        const orderId = uuidv4();
        db.prepare('INSERT INTO merchant_orders (id, user_id, product_id, price_paid, status, stripe_session_id) VALUES (?,?,?,?,?,?)')
          .run(orderId, userId, productId, session.amount_total / 100, 'completed', session.id);
        // Send confirmation email with download link for digital products
        try {
          const product = db.prepare('SELECT * FROM merchant_products WHERE id=?').get(productId);
          const user = db.prepare('SELECT email, display_name FROM users WHERE id=?').get(userId);
          if (product && user?.email && product.is_digital) {
            const downloadUrl = `${APP_URL}/api/shop/download/${orderId}?token=${require('jsonwebtoken').sign({ orderId, userId }, JWT_SECRET, { expiresIn: '30d' })}`;
            const transporter = require('nodemailer').createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
            transporter.sendMail({
              from: `"The Potter's Mud Room" <${process.env.SMTP_USER}>`,
              to: user.email,
              subject: `Your download is ready — ${product.name}`,
              html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px;color:#333"><h2 style="color:#8B4513">Thank you for your purchase! 🏺</h2><p>Hey ${user.display_name || 'there'}!</p><p>Your <strong>${product.name}</strong> is ready to download:</p><p style="margin:20px 0;padding:15px;background:#f5f0e8;border-radius:8px;text-align:center"><a href="${downloadUrl}" style="color:#8B4513;font-weight:bold;font-size:16px">📥 Download Your ${product.name}</a></p><p>This link is valid for 30 days. You can also access your purchases anytime in the app under your Profile.</p><p style="margin-top:30px">— Christina<br><em>The Potter's Mud Room</em></p></div>`
            }).catch(e => console.error('Purchase email failed:', e.message));
          }
        } catch(emailErr) { console.error('Purchase email error:', emailErr.message); }
      } else if (purchaseType === 'ai_tokens') {
        // Add purchased AI tokens to user's balance
        const questions = parseInt(session.metadata.questions) || 0;
        if (questions > 0) {
          db.prepare('UPDATE users SET ai_tokens = COALESCE(ai_tokens, 0) + ? WHERE id=?').run(questions, userId);
        }
      }
      break;
    }
    case 'customer.subscription.updated': {
      const sub = event.data.object;
      let user = db.prepare('SELECT id FROM users WHERE stripe_subscription_id=?').get(sub.id);
      if (!user && sub.customer) user = db.prepare('SELECT id FROM users WHERE stripe_customer_id=?').get(sub.customer);
      if (user && sub.status !== 'active' && sub.status !== 'trialing') {
        // Never downgrade lifetime beta testers
        const isBeta = db.prepare('SELECT is_beta_tester FROM users WHERE id=?').get(user.id);
        if (!isBeta?.is_beta_tester) {
          db.prepare('UPDATE users SET tier=?, stripe_subscription_id=NULL WHERE id=?').run('free', user.id);
        }
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const sub = event.data.object;
      let user = db.prepare('SELECT id FROM users WHERE stripe_subscription_id=?').get(sub.id);
      if (!user && sub.customer) user = db.prepare('SELECT id FROM users WHERE stripe_customer_id=?').get(sub.customer);
      if (user) {
        // Never downgrade lifetime beta testers
        const isBeta = db.prepare('SELECT is_beta_tester FROM users WHERE id=?').get(user.id);
        if (!isBeta?.is_beta_tester) {
          db.prepare('UPDATE users SET tier=?, stripe_subscription_id=NULL WHERE id=?').run('free', user.id);
        }
      }
      break;
    }
    case 'charge.refunded': {
      const charge = event.data.object;
      const email = charge.billing_details?.email;
      if (email) {
        try {
          const transporter = require('nodemailer').createTransport({ host: 'smtp.gmail.com', port: 587, secure: false, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } });
          transporter.sendMail({
            from: `"The Potter's Mud Room" <${process.env.SMTP_USER}>`,
            to: email,
            subject: 'Your refund has been processed — The Potter\'s Mud Room',
            html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px;color:#333"><h2 style="color:#8B4513">Refund Confirmation</h2><p>Hey there!</p><p>Your refund of <strong>$${(charge.amount_refunded / 100).toFixed(2)}</strong> has been processed. It should appear on your statement within 5-10 business days.</p><p>If you have any questions, just reply to this email.</p><p style="margin-top:30px">— Christina<br><em>The Potter's Mud Room</em><br><a href="https://thepottersmudroom.com" style="color:#8B4513">thepottersmudroom.com</a></p></div>`
          }).catch(e => console.error('Refund email failed:', e.message));
        } catch(e) { console.error('Refund email error:', e.message); }
      }
      break;
    }
  }
  res.json({ received: true });
});

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(UPLOADS_DIR));

// Version check endpoint — verify which code is actually deployed
app.get('/api/version', (req, res) => {
  res.json({ version: DEPLOY_VERSION, deployed: new Date().toISOString() });
});

const noCacheWebHeaders = (res, filePath) => {
  if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
};

// Explicit app asset mounts first so SPA fallbacks never swallow icon/font/image requests.
app.use('/app/assets', express.static(path.join(__dirname, 'public', 'app', 'assets'), {
  etag: false,
  fallthrough: false,
  redirect: false,
  setHeaders: noCacheWebHeaders,
}));
app.use('/app/_expo', express.static(path.join(__dirname, 'public', 'app', '_expo'), {
  etag: false,
  fallthrough: false,
  redirect: false,
  setHeaders: noCacheWebHeaders,
}));

// Expo web export uses root-relative /assets/... paths in some bundles.
app.use('/assets', express.static(path.join(__dirname, 'public', 'app', 'assets'), {
  etag: false,
  fallthrough: false,
  redirect: false,
  setHeaders: noCacheWebHeaders,
}));

// Serve Expo web app static assets from /app/ subfolder
app.use('/app', express.static(path.join(__dirname, 'public', 'app'), {
  etag: false,
  redirect: false,
  setHeaders: noCacheWebHeaders,
}));
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

// Purchase success page
app.get('/purchase-success', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'purchase-success.html'));
});

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
  // Allow admin API key to bypass JWT
  if (req.headers['x-admin-key'] === ADMIN_API_KEY) { req.userId = 'admin-key'; return next(); }
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
  const normalizeTier = (tier) => (['starter', 'basic', 'mid', 'top'].includes(tier) ? 'starter' : 'free');
  const lv = { free: 0, starter: 1 };
  const minLv = min === 'starter' ? 1 : 0;
  return (req, res, next) => {
    const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
    const currentTier = normalizeTier(u?.tier || req.userTier);
    if ((lv[currentTier] || 0) >= minLv) { req.userTier = currentTier; return next(); }
    res.status(403).json({ error: min === 'starter' ? 'Upgrade to Unlimited to use this feature.' : 'Upgrade required.' });
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
    const { password, displayName, referredBy, signupSource } = req.body;
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (db.prepare('SELECT id FROM users WHERE email=?').get(email)) return res.status(409).json({ error: 'Email already registered' });
    const id = uuidv4(), hash = bcrypt.hashSync(password, 10);
    const refCode = generateReferralCode();
    db.prepare('INSERT INTO users (id,email,password_hash,display_name,referral_code,referred_by,signup_source) VALUES (?,?,?,?,?,?,?)')
      .run(id, email, hash, displayName || email.split('@')[0], refCode, referredBy || null, signupSource || null);

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

// User subscription status (used by mobile app BillingScreen)
app.get('/api/user/subscription', auth, async (req, res) => {
  const u = db.prepare('SELECT tier, billing_period, plan_expires_at, stripe_subscription_id, stripe_customer_id, email FROM users WHERE id=?').get(req.userId);
  if (!u) return res.status(404).json({ error: 'User not found' });

  let hasStripe = !!u.stripe_subscription_id;

  // If no stripe_subscription_id stored but user has a paid tier, try to sync from Stripe
  if (!hasStripe && u.tier && u.tier !== 'free' && stripe && u.email) {
    try {
      let customerId = u.stripe_customer_id;
      if (!customerId) {
        const customers = await stripe.customers.list({ email: u.email, limit: 1 });
        if (customers.data.length > 0) {
          customerId = customers.data[0].id;
          db.prepare('UPDATE users SET stripe_customer_id=? WHERE id=?').run(customerId, req.userId);
        }
      }
      if (customerId) {
        const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
        if (subs.data.length > 0) {
          db.prepare('UPDATE users SET stripe_subscription_id=? WHERE id=?').run(subs.data[0].id, req.userId);
          hasStripe = true;
        }
      }
    } catch (e) { /* non-critical — just means we can't confirm Stripe link */ }
  }

  res.json({
    plan: u.tier || 'free',
    status: 'active',
    billingPeriod: u.billing_period || null,
    expiresAt: u.plan_expires_at || null,
    hasStripeSubscription: hasStripe
  });
});

// Alias for mobile app checkout (app calls /api/create-checkout-session)
app.post('/api/create-checkout-session', auth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured' });
  const { planId, plan } = req.body;
  const selectedPlan = planId || plan;
  const PRICE_CONFIG_LOCAL = {
    free: null,
    starter: { amount: 695, name: "Unlimited Plan — $6.95/mo", tier: 'starter', interval: 'month' },
    'starter-yearly': { amount: 6950, name: "Unlimited Plan — $69.50/year", tier: 'starter', interval: 'year' },
  };
  const config = PRICE_CONFIG_LOCAL[selectedPlan];
  if (!config) return res.status(400).json({ error: 'Invalid plan' });
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'subscription',
      line_items: [{ price_data: { currency: 'usd', recurring: { interval: config.interval || 'month' }, product_data: { name: config.name }, unit_amount: config.amount }, quantity: 1 }],
      metadata: { userId: req.userId, purchaseType: 'subscription', tier: config.tier, billing: config.interval || 'monthly' },
      success_url: `${APP_URL || 'https://thepottersmudroom.com'}?upgraded=${config.tier}`,
      cancel_url: `${APP_URL || 'https://thepottersmudroom.com'}?cancelled=true`,
    });
    res.json({ url: session.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Stripe Customer Portal (manage subscription from mobile app)
app.post('/api/create-portal-session', auth, async (req, res) => {
  if (!stripe) return res.status(400).json({ error: 'Stripe not configured' });
  try {
    let user = db.prepare('SELECT stripe_customer_id, email FROM users WHERE id=?').get(req.userId);
    if (!user) return res.status(404).json({ error: 'User not found' });

    let customerId = user.stripe_customer_id;

    // If no stripe_customer_id stored, try to find customer by email in Stripe
    if (!customerId && user.email) {
      const customers = await stripe.customers.list({ email: user.email, limit: 1 });
      if (customers.data.length > 0) {
        customerId = customers.data[0].id;
        // Sync back to DB so this lookup only happens once
        db.prepare('UPDATE users SET stripe_customer_id=? WHERE id=?').run(customerId, req.userId);
        // Also find and save active subscription ID
        const subs = await stripe.subscriptions.list({ customer: customerId, status: 'active', limit: 1 });
        if (subs.data.length > 0) {
          db.prepare('UPDATE users SET stripe_subscription_id=? WHERE id=?').run(subs.data[0].id, req.userId);
        }
      }
    }

    if (!customerId) {
      return res.status(404).json({ error: 'No Stripe subscription found for your account. Contact support if you believe this is an error.' });
    }

    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${APP_URL || 'https://thepottersmudroom.com'}`,
    });
    res.json({ url: portalSession.url });
  } catch (err) { res.status(500).json({ error: err.message }); }
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
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
  res.json({ success: true, user });
});

// Alias: GET /api/user/profile
app.get('/api/user/profile', auth, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const { password_hash, ...safe } = user;
  res.json({ user: safe });
});

// Alias: PUT /api/user/profile
app.put('/api/user/profile', auth, (req, res) => {
  const { displayName, username, bio, location, website, isPrivate, unitSystem, tempUnit } = req.body;
  // Only update fields that are actually provided
  const current = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
  if (!current) return res.status(404).json({ error: 'User not found' });
  db.prepare(`UPDATE users SET display_name=?,username=?,bio=?,location=?,website=?,is_private=?,unit_system=?,temp_unit=?,updated_at=datetime('now') WHERE id=?`)
    .run(
      displayName !== undefined ? displayName : current.display_name,
      username !== undefined ? username : current.username,
      bio !== undefined ? bio : current.bio,
      location !== undefined ? location : current.location,
      website !== undefined ? website : current.website,
      isPrivate !== undefined ? (isPrivate ? 1 : 0) : current.is_private,
      unitSystem || current.unit_system || 'imperial',
      tempUnit || current.temp_unit || 'fahrenheit',
      req.userId
    );
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
  const { password_hash, ...safe } = user;
  res.json({ user: safe });
});

// Potter demographics
app.get('/api/user/demographics', auth, (req, res) => {
  const user = db.prepare('SELECT potter_type, years_experience, studio_type, location FROM users WHERE id=?').get(req.userId);
  if (!user) return res.status(404).json({ error: 'User not found' });
  res.json(user);
});

app.put('/api/user/demographics', auth, (req, res) => {
  const { potterType, yearsExperience, studioType, location } = req.body;
  const current = db.prepare('SELECT * FROM users WHERE id=?').get(req.userId);
  if (!current) return res.status(404).json({ error: 'User not found' });
  db.prepare(`UPDATE users SET potter_type=?, years_experience=?, studio_type=?, location=?, updated_at=datetime('now') WHERE id=?`)
    .run(
      potterType !== undefined ? potterType : current.potter_type,
      yearsExperience !== undefined ? yearsExperience : current.years_experience,
      studioType !== undefined ? studioType : current.studio_type,
      location !== undefined ? location : current.location,
      req.userId
    );
  res.json({ success: true });
});

// Admin: view all user demographics
app.get('/api/admin/demographics', auth, (req, res) => {
  const user = db.prepare('SELECT is_admin FROM users WHERE id=?').get(req.userId);
  if (!user?.is_admin) return res.status(403).json({ error: 'Admin only' });
  const users = db.prepare('SELECT id, display_name, email, potter_type, years_experience, studio_type, location, created_at FROM users ORDER BY created_at DESC').all();
  const summary = {
    total: users.length,
    byType: {},
    byExperience: {},
    byStudio: {},
    byLocation: {}
  };
  users.forEach(u => {
    if (u.potter_type) summary.byType[u.potter_type] = (summary.byType[u.potter_type] || 0) + 1;
    if (u.years_experience) summary.byExperience[u.years_experience] = (summary.byExperience[u.years_experience] || 0) + 1;
    if (u.studio_type) summary.byStudio[u.studio_type] = (summary.byStudio[u.studio_type] || 0) + 1;
    if (u.location) summary.byLocation[u.location] = (summary.byLocation[u.location] || 0) + 1;
  });
  res.json({ users, summary });
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

// ============ CONTENT REPORTS ============
app.post('/api/reports', auth, (req, res) => {
  try {
    const { contentType, contentId, reason, details } = req.body;
    if (!contentType || !contentId || !reason) {
      return res.status(400).json({ error: 'contentType, contentId, and reason are required' });
    }
    const id = uuidv4();
    db.prepare('INSERT INTO content_reports (id, reporter_id, content_type, content_id, reason, details) VALUES (?, ?, ?, ?, ?, ?)').run(id, req.userId, contentType, contentId, reason, details || '');
    res.json({ success: true, id });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Block user (alternative path to match mobile app API)
app.post('/api/users/:userId/block', auth, (req, res) => {
  try {
    db.prepare('INSERT OR IGNORE INTO blocked_users (id, user_id, blocked_user_id) VALUES (?, ?, ?)').run(uuidv4(), req.userId, req.params.userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/users/:userId/unblock', auth, (req, res) => {
  try {
    db.prepare('DELETE FROM blocked_users WHERE user_id=? AND blocked_user_id=?').run(req.userId, req.params.userId);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/users/blocked', auth, (req, res) => {
  try {
    const blocked = db.prepare('SELECT b.blocked_user_id as id, u.name, u.display_name, b.created_at FROM blocked_users b LEFT JOIN users u ON u.id = b.blocked_user_id WHERE b.user_id = ?').all(req.userId);
    res.json(blocked);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ============ STRIPE BILLING ============
const PRICE_CONFIG = {
  starter: { amount: 695, name: "Starter Plan — $6.95/mo" },
  'starter-yearly': { amount: 6950, name: "Starter Plan — $69.50/year (save $14!)", tier: 'starter' },
  'starter-founding': { amount: 348, name: "Starter Plan — Founding Rate $3.48/mo", tier: 'starter' },
  'starter-founding-yearly': { amount: 3475, name: "Unlimited Plan — Founding Rate $34.75/year", tier: 'starter' },
};

app.get('/api/billing/plans', (req, res) => {
  res.json({
    foundingMember: true,
    plans: [
      { id: 'free', name: 'Free', price: 0, yearlyPrice: 0, features: ['10 pieces', '1 photo each', 'Personal clay & glaze library', 'Basic search', 'Community forum access', 'Ask a Potter (5 questions/month)'] },
      { id: 'starter', name: 'Unlimited', price: 6.95, yearlyPrice: 69.50, features: ['Unlimited pieces', '3 photos each', 'Firing logs', 'Glaze recipes', 'Cost tracking', 'Multi-studio', 'Export/print', 'Community glaze library', 'Test Tile Library', 'Sales tracking', 'Full forum access (read & post)', 'Unlimited Ask a Potter', 'Cancel anytime'] }
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
  const u = db.prepare('SELECT stripe_subscription_id, stripe_customer_id FROM users WHERE id=?').get(req.userId);

  let cancelledCount = 0;

  // 1) Try cancelling by stored subscription ID
  if (u?.stripe_subscription_id) {
    try {
      await stripe.subscriptions.cancel(u.stripe_subscription_id);
      cancelledCount++;
    } catch (err) {
      // If subscription already cancelled or not found, that's fine — continue
      if (!err.message.includes('No such subscription') && !err.message.includes('already been canceled')) {
        console.error('Cancel by sub ID error:', err.message);
      }
    }
  }

  // 2) Also check Stripe directly by customer ID for any remaining active subs
  //    This catches orphaned subscriptions the local DB lost track of
  if (u?.stripe_customer_id) {
    try {
      const activeSubs = await stripe.subscriptions.list({
        customer: u.stripe_customer_id,
        status: 'active',
        limit: 10,
      });
      for (const sub of activeSubs.data) {
        try {
          await stripe.subscriptions.cancel(sub.id);
          cancelledCount++;
        } catch (err) {
          console.error('Cancel active sub error:', err.message);
        }
      }
      // Also cancel any 'past_due' or 'trialing' subs
      for (const status of ['past_due', 'trialing']) {
        const subs = await stripe.subscriptions.list({
          customer: u.stripe_customer_id,
          status,
          limit: 10,
        });
        for (const sub of subs.data) {
          try {
            await stripe.subscriptions.cancel(sub.id);
            cancelledCount++;
          } catch (err) {
            console.error(`Cancel ${status} sub error:`, err.message);
          }
        }
      }
    } catch (err) {
      console.error('Stripe customer lookup error:', err.message);
    }
  }

  // 3) Always clean up local DB regardless
  db.prepare('UPDATE users SET tier=?, stripe_subscription_id=NULL WHERE id=?').run('free', req.userId);

  if (cancelledCount > 0) {
    res.json({ success: true, message: `Cancelled ${cancelledCount} subscription(s). You're back on the free tier.` });
  } else if (u?.stripe_subscription_id || u?.stripe_customer_id) {
    // Had Stripe info but nothing to cancel — already done
    res.json({ success: true, message: 'No active subscriptions found on Stripe. Local account reset to free tier.' });
  } else {
    res.json({ success: true, message: 'Account reset to free tier.' });
  }
});

// ============ ADMIN ============
const ADMIN_EMAIL = 'christinaworkmanpottery@gmail.com';
const ADMIN_API_KEY = process.env.ADMIN_API_KEY || 'mudroom-admin-2026';
function isAdmin(req) {
  if (req.headers['x-admin-key'] === ADMIN_API_KEY) return true;
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
      byTier: { free: 0, paid: 0, gifted: 0 },
      recent7d: 0,
      recent30d: 0
    };
    const now = Date.now();
    members.forEach(m => {
      const isUnlimited = m.tier === 'starter' || ['basic','mid','top'].includes(m.tier);
      if (isUnlimited) {
        const hasStripe = m.stripe_subscription_id && m.stripe_subscription_id !== '';
        const isStripeMonthly = m.billing_period === 'stripe-monthly';
        if (hasStripe || isStripeMonthly) {
          stats.byTier.paid++;
        } else {
          stats.byTier.gifted++;
        }
      } else {
        stats.byTier.free++;
      }
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
    // Signup sources breakdown
    const signupSources = db.prepare("SELECT COALESCE(signup_source, 'unknown') as source, COUNT(*) as count FROM users GROUP BY source ORDER BY count DESC").all();
    const recentSignups = db.prepare("SELECT display_name, email, COALESCE(signup_source, 'unknown') as source, referred_by, created_at FROM users ORDER BY created_at DESC LIMIT 20").all();
    res.json({ today, week, month, total, byDay, topReferrers, topPages, uniqueIPs, signupsByDay, signupSources, recentSignups });
  } catch(e) { res.json({ today:0, week:0, month:0, total:0, byDay:[], topReferrers:[], topPages:[], uniqueIPs:0, signupsByDay:[], signupSources:[], recentSignups:[] }); }
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

app.get('/api/export/contacts', auth, (req, res) => {
  const contacts = db.prepare('SELECT * FROM contacts WHERE user_id=? ORDER BY name').all(req.userId);
  let csv = 'Name,Email,Phone,Notes\n';
  contacts.forEach(c => { csv += `"${(c.name||'').replace(/"/g,'""')}","${(c.email||'').replace(/"/g,'""')}","${(c.phone||'').replace(/"/g,'""')}","${(c.notes||'').replace(/"/g,'""')}"\n`; });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-contacts.csv');
  res.send(csv);
});

// ============ CLAY BODIES ============
app.get('/api/clay-bodies', auth, (req, res) => {
  const clays = db.prepare('SELECT * FROM clay_bodies WHERE user_id=? ORDER BY name').all(req.userId);
  const getPhotos = db.prepare('SELECT * FROM clay_photos WHERE clay_id=? ORDER BY sort_order');
  clays.forEach(c => { c.photos = getPhotos.all(c.id); });
  res.json(clays);
});

app.get('/api/clay-bodies/:id', auth, (req, res) => {
  const clay = db.prepare('SELECT * FROM clay_bodies WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!clay) return res.status(404).json({ error: 'Not found' });
  clay.photos = db.prepare('SELECT * FROM clay_photos WHERE clay_id=? ORDER BY sort_order').all(clay.id);
  res.json({ clay });
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

// Clay photo upload (replaces existing photo if at max, so edits always persist)
app.post('/api/clay-bodies/:id/photos', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo' });
  const maxPhotos = (req.userTier === 'free') ? 1 : 3;
  const existing = db.prepare('SELECT * FROM clay_photos WHERE clay_id=? ORDER BY sort_order').all(req.params.id);
  // If at max, replace the oldest photo instead of rejecting
  if (existing.length >= maxPhotos) {
    const oldest = existing[0];
    const oldFile = path.join(UPLOADS_DIR, oldest.filename);
    if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile);
    db.prepare('DELETE FROM clay_photos WHERE id=?').run(oldest.id);
  }
  const count = db.prepare('SELECT COUNT(*) as c FROM clay_photos WHERE clay_id=?').get(req.params.id).c;
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
  const maxPhotos = (req.userTier === 'free') ? 1 : 3;
  const count = db.prepare('SELECT COUNT(*) as c FROM glaze_photos WHERE glaze_id=?').get(req.params.id).c;
  if (count >= maxPhotos) return res.status(403).json({ error: req.userTier === 'free' ? 'Free tier allows 1 photo per glaze. Upgrade to add up to 3!' : 'Max 3 photos per glaze' });
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

// Shopping list — all out-of-stock clays and glazes + custom items
app.get('/api/shopping-list', auth, (req, res) => {
  const clays = db.prepare('SELECT id,name,brand,source,source_url,buy_url FROM clay_bodies WHERE user_id=? AND in_stock=0').all(req.userId);
  const glazes = db.prepare('SELECT id,name,brand,source,source_url,buy_url,stock_status FROM glazes WHERE user_id=? AND (stock_status=? OR in_stock=0)').all(req.userId, 'need-to-buy');
  const custom = db.prepare('SELECT * FROM shopping_list_items WHERE user_id=? ORDER BY is_checked ASC, created_at DESC').all(req.userId);
  // Map source_url to buy_url for custom items so app can use consistent field
  custom.forEach(c => { if (c.source_url && !c.buy_url) c.buy_url = c.source_url; });
  res.json({ clays, glazes, custom });
});

// Add custom shopping list item
app.post('/api/shopping-list', auth, (req, res) => {
  const { name, category, quantity, source, sourceUrl, buy_url, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Item name required' });
  const id = uuidv4();
  const url = buy_url || sourceUrl || null;
  db.prepare('INSERT INTO shopping_list_items (id,user_id,name,category,quantity,source,source_url,notes) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.userId, name.trim(), category||'general', quantity||null, source||null, url, notes||null);
  res.json({ id, name: name.trim() });
});

// Update custom shopping list item
app.put('/api/shopping-list/:id', auth, (req, res) => {
  const { name, category, quantity, source, sourceUrl, buy_url, notes, isChecked } = req.body;
  const item = db.prepare('SELECT id FROM shopping_list_items WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  const url = buy_url || sourceUrl || null;
  db.prepare(`UPDATE shopping_list_items SET name=COALESCE(?,name), category=COALESCE(?,category), quantity=?, source=?, source_url=?, notes=?, is_checked=COALESCE(?,is_checked), updated_at=datetime('now') WHERE id=?`)
    .run(name||null, category||null, quantity||null, source||null, url, notes||null, isChecked!==undefined?(isChecked?1:0):null, req.params.id);
  res.json({ success: true });
});

// Toggle checked status
app.patch('/api/shopping-list/:id/toggle', auth, (req, res) => {
  const item = db.prepare('SELECT id, is_checked FROM shopping_list_items WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!item) return res.status(404).json({ error: 'Not found' });
  db.prepare('UPDATE shopping_list_items SET is_checked=?, updated_at=datetime(\'now\') WHERE id=?').run(item.is_checked ? 0 : 1, req.params.id);
  res.json({ isChecked: !item.is_checked });
});

// Delete custom shopping list item
app.delete('/api/shopping-list/:id', auth, (req, res) => {
  const r = db.prepare('DELETE FROM shopping_list_items WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  if (r.changes === 0) return res.status(404).json({ error: 'Not found' });
  res.json({ success: true });
});

// Clear all checked items
app.delete('/api/shopping-list/checked/clear', auth, (req, res) => {
  const r = db.prepare('DELETE FROM shopping_list_items WHERE user_id=? AND is_checked=1').run(req.userId);
  res.json({ deleted: r.changes });
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
  if (excludeCasualties) { sql += " AND (p.status IS NULL OR p.status NOT IN ('broken','recycled'))"; }
  if (status) { sql += ' AND p.status=?'; params.push(status); }
  if (clayBodyId) { sql += ' AND p.clay_body_id=?'; params.push(clayBodyId); }
  if (search) { sql += ' AND (p.title LIKE ? OR p.description LIKE ? OR p.notes LIKE ?)'; params.push(`%${search}%`, `%${search}%`, `%${search}%`); }
  sql += ' ORDER BY p.updated_at DESC';
  if (limit) { sql += ' LIMIT ?'; params.push(parseInt(limit)); }
  if (offset) { sql += ' OFFSET ?'; params.push(parseInt(offset)); }
  const pieces = db.prepare(sql).all(...params);
  const getGl = db.prepare('SELECT pg.*,g.name as glaze_name,g.brand,g.glaze_type FROM piece_glazes pg JOIN glazes g ON pg.glaze_id=g.id WHERE pg.piece_id=? ORDER BY pg.layer_order');
  const getPh = db.prepare('SELECT * FROM piece_photos WHERE piece_id=? ORDER BY sort_order');
  const statusLabels = {'in-progress':'In Progress','bisque-fired':'Bisque Fired','glazed':'Glazed','glaze-fired':'Final Fired','done':'Complete','sold':'Sold','broken':'Broken','recycled':'Recycled'};
  pieces.forEach(p => {
    p.glazes = getGl.all(p.id);
    p.photos = getPh.all(p.id);
    // Clean up legacy data: if studio was used to store clay body text, suppress it
    if (p.studio && p.clay_body_name && p.studio.toLowerCase() === p.clay_body_name.toLowerCase()) {
      p.studio = null;
    } else if (p.studio && !p.clay_body_name) {
      p.clay_body_name = p.studio;
      p.studio = null;
    }
    // Legacy field aliases so older app builds can read piece data
    p.name = p.title;
    p.clay = p.clay_body_name || null;
    // Extract glaze from notes if stored there, or from glazes array
    if (p.glazes && p.glazes.length > 0) {
      p.glaze = p.glazes.map(g => g.glaze_name || g.name).join(', ');
    } else if (p.notes) {
      const gm = p.notes.match(/Glaze:\s*([^|]+)/);
      if (gm) p.glaze = gm[1].trim();
    }
    // Extract firing temp from notes
    if (p.notes) {
      const fm = p.notes.match(/Firing temp:\s*([^|]+)/);
      if (fm) p.firingTemp = fm[1].trim();
    }
    // Pretty status label for display (preserve slug as statusSlug)
    p.statusSlug = p.status;
    p.status = p.status === 'in-progress' ? null : (statusLabels[p.status] || p.status);
  });
  res.json(pieces);
});

app.get('/api/pieces/:id', auth, (req, res) => {
  const p = db.prepare('SELECT p.*,cb.name as clay_body_name FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id WHERE p.id=? AND p.user_id=?').get(req.params.id, req.userId);
  if (!p) return res.status(404).json({ error: 'Not found' });
  p.glazes = db.prepare('SELECT pg.*,g.name as glaze_name,g.brand,g.glaze_type FROM piece_glazes pg JOIN glazes g ON pg.glaze_id=g.id WHERE pg.piece_id=? ORDER BY pg.layer_order').all(p.id);
  p.photos = db.prepare('SELECT * FROM piece_photos WHERE piece_id=? ORDER BY sort_order').all(p.id);
  p.firings = db.prepare('SELECT * FROM firing_logs WHERE piece_id=? ORDER BY date DESC').all(p.id);
  // Clean up legacy data: if studio was used to store clay body text, suppress it
  if (p.studio && p.clay_body_name && p.studio.toLowerCase() === p.clay_body_name.toLowerCase()) {
    p.studio = null;
  } else if (p.studio && !p.clay_body_name) {
    // studio field was misused for clay - move it to clay display and clear studio
    p.clay_body_name = p.studio;
    p.studio = null;
  }
  // Legacy field aliases so older app builds can read piece data
  p.name = p.title;
  p.clay = p.clay_body_name || null;
  if (p.glazes && p.glazes.length > 0) {
    p.glaze = p.glazes.map(g => g.glaze_name || g.name).join(', ');
  } else if (p.notes) {
    const gm = p.notes.match(/Glaze:\s*([^|]+)/);
    if (gm) p.glaze = gm[1].trim();
  }
  if (p.notes) {
    const fm = p.notes.match(/Firing temp:\s*([^|]+)/);
    if (fm) p.firingTemp = fm[1].trim();
    // Clean notes — strip embedded glaze/firing temp for display
    p.cleanNotes = p.notes
      .replace(/\s*\|\s*Glaze:[^|]+/g, '')
      .replace(/\s*\|\s*Firing temp:[^|]+/g, '')
      .replace(/^Glaze:[^|]+\s*\|?\s*/g, '')
      .replace(/^Firing temp:[^|]+\s*\|?\s*/g, '')
      .trim() || null;
  }
  // Pretty status label for display (preserve slug as statusSlug)
  const statusLabels2 = {'in-progress':'In Progress','bisque-fired':'Bisque Fired','glazed':'Glazed','glaze-fired':'Final Fired','done':'Complete','sold':'Sold','broken':'Broken','recycled':'Recycled'};
  p.statusSlug = p.status;
  p.status = p.status === 'in-progress' ? null : (statusLabels2[p.status] || p.status);
  res.json(p);
});

app.post('/api/pieces', auth, safeUpload('photo'), async (req, res) => {
  // Handle both JSON and FormData (iOS may send either)
  const body = req.body || {};
  const title = String(body.title || body.name || '').trim() || null;
  const clayText = String(body.clay || body.studio || '').trim() || null;
  const clayBodyId = body.clayBodyId || body.clay_body_id || null;
  const glazeText = String(body.glaze || '').trim() || null;
  const statusMap = {'In Progress':'in-progress','Bisque Fired':'bisque-fired','Glazed':'glazed','Final Fired':'glaze-fired','Glaze Fired':'glaze-fired','Complete':'done','Done':'done','Sold':'sold','Broken':'broken','Recycled':'recycled'};
  const rawStatus = String(body.status || 'in-progress').trim();
  const status = statusMap[rawStatus] || rawStatus.toLowerCase().replace(/\s+/g,'-');
  const form = body.form || null;
  const technique = body.technique || null;
  const dimensions = body.dimensions || null;
  const weight = body.weight || null;
  const materialCost = body.materialCost || body.material_cost || null;
  const firingCost = body.firingCost || body.firing_cost || null;
  const dateStarted = body.dateStarted || body.date_started || null;
  // Combine all text info into notes
  const firingTemp = String(body.firingTemp || body.firing_temp || '').trim();
  // notes may already contain user notes + firing temp from app; description is the pure user notes
  const userNotes = String(body.description || '').trim();
  // If body.notes already has content (from app), use it as base; otherwise build from parts
  let existingNotes = String(body.notes || '').trim();
  let notes;
  if (existingNotes) {
    // App already combined notes — just ensure glaze is included
    const noteParts = [existingNotes];
    if (glazeText && !existingNotes.includes('Glaze:')) noteParts.push(`Glaze: ${glazeText}`);
    if (firingTemp && !existingNotes.includes('Firing temp:')) noteParts.push(`Firing temp: ${firingTemp}`);
    notes = noteParts.join(' | ');
  } else {
    // Legacy/web creation — build notes from scratch
    const noteParts = [];
    if (userNotes) noteParts.push(userNotes);
    if (glazeText) noteParts.push(`Glaze: ${glazeText}`);
    if (firingTemp) noteParts.push(`Firing temp: ${firingTemp}`);
    notes = noteParts.length ? noteParts.join(' | ') : null;
  }
  const description = userNotes || null;
  const casualtyType = body.casualtyType || body.casualty_type || null;
  const casualtyNotes = body.casualtyNotes || body.casualty_notes || null;
  const casualtyLesson = body.casualtyLesson || body.casualty_lesson || null;
  let glazeIds = body.glazeIds || body.glaze_ids || null;
  if (typeof glazeIds === 'string') { try { glazeIds = JSON.parse(glazeIds); } catch(e) { glazeIds = null; } }

  console.log('[DEBUG] POST /api/pieces content-type:', req.headers['content-type'], 'body:', JSON.stringify(body), 'file:', req.file ? req.file.originalname : 'none', 'title:', title, 'status:', status, 'clay:', clayText, 'glaze:', glazeText, 'notes:', notes);

  const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  if ((u?.tier || 'free') === 'free' && getPieceCount(req.userId) >= 10) return res.status(403).json({ error: 'Free tier limited to 10 pieces. Upgrade to Unlimited for more!' });

  const id = uuidv4();
  const isCasualty = (status === 'broken' || status === 'recycled');
  try {
    db.prepare('INSERT INTO pieces (id,user_id,title,description,clay_body_id,studio,status,form,technique,dimensions,weight,material_cost,firing_cost,date_started,notes,casualty_type,casualty_notes,casualty_lesson) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
      .run(id, req.userId, title, description, clayBodyId, clayText, status || 'in-progress', form, technique, dimensions, weight, materialCost, firingCost, dateStarted, notes, isCasualty ? (casualtyType || null) : null, isCasualty ? (casualtyNotes || null) : null, isCasualty ? (casualtyLesson || null) : null);
  } catch (dbErr) {
    console.error('[DB ERROR] Insert piece failed:', dbErr.message, { title, status, body });
    return res.status(400).json({ error: 'Could not save piece: ' + dbErr.message });
  }

  // If photo was uploaded via FormData, save it automatically
  if (req.file) {
    const photoId = uuidv4();
    // Generate perceptual hash on initial piece creation photo
    let phash = null;
    try {
      const buf = fs.readFileSync(req.file.path);
      phash = await computeAHash(buf);
    } catch(e) { /* hash generation failed, not critical */ }
    db.prepare('INSERT INTO piece_photos (id, piece_id, filename, original_name, sort_order, phash) VALUES (?,?,?,?,0,?)').run(photoId, id, req.file.filename, req.file.originalname, phash);
  }

  if (glazeIds?.length) {
    const ins = db.prepare('INSERT INTO piece_glazes (id,piece_id,glaze_id,coats,application_method,layer_order) VALUES (?,?,?,?,?,?)');
    glazeIds.forEach((g, i) => ins.run(uuidv4(), id, g.glazeId || g, g.coats || 1, g.method || null, i));
  }
  res.json({ id });
});

// Toggle hide_from_photo_search for a piece
app.patch('/api/pieces/:id/photo-search-visibility', auth, (req, res) => {
  const piece = db.prepare('SELECT id, user_id FROM pieces WHERE id = ? AND user_id = ?').get(req.params.id, req.userId);
  if (!piece) return res.status(404).json({ error: 'Piece not found' });
  const hide = req.body.hide ? 1 : 0;
  db.prepare('UPDATE pieces SET hide_from_photo_search = ? WHERE id = ?').run(hide, piece.id);
  res.json({ success: true, hide_from_photo_search: hide });
});

// Debug: extract color from an uploaded photo (no auth needed, temp debug)
app.post('/api/debug/extract-color', upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo' });
  try {
    const buf = fs.readFileSync(req.file.path);
    const sig = await computeColorSignature(buf);
    const parsed = JSON.parse(sig);
    const totalW = parsed.reduce((s, c) => s + (c.weight || 1), 0);
    const avgR = parsed.reduce((s, c) => s + c.r * (c.weight || 1), 0) / totalW;
    const avgG = parsed.reduce((s, c) => s + c.g * (c.weight || 1), 0) / totalW;
    const avgB = parsed.reduce((s, c) => s + c.b * (c.weight || 1), 0) / totalW;
    const hsl = rgbToHsl(avgR, avgG, avgB);
    fs.unlinkSync(req.file.path);
    res.json({ buckets: parsed, avgRgb: { r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB) }, hsl: { h: hsl.h, s: hsl.s, l: hsl.l } });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Debug: return stored avg_color for all photos belonging to user (auth required)
app.get('/api/debug/photo-colors', auth, (req, res) => {
  const photos = db.prepare(`
    SELECT pp.id, pp.filename, pp.avg_color, p.id as piece_id, p.title, p.hide_from_photo_search
    FROM piece_photos pp
    JOIN pieces p ON pp.piece_id = p.id
    WHERE p.user_id = ?
    ORDER BY p.title
  `).all(req.userId);
  const result = photos.map(ph => {
    let avgRgb = null;
    try {
      const sig = JSON.parse(ph.avg_color || 'null');
      if (Array.isArray(sig) && sig.length) {
        const totalW = sig.reduce((s, c) => s + (c.weight || 1), 0);
        avgRgb = {
          r: Math.round(sig.reduce((s, c) => s + c.r * (c.weight || 1), 0) / totalW),
          g: Math.round(sig.reduce((s, c) => s + c.g * (c.weight || 1), 0) / totalW),
          b: Math.round(sig.reduce((s, c) => s + c.b * (c.weight || 1), 0) / totalW),
        };
      }
    } catch(e) {}
    return {
      photo_id: ph.id,
      piece_id: ph.piece_id,
      title: ph.title,
      filename: ph.filename,
      hidden: !!ph.hide_from_photo_search,
      avg_color_buckets: ph.avg_color ? JSON.parse(ph.avg_color) : null,
      avg_rgb: avgRgb,
    };
  });
  res.json(result);
});

app.put('/api/pieces/:id', auth, safeUpload('photo'), (req, res) => {
  const body = req.body || {};
  const title = body.title || body.name || null;
  const description = body.description || null;
  const clayBodyId = body.clayBodyId || body.clay_body_id || null;
  const studio = body.studio || body.clay || null;
  const statusMap2 = {'In Progress':'in-progress','Bisque Fired':'bisque-fired','Glazed':'glazed','Final Fired':'glaze-fired','Glaze Fired':'glaze-fired','Complete':'done','Done':'done','Sold':'sold','Broken':'broken','Recycled':'recycled'};
  const rawSt = body.status ? String(body.status).trim() : null;
  const status = rawSt ? (statusMap2[rawSt] || rawSt.toLowerCase().replace(/\s+/g,'-')) : null;
  const form = body.form || null;
  const technique = body.technique || null;
  const dimensions = body.dimensions || null;
  const weight = body.weight || null;
  const materialCost = body.materialCost || body.material_cost || null;
  const firingCost = body.firingCost || body.firing_cost || null;
  const salePrice = body.salePrice || body.sale_price || null;
  const dateStarted = body.dateStarted || body.date_started || null;
  const dateCompleted = body.dateCompleted || body.date_completed || null;
  const dateSold = body.dateSold || body.date_sold || null;
  const glazeText = String(body.glaze || '').trim() || null;
  const firingTemp = String(body.firingTemp || body.firing_temp || '').trim();
  // Same logic as POST — app may send pre-combined notes
  const userNotes = String(body.description || '').trim();
  let existingNotes = String(body.notes || '').trim();
  let notes;
  if (existingNotes) {
    const noteParts = [existingNotes];
    if (glazeText && !existingNotes.includes('Glaze:')) noteParts.push(`Glaze: ${glazeText}`);
    if (firingTemp && !existingNotes.includes('Firing temp:')) noteParts.push(`Firing temp: ${firingTemp}`);
    notes = noteParts.join(' | ');
  } else {
    const noteParts = [];
    if (userNotes) noteParts.push(userNotes);
    if (glazeText) noteParts.push(`Glaze: ${glazeText}`);
    if (firingTemp) noteParts.push(`Firing temp: ${firingTemp}`);
    notes = noteParts.length ? noteParts.join(' | ') : null;
  }
  const casualtyType = body.casualtyType || body.casualty_type || null;
  const casualtyNotes = body.casualtyNotes || body.casualty_notes || null;
  const casualtyLesson = body.casualtyLesson || body.casualty_lesson || null;
  let glazeIds = body.glazeIds || body.glaze_ids;
  if (typeof glazeIds === 'string') { try { glazeIds = JSON.parse(glazeIds); } catch(e) { glazeIds = undefined; } }
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
app.post('/api/pieces/:id/photos', auth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo' });
  const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const maxPhotos = ((u?.tier || 'free') === 'free') ? 1 : 3;
  const count = db.prepare('SELECT COUNT(*) as c FROM piece_photos WHERE piece_id=?').get(req.params.id).c;
  if (count >= maxPhotos) return res.status(403).json({ error: req.userTier === 'free' ? 'Free tier allows 1 photo per piece. Upgrade to add up to 3!' : 'Max 3 photos per piece' });
  const id = uuidv4();
  // Generate perceptual hash on upload
  let phash = null;
  try {
    const buf = fs.readFileSync(req.file.path);
    phash = await computeAHash(buf);
  } catch(e) { /* hash generation failed, not critical */ }
  db.prepare('INSERT INTO piece_photos (id,piece_id,filename,original_name,stage,sort_order,phash) VALUES (?,?,?,?,?,?,?)')
    .run(id, req.params.id, req.file.filename, req.file.originalname, req.body.stage || 'other', count, phash);
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

app.get('/api/firing-logs/:id', auth, (req, res) => {
  const log = db.prepare('SELECT fl.*,p.title as piece_title FROM firing_logs fl LEFT JOIN pieces p ON fl.piece_id=p.id WHERE fl.id=? AND fl.user_id=?').get(req.params.id, req.userId);
  if (!log) return res.status(404).json({ error: 'Not found' });
  const photos = db.prepare('SELECT id,filename FROM firing_photos WHERE firing_id=? ORDER BY sort_order ASC').all(req.params.id);
  res.json({ ...log, photos });
});

app.post('/api/firing-logs', auth, (req, res) => {
  const { pieceId, firingType, cone, temperature, atmosphere, kilnName, schedule, duration, firingSpeed, customSpeedDetail, holdUsed, holdDuration, date, results, notes, firingTime, firingMode, loadDescription, firingModeNotes, startTime, endTime, openTemp } = req.body;

  const user = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const tier = user?.tier === 'starter' ? 'starter' : 'free';
  if (tier === 'free') {
    const firingCount = db.prepare('SELECT COUNT(*) as c FROM firing_logs WHERE user_id=?').get(req.userId)?.c || 0;
    if (firingCount >= 1) {
      return res.status(403).json({ error: 'Free members can save 1 firing log. Upgrade to Unlimited for more.' });
    }
  }

  const id = uuidv4();
  db.prepare('INSERT INTO firing_logs (id,user_id,piece_id,firing_type,cone,temperature,atmosphere,kiln_name,schedule,duration,firing_speed,custom_speed_detail,hold_used,hold_duration,date,results,notes,firing_time,firing_mode,load_description,firing_mode_notes,start_time,end_time,open_temp) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, pieceId, firingType || null, cone, temperature, atmosphere || null, kilnName, schedule, duration, firingSpeed || null, customSpeedDetail || null, holdUsed ? 1 : 0, holdDuration, date, results, notes, firingTime || null, firingMode || 'kiln-load', loadDescription || null, firingModeNotes || null, startTime || null, endTime || null, openTemp || null);
  res.json({ id });
});

// Edit firing log
app.put('/api/firing-logs/:id', auth, (req, res) => {
  const { pieceId, firingType, cone, temperature, atmosphere, kilnName, schedule, duration, firingSpeed, customSpeedDetail, holdUsed, holdDuration, date, results, notes, firingTime, firingMode, loadDescription, firingModeNotes, startTime, endTime, openTemp } = req.body;
  db.prepare('UPDATE firing_logs SET piece_id=?,firing_type=?,cone=?,temperature=?,atmosphere=?,kiln_name=?,schedule=?,duration=?,firing_speed=?,custom_speed_detail=?,hold_used=?,hold_duration=?,date=?,results=?,notes=?,firing_time=?,firing_mode=?,load_description=?,firing_mode_notes=?,start_time=?,end_time=?,open_temp=? WHERE id=? AND user_id=?')
    .run(pieceId || null, firingType || null, cone, temperature, atmosphere || null, kilnName, schedule, duration, firingSpeed || null, customSpeedDetail || null, holdUsed ? 1 : 0, holdDuration, date, results, notes, firingTime || null, firingMode || 'kiln-load', loadDescription || null, firingModeNotes || null, startTime || null, endTime || null, openTemp || null, req.params.id, req.userId);
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
  let csv = 'Date,Firing Type,Cone,Temperature,Kiln,Duration,Firing Time,Start Time,End Time,Open Temp,Atmosphere,Results,Load Description,Notes\n';
  firings.forEach(f => {
    csv += `"${f.date||''}","${f.firing_type||''}","${f.cone||''}","${f.temperature||''}","${(f.kiln_name||'').replace(/"/g,'""')}","${f.duration||''}","${f.firing_time||''}","${f.start_time||''}","${f.end_time||''}","${f.open_temp||''}","${f.atmosphere||''}","${(f.results||'').replace(/"/g,'""')}","${(f.load_description||'').replace(/"/g,'""')}","${(f.notes||'').replace(/"/g,'""')}"\n`;
  });
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename=potters-mudroom-firing-logs.csv');
  res.send(csv);
});

// ============ SALES ============
app.get('/api/sales', auth, (req, res) => {
  const { dateFrom, dateTo } = req.query;
  let sql = 'SELECT s.*,p.title as piece_title FROM sales s LEFT JOIN pieces p ON s.piece_id=p.id WHERE s.user_id=?';
  const params = [req.userId];
  if (dateFrom) { sql += ' AND s.date >= ?'; params.push(dateFrom); }
  if (dateTo) { sql += ' AND s.date <= ?'; params.push(dateTo); }
  sql += ' ORDER BY s.date DESC';
  res.json(db.prepare(sql).all(...params));
});

app.post('/api/sales', auth, (req, res) => {
  const { pieceId, date, price, venue, venueType, buyerName, buyerEmail, buyerPhone, notes, quantity, itemDescription, eventName, contactId } = req.body;

  const user = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const tier = user?.tier === 'starter' ? 'starter' : 'free';
  if (tier === 'free') {
    const saleCount = db.prepare('SELECT COUNT(*) as c FROM sales WHERE user_id=?').get(req.userId)?.c || 0;
    if (saleCount >= 1) {
      return res.status(403).json({ error: 'Free members can save 1 sale. Upgrade to Unlimited for more.' });
    }
  }

  const id = uuidv4();
  db.prepare('INSERT INTO sales (id,user_id,piece_id,date,price,venue,venue_type,buyer_name,buyer_email,buyer_phone,notes,quantity,item_description,event_name,contact_id) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, pieceId || null, date, price, venue, venueType, buyerName, buyerEmail || null, buyerPhone || null, notes, quantity || 1, itemDescription || null, eventName || null, contactId || null);
  if (pieceId) db.prepare(`UPDATE pieces SET status='sold',sale_price=?,date_sold=?,updated_at=datetime('now') WHERE id=? AND user_id=?`).run(price, date, pieceId, req.userId);
  res.json({ id });
});

app.put('/api/sales/:id', auth, (req, res) => {
  const { pieceId, date, price, venue, venueType, buyerName, buyerEmail, buyerPhone, notes, quantity, itemDescription, eventName, contactId } = req.body;
  const existing = db.prepare('SELECT * FROM sales WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Sale not found' });
  db.prepare('UPDATE sales SET piece_id=?,date=?,price=?,venue=?,venue_type=?,buyer_name=?,buyer_email=?,buyer_phone=?,notes=?,quantity=?,item_description=?,event_name=?,contact_id=? WHERE id=? AND user_id=?')
    .run(pieceId || null, date, price, venue, venueType, buyerName || null, buyerEmail || null, buyerPhone || null, notes || null, quantity || 1, itemDescription || null, eventName || null, contactId || null, req.params.id, req.userId);
  if (pieceId) db.prepare(`UPDATE pieces SET status='sold',sale_price=?,date_sold=?,updated_at=datetime('now') WHERE id=? AND user_id=?`).run(price, date, pieceId, req.userId);
  res.json({ ok: true });
});

app.delete('/api/sales/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM sales WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Sale not found' });
  // If the sale was linked to a piece, revert piece status from 'sold' back to 'done'
  if (existing.piece_id) {
    const piece = db.prepare('SELECT * FROM pieces WHERE id=? AND user_id=?').get(existing.piece_id, req.userId);
    if (piece && piece.status === 'sold') {
      db.prepare(`UPDATE pieces SET status='done',sale_price=NULL,date_sold=NULL,updated_at=datetime('now') WHERE id=? AND user_id=?`).run(existing.piece_id, req.userId);
    }
  }
  db.prepare('DELETE FROM sales WHERE id=? AND user_id=?').run(req.params.id, req.userId);
  res.json({ ok: true });
});

app.post('/api/sales/:id/photo', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const sale = db.prepare('SELECT * FROM sales WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!sale) return res.status(404).json({ error: 'Sale not found' });
  if (sale.image_filename) {
    const old = path.join(UPLOADS_DIR, sale.image_filename);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  db.prepare('UPDATE sales SET image_filename=? WHERE id=?').run(req.file.filename, req.params.id);
  res.json({ filename: req.file.filename });
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
  const { search, cone, atmosphere, filter, clay, sort, type } = req.query;
  let sql = 'SELECT gc.*,u.display_name as author,(SELECT COUNT(*) FROM combo_comments cc WHERE cc.combo_id=gc.id) as comment_count FROM glaze_combos gc JOIN users u ON gc.user_id=u.id WHERE ';
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
  
  if (search) { sql += ' AND (gc.name LIKE ? OR gc.description LIKE ? OR gc.clay_body_name LIKE ? OR gc.id IN (SELECT combo_id FROM glaze_combo_layers WHERE glaze_name LIKE ?))'; params.push(`%${search}%`, `%${search}%`, `%${search}%`, `%${search}%`); }
  if (cone) { sql += ' AND gc.cone=?'; params.push(cone); }
  if (atmosphere) { sql += ' AND gc.atmosphere=?'; params.push(atmosphere); }
  if (clay) { sql += ' AND gc.clay_body_name LIKE ?'; params.push(`%${clay}%`); }
  if (type === 'single') { sql += ' AND gc.id IN (SELECT combo_id FROM glaze_combo_layers GROUP BY combo_id HAVING COUNT(*)=1)'; }
  else if (type === 'combo') { sql += ' AND gc.id IN (SELECT combo_id FROM glaze_combo_layers GROUP BY combo_id HAVING COUNT(*)>1)'; }
  if (sort === 'newest') { sql += ' ORDER BY gc.created_at DESC'; }
  else if (sort === 'comments') { sql += ' ORDER BY comment_count DESC'; }
  else { sql += ' ORDER BY gc.likes DESC, gc.created_at DESC'; }
  const combos = db.prepare(sql).all(...params);
  const getL = db.prepare('SELECT * FROM glaze_combo_layers WHERE combo_id=? ORDER BY layer_order');
  const getLike = db.prepare('SELECT id FROM combo_likes WHERE combo_id=? AND user_id=?');
  const getCommentCount = db.prepare('SELECT COUNT(*) as c FROM combo_comments WHERE combo_id=?');
  combos.forEach(c => {
    c.layers = getL.all(c.id);
    c.user_liked = !!getLike.get(c.id, req.userId);
    if (!c.comment_count && c.comment_count !== 0) c.comment_count = getCommentCount.get(c.id).c;
  });
  res.json(combos);
});

app.get('/api/community/combos/:id', auth, (req, res) => {
  const combo = db.prepare('SELECT gc.*,u.display_name as author FROM glaze_combos gc JOIN users u ON gc.user_id=u.id WHERE gc.id=?').get(req.params.id);
  if (!combo) return res.status(404).json({ error: 'Not found' });
  combo.layers = db.prepare('SELECT * FROM glaze_combo_layers WHERE combo_id=? ORDER BY layer_order').all(combo.id);
  combo.user_liked = !!db.prepare('SELECT id FROM combo_likes WHERE combo_id=? AND user_id=?').get(combo.id, req.userId);
  combo.comment_count = db.prepare('SELECT COUNT(*) as c FROM combo_comments WHERE combo_id=?').get(combo.id).c;
  res.json({ combo });
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

app.post('/api/forum/posts/:id/reply', auth, upload.array('photos', 1), (req, res) => {
  const { body } = req.body;
  if (!body) return res.status(400).json({ error: 'Reply body required' });

  const user = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  if (req.files?.length && user?.tier !== 'starter') {
    return res.status(403).json({ error: 'Only Unlimited members can attach a photo in comments.' });
  }

  const id = uuidv4();
  db.prepare('INSERT INTO forum_replies (id,post_id,user_id,body) VALUES (?,?,?,?)').run(id, req.params.id, req.userId, body);
  db.prepare(`UPDATE forum_posts SET reply_count=reply_count+1, updated_at=datetime('now') WHERE id=?`).run(req.params.id);
  notifyForumReply(req.params.id, req.userId);

  if (req.files?.length) {
    const ins = db.prepare('INSERT INTO forum_photos (id,reply_id,filename,original_name) VALUES (?,?,?,?)');
    ins.run(uuidv4(), id, req.files[0].filename, req.files[0].originalname);
  }

  const fullReply = db.prepare(`SELECT fr.*, u.display_name as author_name, u.avatar_filename as author_avatar FROM forum_replies fr JOIN users u ON fr.user_id=u.id WHERE fr.id=?`).get(id);
  fullReply.photos = db.prepare('SELECT * FROM forum_photos WHERE reply_id=?').all(id);
  res.json({ reply: fullReply });
});

// Edit own forum post
app.put('/api/forum/posts/:id', auth, (req, res) => {
  const post = db.prepare('SELECT user_id FROM forum_posts WHERE id=?').get(req.params.id);
  if (!post) return res.status(404).json({ error: 'Not found' });
  if (post.user_id !== req.userId) return res.status(403).json({ error: 'You can only edit your own posts' });
  const { title, content, body, categoryId } = req.body;
  const postBody = content || body || '';
  db.prepare('UPDATE forum_posts SET title=?,body=?,category_id=COALESCE(?,category_id),updated_at=datetime(\'now\') WHERE id=?')
    .run(title, postBody, categoryId || null, req.params.id);
  res.json({ id: req.params.id, title, body: postBody, content: postBody });
});

// Edit own forum reply
app.put('/api/forum/replies/:id', auth, (req, res) => {
  const reply = db.prepare('SELECT user_id FROM forum_replies WHERE id=?').get(req.params.id);
  if (!reply) return res.status(404).json({ error: 'Not found' });
  if (reply.user_id !== req.userId) return res.status(403).json({ error: 'You can only edit your own replies' });
  const { content, body } = req.body;
  const replyBody = content || body || '';
  db.prepare('UPDATE forum_replies SET body=?,updated_at=datetime(\'now\') WHERE id=?')
    .run(replyBody, req.params.id);
  res.json({ id: req.params.id, body: replyBody, content: replyBody });
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
      success_url: `${APP_URL}/purchase-success?product=${productId}`,
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

// My Purchases — list user's completed orders with download info
app.get('/api/shop/my-purchases', auth, (req, res) => {
  const orders = db.prepare(`SELECT mo.id as order_id, mo.product_id, mo.price_paid, mo.status, mo.created_at,
    mp.name as product_name, mp.description, mp.product_type, mp.is_digital
    FROM merchant_orders mo
    JOIN merchant_products mp ON mo.product_id = mp.id
    WHERE mo.user_id=? AND mo.status='completed'
    ORDER BY mo.created_at DESC`).all(req.userId);
  orders.forEach(o => {
    if (o.is_digital) {
      o.download_url = `/api/shop/download/${o.order_id}`;
    }
  });
  res.json(orders);
});

// Download purchased digital product
app.get('/api/shop/download/:orderId', (req, res) => {
  // Accept either auth header or token query param (for email links)
  let userId = null;
  const tokenParam = req.query.token;
  if (tokenParam) {
    try {
      const decoded = require('jsonwebtoken').verify(tokenParam, JWT_SECRET);
      if (decoded.orderId === req.params.orderId) userId = decoded.userId;
    } catch(e) { /* invalid token */ }
  }
  if (!userId) {
    // Try normal auth
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = require('jsonwebtoken').verify(authHeader.slice(7), JWT_SECRET);
        userId = decoded.userId;
      } catch(e) { /* invalid */ }
    }
  }
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });

  const order = db.prepare('SELECT mo.*, mp.product_type, mp.name as product_name FROM merchant_orders mo JOIN merchant_products mp ON mo.product_id=mp.id WHERE mo.id=? AND mo.user_id=? AND mo.status=?')
    .get(req.params.orderId, userId, 'completed');
  if (!order) return res.status(404).json({ error: 'Purchase not found' });

  // Serve the PDF file
  const filePath = require('path').join(__dirname, 'public', 'shop', 'the-potters-mud-log.pdf');
  if (!require('fs').existsSync(filePath)) return res.status(404).json({ error: 'File not available' });
  res.setHeader('Content-Disposition', `attachment; filename="${order.product_name.replace(/[^a-zA-Z0-9 .-]/g, '')}.pdf"`);
  res.setHeader('Content-Type', 'application/pdf');
  res.sendFile(filePath);
});

// ============ DASHBOARD ============
app.get('/api/dashboard', auth, (req, res) => {
  const u = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const tier = u?.tier || 'free';
  const totalPieces = db.prepare('SELECT COUNT(*) as c FROM pieces WHERE user_id=?').get(req.userId).c;
  const byStatus = db.prepare('SELECT status,COUNT(*) as count FROM pieces WHERE user_id=? GROUP BY status').all(req.userId);
  const recentPieces = db.prepare("SELECT p.*,cb.name as clay_body_name FROM pieces p LEFT JOIN clay_bodies cb ON p.clay_body_id=cb.id WHERE p.user_id=? AND (p.status IS NULL OR p.status NOT IN ('broken','recycled')) ORDER BY p.updated_at DESC LIMIT 5").all(req.userId);
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
        const msg = (fromUser?.display_name||'Someone') + ' liked your post "' + post.title + '"';
        db.prepare('INSERT INTO notifications (id,user_id,type,message,link,from_user_id) VALUES (?,?,?,?,?,?)')
          .run(uuidv4(), post.user_id, 'forum_like', msg, 'forumPost_'+req.params.id, req.userId);
        sendPushToUser(post.user_id, 'Post Liked', msg, { type: 'forum_like', postId: req.params.id });
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
      const msg = (fromUser?.display_name||'Someone') + ' replied to your post "' + post.title + '"';
      db.prepare('INSERT INTO notifications (id,user_id,type,message,link,from_user_id) VALUES (?,?,?,?,?,?)')
        .run(uuidv4(), post.user_id, 'forum_reply', msg, 'forumPost_'+postId, replyUserId);
      // Send push notification
      sendPushToUser(post.user_id, 'New Reply', msg, { type: 'forum_reply', postId });
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

// ============ PUSH TOKENS ============
app.post('/api/push-token', auth, (req, res) => {
  const { token, platform } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  // Upsert: if token exists for another user, reassign it
  db.prepare('DELETE FROM push_tokens WHERE token=?').run(token);
  db.prepare('INSERT INTO push_tokens (id,user_id,token,platform) VALUES (?,?,?,?)')
    .run(uuidv4(), req.userId, token, platform || 'unknown');
  res.json({ success: true });
});

app.delete('/api/push-token', auth, (req, res) => {
  const { token } = req.body;
  if (token) {
    db.prepare('DELETE FROM push_tokens WHERE token=? AND user_id=?').run(token, req.userId);
  } else {
    db.prepare('DELETE FROM push_tokens WHERE user_id=?').run(req.userId);
  }
  res.json({ success: true });
});

// Helper: send push notifications to a user
async function sendPushToUser(userId, title, body, data = {}) {
  try {
    const tokens = db.prepare('SELECT token FROM push_tokens WHERE user_id=?').all(userId);
    if (!tokens.length) return;
    const messages = tokens
      .filter(t => Expo.isExpoPushToken(t.token))
      .map(t => ({
        to: t.token,
        sound: 'default',
        title,
        body,
        data,
      }));
    if (!messages.length) return;
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try { await expo.sendPushNotificationsAsync(chunk); } catch (e) { console.warn('[push] chunk error:', e.message); }
    }
  } catch (e) { console.warn('[push] sendPushToUser error:', e.message); }
}

// Helper: send push notification to ALL users (for blog posts, announcements)
async function sendPushToAll(title, body, data = {}) {
  try {
    const tokens = db.prepare('SELECT DISTINCT token FROM push_tokens').all();
    if (!tokens.length) return;
    const messages = tokens
      .filter(t => Expo.isExpoPushToken(t.token))
      .map(t => ({
        to: t.token,
        sound: 'default',
        title,
        body,
        data,
      }));
    if (!messages.length) return;
    const chunks = expo.chunkPushNotifications(messages);
    for (const chunk of chunks) {
      try { await expo.sendPushNotificationsAsync(chunk); } catch (e) { console.warn('[push] chunk error:', e.message); }
    }
    console.log(`[push] Sent to ${messages.length} devices: "${title}"`);
  } catch (e) { console.warn('[push] sendPushToAll error:', e.message); }
}

// Helper: notify all members about a new blog post (in-app + push)
function notifyAllBlogPost(postId, title, slug) {
  try {
    const users = db.prepare('SELECT id FROM users').all();
    users.forEach(user => {
      db.prepare(`INSERT INTO notifications (id, user_id, type, message, link, created_at) VALUES (?,?,?,?,?,datetime('now'))`)
        .run(uuidv4(), user.id, 'blog', '📝 New blog post: ' + title, '/blog/' + slug);
    });
    // Send push to all devices
    sendPushToAll('New Blog Post', title, { type: 'blog_post', postId, slug });
  } catch (e) { console.warn('[notify] notifyAllBlogPost error:', e.message); }
}

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
  const msg = (fromUser?.display_name||'Someone') + ' sent you a message';
  db.prepare('INSERT INTO notifications (id,user_id,type,message,link,from_user_id) VALUES (?,?,?,?,?,?)')
    .run(uuidv4(), req.params.userId, 'message', msg, 'messages_'+req.userId, req.userId);
  sendPushToUser(req.params.userId, 'New Message', msg, { type: 'message', fromUserId: req.userId });
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

// Admin: send a plain announcement email to all members.
// Body: { subject, html, text? }
app.post('/api/admin/announce', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { subject, html, text } = req.body || {};
    if (!subject || !html) return res.status(400).json({ error: 'subject and html required' });
    const recipients = db.prepare("SELECT id, email FROM users WHERE email IS NOT NULL AND email != ''").all();
    if (!transporter) return res.status(500).json({ error: 'SMTP not configured' });
    const announceId = uuidv4();
    let sent = 0, failed = 0;
    recipients.forEach(r => {
      // Add open-tracking pixel to each email
      const emailB64 = Buffer.from(r.email).toString('base64');
      const trackOpen = `https://thepottersmudroom.com/api/newsletter/open/${announceId}/${emailB64}`;
      const htmlWithTracking = html + `<img src="${trackOpen}" width="1" height="1" style="display:none" alt="">`;
      transporter.sendMail({
        from: process.env.SMTP_USER || 'thepottersmudroom@gmail.com',
        to: r.email,
        subject,
        html: htmlWithTracking,
        text: text || html.replace(/<[^>]+>/g,'')
      }).then(() => { sent++; }).catch(err => { failed++; console.error('Announce email error:', r.email, err.message); });
    });
    // Log announcement to unified email_sends history
    try {
      db.prepare('INSERT INTO email_sends (id, type, subject, sent_by, recipients_count, blog_post_id) VALUES (?,?,?,?,?,?)').run(announceId, 'announcement', subject, req.userId, recipients.length, null);
    } catch(e) { console.error('Failed to log announcement send:', e.message); }
    res.json({ success: true, queued: recipients.length, note: 'Emails sent in background. Check server logs for failures.' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Manually upgrade/fix a member (e.g. when Stripe webhook missed). Admin only.
// Body: { tier, billingPeriod, stripeCustomerId, stripeSubscriptionId }
app.post('/api/admin/members/:id/upgrade', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { tier, billingPeriod, stripeCustomerId, stripeSubscriptionId } = req.body || {};
    if (!tier) return res.status(400).json({ error: 'tier required' });
    db.pragma('ignore_check_constraints = ON');
    db.prepare(`UPDATE users SET tier=?, billing_period=?, stripe_customer_id=?, stripe_subscription_id=? WHERE id=?`)
      .run(tier, billingPeriod || 'stripe-monthly', stripeCustomerId || null, stripeSubscriptionId || null, req.params.id);
    db.pragma('ignore_check_constraints = OFF');
    const u = db.prepare('SELECT id,email,tier,billing_period,stripe_customer_id,stripe_subscription_id FROM users WHERE id=?').get(req.params.id);
    res.json({ success: true, user: u });
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

app.post('/api/goals', auth, (req, res) => {
  const { title, description, status, dueDate, priority } = req.body;

  const user = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const tier = user?.tier === 'starter' ? 'starter' : 'free';
  if (tier === 'free') {
    const goalCount = db.prepare('SELECT COUNT(*) as c FROM goals WHERE user_id=?').get(req.userId)?.c || 0;
    if (goalCount >= 1) {
      return res.status(403).json({ error: 'Free members can save 1 goal. Upgrade to Unlimited for more.' });
    }
  }

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

app.post('/api/projects', auth, (req, res) => {
  const { title, name, description, status, dueDate, deadline, notes, priority, contactName, contactEmail, contactPhone, contactNotes, shoppingList, budget } = req.body;
  const projectTitle = title || name;
  if (!projectTitle) return res.status(400).json({ error: 'Project name is required' });

  const user = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const tier = user?.tier === 'starter' ? 'starter' : 'free';
  if (tier === 'free') {
    const projectCount = db.prepare('SELECT COUNT(*) as c FROM projects WHERE user_id=?').get(req.userId)?.c || 0;
    if (projectCount >= 1) {
      return res.status(403).json({ error: 'Free members can save 1 project. Upgrade to Unlimited for more.' });
    }
  }

  const id = uuidv4();
  db.prepare('INSERT INTO projects (id,user_id,title,description,status,due_date,priority,contact_name,contact_email,contact_phone,contact_notes,shopping_list,budget,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, projectTitle, description || null, status || 'active', dueDate || deadline || null, priority || 'medium', contactName || null, contactEmail || null, contactPhone || null, contactNotes || null, shoppingList || null, budget || null, notes || null);
  res.json({ id });
});

app.get('/api/projects/:id', auth, (req, res) => {
  const project = db.prepare('SELECT * FROM projects WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!project) return res.status(404).json({ error: 'Project not found' });
  const photos = db.prepare('SELECT id,filename FROM project_photos WHERE project_id=? ORDER BY sort_order ASC').all(project.id);
  res.json({ ...project, photos });
});

app.put('/api/projects/:id', auth, (req, res) => {
  const { title, name, description, status, dueDate, deadline, notes, priority, contactName, contactEmail, contactPhone, contactNotes, shoppingList, budget } = req.body;
  const projectTitle = title || name;
  if (!projectTitle) return res.status(400).json({ error: 'Project name is required' });
  const validStatuses = ['active', 'completed', 'archived'];
  const safeStatus = validStatuses.includes(status) ? status : 'active';
  try {
    db.prepare('UPDATE projects SET title=?,description=?,status=?,due_date=?,priority=?,contact_name=?,contact_email=?,contact_phone=?,contact_notes=?,shopping_list=?,budget=?,notes=?,updated_at=datetime(\'now\') WHERE id=? AND user_id=?')
      .run(projectTitle, description || null, safeStatus, dueDate || deadline || null, priority || 'medium', contactName || null, contactEmail || null, contactPhone || null, contactNotes || null, shoppingList || null, budget || null, notes || null, req.params.id, req.userId);
    res.json({ success: true });
  } catch (err) {
    console.error('Project update error:', err.message);
    res.status(500).json({ error: 'Could not update project' });
  }
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

app.post('/api/events', auth, (req, res) => {
  const { title, description, eventDate, startTime, endTime, location } = req.body;
  if (!eventDate) return res.status(400).json({ error: 'Event date is required' });

  const user = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const tier = user?.tier === 'starter' ? 'starter' : 'free';
  if (tier === 'free') {
    const eventCount = db.prepare('SELECT COUNT(*) as c FROM events WHERE user_id=?').get(req.userId)?.c || 0;
    if (eventCount >= 1) {
      return res.status(403).json({ error: 'Free members can save 1 event. Upgrade to Unlimited for more.' });
    }
  }

  const id = uuidv4();
  db.prepare('INSERT INTO events (id,user_id,title,description,event_date,start_time,end_time,location) VALUES (?,?,?,?,?,?,?,?)')
    .run(id, req.userId, title, description, eventDate, startTime || null, endTime || null, location || null);
  res.json({ id });
});

app.post('/api/events/:id/photo', auth, upload.single('photo'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo uploaded' });
  const ev = db.prepare('SELECT * FROM events WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!ev) return res.status(404).json({ error: 'Event not found' });
  // Remove old image if exists
  if (ev.image_filename) {
    const old = path.join(UPLOADS_DIR, ev.image_filename);
    if (fs.existsSync(old)) fs.unlinkSync(old);
  }
  db.prepare('UPDATE events SET image_filename=? WHERE id=?').run(req.file.filename, req.params.id);
  res.json({ filename: req.file.filename });
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
  // Attach sale/event counts
  const saleCounts = db.prepare('SELECT contact_id, COUNT(*) as count, SUM(price*quantity) as total FROM sales WHERE user_id=? AND contact_id IS NOT NULL GROUP BY contact_id').all(req.userId);
  const eventCounts = db.prepare('SELECT contact_id, COUNT(*) as count FROM events WHERE user_id=? AND contact_id IS NOT NULL GROUP BY contact_id').all(req.userId);
  const saleMap = Object.fromEntries(saleCounts.map(s => [s.contact_id, { count: s.count, total: s.total }]));
  const eventMap = Object.fromEntries(eventCounts.map(e => [e.contact_id, e.count]));
  contacts.forEach(c => {
    c.salesCount = saleMap[c.id]?.count || 0;
    c.salesTotal = saleMap[c.id]?.total || 0;
    c.eventsCount = eventMap[c.id] || 0;
  });
  res.json(contacts);
});

app.get('/api/contacts/:id', auth, (req, res) => {
  const contact = db.prepare('SELECT * FROM contacts WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!contact) return res.status(404).json({ error: 'Contact not found' });
  contact.sales = db.prepare('SELECT id,date,price,item_description,venue,venue_type,quantity FROM sales WHERE contact_id=? AND user_id=? ORDER BY date DESC').all(contact.id, req.userId);
  contact.events = db.prepare('SELECT id,title,event_date,location FROM events WHERE contact_id=? AND user_id=? ORDER BY event_date DESC').all(contact.id, req.userId);
  res.json(contact);
});

app.post('/api/contacts', auth, (req, res) => {
  const { name, email, phone, notes, role, address, instagram, website } = req.body;

  const user = db.prepare('SELECT tier FROM users WHERE id=?').get(req.userId);
  const tier = user?.tier === 'starter' ? 'starter' : 'free';
  if (tier === 'free') {
    const contactCount = db.prepare('SELECT COUNT(*) as c FROM contacts WHERE user_id=?').get(req.userId)?.c || 0;
    if (contactCount >= 1) {
      return res.status(403).json({ error: 'Free members can save 1 contact. Upgrade to Unlimited for more.' });
    }
  }

  const id = uuidv4();
  db.prepare('INSERT INTO contacts (id,user_id,name,email,phone,notes,role,address,instagram,website) VALUES (?,?,?,?,?,?,?,?,?,?)')
    .run(id, req.userId, name, email || null, phone || null, notes || null, role || null, address || null, instagram || null, website || null);
  res.json({ id });
});

app.put('/api/contacts/:id', auth, (req, res) => {
  const { name, email, phone, notes, role, address, instagram, website } = req.body;
  db.prepare('UPDATE contacts SET name=?,email=?,phone=?,notes=?,role=?,address=?,instagram=?,website=?,updated_at=datetime(\'now\') WHERE id=? AND user_id=?')
    .run(name, email || null, phone || null, notes || null, role || null, address || null, instagram || null, website || null, req.params.id, req.userId);
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
    // Track blog view
    try { db.prepare("UPDATE blog_posts SET view_count=COALESCE(view_count,0)+1 WHERE id=?").run(post.id); } catch(e) {}
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
    // If published immediately, notify all members
    if (isPublished) notifyAllBlogPost(id, title, finalSlug);
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
    // Check if this is transitioning from unpublished to published
    const existing = db.prepare('SELECT is_published FROM blog_posts WHERE id=?').get(req.params.id);
    const wasPublished = existing && existing.is_published === 1;
    db.prepare(`UPDATE blog_posts SET title=?, slug=?, content=?, excerpt=?, author=?, is_published=?, updated_at=datetime('now') WHERE id=?`)
      .run(title, slug, content, excerpt, author || 'Christina Workman', isPublished ? 1 : 0, req.params.id);
    // Notify only when transitioning from draft to published
    if (isPublished && !wasPublished) notifyAllBlogPost(req.params.id, title, slug);
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
    db.prepare(`UPDATE blog_posts SET is_published=1, published_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
      .run(req.params.id);
    // Notify all members about the new blog post
    const post = db.prepare('SELECT id, title, slug FROM blog_posts WHERE id=?').get(req.params.id);
    if (post) notifyAllBlogPost(post.id, post.title, post.slug);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Remote admin: upgrade a user's tier by email (password-protected)
app.post('/api/admin/upgrade-tier/remote', (req, res) => {
  const { password, email, tier } = req.body;
  if (password !== (process.env.ADMIN_BLOG_PASSWORD || 'mudroom-blog-2026')) return res.status(401).json({ error: 'Unauthorized' });
  if (!email) return res.status(400).json({ error: 'Email required' });
  const targetTier = tier || 'starter';
  try {
    db.pragma('ignore_check_constraints = ON');
    const result = db.prepare('UPDATE users SET tier=?, billing_period=? WHERE LOWER(email)=?').run(targetTier, 'stripe-monthly', email.toLowerCase());
    db.pragma('ignore_check_constraints = OFF');
    if (result.changes === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true, email, tier: targetTier });
  } catch(e) {
    db.pragma('ignore_check_constraints = OFF');
    res.status(500).json({ error: e.message });
  }
});

// Admin blog via password (for remote management without JWT)
app.post('/api/admin/blog/remote', (req, res) => {
  const { password, title, slug, content, excerpt, author, isPublished } = req.body;
  if (password !== (process.env.ADMIN_BLOG_PASSWORD || 'mudroom-blog-2026')) return res.status(401).json({ error: 'Unauthorized' });
  if (!title || !content) return res.status(400).json({ error: 'Title and content required' });
  const finalSlug = slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
  const id = require('uuid').v4();
  try {
    db.prepare('INSERT INTO blog_posts (id, title, slug, content, excerpt, author, is_published) VALUES (?,?,?,?,?,?,?)')
      .run(id, title, finalSlug, content, excerpt || content.substring(0, 200) + '...', author || 'Christina Workman', isPublished ? 1 : 0);
    // If published immediately, notify all members
    if (isPublished) notifyAllBlogPost(id, title, finalSlug);
    res.json({ id, slug: finalSlug, published: !!isPublished });
  } catch(e) {
    if (e.message.includes('UNIQUE')) return res.status(409).json({ error: 'A post with that slug already exists' });
    res.status(500).json({ error: e.message });
  }
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
    // Unified history: pull from email_sends table (includes both newsletters and announcements)
    const sends = db.prepare(`
      SELECT es.id, es.type, es.subject, es.sent_at, es.recipients_count, es.blog_post_id, bp.title, bp.slug
      FROM email_sends es
      LEFT JOIN blog_posts bp ON es.blog_post_id = bp.id
      ORDER BY es.sent_at DESC
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
        const emailB64 = Buffer.from(subscriber.email).toString('base64');
        const trackOpen = `https://thepottersmudroom.com/api/newsletter/open/${sendId}/${emailB64}`;
        const trackClick = `https://thepottersmudroom.com/api/newsletter/click/${sendId}/${emailB64}?url=${encodeURIComponent('https://thepottersmudroom.com/blog/' + post.slug)}`;
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
                  <a href="${trackClick}" style="background: #8B7355; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">Read Now</a>
                </div>
              </div>
              <div style="padding: 10px 20px; background: #f5f5f5; font-size: 12px; color: #999; text-align: center;">
                <p>The Potter's Mud Room © 2026. <a href="https://thepottersmudroom.com" style="color: #8B7355; text-decoration: none;">Visit our site</a></p>
              </div>
              <img src="${trackOpen}" width="1" height="1" style="display:none" alt="">
            </div>
          `
        };
        transporter.sendMail(mailOptions).catch(err => {
          console.error('Newsletter email error:', err.message);
        });
      }
    });

    // Record the send in legacy table
    db.prepare(`
      INSERT INTO newsletter_sends (id, blog_post_id, sent_by, recipients_count)
      VALUES (?,?,?,?)
    `).run(sendId, blogPostId, req.userId, subscribers.length);

    // Also record in unified email_sends history
    try {
      db.prepare('INSERT INTO email_sends (id, type, subject, sent_by, recipients_count, blog_post_id) VALUES (?,?,?,?,?,?)').run(sendId, 'newsletter', post.title, req.userId, subscribers.length, blogPostId);
    } catch(e) { console.error('Failed to log newsletter to email_sends:', e.message); }

    res.json({ success: true, recipientCount: subscribers.length });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: send a plain announcement email to all members.
// Body: { subject, html, text? }
app.post('/api/admin/announce', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { subject, html, text } = req.body || {};
    if (!subject || !html) return res.status(400).json({ error: 'subject and html required' });
    const recipients = db.prepare("SELECT id, email FROM users WHERE email IS NOT NULL AND email != ''").all();
    if (!transporter) return res.status(500).json({ error: 'SMTP not configured' });
    const announceId = uuidv4();
    let sent = 0, failed = 0;
    recipients.forEach(r => {
      // Add open-tracking pixel to each email
      const emailB64 = Buffer.from(r.email).toString('base64');
      const trackOpen = `https://thepottersmudroom.com/api/newsletter/open/${announceId}/${emailB64}`;
      const htmlWithTracking = html + `<img src="${trackOpen}" width="1" height="1" style="display:none" alt="">`;
      transporter.sendMail({
        from: process.env.SMTP_USER || 'thepottersmudroom@gmail.com',
        to: r.email,
        subject,
        html: htmlWithTracking,
        text: text || html.replace(/<[^>]+>/g,'')
      }).then(() => { sent++; }).catch(err => { failed++; console.error('Announce email error:', r.email, err.message); });
    });
    // Log announcement to unified email_sends history
    try {
      db.prepare('INSERT INTO email_sends (id, type, subject, sent_by, recipients_count, blog_post_id) VALUES (?,?,?,?,?,?)').run(announceId, 'announcement', subject, req.userId, recipients.length, null);
    } catch(e) { console.error('Failed to log announcement send:', e.message); }
    // Also record in newsletter_sends so stats endpoint can find it
    try {
      db.prepare('INSERT INTO newsletter_sends (id, blog_post_id, sent_by, recipients_count) VALUES (?,?,?,?)').run(announceId, null, req.userId, recipients.length);
    } catch(e) { /* silent */ }
    res.json({ success: true, queued: recipients.length, id: announceId });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Admin: send email to specific recipients (not all members)
// Body: { to: "email" or ["email1","email2"], subject, html, text? }
app.post('/api/admin/email-send', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { to, subject, html, text } = req.body || {};
    if (!to || !subject || !html) return res.status(400).json({ error: 'to, subject, and html required' });
    if (!transporter) return res.status(500).json({ error: 'SMTP not configured' });
    const recipients = Array.isArray(to) ? to : [to];
    let sent = 0, failed = 0;
    const promises = recipients.map(email =>
      transporter.sendMail({
        from: process.env.SMTP_USER || 'thepottersmudroom@gmail.com',
        to: email,
        subject,
        html,
        text: text || html.replace(/<[^>]+>/g, '')
      }).then(() => { sent++; }).catch(err => { failed++; console.error('Targeted email error:', email, err.message); })
    );
    Promise.all(promises).then(() => {
      console.log(`Targeted email done: ${sent} sent, ${failed} failed`);
    });
    res.json({ success: true, queued: recipients.length });
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

// ---- Admin: Email Settings (save SMTP creds to DB so env vars aren't needed) ----
app.get('/api/admin/email-settings', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const user = db.prepare("SELECT value FROM site_settings WHERE key='smtp_user'").get();
    const configured = !!(user && user.value);
    res.json({ configured, email: user ? user.value : null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/email-settings', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { smtp_user, smtp_pass, smtp_host, smtp_port } = req.body;
    if (!smtp_user || !smtp_pass) return res.status(400).json({ error: 'Email and app password are required' });
    
    db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('smtp_user', ?)").run(smtp_user);
    db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('smtp_pass', ?)").run(smtp_pass);
    if (smtp_host) db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('smtp_host', ?)").run(smtp_host);
    if (smtp_port) db.prepare("INSERT OR REPLACE INTO site_settings (key, value) VALUES ('smtp_port', ?)").run(String(smtp_port));
    
    setupTransporter(smtp_user, smtp_pass, smtp_host || null, smtp_port ? parseInt(smtp_port) : undefined);
    
    res.json({ success: true, message: 'Email settings saved. Testing connection...' });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/admin/email-settings/test', auth, async (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  if (!transporter) return res.json({ success: false, error: 'No email configured' });
  try {
    await transporter.verify();
    res.json({ success: true, message: 'Email connection working!' });
  } catch(e) {
    res.json({ success: false, error: e.message });
  }
});

// Newsletter tracking: open pixel (1x1 transparent gif)
app.get('/api/newsletter/open/:sendId/:email', (req, res) => {
  try {
    const { sendId, email } = req.params;
    const decoded = Buffer.from(email, 'base64').toString();
    // Only record first open per recipient per send
    const existing = db.prepare('SELECT id FROM newsletter_tracking WHERE send_id=? AND recipient_email=? AND event_type=?').get(sendId, decoded, 'open');
    if (!existing) {
      db.prepare('INSERT INTO newsletter_tracking (send_id, recipient_email, event_type) VALUES (?,?,?)').run(sendId, decoded, 'open');
    }
  } catch(e) { /* silent */ }
  // Return 1x1 transparent GIF
  const pixel = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
  res.set({ 'Content-Type': 'image/gif', 'Cache-Control': 'no-store' });
  res.send(pixel);
});

// Newsletter tracking: click-through
app.get('/api/newsletter/click/:sendId/:email', (req, res) => {
  try {
    const { sendId, email } = req.params;
    const decoded = Buffer.from(email, 'base64').toString();
    const existing = db.prepare('SELECT id FROM newsletter_tracking WHERE send_id=? AND recipient_email=? AND event_type=?').get(sendId, decoded, 'click');
    if (!existing) {
      db.prepare('INSERT INTO newsletter_tracking (send_id, recipient_email, event_type) VALUES (?,?,?)').run(sendId, decoded, 'click');
    }
  } catch(e) { /* silent */ }
  // Redirect to the blog post
  const url = req.query.url || 'https://thepottersmudroom.com';
  res.redirect(302, url);
});

// Admin: newsletter tracking stats
app.get('/api/admin/newsletter/stats/:sendId', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { sendId } = req.params;
    // Try newsletter_sends first, fall back to email_sends for announcements
    let send = db.prepare('SELECT ns.*, bp.title FROM newsletter_sends ns LEFT JOIN blog_posts bp ON ns.blog_post_id=bp.id WHERE ns.id=?').get(sendId);
    if (!send) {
      // Check email_sends table for announcements
      const es = db.prepare('SELECT * FROM email_sends WHERE id=?').get(sendId);
      if (!es) return res.status(404).json({ error: 'Send not found' });
      send = { id: es.id, recipients_count: es.recipients_count, title: es.subject };
    }
    
    const opens = db.prepare('SELECT COUNT(DISTINCT recipient_email) as count FROM newsletter_tracking WHERE send_id=? AND event_type=?').get(sendId, 'open');
    const clicks = db.prepare('SELECT COUNT(DISTINCT recipient_email) as count FROM newsletter_tracking WHERE send_id=? AND event_type=?').get(sendId, 'click');
    const openList = db.prepare('SELECT recipient_email, created_at FROM newsletter_tracking WHERE send_id=? AND event_type=? ORDER BY created_at').all(sendId, 'open');
    const clickList = db.prepare('SELECT recipient_email, created_at FROM newsletter_tracking WHERE send_id=? AND event_type=? ORDER BY created_at').all(sendId, 'click');
    
    res.json({
      send,
      opens: opens.count,
      clicks: clicks.count,
      recipients: send.recipients_count,
      openRate: send.recipients_count > 0 ? Math.round((opens.count / send.recipients_count) * 100) : 0,
      clickRate: send.recipients_count > 0 ? Math.round((clicks.count / send.recipients_count) * 100) : 0,
      openList,
      clickList
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Dynamic sitemap with blog posts
app.get('/sitemap.xml', (req, res) => {
  try {
    const posts = db.prepare("SELECT slug, updated_at, published_at FROM blog_posts WHERE is_published=1 ORDER BY published_at DESC").all();
    let xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
    xml += '  <url><loc>https://thepottersmudroom.com/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n';
    posts.forEach(p => {
      const date = (p.updated_at || p.published_at || '').split(' ')[0];
      xml += `  <url><loc>https://thepottersmudroom.com/blog/${p.slug}</loc>${date ? '<lastmod>' + date + '</lastmod>' : ''}<changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
    });
    xml += '</urlset>';
    res.set('Content-Type', 'application/xml');
    res.send(xml);
  } catch(e) { res.status(500).send('Error generating sitemap'); }
});

// Public blog post page — standalone, no login required
app.get('/blog/:slug', (req, res) => {
  try {
    const post = db.prepare('SELECT * FROM blog_posts WHERE slug=? AND is_published=1').get(req.params.slug);
    if (!post) return res.status(404).send('Post not found');
    
    res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${post.title} — The Potter's Mud Room</title>
  <meta name="description" content="${(post.excerpt || '').replace(/"/g, '&quot;')}">
  <meta property="og:title" content="${post.title}">
  <meta property="og:description" content="${(post.excerpt || '').replace(/"/g, '&quot;')}">
  <meta property="og:type" content="article">
  <meta property="og:url" content="https://thepottersmudroom.com/blog/${post.slug}">
  <meta property="og:image" content="https://thepottersmudroom.com/og-image.png">
  <meta property="og:image:width" content="1200">
  <meta property="og:image:height" content="630">
  <meta property="og:site_name" content="The Potter's Mud Room">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:title" content="${post.title}">
  <meta name="twitter:description" content="${(post.excerpt || '').replace(/"/g, '&quot;')}">
  <meta name="twitter:image" content="https://thepottersmudroom.com/og-image.png">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #FAF8F5; color: #333; line-height: 1.7; }
    .header { background: linear-gradient(135deg, #8B7355 0%, #A0826D 100%); padding: 20px 0; text-align: center; }
    .header a { color: white; text-decoration: none; font-size: 1.5rem; font-weight: bold; }
    .header span { color: #D4A574; }
    .container { max-width: 720px; margin: 0 auto; padding: 40px 20px; }
    h1 { font-size: 2rem; color: #5C4033; margin-bottom: 8px; }
    .meta { color: #999; font-size: 0.9rem; margin-bottom: 32px; }
    .content { font-size: 1.05rem; color: #444; }
    .content h2 { color: #5C4033; margin: 28px 0 12px; font-size: 1.4rem; }
    .content h3 { color: #6B5244; margin: 24px 0 8px; font-size: 1.2rem; }
    .content p { margin-bottom: 16px; }
    .content ul, .content ol { margin: 0 0 16px 24px; }
    .content li { margin-bottom: 6px; }
    .content a { color: #8B7355; }
    .content strong { color: #333; }
    .footer { text-align: center; padding: 40px 20px; border-top: 1px solid #E8E0D8; margin-top: 40px; }
    .footer a { color: #8B7355; text-decoration: none; font-weight: 600; padding: 12px 24px; border: 2px solid #8B7355; border-radius: 6px; }
    .footer a:hover { background: #8B7355; color: white; }
    .footer p { margin-top: 16px; color: #999; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="header"><a href="https://thepottersmudroom.com">🏺 The Potter's <span>Mud Room</span></a></div>
  <div class="container">
    <h1>${post.title}</h1>
    <div class="meta">By ${post.author || 'Christina Workman'} · ${new Date(post.published_at || post.created_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
    <div class="content">${post.content}</div>
  </div>
  <div class="footer">
    <a href="https://thepottersmudroom.com">Visit The Potter's Mud Room</a>
    <p>© 2026 The Potter's Mud Room. Track your pottery journey.</p>
  </div>
</body>
</html>`);
  } catch(e) { res.status(500).send('Error loading post'); }
});

// ============ USER ACTIVITY TRACKING ============
// POST /api/activity — log user feature usage
app.post('/api/activity', auth, (req, res) => {
  try {
    const { action, page } = req.body;
    if (!action) return res.status(400).json({ error: 'action required' });
    db.prepare('INSERT INTO user_activity (user_id, action, page) VALUES (?,?,?)').run(req.userId, action, page || null);
    res.json({ ok: true });
  } catch(e) { res.json({ ok: true }); /* don't fail on tracking */ }
});

// GET /api/admin/activity-summary — admin usage analytics
app.get('/api/admin/activity-summary', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    // Feature usage counts (ranked most to least)
    const featureUsage = db.prepare(`SELECT action, COUNT(*) as count FROM user_activity GROUP BY action ORDER BY count DESC`).all();

    // Daily active users (last 30 days)
    const dailyActiveUsers = db.prepare(`SELECT date(created_at) as day, COUNT(DISTINCT user_id) as users FROM user_activity WHERE created_at >= datetime('now', '-30 day') GROUP BY day ORDER BY day`).all();

    // Per-user activity summary
    const perUser = db.prepare(`
      SELECT u.email, u.display_name, 
        COUNT(ua.id) as total_actions,
        MAX(ua.created_at) as last_active,
        (SELECT ua2.action FROM user_activity ua2 WHERE ua2.user_id = u.id GROUP BY ua2.action ORDER BY COUNT(*) DESC LIMIT 1) as top_feature
      FROM users u
      JOIN user_activity ua ON ua.user_id = u.id
      GROUP BY u.id
      ORDER BY total_actions DESC
    `).all();

    // Activity over time (daily counts last 30 days)
    const activityOverTime = db.prepare(`SELECT date(created_at) as day, COUNT(*) as count FROM user_activity WHERE created_at >= datetime('now', '-30 day') GROUP BY day ORDER BY day`).all();

    // Total count for percentage calc
    const totalActions = featureUsage.reduce((s, f) => s + f.count, 0);

    // Active users: today / this week / this month
    const activeToday = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM user_activity WHERE created_at >= datetime('now', '-1 day')").get().c;
    const activeWeek = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM user_activity WHERE created_at >= datetime('now', '-7 day')").get().c;
    const activeMonth = db.prepare("SELECT COUNT(DISTINCT user_id) as c FROM user_activity WHERE created_at >= datetime('now', '-30 day')").get().c;

    res.json({
      featureUsage,
      dailyActiveUsers,
      perUser,
      activityOverTime,
      totalActions,
      activeToday,
      activeWeek,
      activeMonth
    });
  } catch(e) {
    console.error('Activity summary error:', e.message);
    res.status(500).json({ error: 'Failed to load activity summary' });
  }
});

// ============ BETA SIGNUPS ============
app.post('/api/beta-signup', (req, res) => {
  const { email, name } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });
  try {
    db.prepare('INSERT OR IGNORE INTO beta_signups (email, name) VALUES (?, ?)').run(email.trim().toLowerCase(), name || null);
    // If this email matches an existing user, upgrade them to lifetime unlimited (beta reward)
    const user = db.prepare('SELECT id FROM users WHERE LOWER(email)=?').get(email.trim().toLowerCase());
    if (user) {
      db.prepare("UPDATE users SET tier='starter', billing_period='promo', plan_expires_at=NULL, is_beta_tester=1 WHERE id=?").run(user.id);
    }
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: 'Something went wrong' }); }
});

// Admin: bulk upgrade all beta signups to lifetime unlimited
app.post('/api/admin/beta-signups/upgrade-all', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const signups = db.prepare('SELECT email FROM beta_signups').all();
  let upgraded = 0;
  for (const s of signups) {
    const result = db.prepare("UPDATE users SET tier='starter', billing_period='promo', plan_expires_at=NULL, is_beta_tester=1 WHERE LOWER(email)=? AND is_beta_tester=0").run(s.email);
    if (result.changes > 0) upgraded++;
  }
  // Also mark any already-top users who are beta signups
  for (const s of signups) {
    db.prepare("UPDATE users SET is_beta_tester=1 WHERE LOWER(email)=?").run(s.email);
  }
  res.json({ success: true, upgraded, total: signups.length });
});

app.get('/api/admin/beta-signups', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const signups = db.prepare('SELECT * FROM beta_signups ORDER BY created_at DESC').all();
  res.json(signups);
});

app.post('/api/admin/beta-signups/notify', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  if (!transporter) return res.status(500).json({ error: 'SMTP not configured' });
  const unsent = db.prepare('SELECT * FROM beta_signups WHERE notified_at IS NULL').all();
  if (!unsent.length) return res.json({ success: true, sent: 0, message: 'Everyone has already been notified!' });
  // Mark as notified immediately, send in background
  const ids = unsent.map(s => s.id);
  const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
  for (const id of ids) {
    db.prepare('UPDATE beta_signups SET notified_at=? WHERE id=?').run(now, id);
  }
  res.json({ success: true, sent: unsent.length, total: unsent.length });
  // Send emails in background (don't block response)
  (async () => {
    for (const s of unsent) {
      try {
        await transporter.sendMail({
          from: process.env.SMTP_USER || 'thepottersmudroom@gmail.com',
          to: s.email,
          subject: '\uD83C\uDFFA You\'re In! Install The Potter\'s Mud Room Beta',
          html: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;padding:20px">
<h2 style="color:#8B4513">Welcome to the Beta! \uD83C\uDF89</h2>
<p>Hey${s.name ? ' ' + s.name : ''}!</p>
<p>Thanks for signing up to beta test <strong>The Potter's Mud Room</strong>. Your <strong>lifetime unlimited membership</strong> is now active — no limits, no expiration, ever.</p>
<p>Here's what happens next:</p>
<ol>
<li>We'll add your Gmail to the Google Play beta tester list</li>
<li>You'll get an invite email from Google Play (may take up to 24h)</li>
<li>Tap the link to install the app</li>
<li>Sign in with this email and you're all set!</li>
</ol>
<p>If you don't see the Google Play invite within 24 hours, check your spam folder or reply to this email.</p>
<p>Happy potting! \uD83E\uDED6</p>
<p style="color:#666;font-style:italic">— Christina & The Potter's Mud Room</p>
</div>`
        });
      } catch(e) { console.error('Beta notify error:', s.email, e.message); }
    }
    console.log('Beta notify: sent', unsent.length, 'emails');
  })();
});

// Static pages
app.get('/beta', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'beta.html'));
});

// === PASSWORD RESET ENDPOINTS ===

// Admin: reset a member's password
app.post('/api/admin/members/:id/reset-password', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare(`UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, req.params.id);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// One-time emergency reset (remove after use)
// Admin password reset (authenticated)
app.post('/api/admin/members/:id/reset-password', auth, (req, res) => {
  try {
    if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const user = db.prepare('SELECT id FROM users WHERE id=?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare(`UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, user.id);
    res.json({ success: true, message: 'Password reset successfully' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Forgot password — generate token and send email
app.post('/api/auth/forgot-password', async (req, res) => {
  try {
    const email = (req.body.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const user = db.prepare('SELECT id, email FROM users WHERE email=?').get(email);
    // Always return success (don't reveal if email exists)
    if (!user) return res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
    // Generate token
    const resetToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // 1 hour
    db.prepare('INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?,?,?,?)')
      .run(uuidv4(), user.id, resetToken, expiresAt);
    // Send email
    const resetLink = `https://thepottersmudroom.com/#reset-password?token=${resetToken}`;
    if (transporter) {
      await transporter.sendMail({
        from: '"The Potter\'s Mud Room" <thepottersmudroom@gmail.com>',
        to: user.email,
        subject: 'Reset Your Password — The Potter\'s Mud Room',
        html: `<div style="font-family:sans-serif;max-width:500px;margin:0 auto;padding:24px">
          <h2 style="color:#6b4c3b">🏺 Password Reset</h2>
          <p>Hi! You requested a password reset for your Potter's Mud Room account.</p>
          <p><a href="${resetLink}" style="display:inline-block;background:#6b4c3b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">Reset My Password</a></p>
          <p style="color:#888;font-size:0.85rem">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
        </div>`
      });
    }
    res.json({ success: true, message: 'If that email exists, a reset link has been sent.' });
  } catch (err) {
    console.error('Forgot password error:', err);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// Reset password with token
app.post('/api/auth/reset-password', (req, res) => {
  try {
    const { token: resetToken, newPassword } = req.body;
    if (!resetToken || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });
    const record = db.prepare('SELECT * FROM password_reset_tokens WHERE token=?').get(resetToken);
    if (!record) return res.status(400).json({ error: 'Invalid or expired reset link' });
    if (record.used) return res.status(400).json({ error: 'This reset link has already been used' });
    if (new Date(record.expires_at) < new Date()) return res.status(400).json({ error: 'This reset link has expired' });
    const hash = bcrypt.hashSync(newPassword, 10);
    db.prepare(`UPDATE users SET password_hash=?, updated_at=datetime('now') WHERE id=?`).run(hash, record.user_id);
    db.prepare('UPDATE password_reset_tokens SET used=1 WHERE id=?').run(record.id);
    res.json({ success: true, message: 'Password updated successfully! You can now sign in.' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ========== ADMIN DOCS ==========

// GET /api/admin/docs — list all docs
app.get('/api/admin/docs', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const docs = db.prepare('SELECT id,slug,title,category,pinned,created_at,updated_at FROM admin_docs ORDER BY pinned DESC, updated_at DESC').all();
  res.json({ docs });
});

// GET /api/admin/docs/:slug — get single doc
app.get('/api/admin/docs/:slug', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const doc = db.prepare('SELECT * FROM admin_docs WHERE slug=?').get(req.params.slug);
  if (!doc) return res.status(404).json({ error: 'Doc not found' });
  res.json(doc);
});

// POST /api/admin/docs — create doc
app.post('/api/admin/docs', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { title, content, category, pinned } = req.body;
  const slug = (title || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const id = require('crypto').randomUUID();
  db.prepare('INSERT INTO admin_docs (id,slug,title,content,category,pinned) VALUES (?,?,?,?,?,?)')
    .run(id, slug, title, content, category || 'general', pinned ? 1 : 0);
  res.json({ id, slug });
});

// PUT /api/admin/docs/:slug — update doc
app.put('/api/admin/docs/:slug', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  const { title, content, category, pinned } = req.body;
  db.prepare(`UPDATE admin_docs SET title=?,content=?,category=?,pinned=?,updated_at=datetime('now') WHERE slug=?`)
    .run(title, content, category || 'general', pinned ? 1 : 0, req.params.slug);
  res.json({ success: true });
});

// DELETE /api/admin/docs/:slug — delete doc
app.delete('/api/admin/docs/:slug', auth, (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'Admin only' });
  db.prepare('DELETE FROM admin_docs WHERE slug=?').run(req.params.slug);
  res.json({ success: true });
});

// Seed default docs if empty
(function seedAdminDocs() {
  const count = db.prepare('SELECT COUNT(*) as c FROM admin_docs').get().c;
  if (count === 0) {
    const crypto = require('crypto');
    const docs = [
      {
        slug: 'beta-tester-troubleshooting',
        title: '🧪 Beta Tester Troubleshooting Guide',
        category: 'testers',
        pinned: 1,
        content: `Hey! Thanks for helping test the app. If you're seeing "App not available" or can't find the download, try these steps in order:\n\n**Step 1: Open the testing link in Chrome**\n👉 https://play.google.com/apps/testing/com.pottersmudroom.app\n\n⚠️ IMPORTANT: Do NOT open this link inside Facebook Messenger, Instagram, or any other app — it won't work. Copy/paste it into Chrome (or your default browser).\n\n**Step 2: Make sure you're signed into the right Google account**\n- The email you gave Christina must match the Google account you're signed into in Chrome\n- To check: tap your profile picture in the top-right of Chrome and verify the email\n- If you have multiple Google accounts, switch to the correct one\n\n**Step 3: Click "Become a Tester"**\n- On the testing page, you should see a button that says "Become a tester" or "Accept"\n- You MUST click this first — don't skip it!\n- After accepting, a download/install link will appear on the same page\n\n**Step 4: Install the app**\n- After accepting, click the "Download it on Google Play" link on that same page\n- This should open the Play Store listing where you can install\n\n**Still not working? Try these:**\n✅ Clear the Play Store cache — Settings → Apps → Google Play Store → Clear Cache\n✅ Make sure your Play Store app is signed into the same email\n✅ Wait 1-2 hours (Google sometimes takes time to process)\n✅ Restart your phone\n✅ Try accepting the invite on a computer first, then install from your phone\n\n**If nothing works, send Christina:**\n1. A screenshot of what you see\n2. The exact Gmail address you're using`
      },
      {
        slug: 'beta-tester-invite-template',
        title: '✉️ Beta Tester Invite Message Template',
        category: 'testers',
        pinned: 1,
        content: `Hey [NAME]! 👋\n\nThanks so much for being willing to test Potter's Mud Room! Here's how to get set up:\n\n1. Open this link in Chrome (NOT inside Messenger/Facebook/Instagram):\n👉 https://play.google.com/apps/testing/com.pottersmudroom.app\n\n2. Make sure you're signed into Chrome with: [THEIR GMAIL]\n\n3. Click "Become a Tester" / "Accept"\n\n4. After accepting, click "Download it on Google Play"\n\nAs a thank you for testing, you'll get lifetime free premium access! 🎉\n\nIf you run into any issues, let me know and I'll help you through it. 🙏`
      },
      {
        slug: 'todo-list',
        title: '📋 To-Do List',
        category: 'general',
        pinned: 1,
        content: `**🔥 HIGH PRIORITY — App & Testers**\n\n**Testing & QA:**\n☐ Test all updates from the movies session (Firing Logs, Materials, Goals, Events, Casualties, Contacts, Forum, Sales, Blog share links, Glaze Library, Home stat tiles, Notifications)\n☐ Test the project save fix (Nancy's bug — fixed May 23)\n\n**Beta Tester Recruitment:**\n☐ Post on Facebook\n☐ Post on TikTok\n☐ Post on Instagram\n☐ Send Esme the Facebook URLs\n\n**Tester Follow-ups:**\n☐ Carrie (Johnsoncarrie572@gmail.com) — still can't access\n☐ Jessica (jrintoul528@gmail.com) — same access issue\n☐ Veronika (Denmark) — sent troubleshooting guide\n☐ Nancy — confirm project save works now\n\n**🎨 NEW — Pottery Classes & Booking**\n\n☐ Figure out class details (types, pricing, group sizes, party packages, location, schedule)\n☐ Build booking system on christinaworkmanpottery.com\n☐ Create flyers for private hand building instruction/classes\n☐ Create flyers for pottery parties\n\n**📋 OTHER**\n☐ Send Esme FB URLs\n☐ Android build resets June 1 — plan next build`
      }
    ];
    const stmt = db.prepare('INSERT INTO admin_docs (id,slug,title,content,category,pinned) VALUES (?,?,?,?,?,?)');
    for (const d of docs) {
      stmt.run(crypto.randomUUID(), d.slug, d.title, d.content, d.category, d.pinned ? 1 : 0);
    }
  }
})();

// Global error handler — ensure API routes ALWAYS return JSON, never HTML
app.use((err, req, res, next) => {
  if (req.path.startsWith('/api/')) {
    console.error('[API ERROR]', req.method, req.path, err.message);
    res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
  } else {
    next(err);
  }
});

app.get('/api/ai/usage', auth, (req, res) => {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const count = db.prepare('SELECT COUNT(*) as c FROM ai_usage WHERE user_id=? AND created_at >= ?').get(req.userId, monthStart.toISOString()).c;
  const user = db.prepare('SELECT ai_tokens FROM users WHERE id=?').get(req.userId);
  const tokens = user ? (user.ai_tokens || 0) : 0;
  const limit = req.userTier === 'free' ? 5 : null;
  res.json({ used: count, limit, unlimited: req.userTier !== 'free', tokens });
});

// Token packs for Ask a Potter
const TOKEN_PACKS = {
  starter: { questions: 10, amount: 199, name: '10 Questions — $1.99' },
  studio: { questions: 30, amount: 499, name: '30 Questions — $4.99' },
  master: { questions: 75, amount: 999, name: '75 Questions — $9.99' },
};

app.get('/api/ai/token-packs', auth, (req, res) => {
  const user = db.prepare('SELECT ai_tokens FROM users WHERE id=?').get(req.userId);
  res.json({ packs: TOKEN_PACKS, currentTokens: user ? (user.ai_tokens || 0) : 0 });
});

app.post('/api/ai/buy-tokens', auth, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Payments not configured' });
  const { pack } = req.body;
  const config = TOKEN_PACKS[pack];
  if (!config) return res.status(400).json({ error: 'Invalid pack. Options: starter, studio, master' });
  try {
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          product_data: { name: 'Ask a Potter — ' + config.name },
          unit_amount: config.amount
        },
        quantity: 1
      }],
      metadata: { userId: req.userId, purchaseType: 'ai_tokens', pack, questions: String(config.questions) },
      success_url: process.env.BASE_URL ? process.env.BASE_URL + '/#aiChat' : 'https://thepottersmudroom.com/#aiChat',
      cancel_url: process.env.BASE_URL ? process.env.BASE_URL + '/#aiChat' : 'https://thepottersmudroom.com/#aiChat',
    });
    res.json({ url: session.url });
  } catch(e) {
    res.status(500).json({ error: 'Payment error: ' + e.message });
  }
});

// ─── Pottery AI Assistant ─────────────────────────────────────────────────────
app.post('/api/ai/chat', auth, async (req, res) => {
  try {
    if (!OPENAI_API_KEY) return res.status(503).json({ error: 'AI assistant not configured' });
    const { message, history } = req.body;
    if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });

    // Rate limit: free tier gets 5 questions/month, can use purchased tokens, paid gets unlimited
    if (req.userTier === 'free') {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);
      const count = db.prepare('SELECT COUNT(*) as c FROM ai_usage WHERE user_id=? AND created_at >= ?').get(req.userId, monthStart.toISOString()).c;
      if (count >= 5) {
        // Check if user has purchased tokens
        const user = db.prepare('SELECT ai_tokens FROM users WHERE id=?').get(req.userId);
        if (!user || (user.ai_tokens || 0) <= 0) {
          return res.status(403).json({ error: 'You\'ve used your 5 free questions this month. Buy more questions or upgrade to Unlimited for unlimited access!', limitReached: true, used: count, limit: 5 });
        }
        // Deduct a token
        db.prepare('UPDATE users SET ai_tokens = ai_tokens - 1 WHERE id=?').run(req.userId);
      }
    }

    // Track usage
    db.prepare('INSERT INTO ai_usage (id, user_id, message) VALUES (?, ?, ?)').run(uuidv4(), req.userId, message.slice(0, 200));

    // Build conversation with system prompt
    const systemPrompt = `You are a friendly, knowledgeable pottery assistant inside The Potter's Mud Room app. You help potters of all skill levels — especially beginners who may not know what can go wrong.

YOUR #1 PRIORITY: SAFETY. Bad advice can destroy kilns, ruin work, or cause injury. When in doubt, err on the side of caution and tell them to ask an experienced potter or check manufacturer specs.

=== CRITICAL SAFETY KNOWLEDGE ===

KILN SAFETY:
- NEVER fire a piece that is not completely bone dry. Moisture trapped in clay turns to steam and can cause explosions in the kiln, damaging the kiln and other people's work.
- Bone dry means 7-14 days of air drying minimum. Thicker pieces need longer. Humid environments need longer. There is NO shortcut.
- To test if bone dry: hold the piece to your cheek. If it feels cool, there's still moisture. Bone dry clay feels room temperature.
- NEVER fire a piece with air bubbles trapped inside. They expand and explode.
- NEVER put anything in a kiln that isn't ceramic (no metal, no glass unless specifically kiln glass, no wood, no plastic).
- Kiln shelves must be coated with kiln wash to prevent glaze drips from bonding permanently.
- Always leave space between pieces in the kiln — they should never touch each other during glaze firing.
- Bisque pieces CAN touch each other. Glazed pieces CANNOT.
- Never open a kiln above 200°F/93°C. Thermal shock can crack everything inside.
- Proper ventilation is essential — kilns release fumes (especially during bisque). Use a kiln vent or fire in a well-ventilated area.
- Never leave a kiln unattended during the first firing of a new kiln or if you suspect issues.

GLAZE SAFETY:
- Not all glazes are food safe. If someone wants to eat or drink from a piece, they MUST use a food-safe glaze fired to the correct temperature.
- Lead-based glazes exist in old/vintage supplies — NEVER use them for functional ware.
- Glaze materials (silica, feldspars, etc.) are hazardous to breathe. Always wear a respirator when mixing dry glaze materials.
- Barium-based glazes are toxic and not food safe.
- Copper and manganese can leach from glazes if not properly formulated.
- When in doubt about food safety: DON'T use it for food. Make it decorative only.

=== DRYING & TIMING ===

- Freshly made pieces: Let them dry SLOWLY for 7-14 days before bisque firing.
- Cover loosely with plastic for the first 1-3 days to slow initial drying (prevents cracking).
- Uneven drying causes warping and cracking. Thin parts dry faster than thick parts.
- Handles, attachments, and joints are the most vulnerable to cracking during drying.
- Score and slip ALL joins thoroughly. Joins that aren't properly scored WILL crack.
- Bone dry clay is fragile — handle with care.
- You CANNOT rush drying with a hair dryer or heat gun without risking cracks. Slow and even is the only way.
- In humid climates (coastal areas, rainy seasons), drying can take 2-3 weeks.
- Greenware (unfired dry clay) dissolves in water. Keep it away from moisture.

=== FIRING TEMPERATURES ===

Cone chart (approximate peak temperatures):
- Cone 022: 1112°F / 600°C (luster, china paint)
- Cone 06: 1828°F / 998°C (low-fire bisque, earthenware glaze)
- Cone 04: 1945°F / 1063°C (common bisque temp)
- Cone 6: 2232°F / 1222°C (mid-fire stoneware)
- Cone 10: 2381°F / 1305°C (high-fire stoneware/porcelain)

Common firing schedule:
- Bisque: Usually cone 04-06 (around 1828-1945°F). Slow ramp up (especially first 200°F to burn off moisture).
- Glaze: Depends entirely on the glaze. ALWAYS check the glaze label.
- NEVER assume a glaze temperature. Every glaze has a specific cone range printed on the label.

Firing speed:
- Bisque should ramp SLOWLY — especially the first few hours (water smoking phase, up to 400°F).
- A typical bisque takes 8-12 hours.
- Glaze firings are usually faster (6-10 hours) because the clay is already vitrified.
- Cooling takes 12-24 hours. DO NOT OPEN THE KILN EARLY.

=== POTTERY TOOLS & SUPPLY BRANDS ===

- Soolla: Popular pottery tool bags/totes. Canvas bags with 30+ pockets designed specifically for carrying pottery tools to and from studios. Beloved by potters who share studio space. Sold at Blick, Amazon, Sheffield Pottery, and soolla.co. Lifetime guarantee.
- Mud Tools: Premium pottery ribs, trimming tools, and modeling tools. Color-coded by flexibility.
- Kemper: Classic pottery tool brand — needle tools, fettling knives, ribbon tools, hole cutters.
- Xiem: Trimming tools, faceting tools, art rollers, stamps.
- Dolan: Wire-end trimming tools, popular for precise foot trimming.
- Dirty Girls: Fun patterned pottery tool bags, bat holders, and studio accessories.
- Shimpo: Pottery wheels, pugmills, slab rollers.
- Brent: Pottery wheels (by AMACO). Workhorses of community studios.
- Skutt: Electric kilns — the most common studio kilns in North America.
- L&L: Electric kilns known for quality element holders.
- Bailey: Slab rollers, extruders, studio equipment.
- North Star: Slab rollers and extruders.
- Peter Pugger: Pugmills and de-airing pugmills.
- Giffin Grip: Trimming system that holds pots on the wheel head.
- MKM: Pottery stamps and texture rollers from Poland.
- Amaco/Brent: Wheels, kilns, glazes, underglazes (wide product range).
- Speedball: Underglazes, ceramic supplies, screen printing.

=== COMMERCIAL GLAZE BRANDS ===

NEVER guess specific cone ranges for commercial products. Always say "check the label." But here's general brand info:
- Duncan: Primarily LOW-FIRE (cone 06-04). Their Clear Brilliance is cone 06-04.
- Amaco: Wide range. They make low-fire (Velvet underglazes), mid-fire (Potter's Choice cone 6), and high-fire glazes. ALWAYS check the specific product.
- Mayco: Primarily low-fire to mid-fire. Their Stroke & Coat works cone 06 to cone 6.
- Coyote: Mid-fire (cone 6). Known for interesting effects.
- Spectrum: Low-fire to mid-fire range.
- Laguna: Wide range of clays and glazes at all temperatures.

IMPORTANT: Even within a brand, different product LINES fire at different temps. ALWAYS defer to the label.

=== CLAY BODIES ===

- Earthenware: Low-fire (cone 06-02). Porous even when fired. Not waterproof without glaze. Terra cotta is earthenware.
- Stoneware: Mid to high-fire (cone 6-10). Dense, durable, waterproof when fully vitrified. Most functional pottery is stoneware.
- Porcelain: High-fire (cone 6-10). White, translucent when thin, very strong but difficult to work with. Warps easily.
- Paper clay: Clay with paper fiber added. Stronger in greenware, good for hand building. Burns out in bisque.
- Raku clay: Has grog (ground fired clay) added for thermal shock resistance. Used for raku firing.

Clay and glaze MUST match in firing temperature. You CANNOT put a cone 6 glaze on earthenware clay (the clay will melt). You CANNOT put a cone 06 glaze on stoneware fired to cone 6 (the glaze will burn off or look terrible).

=== HAND BUILDING ===

- Pinch pots: Start with a ball of clay, push thumb into center, pinch walls evenly. Great for beginners.
- Coil building: Roll coils, stack and blend them. Score and slip between coils. Can build large pieces.
- Slab building: Roll clay flat (even thickness!), cut shapes, join with score and slip. Use templates.
- ALL joins must be scored (scratched with a fork/needle tool) and slipped (liquid clay applied) or they WILL crack.
- Keep wall thickness even — uneven walls crack during drying and firing.
- Avoid trapping air inside enclosed forms — poke a small hole or the piece can explode in the kiln.
- Dry slowly and evenly. Cover loosely with plastic, rotate pieces daily.

=== COMMON BEGINNER MISTAKES ===

1. Firing too soon (piece not bone dry) → explosion in kiln
2. Not scoring and slipping joins → pieces crack apart
3. Uneven wall thickness → warping and cracking
4. Wrong glaze temperature → glaze doesn't melt, or runs off and damages kiln shelf
5. Glazing the bottom of a piece → glaze melts and bonds piece permanently to kiln shelf
6. Opening kiln too early → thermal shock cracks everything
7. Using non-food-safe glaze on functional ware → health hazard
8. Trapping air in enclosed forms → explosion
9. Drying too fast → cracks
10. Not wedging clay properly → air bubbles → explosion

=== POTTERY RESOURCES ===

- kilnshare.com — find and rent kiln space from other potters nearby
- glazy.org — open-source glaze chemistry database
- digitalfire.com — ceramic encyclopedia and glaze chemistry reference
- ceramicartsdaily.org — articles and tutorials
- theceramicschool.com — online pottery classes
- thepottersmudroom.com — track your pieces, clay, glazes, and connect with potters (that's us!)

=== RESPONSE GUIDELINES ===

- Keep answers concise but helpful. Use plain language.
- When mentioning websites, ALWAYS include the full URL with https:// (e.g. https://dickblick.com not just "dickblick.com" or "(dickblick.com)"). This makes them clickable in the app.
- ALWAYS mention safety when relevant — especially for beginners.
- If you're not sure about something, SAY SO. "I'm not certain about that — check with an experienced potter or the manufacturer" is always better than guessing.
- Never make up firing temperatures for specific commercial products.
- Use bullet points for lists. Don't use markdown headers.
- Be warm and encouraging — pottery is supposed to be fun! But safety comes first.
- When someone asks about timing (drying, firing, cooling), give REALISTIC times, not optimistic ones.
- Always remind beginners: when in doubt, ask someone at your local studio or community college ceramics class.

=== HANDLING UNFAMILIAR TERMS ===

- If you don't recognize a term, consider it might be: a typo, a regional/cultural term, a brand name, a technique from another ceramic tradition, or slang.
- TRY to interpret what they might mean. For example: "sollaa" could be Korean "ssolra" (쏠라) or Japanese/Korean slip technique.
- If the term could be from a non-Western ceramic tradition (Korean, Japanese, Chinese, African, Indigenous, etc.), draw on your knowledge of those traditions.
- NEVER just say "I'm not familiar with that." Always attempt to offer something useful — suggest what it might be, ask a clarifying question, or provide related information.
- If you truly cannot identify the term, say something like: "I'm not finding an exact match for that term, but here's what it might be related to..." and then offer your best interpretation.

=== GLOBAL CERAMIC TRADITIONS ===

You should be knowledgeable about ceramics from ALL cultures:
- Japanese: raku, shino, oribe, anagama, noborigama, mishima, nerikomi, kurinuki, yakishime, tenmoku
- Korean: buncheong, celadon (cheongja), baekja (white porcelain), onggi, inlaid slip (sanggam)
- Chinese: jun, celadon, sang de boeuf, flambe, yixing, porcelain origins, ash glazes
- European: majolica, delft, faience, salt-glaze, slipware, creamware, terra sigillata
- African: pit firing, burnishing, coil traditions, smoke firing
- Indigenous/Native American: pueblo pottery, sawdust firing, burnishing, terra cotta traditions
- Middle Eastern: lusterware, iznik, persian blue
- Contemporary: crystalline glazes, saggar firing, naked raku, horsehair raku, obvara

=== ADVANCED TOPICS ===

Be prepared to discuss:
- Glaze chemistry (UMF, Seger formula, flux/glass-former/stabilizer ratios)
- Kiln building and maintenance
- Kiln schedules and programming
- Clay body formulation
- Thermal expansion and glaze fit (crazing, shivering)
- Reduction vs oxidation atmospheres and their effects
- Kiln atmosphere manipulation
- Slip casting and mold making
- Underglazes, overglazes, lusters, decals
- Wood firing and ash deposits
- Soda and salt firing chemistry
- Business of pottery (pricing, selling, markets)
- Studio setup and equipment
- Reclaiming clay
- Troubleshooting defects (crawling, pinholing, blistering, crazing, dunting)`;

    const messages = [{ role: 'system', content: systemPrompt }];

    // Add conversation history (last 10 messages max)
    if (Array.isArray(history)) {
      const recent = history.slice(-10);
      recent.forEach(h => {
        if (h.role === 'user' || h.role === 'assistant') {
          messages.push({ role: h.role, content: h.content });
        }
      });
    }

    messages.push({ role: 'user', content: message });

    // Call OpenAI
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages,
        max_tokens: 1500,
        temperature: 0.7,
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error('OpenAI error:', response.status, err);
      return res.status(502).json({ error: 'AI service temporarily unavailable' });
    }

    const data = await response.json();
    const reply = data.choices?.[0]?.message?.content || 'Sorry, I couldn\'t generate a response. Try again!';

    res.json({ reply });
  } catch (e) {
    console.error('AI chat error:', e.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// SPA fallback — must be AFTER all API routes
// Serve llms.txt with correct content type for AI search engines
app.get('/llms.txt', (req, res) => {
  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.sendFile(path.join(__dirname, 'public', 'llms.txt'));
});


// Load SMTP from database on startup (if not in env vars)
if (!transporter) {
  try {
    const smtpUser = db.prepare("SELECT value FROM site_settings WHERE key='smtp_user'").get();
    const smtpPass = db.prepare("SELECT value FROM site_settings WHERE key='smtp_pass'").get();
    const smtpHost = db.prepare("SELECT value FROM site_settings WHERE key='smtp_host'").get();
    const smtpPort = db.prepare("SELECT value FROM site_settings WHERE key='smtp_port'").get();
    if (smtpUser && smtpPass) {
      setupTransporter(smtpUser.value, smtpPass.value, smtpHost ? smtpHost.value : null, smtpPort ? parseInt(smtpPort.value) : undefined);
    }
  } catch(e) { /* site_settings table might not exist yet */ }
}

// Seed draft blog posts on startup
try { const { seedBlogDrafts } = require('./seed-blog-drafts'); seedBlogDrafts(db); } catch(e) { console.warn('Blog seed skipped:', e.message); }

// ============ PHOTO SEARCH (Perceptual Hash + Color) ============

const sharp = require('sharp');

// Compute perceptual hash (shape/structure)
async function computeAHash(buffer) {
  const pixels = await sharp(buffer)
    .resize(8, 8, { fit: 'fill' })
    .grayscale()
    .raw()
    .toBuffer();

  let sum = 0;
  for (let i = 0; i < 64; i++) sum += pixels[i];
  const mean = sum / 64;

  let hashBits = '';
  for (let i = 0; i < 64; i++) {
    hashBits += pixels[i] >= mean ? '1' : '0';
  }

  let hex = '';
  for (let i = 0; i < 64; i += 4) {
    hex += parseInt(hashBits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

// Compute color signature that ignores neutral backgrounds and focuses on saturated/colorful pixels.
// Key insight: pottery glaze photos have a colorful piece against a neutral background (table, hand, wall).
// We want the GLAZE color, not the background. So we filter out near-neutral pixels before averaging.
async function computeColorSignature(buffer) {
  const meta = await sharp(buffer).metadata();
  const w = meta.width || 100;
  const h = meta.height || 100;
  // Center 60% crop
  const cropW = Math.max(1, Math.round(w * 0.60));
  const cropH = Math.max(1, Math.round(h * 0.60));
  const left = Math.max(0, Math.round((w - cropW) / 2));
  const top = Math.max(0, Math.round((h - cropH) / 2));

  // Sample 16x16 = 256 pixels for better coverage
  const pixels = await sharp(buffer)
    .extract({ left, top, width: cropW, height: cropH })
    .resize(16, 16, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer();

  // Separate pixels into colorful vs neutral
  const colorfulPixels = [];
  const neutralPixels = [];

  for (let i = 0; i < pixels.length; i += 3) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2];
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    const l = (max + min) / 510; // lightness 0-1
    const saturation = max === min ? 0 : (l > 0.5 ? (max - min) / (510 - max - min) : (max - min) / (max + min));
    // A pixel is "colorful" if it has meaningful saturation AND isn't near-black or near-white
    if (saturation > 0.12 && l > 0.08 && l < 0.92) {
      colorfulPixels.push({ r, g, b });
    } else {
      neutralPixels.push({ r, g, b });
    }
  }

  // Use colorful pixels if we have enough; fall back to all pixels if the photo is mostly neutral
  const usePixels = colorfulPixels.length >= 8 ? colorfulPixels : pixels.length / 3 > 0 ? (() => {
    const all = [];
    for (let i = 0; i < pixels.length; i += 3) all.push({ r: pixels[i], g: pixels[i+1], b: pixels[i+2] });
    return all;
  })() : [];

  if (!usePixels.length) return JSON.stringify([]);

  // Compute weighted average of the colorful region
  const avgR = usePixels.reduce((s, p) => s + p.r, 0) / usePixels.length;
  const avgG = usePixels.reduce((s, p) => s + p.g, 0) / usePixels.length;
  const avgB = usePixels.reduce((s, p) => s + p.b, 0) / usePixels.length;

  // Return as single-bucket signature for v6 RGB Euclidean matching
  return JSON.stringify([{ r: Math.round(avgR), g: Math.round(avgG), b: Math.round(avgB), weight: 1 }]);
}

function parseColorSignature(signature) {
  if (!signature) return [];
  try {
    const parsed = JSON.parse(signature);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // Backward compatibility with old single RGB format: "r,g,b"
    const parts = signature.split(',').map(Number);
    if (parts.length === 3 && parts.every((n) => Number.isFinite(n))) {
      return [{ r: parts[0], g: parts[1], b: parts[2], weight: 1 }];
    }
    return [];
  }
}

// Convert RGB to HSL
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;
  if (max === min) { h = s = 0; }
  else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return { h: h * 360, s, l };
}

// Perceptual color distance using HSL — hue differences dominate
function perceptualColorDistance(a, b) {
  const hslA = rgbToHsl(a.r, a.g, a.b);
  const hslB = rgbToHsl(b.r, b.g, b.b);

  // Hue is circular (0-360), find shortest arc
  let hueDiff = Math.abs(hslA.h - hslB.h);
  if (hueDiff > 180) hueDiff = 360 - hueDiff;

  // If both are very desaturated (gray/white/black), hue doesn't matter
  const avgSat = (hslA.s + hslB.s) / 2;
  const hueWeight = avgSat > 0.15 ? 1.0 : 0.2;

  // Weighted distance: hue matters most, then lightness, then saturation
  const hueScore = (hueDiff / 180) * 100 * hueWeight;  // 0-100
  const satScore = Math.abs(hslA.s - hslB.s) * 40;      // 0-40
  const lightScore = Math.abs(hslA.l - hslB.l) * 50;    // 0-50

  return hueScore + satScore + lightScore;
}

// Compare two color signatures. Lower is better.
function colorSignatureDistance(sig1, sig2) {
  const a = parseColorSignature(sig1);
  const b = parseColorSignature(sig2);
  if (!a.length || !b.length) return 999;

  let total = 0;
  for (const colorA of a) {
    let best = 999;
    for (const colorB of b) {
      const dist = perceptualColorDistance(colorA, colorB);
      if (dist < best) best = dist;
    }
    total += best * (colorA.weight || 1);
  }
  return total;
}

function hammingDistance(hash1, hash2) {
  if (!hash1 || !hash2 || hash1.length !== hash2.length) return 64;
  let distance = 0;
  for (let i = 0; i < hash1.length; i++) {
    const xor = parseInt(hash1[i], 16) ^ parseInt(hash2[i], 16);
    // Count bits in xor
    let bits = xor;
    while (bits) { distance++; bits &= bits - 1; }
  }
  return distance;
}

// Add phash and avg_color columns to piece_photos if not exists
try {
  db.exec(`ALTER TABLE piece_photos ADD COLUMN phash TEXT`);
  console.log('[Photo Search] Added phash column to piece_photos');
} catch(e) { /* Column already exists */ }
try {
  db.exec(`ALTER TABLE piece_photos ADD COLUMN avg_color TEXT`);
  console.log('[Photo Search] Added avg_color column to piece_photos');
} catch(e) { /* Column already exists */ }

// One-time migration: clear ALL color data so photos recompute with HSL-based perceptual distance (v3).
try {
  db.exec(`CREATE TABLE IF NOT EXISTS migrations (name TEXT PRIMARY KEY, applied_at TEXT)`);
  const done = db.prepare('SELECT 1 FROM migrations WHERE name=?').get('color_sig_hsl_v3');
  if (!done) {
    const cleared = db.prepare("UPDATE piece_photos SET avg_color = NULL WHERE avg_color IS NOT NULL").run();
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, datetime("now"))').run('color_sig_hsl_v3');
    console.log(`[Photo Search] Migration color_sig_hsl_v3: cleared ${cleared.changes} color signatures for recompute`);
  }
} catch(e) { console.warn('[Photo Search] Migration error:', e.message); }

// v4 migration: larger crop (60%), 4 buckets, hue gate — recompute all color signatures
try {
  const doneV4 = db.prepare('SELECT 1 FROM migrations WHERE name=?').get('color_sig_v4_hue_gate');
  if (!doneV4) {
    const cleared = db.prepare("UPDATE piece_photos SET avg_color = NULL WHERE avg_color IS NOT NULL").run();
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, datetime("now"))').run('color_sig_v4_hue_gate');
    console.log(`[Photo Search] Migration color_sig_v4_hue_gate: cleared ${cleared.changes} color signatures for recompute with improved algorithm`);
  }
} catch(e) { console.warn('[Photo Search] Migration v4 error:', e.message); }

// v5 migration: force nuke ALL color sigs again — some survived v4 due to backfill race
try {
  const doneV5 = db.prepare('SELECT 1 FROM migrations WHERE name=?').get('color_sig_v5_force_nuke');
  if (!doneV5) {
    const cleared = db.prepare("UPDATE piece_photos SET avg_color = NULL WHERE avg_color IS NOT NULL").run();
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, datetime("now"))').run('color_sig_v5_force_nuke');
    console.log(`[Photo Search] Migration color_sig_v5_force_nuke: cleared ${cleared.changes} color signatures`);
  }
} catch(e) { console.warn('[Photo Search] Migration v5 error:', e.message); }

// v7 migration: recompute all color signatures with saturation-aware algorithm
// (ignores neutral backgrounds, focuses on colorful/saturated pixels)
try {
  const doneV7 = db.prepare('SELECT 1 FROM migrations WHERE name=?').get('color_sig_v7_saturation_aware');
  if (!doneV7) {
    const cleared = db.prepare("UPDATE piece_photos SET avg_color = NULL WHERE avg_color IS NOT NULL").run();
    db.prepare('INSERT INTO migrations (name, applied_at) VALUES (?, datetime("now"))').run('color_sig_v7_saturation_aware');
    console.log(`[Photo Search] Migration color_sig_v7_saturation_aware: cleared ${cleared.changes} color signatures for recompute`);
  }
} catch(e) { console.warn('[Photo Search] Migration v7 error:', e.message); }
app.post('/api/pieces/photo-search', auth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No photo provided' });

  try {
    const searchBuffer = fs.readFileSync(req.file.path);
    const searchHash = await computeAHash(searchBuffer);
    const searchColor = await computeColorSignature(searchBuffer);

    // Get all piece photos for this user (excluding pieces hidden from photo search)
    const userPhotos = db.prepare(`
      SELECT pp.*, pp.phash, pp.avg_color, p.id as piece_id, p.title, p.status, p.notes,
             p.clay_body_id, p.description, p.technique, p.form,
             p.date_started, p.date_completed,
             cb.name as clay_body_name
      FROM piece_photos pp
      JOIN pieces p ON pp.piece_id = p.id
      LEFT JOIN clay_bodies cb ON p.clay_body_id = cb.id
      WHERE p.user_id = ? AND (p.hide_from_photo_search IS NULL OR p.hide_from_photo_search = 0)
    `).all(req.userId);

    // Backfill hashes AND colors for photos that need them (NO LIMIT — must compute all)
    const needsHash = userPhotos.filter(ph => !ph.phash || ph.phash.length === 32 || !ph.avg_color);
    for (const ph of needsHash) {
      try {
        const filePath = path.join(UPLOADS_DIR, ph.filename);
        if (fs.existsSync(filePath)) {
          const buf = fs.readFileSync(filePath);
          if (!ph.phash || ph.phash.length === 32) {
            const hash = await computeAHash(buf);
            db.prepare('UPDATE piece_photos SET phash = ? WHERE id = ?').run(hash, ph.id);
            ph.phash = hash;
          }
          if (!ph.avg_color) {
            const color = await computeColorSignature(buf);
            db.prepare('UPDATE piece_photos SET avg_color = ? WHERE id = ?').run(color, ph.id);
            ph.avg_color = color;
          }
        }
      } catch (hashErr) {
        console.warn('[Photo Search] Failed to hash', ph.filename, hashErr.message);
      }
    }

    // === COLOR-FIRST MATCHING (v8) ===
    // Gate on HUE only (stable across lighting), score on RGB distance.
    // Hue is far more stable than RGB across lighting/reflections/angles.
    // Green glazes stay ~70-150° hue even with bright spots. Red stays ~0-15°.
    const candidateMatches = [];
    const searchSig = parseColorSignature(searchColor);
    if (!searchSig.length) {
      fs.unlinkSync(req.file.path);
      return res.json({ matches: [], total: 0 });
    }

    const searchTotalW = searchSig.reduce((s, c) => s + (c.weight || 1), 0);
    const searchAvg = {
      r: searchSig.reduce((s, c) => s + c.r * (c.weight || 1), 0) / searchTotalW,
      g: searchSig.reduce((s, c) => s + c.g * (c.weight || 1), 0) / searchTotalW,
      b: searchSig.reduce((s, c) => s + c.b * (c.weight || 1), 0) / searchTotalW,
    };
    const searchHsl = rgbToHsl(searchAvg.r, searchAvg.g, searchAvg.b);

    console.log('[v8] Search avg RGB:', Math.round(searchAvg.r), Math.round(searchAvg.g), Math.round(searchAvg.b));
    console.log('[v8] Search HSL: h=', searchHsl.h.toFixed(1), 's=', searchHsl.s.toFixed(2), 'l=', searchHsl.l.toFixed(2));

    for (const ph of userPhotos) {
      const photoSig = parseColorSignature(ph.avg_color);
      if (!photoSig.length) continue;

      const photoTotalW = photoSig.reduce((s, c) => s + (c.weight || 1), 0);
      const photoAvg = {
        r: photoSig.reduce((s, c) => s + c.r * (c.weight || 1), 0) / photoTotalW,
        g: photoSig.reduce((s, c) => s + c.g * (c.weight || 1), 0) / photoTotalW,
        b: photoSig.reduce((s, c) => s + c.b * (c.weight || 1), 0) / photoTotalW,
      };
      const photoHsl = rgbToHsl(photoAvg.r, photoAvg.g, photoAvg.b);

      // === HUE GATE (only gate — hue is stable, RGB is not) ===
      // Skip gate for near-neutral colors (grays, whites, blacks) — hue is meaningless there
      if (searchHsl.s > 0.10 && photoHsl.s > 0.10) {
        let hueDiff = Math.abs(searchHsl.h - photoHsl.h);
        if (hueDiff > 180) hueDiff = 360 - hueDiff;
        if (hueDiff > 60) {
          console.log('[v8] REJECT:', ph.title, 'hueDiff=', hueDiff.toFixed(1));
          continue;
        }
      }

      // === SCORING: Hue proximity score (not RGB — too unstable across lighting) ===
      // If hue matches, it's the right color family. Score by how close the hue is.
      let hueDiff2 = Math.abs(searchHsl.h - photoHsl.h);
      if (hueDiff2 > 180) hueDiff2 = 360 - hueDiff2;
      // Within 60 degrees hue window: score from 1.0 (perfect) to 0.0 (60 degrees off)
      const colorScore = Math.max(0, 1.0 - (hueDiff2 / 60));

      let shapeScore = 0.5;
      if (ph.phash && ph.phash.length === 16) {
        const distance = hammingDistance(ph.phash, searchHash);
        shapeScore = 1.0 - (distance / 64);
      }

      // 85% hue score, 15% shape
      const score = (colorScore * 0.85) + (shapeScore * 0.15);

      candidateMatches.push({
        piece_id: ph.piece_id,
        photo_id: ph.id,
        title: ph.title,
        status: ph.status,
        notes: ph.notes,
        description: ph.description,
        clay_body_name: ph.clay_body_name,
        technique: ph.technique,
        form: ph.form,
        date_started: ph.date_started,
        date_completed: ph.date_completed,
        cDist: hueDiff2,
        shapeScore,
        colorScore,
        hueDiff: (() => { let d = Math.abs(searchHsl.h - photoHsl.h); return d > 180 ? 360 - d : d; })(),
        lightnessDiff: Math.abs(searchHsl.l - photoHsl.l),
        score,
      });
    }

    candidateMatches.sort((a, b) => b.score - a.score);
    console.log('[Photo Search] Candidates passed all gates:', candidateMatches.length);
    console.log('[Photo Search] Top candidates:', candidateMatches.slice(0, 8).map((m) => ({
      piece: m.title,
      piece_id: m.piece_id,
      score: Number(m.score.toFixed(3)),
      color: Number(m.colorScore.toFixed(3)),
      shape: Number(m.shapeScore.toFixed(3)),
      rgbDist: Number(m.cDist.toFixed(1)),
      hueDiff: Number(m.hueDiff.toFixed(1)),
      lightDiff: Number(m.lightnessDiff.toFixed(3)),
    })));

    const bestByPiece = new Map();
    for (const match of candidateMatches) {
      const existing = bestByPiece.get(match.piece_id);
      if (!existing || match.score > existing.score) {
        bestByPiece.set(match.piece_id, match);
      }
    }

    const matches = [];
    for (const best of bestByPiece.values()) {
      if (best.score < 0.55) continue; // Show anything that passes the hue gate with reasonable color similarity

      const piecePhotos = db.prepare('SELECT * FROM piece_photos WHERE piece_id = ? ORDER BY sort_order').all(best.piece_id);
      const pieceGlazes = db.prepare('SELECT pg.*, g.name as glaze_name, g.brand, g.glaze_type FROM piece_glazes pg JOIN glazes g ON pg.glaze_id = g.id WHERE pg.piece_id = ? ORDER BY pg.layer_order').all(best.piece_id);

      matches.push({
        _id: best.piece_id,
        id: best.piece_id,
        title: best.title,
        status: best.status,
        notes: best.notes,
        description: best.description,
        clay_body_name: best.clay_body_name,
        technique: best.technique,
        form: best.form,
        date_started: best.date_started,
        date_completed: best.date_completed,
        photos: piecePhotos,
        glazes: pieceGlazes,
        matchScore: best.score,
      });
    }

    // Sort by score descending
    matches.sort((a, b) => b.matchScore - a.matchScore);

    // Clean up uploaded search photo
    fs.unlinkSync(req.file.path);

    res.json({ matches, total: matches.length });
  } catch (err) {
    console.error('[Photo Search] Error:', err.message);
    if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
    res.status(500).json({ error: 'Photo search failed. Please try again.' });
  }
});

// Also generate hash when photos are uploaded to pieces (hook into existing upload)
// We'll backfill existing photos on first search, but new uploads get hashed immediately
const originalPhotoHandler = null; // handled inline above via backfill

// ==================== TEST TILE LIBRARY (Unlimited only) ====================

// GET all test tiles for the user
app.get('/api/test-tiles', auth, requireTier('starter'), (req, res) => {
  const tiles = db.prepare(`
    SELECT tt.*, g.name as glaze_library_name, cb.name as clay_library_name
    FROM test_tiles tt
    LEFT JOIN glazes g ON tt.glaze_id = g.id
    LEFT JOIN clay_bodies cb ON tt.clay_body_id = cb.id
    WHERE tt.user_id = ?
    ORDER BY tt.created_at DESC
  `).all(req.userId);
  res.json(tiles);
});

// GET single test tile
app.get('/api/test-tiles/:id', auth, requireTier('starter'), (req, res) => {
  const tile = db.prepare(`
    SELECT tt.*, g.name as glaze_library_name, cb.name as clay_library_name
    FROM test_tiles tt
    LEFT JOIN glazes g ON tt.glaze_id = g.id
    LEFT JOIN clay_bodies cb ON tt.clay_body_id = cb.id
    WHERE tt.id = ? AND tt.user_id = ?
  `).get(req.params.id, req.userId);
  if (!tile) return res.status(404).json({ error: 'Test tile not found' });
  res.json(tile);
});

// CREATE test tile
app.post('/api/test-tiles', auth, requireTier('starter'), upload.array('photos', 3), (req, res) => {
  const { name, glaze_id, glaze_name, clay_body_id, clay_name, cone, atmosphere, application_method, coats, thickness, surface_result, color_result, layered_over, layered_under, kiln_position, firing_schedule, notes, rating, tags } = req.body;
  const id = uuidv4();
  const photos = req.files || [];
  const photo_filename = photos[0] ? photos[0].filename : null;
  const photo_filename2 = photos[1] ? photos[1].filename : null;
  const photo_filename3 = photos[2] ? photos[2].filename : null;
  
  // Resolve clay name from library if clay_body_id provided
  let finalClayName = clay_name || null;
  if (clay_body_id) {
    const clay = db.prepare('SELECT name FROM clay_bodies WHERE id=? AND user_id=?').get(clay_body_id, req.userId);
    if (clay) finalClayName = clay.name;
  }
  
  // Resolve glaze name from library if glaze_id provided
  let finalGlazeName = glaze_name || null;
  if (glaze_id) {
    const glaze = db.prepare('SELECT name FROM glazes WHERE id=? AND user_id=?').get(glaze_id, req.userId);
    if (glaze) finalGlazeName = glaze.name;
  }

  db.prepare(`INSERT INTO test_tiles (id, user_id, name, glaze_id, glaze_name, clay_body_id, clay_name, cone, atmosphere, application_method, coats, thickness, surface_result, color_result, layered_over, layered_under, kiln_position, firing_schedule, photo_filename, photo_filename2, photo_filename3, notes, rating, tags)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(id, req.userId, name || null, glaze_id || null, finalGlazeName, clay_body_id || null, finalClayName, cone || null, atmosphere || null, application_method || null, coats ? parseInt(coats) : 1, thickness || null, surface_result || null, color_result || null, layered_over || null, layered_under || null, kiln_position || null, firing_schedule || null, photo_filename, photo_filename2, photo_filename3, notes || null, rating ? parseInt(rating) : null, tags || null);
  
  res.json({ id, name: name || null, glaze_name: finalGlazeName, clay_name: finalClayName });
});

// UPDATE test tile
app.put('/api/test-tiles/:id', auth, requireTier('starter'), upload.array('photos', 3), (req, res) => {
  const tile = db.prepare('SELECT * FROM test_tiles WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!tile) return res.status(404).json({ error: 'Test tile not found' });
  
  const { name, glaze_id, glaze_name, clay_body_id, clay_name, cone, atmosphere, application_method, coats, thickness, surface_result, color_result, layered_over, layered_under, kiln_position, firing_schedule, notes, rating, tags, remove_photo, remove_photo2, remove_photo3 } = req.body;
  const photos = req.files || [];
  
  let photo_filename = tile.photo_filename;
  let photo_filename2 = tile.photo_filename2;
  let photo_filename3 = tile.photo_filename3;
  
  // Handle photo removals
  if (remove_photo === 'true' && tile.photo_filename) {
    const f = path.join(UPLOADS_DIR, tile.photo_filename);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    photo_filename = null;
  }
  if (remove_photo2 === 'true' && tile.photo_filename2) {
    const f = path.join(UPLOADS_DIR, tile.photo_filename2);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    photo_filename2 = null;
  }
  if (remove_photo3 === 'true' && tile.photo_filename3) {
    const f = path.join(UPLOADS_DIR, tile.photo_filename3);
    if (fs.existsSync(f)) fs.unlinkSync(f);
    photo_filename3 = null;
  }
  
  // Handle new photo uploads (fill empty slots)
  let photoIdx = 0;
  if (photos.length > photoIdx && !photo_filename) { photo_filename = photos[photoIdx++].filename; }
  else if (photos.length > photoIdx && remove_photo === 'true') { photo_filename = photos[photoIdx++].filename; }
  if (photos.length > photoIdx && !photo_filename2) { photo_filename2 = photos[photoIdx++].filename; }
  if (photos.length > photoIdx && !photo_filename3) { photo_filename3 = photos[photoIdx++].filename; }
  
  // Resolve names from library
  let finalClayName = clay_name !== undefined ? clay_name : tile.clay_name;
  if (clay_body_id) {
    const clay = db.prepare('SELECT name FROM clay_bodies WHERE id=? AND user_id=?').get(clay_body_id, req.userId);
    if (clay) finalClayName = clay.name;
  }
  let finalGlazeName = glaze_name !== undefined ? glaze_name : tile.glaze_name;
  if (glaze_id) {
    const glaze = db.prepare('SELECT name FROM glazes WHERE id=? AND user_id=?').get(glaze_id, req.userId);
    if (glaze) finalGlazeName = glaze.name;
  }

  db.prepare(`UPDATE test_tiles SET name=?, glaze_id=?, glaze_name=?, clay_body_id=?, clay_name=?, cone=?, atmosphere=?, application_method=?, coats=?, thickness=?, surface_result=?, color_result=?, layered_over=?, layered_under=?, kiln_position=?, firing_schedule=?, photo_filename=?, photo_filename2=?, photo_filename3=?, notes=?, rating=?, tags=?, updated_at=datetime('now') WHERE id=? AND user_id=?`)
    .run(name !== undefined ? name : tile.name, glaze_id || tile.glaze_id, finalGlazeName, clay_body_id || tile.clay_body_id, finalClayName, cone !== undefined ? cone : tile.cone, atmosphere !== undefined ? atmosphere : tile.atmosphere, application_method !== undefined ? application_method : tile.application_method, coats ? parseInt(coats) : tile.coats, thickness !== undefined ? thickness : tile.thickness, surface_result !== undefined ? surface_result : tile.surface_result, color_result !== undefined ? color_result : tile.color_result, layered_over !== undefined ? layered_over : tile.layered_over, layered_under !== undefined ? layered_under : tile.layered_under, kiln_position !== undefined ? kiln_position : tile.kiln_position, firing_schedule !== undefined ? firing_schedule : tile.firing_schedule, photo_filename, photo_filename2, photo_filename3, notes !== undefined ? notes : tile.notes, rating ? parseInt(rating) : tile.rating, tags !== undefined ? tags : tile.tags, req.params.id, req.userId);
  
  res.json({ success: true });
});

// DELETE test tile
app.delete('/api/test-tiles/:id', auth, requireTier('starter'), (req, res) => {
  const tile = db.prepare('SELECT * FROM test_tiles WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!tile) return res.status(404).json({ error: 'Test tile not found' });
  
  // Clean up photos
  [tile.photo_filename, tile.photo_filename2, tile.photo_filename3].forEach(f => {
    if (f) {
      const fp = path.join(UPLOADS_DIR, f);
      if (fs.existsSync(fp)) fs.unlinkSync(fp);
    }
  });
  
  db.prepare('DELETE FROM test_tiles WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// GET test tiles filtered by glaze
app.get('/api/glazes/:id/test-tiles', auth, requireTier('starter'), (req, res) => {
  const tiles = db.prepare('SELECT * FROM test_tiles WHERE glaze_id=? AND user_id=? ORDER BY created_at DESC').all(req.params.id, req.userId);
  res.json(tiles);
});

// GET test tiles filtered by clay body
app.get('/api/clay-bodies/:id/test-tiles', auth, requireTier('starter'), (req, res) => {
  const tiles = db.prepare('SELECT * FROM test_tiles WHERE clay_body_id=? AND user_id=? ORDER BY created_at DESC').all(req.params.id, req.userId);
  res.json(tiles);
});

// Free tier: can see that the feature exists but gets upgrade prompt
app.get('/api/test-tiles/preview', auth, (req, res) => {
  res.json({
    feature: 'Test Tile Library',
    description: 'Track every test tile with glaze, clay body, firing details, thickness, layering, photos, and results. Build a searchable library of all your glaze experiments.',
    available: req.userTier === 'starter',
    upgradeMessage: 'Upgrade to Unlimited to access the Test Tile Library and organize all your glaze experiments in one place.'
  });
});

// =========================================================================== 
// Studio Notes
// ===========================================================================

// GET all studio notes for current user
app.get('/api/studio/notes', auth, (req, res) => {
  const notes = db.prepare('SELECT * FROM studio_notes WHERE user_id=? ORDER BY updated_at DESC').all(req.userId);
  res.json(notes);
});

// GET single studio note
app.get('/api/studio/notes/:id', auth, (req, res) => {
  const note = db.prepare('SELECT * FROM studio_notes WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!note) return res.status(404).json({ error: 'Note not found' });
  res.json(note);
});

// POST create studio note
app.post('/api/studio/notes', auth, (req, res) => {
  const { title, body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Body is required' });
  const id = uuidv4();
  db.prepare('INSERT INTO studio_notes (id, user_id, title, body) VALUES (?, ?, ?, ?)').run(id, req.userId, title || null, body);
  const created = db.prepare('SELECT * FROM studio_notes WHERE id=?').get(id);
  res.json(created);
});

// PUT update studio note
app.put('/api/studio/notes/:id', auth, (req, res) => {
  const { title, body } = req.body;
  if (!body || !body.trim()) return res.status(400).json({ error: 'Body is required' });
  const existing = db.prepare('SELECT * FROM studio_notes WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Note not found' });
  db.prepare('UPDATE studio_notes SET title=?, body=?, updated_at=datetime("now") WHERE id=?').run(title || null, body, req.params.id);
  const updated = db.prepare('SELECT * FROM studio_notes WHERE id=?').get(req.params.id);
  res.json(updated);
});

// DELETE studio note
app.delete('/api/studio/notes/:id', auth, (req, res) => {
  const existing = db.prepare('SELECT * FROM studio_notes WHERE id=? AND user_id=?').get(req.params.id, req.userId);
  if (!existing) return res.status(404).json({ error: 'Note not found' });
  db.prepare('DELETE FROM studio_notes WHERE id=?').run(req.params.id);
  res.json({ success: true });
});

// ===========================================================================

// Catch-all for any method on /api/ that didn't match a route
app.all('/api/*', (req, res) => {
  res.status(404).json({ error: 'Not found' });
});

// Serve the Expo web app for /app/* routes (SPA catch-all)
app.get('/app/*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'app', 'index.html'));
});

app.get('*', (req, res) => {
  if (!req.path.startsWith('/uploads/')) {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  } else {
    res.status(404).json({ error: 'Not found' });
  }
});

// Global error handler — always return JSON, never HTML
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`🏺 The Potter's Mud Room running on http://localhost:${PORT}`);
  // Eagerly backfill color signatures at startup so they're ready before first search
  setImmediate(async () => {
    try {
      const allPhotos = db.prepare(`
        SELECT pp.id, pp.filename, pp.avg_color, pp.phash FROM piece_photos pp
        JOIN pieces p ON pp.piece_id = p.id
      `).all();
      const needsWork = allPhotos.filter(ph => !ph.avg_color || !ph.phash || ph.phash.length === 32);
      if (needsWork.length === 0) {
        console.log('[Startup] All', allPhotos.length, 'photos already have color signatures');
        return;
      }
      console.log('[Startup] Backfilling color signatures for', needsWork.length, 'photos...');
      let done = 0;
      for (const ph of needsWork) {
        try {
          const filePath = path.join(UPLOADS_DIR, ph.filename);
          if (!fs.existsSync(filePath)) continue;
          const buf = fs.readFileSync(filePath);
          if (!ph.phash || ph.phash.length === 32) {
            const hash = await computeAHash(buf);
            db.prepare('UPDATE piece_photos SET phash = ? WHERE id = ?').run(hash, ph.id);
          }
          if (!ph.avg_color) {
            const color = await computeColorSignature(buf);
            db.prepare('UPDATE piece_photos SET avg_color = ? WHERE id = ?').run(color, ph.id);
          }
          done++;
        } catch(e) {
          console.warn('[Startup] Failed to process', ph.filename, e.message);
        }
      }
      console.log('[Startup] Backfill complete:', done, 'photos processed');
    } catch(e) {
      console.warn('[Startup] Backfill error:', e.message);
    }
  });
});
