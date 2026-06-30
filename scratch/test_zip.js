const fs = require('fs');
const path = require('path');
const JSZip = require('jszip');

// Helper to recursively list files
function getFiles(dir, fileList = []) {
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const name = path.join(dir, file);
    if (fs.statSync(name).isDirectory()) {
      getFiles(name, fileList);
    } else {
      fileList.push(name);
    }
  }
  return fileList;
}

async function run() {
  const baseDir = '/Users/timeipert/Documents/Antigrav/monodi-light/IO/export_monodi';
  const zip = new JSZip();

  // Add Aa 13 files to the mock zip
  const aa13Dir = path.join(baseDir, 'Aa 13');
  const files = getFiles(aa13Dir);
  console.log(`Found ${files.length} files in Aa 13`);

  for (const file of files) {
    const relative = path.relative(baseDir, file);
    const content = fs.readFileSync(file);
    zip.file(relative, content);
  }

  // Now run our classification logic on the in-memory zip
  const metaFiles = [];
  zip.forEach((relativePath, zipEntry) => {
    if (!zipEntry.dir && relativePath.endsWith('meta.json')) {
      metaFiles.push(zipEntry);
    }
  });

  console.log(`Found ${metaFiles.length} meta.json files`);

  const sourceMetaFiles = [];
  const docMetaFiles = [];

  for (const metaFile of metaFiles) {
    const relativePath = metaFile.name;
    const parts = relativePath.split('/');
    if (parts.length < 2) continue;

    const dataPath = relativePath.replace('meta.json', 'data.json');
    const hasDataJson = zip.file(dataPath) !== null;

    if (!hasDataJson) {
      const sourceId = parts[parts.length - 2];
      sourceMetaFiles.push({ name: relativePath, sourceId });
    } else {
      const docId = parts[parts.length - 2];
      const sourceId = parts[parts.length - 3];
      docMetaFiles.push({ name: relativePath, sourceId, docId });
    }
  }

  console.log(`Classified: ${sourceMetaFiles.length} sources, ${docMetaFiles.length} documents`);
  if (sourceMetaFiles.length > 0) {
    console.log('Sample source:', sourceMetaFiles[0]);
  }
  if (docMetaFiles.length > 0) {
    console.log('Sample doc:', docMetaFiles[0]);
    // Try to parse the content
    const docMetaContent = await zip.file(docMetaFiles[0].name).async('string');
    const docMeta = JSON.parse(docMetaContent);
    console.log('Parsed doc meta sample:', {
      id: docMeta.id,
      quelle_id: docMeta.quelle_id,
      dokumenten_id: docMeta.dokumenten_id,
      textinitium: docMeta.textinitium
    });
  }
}

run().catch(console.error);
