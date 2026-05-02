const $id = (id) => document.getElementById(id)

// ── UUID Polyfill (works on HTTP without HTTPS/Electron) ──────
function generateUUID() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback for HTTP / older browsers
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

// ── On-Screen Logger ──────────────────────────────────────────
function logToScreen(msg, type = 'info') {
  const log = $id('intro-debug-log')
  if (!log) return
  const entry = document.createElement('div')
  entry.className = `debug-entry debug-${type}`
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${msg}`
  log.appendChild(entry)
  log.scrollTop = log.scrollHeight
}

// Override console for easier debugging on screen
const _log = console.log;
const _err = console.error;
console.log = (...args) => { _log(...args); logToScreen(args.join(' '), 'info'); }
console.error = (...args) => { _err(...args); logToScreen(args.join(' '), 'error'); }
window.onerror = (m, s, l, c, e) => { console.error(`${m} at ${s}:${l}`); }

// ── State ────────────────────────────────────────────────────
let selectedRam = localStorage.getItem('cobble_ram') || '4096'
let username = localStorage.getItem('cobble_username') || ''
let profiles = JSON.parse(localStorage.getItem('cobble_profiles') || '[]')
let isGameRunning = false
let currentLang = 'en'
let translations = {}
let isOnlineUI = true
let skipCinematic = false

function typeWriter(el, text, speed = 36) {
  return new Promise(resolve => {
    el.textContent = ''
    let i = 0
    const iv = setInterval(() => {
      if (skipCinematic || i >= text.length) {
        clearInterval(iv); el.textContent = text; resolve(); return
      }
      el.textContent += text[i++]
    }, speed)
  })
}

function getLine(key, fallback) {
  const v = t(key); return (v && v !== key) ? v : fallback
}

// ── Intro Logic ──────────────────────────────────────────────
async function startIntro() {
  console.log('[Intro] Initializing RPG sequence...');
  const overlay = $id('intro-overlay')
  if (overlay) {
    overlay.style.opacity = '1';
    overlay.classList.remove('hidden');
  }
  $id('intro-professor-container')?.classList.remove('walk-out');
  $id('intro-wild-pokemon')?.classList.remove('walk-out');

  // Clean up any existing floating pokemons from previous plays
  const floaters = $id('intro-pokemon-floaters')
  if (floaters) floaters.innerHTML = '';

  $id('intro-wild-pokemon')?.classList.add('hidden');
  $id('intro-flash')?.classList.add('hidden');
  $id('intro-flash')?.classList.remove('active');

  // Preload Pokemons to avoid delay during reveal
  const reveals = ['bulbasaur','squirtle','charmander','pikachu','eevee','mew','togepi','jigglypuff','pichu','totodile','cyndaquil','chikorita','mudkip','torchic','treecko']
  reveals.forEach(poke => {
    const img = new Image();
    img.src = `https://play.pokemonshowdown.com/sprites/xyani/${poke}.gif`;
  });

  // Reset pitch cards
  const pitches = [1, 2, 3];
  pitches.forEach(num => {
    const p = $id(`pitch-${num}`);
    if (p) {
      if (num === 1) p.classList.add('active');
      else p.classList.remove('active');
    }
  });
  const btnNext = $id('btn-next-pitch');
  if (btnNext) btnNext.textContent = t('intro.next');

  // Initialize SoundCloud Widget
  let musicWidget = null;
  if (typeof SC !== 'undefined') {
    const iframeElement = $id('intro-music-widget');
    if (iframeElement) {
      musicWidget = SC.Widget(iframeElement);
    }
  }

  // Reset Music
  if (musicWidget) {
    musicWidget.pause();
    musicWidget.seekTo(0);
  }

  // ── Initialize 3D Professor (skinview3d) ──────────────────
  let professorViewer = null
  const profCanvas = $id('intro-professor-canvas')
  // Ensure the canvas container is hidden until the cinematic starts
  const profContainer = $id('intro-professor-container')
  if (profContainer) profContainer.classList.add('hidden')
  
  if (profCanvas && typeof skinview3d !== 'undefined') {
    try {
      if (window._introProfessorViewer) {
        try { window._introProfessorViewer.dispose() } catch(e) {}
      }
      professorViewer = new skinview3d.SkinViewer({
        canvas: profCanvas,
        width: 280,
        height: 480,
        skin: './img/oak-skin.png',
      })
      window._introProfessorViewer = professorViewer
      professorViewer.autoRotate = false
      professorViewer.controls.enabled = false
      professorViewer.zoom = 0.85
      professorViewer.animation = new skinview3d.WalkingAnimation()
      professorViewer.animation.speed = 0.5
      professorViewer.playerObject.rotation.y = -0.8 // Look left while sliding in
    } catch(e) {
      console.warn('[Intro] 3D viewer init failed:', e.message)
    }
  }

  // ── Phase 1: Language ─────────────────────────────────────
  // Start with Language Phase first
  setupLangPhase()

  function setupLangPhase() {
    const langPhase = $id('intro-lang-phase')
    langPhase.classList.remove('hidden')

    const browserLang = (navigator.language || 'en').split('-')[0].toLowerCase()
    const langNames = {
      'hu':'Magyar','en':'English','de':'Deutsch','fr':'Français','es':'Español',
      'it':'Italiano','pt':'Português','ru':'Русский','nl':'Nederlands',
      'pl':'Polski','tr':'Türkçe','zh':'中文','uk':'Українська','ro':'Română'
    }
    const detectedName = langNames[browserLang] || 'English'
    console.log('[Intro] Detected language:', browserLang, '(', detectedName, ')');
    const langDisplay = $id('detected-lang-name')
    if (langDisplay) langDisplay.textContent = detectedName

    const btnConfirm = $id('btn-intro-confirm-lang')
    const btnChange  = $id('btn-intro-change-lang')

    // Using onclick to avoid multiple event listeners if called multiple times
    if (btnConfirm) {
      btnConfirm.onclick = async () => {
        console.log('[Intro] Language confirmed:', browserLang);
        // Actually apply the detected language if it differs from current
        if (browserLang !== currentLang && langNames[browserLang]) {
          await loadSpecificLanguage(browserLang);
        }
        langPhase.classList.add('hidden')
        startCinematicPhase()
      }
    }
    if (btnChange) {
      btnChange.onclick = () => {
        // Toggle the inline language picker
        const picker = $id('intro-lang-picker');
        if (picker) picker.classList.toggle('hidden');
      }
    }

    // Handle inline language picker buttons
    const picker = $id('intro-lang-picker');
    if (picker) {
      picker.querySelectorAll('button[data-lang]').forEach(btn => {
        btn.onclick = async () => {
          const lang = btn.dataset.lang;
          const names = {
            'hu':'Magyar','en':'English','de':'Deutsch','fr':'Français','es':'Español',
            'it':'Italiano','pt':'Português','ru':'Русский','nl':'Nederlands',
            'pl':'Polski','tr':'Türkçe','zh':'中文','uk':'Українська','ro':'Română'
          };
          await loadSpecificLanguage(lang);
          if (langDisplay) langDisplay.textContent = names[lang] || lang;
          picker.classList.add('hidden');
        };
      });
    }
  }

  // ── Phase 2: Cinematic walk-in ────────────────────────────
  let cinematicDone = false // reset on every startIntro() call
  const cinematicPhase = $id('intro-cinematic-phase')
  const cinematicText  = $id('intro-cinematic-text')
  const skipBtn        = $id('btn-cinematic-skip')


  function startCinematicPhase() {
    cinematicPhase.classList.remove('hidden')
    if (profContainer) profContainer.classList.remove('hidden')
    
    // Start music immediately after language is confirmed
    if (musicWidget) {
      musicWidget.setVolume(30); 
      musicWidget.play();
    }
    
    runCinematic()
  }

  async function runCinematic() {
    // Wait for the CSS slide-in animation (2.5s) to finish
    await sleep(2500);
    if (skipCinematic) return;

    // Turn to face the player and become idle
    if (professorViewer && professorViewer.playerObject) {
      professorViewer.animation = new skinview3d.IdleAnimation();
      professorViewer.animation.speed = 0.5;
      
      // Smoothly animate rotation to 0
      let steps = 20;
      let stepTime = 15;
      let curRot = professorViewer.playerObject.rotation.y;
      for (let i = 1; i <= steps; i++) {
        if (skipCinematic) break;
        professorViewer.playerObject.rotation.y = curRot - (curRot * (i/steps));
        await sleep(stepTime);
      }
      professorViewer.playerObject.rotation.y = 0;
    }
    
    await sleep(500); // Small pause before talking starts
    if (skipCinematic) return;

    await typeWriter(cinematicText, getLine('intro.cinematic_1', 'Hello there! Welcome to the world of Pokémon!'))
    await sleep(900); if (skipCinematic) return

    await typeWriter(cinematicText, getLine('intro.cinematic_2', 'My name is Prof. Oak – people call me the Pokémon Prof!'))
    await sleep(700); if (skipCinematic) return

    // Professor throws pose
    if (professorViewer) {
      professorViewer.animation = new skinview3d.FlyingAnimation()
      professorViewer.animation.speed = 0.3
    }

    // Show & animate the Pokéball
    const pokeball = $id('intro-pokeball')
    if (pokeball) {
      pokeball.classList.remove('hidden')
      await sleep(80)
      pokeball.classList.add('throwing')
      await sleep(900)
      pokeball.classList.add('hidden')
      pokeball.classList.remove('throwing')
    }

    // Flash
    const flash = $id('intro-flash')
    if (flash) {
      flash.classList.remove('hidden')
      flash.classList.add('active')
      setTimeout(() => flash.classList.add('hidden'), 600)
    }
    await sleep(100)

    // Wild Pokémon appears (only small body ones as requested)
    const reveals = ['bulbasaur','squirtle','charmander','pikachu','eevee','mew','togepi','jigglypuff','pichu','totodile','cyndaquil','chikorita','mudkip','torchic','treecko']
    const revealPoke = reveals[Math.floor(Math.random() * reveals.length)]
    const wildEl  = $id('intro-wild-pokemon')
    const wildImg = $id('intro-wild-pokemon-img')
    if (wildEl && wildImg) {
      wildImg.src = `https://play.pokemonshowdown.com/sprites/xyani/${revealPoke}.gif`
      wildEl.classList.remove('hidden')
    }
    if (professorViewer) {
      professorViewer.animation = new skinview3d.IdleAnimation()
      professorViewer.animation.speed = 0.5
    }

    await sleep(400); if (skipCinematic) return
    await typeWriter(cinematicText, getLine('intro.cinematic_3', 'This world is inhabited by creatures called Pokémon!'))
    await sleep(900); if (skipCinematic) return
    await typeWriter(cinematicText, getLine('intro.cinematic_4', 'I study these fascinating creatures as my profession.'))
    await sleep(1000)
    endCinematic()
  }

  function endCinematic() {
    if (cinematicDone) return
    cinematicDone = true; skipCinematic = true
    cinematicPhase.classList.add('hidden')
    switchPhase2()
  }

  skipBtn?.addEventListener('click', endCinematic)
  cinematicPhase?.addEventListener('click', e => { if (e.target !== skipBtn) endCinematic() })

  // ── Phase 3: The World Pitch ──────────────────────────────
  function switchPhase2() {
    console.log('[Intro] Switching to Phase 2 (The World)');
    $id('intro-anim-phase').classList.remove('hidden')
    runIntroAnimation()
  }

  async function runIntroAnimation() {
    const pkmns = ['pikachu','charizard','rayquaza','greninja','lucario','gengar','mewtwo','arceus']
    const container = $id('intro-pokemon-floaters')
    const spawnPkmn = () => {
      if ($id('intro-overlay').classList.contains('hidden')) return
      const p = pkmns[Math.floor(Math.random() * pkmns.length)]
      const img = document.createElement('img')
      img.src = `https://play.pokemonshowdown.com/sprites/ani/${p}.gif`
      img.className = 'floating-pkmn'
      img.style.top = Math.random() * 80 + 'vh'
      img.style.animationDuration = (Math.random() * 5 + 10) + 's'
      container.appendChild(img)
      setTimeout(() => img.remove(), 15000)
      setTimeout(spawnPkmn, Math.random() * 2000 + 1000)
    }
    spawnPkmn()

    let currentPitch = 1
    const totalPitches = 3
    const btnNext = $id('btn-next-pitch')
    if (btnNext) {
      // Avoid multiple event listeners
      btnNext.onclick = () => {
        if (currentPitch < totalPitches) {
          console.log('[Intro] Next pitch:', currentPitch + 1);
          $id(`pitch-${currentPitch}`).classList.remove('active')
          currentPitch++
          $id(`pitch-${currentPitch}`).classList.add('active')
          if (currentPitch === totalPitches) btnNext.textContent = t('intro.start_btn')
        } else {
          showChoicePhase()
        }
      }
    }
  }

  function showChoicePhase() {
    console.log('[Intro] Switching to Choice Phase');
    $id('intro-anim-phase').classList.add('hidden')
    $id('intro-choice-phase').classList.remove('hidden')

    // Expose endIntro for the global auth click handlers
    // Final Exit Cinematic
    async function runClosingCinematic() {
      console.log('[Intro] Running closing cinematic...');
      
      // Immediately disable pointer events so the user doesn't feel "stuck"
      const overlay = $id('intro-overlay');
      if (overlay) overlay.style.pointerEvents = 'none';

      // Clear dialogue box and show final message
      $id('intro-auth-login-view')?.classList.add('hidden');
      $id('intro-auth-register-view')?.classList.add('hidden');
      $id('intro-auth-onetime-view')?.classList.add('hidden');
      $id('btn-auth-back')?.classList.add('hidden');
      
      const authText = $id('auth-dialogue-text');
      if (authText) {
        authText.textContent = '';
        skipCinematic = false;
        // Don't await forever, if user clicks it will skip
        await typeWriter(authText, getLine('intro.good_luck', 'Sok szerencsét a kalandodhoz! Találkozunk a világban!'));
      }
      await sleep(1000);
      
      // Hide dialogue box bubble
      $id('intro-auth-phase')?.classList.add('hidden');
      
      // Professor and Pokemon walk out
      console.log('[Intro] Professor walking out...');
      if (professorViewer) {
        try {
          professorViewer.animation = new skinview3d.WalkingAnimation();
          professorViewer.animation.speed = 0.8;
          // Turn to the right
          professorViewer.playerObject.rotation.y = 1.0; 
        } catch (e) { console.warn('[Intro] Prof anim error:', e); }
      }
      
      $id('intro-professor-container')?.classList.add('walk-out');
      $id('intro-wild-pokemon')?.classList.add('walk-out');
      
      await sleep(2000);
      
      // Final fade out
      if (overlay) overlay.style.opacity = '0';
      await sleep(1000);
      
      console.log('[Intro] Cinematic finished, calling endIntro(home)');
      endIntro('home');
    }

    window.endIntroFromAuth = runClosingCinematic;

    // Expose a helper so external auth handlers can show errors in the professor dialogue
    window.introShowError = async (msg) => {
      const el = $id('auth-dialogue-text');
      if (!el) return;
      el.textContent = '';
      skipCinematic = false;
      await typeWriter(el, msg);
    };

    $id('intro-explain-phase').onclick = () => { skipCinematic = true; }
    $id('intro-auth-phase').onclick = (e) => { 
      if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') skipCinematic = true; 
    }

    $id('btn-choice-new').onclick = async () => {
      // Show Explanation Phase
      $id('intro-choice-phase').classList.add('hidden')
      $id('intro-explain-phase').classList.remove('hidden')
      
      const explainTextEl = $id('intro-explain-text');
      const explainButtons = $id('intro-explain-buttons');
      const backBtn = $id('btn-explain-back');
      
      explainButtons.classList.add('hidden');
      backBtn.classList.add('hidden');
      explainTextEl.textContent = '';
      
      skipCinematic = false; // Allow typing animation again
      const text = getLine('intro.explain_desc', 'A permanent account gives you access to cross-device syncing, leaderboards, and daily rewards! A one-time account is fast but cannot be recovered if you reinstall. Which path will you choose?');
      
      await typeWriter(explainTextEl, text);
      
      explainButtons.classList.remove('hidden');
      backBtn.classList.remove('hidden');
    }
    
    $id('btn-choice-returning').onclick = async () => {
      // Show Login Phase
      $id('intro-choice-phase').classList.add('hidden')
      $id('intro-auth-phase').classList.remove('hidden')
      $id('intro-auth-login-view').classList.remove('hidden')
      $id('intro-auth-register-view').classList.add('hidden')
      $id('intro-auth-onetime-view').classList.add('hidden')

      // Reset login steps
      $id('login-step-1').classList.remove('hidden')
      $id('login-step-2').classList.add('hidden')
      $id('auth-dialogue-text').textContent = ''
      $id('auth-login-username').value = ''
      $id('auth-login-password').value = ''

      skipCinematic = false
      await typeWriter($id('auth-dialogue-text'), getLine('intro.login_step_1', 'Üdvözöllek újra, Mester! Emlékeztetnél a nevedre?'))
      $id('auth-login-username').focus()
    }

    $id('btn-login-next-1').onclick = async () => {
      const user = $id('auth-login-username').value.trim()
      if (!user) return showToast(t('toast.username_required'))
      
      $id('login-step-1').classList.add('hidden')
      $id('auth-dialogue-text').textContent = ''
      
      skipCinematic = false
      await typeWriter($id('auth-dialogue-text'), getLine('intro.login_step_2', `Örülök, hogy újra látlak, ${user}! Kérlek add meg a jelszavad.`))
      $id('login-step-2').classList.remove('hidden')
      $id('auth-login-password').focus()
    }
    
    // Explanation Phase Buttons
    $id('btn-choice-online').onclick = async () => {
      $id('intro-explain-phase').classList.add('hidden')
      $id('intro-auth-phase').classList.remove('hidden')
      $id('intro-auth-register-view').classList.remove('hidden')
      $id('intro-auth-login-view').classList.add('hidden')
      $id('intro-auth-onetime-view').classList.add('hidden')

      // Reset steps
      $id('reg-step-1').classList.add('hidden');
      $id('reg-step-2').classList.add('hidden');
      $id('auth-dialogue-text').textContent = '';
      $id('auth-register-username').value = '';
      $id('auth-register-password').value = '';
      $id('auth-register-confirm').value = '';
      
      // Step 1 dialogue
      skipCinematic = false;
      await typeWriter($id('auth-dialogue-text'), getLine('intro.reg_step_1', 'Kiváló választás! Egy tartós fiók. Nos, hogy hívjunk?'));
      $id('reg-step-1').classList.remove('hidden');
      $id('auth-register-username').focus();
    }
    
    $id('btn-reg-next-1').onclick = async () => {
      const user = $id('auth-register-username').value.trim();
      
      // Validation with Professor's voice
      if (!user || user.length < 3) {
        $id('auth-dialogue-text').textContent = '';
        skipCinematic = false;
        await typeWriter($id('auth-dialogue-text'), getLine('intro.err_user_short', 'Hoppá! Ez a név egy kicsit rövidnek tűnik. Legalább 3 karakterre szükségem lesz!'));
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(user)) {
        $id('auth-dialogue-text').textContent = '';
        skipCinematic = false;
        await typeWriter($id('auth-dialogue-text'), getLine('intro.err_user_chars', 'Sajnálom, de csak betűket, számokat és alulvonást használhatsz a nevedben!'));
        return;
      }
      
      // Check availability from server
      try {
        let serverUrl = $id('input-server-url')?.value?.trim() || 'http://94.72.100.43:8080';
        const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/auth/check-username?username=${encodeURIComponent(user)}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.available === false) {
            $id('auth-dialogue-text').textContent = '';
            skipCinematic = false;
            await typeWriter($id('auth-dialogue-text'), getLine('intro.err_user_taken', 'Úgy tűnik, ez a név már foglalt. Tudnál valami mást választani?'));
            return;
          }
        }
      } catch (e) {
        console.warn('[Auth] Username check failed (likely endpoint missing):', e);
      }

      $id('reg-step-1').classList.add('hidden');
      $id('auth-dialogue-text').textContent = '';
      
      skipCinematic = false;
      await typeWriter($id('auth-dialogue-text'), getLine('intro.reg_step_2_combined', `Ah, ${user}! Remek név. Kérlek adj meg egy titkos jelszavat, majd gépeld be még egyszer!`));
      
      $id('reg-step-2').classList.remove('hidden');
      $id('auth-register-password').focus();
    }


    
    $id('btn-choice-offline').onclick = async () => {
      $id('intro-explain-phase').classList.add('hidden')
      $id('intro-auth-phase').classList.remove('hidden')
      $id('intro-auth-onetime-view').classList.remove('hidden')
      $id('intro-auth-login-view').classList.add('hidden')
      $id('intro-auth-register-view').classList.add('hidden')

      $id('auth-dialogue-text').textContent = ''
      $id('auth-onetime-username').value = ''

      skipCinematic = false
      await typeWriter($id('auth-dialogue-text'), getLine('intro.onetime_step_1', 'Rendben! Egy egyszeri kaland. Hogy hívjanak ebben a világban?'))
      $id('auth-onetime-username').focus()
    }

    $id('btn-auth-onetime-start').onclick = () => {
      const user = $id('auth-onetime-username').value.trim()
      if (!user) return showToast(t('toast.username_required'))
      username = user
      localStorage.setItem('cobble_username', username)
      endIntro()
    }
    
    $id('btn-explain-back').onclick = () => {
      $id('intro-explain-phase').classList.add('hidden')
      $id('intro-choice-phase').classList.remove('hidden')
    }
    
    // Auth Phase Back Button
    $id('btn-auth-back').onclick = () => {
      $id('intro-auth-phase').classList.add('hidden')
      if (!$id('intro-auth-register-view').classList.contains('hidden')) {
        $id('intro-explain-phase').classList.remove('hidden')
      } else {
        $id('intro-choice-phase').classList.remove('hidden')
      }
    }
  }

  function endIntro(target) {
    // After online auth → go to home; offline/one-time → go to welcome (install screen)
    const dest = target || 'welcome'
    if (musicWidget) musicWidget.pause();
    if (professorViewer) { try { professorViewer.dispose() } catch(_) {} }
    overlay.classList.add('hidden')
    showScreen(dest)
  }
}

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)) }

