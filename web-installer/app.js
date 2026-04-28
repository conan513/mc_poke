document.addEventListener('DOMContentLoaded', () => {
  // Config
  const DOWNLOADS = {
    win: './releases/Cobblemon-Universe-Setup-1.0.0.exe',
    winPortable: './releases/Cobblemon-Universe-1.0.0.exe',
    linuxApp: './releases/Cobblemon-Universe-1.0.0.AppImage',
    linuxDeb: './releases/cobblemon-universe_1.0.0_amd64.deb',
    linuxRpm: './releases/cobblemon-universe_1.0.0.x86_64.rpm',
    linuxTar: './releases/cobblemon-universe_1.0.0.tar.gz',
    linuxPacman: './releases/cobblemon-universe_1.0.0.pacman',
    macDmg: './releases/Cobblemon-Universe-1.0.0.dmg',
    macZip: './releases/Cobblemon-Universe-1.0.0.zip'
  };

  let currentLang = 'hu';
  let translations = {};

  // DOM Elements
  const btnDownload = document.getElementById('btn-download-main');
  const osText = document.getElementById('os-detected-text');
  const langBtn = document.getElementById('lang-btn');
  const langDropdown = document.getElementById('lang-dropdown');
  const instructions = document.getElementById('install-instructions');

  // ── Translation Engine ───────────────────────────────────────
  async function loadLanguage(lang) {
    try {
      const response = await fetch(`./lang/${lang}.json?v=1.1`);
      if (!response.ok) throw new Error('Lang not found');
      translations = await response.json();
      currentLang = lang;
      localStorage.setItem('cobble_web_lang', lang);
      updateUI();
    } catch (e) {
      console.error('Translation error:', e);
      if (lang !== 'en') loadLanguage('en'); // Fallback
    }
  }

  function t(key) {
    return key.split('.').reduce((o, i) => o?.[i], translations) || key;
  }

  function updateUI() {
    document.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      el.innerHTML = t(key);
    });
    document.title = t('title');
    detectOS(); // Update button text with current language
    
    // Smooth reveal after first translation
    setTimeout(() => {
      document.body.classList.add('i18n-ready');
    }, 50);
  }

  // Language Switcher Logic
  langBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    langDropdown.classList.toggle('show');
  });

  document.addEventListener('click', () => langDropdown.classList.remove('show'));

  langDropdown.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => loadLanguage(b.dataset.lang));
  });

  // ── OS Detection & Setup ─────────────────────────────────────
  let currentDownloadUrl = '#';

  function detectOS() {
    const ua = navigator.userAgent.toLowerCase();
    let os = 'Unknown';

    if (ua.includes('win')) {
      os = 'Windows';
      currentDownloadUrl = DOWNLOADS.win;
    } else if (ua.includes('mac')) {
      os = 'macOS';
      currentDownloadUrl = DOWNLOADS.macDmg;
    } else if (ua.includes('linux')) {
      os = 'Linux';
      currentDownloadUrl = DOWNLOADS.linuxApp;
    }

    // Update download button text and link
    if (btnDownload) {
       btnDownload.href = currentDownloadUrl;
       const btnText = document.getElementById('btn-download-text');
       if (btnText) {
         btnText.textContent = t('status.download') + " (" + os + ")";
       }
    }
  }

  // Setup alt links
  const altMap = {
    'alt-win': DOWNLOADS.win,
    'alt-win-portable': DOWNLOADS.winPortable,
    'alt-linux-app': DOWNLOADS.linuxApp,
    'alt-linux-deb': DOWNLOADS.linuxDeb,
    'alt-linux-rpm': DOWNLOADS.linuxRpm,
    'alt-linux-tar': DOWNLOADS.linuxTar,
    'alt-linux-pacman': DOWNLOADS.linuxPacman,
    'alt-mac-dmg': DOWNLOADS.macDmg,
    'alt-mac-zip': DOWNLOADS.macZip
  };

  Object.entries(altMap).forEach(([id, url]) => {
    const el = document.getElementById(id);
    if (el) el.href = url;
  });

  // ── Download Button Logic ────────────────────────────────────
  if (btnDownload) {
    btnDownload.addEventListener('click', (e) => {
       // Just let the default link behavior happen (downloading)
       console.log("Starting download for", currentDownloadUrl);
    });
  }

  // ── Server Status Polling ───────────────────────────────────
  async function updateStatus() {
    try {
      const res = await fetch('/', { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      
      const modsEl = document.getElementById('stat-mods');
      const restartEl = document.getElementById('stat-restart');
      
      if (modsEl) modsEl.textContent = data.modCount || '--';
      if (restartEl && data.nextRestart) {
        const d = new Date(data.nextRestart);
        restartEl.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      }

      if (btnDownload) btnDownload.classList.remove('btn-offline');
    } catch (e) {
      if (btnDownload) {
        btnDownload.classList.add('btn-offline');
        const btnText = document.getElementById('btn-download-text');
        if (btnText) btnText.textContent = t('status.offline');
      }
    }
  }

  // ── Init ─────────────────────────────────────────────────────
  const savedLang = localStorage.getItem('cobble_web_lang');
  const browserLang = navigator.language.split('-')[0];
  const initialLang = savedLang || (['hu', 'en', 'de', 'fr', 'es', 'it', 'pt', 'ru', 'nl', 'pl', 'tr', 'zh', 'uk', 'ro'].includes(browserLang) ? browserLang : 'en');
  
  loadLanguage(initialLang);
  setInterval(updateStatus, 30000);
  updateStatus();

  // Smooth scroll for anchor links
  const altTrigger = document.querySelector('.alt-trigger-link');
  if (altTrigger) {
    altTrigger.addEventListener('click', function (e) {
      e.preventDefault();
      const targetId = this.getAttribute('href').slice(1);
      const targetElement = document.getElementById(targetId);
      if (targetElement) {
        const topOffset = targetElement.getBoundingClientRect().top + window.pageYOffset - 20;
        window.scrollTo({
          top: topOffset,
          behavior: 'smooth'
        });
      }
    });
  }
});
