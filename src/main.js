/**
 * CobbleLauncher – Renderer Process
 * Handles UI state, events, particle animation
 */

// ── State ────────────────────────────────────────────────────
let selectedRam = 4096
let username = ''
let isGameRunning = false
let currentLang = 'en'
let translations = {}

// ── Translation Engine ───────────────────────────────────────
async function loadLanguage() {
  try {
    const locale = await window.cobble.getLocale()
    // Handle both "hu-HU" and "hu_HU" formats across different OS
    const langCode = locale.split(/[-_]/)[0].toLowerCase()
    
    // Check if translation exists, otherwise fallback to English
    const available = ['hu', 'en', 'de', 'fr', 'es', 'it', 'pt', 'nl', 'ru', 'ja', 'ko', 'zh', 'pl', 'tr', 'ro', 'sv', 'da', 'no', 'fi', 'cs']
    currentLang = available.includes(langCode) ? langCode : 'en'
    
    const response = await fetch(`./lang/${currentLang}.json`)
    translations = await response.json()
    
    updateUI()
  } catch (e) {
    console.error('Nyelv betöltési hiba:', e)
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
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder')
    el.placeholder = t(key)
  })
}

// ── DOM refs ─────────────────────────────────────────────────
const screens = {
  welcome: document.getElementById('screen-welcome'),
  install: document.getElementById('screen-install'),
  home:    document.getElementById('screen-home'),
}

const $id = (id) => document.getElementById(id)

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
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 4000)
}

// ── Window controls ───────────────────────────────────────────
$id('btn-minimize').addEventListener('click', () => window.cobble.minimize())
$id('btn-close').addEventListener('click', () => window.cobble.close())

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

async function startInstall() {
  // Reset steps
  Object.values(stepMap).forEach(id => {
    const el = $id(id)
    if (el) {
      el.className = 'step'
      el.querySelector('.step-status').textContent = 'Várakozás...'
      el.querySelector('.step-indicator').className = 'step-indicator idle'
    }
  })
  $id('progress-fill').style.width = '0%'
  $id('progress-msg').textContent = 'Előkészítés...'
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
  btn.textContent = 'Frissítés...'
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
$id('btn-play').addEventListener('click', async () => {
  if (isGameRunning) return
  const btn = $id('btn-play')
  btn.disabled = true
  btn.querySelector('span:last-child').textContent = 'Indítás...'

  const serverUrl = $id('input-server-url').value.trim()
  const result = await window.cobble.launch({ username, ram: selectedRam, serverUrl })
  if (!result.success) {
    showToast(`❌ Indítási hiba: ${result.error}`)
    btn.disabled = false
    btn.querySelector('span:last-child').textContent = 'JÁTÉK INDÍTÁSA'
    return
  }

  isGameRunning = true
  btn.querySelector('span:last-child').textContent = 'Játék fut...'
})

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

// ── Console toggle ────────────────────────────────────────────
$id('btn-console-toggle').addEventListener('click', () => {
  $id('console-overlay').classList.remove('hidden')
})
$id('console-close').addEventListener('click', () => {
  $id('console-overlay').classList.add('hidden')
})

// ── External links ────────────────────────────────────────────
$id('link-modrinth').addEventListener('click', () => {
  window.cobble.openExternal('https://modrinth.com/modpack/cobbleverse')
})
$id('link-discord').addEventListener('click', () => {
  window.cobble.openExternal('https://discord.lumy.fun')
})
$id('link-folder').addEventListener('click', () => {
  window.cobble.openGameFolder()
})

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
  
  // Try to restore saved username and server url
  try {
    const saved = localStorage.getItem('cobble_username')
    if (saved) $id('input-username').value = saved

    const savedUrl = localStorage.getItem('cobble_server_url')
    if (savedUrl) {
      $id('input-server-url').value = savedUrl
    } else {
      $id('input-server-url').value = 'http://94.72.100.43:7878'
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
    try { localStorage.setItem('cobble_username', e.target.value.trim()) } catch(e2) {}
  })
  $id('input-server-url').addEventListener('input', (e) => {
    try { localStorage.setItem('cobble_server_url', e.target.value.trim()) } catch(e2) {}
  })
  document.querySelectorAll('.ram-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      try { localStorage.setItem('cobble_ram', btn.dataset.val) } catch(e) {}
    })
  })

  showScreen('welcome')
})()

