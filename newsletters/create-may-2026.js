const { initDB } = require('../database');
const { v4: uuidv4 } = require('uuid');
const db = initDB();

const title = 'The Mud Room Monthly: May 2026';
const slug = 'mud-room-monthly-may-2026';
const author = 'The Potter\'s Mud Room';

const content = `<h2>🌿 Welcome to the May Issue!</h2>
<p>May is the sweet spot of the pottery year. The studio's warm but not roasting, glazes are drying at a reasonable pace, and farmers' markets are kicking off everywhere. Whether you're prepping for summer shows, restocking your shop, or finally tackling that pile of bisqueware staring at you from the corner — we've got you covered this month.</p>

<hr>

<h2>🎨 Featured Technique: Mason Stain Slip Inlay (Mishima)</h2>

<p>Want crisp, illustrated lines on your work without painting freehand? <strong>Mishima</strong> is the answer — and it's way easier than it looks.</p>

<h3>How It Works:</h3>
<ol>
<li><strong>At leather-hard stage</strong>, lightly sketch your design with a pencil or needle tool.</li>
<li><strong>Carve the design</strong> shallowly (1–2mm deep) using a fine loop tool or sgraffito needle. Think botanical sketches, line drawings, or simple lettering.</li>
<li><strong>Mix a colored slip</strong> — combine a small batch of porcelain or matching clay slip with <strong>5–10% Mason stain</strong> by weight. Cobalt blue, iron oxide red, and chrome green are classic starters.</li>
<li><strong>Pack the slip</strong> into your carved lines using a small palette knife or rubber rib. Don't be shy — overfill it.</li>
<li><strong>Wait until bone-dry</strong>, then scrape the surface flush with a metal rib. The slip stays only in the carved lines.</li>
<li><strong>Bisque, glaze with a clear,</strong> and fire as usual.</li>
</ol>

<h3>Pro Tips:</h3>
<ul>
<li>Don't carve too deep — 1mm is plenty. Deep lines crack as the slip shrinks.</li>
<li>Apply slip in <strong>2 thin passes</strong> rather than one thick one. Thick slip = pop-outs.</li>
<li>Always test stain percentages first. Some stains (chrome, manganese) get aggressive at higher loads.</li>
<li>Pair mishima with a <strong>satin clear or celadon</strong> for that softly-illustrated, heirloom feel.</li>
<li>Keep your scraping rib metal, not plastic — plastic drags the slip back out.</li>
</ul>

<p><em>Log every stain ratio in The Mud Room's glaze tracker — mishima is one of those techniques where you'll absolutely want to remember "what the heck did I mix last time?"</em></p>

<hr>

<h2>🌞 Seasonal Pottery Ideas for May</h2>

<p>Wedding season, graduations, Father's Day prep, and the great outdoor dining migration — May is a goldmine if you make the right pieces:</p>

<ul>
<li><strong>Wedding favors & ring dishes</strong> — small, elegant, and customizable with stamped initials or dates</li>
<li><strong>Outdoor dinnerware sets</strong> — chunky tumblers, salad bowls, and serving platters for backyard season</li>
<li><strong>Citronella candle holders</strong> — pierced or carved vessels that hold a tealight or pillar; pair with a candle for a $$$ market item</li>
<li><strong>Berry colanders</strong> — small pierced bowls for washing berries; gorgeous AND functional</li>
<li><strong>Beer steins & whiskey cups</strong> — start now for Father's Day (June 21st)</li>
<li><strong>Garden mushrooms & yard art</strong> — outdoor sculptural pieces that survived the winter sell hard once gardening fever hits</li>
<li><strong>Iced coffee tumblers</strong> — taller mugs without handles, glazed inside only — summer's mug</li>
</ul>

<p><em>Tag your seasonal SKUs in The Mud Room's Projects view — by next May, you'll know exactly which pieces moved fast and which to skip.</em></p>

<hr>

<h2>🔧 Studio Hack of the Month: The Banding Wheel "Lazy Susan" Glazing Station</h2>

<p>Glazing detail work — bottoms, handles, rim lines — is a back-killer if you're constantly rotating the piece by hand. Here's the fix:</p>

<ol>
<li>Grab a <strong>cheap banding wheel</strong> (or a turntable from a thrift store).</li>
<li>Place a <strong>damp sponge or piece of foam</strong> on top — this grips your piece and protects it.</li>
<li>Set your bisqueware on the foam, dead-center.</li>
<li>While glazing, <strong>spin slowly with one hand</strong> while you brush, dip-line, or wax with the other.</li>
<li>For dipping, use the wheel as a <strong>drying rotation station</strong> right after — drips even out as it spins.</li>
</ol>

<p>This is especially clutch for:</p>
<ul>
<li>Painting clean rim lines or banded glaze stripes</li>
<li>Waxing bottoms without smudging your fingers everywhere</li>
<li>Detail brushwork like mishima cleanup or sgraffito touch-ups</li>
<li>Photographing finished work — same setup, just swap to a neutral backdrop</li>
</ul>

<p><strong>Cost: $20–40 for a banding wheel (or free with a thrifted lazy susan). Setup time: 30 seconds. Wrist relief: priceless.</strong></p>

<hr>

<h2>✨ Community Spotlight</h2>

<p><em>This spot is reserved for YOU! We're featuring a Mud Room community member each month.</em></p>

<p>Want to be featured? Share your work in the <strong>Show Your Work</strong> forum category, or tag us on Instagram <strong>@thepottersmudroom</strong>. We'd love to showcase your pieces, your story, and what pottery means to you.</p>

<p><em>Next month's spotlight could be yours!</em></p>

<hr>

<h2>😂 Pottery Meme of the Month</h2>

<p><strong>"Types of Studio Time"</strong></p>
<ol>
<li>🧘 <strong>The Zen Session</strong> — three hours feel like twenty minutes, every piece centers first try</li>
<li>🔥 <strong>The Production Sprint</strong> — 47 mugs, one playlist, no regrets, slight back pain</li>
<li>🤬 <strong>The Cursed Hour</strong> — clay too wet, then too dry, then on the floor, then on YOU</li>
<li>📱 <strong>The "Quick Check"</strong> — went in to sponge one bowl, emerged 4 hours later covered in slip</li>
<li>👻 <strong>The Avoidance Day</strong> — stared at the bisqueware pile, made tea, organized tools instead</li>
<li>🏆 <strong>The Magic Day</strong> — every glaze pull is gorgeous, you remember why you do this</li>
</ol>

<p><em>Which one was YOUR week? 😏 Tag a potter who needs to see this.</em></p>

<hr>

<h2>📣 Quick Updates</h2>
<ul>
<li><strong>Summer market season is HERE</strong> — use the Projects feature to organize each show's inventory separately</li>
<li><strong>New to The Mud Room?</strong> <a href="https://thepottersmudroom.com">Sign up free</a> and start logging your pieces today</li>
<li><strong>Refer a potter friend</strong> — you both get a free month of Starter access!</li>
</ul>

<p style="text-align: center; margin-top: 30px; font-size: 1.1em;"><strong>Happy potting! 🏺</strong></p>
<p style="text-align: center; color: #888;">— The Potter's Mud Room Team</p>`;

const excerpt = "May edition! This month: mishima slip inlay for crisp illustrated lines, seasonal market pieces for wedding/grad/Father's Day season, the banding wheel glazing hack that'll save your wrists, community spotlight, and the 6 types of studio time we ALL know too well. 🌿🏺";

const existing = db.prepare('SELECT id FROM blog_posts WHERE slug=?').get(slug);
if (existing) {
  console.log('Blog post with this slug already exists:', existing.id);
  console.log('Updating existing post as DRAFT...');
  db.prepare(`UPDATE blog_posts SET title=?, content=?, excerpt=?, author=?, is_published=0, updated_at=datetime('now') WHERE slug=?`)
    .run(title, content, excerpt, author, slug);
  console.log('Updated existing draft:', slug);
} else {
  const id = uuidv4();
  db.prepare('INSERT INTO blog_posts (id, title, slug, content, excerpt, author, is_published) VALUES (?,?,?,?,?,?,0)')
    .run(id, title, slug, content, excerpt, author);
  console.log('Created new draft blog post:', id, slug);
}

console.log('✅ May 2026 newsletter saved as DRAFT (is_published: 0)');
