// Send beta tester recruitment email to all members
const https = require('https');
const BASE = 'https://the-potters-mud-room.onrender.com';

function api(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = { method, hostname: url.hostname, path: url.pathname, headers: { 'Content-Type': 'application/json' } };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = https.request(opts, res => { let d=''; res.on('data',c=>d+=c); res.on('end',()=>{ try{resolve(JSON.parse(d))}catch(e){resolve(d)} }); });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const subject = "🏺 Help Us Launch — Be a Beta Tester!";

const html = `
<div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #2C2420; line-height: 1.7;">
  <div style="background: #3E2E24; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: #fff; margin: 0; font-size: 1.4rem;">The Potter's <span style="color: #C67B4E;">Mud</span> Room</h1>
  </div>
  
  <div style="padding: 32px 24px; background: #fff; border: 1px solid #E8E0D6; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #2C2420; margin-top: 0;">We Need Your Help! 🙌</h2>
    
    <p>Hey there, fellow potter!</p>
    
    <p>Big news — <strong>The Potter's Mud Room app is almost ready for Android!</strong> We've built the mobile app so you can track your pieces, clay bodies, glazes, and firings right from your phone or tablet.</p>
    
    <p>But before we can publish it on Google Play, we need <strong>20 beta testers</strong> to try it out first. That's where you come in.</p>
    
    <h3 style="color: #C67B4E;">What's in it for you?</h3>
    <ul style="padding-left: 20px;">
      <li>✅ Early access before anyone else</li>
      <li>✅ Free forever as a thank-you for testing</li>
      <li>✅ Direct input on features — tell us what potters actually need</li>
      <li>✅ Help a fellow potter build something real</li>
    </ul>
    
    <h3 style="color: #C67B4E;">What do you need?</h3>
    <ul style="padding-left: 20px;">
      <li>An Android phone or tablet</li>
      <li>A Gmail address (required by Google Play for beta access)</li>
      <li>Willingness to poke around and tell us what breaks 😅</li>
    </ul>
    
    <div style="text-align: center; margin: 32px 0;">
      <a href="https://thepottersmudroom.com/beta" style="display: inline-block; background: #C67B4E; color: #fff; padding: 14px 32px; border-radius: 6px; text-decoration: none; font-weight: bold; font-size: 1.1rem;">Join the Beta 🎉</a>
    </div>
    
    <p>All you have to do is sign up with your Gmail address and we'll send you a link to install the app. Easy as wedging clay. (Okay, easier.)</p>
    
    <p><strong>Don't have Android?</strong> No worries — the iOS version is coming soon too! We'll let you know when it's ready.</p>
    
    <hr style="border: none; border-top: 1px solid #E8E0D6; margin: 24px 0;">
    
    <p style="color: #7A6F66; font-size: 0.9rem;">Built by a potter, for potters. 🤎<br>
    — Christina & The Potter's Mud Room</p>
  </div>
</div>
`;

(async () => {
  const login = await api('POST', '/api/auth/login', null, { email: 'christinaworkmanpottery@gmail.com', password: 'Jade4uac' });
  if (!login.token) { console.error('Login failed:', login); return; }
  console.log('Logged in. Sending beta recruitment email...');
  
  const result = await api('POST', '/api/admin/announce', login.token, { subject, html });
  console.log('Result:', result);
})();
