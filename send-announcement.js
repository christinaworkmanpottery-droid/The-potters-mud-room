// Send announcement notification + email to all real users
const https = require('https');

const BASE = 'https://the-potters-mud-room.onrender.com';

// Skip test accounts
const SKIP_EMAILS = [
  'newsletter_test_1774274419@test.com',
  'audit_test_1774273442@test.com',
  'test_admin_check@test.com',
  'admin@thepottersmudroom.com'
];

async function api(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method,
      hostname: url.hostname,
      path: url.pathname,
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type': 'application/json'
      }
    };
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { resolve(data); }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

(async () => {
  // Login as admin
  const login = await api('POST', '/api/auth/login', null, {
    email: 'christinaworkmanpottery@gmail.com',
    password: 'Jade4uac'
  });
  
  if (!login.token) { console.error('Login failed:', login); return; }
  const token = login.token;
  console.log('Logged in as admin');

  // Get members
  const membersData = await api('GET', '/api/admin/members', token);
  const allUsers = membersData.members;
  
  // Filter real users (skip test accounts and admin)
  const realUsers = allUsers.filter(u => 
    !SKIP_EMAILS.includes(u.email) && 
    u.email !== 'christinaworkmanpottery@gmail.com'
  );
  
  console.log(`Sending to ${realUsers.length} real users (skipping ${allUsers.length - realUsers.length} test/admin accounts)`);

  // We need to add a temporary endpoint to send notifications + emails
  // Since we can't do that live, let's create a blog post as the announcement 
  // and use the newsletter send feature
  
  // Create announcement blog post
  const post = await api('POST', '/api/admin/blog/posts', token, {
    title: "We're Back & Better Than Ever! 🎉",
    slug: 'were-back-and-better-march-2026',
    content: `<h2>We owe you an apology</h2>
<p>First things first — <strong>we're sorry.</strong> Some of you experienced issues accessing The Potter's Mud Room recently, and that's on us. If you tried to visit using <em>www.</em>thepottersmudroom.com, you may have seen an error page. That's been completely fixed now.</p>

<h2>What happened?</h2>
<p>A technical configuration issue meant that anyone typing "www" before our address couldn't reach the site. We've resolved this and both <strong>thepottersmudroom.com</strong> and <strong>www.thepottersmudroom.com</strong> now work perfectly.</p>

<h2>What's new?</h2>
<p>We've been busy making The Potter's Mud Room even better for you:</p>
<ul>
<li>✅ <strong>Sign-in issues fixed</strong> — the site is accessible from any link now</li>
<li>✅ <strong>Newsletter system</strong> — stay up to date with tips, community highlights, and new features</li>
<li>✅ <strong>Community forum improvements</strong> — connect with fellow potters</li>
<li>✅ <strong>Account management</strong> — more control over your profile and data</li>
</ul>

<h2>New contact email</h2>
<p>You can now reach us at <strong>info@thepottersmudroom.com</strong> for any questions, feedback, or support.</p>

<h2>Thank you for your patience</h2>
<p>We know how frustrating it is when something doesn't work, especially when you're excited to try a new tool. We appreciate every single one of you who signed up and we're committed to making this the best pottery tracking app out there.</p>

<p><strong>Happy potting! 🏺</strong></p>
<p>— Christina & The Potter's Mud Room Team</p>`,
    excerpt: "We're sorry for the recent access issues. Everything is fixed, and we've got exciting updates to share!",
    status: 'draft'
  });
  
  console.log('Blog post created:', post.id ? 'SUCCESS (draft)' : JSON.stringify(post));
  if (post.id) {
    console.log('Post ID:', post.id);
    console.log('\nBlog post saved as DRAFT — Christina can review and publish from admin panel.');
    console.log('Once published, use the Newsletter tab in admin to send to all subscribers.');
  }
})();
