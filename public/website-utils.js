(function (root) {
  function normalizeExternalUrl(value) {
    if (value == null || !String(value).trim()) return null;
    let url = String(value).trim();
    if (/^\/\//.test(url)) url = 'https:' + url;
    else if (!/^[a-z][a-z\d+.-]*:/i.test(url)) url = 'https://' + url;
    try {
      const parsed = new URL(url);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname.includes('.') || parsed.username || parsed.password) return null;
      return parsed.href;
    } catch { return null; }
  }
  function moneyCents(value) {
    const match = String(value ?? '').trim().match(/^(\d+)(?:\.(\d{1,2}))?$/);
    if (!match) throw new Error('Enter a valid amount with no more than two decimal places.');
    const cents = Number(match[1]) * 100 + Number((match[2] || '').padEnd(2, '0'));
    if (!Number.isSafeInteger(cents)) throw new Error('Amount is too large.');
    return cents;
  }
  function saleQuantity(value) {
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1) throw new Error('Quantity must be a whole number of at least 1.');
    return number;
  }
  function accountLabel(user) {
    if (!user) return 'Account';
    if (user.isAdmin) return 'Admin';
    if (['starter', 'unlimited', 'basic', 'mid', 'top'].includes(user.tier)) return 'Unlimited';
    return user.tier === 'free' ? 'Free' : 'Account';
  }
  const utils = { normalizeExternalUrl, moneyCents, saleQuantity, accountLabel };
  if (typeof module !== 'undefined' && module.exports) module.exports = utils;
  else root.WebsiteUtils = utils;
})(typeof globalThis !== 'undefined' ? globalThis : this);
