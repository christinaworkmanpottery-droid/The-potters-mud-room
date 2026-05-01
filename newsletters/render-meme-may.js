const puppeteer = require('/home/ubuntu/.openclaw/workspace/luce-healing/memes/node_modules/puppeteer');
const path = require('path');

(async () => {
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1080, height: 1080 });
  const htmlPath = path.join(__dirname, '..', 'memes', 'meme-studio-time-may-2026.html');
  await page.goto('file://' + htmlPath, { waitUntil: 'networkidle0' });
  const outputPath = path.join(__dirname, 'meme-may-2026.png');
  await page.screenshot({ path: outputPath, type: 'png' });
  console.log('✅ Rendered:', outputPath);
  await browser.close();
})();
