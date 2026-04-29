const https = require('https');
const BASE = 'https://the-potters-mud-room.onrender.com';

function api(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE);
    const opts = {
      method, hostname: url.hostname, path: url.pathname,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve({status: res.statusCode, body: JSON.parse(data)}); } catch(e) { resolve({status: res.statusCode, body: data}); } });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

const content = `<p>Pull a kiln load. Beautiful pieces, gorgeous glaze… and then you spot it. The pinhole. The crawl. The hairline craze running across your favorite mug. Welcome to glaze defects — the universal potter's heartbreak.</p>

<p>Good news: most glaze defects are <strong>fixable</strong> once you know what's actually causing them. Here's a friendly, practical breakdown of the five most common culprits and what to do about them.</p>

<h2>1. Pinholes — those tiny pinpoint craters</h2>
<p>Pinholes happen when gases escape from the clay or glaze and don't get a chance to heal over before the kiln cools. They're especially common with iron-bearing clays and matte glazes.</p>
<p><strong>Try this:</strong></p>
<ul>
<li>Slow your bisque firing — give the clay time to fully off-gas (a slow ramp from 1000°F to 1700°F helps a lot).</li>
<li>Add a 10–15 minute hold at peak temperature on your glaze firing. This gives the glaze time to smooth back over.</li>
<li>Slow the cooling between cone 010 and cone 06. Crash-cooling locks pinholes in.</li>
<li>Apply your glaze a bit thicker — but not too thick, which leads us to…</li>
</ul>

<h2>2. Crawling — when glaze pulls away from the clay</h2>
<p>Crawling looks like islands of glaze with bare clay showing between them. It's almost always a <strong>bond problem</strong> between the glaze and the bisqueware.</p>
<p><strong>Try this:</strong></p>
<ul>
<li>Wipe down your bisqueware before glazing. Dust, fingerprint oils, and even cat hair can cause crawling.</li>
<li>Apply thinner coats. Thick, cracked-while-drying glaze loves to crawl.</li>
<li>Reduce calcined materials in your glaze recipe if you mix your own — too much can cause shrinkage on application.</li>
<li>If you're double-dipping, let the first coat fully dry (and rehydrate the surface lightly) before the second.</li>
</ul>

<h2>3. Crazing — those spider-web cracks</h2>
<p>Crazing is a fit problem. Your glaze is shrinking more than the clay body underneath, so it cracks under tension as it cools. Sometimes it's beautiful (intentional crackle glazes), but when it shows up uninvited on functional ware, it's a food-safety issue too.</p>
<p><strong>Try this:</strong></p>
<ul>
<li>Switch to a clay body with higher silica content, or switch to a glaze with more silica.</li>
<li>Reduce the high-expansion fluxes (sodium and potassium) in your glaze recipe.</li>
<li>Fire to the recommended cone — underfiring is a sneaky cause of crazing.</li>
<li>For an existing batch, refire the pieces a cone hotter and see if the glaze melts more fully.</li>
</ul>

<h2>4. Blistering — bubbles that didn't pop</h2>
<p>Blisters are bigger than pinholes — actual raised bumps, sometimes with sharp edges. They mean gases got trapped in a glaze that was too viscous (or the firing was too fast) for them to escape.</p>
<p><strong>Try this:</strong></p>
<ul>
<li>Check your cone. Overfiring causes serious blistering — confirm your kiln is firing where you think it is with a witness cone.</li>
<li>Slow the last 200°F of your firing to give bubbles time to rise and pop.</li>
<li>A short hold at peak temp helps here too.</li>
<li>If your clay is sulfur-bearing, a slower bisque burns the sulfur off before glaze trapping kicks in.</li>
</ul>

<h2>5. Running glaze — when it ends up on your kiln shelf</h2>
<p>This one stings — sometimes literally, when you have to grind glaze off a shelf. Running happens when glaze gets too fluid at peak temperature and gravity wins.</p>
<p><strong>Try this:</strong></p>
<ul>
<li>Apply glaze thinner near the foot of the piece. Most runs start within the bottom inch.</li>
<li>Wax the bottom of every piece. Always. No exceptions.</li>
<li>Use cookies (small clay tiles or kiln wash–dipped bisque rounds) under glazes you know are runners.</li>
<li>If a glaze runs every time, drop your firing by half a cone or rework the recipe with less flux.</li>
</ul>

<h2>The secret weapon: track everything</h2>
<p>Here's the truth — most glaze defects aren't mysteries. They're <strong>patterns</strong> waiting to be spotted. The potter who logs which clay body, which glaze, which kiln position, and which firing schedule went into each piece is the one who actually solves these problems.</p>

<p>If you've ever stared at a cracked mug wondering "wait, was that the new glaze or the old one?" — yeah. Same. That's exactly why we built The Potter's Mud Room: to keep all of those details in one place so the next firing teaches you something instead of confusing you.</p>

<p>Defects happen to all of us. Track them, learn from them, and the next kiln load gets a little closer to perfect. 🔥</p>

<p><em>Happy firing,<br>The Potter's Mud Room team</em></p>`;

(async () => {
  const login = await api('POST', '/api/auth/login', null, {
    email: 'christinaworkmanpottery@gmail.com',
    password: 'Jade4uac'
  });
  if (!login.body.token) { console.error('Login failed:', login); process.exit(1); }
  const token = login.body.token;
  console.log('Logged in.');

  const post = await api('POST', '/api/admin/blog/posts', token, {
    title: "Glaze Defects Decoded: Fixing the 5 Disasters Every Potter Hits",
    slug: 'glaze-defects-decoded-fixing-the-5-disasters-every-potter-hits',
    excerpt: "Pinholes, crawling, crazing, blistering, running — what causes them, and the practical fixes that actually work.",
    content,
    is_published: 0,
    cover_image: null
  });
  console.log('POST result:', JSON.stringify(post, null, 2));
})();
