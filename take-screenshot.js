const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto('http://localhost:4200/#/notation', { waitUntil: 'networkidle0' });
  
  await page.screenshot({ path: 'screenshot_notation.png' });
  
  await browser.close();
})();
