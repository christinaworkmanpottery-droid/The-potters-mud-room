const { initDB } = require('../database');
const { v4: uuidv4 } = require('uuid');
const db = initDB();

const title = 'The Mud Room Monthly: April 2026';
const slug = 'mud-room-monthly-april-2026';
const author = 'The Potter\'s Mud Room';

const content = `<h2>🏺 Welcome to the April Issue!</h2>
<p>Spring is here, and that means fresh clay, open studio windows, and the irresistible urge to make ALL the planters. Whether you're prepping for market season or just enjoying the longer days at the wheel, this month's newsletter is packed with tips to level up your pottery game.</p>

<hr>

<h2>🎨 Featured Technique: Wax Resist Layering for Spring Glazes</h2>

<p>Spring calls for fresh, organic patterns — and <strong>wax resist layering</strong> is the perfect technique to get botanical, flowing designs without any fancy tools.</p>

<h3>How It Works:</h3>
<ol>
<li><strong>Bisque fire your piece</strong> as usual.</li>
<li><strong>Apply your base glaze</strong> — dip or pour a full coat of your lighter color (think celadon, cream, or a soft blue).</li>
<li><strong>Paint wax resist</strong> where you want to preserve the base color. Think leaves, vines, abstract lines, or simple circles. Use a cheap brush you don't love — wax is hard on brushes.</li>
<li><strong>Apply your second glaze</strong> over the entire piece. The wax repels it, revealing your base color underneath in your design.</li>
<li><strong>Fire and enjoy!</strong> The contrast between the two glazes creates beautiful depth.</li>
</ol>

<h3>Pro Tips:</h3>
<ul>
<li>Let your wax dry <strong>completely</strong> (15-20 min) before applying the second glaze. Rushing = smudges.</li>
<li>Keep your wax resist <strong>warm but never hot</strong> — set the jar in warm water if it thickens up.</li>
<li>For extra dimension, try a third glaze wash over everything before firing. The wax burns off in the kiln, so it only affects the raw glaze layer.</li>
<li>Practice your brush strokes on newspaper first. Wax resist is NOT forgiving — once it's on, it's on.</li>
</ul>

<p><em>Log your wax resist experiments in The Mud Room's glaze combo tracker so you remember which layers created that magic result!</em></p>

<hr>

<h2>🌸 Seasonal Pottery Ideas for April</h2>

<p>Spring markets and Mother's Day are right around the corner. Here are some pieces that sell like hotcakes this time of year:</p>

<ul>
<li><strong>Herb planters with drainage holes</strong> — small, functional, and everyone wants them for their kitchen windowsill</li>
<li><strong>Bud vases</strong> — single-stem vases in sets of 3 are perfect for spring wildflowers</li>
<li><strong>Garden markers</strong> — stamped clay plant markers for herb gardens (easy to batch-produce!)</li>
<li><strong>Mom mugs</strong> — Mother's Day is May 11th — start now if you haven't already</li>
<li><strong>Ring dishes</strong> — small, giftable, and great for using up leftover clay</li>
<li><strong>Hanging planters</strong> — macramé + handmade planter = instant market bestseller</li>
</ul>

<p><em>Track your seasonal pieces and sales in The Mud Room to see which items perform best year over year!</em></p>

<hr>

<h2>🔧 Studio Hack of the Month: The Zip-Lock Drying System</h2>

<p>Tired of pieces cracking because they dried unevenly? Try this dead-simple hack:</p>

<ol>
<li>After forming, place your piece on a <strong>small bat or tile</strong>.</li>
<li>Loosely drape a <strong>thin plastic bag</strong> (like a grocery bag) over it — don't seal it tight.</li>
<li>After 24 hours, <strong>poke 2-3 small holes</strong> in the bag with a pencil.</li>
<li>Every day, add <strong>2-3 more holes</strong> until the bag looks like Swiss cheese.</li>
<li>After 4-5 days, remove the bag entirely.</li>
</ol>

<p>This creates a <strong>controlled slow-dry environment</strong> that lets moisture escape gradually and evenly. It's especially clutch for:</p>
<ul>
<li>Large platters and bowls with thick bottoms</li>
<li>Pieces with handles or attachments</li>
<li>Anything with uneven wall thickness</li>
<li>Dry studio environments or hot weather</li>
</ul>

<p><strong>Cost: $0. Effort: Minimal. Cracking reduction: Massive.</strong></p>

<hr>

<h2>✨ Community Spotlight</h2>

<p><em>This spot is reserved for YOU! We're featuring a Mud Room community member each month.</em></p>

<p>Want to be featured? Share your work in the <strong>Show Your Work</strong> forum category, or tag us on Instagram <strong>@thepottersmudroom</strong>. We'd love to showcase your pieces, your story, and what pottery means to you.</p>

<p><em>Next month's spotlight could be yours!</em></p>

<hr>

<h2>😂 Pottery Meme of the Month</h2>

<p><strong>"Stages of Opening a Kiln"</strong></p>
<ol>
<li>😬 Nervous excitement</li>
<li>🤞 Please don't be cracked, please don't be cracked...</li>
<li>🧱 Opening the lid like it's a treasure chest</li>
<li>😍 "OH that glaze turned out GORGEOUS" (1 piece)</li>
<li>😐 "Well... that's... different" (3 pieces)</li>
<li>💀 *quietly puts one piece back and closes the kiln*</li>
</ol>

<p><em>We've all been there. Tag a potter who pretends every kiln opening goes perfectly. 😏</em></p>

<hr>

<h2>📣 Quick Updates</h2>
<ul>
<li><strong>Track your spring production:</strong> Use the Projects feature to organize your market prep</li>
<li><strong>New to The Mud Room?</strong> <a href="https://thepottersmudroom.com">Sign up free</a> and start logging your pieces today</li>
<li><strong>Refer a potter friend</strong> — you both get a free month of Starter access!</li>
</ul>

<p style="text-align: center; margin-top: 30px; font-size: 1.1em;"><strong>Happy potting! 🏺</strong></p>
<p style="text-align: center; color: #888;">— The Potter's Mud Room Team</p>`;

const excerpt = "Spring is here! This month: wax resist layering for gorgeous spring glazes, seasonal pottery ideas for market prep and Mother's Day, a zero-cost studio hack to stop cracking, community spotlight, and the stages of opening a kiln (we've all been there). 🏺";

// Check if slug already exists
const existing = db.prepare('SELECT id FROM blog_posts WHERE slug=?').get(slug);
if (existing) {
  console.log('Blog post with this slug already exists:', existing.id);
  console.log('Updating existing post...');
  db.prepare(`UPDATE blog_posts SET title=?, content=?, excerpt=?, author=?, is_published=0, updated_at=datetime('now') WHERE slug=?`)
    .run(title, content, excerpt, author, slug);
  console.log('Updated existing draft:', slug);
} else {
  const id = uuidv4();
  db.prepare('INSERT INTO blog_posts (id, title, slug, content, excerpt, author, is_published) VALUES (?,?,?,?,?,?,0)')
    .run(id, title, slug, content, excerpt, author);
  console.log('Created new draft blog post:', id, slug);
}

console.log('✅ April 2026 newsletter saved as DRAFT (is_published: 0)');