// ── Translation Engine ───────────────────────────────────────
async function loadLanguage() {
  try {
    const saved = localStorage.getItem('cobble_lang')
    if (saved) {
      currentLang = saved
    } else {
      let locale = 'en'
      if (window.cobble) {
        locale = await window.cobble.getLocale()
      } else {
        // Web mode: use browser language
        locale = navigator.language || navigator.userLanguage || 'en'
      }
      const langCode = locale.split(/[-_]/)[0].toLowerCase()
      const available = ['hu', 'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'ko', 'zh', 'pl', 'tr', 'ro', 'sv', 'da', 'no', 'fi', 'cs', 'uk']
      currentLang = available.includes(langCode) ? langCode : 'en'
    }
    
    await loadSpecificLanguage(currentLang)
  } catch (e) {
    console.error('Nyelv betöltési hiba:', e)
  }
}

async function loadSpecificLanguage(lang) {
  try {
    // When running as web app (/app/), lang files are served at /app/lang/
    // When running in Electron (file://), they're at ./lang/
    const isWebMode = window.location.protocol === 'http:' || window.location.protocol === 'https:'
    const langUrl = isWebMode ? `/app/lang/${lang}.json` : `./lang/${lang}.json`
    const response = await fetch(langUrl)
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    translations = await response.json()
    currentLang = lang
    localStorage.setItem('cobble_lang', lang)
    updateUI()
  } catch (e) {
    console.error(`Hiba a(z) ${lang} nyelv betöltésekor:`, e)
  }
}

function t(key) {
  return key.split('.').reduce((o, i) => o?.[i], translations) || key
}

function updateUI() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n')
    el.innerHTML = t(key)
  })

  // Update dynamic player name
  const nameDisplay = $id('player-name-display')
  if (nameDisplay) {
    nameDisplay.textContent = username || t('home.trainer_placeholder')
  }
  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.getAttribute('data-i18n-title')
    el.title = t(key)
  })
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')
    el.placeholder = t(key)
  })
}

