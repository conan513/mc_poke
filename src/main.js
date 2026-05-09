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
let selectedRam = parseInt(localStorage.getItem('cobble_ram')) || 6144
let totalSystemMem = 8 * 1024 * 1024 * 1024 // Default fallback: 8GB in bytes
let closeOnLaunch = localStorage.getItem('cobble_close_launch') === 'true'
let powerSaveEnabled = localStorage.getItem('cobble_power_save') !== 'false' // Default true
let username = localStorage.getItem('cobble_username') || ''
let profiles = JSON.parse(localStorage.getItem('cobble_profiles') || '[]')
let isGameRunning = false
let currentLang = 'en'
let translations = {}
let isOnlineUI = true
let skipCinematic = false
let currentProfile = null

// ── Skin Gallery ──────────────────────────────────────────────
let skinGallery = [];
let isSearchingSkins = false;

async function loadSkinGallery(query = '') {
  if (isSearchingSkins) return;
  isSearchingSkins = true;
  
  const introContainer = $id('intro-skin-gallery-container');
  const modalContainer = $id('skin-gallery-container');
  const loadingHtml = '<div style="grid-column: 1/-1; text-align: center; color: #ccc;">Betöltés...</div>';
  
  if (introContainer) introContainer.innerHTML = loadingHtml;
  if (modalContainer) modalContainer.innerHTML = loadingHtml;
  
  try {
    if (window.cobble && window.cobble.searchSkins) {
      skinGallery = await window.cobble.searchSkins(query ? query.trim() : '');
    }
    
    if (!skinGallery || skinGallery.length === 0) {
       const emptyHtml = '<div style="grid-column: 1/-1; text-align: center; color: #ccc;">Nincs találat.</div>';
       if (introContainer) introContainer.innerHTML = emptyHtml;
       if (modalContainer) modalContainer.innerHTML = emptyHtml;
    } else {
       renderSkinGallery();
    }
  } catch (e) {
    console.error("Failed to load skin gallery", e);
    const errHtml = '<div style="grid-column: 1/-1; text-align: center; color: #f55;">Hiba a betöltéskor.</div>';
    if (introContainer) introContainer.innerHTML = errHtml;
    if (modalContainer) modalContainer.innerHTML = errHtml;
  }
  isSearchingSkins = false;
}

function renderSkinGallery() {
  const introContainer = $id('intro-skin-gallery-container');
  const modalContainer = $id('skin-gallery-container');
  if (!introContainer || !modalContainer) return;
  
  introContainer.innerHTML = '';
  modalContainer.innerHTML = '';
  
  skinGallery.forEach(skin => {
    introContainer.appendChild(createGalleryItem(skin, true));
    modalContainer.appendChild(createGalleryItem(skin, false));
  });
}

function createGalleryItem(skin, isIntro) {
  const div = document.createElement('div');
  div.className = 'skin-gallery-item';
  div.title = skin.name;
  
  const preview = skin.preview || skin.url; // Support older skins.json format that lacks 'preview'
  
  // If it's a small_preview from namemc/minecraftskins.net, it's already a proper thumbnail!
  if (preview.includes('small_preview') || preview.includes('namemc.com/i')) {
    div.innerHTML = `<img src="${preview}" alt="${skin.name}" style="width:100%; height:100%; object-fit:contain;">`;
  } else {
    // Extract face for raw textures
    div.innerHTML = `<div style="width: 48px; height: 48px; background-image: url('${preview}'); background-size: 384px 384px; background-position: -48px -48px;"></div>`;
  }
  
  div.onclick = () => {
    const parent = isIntro ? $id('intro-skin-gallery-container') : $id('skin-gallery-container');
    parent.querySelectorAll('.skin-gallery-item').forEach(el => el.classList.remove('selected'));
    div.classList.add('selected');
    
    if (isIntro) {
      if (typeof introGallerySelectedUrl !== 'undefined') {
        introGallerySelectedUrl = skin.url;
      }
      if (typeof updateIntroSkin3D === 'function') updateIntroSkin3D();
    } else {
      if (typeof currentSkinVal !== 'undefined') {
        currentSkinVal = skin.url;
      }
      if (typeof updateSkinPreview === 'function') updateSkinPreview();
    }
  };
  return div;
}

// Bind search buttons after DOM loads
document.addEventListener('DOMContentLoaded', () => {
  $id('btn-intro-skin-search')?.addEventListener('click', () => {
    loadSkinGallery($id('intro-skin-search')?.value);
  });
  $id('intro-skin-search')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loadSkinGallery(e.target.value);
  });
  
  $id('btn-modal-skin-search')?.addEventListener('click', () => {
    loadSkinGallery($id('modal-skin-search')?.value);
  });
  $id('modal-skin-search')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') loadSkinGallery(e.target.value);
  });
});

loadSkinGallery();

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

