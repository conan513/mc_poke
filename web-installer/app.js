document.addEventListener('DOMContentLoaded', () => {
  // Config
  const GH = 'https://github.com/conan513/mc_poke/releases/download/v1'
  const DOWNLOADS = {
    win:                `${GH}/Cobblemon-Universe-Setup-x64.exe`,
    winArm64:           `${GH}/Cobblemon-Universe-Setup-arm64.exe`,
    winPortable:        `${GH}/Cobblemon-Universe-x64.exe`,
    winPortableArm64:   `${GH}/Cobblemon-Universe-arm64.exe`,
    linuxApp:           `${GH}/Cobblemon-Universe-x86_64.AppImage`,
    linuxAppArm64:      `${GH}/Cobblemon-Universe-arm64.AppImage`,
    linuxDeb:           `${GH}/Cobblemon-Universe-amd64.deb`,
    linuxRpm:           `${GH}/Cobblemon-Universe-x86_64.rpm`,
    linuxTar:           `${GH}/Cobblemon-Universe-x64.tar.gz`,
    linuxTarArm64:      `${GH}/Cobblemon-Universe-arm64.tar.gz`,
    linuxPacman:        `${GH}/Cobblemon-Universe-x64.pacman`,
    macDmg:             `${GH}/Cobblemon-Universe-x64.dmg`,
    macDmgArm64:        `${GH}/Cobblemon-Universe-arm64.dmg`,
    macZip:             `${GH}/Cobblemon-Universe-x64.zip`,
    macZipArm64:        `${GH}/Cobblemon-Universe-arm64.zip`,
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
      os = t('os.win');
      // Detect ARM Windows (Snapdragon X Elite etc)
      if (ua.includes('arm64') || ua.includes('arm;')) {
        os = t('os.win_arm');
        currentDownloadUrl = DOWNLOADS.winArm64;
      } else {
        currentDownloadUrl = DOWNLOADS.win;
      }
    } else if (ua.includes('mac')) {
      os = t('os.mac');
      // Detect Apple Silicon
      if (ua.includes('mac os x') && (ua.includes('arm64') || navigator.maxTouchPoints > 0)) {
        os = t('os.mac_silicon');
        currentDownloadUrl = DOWNLOADS.macDmgArm64;
      } else {
        os = t('os.mac_intel');
        currentDownloadUrl = DOWNLOADS.macDmg;
      }
    } else if (ua.includes('linux')) {
      os = t('os.linux');
      if (isArm) {
        os = t('os.linux_arm');
        currentDownloadUrl = DOWNLOADS.linuxAppArm64;
      } else {
        currentDownloadUrl = DOWNLOADS.linuxApp;
      }
    } else {
      os = t('os.unknown');
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
        modListContent.innerHTML = `<p style="text-align:center;color:var(--accent-red)">${t('modal.error_mods')}</p>`;
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
      modListContent.innerHTML = `<p style="text-align:center;color:#888">${t('modal.no_mods')}</p>`;
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
        restartEl.textContent = t('status.now');
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
          playerCount.title = t('status.no_players');
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

  // ── Pokemon Showcase Logic ────────────────────────────────────
  const showcasePokemons = [
    { name: "Charizard (Mega X)", sprite: "charizard-megax", descKey: "showcase.desc_charizard" },
    { name: "Rayquaza", sprite: "rayquaza", descKey: "showcase.desc_rayquaza" },
    { name: "Greninja", sprite: "greninja", descKey: "showcase.desc_greninja" },
    { name: "Lucario (Mega)", sprite: "lucario-mega", descKey: "showcase.desc_lucario" },
    { name: "Gengar", sprite: "gengar", descKey: "showcase.desc_gengar" }
  ];

  function randomizeShowcase() {
    const p = showcasePokemons[Math.floor(Math.random() * showcasePokemons.length)];
    const img = document.getElementById('showcase-sprite');
    const nameEl = document.getElementById('showcase-name');
    const descEl = document.querySelector('.showcase-info p');
    
    if (img && nameEl && descEl) {
      img.src = `https://play.pokemonshowdown.com/sprites/xyani/${p.sprite}.gif`;
      nameEl.textContent = p.name;
      descEl.setAttribute('data-i18n', p.descKey);
      descEl.innerHTML = t(p.descKey);
    }
  }
  randomizeShowcase();

  // ── Daily Rewards Logic ───────────────────────────────────────
  const btnClaim = document.getElementById('btn-claim-reward');
  const inputReward = document.getElementById('reward-username');
  const rewardStatus = document.getElementById('reward-status');

  if (btnClaim) {
    btnClaim.addEventListener('click', async () => {
      const username = inputReward.value.trim();
      if (username.length < 3) {
        rewardStatus.className = 'reward-status error';
        rewardStatus.textContent = t('rewards.error_name') || 'Érvénytelen név!';
        return;
      }

      btnClaim.disabled = true;
      btnClaim.innerHTML = '<div class="loading-spinner small" style="margin:0; width:20px; height:20px;"></div>';

      try {
        const res = await fetch('/api/rewards/claim', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username })
        });
        const data = await res.json();

        if (res.ok) {
          rewardStatus.className = 'reward-status success';
          rewardStatus.textContent = data.message || t('rewards.success') || 'Sikeres begyűjtés!';
          inputReward.value = '';
        } else {
          rewardStatus.className = 'reward-status error';
          rewardStatus.textContent = data.error || 'Hiba történt.';
        }
      } catch (e) {
        rewardStatus.className = 'reward-status error';
        rewardStatus.textContent = t('rewards.error_network');
      } finally {
        btnClaim.disabled = false;
        btnClaim.innerHTML = `<span data-i18n="rewards.btn">${t('rewards.btn') || 'Begyűjtés'}</span>`;
      }
    });
  }

  // ── Leaderboard Logic ─────────────────────────────────────────
  async function fetchLeaderboard() {
    const tbody = document.getElementById('leaderboard-body');
    if (!tbody) return;

    try {
      const res = await fetch('/api/leaderboard');
      const data = await res.json();

      if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888;">${t('leaderboard.empty') || 'Még nincsenek adatok.'}</td></tr>`;
        return;
      }

      let html = '';
      data.forEach((p, index) => {
        const rankClass = index < 3 ? `rank-${index + 1}` : '';
        const rankContent = index < 3 ? `<span class="rank-badge ${rankClass}">${index + 1}</span>` : index + 1;
        html += `
          <tr>
            <td>${rankContent}</td>
            <td style="font-weight: 600;">${p.username}</td>
            <td style="color: var(--accent-yellow);">${p.playtime} óra</td>
          </tr>
        `;
      });
      tbody.innerHTML = html;
    } catch (e) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--accent-red);">${t('leaderboard.error') || 'Hiba a betöltéskor.'}</td></tr>`;
    }
  }

  fetchLeaderboard();
  setInterval(fetchLeaderboard, 300000);
});