// Language switcher events
$id('lang-btn-launcher').addEventListener('click', (e) => {
  e.stopPropagation()
  $id('lang-dropdown-launcher').classList.toggle('show')
})

document.addEventListener('click', () => {
  $id('lang-dropdown-launcher').classList.remove('show')
})

$id('lang-dropdown-launcher').querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    loadSpecificLanguage(btn.dataset.lang)
  })
})

// ── DOM refs ─────────────────────────────────────────────────
const screens = {
  welcome: document.getElementById('screen-welcome'),
  install: document.getElementById('screen-install'),
  home:    document.getElementById('screen-home'),
}

// ── Screen transitions ────────────────────────────────────────
function showScreen(name) {
  Object.entries(screens).forEach(([key, el]) => {
    el.classList.remove('active')
    el.style.display = 'none'
    el.style.opacity = '0'
  })
  const target = screens[name]
  target.style.display = 'flex'
  requestAnimationFrame(() => {
    target.style.opacity = '1'
    target.classList.add('active')
    
    // Refresh Server Hub if entering home screen
    if (name === 'home') {
      randomizeHubShowcase()
      fetchHubLeaderboard()
    }
  })
}

// ── Toast ─────────────────────────────────────────────────────
function showToast(msg) {
  let t = document.querySelector('.toast')
  if (!t) {
    t = document.createElement('div')
    t.className = 'toast'
    document.body.appendChild(t)
  }
  
  let iconSvg = ''
  if (msg.includes('✅') || msg.toLowerCase().includes('sikeres') || msg.toLowerCase().includes('kész') || msg.toLowerCase().includes('saved') || msg.toLowerCase().includes('elmentve')) {
    iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px; color:#4ade80;"><polyline points="20 6 9 17 4 12"></polyline></svg>'
  } else if (msg.includes('❌') || msg.includes('hiba') || msg.toLowerCase().includes('error') || msg.toLowerCase().includes('failed')) {
    iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px; color:#f87171;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>'
  } else {
    iconSvg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:18px; height:18px; color:#fbbf24;"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>'
  }

  const cleanMsg = msg.replace(/[✅❌⚠️]/g, '').trim()
  t.innerHTML = `<div style="display:flex; align-items:center; gap:10px;">${iconSvg}<span>${cleanMsg}</span></div>`
  
  t.classList.add('show')
  if (t._timeout) clearTimeout(t._timeout)
  t._timeout = setTimeout(() => t.classList.remove('show'), 4000)
}