function waitForDialogueClick(buttonId) {
  return new Promise(resolve => {
    const btn = $id(buttonId);
    if (btn) btn.classList.remove('hidden');
    
    const handler = () => {
      btn.removeEventListener('click', handler);
      btn.classList.add('hidden');
      resolve();
    };
    btn.addEventListener('click', handler, { once: true });
  });
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

  // ── Background Install Kickoff ────────────────────────────────
  if (window.cobble) {
    window.cobble.checkInstalled().then(status => {
      if (!status.installed && !isInstalling) {
        isInstalling = true;
        $id('intro-install-progress-container')?.classList.remove('hidden');
        startInstall().catch(e => console.warn('[Intro] Background install error:', e));
      }
    }).catch(e => console.warn('[Intro] Check installed error:', e));
  }

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
  let isMusicFading = false;

  if (typeof SC !== 'undefined') {
    const iframeElement = $id('intro-music-widget');
    if (iframeElement) {
      musicWidget = SC.Widget(iframeElement);
    }
  }

  function fadeMusicOut(durationMs = 10000) {
    if (!musicWidget || isMusicFading) return;
    isMusicFading = true;
    const startVolume = 30; 
    const steps = 40; 
    const stepDuration = durationMs / steps;
    const volumeStep = startVolume / steps;
    let currentVolume = startVolume;

    const interval = setInterval(() => {
      currentVolume -= volumeStep;
      if (currentVolume <= 0) {
        musicWidget.setVolume(0);
        musicWidget.pause();
        clearInterval(interval);
        isMusicFading = false;
      } else {
        musicWidget.setVolume(currentVolume);
      }
    }, stepDuration);
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

  // ── Back to Launcher Button ──────────────────────────────
  const btnQuit = $id('btn-intro-quit')
  if (btnQuit) {
    btnQuit.onclick = () => {
      console.log('[Intro] User quit intro, returning to welcome screen.');
      // Stop music
      if (musicWidget) {
        musicWidget.pause();
        musicWidget.setVolume(0);
      }
      // Cleanup floaters
      const floaters = $id('intro-pokemon-floaters');
      if (floaters) floaters.innerHTML = '';
      
      // Reset state
      skipCinematic = true;
      cinematicDone = true;
      
      // Hide intro, show welcome
      overlay.classList.add('hidden');
      overlay.style.opacity = '0';
      showScreen('welcome');
      
      // Dispose 3D viewer if exists
      if (professorViewer) {
        try { professorViewer.dispose(); } catch(e) {}
      }
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
        console.log('[Intro] Language confirmed:', currentLang);
        langPhase.classList.add('hidden')
        startCinematicPhase()
      }
    }
    if (btnChange) {
      btnChange.onclick = () => {
        const modal = $id('intro-lang-modal-overlay');
        if (modal) modal.classList.remove('hidden');
      }
    }

    const btnCloseModal = $id('btn-close-lang-modal');
    if (btnCloseModal) {
      btnCloseModal.onclick = () => {
        $id('intro-lang-modal-overlay')?.classList.add('hidden');
      }
    }

    // Handle language picker buttons in the modal
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
          $id('intro-lang-modal-overlay')?.classList.add('hidden');
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
    await waitForDialogueClick('btn-cinematic-next');

    await typeWriter(cinematicText, getLine('intro.cinematic_2', 'My name is Prof. Oak – people call me the Pokémon Prof!'))
    await waitForDialogueClick('btn-cinematic-next');

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
    await waitForDialogueClick('btn-cinematic-next');

    // Start floating Pokémon animation while he continues talking
    runIntroAnimation();

    await typeWriter(cinematicText, getLine('intro.pitch_1_desc', 'For some, Pokémon are pets. Others use them for fights.'))
    await waitForDialogueClick('btn-cinematic-next');

    await typeWriter(cinematicText, getLine('intro.cinematic_4', 'Myself... I study these fascinating creatures as my profession.'))
    await waitForDialogueClick('btn-cinematic-next');

    await typeWriter(cinematicText, getLine('intro.pitch_3_desc', 'Are you ready to write your own story? A world of dreams and adventures awaits!'))
    await waitForDialogueClick('btn-cinematic-next');

    endCinematic()
  }

  function endCinematic() {
    if (cinematicDone) return
    cinematicDone = true; skipCinematic = true
    cinematicPhase.classList.add('hidden')
    showChoicePhase()
  }

  function runIntroAnimation() {
    const pkmns = [
      "bulbasaur", "ivysaur", "venusaur", "charmander", "charmeleon", "charizard", "squirtle", "wartortle", "blastoise", "caterpie",
      "metapod", "butterfree", "weedle", "kakuna", "beedrill", "pidgey", "pidgeotto", "pidgeot", "rattata", "raticate",
      "spearow", "fearow", "ekans", "arbok", "pikachu", "raichu", "sandshrew", "sandslash", "nidoranf", "nidorina",
      "nidoqueen", "nidoranm", "nidorino", "nidoking", "clefairy", "clefable", "vulpix", "ninetales", "jigglypuff", "wigglytuff",
      "zubat", "golbat", "oddish", "gloom", "vileplume", "paras", "parasect", "venonat", "venomoth", "diglett",
      "dugtrio", "meowth", "persian", "psyduck", "golduck", "mankey", "primeape", "growlithe", "arcanine", "poliwag",
      "poliwhirl", "poliwrath", "abra", "kadabra", "alakazam", "machop", "machoke", "machamp", "bellsprout", "weepinbell",
      "victreebel", "tentacool", "tentacruel", "geodude", "graveler", "golem", "ponyta", "rapidash", "slowpoke", "slowbro",
      "magnemite", "magneton", "farfetchd", "doduo", "dodrio", "seel", "dewgong", "grimer", "muk", "shellder",
      "cloyster", "gastly", "haunter", "gengar", "onix", "drowzee", "hypno", "krabby", "kingler", "voltorb",
      "electrode", "exeggcute", "exeggutor", "cubone", "marowak", "hitmonlee", "hitmonchan", "lickitung", "koffing", "weezing",
      "rhyhorn", "rhydon", "chansey", "tangela", "kangaskhan", "horsea", "seadra", "goldeen", "seaking", "staryu",
      "starmie", "mrmime", "scyther", "jynx", "electabuzz", "magmar", "pinsir", "tauros", "magikarp", "gyarados",
      "lapras", "ditto", "eevee", "vaporeon", "jolteon", "flareon", "porygon", "omanyte", "omastar", "kabuto",
      "kabutops", "aerodactyl", "snorlax", "articuno", "zapdos", "moltres", "dratini", "dragonair", "dragonite", "mewtwo",
      "mew", "chikorita", "bayleef", "meganium", "cyndaquil", "quilava", "typhlosion", "totodile", "croconaw", "feraligatr",
      "sentret", "furret", "hoothoot", "noctowl", "ledyba", "ledian", "spinarak", "ariados", "crobat", "chinchou",
      "lanturn", "pichu", "cleffa", "igglybuff", "togepi", "togetic", "natu", "xatu", "mareep", "flaaffy",
      "ampharos", "bellossom", "marill", "azumarill", "sudowoodo", "politoed", "hoppip", "skiploom", "jumpluff", "aipom",
      "sunkern", "sunflora", "yanma", "wooper", "quagsire", "espeon", "umbreon", "murkrow", "slowking", "misdreavus",
      "unown", "wobbuffet", "girafarig", "pineco", "forretress", "dunsparce", "gligar", "steelix", "snubbull", "granbull",
      "qwilfish", "scizor", "shuckle", "heracross", "sneasel", "teddiursa", "ursaring", "slugma", "magcargo", "swinub",
      "piloswine", "corsola", "remoraid", "octillery", "delibird", "mantine", "skarmory", "houndour", "houndoom", "kingdra",
      "phanpy", "donphan", "porygon2", "stantler", "smeargle", "tyrogue", "hitmontop", "smoochum", "elekid", "magby",
      "miltank", "blissey", "raikou", "entei", "suicune", "larvitar", "pupitar", "tyranitar", "lugia", "hooh",
      "celebi", "treecko", "grovyle", "sceptile", "torchic", "combusken", "blaziken", "mudkip", "marshtomp", "swampert",
      "poochyena", "mightyena", "zigzagoon", "linoone", "wurmple", "silcoon", "beautifly", "cascoon", "dustox", "lotad",
      "lombre", "ludicolo", "seedot", "nuzleaf", "shiftry", "taillow", "swellow", "wingull", "pelipper", "ralts",
      "kirlia", "gardevoir", "surskit", "masquerain", "shroomish", "breloom", "slakoth", "vigoroth", "slaking", "nincada",
      "ninjask", "shedinja", "whismur", "loudred", "exploud", "makuhita", "hariyama", "azurill", "nosepass", "skitty",
      "delcatty", "sableye", "mawile", "aron", "lairon", "aggron", "meditite", "medicham", "electrike", "manectric",
      "plusle", "minun", "volbeat", "illumise", "roselia", "gulpin", "swalot", "carvanha", "sharpedo", "wailmer",
      "wailord", "numel", "camerupt", "torkoal", "spoink", "grumpig", "spinda", "trapinch", "vibrava", "flygon",
      "cacnea", "cacturne", "swablu", "altaria", "zangoose", "seviper", "lunatone", "solrock", "barboach", "whiscash",
      "corphish", "crawdaunt", "baltoy", "claydol", "lileep", "cradily", "anorith", "armaldo", "feebas", "milotic",
      "castform", "kecleon", "shuppet", "banette", "duskull", "dusclops", "tropius", "chimecho", "absol", "wynaut",
      "snorunt", "glalie", "spheal", "sealeo", "walrein", "clamperl", "huntail", "gorebyss", "relicanth", "luvdisc",
      "bagon", "shelgon", "salamence", "beldum", "metang", "metagross", "regirock", "regice", "registeel", "latias",
      "latios", "kyogre", "groudon", "rayquaza", "jirachi", "deoxys", "turtwig", "grotle", "torterra", "chimchar",
      "monferno", "infernape", "piplup", "prinplup", "empoleon", "starly", "staravia", "staraptor", "bidoof", "bibarel",
      "kricketot", "kricketune", "shinx", "luxio", "luxray", "budew", "roserade", "cranidos", "rampardos", "shieldon",
      "bastiodon", "burmy", "wormadam", "mothim", "combee", "vespiquen", "pachirisu", "buizel", "floatzel", "cherubi",
      "cherrim", "shellos", "gastrodon", "ambipom", "drifloon", "drifblim", "buneary", "lopunny", "mismagius", "honchkrow",
      "glameow", "purugly", "chingling", "stunky", "skuntank", "bronzor", "bronzong", "bonsly", "mimejr", "happiny",
      "chatot", "spiritomb", "gible", "gabite", "garchomp", "munchlax", "riolu", "lucario", "hippopotas", "hippowdon",
      "skorupi", "drapion", "croagunk", "toxicroak", "carnivine", "finneon", "lumineon", "mantyke", "snover", "abomasnow",
      "weavile", "magnezone", "lickilicky", "rhyperior", "tangrowth", "electivire", "magmortar", "togekiss", "yanmega", "leafeon",
      "glaceon", "gliscor", "mamoswine", "porygonz", "gallade", "probopass", "dusknoir", "froslass", "rotom", "uxie",
      "mesprit", "azelf", "dialga", "palkia", "heatran", "regigigas", "giratina", "cresselia", "phione", "manaphy",
      "darkrai", "shaymin", "arceus", "victini", "snivy", "servine", "serperior", "tepig", "pignite", "emboar",
      "oshawott", "dewott", "samurott", "patrat", "watchog", "lillipup", "herdier", "stoutland", "purrloin", "liepard",
      "pansage", "simisage", "pansear", "simisear", "panpour", "simipour", "munna", "musharna", "pidove", "tranquill",
      "unfezant", "blitzle", "zebstrika", "roggenrola", "boldore", "gigalith", "woobat", "swoobat", "drilbur", "excadrill",
      "audino", "timburr", "gurdurr", "conkeldurr", "tympole", "palpitoad", "seismitoad", "throh", "sawk", "sewaddle",
      "swadloon", "leavanny", "venipede", "whirlipede", "scolipede", "cottonee", "whimsicott", "petilil", "lilligant", "basculin",
      "sandile", "krokorok", "krookodile", "darumaka", "darmanitan", "maractus", "dwebble", "crustle", "scraggy", "scrafty",
      "sigilyph", "yamask", "cofagrigus", "tirtouga", "carracosta", "archen", "archeops", "trubbish", "garbodor", "zorua",
      "zoroark", "minccino", "cinccino", "gothita", "gothorita", "gothitelle", "solosis", "duosion", "reuniclus", "ducklett",
      "swanna", "vanillite", "vanillish", "vanilluxe", "deerling", "sawsbuck", "emolga", "karrablast", "escavalier", "foongus",
      "amoonguss", "frillish", "jellicent", "alomomola", "joltik", "galvantula", "ferroseed", "ferrothorn", "klink", "klang",
      "klinklang", "tynamo", "eelektrik", "eelektross", "elgyem", "beheeyem", "litwick", "lampent", "chandelure", "axew",
      "fraxure", "haxorus", "cubchoo", "beartic", "cryogonal", "shelmet", "accelgor", "stunfisk", "mienfoo", "mienshao",
      "druddigon", "golett", "golurk", "pawniard", "bisharp", "bouffalant", "rufflet", "braviary", "vullaby", "mandibuzz",
      "heatmor", "durant", "deino", "zweilous", "hydreigon", "larvesta", "volcarona", "cobalion", "terrakion", "virizion",
      "tornadus", "thundurus", "reshiram", "zekrom", "landorus", "kyurem", "keldeo", "meloetta", "genesect", "chespin",
      "quilladin", "chesnaught", "fennekin", "braixen", "delphox", "froakie", "frogadier", "greninja", "bunnelby", "diggersby",
      "fletchling", "fletchinder", "talonflame", "scatterbug", "spewpa", "vivillon", "litleo", "pyroar", "flabebe", "floette",
      "florges", "skiddo", "gogoat", "pancham", "pangoro", "furfrou", "espurr", "meowstic", "honedge", "doublade",
      "aegislash", "spritzee", "aromatisse", "swirlix", "slurpuff", "inkay", "malamar", "binacle", "barbaracle", "skrelp",
      "dragalge", "clauncher", "clawitzer", "helioptile", "heliolisk", "tyrunt", "tyrantrum", "amaura", "aurorus", "sylveon",
      "hawlucha", "dedenne", "carbink", "goomy", "sliggoo", "goodra", "klefki", "phantump", "trevenant", "pumpkaboo",
      "gourgeist", "bergmite", "avalugg", "noibat", "noivern", "xerneas", "yveltal", "zygarde", "diancie", "hoopa",
      "volcanion", "rowlet", "dartrix", "decidueye", "litten", "torracat", "incineroar", "popplio", "brionne", "primarina",
      "pikipek", "trumbeak", "toucannon", "yungoos", "gumshoos", "grubbin", "charjabug", "vikavolt", "crabrawler", "crabominable",
      "oricorio", "cutiefly", "ribombee", "rockruff", "lycanroc", "wishiwashi", "mareanie", "toxapex", "mudbray", "mudsdale",
      "dewpider", "araquanid", "fomantis", "lurantis", "morelull", "shiinotic", "salandit", "salazzle", "stufful", "bewear",
      "bounsweet", "steenee", "tsareena", "comfey", "oranguru", "passimian", "wimpod", "golisopod", "sandygast", "palossand",
      "pyukumuku", "typenull", "silvally", "minior", "komala", "turtonator", "togedemaru", "mimikyu", "bruxish", "drampa",
      "dhelmise", "jangmoo", "hakamoo", "kommoo", "tapukoko", "tapulele", "tapubulu", "tapufini", "cosmog", "cosmoem",
      "solgaleo", "lunala", "nihilego", "buzzwole", "pheromosa", "xurkitree", "celesteela", "kartana", "guzzlord", "necrozma",
      "magearna", "marshadow", "poipole", "naganadel", "stakataka", "blacephalon", "zeraora", "meltan", "melmetal", "grookey",
      "thwackey", "rillaboom", "scorbunny", "raboot", "cinderace", "sobble", "drizzile", "inteleon", "skwovet", "greedent",
      "rookidee", "corvisquire", "corviknight", "blipbug", "dottler", "orbeetle", "nickit", "thievul", "gossifleur", "eldegoss",
      "wooloo", "dubwool", "chewtle", "drednaw", "yamper", "boltund", "rolycoly", "carkol", "coalossal", "applin",
      "flapple", "appletun", "silicobra", "sandaconda", "cramorant", "arrokuda", "barraskewda", "toxel", "toxtricity", "sizzlipede",
      "centiskorch", "clobbopus", "grapploct", "sinistea", "polteageist", "hatenna", "hattrem", "hatterene", "impidimp", "morgrem",
      "grimmsnarl", "obstagoon", "perrserker", "cursola", "sirfetchd", "mrrime", "runerigus", "milcery", "alcremie", "falinks",
      "pincurchin", "snom", "frosmoth", "stonjourner", "eiscue", "indeedee", "morpeko", "cufant", "copperajah", "dracozolt",
      "arctozolt", "dracovish", "arctovish", "duraludon", "dreepy", "drakloak", "dragapult", "zacian", "zamazenta", "eternatus",
      "kubfu", "urshifu", "zarude", "regieleki", "regidrago", "glastrier", "spectrier", "calyrex", "wyrdeer", "kleavor",
      "ursaluna", "basculegion", "sneasler", "overqwil", "enamorus", "sprigatito", "floragato", "meowscarada", "fuecoco", "crocalor",
      "skeledirge", "quaxly", "quaxwell", "quaquaval", "lechonk", "oinkologne", "tarountula", "spidops", "nymble", "lokix",
      "pawmi", "pawmo", "pawmot", "tandemaus", "maushold", "fidough", "dachsbun", "smoliv", "dolliv", "arboliva",
      "squawkabilly", "nacli", "naclstack", "garganacl", "charcadet", "armarouge", "ceruledge", "tadbulb", "bellibolt", "wattrel",
      "kilowattrel", "maschiff", "mabosstiff", "shroodle", "grafaiai", "bramblin", "brambleghast", "toedscool", "toedscruel", "klawf",
      "capsakid", "scovillain", "rellor", "rabsca", "flittle", "espathra", "tinkatink", "tinkatuff", "tinkaton", "wiglett",
      "wugtrio", "bombirdier", "finizen", "palafin", "varoom", "revavroom", "cyclizar", "orthworm", "glimmet", "glimmora",
      "greavard", "houndstone", "flamigo", "cetoddle", "cetitan", "veluza", "dondozo", "tatsugiri", "annihilape", "clodsire",
      "farigiraf", "dudunsparce", "kingambit", "greattusk", "screamtail", "brutebonnet", "fluttermane", "slitherwing", "sandyshocks",
      "irontreads", "ironbundle", "ironhands", "ironjugulis", "ironmoth", "ironthorns", "frigibax", "arctibax", "baxcalibur", "gimmighoul",
      "gholdengo", "wochien", "chienpao", "tinglu", "chiyu", "roaringmoon", "ironvaliant", "koraidon", "miraidon", "walkingwake",
      "ironleaves", "dipplin", "poltchageist", "sinistcha", "okidogi", "munkidori", "fezandipiti", "ogerpon", "archaludon", "hydrapple",
      "gougingfire", "ragingbolt", "ironboulder", "ironcrown", "terapagos", "pecharunt"
    ];
    const container = $id('intro-pokemon-floaters')
    if (!container) return;
    const spawnPkmn = () => {
      if ($id('intro-overlay').classList.contains('hidden')) return
      const p = pkmns[Math.floor(Math.random() * pkmns.length)]
      const img = document.createElement('img')
      img.src = `https://play.pokemonshowdown.com/sprites/ani/${p}.gif`
      img.className = 'floating-pkmn'
      img.style.top = Math.random() * 80 + 'vh'
      img.style.animationDuration = (Math.random() * 5 + 10) + 's'
      
      // Cleanup broken images if showdown is missing a GIF
      img.onerror = () => img.remove();
      
      container.appendChild(img)
      setTimeout(() => img.remove(), 15000)
      setTimeout(spawnPkmn, Math.random() * 2000 + 1000)
    }
    spawnPkmn()
  }

  function showChoicePhase() {
    console.log('[Intro] Switching to Choice Phase');
    $id('intro-cinematic-phase')?.classList.add('hidden');
    $id('intro-choice-phase').classList.remove('hidden')

    // Expose endIntro for the global auth click handlers
    // Final Exit Cinematic
    async function runClosingCinematic() {
      console.log('[Intro] Running closing cinematic...');
      fadeMusicOut(10000);
      
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
        await typeWriter(authText, getLine('intro.good_luck', 'Good luck on your adventure! I\'ll see you in the world of Pokémon!'));
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

    let introSkinType = 'mojang';
    let introSkinFileBase64 = '';
    let introGallerySelectedUrl = '';
    let introSkinViewer3D = null;

    function updateIntroSkin3D() {
      if (!introSkinViewer3D) return;
      let url = 'https://mc-heads.net/skin/Steve';
      const val = (introSkinType === 'file') ? introSkinFileBase64 : (introSkinType === 'gallery' ? introGallerySelectedUrl : $id('intro-skin-input').value.trim());
      
      if (introSkinType === 'mojang') {
         url = val ? `https://mc-heads.net/skin/${val}` : `https://mc-heads.net/skin/${username || 'Steve'}`;
      } else if (introSkinType === 'url' || introSkinType === 'gallery') {
         url = val || 'https://mc-heads.net/skin/Steve';
      } else if (introSkinType === 'file') {
         url = val || 'https://mc-heads.net/skin/Steve';
      }
      
      introSkinViewer3D.loadSkin(url).catch(e => console.warn('[Intro Skin3D]', e.message));
    }

    window.endIntroFromAuth = async function() {
      console.log('[Intro] Auth success, showing skin phase...');
      $id('intro-auth-login-view')?.classList.add('hidden');
      $id('intro-auth-register-view')?.classList.add('hidden');
      $id('intro-auth-onetime-view')?.classList.add('hidden');
      $id('btn-auth-back')?.classList.add('hidden');

      const authText = $id('auth-dialogue-text');
      if (authText) {
        authText.textContent = '';
        skipCinematic = false;
        await typeWriter(authText, getLine('intro.skin_step_1', 'Great! And what do you look like? You can use your Mojang skin or provide a custom URL!'));
      }
      
      if (!introSkinViewer3D) {
        const canvas = $id('intro-skin-3d-canvas');
        if (canvas) {
          try {
            introSkinViewer3D = new skinview3d.SkinViewer({
              canvas: canvas,
              width: 140,
              height: 220,
              skin: 'https://mc-heads.net/skin/Steve'
            });
            introSkinViewer3D.autoRotate = true;
            introSkinViewer3D.autoRotateSpeed = 0.8;
            introSkinViewer3D.controls.enabled = true;
            introSkinViewer3D.controls.enableZoom = false;
            introSkinViewer3D.animation = new skinview3d.WalkingAnimation();
            introSkinViewer3D.animation.speed = 0.5;
            introSkinViewer3D.zoom = 0.9;
          } catch(e) { console.warn('[Intro] Skin viewer init failed', e); }
        }
      }
      updateIntroSkin3D();
      
      $id('intro-skin-select-view')?.classList.remove('hidden');
    };

    $id('btn-intro-skin-mojang')?.addEventListener('click', () => {
      introSkinType = 'mojang';
      $id('btn-intro-skin-mojang').classList.add('active');
      $id('btn-intro-skin-url').classList.remove('active');
      $id('btn-intro-skin-file').classList.remove('active');
      $id('btn-intro-skin-gallery').classList.remove('active');
      $id('intro-skin-input').classList.remove('hidden');
      $id('btn-intro-browse-skin').classList.add('hidden');
      $id('intro-skin-gallery-wrapper').classList.add('hidden');
      $id('intro-skin-input').placeholder = t('skin.type_mojang_placeholder');
      updateIntroSkin3D();
    });
    $id('btn-intro-skin-url')?.addEventListener('click', () => {
      introSkinType = 'url';
      $id('btn-intro-skin-url').classList.add('active');
      $id('btn-intro-skin-mojang').classList.remove('active');
      $id('btn-intro-skin-file').classList.remove('active');
      $id('btn-intro-skin-gallery').classList.remove('active');
      $id('intro-skin-input').classList.remove('hidden');
      $id('btn-intro-browse-skin').classList.add('hidden');
      $id('intro-skin-gallery-wrapper').classList.add('hidden');
      $id('intro-skin-input').placeholder = t('skin.type_url_placeholder');
      updateIntroSkin3D();
    });
    $id('btn-intro-skin-file')?.addEventListener('click', () => {
      introSkinType = 'file';
      $id('btn-intro-skin-file').classList.add('active');
      $id('btn-intro-skin-url').classList.remove('active');
      $id('btn-intro-skin-mojang').classList.remove('active');
      $id('btn-intro-skin-gallery').classList.remove('active');
      $id('intro-skin-input').classList.add('hidden');
      $id('intro-skin-gallery-wrapper').classList.add('hidden');
      $id('btn-intro-browse-skin').classList.remove('hidden');
      updateIntroSkin3D();
    });
    $id('btn-intro-skin-gallery')?.addEventListener('click', () => {
      introSkinType = 'gallery';
      $id('btn-intro-skin-gallery').classList.add('active');
      $id('btn-intro-skin-file').classList.remove('active');
      $id('btn-intro-skin-url').classList.remove('active');
      $id('btn-intro-skin-mojang').classList.remove('active');
      $id('intro-skin-input').classList.add('hidden');
      $id('btn-intro-browse-skin').classList.add('hidden');
      $id('intro-skin-gallery-wrapper').classList.remove('hidden');
      updateIntroSkin3D();
    });

    $id('intro-skin-input')?.addEventListener('input', updateIntroSkin3D);

    $id('btn-intro-browse-skin')?.addEventListener('click', () => {
      $id('intro-skin-file-input')?.click();
    });

    $id('intro-skin-file-input')?.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      
      $id('intro-skin-file-name').textContent = file.name;
      const reader = new FileReader();
      reader.onload = (ev) => {
        introSkinFileBase64 = ev.target.result;
        updateIntroSkin3D();
      };
      reader.readAsDataURL(file);
    });

    $id('btn-intro-skin-skip')?.addEventListener('click', () => {
      if (introSkinViewer3D) { try { introSkinViewer3D.dispose(); } catch(_) {} }
      $id('intro-skin-select-view')?.classList.add('hidden');
      runClosingCinematic();
    });

    $id('btn-intro-skin-save')?.addEventListener('click', async () => {
      let val = '';
      if (introSkinType === 'file') {
        val = introSkinFileBase64;
      } else if (introSkinType === 'gallery') {
        val = introGallerySelectedUrl;
      } else {
        val = $id('intro-skin-input').value.trim();
      }
      
      const btnSave = $id('btn-intro-skin-save');
      
      if (val && username) {
        const originalText = btnSave.textContent;
        btnSave.disabled = true;
        btnSave.textContent = '...';
        
        const p = getProfile(username);
        if (p) {
          p.skinType = (introSkinType === 'gallery') ? 'url' : introSkinType;
          p.skinVal = val;
          saveProfiles();
          renderProfiles();
          
          currentSkinType = introSkinType;
          currentSkinVal = val;
          localStorage.setItem('cobble_skin_type', currentSkinType);
          localStorage.setItem('cobble_skin_val', currentSkinVal);
          
          try {
            await uploadSkinToServer();
          } catch (e) {
            console.error('[Intro] Skin upload failed:', e);
          }
          
          // Update the UI avatar now that the skin is saved
          if (typeof applyAvatar === 'function') {
            applyAvatar();
          }
        }
        btnSave.disabled = false;
        btnSave.textContent = originalText;
      }
      if (introSkinViewer3D) { try { introSkinViewer3D.dispose(); } catch(_) {} }
      $id('intro-skin-select-view')?.classList.add('hidden');
      runClosingCinematic();
    });

    // Expose a helper so external auth handlers can show errors in the professor dialogue
    window.introShowError = async (msg) => {
      const el = $id('auth-dialogue-text');
      if (!el) return;
      el.textContent = '';
      skipCinematic = false;
      await typeWriter(el, msg);
    };

    $id('intro-explain-phase')?.addEventListener('click', () => { skipCinematic = true; });
    $id('intro-auth-phase')?.addEventListener('click', (e) => { 
      if(e.target.tagName !== 'INPUT' && e.target.tagName !== 'BUTTON') skipCinematic = true; 
    });

    $id('btn-choice-new').onclick = async () => {
      // Go directly to Register Phase
      $id('intro-choice-phase').classList.add('hidden')
      $id('intro-auth-phase').classList.remove('hidden')
      $id('intro-auth-register-view').classList.remove('hidden')
      $id('intro-auth-login-view').classList.add('hidden')
      $id('intro-auth-onetime-view')?.classList.add('hidden')

      // Reset steps
      $id('reg-step-1').classList.remove('hidden')
      $id('reg-step-2').classList.add('hidden')
      $id('auth-dialogue-text').textContent = ''
      $id('auth-register-username').value = ''
      $id('auth-register-password').value = ''
      $id('auth-register-confirm').value = ''
      
      // Step 1 dialogue
      skipCinematic = false
      await typeWriter($id('auth-dialogue-text'), getLine('intro.reg_step_1', 'Excellent choice! Now, what shall we call you?'))
      $id('auth-register-username').focus()
    }
    
    $id('btn-choice-returning').onclick = async () => {
      // Show Login Phase
      $id('intro-choice-phase').classList.add('hidden')
      $id('intro-auth-phase').classList.remove('hidden')
      $id('intro-auth-login-view').classList.remove('hidden')
      $id('intro-auth-register-view').classList.add('hidden')
      $id('intro-auth-onetime-view')?.classList.add('hidden')

      // Reset login steps
      $id('login-step-1').classList.remove('hidden')
      $id('login-step-2').classList.add('hidden')
      $id('auth-dialogue-text').textContent = ''
      $id('auth-login-username').value = ''
      $id('auth-login-password').value = ''

      skipCinematic = false
      await typeWriter($id('auth-dialogue-text'), getLine('intro.login_step_1', 'Welcome back, Master! Could you remind me of your name?'))
      $id('auth-login-username').focus()
    }

    $id('btn-login-next-1').onclick = async () => {
      const user = $id('auth-login-username').value.trim()
      if (!user) return showToast(t('toast.username_required'))
      
      $id('login-step-1').classList.add('hidden')
      $id('auth-dialogue-text').textContent = ''
      
      skipCinematic = false
      await typeWriter($id('auth-dialogue-text'), getLine('intro.login_step_2', `Great to see you again, ${user}! Please enter your password.`))
      $id('login-step-2').classList.remove('hidden')
      $id('auth-login-password').focus()
    }
    
    $id('btn-reg-next-1').onclick = async () => {
      const user = $id('auth-register-username').value.trim();
      
      // Validation with Professor's voice
      if (!user || user.length < 3) {
        $id('auth-dialogue-text').textContent = '';
        skipCinematic = false;
        await typeWriter($id('auth-dialogue-text'), getLine('intro.err_user_short', 'Oops! That name seems a bit short. I\'ll need at least 3 characters!'));
        return;
      }
      if (!/^[a-zA-Z0-9_]+$/.test(user)) {
        $id('auth-dialogue-text').textContent = '';
        skipCinematic = false;
        await typeWriter($id('auth-dialogue-text'), getLine('intro.err_user_chars', 'I\'m sorry, but you can only use letters, numbers, and underscores in your name!'));
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
            await typeWriter($id('auth-dialogue-text'), getLine('intro.err_user_taken', 'It seems that name is already taken. Could you choose something else?'));
            return;
          }
        }
      } catch (e) {
        console.warn('[Auth] Username check failed (likely endpoint missing):', e);
      }

      $id('reg-step-1').classList.add('hidden');
      $id('auth-dialogue-text').textContent = '';
      
      skipCinematic = false;
      await typeWriter($id('auth-dialogue-text'), getLine('intro.reg_step_2_combined', `Ah, ${user}! A fine name. Please enter a secret password, then type it one more time!`));
      
      $id('reg-step-2').classList.remove('hidden');
      $id('auth-register-password').focus();
    }

    // Explanation Phase Buttons [DELETED]
    
    // Auth Phase Back Button
    $id('btn-auth-back').onclick = () => {
      $id('intro-auth-phase').classList.add('hidden')
      $id('intro-choice-phase').classList.remove('hidden')
    }
  }

  function endIntro(target) {
    // After online auth → go to home; offline/one-time → go to welcome (install screen)
    let dest = target || 'welcome'
    if (isInstalling) {
      dest = 'install';
    }
    if (musicWidget && !isMusicFading) musicWidget.pause();
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
// ── Progress handler ──────────────────────────────────────────
const stepMap = {
  java:      'step-java',
  minecraft: 'step-minecraft',
  fabric:    'step-fabric',
  modpack:   'step-modpack',
}

let overallPercent = 0
let isInstalling = false

if (window.cobble) {
  window.cobble.onProgress(({ step, percent, message }) => {
  // Update message and percent display
  $id('progress-msg').textContent = message || ''
  $id('progress-pct').textContent = `${percent}%`
  $id('progress-fill').style.width = `${percent}%`

  // Map step to overall progress
  const stepWeights = { java: [0,20], minecraft: [20,55], fabric: [55,65], modpack: [65,100], done: [100,100] }
  const range = stepWeights[step]
  let overall = percent;
  if (range) {
    overall = range[0] + ((percent / 100) * (range[1] - range[0]))
    $id('progress-fill').style.width = `${Math.round(overall)}%`
    $id('progress-pct').textContent = `${Math.round(overall)}%`
  }

  // Update intro UI with overall progress
  const introFill = $id('intro-install-fill');
  if (introFill) {
    introFill.style.width = `${Math.round(overall)}%`;
    $id('intro-install-pct').textContent = `${Math.round(overall)}%`;
    $id('intro-install-msg').textContent = message || t('install.preparing');
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
    isInstalling = false;
    const introMsg = $id('intro-install-msg');
    if (introMsg) {
      introMsg.textContent = t('install.done');
      setTimeout(() => {
        $id('intro-install-progress-container')?.classList.add('hidden');
      }, 2000);
    }
    setTimeout(goToHome, 800)
  }
  })
}

async function startInstall() {
  showScreen('install')
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
  if (!window.cobble) return { success: false, error: 'Not in launcher' }
  const result = await window.cobble.install({ username, ram: selectedRam, serverUrl })

  if (!result.success) {
    showToast(t('toast.install_error') + result.error)
    showScreen('welcome')
  }
}

function goToHome() {
  showScreen('home')
  updateUI()
  
  // If not all components are installed, change Play button to Update/Install
  const status = window._lastInstallStatus
  const playBtn = $id('btn-play')
  if (playBtn && status && !status.allDone) {
    playBtn.classList.add('needs-update')
    playBtn.querySelector('span:last-child').textContent = t('welcome.install_btn')
    // Change icon to download
    playBtn.querySelector('.play-icon').innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 20px; height: 20px;"><path d="m12 14 4-4"></path><path d="M3.34 19a10 10 0 1 1 17.32 0"></path></svg>'
  } else if (playBtn) {
    playBtn.classList.remove('needs-update')
    playBtn.querySelector('span:last-child').textContent = t('home.play_btn')
    playBtn.querySelector('.play-icon').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" style="width: 20px; height: 20px;"><path d="m7 4 12 8-12 8V4z"></path></svg>'
  }

  // Update home screen with real version info from state
  const statusInfo = window._lastInstallStatus || {}
  $id('player-name-display').textContent = username || 'Trainer'
  $id('player-avatar').textContent = (username && username.length > 0) ? username.charAt(0).toUpperCase() : '?'
  // Dev check
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    console.log('%c[DEV MODE] Running on Localhost', 'color: #3b82f6; font-weight: bold; font-size: 14px;')
    setTimeout(() => showToast('🚀 Local Development Mode Active'), 2000)
  }
  $id('home-ram-display').textContent = `${selectedRam} MB`
  syncRamUI()

  if (statusInfo.modpackVersion) {
    $id('home-modpack-version').textContent = `COBBLEVERSE ${statusInfo.modpackVersion}`
  }
  if (statusInfo.fabricVersion) {
    $id('home-fabric-version').textContent = `Fabric ${statusInfo.fabricVersion}`
  }

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
    let avatarContent = (p.name && p.name.length > 0) ? p.name.charAt(0).toUpperCase() : '?'
    
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
      ${p.savedPassword ? `
      <div class="p-forget" data-i18n-title="welcome.forget_password" title="Mentett jelszó törlése">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
      </div>` : ''}
      <div class="p-remove" data-i18n-title="skin.remove_profile" title="Profil törlése">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="width: 14px; height: 14px;"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
      </div>
    `
    
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.p-forget')) {
        p.savedPassword = null
        saveProfiles()
        renderProfiles()
        showToast('Mentett jelszó törölve!')
        return
      }
      if (e.target.closest('.p-remove')) {
        profiles = profiles.filter(pr => pr.name !== p.name)
        if (username === p.name) username = ''
        saveProfiles()
        renderProfiles()
        return
      }

      if (p.savedPassword) {
        try {
          const serverUrl = $id('input-server-url').value.trim() || 'http://94.72.100.43:8080'
          const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: p.name, password: p.savedPassword })
          })
          if (res.ok) {
            selectProfile(p.name)
            return
          } else {
            p.savedPassword = null
            saveProfiles()
          }
        } catch (_) {}
      }

      openProfileLoginModal(p.name)
    })
    
    list.appendChild(item)
  })
  
  updateUI()
}

let pendingProfileName = null

function openProfileLoginModal(name) {
  pendingProfileName = name
  const display = $id('profile-login-username-display')
  if (display) display.textContent = name
  const input = $id('input-profile-password')
  if (input) input.value = ''
  const checkbox = $id('check-remember-password')
  if (checkbox) checkbox.checked = false
  
  const modal = $id('modal-profile-login')
  if (modal) {
    modal.classList.remove('hidden')
    setTimeout(() => {
      modal.classList.add('active')
      if (input) input.focus()
    }, 10)
  }
}

$id('btn-close-profile-login')?.addEventListener('click', () => {
  const modal = $id('modal-profile-login')
  if (modal) {
    modal.classList.remove('active')
    setTimeout(() => modal.classList.add('hidden'), 300)
  }
})

$id('btn-submit-profile-login')?.addEventListener('click', async () => {
  const name = pendingProfileName
  const pass = $id('input-profile-password').value
  if (!name || !pass) {
    showToast(t('intro.err_fill_all') || 'Minden mező kitöltése kötelező!')
    return
  }

  const btn = $id('btn-submit-profile-login');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.innerHTML = '<div class="loading-spinner small" style="margin:0; width:16px; height:16px;"></div>';

  try {
    const serverUrl = $id('input-server-url').value.trim() || 'http://94.72.100.43:8080'
    const res = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: name, password: pass })
    })
    
    if (!res.ok) {
      showToast(t('intro.err_login') || 'Hibás jelszó vagy felhasználónév!')
      btn.disabled = false;
      btn.textContent = originalText;
      return
    }

    // Success
    if ($id('check-remember-password')?.checked) {
      const p = getProfile(name)
      if (p) {
        p.savedPassword = pass
        saveProfiles()
      }
    }

    const modal = $id('modal-profile-login')
    if (modal) {
      modal.classList.remove('active')
      setTimeout(() => modal.classList.add('hidden'), 300)
    }
    
    // Reset button state on success so it's usable again if they go back
    btn.disabled = false
    btn.textContent = originalText
    
    selectProfile(name)

  } catch (e) {
    showToast('Hálózati hiba: ' + e.message)
    btn.disabled = false;
    btn.textContent = originalText;
  }
})

// Allow pressing Enter in password field to submit
$id('input-profile-password')?.addEventListener('keypress', (e) => {
  if (e.key === 'Enter') {
    $id('btn-submit-profile-login').click()
  }
})

async function selectProfile(name) {
  username = name
  localStorage.setItem('cobble_username', name)
  
  const p = getProfile(name)
  currentProfile = p
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
  if (!window.cobble) return
  const status = await window.cobble.checkInstalled()
  window._lastInstallStatus = status
  
  goToHome()
  applyAvatar()

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
    if (!window.cobble) return
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
$id('btn-play').addEventListener('click', handleLaunch)

async function handleLaunch() {
  const btn = $id('btn-play')
  if (btn.disabled) return

  // Check if we need to install first
  const status = window._lastInstallStatus
  if (status && !status.allDone) {
    startInstall()
    return
  }
  
  btn.disabled = true
  btn.querySelector('span:last-child').textContent = t('home.launching')

  const serverUrl = $id('input-server-url').value.trim()
  showToast(t('toast.whitelisting'))

  // ── Launcher Verification ─────────────────────────────────
  try {
    // ── Get HWID with fallback for Web/Browser environments ──
    let hwid = null
    if (window.cobble && typeof window.cobble.getHWID === 'function') {
      hwid = await window.cobble.getHWID()
    } else {
      // Fallback: use a persistent random ID stored in localStorage
      hwid = localStorage.getItem('cobble_hwid')
      if (!hwid) {
        hwid = generateUUID()
        localStorage.setItem('cobble_hwid', hwid)
      }
      console.warn('[Launcher] window.cobble.getHWID not found, using fallback ID:', hwid)
    }
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
    
    if (!window.cobble) return { success: false, error: 'Not in launcher' }
    const result = await window.cobble.launch({ 
      username, 
      uuid: verifyData.uuid, 
      ram: selectedRam, 
      serverUrl,
      closeOnLaunch
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
}


function addLog(data) {
  const log = $id('console-log')
  if (!log) return
  log.textContent += data + '\n'
  log.scrollTop = log.scrollHeight
}

if (window.cobble) {
  window.cobble.onGameLog((data) => {
    addLog(data)
  })

  window.cobble.onGameClosed(() => {
    isGameRunning = false
    const btn = $id('btn-play')
    btn.disabled = false
    btn.querySelector('span:last-child').textContent = t('home.play_btn')
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


// Showcase – lokális cache + szerver szinkronizáció
const SHOWCASE_CACHE_KEY = 'cobble_showcase_cache'

function getTodayStr() {
  return new Date().toISOString().slice(0, 10) // "YYYY-MM-DD"
}

function applyShowcaseToUI(p) {
  const img = $id('hub-showcase-sprite')
  const nameEl = $id('hub-showcase-name')
  const descEl = $id('hub-showcase-desc')
  if (!p) return
  if (img) {
    img.src = `https://play.pokemonshowdown.com/sprites/ani/${p.sprite || 'pikachu'}.gif`
    img.onerror = () => {
      img.src = `https://play.pokemonshowdown.com/sprites/dex/${p.sprite || 'pikachu'}.png`
    }
  }
  if (nameEl) nameEl.textContent = p.name || '???'
  if (descEl) {
    const localized = t(p.descKey)
    if (localized === p.descKey) {
      descEl.textContent = p.apiDesc || t('showcase.generic_desc').replace('{}', p.name)
    } else {
      descEl.setAttribute('data-i18n', p.descKey)
      descEl.textContent = localized
    }
  }
}

