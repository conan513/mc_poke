const fs = require('fs');
const data = fs.readFileSync('scratch/m_skins.html', 'utf8');
const skins = [];
const regex = /<div class="card">[\s\S]*?<a class="panel-link" href="([^"]+)">[\s\S]*?<img src="([^"]+)"[\s\S]*?alt="([^"]+)"/gi;
let match;
while ((match = regex.exec(data)) !== null) {
  skins.push({
    id: match[1].replace('/', ''),
    name: match[3].trim(),
    preview: match[2]
  });
}
console.log(skins.slice(0, 3));
