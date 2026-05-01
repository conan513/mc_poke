const fs = require('fs');
const path = require('path');

const langDir = '/mnt/raid/Source/mc_poke/src/public/lang';
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));

const rpgIntro = {
  "hu": {
    "intro": {
      "lang_desc": "Üdvözöllek! Ez a Pokémonok világa! Mielőtt elkezdenénk... ez a te anyanyelved?",
      "confirm_btn": "Igen, mehetünk!",
      "change_btn": "Nyelv módosítása",
      "next": "Tovább",
      "start_btn": "Kezdjük el!",
      "pitch_1_desc": "Ezt a világot Pokémonnak nevezett lények lakják! Van, akinek a Pokémon háziállat... Mások harcra használják őket.",
      "pitch_2_desc": "Jómagam... én hivatásszerűen tanulmányozom a Pokémonokat. És itt, a Cobblemon Universe-ben, mindenkit kaland vár!",
      "pitch_3_desc": "Készen állsz megírni a saját történetedet? Az álmok és kalandok világa vár a Pokémonokkal! Vágjunk bele!",
      "choice_desc": "Most pedig mondd csak... új edző vagy, aki most vág bele, vagy egy visszatérő Pokémon Mester?",
      "new_player_title": "Új Edző",
      "new_player_desc": "Új fiók regisztrálása",
      "returning_player_title": "Visszatérő Mester",
      "returning_player_desc": "Belépés meglévő fiókkal",
      "skip": "Átugrás"
    }
  },
  "en": {
    "intro": {
      "lang_desc": "Hello there! Welcome to the world of Pokemon! Before we begin, is this your preferred language?",
      "confirm_btn": "Yes, let's go!",
      "change_btn": "Change language",
      "next": "Next",
      "start_btn": "Let's Start!",
      "pitch_1_desc": "This world is inhabited by creatures called Pokemon! For some, Pokemon are pets. Others use them for fights.",
      "pitch_2_desc": "Myself... I study Pokemon as a profession. And here, in Cobblemon Universe, adventure awaits everyone!",
      "pitch_3_desc": "Are you ready to write your own story? A world of dreams and adventures with Pokemon awaits! Let's go!",
      "choice_desc": "Now tell me, are you a new trainer just starting out, or a returning Pokemon Master?",
      "new_player_title": "New Trainer",
      "new_player_desc": "Register a new account",
      "returning_player_title": "Returning Master",
      "returning_player_desc": "Login with existing account",
      "skip": "Skip"
    }
  }
};

files.forEach(file => {
  const langCode = file.replace('.json', '');
  const filePath = path.join(langDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const t = rpgIntro[langCode] || rpgIntro['en'];
  data.intro = t.intro;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 1), 'utf8');
  console.log(`Updated RPG Intro for ${file}`);
});