async function randomizeHubShowcase() {
  const serverUrl = $id('input-server-url')?.value?.trim() || 'http://94.72.100.43:8080'
  const today = getTodayStr()

  // 1. Azonnali megjelenítés a cache-ből (ha mai napra szól)
  try {
    const cached = JSON.parse(localStorage.getItem(SHOWCASE_CACHE_KEY) || 'null')
    if (cached && cached.date === today && cached.pokemon) {
      applyShowcaseToUI(cached.pokemon)
      console.log(`[Showcase] Megjelenítve cache-ből: ${cached.pokemon.name} (${today})`)
    }
  } catch (_) {}

  // 2. Háttérben frissítés a szerverről
  try {
    const res = await fetch(`${serverUrl}/api/showcase`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const p = await res.json()

    // Ha más Pokémon jött vissza (pl. új nap), frissítjük a UI-t
    applyShowcaseToUI(p)

    // Cache mentése
    try {
      localStorage.setItem(SHOWCASE_CACHE_KEY, JSON.stringify({ date: today, pokemon: p }))
    } catch (_) {}

    console.log(`[Showcase] Szerver válasz: ${p.name} (${today})`)
  } catch (e) {
    console.warn('[Showcase] Szerver elérhetetlen, cache-ből fut:', e.message)
  }
}
randomizeHubShowcase()

let leaderboardCache = {}
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

  // Use cache if available to prevent flicker
  if (leaderboardCache[category]) {
    renderLeaderboard(leaderboardCache[category], category)
  }

  // Read server URL
  let serverUrl = $id('input-server-url').value.trim()
  if (!serverUrl) serverUrl = 'http://94.72.100.43:8080'

  try {
    const res = await fetch(`${serverUrl}/api/leaderboard?category=${category}`)
    const data = await res.json()
    
    leaderboardCache[category] = data
    renderLeaderboard(data, category)
  } catch (e) {
    if (!leaderboardCache[category]) {
      tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:var(--accent-red);">${t('leaderboard.error')}</td></tr>`
    }
  }
}