// ── Window controls & Intro Replay ──────────────────────────
$id('btn-replay-intro')?.addEventListener('click', () => {
  // Re-run the intro sequence from the beginning
  startIntro()
})
$id('btn-minimize').addEventListener('click', () => { if(window.cobble) window.cobble.minimize() })
$id('btn-close').addEventListener('click', () => { if(window.cobble) window.cobble.close() })

// ── RAM selector ──────────────────────────────────────────────
document.querySelectorAll('.ram-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.ram-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    selectedRam = parseInt(btn.dataset.val)
  })
})

// ── Install / Launch flow ─────────────────────────────────────
$id('btn-install').addEventListener('click', async () => {
  const input = $id('input-username')
  username = input.value.trim()

  if (!username || username.length < 3) {
    showToast(t('toast.username_short'))
    input.focus()
    return
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showToast(t('toast.username_chars'))
    input.focus()
    return
  }

  // Automatikus mentés a profilok közé, ha új név
  if (!profiles.find(p => p.name === username)) {
    profiles.push({ name: username, skinUrl: null, skinType: 'mojang', skinVal: username, profileId: generateUUID() })
    saveProfiles()
    renderProfiles()
  }

  // Check if already installed
  const status = await window.cobble.checkInstalled()
  window._lastInstallStatus = status
  if (status.allDone) {
    goToHome()
    return
  }

  showScreen('install')
  startInstall()
})

// ── Progress handler ──────────────────────────────────────────
const stepMap = {
  java:      'step-java',
  minecraft: 'step-minecraft',
  fabric:    'step-fabric',
  modpack:   'step-modpack',
}

let overallPercent = 0

if (window.cobble) {
  window.cobble.onProgress(({ step, percent, message }) => {
  // Update message and percent display
  $id('progress-msg').textContent = message || ''
  $id('progress-pct').textContent = `${percent}%`
  $id('progress-fill').style.width = `${percent}%`

  // Map step to overall progress
  const stepWeights = { java: [0,20], minecraft: [20,55], fabric: [55,65], modpack: [65,100], done: [100,100] }
  const range = stepWeights[step]
  if (range) {
    const overall = range[0] + ((percent / 100) * (range[1] - range[0]))
    $id('progress-fill').style.width = `${Math.round(overall)}%`
    $id('progress-pct').textContent = `${Math.round(overall)}%`
  }

  // Update step indicators
  const stepId = stepMap[step]
  if (stepId) {
    // Mark previous steps done
    Object.values(stepMap).forEach(id => {
      const el = $id(id)
      if (el && el !== $id(stepId) && !el.classList.contains('active')) {
        // earlier steps: done
      }
    })

    const stepEl = $id(stepId)
    if (stepEl) {
      stepEl.classList.add('active')
      stepEl.querySelector('.step-status').textContent = message || ''
      stepEl.querySelector('.step-indicator').className = 'step-indicator active'

      // Done check
      if (percent >= 100) {
        stepEl.classList.remove('active')
        stepEl.classList.add('done')
        stepEl.querySelector('.step-indicator').className = 'step-indicator done'
      }
    }
  }

  if (step === 'done') {
    setTimeout(goToHome, 800)
  }
  })
}

async function startInstall() {
  // Reset steps
  Object.values(stepMap).forEach(id => {
    const el = $id(id)
    if (el) {
      el.className = 'step'
      el.querySelector('.step-status').textContent = t('install.waiting')
      el.querySelector('.step-indicator').className = 'step-indicator idle'
    }
  })
  $id('progress-fill').style.width = '0%'
  $id('progress-msg').textContent = t('install.preparing')
  $id('progress-pct').textContent = '0%'

  const serverUrl = $id('input-server-url').value.trim()
  const result = await window.cobble.install({ username, ram: selectedRam, serverUrl })

  if (!result.success) {
    showToast(t('toast.install_error') + result.error)
    showScreen('welcome')
  }
}

function goToHome() {
  // Update home screen with real version info from state
  const status = window._lastInstallStatus || {}
  $id('player-name-display').textContent = username
  $id('player-avatar').textContent = username.charAt(0).toUpperCase()
  $id('home-ram-display').textContent = `${selectedRam} MB`

  if (status.modpackVersion) {
    $id('home-modpack-version').textContent = `COBBLEVERSE ${status.modpackVersion}`
  }
  if (status.fabricVersion) {
    $id('home-fabric-version').textContent = `Fabric ${status.fabricVersion}`
  }

  showScreen('home')

  // Background update check (non-blocking)
  runUpdateCheck()
}

// ── Profile Management ────────────────────────────────────────
function saveProfiles() {
  localStorage.setItem('cobble_profiles', JSON.stringify(profiles))
}

function getProfile(name) {
  return profiles.find(p => p.name === name)
}

function renderProfiles() {
  const list = $id('profile-list')
  if (!list) return
  list.innerHTML = ''

  if (profiles.length === 0) {
    list.style.display = 'none'
    return
  }
  list.style.display = 'flex'

  profiles.forEach(p => {
    const item = document.createElement('div')
    item.className = `profile-item ${username === p.name ? 'active' : ''}`
    
    // Generate avatar style based on profile skin data
    let avatarStyle = ''
    let avatarContent = p.name.charAt(0).toUpperCase()
    
    if (p.skinType === 'url' && p.skinVal) {
      avatarStyle = `background-image: url(${p.skinVal}); background-size: 800%; background-position: 14.28% 14.28%; image-rendering: pixelated;`
      avatarContent = ''
    } else if (p.skinUrl) {
      avatarStyle = `background-image: url(${p.skinUrl}); background-size: 800%; background-position: 14.28% 14.28%; image-rendering: pixelated;`
      avatarContent = ''
    } else {
      // Mojang or default
      const mojangName = p.skinVal || p.name
      avatarStyle = `background-image: url(https://mc-heads.net/avatar/${mojangName}); background-size: cover;`
      avatarContent = ''
    }
    
    item.innerHTML = `
      <div class="p-avatar" style="${avatarStyle}">${avatarContent}</div>
      <div class="p-name">${p.name}</div>
      <div class="p-remove" data-i18n-title="skin.remove_profile" title="Profil törlése">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </div>
    `
    
    item.addEventListener('click', (e) => {
      if (e.target.closest('.p-remove')) {
        profiles = profiles.filter(pr => pr.name !== p.name)
        if (username === p.name) username = ''
        saveProfiles()
        renderProfiles()
        return
      }
      selectProfile(p.name)
    })
    
    list.appendChild(item)
  })
  
  updateUI()
}

