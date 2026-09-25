const assert=require('node:assert/strict');
const {searchPotters,cityPoint,milesBetween}=require('../directory-search');
const {buildICS}=require('../calendar-export');
const rows=[
 {id:'self',display_name:'Christina',city:'Santa Monica',state_region:'California',country:'United States',findable:1,is_private:0},
 {id:'near',display_name:'Venice potter',city:'Venice',state_region:'CA',country:'USA',findable:1,is_private:0},
 {id:'far',display_name:'Far potter',city:'San Diego',state_region:'CA',country:'US',findable:1,is_private:0},
 {id:'private',display_name:'Private',city:'Santa Monica',state_region:'CA',country:'USA',findable:1,is_private:1},
 {id:'optout',display_name:'Not listed',city:'Santa Monica',state_region:'CA',country:'USA',findable:0,is_private:0}
];
assert.deepEqual(searchPotters(rows,{q:' Santa MONICA ',state:'ca',country:'Usa'}).potters.map(x=>x.id),['self']);
console.log('PASS Santa Monica matches CA/California and USA/United States without exposing private or opted-out profiles');
for(const radius of [5,10])assert.deepEqual(searchPotters(rows,{near:'Santa Monica',state:'CA',country:'USA',radius}).potters.map(x=>x.id),['self','near']);
const p=cityPoint('Santa Monica','CA','US');
for(const city of ['Los Angeles, California','Los Angeles, CA','Los Angeles CA','  Los Angeles,   California  ']) {
  assert.deepEqual(cityPoint(city,'Ca',''),cityPoint('Los Angeles','CA','US'));
  assert.deepEqual(cityPoint(city,'',''),cityPoint('Los Angeles','CA','US'));
}
assert.equal(cityPoint('Los Angeles, California','NY','US'),null);
assert.equal(cityPoint('Los Angeles, California','CA','Canada'),null);
const culver={id:'culver',display_name:'Public potter',city:'Culver City',state_region:'California',country:'US',findable:1,is_private:0};
assert.deepEqual(searchPotters([culver,{...culver,id:'hidden',is_private:1}],{q:'Culver City',state:'Ca',near:'Los Angeles, California',radius:10}).potters.map(x=>x.id),['culver']);
console.log('PASS screenshot city/state input, abbreviations, whitespace, conflicting regions and nearby privacy');
assert.ok(milesBetween(p,cityPoint('Venice','California','USA'))<5);
assert.throws(()=>searchPotters(rows,{near:'Unknown city',radius:10}),/recognized US city/);
assert.throws(()=>searchPotters(rows,{near:'Santa Monica',state:'CA',radius:50}),/5 or 10/);
console.log('PASS real city-centre 5/10-mile searches, nearest-first sorting, unknown city and invalid radius handling');
const ics=buildICS([{id:'one',title:'Pottery, clay; fun',event_date:'2026-09-25',start_time:'09:30',end_time:'10:45',description:'Line one\nLine two '+ '🏺'.repeat(60),location:'Studio',address:'Santa Monica'}]);
assert.match(ics,/DTSTART:20260925T093000\r\n/);assert.match(ics,/DTEND:20260925T104500\r\n/);
assert.doesNotMatch(ics,/DTSTART:.*Z/);assert.match(ics,/SUMMARY:Pottery\\, clay\\; fun/);
assert.ok(ics.split('\r\n').every(line=>Buffer.byteLength(line)<=75));
assert.match(ics.replace(/\r\n /g,''),/Line one\\nLine two/);
const allDay=buildICS([{id:'day',title:'All day',event_date:'2026-12-31'}]);
assert.match(allDay,/DTSTART;VALUE=DATE:20261231/);assert.match(allDay,/DTEND;VALUE=DATE:20270101/);
const overnight=buildICS([{id:'night',event_date:'2026-09-25',start_time:'23:00',end_time:'01:00'}]);assert.match(overnight,/DTEND:20260926T010000/);
console.log('PASS iCal preserves local time, escapes notes, folds UTF-8, and handles all-day/year-boundary/overnight events');
