const puppeteer = require('/home/ubuntu/.openclaw/workspace/luce-healing/memes/node_modules/puppeteer');
const path = require('path');
const fs = require('fs');

const MEMES_DIR = __dirname;
const OUTPUT_DIR = path.join(__dirname, '..', 'memes-gallery');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080 });
  const htmlPath = path.join(MEMES_DIR, 'meme-kiln-loading.html');
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });
  const outputPath = path.join(OUTPUT_DIR, 'meme-kiln-loading.png');
  await page.screenshot({ path: outputPath, type: 'png' });
  console.log('✅ Rendered ' + outputPath);
  await browser.close();
})();