async function selectProfile(name) {
  username = name
  localStorage.setItem('cobble_username', name)
  
  const p = getProfile(name)
  if (p) {
    currentSkinType = p.skinType || 'mojang'
    currentSkinVal = p.skinVal || name
    if (p.skinUrl && currentSkinType === 'url') {
      currentSkinVal = p.skinUrl
    }
  } else {
    // Default for new profiles
    currentSkinType = 'mojang'
    currentSkinVal = name
  }

  // Automatikus skin frissítés a szerverről
  await syncSkinFromServer(name)
  
  // Ugrás a főképernyőre (ha már telepítve van)
  const status = await window.cobble.checkInstalled()
  if (status.allDone) {
    window._lastInstallStatus = status
    goToHome()
    applyAvatar()
  } else {
    showToast(t('toast.profile_selected').replace('{}', name))
    renderProfiles()
    updateUI()
    applyAvatar()
  }
}

async function syncSkinFromServer(name) {
  const serverUrl = $id('input-server-url').value.trim()
  if (!serverUrl) return

  const skinUrl = `${serverUrl.replace(/\/+$/, '')}/skins/${name}.png`
  try {
    // Check if skin exists (HEAD request)
    const res = await fetch(skinUrl, { method: 'HEAD', cache: 'no-store' })
    if (res.ok) {
      console.log(`[Skin] Szerver oldali skin megtalálva: ${name}`)
      currentSkinType = 'url'
      // Add cache buster to force refresh
      currentSkinVal = skinUrl.includes('?') ? `${skinUrl}&t=${Date.now()}` : `${skinUrl}?t=${Date.now()}`
      
      // Update profile cache
      const p = profiles.find(pr => pr.name === name)
      if (p) p.skinUrl = currentSkinVal
      saveProfiles()
    } else {
      console.log(`[Skin] Nincs egyedi skin a szerveren: ${name}`)
      // If we don't have a server skin and current was a server URL, reset to mojang
      if (currentSkinType === 'url' && currentSkinVal.includes('/skins/')) {
        currentSkinType = 'mojang'
        currentSkinVal = name
      }
    }
  } catch (e) {
    console.warn('[Skin] Hiba a skin ellenőrzésekor:', e.message)
  }
}

// ── Update check (background) ─────────────────────────────────
async function runUpdateCheck() {
  const banner = $id('update-banner')
  const title  = $id('update-title')
  const sub    = $id('update-sub')
  banner.classList.add('hidden')

  try {
    const updates = await window.cobble.checkForUpdates()
    const parts = []

    if (updates.modpack) {
      parts.push(`Modpack: ${updates.modpack.currentVersion} → ${updates.modpack.latestVersion}`)
    }
    if (updates.fabric) {
      parts.push(`Fabric: ${updates.fabric.currentVersion} → ${updates.fabric.latestVersion}`)
    }

    if (parts.length > 0) {
      title.textContent = t('home.update_available')
      sub.textContent = parts.join(' | ')
      banner.classList.remove('hidden')
      window._pendingUpdate = updates
    }
  } catch (_) {
    // No internet / API down – silently ignore
  }
}

// ── Update button ──────────────────────────────────────────────
$id('btn-update').addEventListener('click', async () => {
  const btn = $id('btn-update')
  btn.disabled = true
  btn.textContent = t('home.launching')
  $id('update-banner').classList.add('hidden')

  showScreen('install')

  // Reset step indicators
  Object.values(stepMap).forEach(id => {
    const el = $id(id)
    if (el) {
      el.className = 'step'
      el.querySelector('.step-status').textContent = t('install.waiting')
      el.querySelector('.step-indicator').className = 'step-indicator idle'
    }
  })
  $id('progress-fill').style.width = '0%'
  $id('progress-msg').textContent = t('install.preparing')
  $id('progress-pct').textContent = '0%'

  const serverUrl = $id('input-server-url').value.trim()
  const result = await window.cobble.runUpdate({ username, ram: selectedRam, serverUrl })
  if (!result.success) {
    showToast(t('toast.update_error') + result.error)
    showScreen('home')
    btn.disabled = false
    btn.textContent = t('update.label')
  }
  // On success, onProgress 'done' callback will call goToHome()
})
const LAUNCHER_SECRET = 'cobble-super-secret-key-2024'

$id('btn-play').addEventListener('click', async () => {
  if (isGameRunning) return
  const btn = $id('btn-play')
  btn.disabled = true
  btn.querySelector('span:last-child').textContent = t('home.launching')

  const serverUrl = $id('input-server-url').value.trim()
  showToast(t('toast.whitelisting'))

  // ── Launcher Verification ─────────────────────────────────
  try {
    const hwid = await window.cobble.getHWID()
    const currentProfile = getProfile(username)
    const profileId = currentProfile ? currentProfile.profileId : null
    const pUuid = currentProfile ? currentProfile.uuid : null

    const verifyRes = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/launcher/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, secret: LAUNCHER_SECRET, hwid, profileId, uuid: pUuid })
    })
    if (!verifyRes.ok) {
      const errData = await verifyRes.json()
      throw new Error(errData.error || t('toast.launch_denied'))
    }

    const verifyData = await verifyRes.json()
    console.log('[Verification] Sikeres szerver oldali igazolás. UUID:', verifyData.uuid)
    
    const result = await window.cobble.launch({ 
      username, 
      uuid: verifyData.uuid, 
      ram: selectedRam, 
      serverUrl 
    })
  if (!result.success) {
    showToast(t('home.launch_error') + result.error)
    btn.disabled = false
    btn.querySelector('span:last-child').textContent = t('home.play_btn')
    return
  }

    isGameRunning = true
    btn.querySelector('span:last-child').textContent = t('home.running')
  } catch (e) {
    showToast('❌ ' + e.message)
    btn.disabled = false
    btn.querySelector('span:last-child').textContent = t('home.play_btn')
  }
})

if (window.cobble) {
  window.cobble.onGameLog((data) => {
    const log = $id('console-log')
    log.textContent += data + '\n'
    log.scrollTop = log.scrollHeight
  })

  window.cobble.onGameClosed(() => {
    isGameRunning = false
    const btn = $id('btn-play')
    btn.disabled = false
    btn.querySelector('span:last-child').textContent = 'JÁTÉK INDÍTÁSA'
  })
}

// ── Console toggle ────────────────────────────────────────────
$id('btn-console-toggle').addEventListener('click', () => {
  $id('console-overlay').classList.remove('hidden')
})
$id('console-close').addEventListener('click', () => {
  $id('console-overlay').classList.add('hidden')
})

// ── Server Hub (Integrated) ──────────────────────────────────
// Functions now triggered in showScreen('home')


const showcasePokemons = [
  { name: "Charizard (Mega X)", sprite: "charizard-megax", descKey: "showcase.desc_charizard" },
  { name: "Rayquaza", sprite: "rayquaza", descKey: "showcase.desc_rayquaza" },
  { name: "Greninja", sprite: "greninja", descKey: "showcase.desc_greninja" },
  { name: "Lucario (Mega)", sprite: "lucario-mega", descKey: "showcase.desc_lucario" },
  { name: "Gengar", sprite: "gengar", descKey: "showcase.desc_gengar" }
]

function randomizeHubShowcase() {
  const p = showcasePokemons[Math.floor(Math.random() * showcasePokemons.length)]
  const img = $id('hub-showcase-sprite')
  const nameEl = $id('hub-showcase-name')
  const descEl = $id('hub-showcase-desc')
  
  if (img && nameEl && descEl) {
    img.src = `https://play.pokemonshowdown.com/sprites/xyani/${p.sprite}.gif`
    nameEl.textContent = p.name
    descEl.setAttribute('data-i18n', p.descKey)
    descEl.innerHTML = t(p.descKey)
  }
}
randomizeHubShowcase()

let currentLeaderboardCat = 'playtime'

