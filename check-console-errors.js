const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`PAGE LOG [${msg.type()}]:`, msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  console.log('Navigating...');
  await page.goto('http://localhost:4200/#/notation?source=S1&tab=viewer', { waitUntil: 'networkidle2' });
  
  await new Promise(r => setTimeout(r, 2000));
  
  console.log('Done.');
  await browser.close();
})();