// ── Skin Management Logic ──────────────────────────────────────
let currentSkinType = 'mojang'
let currentSkinVal = ''

function updateSkinPreview() {
  const img = $id('skin-preview-img')
  const val = $id('input-skin-val').value.trim() || 'Steve'
  
  if (currentSkinType === 'mojang') {
    img.src = `https://mc-heads.net/body/front/${val}`
  } else {
    img.src = val // Assumes direct image URL
  }
}

function applyAvatar() {
  const avatar = $id('player-avatar')
  const val = currentSkinVal || 'Steve'
  
  if (currentSkinType === 'mojang') {
    avatar.style.backgroundImage = `url(https://mc-heads.net/avatar/${val})`
    avatar.style.backgroundSize = 'cover'
    avatar.textContent = ''
  } else {
    // For URL skins, we might not have a square avatar easily, 
    // but we can try to use the same URL or fallback to first letter.
    avatar.style.backgroundImage = `url(${val})`
    avatar.style.backgroundSize = 'cover'
    avatar.textContent = ''
  }
}

// Event Listeners for Skin Modal
$id('btn-change-skin').addEventListener('click', () => {
  const modal = $id('modal-skin')
  modal.classList.remove('hidden')
  setTimeout(() => modal.classList.add('active'), 10)
  
  // Load current values into modal
  $id('input-skin-val').value = currentSkinVal
  updateSkinPreview()
})

$id('btn-close-skin').addEventListener('click', () => {
  const modal = $id('modal-skin')
  modal.classList.remove('active')
  setTimeout(() => modal.classList.add('hidden'), 300)
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
      $id('input-skin-val').placeholder = currentSkinType === 'mojang' ? 'pl. AshKetchum' : 'https://.../skin.png'
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
    const data = ev.target.result
    $id('skin-preview-img').src = data
    // Store temporarily in currentSkinVal so save button can use it
    currentSkinVal = data 
  }
  reader.readAsDataURL(file)
})

$id('input-skin-val').addEventListener('input', updateSkinPreview)

$id('btn-save-skin').addEventListener('click', async () => {
  if (currentSkinType !== 'file') {
    currentSkinVal = $id('input-skin-val').value.trim()
  }
  
  if (!currentSkinVal) {
    showToast('⚠️ Kérlek adj meg egy nevet, linket vagy válassz fájlt!')
    return
  }

  try {
    localStorage.setItem('cobble_skin_type', currentSkinType)
    localStorage.setItem('cobble_skin_val', currentSkinVal)
  } catch(e) {}
  
  applyAvatar()
  
  // Upload to server for SkinsRestorer integration
  await uploadSkinToServer()

  showToast('✅ Skin elmentve és feltöltve!')
  $id('btn-close-skin').click()
})

async function uploadSkinToServer() {
  const serverUrl = $id('input-server-url').value.trim()
  if (!serverUrl) return

  const payload = {
    username: username,
    skinData: currentSkinVal, // This is either name, url, or base64
    isUrl: currentSkinType === 'url' || currentSkinType === 'mojang'
  }
  
  // Actually, for mojang we might want the server to download it, 
  // but let's just send the name and let the server handle 'isUrl'
  // If currentSkinType is 'mojang', the server will try to download from mc-heads or similar
  // Wait, let's refine the server logic: if it's a mojang name, let's treat it as a special case.
  // Actually, my server logic handles 'isUrl'. If it starts with http, it downloads.
  
  if (currentSkinType === 'mojang') {
    payload.skinData = `https://mc-heads.net/body/front/${currentSkinVal}.png`
    payload.isUrl = true
  }

  try {
    const response = await fetch(`${serverUrl.replace(/\/+$/, '')}/api/upload-skin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    })
    const res = await response.json()
    if (res.success) {
      console.log('[Skins] Skin sikeresen feltöltve a szerverre:', res.url)
    }
  } catch (e) {
    console.warn('[Skins] Nem sikerült feltölteni a skint a szerverre:', e.message)
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
} catch(e) {}
