const puppeteer = require('puppeteer');

(async () => {
  console.log('Launching browser...');
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  console.log('Navigating to app to initialize localforage...');
  await page.goto('http://localhost:4200/#/search', { waitUntil: 'networkidle2' });

  // Seed mock sources and documents into localforage directly in browser!
  console.log('Seeding mock documents into database...');
  await page.evaluate(async () => {
    return new Promise((resolve, reject) => {
      try {
        const request = indexedDB.open('monodi-light');
        request.onerror = (e) => reject(new Error('Failed to open database: ' + e.target.error));
        request.onsuccess = function(event) {
          try {
            const db = event.target.result;
            if (!db.objectStoreNames.contains('monodi_data')) {
              // Create it if missing (fallback)
              db.close();
              const req2 = indexedDB.open('monodi-light', db.version + 1);
              req2.onupgradeneeded = (ev) => {
                ev.target.result.createObjectStore('monodi_data');
              };
              req2.onsuccess = (ev) => {
                const db2 = ev.target.result;
                const tx = db2.transaction(['monodi_data'], 'readwrite');
                const store = tx.objectStore('monodi_data');
                
                const mockSources = [
                  { id: 'S1', sigle: 'A-Gr 807', name: 'Graz Ms 807' }
                ];
                const mockDocuments = [
                  {
                    id: 'D1',
                    quelle_id: 'S1',
                    dokumenten_id: 'A-Gr 807',
                    textinitium: 'Populus sion',
                    festtag: 'Advent II',
                    feier: 'Missa',
                    bibliographischerverweis: 'Graz Ref',
                    notes: { spaced: [{ nonSpaced: [{ grouped: [{ base: 'C', octave: 4, shape: 'Normal' }] }] }] },
                    syllables: [{ text: 'Po-', syllableType: 'Normal' }]
                  },
                  {
                    id: 'D2',
                    quelle_id: 'S1',
                    dokumenten_id: 'Pa 776',
                    textinitium: 'populus sion',
                    festtag: 'Advent II',
                    feier: 'Missa',
                    bibliographischerverweis: 'Paris Ref',
                    notes: { spaced: [{ nonSpaced: [{ grouped: [{ base: 'C', octave: 4, shape: 'Normal' }] }] }] },
                    syllables: [{ text: 'po-', syllableType: 'Normal' }]
                  }
                ];
                store.put(mockSources, 'monodi_sources');
                store.put(mockDocuments, 'monodi_documents');
                tx.oncomplete = () => resolve();
                tx.onerror = (err) => reject(new Error('Tx failed: ' + err.target.error));
              };
              req2.onerror = (err) => reject(new Error('Failed to upgrade database: ' + err.target.error));
              return;
            }

            const transaction = db.transaction(['monodi_data'], 'readwrite');
            const store = transaction.objectStore('monodi_data');

            const mockSources = [
              { id: 'S1', sigle: 'A-Gr 807', name: 'Graz Ms 807' },
              { id: 'S2', sigle: 'Pa 776', name: 'Paris BnF lat 776' }
            ];

            const mockDocuments = [
              {
                id: 'D1',
                quelle_id: 'S1',
                dokumenten_id: 'A-Gr 807',
                textinitium: 'Populus sion',
                festtag: 'Advent II',
                feier: 'Missa',
                bibliographischerverweis: 'Graz Ref',
                notes: { spaced: [{ nonSpaced: [{ grouped: [{ base: 'C', octave: 4, shape: 'Normal' }] }] }] },
                syllables: [{ text: 'Po-', syllableType: 'Normal' }]
              },
              {
                id: 'D2',
                quelle_id: 'S2',
                dokumenten_id: 'Pa 776',
                textinitium: 'populus sion',
                festtag: 'Advent II',
                feier: 'Missa',
                bibliographischerverweis: 'Paris Ref',
                notes: { spaced: [{ nonSpaced: [{ grouped: [{ base: 'C', octave: 4, shape: 'Normal' }] }] }] },
                syllables: [{ text: 'po-', syllableType: 'Normal' }]
              }
            ];

            store.put(mockSources, 'monodi_sources');
            store.put(mockDocuments, 'monodi_documents');

            transaction.oncomplete = () => resolve();
            transaction.onerror = (err) => reject(new Error('Tx failed: ' + err.target.error));
          } catch (err) {
            reject(err);
          }
        };
      } catch (err) {
        reject(err);
      }
    });
  });

  // Wait a short moment for IndexedDB transaction to commit
  await new Promise(r => setTimeout(r, 1000));

  console.log('Reloading page with seeded data...');
  await page.goto('http://localhost:4200/#/search', { waitUntil: 'networkidle2' });

  console.log('Switching to Documents tab...');
  const tabLinks = await page.$$('.nav-link');
  let docsTab = null;
  for (const link of tabLinks) {
    const text = await page.evaluate(el => el.textContent, link);
    if (text.trim().includes('Documents')) {
      docsTab = link;
      break;
    }
  }
  if (!docsTab) {
    throw new Error('Documents tab link not found!');
  }
  await docsTab.click();

  console.log('Waiting for search results table...');
  await page.waitForSelector('table tbody tr');

  console.log('Selecting documents for comparison...');
  // Click the checkboxes in the first column of the first two rows
  const checkboxes = await page.$$('table tbody tr input[type="checkbox"]');
  if (checkboxes.length < 2) {
    throw new Error('Not enough mock documents found in the table!');
  }
  await checkboxes[0].click();
  await checkboxes[1].click();

  console.log('Clicking Open Synopsis button...');
  // Wait for the Synopsis button to become visible and enabled
  const synopsisButtonSelector = 'button.btn-primary';
  await page.waitForSelector(synopsisButtonSelector);
  
  // Find the button that contains "Open Synopsis"
  const buttons = await page.$$(synopsisButtonSelector);
  let openBtn = null;
  for (const btn of buttons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.includes('Open Synopsis')) {
      openBtn = btn;
      break;
    }
  }

  if (!openBtn) {
    throw new Error('Open Synopsis button not found!');
  }
  await openBtn.click();

  console.log('Waiting for Synopsis view to render...');
  await page.waitForSelector('.synopsis-view');

  console.log('Verifying Synopsis components...');
  // 1. Check title
  const hasTitle = await page.evaluate(() => {
    return document.body.innerHTML.includes('Synoptic Comparison');
  });
  if (!hasTitle) {
    throw new Error('Synopsis view title is missing!');
  }
  console.log('✓ Synopsis Title is present.');

  // 2. Check Document Metadata Table is rendered
  const hasMetadataTable = await page.evaluate(() => {
    const tables = document.querySelectorAll('.synopsis-view table');
    return tables.length > 0;
  });
  if (!hasMetadataTable) {
    throw new Error('Document Metadata Table is missing from the Synopsis view!');
  }
  console.log('✓ Document Metadata Table is present.');

  // 3. Test Column Picker dropdown click
  console.log('Opening Column Picker...');
  const colPickerButtonSelector = 'button';
  const pageButtons = await page.$$(colPickerButtonSelector);
  let colPickerBtn = null;
  for (const btn of pageButtons) {
    const text = await page.evaluate(el => el.textContent, btn);
    if (text.trim() === 'Columns') {
      colPickerBtn = btn;
      break;
    }
  }
  if (!colPickerBtn) {
    throw new Error('Metadata Columns chooser button not found!');
  }
  await colPickerBtn.click();

  // Wait for dropdown to display
  await page.waitForSelector('.col-picker');
  console.log('✓ Columns picker dropdown is open.');

  console.log('E2E TEST PASSED SUCCESSFULLY!');
  await browser.close();
  process.exit(0);
})().catch(err => {
  console.error('E2E TEST FAILED:', err);
  process.exit(1);
});