function renderLeaderboard(data, category) {
  const tbody = $id('hub-leaderboard-body')
  if (!tbody) return

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="3" style="text-align:center; color:#888;">${t('leaderboard.empty')}</td></tr>`
    return
  }

  let html = ''
  data.forEach((p, index) => {
    const rankClass = index < 3 ? `rank-${index + 1}` : ''
    const rankContent = index < 3 ? `<span class="rank-badge ${rankClass}">${index + 1}</span>` : index + 1
    
    // BUG FIX: Removed fallback to p.playtime which caused "0" values to show playtime instead
    let rawValue = parseFloat(p.value)
    if (isNaN(rawValue)) rawValue = 0

    let valDisplay = ''
    if (category === 'playtime') {
      // The server sends playtime in HOURS (e.g. 1.25)
      const totalMins = Math.round(rawValue * 60)
      const h = Math.floor(totalMins / 60)
      const m = totalMins % 60
      valDisplay = `${h}${t('leaderboard.unit_hours')} ${m}${t('leaderboard.unit_minutes')}`
    } else {
      // Caught / Shiny / Pokedex are whole numbers
      valDisplay = `${Math.floor(rawValue)}${t('leaderboard.unit_pieces')}`
    }

    html += `
      <tr>
        <td class="rank-cell">${rankContent}</td>
        <td class="player-cell" style="font-weight: 600;">${p.username}</td>
        <td class="value-cell" style="color: var(--accent-yellow); font-family: 'JetBrains Mono', monospace;">${valDisplay}</td>
      </tr>
    `
  })
  tbody.innerHTML = html
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
    statusEl.textContent = t('rewards.error_no_profile')
    return
  }

  let serverUrl = $id('input-server-url').value.trim()
  if (!serverUrl) serverUrl = 'http://94.72.100.43:8080'

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
      statusEl.textContent = data.error || t('rewards.error_prefix') + res.status
    }
  } catch (e) {
    console.error('[Hub] Reward claim error:', e)
    statusEl.className = 'hub-reward-status error'
    statusEl.textContent = t('rewards.error_network') + (e.message || t('rewards.error_unknown'))
  } finally {
    btn.disabled = false
    btn.innerHTML = `<span data-i18n="rewards.btn">${t('rewards.btn')}</span>`
  }
})

// ── Campaign System ───────────────────────────────────────────
/**
 * Kanto Gym Leader → Elite 4 → Champion timeline.
 * Adatok a szerverről jönnek (/api/campaign/status).
 * A timeline csak az AKTUÁLIS ellenfelet mutatja részletesen,
 * a többi zárolva (locked) vagy befejezve (done).
 */

// Sprite mapping – Showdown sprite nevei a karakterekhez
const CAMPAIGN_SPRITES = {
  brock:    'https://play.pokemonshowdown.com/sprites/xyani/onix.gif',
  misty:    'https://play.pokemonshowdown.com/sprites/xyani/starmie.gif',
  lt_surge: 'https://play.pokemonshowdown.com/sprites/xyani/raichu.gif',
  erika:    'https://play.pokemonshowdown.com/sprites/xyani/vileplume.gif',
  koga:     'https://play.pokemonshowdown.com/sprites/xyani/weezing.gif',
  sabrina:  'https://play.pokemonshowdown.com/sprites/xyani/alakazam.gif',
  blaine:   'https://play.pokemonshowdown.com/sprites/xyani/arcanine.gif',
  giovanni: 'https://play.pokemonshowdown.com/sprites/xyani/rhydon.gif',
  lorelei:  'https://play.pokemonshowdown.com/sprites/xyani/lapras.gif',
  bruno:    'https://play.pokemonshowdown.com/sprites/xyani/machamp.gif',
  agatha:   'https://play.pokemonshowdown.com/sprites/xyani/gengar.gif',
  lance:    'https://play.pokemonshowdown.com/sprites/xyani/dragonite.gif',
  blue:     'https://play.pokemonshowdown.com/sprites/xyani/blastoise.gif',
}

let _campaignStatus = null   // cached status from server
let _campaignLoading = false

function getCampaignServerUrl() {
  const v = $id('input-server-url')?.value?.trim()
  return (v || 'http://94.72.100.43:8080').replace(/\/+$/, '')
}

async function loadCampaignStatus() {
  if (_campaignLoading) return
  _campaignLoading = true

  const uname = currentProfile?.name || username
  if (!uname) { _campaignLoading = false; return }

  try {
    const url = `${getCampaignServerUrl()}/api/campaign/status?username=${encodeURIComponent(uname)}`
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    _campaignStatus = await res.json()
    renderCampaignUI()
  } catch (e) {
    console.warn('[Campaign] Status fetch failed:', e.message)
    // Ha nincs szerver, mutassunk fallback-et (0 legyőzve)
    _campaignStatus = { defeated_count: 0, defeated_ids: [], currentStage: null, total: 13 }
    renderCampaignUI()
  } finally {
    _campaignLoading = false
  }
}

function renderCampaignUI() {
  if (!_campaignStatus) return
  const { defeated_ids, claimed_ids, currentStageIndex, currentStage, total } = _campaignStatus

  // Progress bar
  const pct = Math.round((currentStageIndex / total) * 100)
  const fillEl = $id('campaign-progress-fill')
  if (fillEl) fillEl.style.width = `${pct}%`

  const labelEl = $id('campaign-progress-label')
  if (labelEl) {
    if (currentStageIndex >= total) {
      labelEl.textContent = '🏆 Bajnoki cím megszerzve!'
    } else {
      const stageName = currentStage?.name || '?'
      labelEl.textContent = `Következő: ${stageName}`
    }
  }
  const pctEl = $id('campaign-progress-pct')
  if (pctEl) pctEl.textContent = `${currentStageIndex} / ${total}`

  // Timeline nodes
  renderCampaignTimeline(currentStageIndex, claimed_ids)

  // Detail panel
  renderCampaignDetail(currentStage, currentStageIndex >= total, defeated_ids)
}

// Stage type → section order
const SECTION_BREAKS = { 0: 'Gym Leaders', 8: 'Elit Négyes', 12: 'Bajnok' }

function renderCampaignTimeline(currentStageIndex, claimed_ids) {
  const timeline = $id('campaign-timeline')
  if (!timeline) return
  timeline.innerHTML = ''

  // All 13 stages (public data – we hardcode names/icons client-side for the locked ones)
  const allStages = [
    { id:'brock', name:'Brock', icon:'🪨', type:'gym' },
    { id:'misty', name:'Misty', icon:'💧', type:'gym' },
    { id:'lt_surge', name:'Lt. Surge', icon:'⚡', type:'gym' },
    { id:'erika', name:'Erika', icon:'🌿', type:'gym' },
    { id:'koga', name:'Koga', icon:'💜', type:'gym' },
    { id:'sabrina', name:'Sabrina', icon:'🔮', type:'gym' },
    { id:'blaine', name:'Blaine', icon:'🔥', type:'gym' },
    { id:'giovanni', name:'Giovanni', icon:'🌍', type:'gym' },
    { id:'lorelei', name:'Lorelei', icon:'🏅', type:'elite4' },
    { id:'bruno', name:'Bruno', icon:'🏅', type:'elite4' },
    { id:'agatha', name:'Agatha', icon:'🏅', type:'elite4' },
    { id:'lance', name:'Lance', icon:'🏅', type:'elite4' },
    { id:'blue', name:'Blue', icon:'👑', type:'champion' },
  ]

  allStages.forEach((stage, idx) => {
    // Section label
    if (SECTION_BREAKS[idx] !== undefined) {
      const lbl = document.createElement('div')
      lbl.className = 'campaign-section-label'
      lbl.textContent = SECTION_BREAKS[idx]
      timeline.appendChild(lbl)
    }

    // Connector line (not for first)
    if (idx > 0 && SECTION_BREAKS[idx] === undefined) {
      const conn = document.createElement('div')
      const prevDone = idx <= currentStageIndex
      conn.className = `campaign-node-connector ${prevDone ? 'done' : ''}`
      timeline.appendChild(conn)
    }

    const isDone   = claimed_ids.includes(stage.id)
    const isActive = idx === currentStageIndex
    const isLocked = idx > currentStageIndex

    const node = document.createElement('div')
    node.className = `campaign-node ${isDone ? 'done' : ''} ${isActive ? 'active' : ''} ${isLocked ? 'locked' : ''}`

    // Dot
    const dot = document.createElement('div')
    dot.className = 'campaign-node-dot'
    if (isDone) {
      dot.textContent = '✅'
    } else if (isActive) {
      dot.textContent = stage.icon
    } else {
      dot.textContent = isLocked ? '🔒' : stage.icon
    }

    // Label
    const lbl = document.createElement('div')
    lbl.className = 'campaign-node-label'
    lbl.innerHTML = `
      <span class="campaign-node-name">${isLocked && idx > currentStageIndex + 0 ? (isActive ? stage.name : '???') : stage.name}</span>
      <span class="campaign-node-sub">${isDone ? 'Átvett ✓' : isActive ? 'Aktuális' : isLocked ? 'Zárolt' : ''}</span>
    `

    // Active stage name is always visible
    if (isActive) lbl.querySelector('.campaign-node-name').textContent = stage.name

    node.appendChild(dot)
    node.appendChild(lbl)
    timeline.appendChild(node)
  })

  // Scroll active node into view
  const activeNode = timeline.querySelector('.campaign-node.active')
  if (activeNode) {
    setTimeout(() => activeNode.scrollIntoView({ behavior: 'smooth', block: 'center' }), 100)
  }
}

function renderCampaignDetail(currentStage, isChampion, defeated_ids = []) {
  const loadingEl  = $id('campaign-detail-loading')
  const contentEl  = $id('campaign-detail-content')
  const championEl = $id('campaign-champion-state')

  if (!loadingEl || !contentEl || !championEl) return

  // Hide loading
  loadingEl.style.display = 'none'

  if (isChampion) {
    contentEl.classList.add('hidden')
    championEl.classList.remove('hidden')
    return
  }

  if (!currentStage) {
    contentEl.classList.add('hidden')
    return
  }

  contentEl.classList.remove('hidden')
  championEl.classList.add('hidden')

  // Badge type styling
  const badgeEl = $id('campaign-stage-badge')
  if (badgeEl) {
    if (currentStage.type === 'champion') {
      badgeEl.className = 'campaign-stage-badge champion'
      badgeEl.textContent = '👑 Bajnok'
    } else if (currentStage.type === 'elite4') {
      badgeEl.className = 'campaign-stage-badge elite4'
      badgeEl.textContent = '🏅 Elit Négyes'
    } else {
      badgeEl.className = 'campaign-stage-badge'
      badgeEl.textContent = '🏋️ Gym Leader'
    }
  }

  // Sprite
  const spriteEl = $id('campaign-detail-sprite')
  if (spriteEl) {
    const spriteUrl = CAMPAIGN_SPRITES[currentStage.id] || `https://play.pokemonshowdown.com/sprites/xyani/${currentStage.id}.gif`
    spriteEl.src = spriteUrl
    spriteEl.alt = currentStage.name
  }

  // Text fields
  const setEl = (id, txt) => { const el = $id(id); if (el) el.textContent = txt || '' }

  setEl('campaign-detail-name',      currentStage.name)
  setEl('campaign-detail-title',     currentStage.title)
  setEl('campaign-detail-badge',     `${currentStage.badgeIcon || ''} ${currentStage.badge || ''}`)
  setEl('campaign-detail-specialty', currentStage.specialty)
  setEl('campaign-detail-pokemon',   currentStage.pokemon?.join(' · ') || '')
  setEl('campaign-detail-levelcap',  currentStage.levelCap ? `Max. ${currentStage.levelCap} szint` : '')
  setEl('campaign-detail-hint',      currentStage.hint)
  setEl('campaign-detail-reward',    currentStage.rewardText)

  // Complete button state based on whether it was defeated in-game
  const completeBtn = $id('btn-campaign-complete')
  if (completeBtn) {
    const isDefeatedInGame = defeated_ids.includes(currentStage.id)

    if (isDefeatedInGame) {
      completeBtn.disabled = false
      completeBtn.style.background = 'linear-gradient(135deg, #eab308, #ca8a04)'
      completeBtn.style.boxShadow = '0 0 15px rgba(234, 179, 8, 0.4)'
      completeBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><path d="M20 6L9 17l-5-5"></path></svg>
        Jutalom átvétele!
      `
      const hint = $id('campaign-detail-content').querySelector('.campaign-complete-hint')
      if (hint) hint.innerHTML = '<span style="color: #4ade80;">Gatratulálunk! Legyőzted a játékban!</span>'
    } else {
      completeBtn.disabled = true
      completeBtn.style.background = 'rgba(255,255,255,0.05)'
      completeBtn.style.boxShadow = 'none'
      completeBtn.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="width:18px;height:18px;"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>
        Zárolva (Nem győzted le)
      `
      const hint = $id('campaign-detail-content').querySelector('.campaign-complete-hint')
      if (hint) hint.textContent = 'Keresd meg a játékban, és nyerj ellene a feloldáshoz!'
    }
  }
}

