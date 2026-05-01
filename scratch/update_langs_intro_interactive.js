const fs = require('fs');
const path = require('path');

const langDir = '/mnt/raid/Source/mc_poke/src/public/lang';
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));

const extendedIntro = {
  "hu": {
    "intro": {
      "lang_title": "Nyelvválasztás",
      "lang_desc": "Úgy észleltük, ezt a nyelvet preferálod:",
      "confirm_btn": "Rendben, mehetünk!",
      "change_btn": "Másik nyelvet választok",
      "next": "Tovább",
      "start_btn": "Kezdjük el!",
      "pitch_1_title": "Több mint 1000 Pokémon",
      "pitch_1_desc": "Fedezz fel egy hatalmas világot tele ritka lényekkel és egyedi Mega-fejlődésekkel.",
      "pitch_2_title": "Légy te a Bajnok",
      "pitch_2_desc": "Versenyezz a globális ranglistán és írd be magad a Hírességek Csarnokába!",
      "pitch_3_title": "Biztonság & Közösség",
      "pitch_3_desc": "Szinkronizált profilok, napi jutalmak és egy aktív magyar közösség vár.",
      "choice_title": "Készen állsz a kalandra?",
      "choice_desc": "Válaszd ki, hogyan szeretnél csatlakozni:",
      "new_player_title": "Új vagyok itt",
      "new_player_desc": "Regisztrálok és elkezdem a kalandot",
      "returning_player_title": "Visszatérő Mester",
      "returning_player_desc": "Belépek a meglévő fiókommal",
      "skip": "Átugrás"
    }
  },
  "en": {
    "intro": {
      "lang_title": "Language Selection",
      "lang_desc": "We detected you prefer this language:",
      "confirm_btn": "Perfect, let's go!",
      "change_btn": "Choose another language",
      "next": "Next",
      "start_btn": "Let's Start!",
      "pitch_1_title": "1000+ Pokémon",
      "pitch_1_desc": "Explore a massive world filled with rare creatures and unique Mega Evolutions.",
      "pitch_2_title": "Become the Champion",
      "pitch_2_desc": "Compete on global leaderboards and earn your place in the Hall of Fame!",
      "pitch_3_title": "Security & Community",
      "pitch_3_desc": "Synced profiles, daily rewards, and an active community are waiting.",
      "choice_title": "Ready for Adventure?",
      "choice_desc": "Choose how you want to join:",
      "new_player_title": "I'm New Here",
      "new_player_desc": "Register and start your journey",
      "returning_player_title": "Returning Master",
      "returning_player_desc": "Login with your existing account",
      "skip": "Skip"
    }
  }
};

files.forEach(file => {
  const langCode = file.replace('.json', '');
  const filePath = path.join(langDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const t = extendedIntro[langCode] || extendedIntro['en'];
  data.intro = t.intro;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 1), 'utf8');
  console.log(`Fully updated Interactive Intro for ${file}`);
});
