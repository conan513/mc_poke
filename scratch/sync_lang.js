const fs = require('fs');
const path = require('path');
const langDir = 'web-installer/lang';
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));
const enData = JSON.parse(fs.readFileSync(path.join(langDir, 'en.json'), 'utf8'));

const sync = (base, target) => {
  Object.keys(base).forEach(k => {
    if (target[k] === undefined) {
      target[k] = base[k];
    } else if (typeof base[k] === 'object' && base[k] !== null) {
      if (typeof target[k] !== 'object' || target[k] === null) {
        target[k] = base[k];
      } else {
        sync(base[k], target[k]);
      }
    }
  });
};

const sortObject = (obj) => {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return obj;
  const sorted = {};
  Object.keys(obj).sort().forEach(k => {
    sorted[k] = sortObject(obj[k]);
  });
  return sorted;
};

files.forEach(f => {
  const filePath = path.join(langDir, f);
  console.log(`Processing ${f}...`);
  let data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  sync(enData, data);
  data = sortObject(data);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
});
console.log('Done.');
