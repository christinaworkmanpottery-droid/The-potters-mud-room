/**
 * iap.js — Native In-App Purchase logic for The Potter's Mud Room
 *
 * Handles:
 *  - Apple App Store receipt/transaction verification (StoreKit 2 / legacy)
 *  - Google Play purchase token verification
 *  - Entitlement upsert (iap_purchases table + users.iap_* columns)
 *  - Apple App Store Server Notifications V2 (signed JWT)
 *  - Google Play Real-Time Developer Notifications (Pub/Sub)
 *  - Restore purchases
 *
 * Environment variables required:
 *   APPLE_BUNDLE_ID          com.pottersmudroom.app
 *   APPLE_SHARED_SECRET      App-specific shared secret from App Store Connect
 *   GOOGLE_PACKAGE_NAME      com.pottersmudroom.app
 *   GOOGLE_SERVICE_ACCOUNT_JSON  base64-encoded service account JSON key
 */

const https = require('https');
const { v4: uuidv4 } = require('uuid');

// ─── Constants ───────────────────────────────────────────────────────────────

const APPLE_BUNDLE_ID = process.env.APPLE_BUNDLE_ID || 'com.pottersmudroom.app';
const APPLE_SHARED_SECRET = process.env.APPLE_SHARED_SECRET || '';
const GOOGLE_PACKAGE_NAME = process.env.GOOGLE_PACKAGE_NAME || 'com.pottersmudroom.app';

const VALID_PRODUCT_IDS = ['starter_monthly', 'starter_yearly'];

// Apple verification endpoints
const APPLE_PROD_URL = 'https://buy.itunes.apple.com/verifyReceipt';
const APPLE_SANDBOX_URL = 'https://sandbox.itunes.apple.com/verifyReceipt';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Make a JSON POST request and return parsed response.
 */
function httpsPost(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(new Error(`Failed to parse response: ${data}`));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => {
      req.destroy(new Error('Apple verification request timed out'));
    });
    req.write(body);
    req.end();
  });
}

/**
 * Returns true if the user currently has an active IAP entitlement.
 * Checks iap_expires_at column — does NOT check Stripe (that's separate).
 */
function isIAPActive(db, userId) {
  const u = db.prepare('SELECT iap_expires_at FROM users WHERE id=?').get(userId);
  if (!u || !u.iap_expires_at) return false;
  return Math.floor(Date.now() / 1000) < u.iap_expires_at;
}

/**
 * Master entitlement check — returns true if user has premium access from ANY source:
 *   1. Active Stripe subscription (stripe-monthly billing_period = grandfathered users)
 *   2. Active Stripe subscription (tier=starter + plan_expires_at in future)
 *   3. Active native IAP (iap_expires_at in future)
 *   4. Promo / beta tier (billing_period='promo')
 */
function hasPremiumAccess(db, userId) {
  const u = db.prepare(
    'SELECT tier, billing_period, plan_expires_at, iap_expires_at FROM users WHERE id=?'
  ).get(userId);
  if (!u) return false;

  // Promo / beta
  if (u.billing_period === 'promo') return true;

  // Grandfathered Stripe-monthly (the two original subscribers)
  if (u.billing_period === 'stripe-monthly' && u.tier === 'starter') return true;

  // Active Stripe subscription with expiry
  if (u.tier === 'starter' && u.plan_expires_at) {
    const exp = new Date(u.plan_expires_at).getTime();
    if (!isNaN(exp) && exp > Date.now()) return true;
  }

  // Native IAP
  if (u.iap_expires_at && Math.floor(Date.now() / 1000) < u.iap_expires_at) return true;

  return false;
}

/**
 * Upsert an IAP purchase record and update the user's entitlement columns.
 *
 * @param {object} db - better-sqlite3 db instance
 * @param {string} userId
 * @param {string} platform - 'ios' | 'android'
 * @param {object} verified - normalized verification result (see shape below)
 *
 * verified shape:
 * {
 *   productId: string,
 *   transactionId: string,       // originalTransactionId (iOS) or purchaseToken (Android)
 *   purchaseToken: string|null,  // Android purchaseToken (same as transactionId)
 *   expiresAt: number,           // Unix timestamp (seconds)
 *   environment: 'sandbox'|'production',
 *   rawNotification: string,     // JSON.stringify of the raw server payload
 * }
 */