async function fetchHubLeaderboard(category = 'playtime') {
  const tbody = $id('hub-leaderboard-body')
  const header = $id('leaderboard-value-header')
  if (!tbody) return

  currentLeaderboardCat = category
  
  // Update header text based on category
  const headerKeys = {
    'playtime': 'leaderboard.playtime',
    'caught': 'leaderboard.cat_caught',
    'pokedex': 'leaderboard.cat_pokedex',
    'shiny': 'leaderboard.cat_shiny'
  }
  if (header) {
    header.setAttribute('data-i18n', headerKeys[category] || 'leaderboard.playtime')
    header.textContent = t(headerKeys[category] || 'leaderboard.playtime')
  }

  // Read server URL
  let serverUrl = $id('input-server-url').value.trim()
  if (!serverUrl) serverUrl = 'http://94.72.100.43:7878'

  try {
    const res = await fetch(`${serverUrl}/api/leaderboard?category=${category}`)
    const data = await res.json()

    if (!data || data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888;">${t('leaderboard.empty')}</td></tr>`
      return
    }

    let html = ''
    data.forEach((p, index) => {
      const rankClass = index < 3 ? `rank-${index + 1}` : ''
      const rankContent = index < 3 ? `<span class="rank-badge ${rankClass}">${index + 1}</span>` : index + 1
      
      let valDisplay = p.value || p.playtime || 0
      let unit = ''
      if (category === 'playtime') unit = ' óra'
      else unit = ' db'

      html += `
        <tr>
          <td>${rankContent}</td>
          <td style="font-weight: 600;">${p.username}</td>
          <td style="color: var(--accent-yellow);">${valDisplay}${unit}</td>
        </tr>
      `
    })
    tbody.innerHTML = html
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--accent-red);">${t('leaderboard.error')}</td></tr>`
  }
}

// Tab event listeners
document.querySelectorAll('.hub-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.hub-tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    fetchHubLeaderboard(tab.dataset.cat)
  })
})

