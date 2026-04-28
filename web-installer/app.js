document.addEventListener('DOMContentLoaded', () => {
  // Config
  const DOWNLOADS = {
    win: './releases/Cobblemon%20Universe%20Setup%201.0.0.exe',
    winPortable: './releases/Cobblemon%20Universe%201.0.0.exe',
    linuxApp: './releases/Cobblemon-Universe-1.0.0.AppImage',
    linuxDeb: './releases/cobblemon_universe_1.0.0_amd64.deb',
    linuxRpm: './releases/cobblemon_universe_1.0.0.x86_64.rpm',
    linuxTar: './releases/cobblemon_universe_1.0.0.tar.gz',
    linuxPacman: './releases/cobblemon_universe_1.0.0.pacman',
    macDmg: './releases/Cobblemon%20Universe-1.0.0.dmg',
    macZip: './releases/Cobblemon%20Universe-1.0.0-mac.zip'
  };

  let currentLang = 'hu';
  let translations = {};

  // DOM Elements
  const btn = document.getElementById('main-download-btn');
  const btnText = document.getElementById('btn-text');
  const btnIcon = document.getElementById('btn-icon');
  const osText = document.getElementById('os-detected-text');
  const langBtn = document.getElementById('lang-btn');
  const langDropdown = document.getElementById('lang-dropdown');
  const instructions = document.getElementById('install-instructions');

  // ── Translation Engine ───────────────────────────────────────
  async function loadLanguage(lang) {
    try {
      const response = await fetch(`./lang/${lang}.json`);
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
    let os = 'unknown';
    let icon = '💻';

    if (ua.includes('win')) {
      os = 'Windows';
      currentDownloadUrl = DOWNLOADS.win;
      icon = '🪟';
    } else if (ua.includes('mac')) {
      os = 'macOS';
      currentDownloadUrl = DOWNLOADS.macDmg;
      icon = '🍎';
    } else if (ua.includes('linux')) {
      os = 'Linux';
      currentDownloadUrl = DOWNLOADS.linuxApp;
      icon = '🐧';
    }

    if (osText) osText.innerHTML = `${icon} ${t('status.os_detected')} ${os}`;

    if (btn) {
      btn.classList.remove('loading');
      btnText.textContent = t('status.launch');
      btnIcon.textContent = '🚀';
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

  // ── Protocol Launch Logic ─────────────────────────────────────
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    
    // UI Feedback
    const originalText = btnText.textContent;
    const originalIcon = btnIcon.textContent;
    
    btn.classList.add('loading');
    btnText.textContent = t('status.checking');
    btnIcon.textContent = '🔍';

    // Try protocol
    window.location.href = "cobble://launch";
    
    const start = Date.now();
    let hasBlurred = false;
    const blurHandler = () => { 
      hasBlurred = true; 
      // Launcher started!
      btn.classList.remove('loading');
      btnText.textContent = originalText;
      btnIcon.textContent = originalIcon;
    };
    window.addEventListener('blur', blurHandler);

    setTimeout(() => {
      window.removeEventListener('blur', blurHandler);
      btn.classList.remove('loading');
      
      if (!hasBlurred && (Date.now() - start < 2500)) {
        // App is likely not installed
        btnText.textContent = t('status.download');
        btnIcon.textContent = '📥';
        
        if (confirm(t('status.download_confirm') || "A launcher nem található. Szeretnéd letölteni a telepítőt?")) {
          window.location.href = currentDownloadUrl;
        }
      } else {
        // Restore original state if it worked or blurred
        btnText.textContent = originalText;
        btnIcon.textContent = originalIcon;
      }
    }, 2000);
  });

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

      if (btn) btn.classList.remove('btn-offline');
    } catch (e) {
      if (btn) {
        btn.classList.add('btn-offline');
        btnText.textContent = t('status.offline');
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
});