function upsertIAPRecord(db, userId, platform, verified) {
  const now = Math.floor(Date.now() / 1000);

  // Upsert into iap_purchases
  db.prepare(`
    INSERT INTO iap_purchases
      (id, user_id, platform, product_id, transaction_id, purchase_token, expires_at, environment, raw_notification, updated_at)
    VALUES
      (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(transaction_id) DO UPDATE SET
      expires_at = excluded.expires_at,
      environment = excluded.environment,
      raw_notification = excluded.raw_notification,
      updated_at = excluded.updated_at
  `).run(
    uuidv4(),
    userId,
    platform,
    verified.productId,
    verified.transactionId,
    verified.purchaseToken || null,
    verified.expiresAt,
    verified.environment,
    verified.rawNotification || null,
    now
  );

  // Update users table: set tier=starter + iap columns
  // Only update iap_expires_at if this record is newer than what's stored
  const u = db.prepare('SELECT iap_expires_at FROM users WHERE id=?').get(userId);
  if (!u.iap_expires_at || verified.expiresAt > u.iap_expires_at) {
    db.prepare(`
      UPDATE users
      SET tier = 'starter',
          iap_platform = ?,
          iap_transaction_id = ?,
          iap_expires_at = ?,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(platform, verified.transactionId, verified.expiresAt, userId);
  }
}

/**
 * When a subscription expires or is revoked, downgrade the user.
 * Only downgrades if no other active entitlement exists.
 */
function revokeIAPAccess(db, userId, transactionId) {
  // Mark this specific transaction as expired
  db.prepare(`
    UPDATE iap_purchases SET expires_at = ?, updated_at = ?
    WHERE transaction_id = ?
  `).run(Math.floor(Date.now() / 1000) - 1, Math.floor(Date.now() / 1000), transactionId);

  // Check if any other entitlement still active
  if (!hasPremiumAccess(db, userId)) {
    db.prepare(`
      UPDATE users
      SET tier = 'free',
          iap_expires_at = NULL,
          updated_at = datetime('now')
      WHERE id = ?
    `).run(userId);
  }
}

// ─── Apple ───────────────────────────────────────────────────────────────────

/**
 * Verify an Apple receipt (legacy unified receipt) with Apple's servers.
 * Handles the sandbox fallback automatically.
 *
 * Returns a normalized verified object or throws on failure.
 */
async function verifyAppleReceipt(receiptData) {
  if (!APPLE_SHARED_SECRET) {
    throw new Error('APPLE_SHARED_SECRET not configured');
  }

  const payload = {
    'receipt-data': receiptData,
    password: APPLE_SHARED_SECRET,
    'exclude-old-transactions': true,
  };

  // Try production first
  let result = await httpsPost(APPLE_PROD_URL, payload);

  // Status 21007 = receipt is from sandbox — retry against sandbox
  if (result.status === 21007) {
    result = await httpsPost(APPLE_SANDBOX_URL, payload);
  }

  if (result.status !== 0) {
    const msg = APPLE_STATUS_CODES[result.status] || `Apple status ${result.status}`;
    throw new Error(`Apple receipt verification failed: ${msg}`);
  }

  // Find the latest active in-app subscription
  const inApp = result.latest_receipt_info || result.receipt?.in_app || [];
  if (!inApp.length) {
    throw new Error('No in-app purchase records found in receipt');
  }

  // Sort by expires_date_ms descending, pick newest
  const sorted = [...inApp].sort(
    (a, b) => Number(b.expires_date_ms || 0) - Number(a.expires_date_ms || 0)
  );
  const latest = sorted[0];

  const productId = latest.product_id;
  if (!VALID_PRODUCT_IDS.includes(productId)) {
    throw new Error(`Unknown product_id in receipt: ${productId}`);
  }

  const expiresAt = Math.floor(Number(latest.expires_date_ms) / 1000);
  if (!expiresAt || expiresAt <= 0) {
    throw new Error('Could not determine subscription expiry from receipt');
  }

  const isSandbox =
    result.environment === 'Sandbox' ||
    (result.receipt?.receipt_type || '').toLowerCase().includes('sandbox');

  return {
    productId,
    transactionId: latest.original_transaction_id,
    purchaseToken: null,
    expiresAt,
    environment: isSandbox ? 'sandbox' : 'production',
    rawNotification: JSON.stringify(result),
  };
}

/**
 * Parse and process an Apple App Store Server Notification V2.
 *
 * Apple sends a signed JWT (signedPayload). We decode it without verifying
 * the signature here (verification requires fetching Apple's root certs and
 * is an optional hardening step — add jsonwebtoken + apple root cert later).
 *
 * Returns { userId, transactionId, expiresAt, notificationType, productId, environment }
 * or throws if the payload can't be parsed.
 */
function parseAppleNotification(signedPayload) {
  if (!signedPayload) throw new Error('Missing signedPayload');

  // Decode the outer JWT (3 parts: header.payload.sig)
  const parts = signedPayload.split('.');
  if (parts.length !== 3) throw new Error('Invalid JWS format');

  let outerPayload;
  try {
    outerPayload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  } catch (e) {
    throw new Error('Failed to decode outer JWT payload');
  }

  const notificationType = outerPayload.notificationType;
  const subtype = outerPayload.subtype;
  const data = outerPayload.data;

  if (!data?.signedTransactionInfo) {
    throw new Error('Missing signedTransactionInfo in notification');
  }

  // Decode inner transaction JWT
  const txParts = data.signedTransactionInfo.split('.');
  if (txParts.length !== 3) throw new Error('Invalid transaction JWS format');

  let txPayload;
  try {
    txPayload = JSON.parse(Buffer.from(txParts[1], 'base64url').toString('utf8'));
  } catch (e) {
    throw new Error('Failed to decode transaction JWT payload');
  }

  // Decode renewal info JWT if present
  let renewalPayload = null;
  if (data.signedRenewalInfo) {
    try {
      const rParts = data.signedRenewalInfo.split('.');
      renewalPayload = JSON.parse(Buffer.from(rParts[1], 'base64url').toString('utf8'));
    } catch (e) {
      // non-fatal
    }
  }

  const productId = txPayload.productId;
  if (!VALID_PRODUCT_IDS.includes(productId)) {
    throw new Error(`Unknown productId in notification: ${productId}`);
  }

  const transactionId = txPayload.originalTransactionId;
  const expiresAt = txPayload.expiresDate
    ? Math.floor(txPayload.expiresDate / 1000)
    : null;

  const environment = (data.environment || '').toLowerCase() === 'sandbox' ? 'sandbox' : 'production';

  return {
    notificationType,
    subtype,
    productId,
    transactionId,
    expiresAt,
    environment,
    bundleId: txPayload.bundleId,
    appAccountToken: txPayload.appAccountToken, // we set this = userId on purchase
    rawPayload: JSON.stringify(outerPayload),
  };
}

// Apple status code meanings (for error messages)
const APPLE_STATUS_CODES = {
  21000: 'App Store could not read the receipt',
  21002: 'Receipt data was malformed',
  21003: 'Receipt could not be authenticated',
  21004: 'Shared secret does not match',
  21005: 'Receipt server is unavailable',
  21006: 'Receipt is valid but subscription has expired',
  21007: 'Receipt is from sandbox (should retry against sandbox)',
  21008: 'Receipt is from production (should retry against production)',
  21010: 'This receipt could not be authorized',
};

// ─── Google Play ─────────────────────────────────────────────────────────────

/**
 * Lazy-initialize the Google APIs client.
 * We do this lazily so the server starts fine even if GOOGLE_SERVICE_ACCOUNT_JSON
 * isn't set yet (will throw only when a purchase is actually attempted).
 */
let _googleAuth = null;
let _androidPublisher = null;

async function getAndroidPublisher() {
  if (_androidPublisher) return _androidPublisher;

  const serviceAccountJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!serviceAccountJson) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not configured');
  }

  let credentials;
  try {
    // Accept either raw JSON string or base64-encoded JSON
    const raw = Buffer.from(serviceAccountJson, 'base64').toString('utf8');
    credentials = JSON.parse(raw);
  } catch (e) {
    try {
      credentials = JSON.parse(serviceAccountJson);
    } catch (e2) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON or base64-encoded JSON');
    }
  }

  const { google } = require('googleapis');
  _googleAuth = new google.auth.GoogleAuth({
    credentials,
    scopes: ['https://www.googleapis.com/auth/androidpublisher'],
  });

  _androidPublisher = google.androidpublisher({ version: 'v3', auth: _googleAuth });
  return _androidPublisher;
}

/**
 * Verify a Google Play subscription purchase.
 * Calls the Google Play Developer API to get subscription state.
 *
 * Returns a normalized verified object or throws on failure.
 */
async function verifyAndroidPurchase(productId, purchaseToken) {
  if (!VALID_PRODUCT_IDS.includes(productId)) {
    throw new Error(`Unknown productId: ${productId}`);
  }

  const publisher = await getAndroidPublisher();

  const response = await publisher.purchases.subscriptions.get({
    packageName: GOOGLE_PACKAGE_NAME,
    subscriptionId: productId,
    token: purchaseToken,
  });

  const sub = response.data;

  // paymentState: 0=pending, 1=received, 2=free trial, 3=pending deferred upgrade
  if (sub.paymentState === 0) {
    throw new Error('Payment is still pending — subscription not yet active');
  }

  // cancelReason present = cancelled (but may still be within paid period)
  const expiresAtMs = Number(sub.expiryTimeMillis);
  if (!expiresAtMs || expiresAtMs <= 0) {
    throw new Error('Could not determine subscription expiry from Google response');
  }

  const expiresAt = Math.floor(expiresAtMs / 1000);

  // Acknowledge the purchase if not already acknowledged
  // Google requires acknowledgment within 3 days or it refunds automatically
  if (sub.acknowledgementState === 0) {
    try {
      await publisher.purchases.subscriptions.acknowledge({
        packageName: GOOGLE_PACKAGE_NAME,
        subscriptionId: productId,
        token: purchaseToken,
      });
    } catch (ackErr) {
      // Non-fatal — log it but don't fail the verification
      console.error('[IAP] Google acknowledgment failed:', ackErr.message);
    }
  }

  // Determine test vs production
  // purchaseType: 0=normal, 1=test, 2=promo
  const environment = sub.purchaseType === 1 ? 'sandbox' : 'production';

  return {
    productId,
    transactionId: purchaseToken, // Google uses purchaseToken as the stable ID
    purchaseToken,
    expiresAt,
    environment,
    rawNotification: JSON.stringify(sub),
  };
}

/**
 * Parse a Google Play Real-Time Developer Notification (RTDN).
 *
 * Google sends { message: { data: base64, messageId, publishTime }, subscription } via Pub/Sub push.
 * data decodes to a SubscriptionNotification JSON.
 *
 * Returns { notificationType, productId, purchaseToken } or throws.
 */
function parseGoogleNotification(pubsubBody) {
  if (!pubsubBody?.message?.data) {
    throw new Error('Missing Pub/Sub message.data');
  }

  let notification;
  try {
    const decoded = Buffer.from(pubsubBody.message.data, 'base64').toString('utf8');
    notification = JSON.parse(decoded);
  } catch (e) {
    throw new Error('Failed to decode Pub/Sub notification data');
  }

  const sub = notification.subscriptionNotification;
  const test = notification.testNotification;

  if (test) {
    return { notificationType: 'TEST', productId: null, purchaseToken: null };
  }

  if (!sub) {
    throw new Error('No subscriptionNotification in Pub/Sub message');
  }

  return {
    notificationType: GOOGLE_NOTIFICATION_TYPES[sub.notificationType] || String(sub.notificationType),
    productId: sub.subscriptionId,
    purchaseToken: sub.purchaseToken,
    version: sub.version,
    packageName: notification.packageName,
  };
}

// Google RTDN notification type codes
const GOOGLE_NOTIFICATION_TYPES = {
  1: 'SUBSCRIPTION_RECOVERED',
  2: 'SUBSCRIPTION_RENEWED',
  3: 'SUBSCRIPTION_CANCELED',
  4: 'SUBSCRIPTION_PURCHASED',
  5: 'SUBSCRIPTION_ON_HOLD',
  6: 'SUBSCRIPTION_IN_GRACE_PERIOD',
  7: 'SUBSCRIPTION_RESTARTED',
  8: 'SUBSCRIPTION_PRICE_CHANGE_CONFIRMED',
  9: 'SUBSCRIPTION_DEFERRED',
  10: 'SUBSCRIPTION_PAUSED',
  11: 'SUBSCRIPTION_PAUSE_SCHEDULE_CHANGED',
  12: 'SUBSCRIPTION_REVOKED',
  13: 'SUBSCRIPTION_EXPIRED',
};

// ─── Exports ─────────────────────────────────────────────────────────────────

module.exports = {
  isIAPActive,
  hasPremiumAccess,
  upsertIAPRecord,
  revokeIAPAccess,
  verifyAppleReceipt,
  parseAppleNotification,
  verifyAndroidPurchase,
  parseGoogleNotification,
  VALID_PRODUCT_IDS,
};
