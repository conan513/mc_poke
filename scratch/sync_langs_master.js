const fs = require('fs');
const path = require('path');

const langDir = '/mnt/raid/Source/mc_poke/src/public/lang';
const masterFile = 'en.json';
const masterPath = path.join(langDir, masterFile);
const masterData = JSON.parse(fs.readFileSync(masterPath, 'utf8'));

const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json') && f !== masterFile);

function deepSync(master, target) {
  let changed = false;
  for (const key in master) {
    if (typeof master[key] === 'object' && master[key] !== null) {
      if (!target[key] || typeof target[key] !== 'object') {
        target[key] = {};
        changed = true;
      }
      if (deepSync(master[key], target[key])) {
        changed = true;
      }
    } else {
      if (!(key in target)) {
        target[key] = master[key];
        changed = true;
      }
    }
  }
  return changed;
}

files.forEach(file => {
  const filePath = path.join(langDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  if (deepSync(masterData, data)) {
    fs.writeFileSync(filePath, JSON.stringify(data, null, 1), 'utf8');
    console.log(`Synced ${file} with master (en.json)`);
  } else {
    console.log(`${file} is already up to date.`);
  }
});
