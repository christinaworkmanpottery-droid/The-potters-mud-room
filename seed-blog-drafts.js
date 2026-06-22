// Run once on server startup to seed draft blog posts
// Posts are created as drafts (is_published=0) for Christina to review
const { v4: uuidv4 } = require('uuid');

function seedBlogDrafts(db) {
  const posts = [
    {
      title: 'How to Price Your Pottery (Without Selling Yourself Short)',
      slug: 'how-to-price-your-pottery-without-selling-yourself-short',
      excerpt: "Pricing handmade work is one of the hardest parts of being a potter. Here's a real-world framework that covers materials, time, and the value of your craft.",
      author: 'Christina Workman',
      content: `# How to Price Your Pottery (Without Selling Yourself Short)

Every potter hits this wall: you've made something beautiful, someone wants to buy it, and you have no idea what to charge.

Charge too little and you're working for free. Charge too much and it sits on the shelf. Here's how to find the sweet spot.

## The Real Cost Formula

**Materials + Time + Overhead + Profit = Price**

### 1. Materials
Clay, glaze, kiln electricity/gas, tools that wear out. Track everything for a month and divide by pieces produced.

A rough guide:
- Clay: $0.50-$2 per piece (depending on size and clay cost)
- Glaze: $0.25-$1 per piece
- Firing: $1-$5 per piece (kiln share)

### 2. Your Time
This is where most potters undervalue themselves. Throwing, trimming, glazing, loading/unloading, packaging - it all counts.

Pick an hourly rate you'd accept for skilled labor. $20/hr is a bare minimum. $35-$50 is reasonable for experienced makers.

### 3. Overhead
Studio rent, insurance, website, packaging materials, show fees. Add these up monthly and divide across your output.

### 4. Profit Margin
This isn't your wage - it's what keeps your business growing. Add 20-30% on top.

## The Quick Multiplier Method

If math isn't your thing:
- **Materials cost x 4** = wholesale price
- **Wholesale x 2** = retail price

A mug that costs $3 in materials = $12 wholesale = $24 retail.

## Common Pricing Mistakes

1. **Comparing to Target/Amazon** - Mass production is not your competition
2. **Charging what you'd pay** - You're not your customer
3. **Pricing by size alone** - A tiny detailed cup can be worth more than a large bowl
4. **Dropping prices when things don't sell** - Try better photos or different venues first

## The Confidence Factor

Pricing is emotional. But remember: people who value handmade work expect to pay for it. Your prices communicate quality.

Start tracking your costs in The Potter's Mud Room and you'll have real numbers to back up your prices.`
    },
    {
      title: '5 Things I Wish I Knew Before My First Craft Show',
      slug: '5-things-i-wish-i-knew-before-my-first-craft-show',
      excerpt: "Craft shows can make or break your confidence as a new potter. Here are the lessons that took me years to learn - so you don't have to.",
      author: 'Christina Workman',
      content: `# 5 Things I Wish I Knew Before My First Craft Show

Your first craft show is exciting and terrifying in equal measure. You've made the work, packed the car, and now you're sitting behind a table hoping someone - anyone - stops.

Here's what I wish someone had told me.

## 1. Your Display IS Your Product

People decide whether to approach your booth in about 3 seconds. If your table looks like a garage sale, they'll walk past beautiful work without a second glance.

**What works:**
- Varying heights (risers, shelves, stacked crates)
- Cohesive color palette in your linens/display
- Breathing room between pieces - don't overcrowd
- One clear "hero piece" that draws the eye

## 2. Bring Way More Than You Think

The general rule: bring 3x what you hope to sell. A full, abundant display looks successful. A sparse table looks like leftovers.

Also bring:
- Business cards
- A price list or clear tags on everything
- Bags/wrapping for purchases
- A card reader (Square, etc.)
- Change if you accept cash

## 3. Talk to People (But Don't Hover)

The sweet spot: greet people warmly, let them browse, and be ready to answer questions. Share your process when they seem interested.

**Magic phrases:**
- "That one's made with [clay type], fired to cone [X]"
- "I'm happy to answer any questions"
- "Each piece is one of a kind"

**Avoid:** Following people around or launching into a 10-minute monologue.

## 4. Not Every Show Is Your Show

Some shows attract pottery buyers. Others attract people looking for $5 candles and kettle corn. Research before you apply:
- What's the vendor fee vs. expected attendance?
- Is it juried (curated) or open to anyone?
- What did other potters say about it?

One great show beats five bad ones.

## 5. Your First Show Probably Won't Be Amazing (And That's OK)

Most potters don't crush their first show. You're learning:
- What sells vs. what you love making
- What prices people respond to
- How to talk about your work
- What your display needs

Treat it as research. Take notes. Adjust. Show two is always better than show one.

## Track What Works

After each show, log what sold, what got compliments but didn't sell, and what was ignored. Over time, patterns emerge. The Potter's Mud Room's sales tracking makes this easy - log it while it's fresh.`
    },
    {
      title: "The Pottery Vocabulary Cheat Sheet: Terms Every Beginner Should Know",
      slug: 'pottery-vocabulary-cheat-sheet-terms-every-beginner-should-know',
      excerpt: "Bisque? Cone? Wedging? If pottery terminology makes your head spin, this plain-English glossary will get you caught up fast.",
      author: 'Christina Workman',
      content: `# The Pottery Vocabulary Cheat Sheet

Walking into a pottery studio for the first time can feel like everyone's speaking a different language. Here's your translator.

## Clay States

- **Plastic** - Fresh, workable clay. Soft and moldable.
- **Leather-hard** - Firm enough to handle but still damp. Perfect for trimming, carving, attaching handles.
- **Bone dry (greenware)** - Completely air-dried. Very fragile. Ready for first firing.
- **Bisqueware** - After first firing. Porous, hard, ready for glazing.

## Firing Terms

- **Bisque fire** - First firing (usually cone 06-04). Burns out moisture and organics, hardens clay.
- **Glaze fire** - Second firing (cone varies by clay/glaze). Melts glaze into glass coating.
- **Cone** - NOT a temperature! A measure of heat-work (time + temperature). Cone 6 = about 2232F.
- **Reduction** - Firing with limited oxygen (gas kilns). Changes glaze colors dramatically.
- **Oxidation** - Firing with plenty of oxygen (electric kilns). More predictable results.

## Techniques

- **Throwing** - Making pots on the wheel.
- **Hand-building** - Making without a wheel (coil, slab, pinch).
- **Wedging** - Kneading clay to remove air bubbles and even out moisture.
- **Trimming** - Carving the bottom of a leather-hard pot on the wheel for a foot ring.
- **Scoring & slipping** - Scratching + applying wet clay to join pieces (like pottery glue).
- **Pulling a handle** - Shaping a handle from a lump of clay using water and gravity.

## Glaze Terms

- **Underglaze** - Color applied before or after bisque firing, under the glaze layer.
- **Crawling** - Glaze pulling away from the surface during firing (usually a defect).
- **Pinholing** - Tiny holes in fired glaze from gases escaping.
- **Running** - Glaze melting and flowing downward (can be intentional or disastrous).
- **Dipping** - Submerging bisqueware in liquid glaze.
- **Wax resist** - Applying wax so glaze won't stick (for patterns or keeping bottoms clean).

## Studio Lingo

- **Reclaim/recycle** - Rehydrating dried clay scraps to reuse.
- **Kiln wash** - Protective coating on kiln shelves to prevent glaze drips from sticking.
- **Bat** - Flat disc that attaches to the wheel head (for easy removal of pots).
- **S-crack** - A crack in the bottom of a pot (from uneven drying or improper throwing).

## The Cone Confusion

People say "I fire to cone 6" - here's what that means in practice:

- Low-fire (cone 06-01, 1830-2080F): Earthenware, bright colors
- Mid-fire (cone 1-6, 2110-2232F): Most studio pottery
- High-fire (cone 7-13, 2262-2455F): Stoneware, porcelain

The higher the cone, the stronger and more vitrified (waterproof) the clay becomes.

---

Bookmark this one. You'll come back to it.`
    }
  ];

  for (const post of posts) {
    try {
      const existing = db.prepare('SELECT id FROM blog_posts WHERE slug=?').get(post.slug);
      if (!existing) {
        const id = uuidv4();
        db.prepare('INSERT INTO blog_posts (id, title, slug, content, excerpt, author, is_published) VALUES (?,?,?,?,?,?,?)')
          .run(id, post.title, post.slug, post.content, post.excerpt, post.author, 0);
        console.log('[BLOG SEED] Created draft:', post.title);
      }
    } catch (e) { /* skip duplicates */ }
  }
}

module.exports = { seedBlogDrafts };
