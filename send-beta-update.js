// Send beta update email to all beta signups about iOS bug
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

const subject = "🏺 Quick Update — iPhone Bug Fix Coming Today";

const html = `
<div style="font-family: Georgia, serif; max-width: 600px; margin: 0 auto; color: #2C2420; line-height: 1.7;">
  <div style="background: #3E2E24; padding: 20px; text-align: center; border-radius: 10px 10px 0 0;">
    <h1 style="color: #fff; margin: 0; font-size: 1.4rem;">The Potter's <span style="color: #C67B4E;">Mud</span> Room</h1>
  </div>
  
  <div style="padding: 32px 24px; background: #fff; border: 1px solid #E8E0D6; border-top: none; border-radius: 0 0 10px 10px;">
    <h2 style="color: #2C2420; margin-top: 0;">Quick Heads Up! 👋</h2>
    
    <p>Hey!</p>
    
    <p>Thanks for testing <strong>The Potter's Mud Room</strong>! Just a quick update:</p>
    
    <p>There's a <strong>known bug on iPhone</strong> where pieces save blank. A fix is being uploaded to TestFlight right now and should be available within a few hours.</p>
    
    <p><strong>In the meantime:</strong></p>
    <ul>
      <li>You can add pieces through the website at <a href="https://thepottersmudroom.com">thepottersmudroom.com</a> and they'll show in the app</li>
      <li>Android is not affected</li>
      <li>The updated TestFlight build will install automatically (or check for updates in TestFlight)</li>
    </ul>
    
    <p>Thanks for your patience — this is exactly why beta testing matters! 🙏</p>
    
    <p style="color: #666; font-style: italic;">— Christina & The Potter's Mud Room Team</p>
  </div>
</div>
`;

async function main() {
  // Login as admin
  console.log('Logging in...');
  const login = await api('POST', '/api/auth/login', null, {
    email: 'christinaworkmanpottery@gmail.com',
    password: process.argv[2] || ''
  });
  if (!login.token) {
    console.error('Login failed:', login);
    console.error('Usage: node send-beta-update.js <password>');
    process.exit(1);
  }
  console.log('Logged in.');

  // Send announcement to all members
  console.log('Sending announcement...');
  const result = await api('POST', '/api/admin/announce', login.token, { subject, html });
  console.log('Result:', result);
}

main().catch(e => { console.error(e); process.exit(1); });
