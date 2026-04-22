/**
 * CobbleLauncher – Renderer Process
 * Handles UI state, events, particle animation
 */

// ── State ────────────────────────────────────────────────────
let selectedRam = 4096
let username = ''
let isGameRunning = false

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
    showToast('⚠️ Adj meg legalább 3 karakteres felhasználónevet!')
    input.focus()
    return
  }
  if (!/^[a-zA-Z0-9_]+$/.test(username)) {
    showToast('⚠️ Csak betűk, számok és _ engedélyezett!')
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

  const result = await window.cobble.install({ username, ram: selectedRam })

  if (!result.success) {
    showToast(`❌ Telepítési hiba: ${result.error}`)
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
      title.textContent = `Frissítés elérhető!`
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
      el.querySelector('.step-status').textContent = 'Várakozás...'
      el.querySelector('.step-indicator').className = 'step-indicator idle'
    }
  })
  $id('progress-fill').style.width = '0%'
  $id('progress-msg').textContent = 'Frissítés indítása...'
  $id('progress-pct').textContent = '0%'

  const result = await window.cobble.runUpdate({ username, ram: selectedRam })
  if (!result.success) {
    showToast(`❌ Frissítési hiba: ${result.error}`)
    showScreen('home')
    btn.disabled = false
    btn.textContent = 'Frissítés'
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
  // Try to restore saved username and server url
  try {
    const saved = localStorage.getItem('cobble_username')
    if (saved) $id('input-username').value = saved

    const savedUrl = localStorage.getItem('cobble_server_url')
    if (savedUrl) $id('input-server-url').value = savedUrl

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