$id('btn-hub-claim-reward').addEventListener('click', async () => {
  const btn = $id('btn-hub-claim-reward')
  const statusEl = $id('hub-reward-status')
  const username = currentProfile ? currentProfile.name : ''
  
  if (!username) {
    statusEl.className = 'hub-reward-status error'
    statusEl.textContent = 'Jelentkezz be egy profillal!'
    return
  }

  let serverUrl = $id('input-server-url').value.trim()
  if (!serverUrl) serverUrl = 'http://94.72.100.43:7878'

  btn.disabled = true
  btn.innerHTML = '<div class="loading-spinner small" style="margin:0; width:16px; height:16px;"></div>'

  try {
    console.log('[Hub] Claiming reward for:', username)
    const res = await fetch(`${serverUrl}/api/rewards/claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username })
    })
    
    let data
    const contentType = res.headers.get('content-type')
    if (contentType && contentType.includes('application/json')) {
      data = await res.json()
    } else {
      const text = await res.text()
      throw new Error(text || 'Server error')
    }

    if (res.ok) {
      statusEl.className = 'hub-reward-status success'
      statusEl.textContent = data.message || t('rewards.success')
    } else {
      statusEl.className = 'hub-reward-status error'
      statusEl.textContent = data.error || 'Hiba: ' + res.status
    }
  } catch (e) {
    console.error('[Hub] Reward claim error:', e)
    statusEl.className = 'hub-reward-status error'
    statusEl.textContent = 'Hálózati hiba: ' + (e.message || 'Ismeretlen')
  } finally {
    btn.disabled = false
    btn.innerHTML = `<span data-i18n="rewards.btn">${t('rewards.btn')}</span>`
  }
})

// ── External links ────────────────────────────────────────────
$id('link-modrinth').addEventListener('click', () => {
  if (window.cobble) window.cobble.openExternal('https://modrinth.com/modpack/cobbleverse')
})
$id('link-discord').addEventListener('click', () => {
  if (window.cobble) window.cobble.openExternal('https://discord.lumy.fun')
})
$id('link-folder').addEventListener('click', () => {
  if (window.cobble) window.cobble.openGameFolder()
})


// Login Logic
$id('btn-auth-login').addEventListener('click', async () => {
  const user = $id('auth-login-username').value.trim()
  const pass = $id('auth-login-password').value
  if (!user || !pass) {
    const emptyMsg = t('intro.err_fill_all') || t('toast.fill_all_fields')
    if (window.introShowError) await window.introShowError(emptyMsg)
    else showToast(emptyMsg)
    return
  }

  const btn = $id('btn-auth-login');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';

  // Show connecting message in professor dialogue
  if (window.introShowError) await window.introShowError(t('intro.connecting') || 'Egy pillanat, megkérdezem a központot...');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);

  try {
    const serverUrl = $id('input-server-url').value.trim() || 'http://94.72.100.43:8080'
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
      signal: controller.signal
    })
    const data = await res.json()
    if (!res.ok) {
      // Show error in professor dialogue
      const errMsg = data.error
        ? data.error
        : (t('intro.err_invalid_credentials') || 'Hibás felhasználónév vagy jelszó! Próbáld újra.')
      if (window.introShowError) await window.introShowError(errMsg)
      else showToast('❌ ' + errMsg)
      btn.disabled = false;
      btn.textContent = originalText;
      return
    }

    username = data.username
    const accUuid = data.uuid
    
    // Save to profiles
    const existing = profiles.find(p => p.name === username)
    if (existing) {
      existing.uuid = accUuid
    } else {
      profiles.push({ name: username, uuid: accUuid, profileId: generateUUID() })
    }
    saveProfiles()
    renderProfiles()
    selectProfile(username)
    
    showToast(t('toast.login_success'))
    if (window.endIntroFromAuth) window.endIntroFromAuth()
  } catch (e) {
    let msg = 'Hálózati hiba! Kérlek ellenőrizd a kapcsolatod. (Hiba: ' + e.message + ')';
    if (e.name === 'AbortError') msg = t('intro.err_timeout') || 'A szerver nem válaszolt időben. Kérlek próbáld újra!';
    if (window.introShowError) await window.introShowError(msg)
    else showToast('❌ ' + msg)
    btn.disabled = false;
    btn.textContent = originalText;
  } finally {
    clearTimeout(timeoutId);
  }
})

// Register Logic
$id('btn-auth-register').addEventListener('click', async () => {
  const user = $id('auth-register-username').value.trim()
  const pass = $id('auth-register-password').value
  const confirm = $id('auth-register-confirm').value
  
  if (pass.length < 6) {
    $id('auth-dialogue-text').textContent = '';
    skipCinematic = false;
    await typeWriter($id('auth-dialogue-text'), getLine('intro.err_pass_short', 'Sajnálom, de a jelszónak legalább 6 karakterből kell állnia a biztonságod érdekében!'));
    return;
  }
  if (pass !== confirm) {
    $id('auth-dialogue-text').textContent = '';
    skipCinematic = false;
    typeWriter($id('auth-dialogue-text'), getLine('intro.err_pass_mismatch', 'Hm, a két jelszó nem egyezik. Figyelj oda a gépelésnél!'));
    return;
  }

  const btn = $id('btn-auth-register');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';

  // Show "Connecting..." message
  $id('auth-dialogue-text').textContent = '';
  skipCinematic = false;
  await typeWriter($id('auth-dialogue-text'), getLine('intro.connecting', 'Egy pillanat, megkérdezem a központot...'));

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

  try {
    const serverUrl = $id('input-server-url')?.value?.trim() || 'http://94.72.100.43:8080';
    console.log('[Auth] Registering at:', serverUrl);
    
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass }),
      signal: controller.signal
    })
    const data = await res.json()
    if (!res.ok) {
      $id('auth-dialogue-text').textContent = '';
      skipCinematic = false;
      const errorMsg = data.error || `Szerver hiba történt (${res.status})`;
      await typeWriter($id('auth-dialogue-text'), errorMsg);
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }

    showToast(t('toast.login_success'))
    
    // Save new profile
    const existing = profiles.find(p => p.name === user)
    if (!existing) {
      profiles.push({ name: user, profileId: generateUUID() })
      saveProfiles()
      renderProfiles()
    }
    selectProfile(user)
    username = user

    // Trigger closing cinematic
    if (window.endIntroFromAuth) window.endIntroFromAuth()
  } catch (e) {
    console.error('[Auth] Registration error:', e);
    $id('auth-dialogue-text').textContent = '';
    skipCinematic = false;
    let msg = 'Hálózati hiba történt! Kérlek ellenőrizd a kapcsolatod. (Hiba: ' + e.message + ')';
    if (e.name === 'AbortError') msg = 'A szerver nem válaszolt időben. Kérlek próbáld újra!';
    await typeWriter($id('auth-dialogue-text'), msg);
    btn.disabled = false;
    btn.textContent = originalText;
  } finally {
    clearTimeout(timeoutId);
  }
})

$id('btn-switch-profile').addEventListener('click', () => {
  showScreen('welcome')
})

$id('btn-add-profile').addEventListener('click', () => {
  const name = $id('input-username').value.trim()
  if (!name || name.length < 3) {
    showToast(t('toast.username_short'))
    return
  }
  if (!/^[a-zA-Z0-9_]+$/.test(name)) {
    showToast(t('toast.username_chars'))
    return
  }
  if (profiles.find(p => p.name === name)) {
    showToast(t('toast.profile_exists'))
    return
  }
  
  profiles.push({ name, skinUrl: null, skinType: 'mojang', skinVal: name, profileId: generateUUID() })
  saveProfiles()
  $id('input-username').value = ''
  renderProfiles()
  selectProfile(name)
})

// ── Account / Auth Legacy Logic (kept for compatibility) ────────
let authMode = 'guest' // 'guest' or 'account'

// ── Particle Animation ─────────────────────────────────────────
const canvas = document.getElementById('particles-canvas')
const ctx = canvas.getContext('2d')

function resizeCanvas() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
}
resizeCanvas()
window.addEventListener('resize', resizeCanvas)

const PARTICLE_COUNT = 55
const particles = []

class Particle {
  constructor() { this.reset(true) }

  reset(init = false) {
    this.x = Math.random() * canvas.width
    this.y = init ? Math.random() * canvas.height : canvas.height + 20
    this.size = Math.random() * 2.5 + 0.5
    this.speedY = -(Math.random() * 0.6 + 0.2)
    this.speedX = (Math.random() - 0.5) * 0.3
    this.opacity = Math.random() * 0.5 + 0.1
    this.hue = Math.random() < 0.5
      ? `${200 + Math.random() * 40}` // blue
      : `${260 + Math.random() * 30}`  // purple
  }

  update() {
    this.x += this.speedX
    this.y += this.speedY
    if (this.y < -10) this.reset()
  }

  draw() {
    ctx.beginPath()
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2)
    ctx.fillStyle = `hsla(${this.hue}, 80%, 70%, ${this.opacity})`
    ctx.fill()
  }
}

for (let i = 0; i < PARTICLE_COUNT; i++) particles.push(new Particle())

function animateParticles() {
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  particles.forEach(p => { p.update(); p.draw() })
  requestAnimationFrame(animateParticles)
}
animateParticles()

// ── Init: check installation on start ────────────────────────
;(async () => {
  await loadLanguage()
  
  // Profiles init
  try {
    profiles = JSON.parse(localStorage.getItem('cobble_profiles') || '[]')
    let needsSave = false
    profiles.forEach(p => {
      if (!p.profileId) {
        p.profileId = generateUUID()
        needsSave = true
      }
    })
    if (needsSave) saveProfiles()
    renderProfiles()

    if (profiles.length === 0) {
      console.log('[Intro] No profiles found, starting intro...');
      startIntro();
    } else {
      console.log('[Intro] Profiles found, skipping intro...');
      showScreen('welcome')
    }
  } catch(e) {
    console.error('[Init] Error:', e)
    showScreen('welcome')
  }

  // Try to restore saved username and server url
  try {
    const saved = localStorage.getItem('cobble_username')
    if (saved) {
      username = saved
      // Sync skin for initial user
      setTimeout(() => syncSkinFromServer(username), 500)
    }

    const savedUrl = localStorage.getItem('cobble_server_url')
    if (savedUrl) {
      $id('input-server-url').value = savedUrl
      if (window.cobble) window.cobble.setUpdateServerUrl(savedUrl)
    } else {
      const defaultUrl = 'http://94.72.100.43:8080'
      $id('input-server-url').value = defaultUrl
      if (window.cobble) window.cobble.setUpdateServerUrl(defaultUrl)
    }

    const savedRam = localStorage.getItem('cobble_ram')
    if (savedRam) {
      selectedRam = parseInt(savedRam)
      document.querySelectorAll('.ram-btn').forEach(b => {
        b.classList.toggle('active', parseInt(b.dataset.val) === selectedRam)
      })
    }
  } catch (e) {}

  // Save on input change
  $id('input-username').addEventListener('input', (e) => {
    const name = e.target.value.trim()
    username = name
    try { localStorage.setItem('cobble_username', name) } catch(e2) {}
    
    // Frissítsük az avatart gépelés közben is, hogy látszódjon a névhez tartozó skin
    if (name.length >= 3) {
      currentSkinType = 'mojang'
      currentSkinVal = name
      applyAvatar()
    }
  })
  
  // Add on Enter key
  $id('input-username').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const name = e.target.value.trim()
      if (name.length >= 3 && /^[a-zA-Z0-9_]+$/.test(name)) {
        if (!profiles.find(p => p.name === name)) {
          profiles.push({ name, skinUrl: null, profileId: generateUUID() })
          saveProfiles()
          renderProfiles()
        }
        $id('btn-install').click() 
      }
    }
  })
  $id('input-server-url').addEventListener('input', (e) => {
    const url = e.target.value.trim()
    try { localStorage.setItem('cobble_server_url', url) } catch(e2) {}
    if (url.startsWith('http') && window.cobble) {
      window.cobble.setUpdateServerUrl(url)
    }
  })
  document.querySelectorAll('.ram-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      try { localStorage.setItem('cobble_ram', btn.dataset.val) } catch(e) {}
    })
  )
  
  // Update UI Status (Online/Offline)
  async function checkConnection() {
    const statusContainer = $id('ui-status')
    if (!statusContainer) return

    const textEl = statusContainer.querySelector('.status-text')
    const isLocalFile = window.location.protocol === 'file:'
    
    // First step: Check internet connection via navigator.onLine
    let hasInternet = navigator.onLine
    let serverReachable = false

    // Update UI helper
    const setStatus = (mode, key) => {
      statusContainer.classList.remove('no-net', 'server-down')
      if (mode) statusContainer.classList.add(mode)
      textEl.setAttribute('data-i18n', key)
      updateUI()
      // Force repaint
      statusContainer.style.display = 'none'
      statusContainer.offsetHeight
      statusContainer.style.display = 'flex'
    }

    if (!hasInternet) {
      isOnlineUI = false
      setStatus('no-net', 'home.ui_no_internet')
      return
    }

    if (isLocalFile) {
      isOnlineUI = false
      setStatus('server-down', 'home.ui_server_offline')
      return
    }

    // Second step: Check server availability via fetch
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 2000)

    try {
      await fetch('http://94.72.100.43:8080/api/status', { 
        mode: 'no-cors', 
        cache: 'no-store',
        signal: controller.signal 
      })
      isOnlineUI = true
      setStatus(null, 'home.ui_online')
    } catch (e) {
      isOnlineUI = false
      setStatus('server-down', 'home.ui_server_offline')
    } finally {
      clearTimeout(timeoutId)
    }
  }

  // Initial check
  checkConnection()

  // Real-time listeners
  window.addEventListener('online', checkConnection)
  window.addEventListener('offline', checkConnection)
  
  // Periodic check (every 30s)
  setInterval(checkConnection, 30000)

if (window.cobble) {
  window.cobble.onProtocolLaunch(() => {
    console.log('[Protocol] Deep link detected, showing account tab')
    showScreen('home')
    const tabAcc = $id('tab-account')
    if (tabAcc) tabAcc.click()
  })
}
})()

// ── Skin Management Logic ──────────────────────────────────────
let currentSkinType = 'mojang'
let currentSkinVal = ''
let skinViewer = null // skinview3d instance

/**
 * Returns the correct 64x64 skin texture URL based on current type & value.
 */
function getSkinTextureUrl() {
  if (currentSkinType === 'mojang') {
    const name = ($id('input-skin-val')?.value || '').trim() || 'Steve'
    // ✅ Correct endpoint: /skin/<name> returns the actual 64x64 PNG texture
    return `https://mc-heads.net/skin/${name}`
  } else if (currentSkinType === 'url') {
    return ($id('input-skin-val')?.value || '').trim() || null
  } else if (currentSkinType === 'file') {
    return currentSkinVal || null // base64 data URL
  }
  return null
}

/**
 * Initializes the skinview3d 3D viewer in the modal canvas.
 */
function initSkinViewer() {
  const canvas = $id('skin-3d-canvas')
  if (!canvas) return

  // Destroy previous viewer to free memory
  if (skinViewer) {
    try { skinViewer.dispose() } catch (_) {}
    skinViewer = null
  }

  // If skinview3d isn't loaded (CDN failure), gracefully skip
  if (typeof skinview3d === 'undefined') {
    console.warn('[Skin3D] skinview3d library not loaded.')
    return
  }

  try {
    skinViewer = new skinview3d.SkinViewer({
      canvas,
      width: 300,
      height: 400,
      skin: 'https://mc-heads.net/skin/Steve',
    })

    skinViewer.autoRotate = true
    skinViewer.autoRotateSpeed = 0.8
    skinViewer.controls.enabled = true
    skinViewer.animation = new skinview3d.WalkingAnimation()
    skinViewer.animation.speed = 0.5
    skinViewer.zoom = 1.0
  } catch (e) {
    console.warn('[Skin3D] Viewer init hiba:', e.message)
    skinViewer = null
  }
}

/**
 * Loads the current skin into the 3D viewer.
 */
function updateSkinViewer() {
  if (!skinViewer) return
  const url = getSkinTextureUrl()
  if (!url) return

  skinViewer.loadSkin(url).catch(e => {
    console.warn('[Skin3D] Skin betöltési hiba:', e.message)
  })
}

/**
 * Updates the singleplayer hint with the current skin URL.
 */
function updateSpHint() {
  const serverUrl = ($id('input-server-url')?.value || '').trim()
  const hint = $id('skin-sp-hint')
  const hintText = $id('skin-sp-hint-text')
  if (!hint || !hintText) return

  if (serverUrl && username) {
    const skinUrl = `${serverUrl.replace(/\/+$/, '')}/skins/${username}.png`
    hintText.innerHTML = `SP in-game parancs: <code>/skin url ${skinUrl}</code>`
    hint.style.display = 'flex'
  } else {
    hint.style.display = 'none'
  }
}

function updateSkinPreview() {
  updateSkinViewer()
}

function applyAvatar() {
  const avatar = $id('player-avatar')
  if (!avatar) return
  
  const val = currentSkinVal || username || 'Steve'

  if (currentSkinType === 'mojang') {
    // Use head avatar from mc-heads.net
    avatar.style.backgroundImage = `url(https://mc-heads.net/avatar/${val || 'Steve'})`
    avatar.style.backgroundSize = 'cover'
    avatar.style.backgroundPosition = 'center'
    avatar.style.imageRendering = 'auto'
    avatar.textContent = ''
  } else {
    // Custom URL or File: Try to show the head part of the skin PNG (8,8 to 16,16)
    // Add cache buster if it's a URL
    let skinUrl = currentSkinVal
    if (skinUrl && skinUrl.startsWith('http')) {
      skinUrl = skinUrl.includes('?') ? `${skinUrl}&t=${Date.now()}` : `${skinUrl}?t=${Date.now()}`
    }
    
    avatar.style.backgroundImage = `url(${skinUrl})`
    avatar.style.backgroundSize = '800%' // 64 / 8 = 8x zoom
    avatar.style.backgroundPosition = '14.28% 14.28%' // Position at 8,8
    avatar.style.imageRendering = 'pixelated'
    avatar.textContent = ''
    
    // Fallback if no skin val
    if (!currentSkinVal) {
      avatar.style.backgroundImage = ''
      avatar.textContent = username ? username.charAt(0).toUpperCase() : '?'
    }
  }
}

// ── Event Listeners for Skin Modal ────────────────────────────

$id('btn-change-skin').addEventListener('click', () => {
  const modal = $id('modal-skin')
  modal.classList.remove('hidden')
  setTimeout(() => modal.classList.add('active'), 10)

  // Update modal UI to match current state
  document.querySelectorAll('[data-skin-type]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.skinType === currentSkinType)
  })

  if (currentSkinType === 'file') {
    $id('skin-input-container').classList.add('hidden')
    $id('btn-browse-skin').classList.remove('hidden')
  } else {
    $id('skin-input-container').classList.remove('hidden')
    $id('btn-browse-skin').classList.add('hidden')
    $id('input-skin-val').value = currentSkinVal || ''
    $id('input-skin-val').placeholder = currentSkinType === 'mojang'
      ? 'pl. AshKetchum'
      : 'https://.../skin.png'
  }

  // Initialize 3D viewer
  setTimeout(() => {
    initSkinViewer()
    updateSkinViewer()
    updateSpHint()
  }, 50)
})

$id('btn-close-skin').addEventListener('click', () => {
  const modal = $id('modal-skin')
  modal.classList.remove('active')
  setTimeout(() => modal.classList.add('hidden'), 300)

  // Pause/stop viewer when modal is hidden
  if (skinViewer) {
    skinViewer.autoRotate = false
  }
})

document.querySelectorAll('[data-skin-type]').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('[data-skin-type]').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    currentSkinType = btn.dataset.skinType

    // UI visibility
    if (currentSkinType === 'file') {
      $id('skin-input-container').classList.add('hidden')
      $id('btn-browse-skin').classList.remove('hidden')
    } else {
      $id('skin-input-container').classList.remove('hidden')
      $id('btn-browse-skin').classList.add('hidden')
      $id('input-skin-val').placeholder = currentSkinType === 'mojang'
        ? 'pl. AshKetchum'
        : 'https://.../skin.png'
    }
    updateSkinPreview()
  })
})

