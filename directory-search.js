// Approximate US city centres; no member address or device location is collected.
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const places = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(__dirname, 'geodata/us-cities.json.gz'))));
const clean = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
const stateNames = new Map(Object.entries(places.states).flatMap(([code, name]) => [[clean(code), clean(code)], [clean(name), clean(code)]]));
const countryNames = new Map(['us', 'usa', 'u.s.', 'u.s.a.', 'united state', 'united states', 'united states of america'].map(x => [x, 'us']));
const stateKey = value => stateNames.get(clean(value)) || clean(value);
const countryKey = value => countryNames.get(clean(value)) || clean(value);
const cityIndex = new Map();
for (const [name, state, lat, lon] of places.cities) {
  const key = clean(name);
  if (!cityIndex.has(key)) cityIndex.set(key, []);
  cityIndex.get(key).push({state:clean(state), lat, lon});
}
function cityPoint(city, state, country) {
  if (country && countryKey(country) !== 'us') return null;
  const matches = (cityIndex.get(clean(city)) || []).filter(p => !state || p.state === stateKey(state));
  return matches.length === 1 ? matches[0] : null;
}
function milesBetween(a, b) {
  const rad = x => x * Math.PI / 180;
  const h = Math.sin(rad(b.lat-a.lat)/2)**2 + Math.cos(rad(a.lat))*Math.cos(rad(b.lat))*Math.sin(rad(b.lon-a.lon)/2)**2;
  return 3958.7613 * 2 * Math.asin(Math.sqrt(Math.min(1, h)));
}
function searchPotters(rows, query) {
  const q = clean(query.q), state = stateKey(query.state), country = countryKey(query.country);
  const near = clean(query.near), radius = Number(query.radius || 10);
  if (near && ![5,10].includes(radius)) throw new Error('Choose a 5 or 10 mile radius.');
  const origin = near ? cityPoint(near, state, country) : null;
  if (near && !origin) throw new Error('Nearby search needs a recognized US city and state. You can still search by name, city or region without a nearby city.');
  let unknown = 0;
  const potters = rows.filter(p => {
    if (!p.findable || p.is_private) return false;
    if (country && countryKey(p.country) !== country) return false;
    // A nearby search can cross a state boundary; state identifies the origin only.
    if (!near && state && stateKey(p.state_region) !== state) return false;
    if (q && ![p.display_name, p.bio, p.city].some(v => clean(v).includes(q))) return false;
    if (origin) {
      const point = cityPoint(p.city, p.state_region, p.country);
      if (!point) { unknown++; return false; }
      p.distanceMiles = milesBetween(origin, point);
      if (p.distanceMiles > radius) return false;
    }
    return true;
  }).sort((a,b) => origin ? a.distanceMiles-b.distanceMiles : String(a.display_name||'').localeCompare(String(b.display_name||'')));
  return {potters:potters.slice(0,100), notice:origin ? 'Approximate distances between city centres.' + (unknown ? ' Some profiles lack a recognized city/state and cannot be included in nearby results.' : '') : ''};
}
module.exports = {searchPotters, cityPoint, milesBetween, stateKey, countryKey};
