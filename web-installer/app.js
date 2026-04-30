document.addEventListener('DOMContentLoaded', () => {
  // Config
  const DOWNLOADS = {
    win: './releases/Cobblemon-Universe-Setup.exe',
    winArm64: './releases/Cobblemon-Universe-arm64-Setup.exe',
    winPortable: './releases/Cobblemon-Universe.exe',
    winPortableArm64: './releases/Cobblemon-Universe-arm64.exe',
    linuxApp: './releases/Cobblemon-Universe-x86_64.AppImage',
    linuxAppArm64: './releases/Cobblemon-Universe-arm64.AppImage',
    linuxDeb: './releases/Cobblemon-Universe-x86_64.deb',
    linuxRpm: './releases/Cobblemon-Universe-x86_64.rpm',
    linuxTar: './releases/Cobblemon-Universe-x86_64.tar.gz',
    linuxTarArm64: './releases/Cobblemon-Universe-arm64.tar.gz',
    linuxPacman: './releases/Cobblemon-Universe-x86_64.pacman',
    macDmg: './releases/Cobblemon-Universe-x64.dmg',
    macDmgArm64: './releases/Cobblemon-Universe-arm64.dmg',
    macZip: './releases/Cobblemon-Universe-x64.zip',
    macZipArm64: './releases/Cobblemon-Universe-arm64.zip'
  };

  let currentLang = 'hu';
  let translations = {};

  // DOM Elements
  const btnDownload = document.getElementById('btn-download-main');
  const osText = document.getElementById('os-detected-text');
  const langBtn = document.getElementById('lang-btn');
  const langDropdown = document.getElementById('lang-dropdown');
  const instructions = document.getElementById('install-instructions');
  
  // Modal Elements
  const modModal = document.getElementById('mod-modal');
  const modModalClose = document.getElementById('modal-close');
  const modModsContainer = document.getElementById('stat-mods-container');
  const modListContent = document.getElementById('mod-list-container');

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
    let isArm = ua.includes('arm') || ua.includes('aarch64');

    if (ua.includes('win')) {
      os = 'Windows';
      // Detect ARM Windows (Snapdragon X Elite etc)
      if (ua.includes('arm64') || ua.includes('arm;')) {
        os = 'Windows ARM';
        currentDownloadUrl = DOWNLOADS.winArm64;
      } else {
        currentDownloadUrl = DOWNLOADS.win;
      }
    } else if (ua.includes('mac')) {
      os = 'macOS';
      // Detect Apple Silicon
      if (ua.includes('mac os x') && (ua.includes('arm64') || navigator.maxTouchPoints > 0)) {
        os = 'macOS (Apple Silicon)';
        currentDownloadUrl = DOWNLOADS.macDmgArm64;
      } else {
        os = 'macOS (Intel)';
        currentDownloadUrl = DOWNLOADS.macDmg;
      }
    } else if (ua.includes('linux')) {
      os = 'Linux';
      if (isArm) {
        os = 'Linux ARM';
        currentDownloadUrl = DOWNLOADS.linuxAppArm64;
      } else {
        currentDownloadUrl = DOWNLOADS.linuxApp;
      }
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
    'alt-win-arm64': DOWNLOADS.winArm64,
    'alt-win-portable': DOWNLOADS.winPortable,
    'alt-win-portable-arm64': DOWNLOADS.winPortableArm64,
    'alt-linux-app': DOWNLOADS.linuxApp,
    'alt-linux-app-arm64': DOWNLOADS.linuxAppArm64,
    'alt-linux-deb': DOWNLOADS.linuxDeb,
    'alt-linux-rpm': DOWNLOADS.linuxRpm,
    'alt-linux-tar': DOWNLOADS.linuxTar,
    'alt-linux-tar-arm64': DOWNLOADS.linuxTarArm64,
    'alt-linux-pacman': DOWNLOADS.linuxPacman,
    'alt-mac-dmg': DOWNLOADS.macDmg,
    'alt-mac-dmg-arm64': DOWNLOADS.macDmgArm64,
    'alt-mac-zip': DOWNLOADS.macZip,
    'alt-mac-zip-arm64': DOWNLOADS.macZipArm64
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

  // ── Modal Logic ──────────────────────────────────────────────
  let modsData = [];

  async function openModModal() {
    modModal.classList.add('show');
    document.body.style.overflow = 'hidden';

    if (modsData.length === 0) {
      try {
        const res = await fetch('/manifest');
        const data = await res.json();
        // Csak a .jar fájlokat tekintjük modnak a listában
        modsData = (data.mods || []).filter(m => m.filename.endsWith('.jar'));
        renderModList();
      } catch (e) {
        modListContent.innerHTML = '<p style="text-align:center;color:var(--accent-red)">Hiba a lista betöltésekor.</p>';
      }
    } else {
      renderModList();
    }
  }

  function closeModModal() {
    modModal.classList.remove('show');
    document.body.style.overflow = '';
  }

  function renderModList() {
    if (modsData.length === 0) {
      modListContent.innerHTML = '<p style="text-align:center;color:#888">Nincsenek modok.</p>';
      return;
    }

    const listHtml = modsData.map(m => `
      <div class="mod-list-item">
        <span class="mod-name">${m.filename}</span>
        <span class="mod-size">${(m.size / 1024 / 1024).toFixed(2)} MB</span>
      </div>
    `).join('');

    modListContent.innerHTML = `<div class="mod-list">${listHtml}</div>`;
  }

  if (modModsContainer) modModsContainer.addEventListener('click', openModModal);
  if (modModalClose) modModalClose.addEventListener('click', closeModModal);
  if (modModal) modModal.addEventListener('click', (e) => {
    if (e.target === modModal) closeModModal();
  });

  // ── Countdown Timer ──────────────────────────────────────────
  let countdownInterval = null;

  function startCountdown(targetTime) {
    if (countdownInterval) clearInterval(countdownInterval);
    
    const restartEl = document.getElementById('stat-restart');
    if (!restartEl) return;

    function update() {
      const now = new Date().getTime();
      const diff = targetTime - now;

      if (diff <= 0) {
        restartEl.textContent = "NOW";
        clearInterval(countdownInterval);
        return;
      }

      const h = Math.floor(diff / (1000 * 60 * 60));
      const m = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const s = Math.floor((diff % (1000 * 60)) / 1000);

      restartEl.textContent = `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }

    update();
    countdownInterval = setInterval(update, 1000);
  }

  // ── Server Status Polling ───────────────────────────────────
  async function updateStatus() {
    try {
      const res = await fetch('/', { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      
      const modsEl = document.getElementById('stat-mods');
      const restartEl = document.getElementById('stat-restart');
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      const playerCount = document.getElementById('player-count');
      const playerCountVal = document.getElementById('player-count-val');
      
      if (modsEl) modsEl.textContent = data.modCount || '--';
      if (data.nextRestart) {
        startCountdown(new Date(data.nextRestart).getTime());
      }

      if (statusDot) {
        statusDot.classList.remove('offline');
        statusDot.classList.add('online');
      }
      if (statusText) statusText.textContent = t('status.online');

      // Online játékosszám beállítása
      if (playerCount && playerCountVal && typeof data.playersOnline !== 'undefined') {
        playerCount.style.display = 'inline-block';
        playerCountVal.textContent = data.playersOnline;
        
        // Játékosnevek listázása tooltipként, ha van legalább 1
        if (data.players && data.players.length > 0) {
          playerCount.title = 'Online: ' + data.players.join(', ');
        } else {
          playerCount.title = 'Nincs játékos online';
        }
      }

      if (btnDownload) btnDownload.classList.remove('btn-offline');
    } catch (e) {
      const statusDot = document.getElementById('status-dot');
      const statusText = document.getElementById('status-text');
      const playerCount = document.getElementById('player-count');
      
      if (statusDot) {
        statusDot.classList.remove('online');
        statusDot.classList.add('offline');
      }
      if (statusText) statusText.textContent = t('status.offline');
      
      if (playerCount) playerCount.style.display = 'none';

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

  // Robust Smooth Scroll (Event Delegation)
  // Handles both local "#hash" hrefs AND full external URLs that contain a hash
  // pointing to an element on the current page (e.g. http://host/#alternatives).
  document.addEventListener('click', function (e) {
    const trigger = e.target.closest('a[href]');
    if (!trigger) return;

    const href = trigger.getAttribute('href') || '';

    // Determine the hash fragment (works for both "#foo" and "http://.../#foo")
    let hash = '';
    if (href.startsWith('#')) {
      hash = href.slice(1);
    } else {
      try {
        const url = new URL(href, window.location.href);
        // Only intercept if the hash fragment resolves to an element on THIS page
        if (url.hash) hash = url.hash.slice(1);
      } catch (_) { /* invalid URL, ignore */ }
    }

    if (!hash) return;

    const targetElement = document.getElementById(hash);
    if (!targetElement) return;

    // We have a matching on-page element → smooth scroll instead of navigating
    e.preventDefault();

    window.scrollTo({
      top: targetElement.offsetTop - 20,
      behavior: 'smooth'
    });

    // Fallback: if smooth scroll is blocked/slow, jump directly
    setTimeout(() => {
      if (Math.abs(window.pageYOffset - (targetElement.offsetTop - 20)) > 100) {
        targetElement.scrollIntoView();
      }
    }, 600);
  });
});
