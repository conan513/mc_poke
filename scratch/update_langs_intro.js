const fs = require('fs');
const path = require('path');

const langDir = '/mnt/raid/Source/mc_poke/src/public/lang';
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));

const introTranslations = {
  "hu": {
    "intro": {
      "lang_title": "Nyelvválasztás",
      "lang_desc": "Úgy észleltük, ezt a nyelvet preferálod:",
      "confirm_btn": "Rendben, mehetünk!",
      "change_btn": "Másik nyelvet választok",
      "welcome_text": "Üdvözlünk az új világban!",
      "adventure_text": "A kalandod most kezdődik...",
      "best_text": "Válj te a legjobbá!",
      "skip": "Átugrás"
    }
  },
  "en": {
    "intro": {
      "lang_title": "Language Selection",
      "lang_desc": "We detected you prefer this language:",
      "confirm_btn": "Perfect, let's go!",
      "change_btn": "Choose another language",
      "welcome_text": "Welcome to a new world!",
      "adventure_text": "Your adventure starts now...",
      "best_text": "Become the very best!",
      "skip": "Skip"
    }
  }
};

files.forEach(file => {
  const langCode = file.replace('.json', '');
  const filePath = path.join(langDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const t = introTranslations[langCode] || introTranslations['en'];

  data.intro = t.intro;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 1), 'utf8');
  console.log(`Added Intro strings for ${file}`);
});
