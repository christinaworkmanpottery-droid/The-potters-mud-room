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

const content = `<p>Let's be honest: there's a moment with every kiln load where you stand back, look at all the pieces still on the cart, and quietly negotiate with physics. Can I fit one more bowl on that shelf? Should that mug go on its side? Will those two pieces touch in the firing?</p>

<p>Loading a kiln well is part Tetris, part chemistry, part stubborn experience. Here's a friendly breakdown of how to load like a pro — fitting more in, firing more evenly, and avoiding the heartbreak of welded-together pieces or collapsed shelves.</p>

<h2>1. Plan the load before you light the kiln</h2>
<p>Before a single piece goes in, lay your work out on a table or the floor in front of the kiln. Sort it by height — short, medium, and tall. This is the single biggest space-saver in your whole studio.</p>
<p>Tall pieces take a tall section. Short pieces stack into multiple short sections. If you load whatever's nearest at hand, you'll waste 4–6 inches of vertical space per shelf, which adds up fast.</p>
<p><strong>Pro move:</strong> Keep a few different post heights on hand — 1″, 2″, 3″, 4″, 6″, 8″. The more options, the less wasted air space.</p>

<h2>2. Kiln wash everything (and refresh it often)</h2>
<p>Kiln wash is your insurance policy. One drip of runny glaze on a bare shelf, and you're chiseling for an hour and ruining the next firing. A thin coat of kiln wash on the top of every shelf catches drips and protects you.</p>
<p>Inspect your shelves every load. If you see chips, flakes, or burned-on glaze spots, scrape and re-wash before reusing. Don't wash the underside — only the top.</p>
<p><strong>Bonus tip:</strong> Place small ware on cookies (little discs of bisqueware or kiln-washed clay) so any glaze drips fall on the cookie, not your shelf.</p>

<h2>3. The half-inch rule between glazed pieces</h2>
<p>Glazed pieces should never touch each other or the kiln walls. Glaze melts, glaze flows — and even pieces that seem safely apart can fuse together if they're too close.</p>
<p>A reliable rule: leave at least <strong>½ inch</strong> between any two glazed surfaces in a glaze firing. For runny or fluxy glazes, give them an inch. For unglazed bisque, you can pack tighter (even nest pieces inside larger ones), but never let glazed surfaces touch.</p>

<h2>4. Mind your elements and walls</h2>
<p>Your kiln's heat comes from the elements in the walls. If pieces are crammed right up against the brick, you'll get uneven firing — hot spots near the wall, cooler spots in the dead center.</p>
<p>Keep ware about <strong>1 inch from the walls</strong>. This lets heat circulate evenly around every piece, and protects your pots from any glaze drip flowing toward the wall.</p>
<p>For top-loading kilns, the bottom shelf and the area near the lid are typically the hottest. Plan accordingly: heat-tolerant pieces (porcelain, stoneware) handle the extremes; delicate work goes in the middle.</p>

<h2>5. Balance the load — both weight and content</h2>
<p>Each kiln shelf rests on three posts (always three, never four — three is more stable on uneven shelves). Distribute weight evenly across those three points. A heavy load with all the weight in one corner is asking for a shelf to crack mid-firing.</p>
<p>Also balance <em>what's</em> firing together. A kiln packed with all small thin mugs will fire faster than the dial says. A load full of thick-walled vases needs a longer hold at peak temperature. When you mix sizes and thicknesses thoughtfully, the firing curve actually serves all your work.</p>

<h2>Bonus: keep a kiln log</h2>
<p>This is the single best habit you can build. Every load, jot down: what was in it, what cone, ramp schedule, how long it ran, and what came out beautiful (or not). Over a year of firings, this log will teach you more about your kiln than any book ever could.</p>
<p>Same goes for which pieces, glazes, and clays were in there — that's exactly the kind of tracking we built our pottery app for. Future-you (and your customers asking "can I order another one of these?") will thank you.</p>

<h2>The takeaway</h2>
<p>Loading a kiln is a learnable skill, not a mystery. Plan the layout before you load, protect your shelves, leave the right gaps, mind the heat, and write everything down. Do that, and you'll fit more work per firing, get more even results, and avoid most of the disasters that plague potters who load by guesswork.</p>
<p>Happy firing, and may every kiln-opening feel like Christmas morning.</p>`;

(async () => {
  const login = await api('POST', '/api/auth/login', null, {
    email: 'christinaworkmanpottery@gmail.com',
    password: 'Jade4uac'
  });
  if (!login.body.token) { console.error('Login failed:', login); process.exit(1); }
  const token = login.body.token;
  console.log('Logged in.');

  const post = await api('POST', '/api/admin/blog/posts', token, {
    title: "Kiln Loading Like a Pro: Fit More In Without the Disasters",
    slug: 'kiln-loading-like-a-pro-fit-more-in-without-the-disasters',
    excerpt: "Plan the load, kiln-wash your shelves, mind the gaps, and balance the weight. A practical, potter-to-potter guide to loading kilns better.",
    content,
    is_published: 0,
    cover_image: null
  });
  console.log('POST result:', JSON.stringify(post, null, 2));
})();
