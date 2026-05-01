const fs = require('fs');
const path = require('path');

const langDir = '/mnt/raid/Source/mc_poke/src/public/lang';
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));

const extraTranslations = {
  "hu": {
    "welcome": {
      "confirm_password_label": "Jelszó megerősítése",
      "confirm_password_placeholder": "Írd be a jelszavad újra...",
      "no_account": "Nincs még fiókod?",
      "have_account": "Már van fiókod?",
      "go_to_register": "Regisztráció",
      "go_to_login": "Bejelentkezés"
    },
    "toast": {
      "passwords_dont_match": "A két jelszó nem egyezik!"
    }
  },
  "en": {
    "welcome": {
      "confirm_password_label": "Confirm Password",
      "confirm_password_placeholder": "Enter password again...",
      "no_account": "Don't have an account?",
      "have_account": "Already have an account?",
      "go_to_register": "Register",
      "go_to_login": "Login"
    },
    "toast": {
      "passwords_dont_match": "Passwords don't match!"
    }
  },
  "de": {
    "welcome": {
      "confirm_password_label": "Passwort bestätigen",
      "confirm_password_placeholder": "Passwort erneut eingeben...",
      "no_account": "Noch kein Konto?",
      "have_account": "Bereits ein Konto?",
      "go_to_register": "Registrieren",
      "go_to_login": "Einloggen"
    },
    "toast": {
      "passwords_dont_match": "Passwörter stimmen nicht überein!"
    }
  }
  // ... more can be added, others will fallback to English
};

files.forEach(file => {
  const langCode = file.replace('.json', '');
  const filePath = path.join(langDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const t = extraTranslations[langCode] || extraTranslations['en'];

  if (!data.welcome) data.welcome = {};
  Object.assign(data.welcome, t.welcome);

  if (!data.toast) data.toast = {};
  Object.assign(data.toast, t.toast);

  fs.writeFileSync(filePath, JSON.stringify(data, null, 1), 'utf8');
  console.log(`Updated UI extras for ${file}`);
});
