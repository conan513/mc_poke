const fs = require('fs');
const path = require('path');

const langDir = '/mnt/raid/Source/mc_poke/src/public/lang';
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));

const translations = {
  "hu": {
    "welcome": {
      "tab_guest": "Vendég (Offline)",
      "tab_account": "Fiók (Online Sync)",
      "password_label": "Jelszó",
      "password_placeholder": "Írd be a jelszavad...",
      "login_btn": "Belépés",
      "register_btn": "Regisztráció",
      "online_hint": "Fiók mód – Biztonságos profil szinkronizáció"
    },
    "toast": {
      "fill_all_fields": "Kérlek tölts ki minden mezőt!",
      "login_success": "Sikeres bejelentkezés!"
    }
  },
  "en": {
    "welcome": {
      "tab_guest": "Guest (Offline)",
      "tab_account": "Account (Online Sync)",
      "password_label": "Password",
      "password_placeholder": "Enter your password...",
      "login_btn": "Login",
      "register_btn": "Register",
      "online_hint": "Account Mode – Secure profile synchronization"
    },
    "toast": {
      "fill_all_fields": "Please fill in all fields!",
      "login_success": "Login successful!"
    }
  },
  "de": {
    "welcome": {
      "tab_guest": "Gast (Offline)",
      "tab_account": "Konto (Online-Sync)",
      "password_label": "Passwort",
      "password_placeholder": "Passwort eingeben...",
      "login_btn": "Einloggen",
      "register_btn": "Registrieren",
      "online_hint": "Konto-Modus – Sichere Profilsynchronisation"
    },
    "toast": {
      "fill_all_fields": "Bitte füllen Sie alle Felder aus!",
      "login_success": "Anmeldung erfolgreich!"
    }
  },
  "fr": {
    "welcome": {
      "tab_guest": "Invité (Hors ligne)",
      "tab_account": "Compte (Sync en ligne)",
      "password_label": "Mot de passe",
      "password_placeholder": "Entrez le mot de passe...",
      "login_btn": "Connexion",
      "register_btn": "S'inscrire",
      "online_hint": "Mode compte – Synchronisation sécurisée"
    },
    "toast": {
      "fill_all_fields": "Veuillez remplir tous les champs !",
      "login_success": "Connexion réussie !"
    }
  },
  "es": {
    "welcome": {
      "tab_guest": "Invitado (Offline)",
      "tab_account": "Cuenta (Sincronización)",
      "password_label": "Contraseña",
      "password_placeholder": "Introducir contraseña...",
      "login_btn": "Entrar",
      "register_btn": "Registrarse",
      "online_hint": "Modo cuenta – Sincronización segura"
    },
    "toast": {
      "fill_all_fields": "¡Por favor, rellena todos los campos!",
      "login_success": "¡Inicio de sesión con éxito!"
    }
  },
  "ru": {
    "welcome": {
      "tab_guest": "Гость (Оффлайн)",
      "tab_account": "Аккаунт (Синхронизация)",
      "password_label": "Пароль",
      "password_placeholder": "Введите пароль...",
      "login_btn": "Войти",
      "register_btn": "Регистрация",
      "online_hint": "Режим аккаунта – Безопасная синхронизация"
    },
    "toast": {
      "fill_all_fields": "Пожалуйста, заполните все поля!",
      "login_success": "Успешный вход!"
    }
  }
};

files.forEach(file => {
  const langCode = file.replace('.json', '');
  const filePath = path.join(langDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const t = translations[langCode] || translations['en'];

  // Update Welcome
  if (!data.welcome) data.welcome = {};
  Object.assign(data.welcome, t.welcome);

  // Update Toast
  if (!data.toast) data.toast = {};
  Object.assign(data.toast, t.toast);

  // Ensure whitelisting key exists
  if (!data.toast.whitelisting) {
    data.toast.whitelisting = translations[langCode]?.toast?.whitelisting || translations['en'].toast.whitelisting || "Registering on whitelist...";
  }

  fs.writeFileSync(filePath, JSON.stringify(data, null, 1), 'utf8');
  console.log(`Updated ${file}`);
});