// ── Complete button ────────────────────────────────────────────
$id('btn-campaign-complete')?.addEventListener('click', async () => {
  const uname = currentProfile?.name || username
  if (!uname) return showToast('❌ Nincs bejelentkezett profil!')
  if (!_campaignStatus?.currentStage) return

  const stageId = _campaignStatus.currentStage.id
  const btn = $id('btn-campaign-complete')
  btn.disabled = true
  btn.innerHTML = '<div class="loading-spinner small" style="margin:0;width:18px;height:18px;"></div> Kérés folyamatban...'

  try {
    const res = await fetch(`${getCampaignServerUrl()}/api/campaign/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: uname, stageId })
    })
    const data = await res.json()
    if (res.ok) {
      const stageName = _campaignStatus.currentStage.name
      showToast(`🎁 ${stageName} jutalma sikeresen átvéve!`)
      _campaignStatus = null  // force reload
      await loadCampaignStatus()
    } else {
      showToast(`❌ ${data.error || 'Szerver hiba.'}`)
      _campaignStatus = null
      await loadCampaignStatus() // Reload to reset button state
    }
  } catch (e) {
    console.error('[Campaign] Complete error:', e)
    showToast('❌ Hálózati hiba!')
    _campaignStatus = null
    await loadCampaignStatus()
  }
})

// ── Open / Close campaign modal ───────────────────────────────
$id('btn-campaign')?.addEventListener('click', () => {
  $id('modal-campaign')?.classList.remove('hidden')
  _campaignStatus = null  // always refresh on open
  loadCampaignStatus()
})

$id('btn-close-campaign')?.addEventListener('click', () => {
  $id('modal-campaign')?.classList.add('hidden')
})

// Close on outside click
$id('modal-campaign')?.addEventListener('click', (e) => {
  if (e.target === $id('modal-campaign')) {
    $id('modal-campaign').classList.add('hidden')
  }
})


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
  if (window.introShowError) await window.introShowError(t('intro.connecting') || 'One moment, let me check with the headquarters...');

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
        : (t('intro.err_invalid_credentials') || 'Incorrect username or password! Are you sure you typed it right? Try again!')
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
    let msg = t('intro.err_network').replace('{}', e.message);
    if (e.name === 'AbortError') msg = t('intro.err_timeout') || 'The server did not respond in time. Please try again!';
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
    await typeWriter($id('auth-dialogue-text'), getLine('intro.err_pass_short', 'I\'m sorry, but the password must be at least 6 characters long for your security!'));
    return;
  }
  if (pass !== confirm) {
    $id('auth-dialogue-text').textContent = '';
    skipCinematic = false;
    typeWriter($id('auth-dialogue-text'), getLine('intro.err_pass_mismatch', 'Hmm, the two passwords don\'t match. Be careful with your typing!'));
    return;
  }

  const btn = $id('btn-auth-register');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = '...';

  // Show "Connecting..." message
  $id('auth-dialogue-text').textContent = '';
  skipCinematic = false;
  await typeWriter($id('auth-dialogue-text'), getLine('intro.connecting', 'One moment, let me check with the headquarters...'));

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
      const errorMsg = data.error || t('intro.err_server').replace('{}', res.status);
      await typeWriter($id('auth-dialogue-text'), errorMsg);
      btn.disabled = false;
      btn.textContent = originalText;
      return;
    }

    showToast(t('toast.login_success'))
    
    // Save new profile
    const existing = profiles.find(p => p.name === user)
    if (!existing) {
      profiles.push({ name: user, profileId: generateUUID(), uuid: data.uuid })
      saveProfiles()
      renderProfiles()
    } else {
      existing.uuid = data.uuid
      saveProfiles()
    }
    selectProfile(user)
    username = user

    // Trigger closing cinematic
    if (window.endIntroFromAuth) window.endIntroFromAuth()
  } catch (e) {
    console.error('[Auth] Registration error:', e);
    $id('auth-dialogue-text').textContent = '';
    skipCinematic = false;
    let msg = t('intro.err_network').replace('{}', e.message);
    if (e.name === 'AbortError') msg = t('intro.err_timeout') || 'The server did not respond in time. Please try again!';
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
$id('btn-start-intro').addEventListener('click', () => {
  startIntro()
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
      currentProfile = getProfile(username)
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
      const parsed = parseInt(savedRam)
      if (!isNaN(parsed) && parsed > 0) selectedRam = parsed
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
  const syncRamUI = () => {
    const ramVal = parseInt(selectedRam)
    document.querySelectorAll('.ram-btn').forEach(btn => {
      const btnVal = parseInt(btn.dataset.val)
      const isActive = btnVal === ramVal
      const isRecommended = !!btn.querySelector('.recommended-badge')

      btn.classList.toggle('active', isActive)

      if (isActive && isRecommended) {
        // Selected AND recommended: gold border + blue glow blend
        btn.style.borderColor = 'var(--accent-gold)'
        btn.style.boxShadow = '0 0 18px rgba(251, 191, 36, 0.55)'
      } else if (isActive) {
        // Selected only: blue
        btn.style.borderColor = 'var(--accent-blue)'
        btn.style.boxShadow = '0 0 12px rgba(96, 165, 250, 0.2)'
      } else if (isRecommended) {
        // Recommended but not selected: gold
        btn.style.borderColor = 'var(--accent-gold)'
        btn.style.boxShadow = '0 0 18px rgba(251, 191, 36, 0.45)'
      } else {
        // Plain
        btn.style.borderColor = ''
        btn.style.boxShadow = ''
      }
    })
    const display = $id('home-ram-display')
    if (display) display.textContent = `${ramVal} MB`
    updateRamWarning()
  }

  document.querySelectorAll('.ram-btn').forEach(btn =>
    btn.addEventListener('click', () => {
      selectedRam = parseInt(btn.dataset.val)
      try { localStorage.setItem('cobble_ram', btn.dataset.val) } catch(e) {}
      syncRamUI()
    })
  )

  // Settings: Close on launch & Power save
  $id('check-close-launch').checked = closeOnLaunch
  $id('check-close-launch').addEventListener('change', (e) => {
    closeOnLaunch = e.target.checked
    localStorage.setItem('cobble_close_launch', closeOnLaunch)
  })

  $id('check-power-save').checked = powerSaveEnabled
  $id('check-power-save').addEventListener('change', (e) => {
    powerSaveEnabled = e.target.checked
    localStorage.setItem('cobble_power_save', powerSaveEnabled)
    if (!powerSaveEnabled) document.body.classList.remove('power-save')
  })

  // Initial sync to ensure UI is consistent
  syncRamUI()

  // Validation: Ensure selectedRam is one of the available options (4GB, 6GB, 8GB, 12GB)
  const validRamValues = [4096, 6144, 8192, 12288]
  if (!validRamValues.includes(parseInt(selectedRam))) {
    console.log(`[System] Invalid RAM setting (${selectedRam}), resetting to 6GB`)
    selectedRam = 6144
    syncRamUI()
  }

  // Detect total memory and set recommendations
  if (window.cobble) {
    try {
      totalSystemMem = await window.cobble.getTotalMem()
    } catch (err) {
      console.warn('[System] Could not fetch total RAM:', err.message)
      totalSystemMem = 0
    }

    const totalGB = totalSystemMem / (1024 * 1024 * 1024)
    const logMsg = `[System] Total RAM detected: ${totalGB.toFixed(2)} GB`
    console.log(logMsg)
    addLog(logMsg)

    // ── Step 1: Check if detection failed → use fallback FIRST ──
    let isFallback = false
    if (isNaN(totalGB) || totalGB <= 0) {
      console.warn('[System] RAM detection failed on this platform, using 6GB safe fallback')
      totalSystemMem = 0
      isFallback = true
    }

    // ── Step 2: Calculate recommended RAM ──
    // Thresholds:
    //  0 GB (detection failed) → 6 GB fallback
    // >20 GB                   → 12 GB recommended
    // >14 GB                   → 8 GB recommended
    // >10 GB                   → 6 GB recommended
    //  else                    → 4 GB recommended
    let recommended
    if (isFallback) {
      recommended = 6144
    } else if (totalGB > 20) {
      recommended = 12288
    } else if (totalGB > 14) {
      recommended = 8192
    } else if (totalGB > 10) {
      recommended = 6144
    } else {
      recommended = 4096
    }

    // ── Step 3: Smart RAM auto-select (only on first run or version bump) ──
    const savedRam = localStorage.getItem('cobble_ram')
    const smartCheckVer = localStorage.getItem('cobble_ram_smart_ver') || '0'
    console.log(`[RAM] savedRam=${savedRam} smartVer=${smartCheckVer} recommended=${recommended} isFallback=${isFallback}`)
    if (!savedRam || smartCheckVer !== '4') {
      selectedRam = recommended
      localStorage.setItem('cobble_ram', String(recommended))
      localStorage.setItem('cobble_ram_smart_ver', '4')
      const msg = `[System] Smart RAM auto-selected: ${recommended} MB (system: ${totalGB.toFixed(1)} GB${isFallback ? ', fallback' : ''})`
      console.log(msg)
      addLog(msg)
    }

    // ── Step 4: Mark the recommended button with a yellow badge ──
    const isHU = currentLang === 'hu'
    const recLabel   = isHU ? 'AJÁNLOTT'       : 'RECOMMENDED'
    const recSubLabel = isHU ? 'Ez az ajánlott' : 'This is recommended'

    document.querySelectorAll('.ram-btn').forEach(btn => {
      // Remove any old badges and sub-labels inside this button
      btn.querySelectorAll('.recommended-badge, .ram-rec-sublabel').forEach(el => el.remove())
      btn.style.boxShadow = ''
      if (!btn.classList.contains('active')) btn.style.borderColor = ''

      if (parseInt(btn.dataset.val) === recommended) {
        // Badge (pill top-right) – always gold/yellow
        const badge = document.createElement('span')
        badge.className = 'recommended-badge'
        badge.textContent = recLabel
        badge.title = recSubLabel
        badge.dataset.isFallback = isFallback

        // Always gold/yellow highlight for the button border & glow
        btn.style.borderColor = 'var(--accent-gold)'
        btn.style.boxShadow   = '0 0 18px rgba(251, 191, 36, 0.45)'
        btn.appendChild(badge)

        // "Ez az ajánlott" sub-label inside the button (bottom)
        const sub = document.createElement('div')
        sub.className = 'ram-rec-sublabel'
        sub.textContent = recSubLabel
        btn.appendChild(sub)
      }
    })

    syncRamUI()
    addLog(`[System] Recommended: ${recommended} MB | Selected: ${selectedRam} MB | Fallback: ${isFallback}`)
  }

  // Power state listener from main process
  if (window.cobble) {
    const setPowerSave = (active) => {
      if (!powerSaveEnabled) return
      const overlay = $id('power-save-overlay')
      if (active) {
        document.body.classList.remove('power-save')
        if (overlay) overlay.classList.add('hidden')
      } else {
        document.body.classList.add('power-save')
        if (overlay) overlay.classList.remove('hidden')
      }
    }

    window.cobble.onPowerState((state) => {
      setPowerSave(state === 'active')
    })

    // Fallback for Linux/other platforms where blur events might be missed
    window.addEventListener('focus', () => setPowerSave(true))
    window.addEventListener('blur', () => setPowerSave(false))
    document.addEventListener('visibilitychange', () => {
      setPowerSave(document.visibilityState === 'visible')
    })
  }
  
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

  function updateRamWarning() {
    const warning = $id('ram-warning')
    if (!warning) return
    
    const totalGB = Math.round(totalSystemMem / (1024 * 1024 * 1024))
    if (totalGB <= 8 && selectedRam > 4096) {
      warning.classList.remove('hidden')
    } else {
      warning.classList.add('hidden')
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
    hintText.innerHTML = `${t('skin.singleplayer_hint').replace('{}', `<code>${skinUrl}</code>`)}`
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
    $id('skin-gallery-wrapper').classList.add('hidden')
    $id('btn-browse-skin').classList.remove('hidden')
  } else if (currentSkinType === 'gallery') {
    $id('skin-input-container').classList.add('hidden')
    $id('skin-gallery-wrapper').classList.remove('hidden')
    $id('btn-browse-skin').classList.add('hidden')
  } else {
    $id('skin-input-container').classList.remove('hidden')
    $id('skin-gallery-wrapper').classList.add('hidden')
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
      $id('skin-gallery-wrapper').classList.add('hidden')
      $id('btn-browse-skin').classList.remove('hidden')
    } else if (currentSkinType === 'gallery') {
      $id('skin-input-container').classList.add('hidden')
      $id('skin-gallery-wrapper').classList.remove('hidden')
      $id('btn-browse-skin').classList.add('hidden')
    } else {
      $id('skin-input-container').classList.remove('hidden')
      $id('skin-gallery-wrapper').classList.add('hidden')
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
  if (currentSkinType === 'gallery') {
    // currentSkinVal is already set when a gallery item is clicked
  } else if (currentSkinType !== 'file') {
    currentSkinVal = $id('input-skin-val').value.trim()
  }

  if (!currentSkinVal) {
    showToast(t('skin.toast_empty'))
    return
  }

  const savedSkinType = (currentSkinType === 'gallery') ? 'url' : currentSkinType;

  try {
    const p = getProfile(username)
    if (p) {
      p.skinType = savedSkinType
      p.skinVal = currentSkinVal
      saveProfiles()
      renderProfiles()
    }
    localStorage.setItem('cobble_skin_type', savedSkinType)
    localStorage.setItem('cobble_skin_val', currentSkinVal)
    currentSkinType = savedSkinType // So next time it opens as URL instead of gallery, or we can keep it as gallery. It's safer to convert to URL.
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
