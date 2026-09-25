const text = value => String(value || '').replace(/\\/g, '\\\\').replace(/\r\n|\r|\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
const nextDate = value => { const d=new Date(value+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10); };
const dateValue = value => value.replace(/-/g,'');
const timeValue = value => value.slice(0,5).replace(':','')+'00';
// RFC 5545 folds physical lines at 75 octets, never splitting a UTF-8 character.
function fold(line) {
  const lines=[]; let current='';
  for (const ch of line) { if (Buffer.byteLength(current+ch)>75) {lines.push(current);current=' ';} current+=ch; }
  lines.push(current);return lines.join('\r\n');
}
function buildICS(events) {
  const lines=['BEGIN:VCALENDAR','VERSION:2.0',"PRODID:-//The Potter's Mud Room//EN",'CALSCALE:GREGORIAN','METHOD:PUBLISH'];
  for(const e of events) {
    lines.push('BEGIN:VEVENT','UID:'+text(e.id)+'@pottersmudroom','DTSTAMP:'+new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}/,''));
    if (!e.start_time) {
      lines.push('DTSTART;VALUE=DATE:'+dateValue(e.event_date),'DTEND;VALUE=DATE:'+dateValue(nextDate(e.event_date)));
    } else {
      // Events store local wall-clock times, without a timezone. Keep them floating.
      lines.push('DTSTART:'+dateValue(e.event_date)+'T'+timeValue(e.start_time));
      if(e.end_time) lines.push('DTEND:'+dateValue(e.end_time<=e.start_time?nextDate(e.event_date):e.event_date)+'T'+timeValue(e.end_time));
      else lines.push('DURATION:PT1H');
    }
    lines.push('SUMMARY:'+text(e.title),'DESCRIPTION:'+text([e.description,e.website].filter(Boolean).join('\n')),'LOCATION:'+text([e.venue,e.location,e.address].filter(Boolean).join(', ')),'END:VEVENT');
  }
  lines.push('END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
}
module.exports={buildICS};
