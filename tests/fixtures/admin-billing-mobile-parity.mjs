// Shared, dependency-free rules for the Android parity screens.
export function normalizeWebsite(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^[a-z][a-z\d+.-]*:/i.test(text) && !/^https?:\/\//i.test(text)) {
    throw new Error('Use a website address beginning with http:// or https://.');
  }
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (!url.hostname || /\s/.test(text) || url.username || url.password) {
    throw new Error('Please enter a valid website address.');
  }
  return url.href;
}

const flag = value => value === true || value === 1 || value === '1';
export function directorySettings(profile = {}) {
  return {
    city: profile.city || '',
    stateRegion: profile.stateRegion || profile.state_region || '',
    country: profile.country || '',
    findable: flag(profile.findable),
    isPrivate: profile.isPrivate === undefined
      ? profile.is_private === undefined || flag(profile.is_private)
      : flag(profile.isPrivate),
  };
}

export function subscriptionDisplay(subscription, user = {}) {
  if (!subscription) return { label: 'Unavailable', note: 'Could not load your plan. Please retry.', provider: null, isLifetime: false, isFree: false };
  const plan = subscription.plan || 'free';
  const isFree = plan === 'free';
  const expiresAt = subscription.expiresAt || subscription.iapExpiresAt;
  const isLifetime = !isFree && subscription.status === 'active' && subscription.billingPeriod === 'promo' && !expiresAt && !subscription.hasStripeSubscription && !subscription.hasIAPSubscription;
  const provider = subscription.hasIAPSubscription
    ? subscription.iapPlatform === 'android' ? 'google' : subscription.iapPlatform === 'ios' ? 'apple' : null
    : subscription.hasStripeSubscription ? 'stripe' : null;
  const isAdmin = flag(user.isAdmin) || flag(user.is_admin);
  const label = isAdmin ? 'Admin' : isFree ? 'Free' : isLifetime ? 'Lifetime' : 'Unlimited';
  const note = isLifetime ? 'Lifetime access — no billing' : provider === 'google' ? 'Subscription through Google Play' : provider === 'apple' ? 'Subscription through Apple' : expiresAt ? `Access expires ${String(expiresAt).split('T')[0]}` : !isFree && subscription.status !== 'active' ? 'Subscription inactive' : provider === 'stripe' ? 'Subscription through the website' : isFree ? 'Free membership' : 'Account access';
  return { label, note, provider, isLifetime, isFree };
}

export function calendarDates(event) {
  const day = String(event.event_date || event.date || '').split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('This event needs a valid date before adding it to your calendar.');
  const [year, month, date] = day.split('-').map(Number);
  const base = new Date(Date.UTC(year, month - 1, date));
  if (base.toISOString().slice(0, 10) !== day) throw new Error('This event has an invalid date.');
  const stamp = value => value.toISOString().slice(0, 10).replace(/-/g, '');
  const startDay = stamp(base);
  if (!event.start_time) {
    base.setUTCDate(base.getUTCDate() + 1);
    return `${startDay}/${stamp(base)}`;
  }
  const parseTime = value => {
    const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(String(value));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59) throw new Error('This event has an invalid time.');
    return Number(match[1]) * 60 + Number(match[2]);
  };
  const start = parseTime(event.start_time);
  let end = event.end_time ? parseTime(event.end_time) : start + 60;
  if (end <= start) end += 1440;
  const endDate = new Date(base);
  endDate.setUTCDate(endDate.getUTCDate() + Math.floor(end / 1440));
  const time = minutes => `${String(Math.floor((minutes % 1440) / 60)).padStart(2, '0')}${String(minutes % 60).padStart(2, '0')}00`;
  return `${startDay}T${time(start)}/${stamp(endDate)}T${time(end)}`;
}

export function googleCalendarUrl(event) {
  const params = { action: 'TEMPLATE', text: event.title || event.name || 'Event', details: event.description || '', location: event.address || event.venue || event.location || '', dates: calendarDates(event) };
  return 'https://www.google.com/calendar/render?' + Object.entries(params).map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
}