$id('btn-browse-skin').addEventListener('click', () => {
  $id('input-skin-file').click()
})

$id('input-skin-file').addEventListener('change', (e) => {
  const file = e.target.files[0]
  if (!file) return

  const reader = new FileReader()
  reader.onload = (ev) => {
    currentSkinVal = ev.target.result // base64 data URL
    updateSkinPreview()
  }
  reader.readAsDataURL(file)
})

$id('input-skin-val').addEventListener('input', () => {
  updateSkinPreview()
})

$id('btn-save-skin').addEventListener('click', async () => {
  if (currentSkinType !== 'file') {
    currentSkinVal = $id('input-skin-val').value.trim()
  }

  if (!currentSkinVal) {
    showToast(t('skin.toast_empty'))
    return
  }

  try {
    const p = getProfile(username)
    if (p) {
      p.skinType = currentSkinType
      p.skinVal = currentSkinVal
      saveProfiles()
      renderProfiles()
    }
    localStorage.setItem('cobble_skin_type', currentSkinType)
    localStorage.setItem('cobble_skin_val', currentSkinVal)
  } catch (e) {}

  applyAvatar()

  // Upload to server for SkinsRestorer integration (multiplayer)
  await uploadSkinToServer()

  showToast(t('skin.toast_saved'))
  $id('btn-close-skin').click()
})

async function uploadSkinToServer() {
  const serverUrl = $id('input-server-url').value.trim()
  if (!serverUrl) return

  const payload = { username, skinData: currentSkinVal, isUrl: false, skinType: currentSkinType }

  if (currentSkinType === 'mojang') {
    // For Mojang skins: server will use 'skin set mojang <username>' directly
    // No need to download/re-host the PNG — the mod fetches it from Mojang
    payload.skinData = currentSkinVal  // just the Mojang username
    payload.isUrl = false
    payload.mojangUsername = currentSkinVal
  } else if (currentSkinType === 'url') {
    payload.skinData = currentSkinVal
    payload.isUrl = true
  } else {
    // file: base64
    payload.skinData = currentSkinVal
    payload.isUrl = false
  }

  try {
    const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/upload-skin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const res = await response.json()
    if (res.success) {
      console.log('[Skins] Skin sikeresen feltöltve:', res.url)
      
      // Update profile cache with the new URL from server
      const p = getProfile(username)
      if (p) {
        // Add cache buster to the URL to force refresh
        p.skinUrl = res.url.includes('?') ? `${res.url}&t=${Date.now()}` : `${res.url}?t=${Date.now()}`
        saveProfiles()
        renderProfiles()
      }
      
      // Update SP hint with the actual skin URL returned by server
      const hintText = $id('skin-sp-hint-text')
      if (hintText && res.url) {
        hintText.innerHTML = t('skin.singleplayer_hint').replace('{}', `<code>${res.url}</code>`)
        const hint = $id('skin-sp-hint')
        if (hint) hint.style.display = 'flex'
      }
    } else {
      console.warn('[Skins] Szerver hiba:', res.error)
      showToast('❌ ' + (res.error || t('toast.error')))
    }
  } catch (e) {
    console.warn('[Skins] Nem sikerült feltölteni a skint:', e.message)
    showToast('⚠️ ' + t('skin.toast_upload_error'))
  }
}

// Load saved skin on startup
try {
  const st = localStorage.getItem('cobble_skin_type')
  const sv = localStorage.getItem('cobble_skin_val')
  if (st) {
    currentSkinType = st
    document.querySelectorAll('[data-skin-type]').forEach(b => {
      b.classList.toggle('active', b.dataset.skinType === st)
    })
  }
  if (sv) {
    currentSkinVal = sv
    applyAvatar()
  }
} catch (e) {}
