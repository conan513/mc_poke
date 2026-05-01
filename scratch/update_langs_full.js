const fs = require('fs');
const path = require('path');

const langDir = '/mnt/raid/Source/mc_poke/src/public/lang';
const files = fs.readdirSync(langDir).filter(f => f.endsWith('.json'));

const allTranslations = {
  "hu": { "tab_guest": "Vendég (Offline)", "tab_account": "Fiók (Online Sync)", "password_label": "Jelszó", "password_placeholder": "Írd be a jelszavad...", "login_btn": "Belépés", "register_btn": "Regisztráció", "offline_hint": "Offline mód – nem szükséges Microsoft fiók", "online_hint": "Fiók mód – Biztonságos profil szinkronizáció", "fill_all_fields": "Kérlek tölts ki minden mezőt!", "login_success": "Sikeres bejelentkezés!" },
  "en": { "tab_guest": "Guest (Offline)", "tab_account": "Account (Online Sync)", "password_label": "Password", "password_placeholder": "Enter your password...", "login_btn": "Login", "register_btn": "Register", "offline_hint": "Offline mode – no Microsoft account required", "online_hint": "Account Mode – Secure profile synchronization", "fill_all_fields": "Please fill in all fields!", "login_success": "Login successful!" },
  "de": { "tab_guest": "Gast (Offline)", "tab_account": "Konto (Online-Sync)", "password_label": "Passwort", "password_placeholder": "Passwort eingeben...", "login_btn": "Einloggen", "register_btn": "Registrieren", "offline_hint": "Offline-Modus – kein Microsoft-Konto erforderlich", "online_hint": "Konto-Modus – Sichere Profilsynchronisation", "fill_all_fields": "Bitte füllen Sie alle Felder aus!", "login_success": "Anmeldung erfolgreich!" },
  "fr": { "tab_guest": "Invité (Hors ligne)", "tab_account": "Compte (Sync en ligne)", "password_label": "Mot de passe", "password_placeholder": "Entrez le mot de passe...", "login_btn": "Connexion", "register_btn": "S'inscrire", "online_hint": "Mode compte – Synchronisation sécurisée", "fill_all_fields": "Veuillez remplir tous les champs !", "login_success": "Connexion réussie !" },
  "es": { "tab_guest": "Invitado (Offline)", "tab_account": "Cuenta (Sincronización)", "password_label": "Contraseña", "password_placeholder": "Introducir contraseña...", "login_btn": "Entrar", "register_btn": "Registrarse", "online_hint": "Modo cuenta – Sincronización segura", "fill_all_fields": "¡Por favor, rellena todos los campos!", "login_success": "¡Inicio de sesión con éxito!" },
  "ru": { "tab_guest": "Гость (Оффлайн)", "tab_account": "Аккаунт (Синхронизация)", "password_label": "Пароль", "password_placeholder": "Введите пароль...", "login_btn": "Войти", "register_btn": "Регистрация", "online_hint": "Режим аккаунта – Безопасная синхронизация", "fill_all_fields": "Пожалуйста, заполните все поля!", "login_success": "Успешный вход!" },
  "pt": { "tab_guest": "Convidado (Offline)", "tab_account": "Conta (Sincronização)", "password_label": "Senha", "password_placeholder": "Digite sua senha...", "login_btn": "Entrar", "register_btn": "Registrar", "online_hint": "Modo Conta – Sincronização segura", "fill_all_fields": "Por favor, preencha todos os campos!", "login_success": "Login realizado com sucesso!" },
  "it": { "tab_guest": "Ospite (Offline)", "tab_account": "Account (Sincronizzazione)", "password_label": "Password", "password_placeholder": "Inserisci password...", "login_btn": "Accedi", "register_btn": "Registrati", "online_hint": "Modalità account – Sincronizzazione sicura", "fill_all_fields": "Per favore, compila tutti i campi!", "login_success": "Accesso riuscito!" },
  "nl": { "tab_guest": "Gast (Offline)", "tab_account": "Account (Sync)", "password_label": "Wachtwoord", "password_placeholder": "Wachtwoord invoeren...", "login_btn": "Inloggen", "register_btn": "Registreren", "online_hint": "Account-modus – Veilige synchronisatie", "fill_all_fields": "Vul a.u.b. alle velden in!", "login_success": "Inloggen geslaagd!" },
  "pl": { "tab_guest": "Gość (Offline)", "tab_account": "Konto (Sync)", "password_label": "Hasło", "password_placeholder": "Wpisz hasło...", "login_btn": "Zaloguj", "register_btn": "Zarejestruj", "online_hint": "Tryb konta – Bezpieczna synchronizacja", "fill_all_fields": "Proszę wypełnić wszystkie pola!", "login_success": "Logowanie zakończone sukcesem!" },
  "tr": { "tab_guest": "Misafir (Çevrimdışı)", "tab_account": "Hesap (Senkronizasyon)", "password_label": "Şifre", "password_placeholder": "Şifreyi girin...", "login_btn": "Giriş", "register_btn": "Kayıt Ol", "online_hint": "Hesap Modu – Güvenli senkronizasyon", "fill_all_fields": "Lütfen tüm alanları doldurun!", "login_success": "Giriş başarılı!" },
  "ro": { "tab_guest": "Oaspete (Offline)", "tab_account": "Cont (Sincronizare)", "password_label": "Parolă", "password_placeholder": "Introdu parola...", "login_btn": "Autentificare", "register_btn": "Înregistrare", "online_hint": "Mod Cont – Sincronizare securizată", "fill_all_fields": "Vă rugăm să completați toate câmpurile!", "login_success": "Autentificare reușită!" },
  "cs": { "tab_guest": "Host (Offline)", "tab_account": "Účet (Synchronizace)", "password_label": "Heslo", "password_placeholder": "Zadejte heslo...", "login_btn": "Přihlásit se", "register_btn": "Registrovat", "online_hint": "Režim účtu – Bezpečná synchronizace", "fill_all_fields": "Prosím vyplňte všechna pole!", "login_success": "Přihlášení úspěšné!" },
  "da": { "tab_guest": "Gæst (Offline)", "tab_account": "Konto (Sync)", "password_label": "Adgangskode", "password_placeholder": "Indtast adgangskode...", "login_btn": "Log ind", "register_btn": "Registrer", "online_hint": "Konto-tilstand – Sikker synkronisering", "fill_all_fields": "Udfyld venligst alle felter!", "login_success": "Login lykkedes!" },
  "no": { "tab_guest": "Gjest (Offline)", "tab_account": "Konto (Synk)", "password_label": "Passord", "password_placeholder": "Skriv inn passord...", "login_btn": "Logg inn", "register_btn": "Registrer", "online_hint": "Konto-modus – Sikker synkronisering", "fill_all_fields": "Vennligst fyll ut alle felt!", "login_success": "Innlogging vellykket!" },
  "sv": { "tab_guest": "Gäst (Offline)", "tab_account": "Konto (Synk)", "password_label": "Lösenord", "password_placeholder": "Ange lösenord...", "login_btn": "Logga in", "register_btn": "Registrera", "online_hint": "Konto-läge – Säker synkronisering", "fill_all_fields": "Vänligen fyll i alla fält!", "login_success": "Inloggning lyckades!" },
  "fi": { "tab_guest": "Vieras (Offline)", "tab_account": "Tili (Synkronointi)", "password_label": "Salasana", "password_placeholder": "Syötä salasana...", "login_btn": "Kirjaudu", "register_btn": "Rekisteröidy", "online_hint": "Tilitila – Turvallinen synkronointi", "fill_all_fields": "Täytä kaikki kentät!", "login_success": "Kirjautuminen onnistui!" },
  "ja": { "tab_guest": "ゲスト (オフライン)", "tab_account": "アカウント (同期)", "password_label": "パスワード", "password_placeholder": "パスワードを入力...", "login_btn": "ログイン", "register_btn": "新規登録", "online_hint": "アカウントモード – 安全な同期", "fill_all_fields": "すべての項目を入力してください！", "login_success": "ログインに成功しました！" },
  "ko": { "tab_guest": "게스트 (오프라인)", "tab_account": "계정 (동기화)", "password_label": "비밀번호", "password_placeholder": "비밀번호 입력...", "login_btn": "로그인", "register_btn": "회원가입", "online_hint": "계정 모드 – 안전한 프로필 동기화", "fill_all_fields": "모든 필드를 채워주세요!", "login_success": "로그인 성공!" },
  "zh": { "tab_guest": "访客 (离线)", "tab_account": "账号 (同步)", "password_label": "密码", "password_placeholder": "输入密码...", "login_btn": "登录", "register_btn": "注册", "online_hint": "账号模式 – 安全配置文件同步", "fill_all_fields": "请填写所有字段！", "login_success": "登录成功！" },
  "uk": { "tab_guest": "Гість (Офлайн)", "tab_account": "Акаунт (Синхронізація)", "password_label": "Пароль", "password_placeholder": "Введіть пароль...", "login_btn": "Увійти", "register_btn": "Реєстрація", "online_hint": "Режим акаунта – Безпечна синхронізація", "fill_all_fields": "Будь ласка, заповніть усі поля!", "login_success": "Успішний вхід!" }
};

files.forEach(file => {
  const langCode = file.replace('.json', '');
  const filePath = path.join(langDir, file);
  const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));

  const t = allTranslations[langCode] || allTranslations['en'];

  // Welcome section
  if (!data.welcome) data.welcome = {};
  data.welcome.tab_guest = t.tab_guest;
  data.welcome.tab_account = t.tab_account;
  data.welcome.password_label = t.password_label;
  data.welcome.password_placeholder = t.password_placeholder;
  data.welcome.login_btn = t.login_btn;
  data.welcome.register_btn = t.register_btn;
  data.welcome.online_hint = t.online_hint;

  // Toast section
  if (!data.toast) data.toast = {};
  data.toast.fill_all_fields = t.fill_all_fields;
  data.toast.login_success = t.login_success;

  fs.writeFileSync(filePath, JSON.stringify(data, null, 1), 'utf8');
  console.log(`Fully translated ${file}`);
});
