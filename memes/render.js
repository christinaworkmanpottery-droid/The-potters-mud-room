const puppeteer = require('/home/ubuntu/.openclaw/workspace/luce-healing/memes/node_modules/puppeteer');
const path = require('path');
const fs = require('fs');

const MEMES_DIR = path.join(__dirname);
const OUTPUT_DIR = path.join(__dirname, '..', 'public', 'memes-gallery');

const memes = [
  { html: 'meme-wedging.html', png: 'meme-wedging.png' },
  { html: 'meme-glaze.html', png: 'meme-glaze.png' },
  { html: 'meme-cracks.html', png: 'meme-cracks.png' },
  { html: 'meme-funny.html', png: 'meme-funny.png' },
];

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  for (const meme of memes) {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080 });
    const htmlPath = path.join(MEMES_DIR, meme.html);
    await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });
    const outputPath = path.join(OUTPUT_DIR, meme.png);
    await page.screenshot({ path: outputPath, type: 'png' });
    console.log(`✅ Rendered ${meme.png}`);
    await page.close();
  }

  await browser.close();
  console.log('\n🎨 All memes rendered to', OUTPUT_DIR);
})();
