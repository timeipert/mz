const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => console.log(`PAGE LOG [${msg.type()}]:`, msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));

  console.log('Navigating...');
  await page.goto('http://localhost:4200/#/notation', { waitUntil: 'networkidle2' });
  
  await new Promise(r => setTimeout(r, 2000));
  
  // Try to select the first source in the dropdown
  console.log('Selecting source...');
  await page.select('select.form-select', 'S1'); // or whatever value is there
  // Actually let's just select the second option in the select element
  const options = await page.$$eval('select.form-select option', opts => opts.map(o => o.value));
  if (options.length > 1) {
    await page.select('select.form-select', options[1]);
    console.log('Selected:', options[1]);
  }
  
  await new Promise(r => setTimeout(r, 4000));
  
  console.log('Done.');
  await browser.close();
})();
