const SPECIAL_GRANDFATHERED_EMAILS = Object.freeze([
  'jgk1020@gmail.com',
  'awhiteman96@gmail.com',
  'christinaworkmanpottery@gmail.com',
]);

const SPECIAL_GRANDFATHERED_EMAIL_SET = new Set(SPECIAL_GRANDFATHERED_EMAILS);
const CANONICAL_BILLING_PERIODS = new Set(['monthly', 'yearly', 'promo']);

function normalizedEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

function isSpecialGrandfatheredEmail(email) {
  return SPECIAL_GRANDFATHERED_EMAIL_SET.has(normalizedEmail(email));
}

function isSpecialGrandfatheredUser(user) {
  return !!user && user.tier === 'starter' && isSpecialGrandfatheredEmail(user.email);
}

function isGrandfatheredPaidUser(user) {
  return !!user
    && user.tier === 'starter'
    && (user.billing_period === 'stripe-monthly' || isSpecialGrandfatheredEmail(user.email));
}

function compatibleBillingPeriod(user) {
  if (!user) return null;
  if (user.billing_period === 'promo') return 'promo';
  if (isSpecialGrandfatheredUser(user)) return 'stripe-monthly';
  return user.billing_period ?? null;
}

function normalizeSpecialAccountBilling(db) {
  const placeholders = SPECIAL_GRANDFATHERED_EMAILS.map(() => '?').join(',');
  return db.prepare(`
    UPDATE users
    SET tier='starter',
        billing_period=CASE
          WHEN billing_period IN ('monthly','yearly','promo') THEN billing_period
          ELSE 'monthly'
        END
    WHERE LOWER(email) IN (${placeholders})
  `).run(...SPECIAL_GRANDFATHERED_EMAILS);
}

module.exports = {
  SPECIAL_GRANDFATHERED_EMAILS,
  CANONICAL_BILLING_PERIODS,
  isSpecialGrandfatheredEmail,
  isSpecialGrandfatheredUser,
  isGrandfatheredPaidUser,
  compatibleBillingPeriod,
  normalizeSpecialAccountBilling,
};
