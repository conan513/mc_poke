document.addEventListener('DOMContentLoaded', () => {
  // Beállítások: Ide írd a tényleges letöltési linkeket (pl. webtárhely URL, GitHub Releases link, stb.)
  const DOWNLOADS = {
    windows: './releases/CobbleLauncher%20Setup%201.0.0.exe',
    linuxAppImage: './releases/CobbleLauncher-1.0.0.AppImage',
    linuxDeb: './releases/cobble_launcher_1.0.0_amd64.deb'
  };

  const btn = document.getElementById('main-download-btn');
  const btnText = document.getElementById('btn-text');
  const btnIcon = document.getElementById('btn-icon');
  const osText = document.getElementById('os-detected-text');
  const instructions = document.getElementById('install-instructions');

  // Basic OS detection
  const platform = navigator.userAgent.toLowerCase();
  let os = 'unknown';

  if (platform.includes('win')) {
    os = 'windows';
  } else if (platform.includes('mac')) {
    os = 'mac';
  } else if (platform.includes('linux')) {
    os = 'linux';
  }

  let downloadUrl = '';
  let osLabel = '';
  let icon = '';

  switch (os) {
    case 'windows':
      downloadUrl = DOWNLOADS.windows;
      osLabel = 'Kattints az Indításra a játék futtatásához!';
      icon = '🪟';
      break;
    case 'linux':
      downloadUrl = DOWNLOADS.linuxAppImage;
      osLabel = 'Kattints az Indításra a játék futtatásához!';
      icon = '🐧';
      break;
    case 'mac':
      downloadUrl = '#'; // Fallback
      osLabel = 'Sajnos macOS-re jelenleg nincs támogatás.';
      icon = '🍎';
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      break;
    default:
      downloadUrl = DOWNLOADS.windows;
      osLabel = 'Kattints az Indításra a játék futtatásához!';
      icon = '💻';
      break;
  }

  // Update UI to show Play Button
  setTimeout(() => {
    btn.classList.remove('loading');
    btnText.textContent = 'Játék Indítása';
    btnIcon.textContent = '🚀';
    osText.innerHTML = `${icon} ${osLabel}`;

    // Set alternative links
    const altWin = document.getElementById('alt-win');
    const altLinuxApp = document.getElementById('alt-linux-app');
    const altLinuxDeb = document.getElementById('alt-linux-deb');
    if(altWin) altWin.href = DOWNLOADS.windows;
    if(altLinuxApp) altLinuxApp.href = DOWNLOADS.linuxAppImage;
    if(altLinuxDeb) altLinuxDeb.href = DOWNLOADS.linuxDeb;
  }, 500); // small delay for nice animation effect

  // ── Server Status Check ─────────────────────────────────────
  async function checkServerStatus() {
    try {
      // We fetch / with application/json to get the manifest summary instead of HTML
      const res = await fetch('/', { headers: { 'Accept': 'application/json' } });
      const data = await res.json();
      
      const statusIndicator = document.createElement('div');
      statusIndicator.className = 'server-status-tag';
      
      if (data.status === 'running') {
        statusIndicator.innerHTML = '<span class="status-dot online"></span> Szerver ONLINE';
        btn.classList.remove('btn-offline');
      } else {
        statusIndicator.innerHTML = '<span class="status-dot offline"></span> Szerver OFFLINE';
        btn.classList.add('btn-offline');
        btnText.textContent = 'Szerver Offline';
      }
      
      // Fill stats
      if (data.modCount) document.getElementById('stat-mods').textContent = data.modCount;
      if (data.nextRestart) {
        const restartDate = new Date(data.nextRestart);
        document.getElementById('stat-restart').textContent = restartDate.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' });
      }

      // Insert before subtitle
      const subtitle = document.querySelector('.subtitle');
      if (subtitle) subtitle.parentNode.insertBefore(statusIndicator, subtitle);
      
    } catch (e) {
      console.warn('Nem sikerült elérni a szerver állapotot:', e);
    }
  }
  checkServerStatus();

  // Protocol Launch Logic
  btn.addEventListener('click', (e) => {
    if (os === 'mac') return; // Not supported
    
    // We set a timeout. If the window still has focus after 2 seconds, 
    // it means the protocol prompt didn't show up, so the app is likely not installed.
    const start = Date.now();
    let hasBlurred = false;

    const blurHandler = () => {
      hasBlurred = true;
    };
    window.addEventListener('blur', blurHandler);

    setTimeout(() => {
      window.removeEventListener('blur', blurHandler);
      // If user didn't leave the window (no app prompt appeared)
      if (!hasBlurred && (Date.now() - start < 2500)) {
        // App is probably not installed, let's offer download
        btnIcon.textContent = '⬇️';
        btnText.textContent = 'Telepítő Letöltése';
        osText.innerHTML = `Nincs telepítve a CobbleLauncher! Letöltés indul...`;
        
        // Start download automatically
        window.location.href = downloadUrl;
        
        instructions.innerHTML = `
          <h3>🚀 Hogyan telepítsd?</h3>
          <p>1. Töltsd le a telepítőt.<br>
             2. Futtaszt, majd kövesd az utasításokat.<br>
             3. Miután kész, próbáld újra megnyomni az Indítás gombot az oldalon!</p>
        `;
      } else {
        // App probably opened
        btnIcon.textContent = '🎮';
        btnText.textContent = 'Játék elindítva!';
        osText.innerHTML = `Jó játékot!`;
      }
    }, 2000);
  });
});
