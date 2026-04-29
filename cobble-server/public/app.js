const $id = id => document.getElementById(id)
let installedModsCache = []
let hitsMap = {} // projectId → hit object (fixes onclick JSON issues)

// -- Auth -------------------------------------------------------
function getToken() { return sessionStorage.getItem('admin_token') || '' }
function setToken(t) { sessionStorage.setItem('admin_token', t) }
function clearToken() { sessionStorage.removeItem('admin_token') }

async function initAuth() {
  const res = await fetch('/admin/api/auth/status')
  const { hasPassword } = await res.json()
  if (!hasPassword) { showAuthOverlay('setup'); return }
  if (getToken()) {
    const check = await fetch('/admin/api/mods', { headers: { Authorization: `Bearer ${getToken()}` } })
    if (check.status === 200) { showMainApp(); return }
    clearToken()
  }
  showAuthOverlay('login')
}

function showAuthOverlay(mode) {
  document.getElementById('auth-overlay').classList.remove('hidden')
  document.getElementById('main-app').classList.add('hidden')
  document.getElementById('auth-setup').classList.add('hidden')
  document.getElementById('auth-login').classList.add('hidden')
  if (mode === 'setup') document.getElementById('auth-setup').classList.remove('hidden')
  else document.getElementById('auth-login').classList.remove('hidden')
}

function showMainApp() {
  document.getElementById('auth-overlay').classList.add('hidden')
  document.getElementById('main-app').classList.remove('hidden')
  loadStatus()
}

document.getElementById('btn-setup').addEventListener('click', async () => {
  const pw1 = document.getElementById('setup-pw1').value
  const pw2 = document.getElementById('setup-pw2').value
  const err = document.getElementById('setup-error')
  err.classList.add('hidden')
  if (pw1.length < 6) { err.textContent = 'A jelszó legalább 6 karakter kell legyen!'; err.classList.remove('hidden'); return }
  if (pw1 !== pw2) { err.textContent = 'A két jelszó nem egyezik!'; err.classList.remove('hidden'); return }
  try {
    const res = await fetch('/admin/api/auth/setup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw1 })
    })
    const data = await res.json()
    if (!res.ok) { err.textContent = data.error; err.classList.remove('hidden'); return }
    setToken(data.token); showMainApp()
  } catch (e) { err.textContent = 'Hiba: ' + e.message; err.classList.remove('hidden') }
})
document.getElementById('setup-pw2').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-setup').click() })

document.getElementById('btn-login').addEventListener('click', async () => {
  const pw = document.getElementById('login-pw').value
  const err = document.getElementById('login-error')
  err.classList.add('hidden')
  try {
    const res = await fetch('/admin/api/auth/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw })
    })
    const data = await res.json()
    if (!res.ok) { err.textContent = data.error; err.classList.remove('hidden'); return }
    setToken(data.token); showMainApp()
  } catch (e) { err.textContent = 'Hiba: ' + e.message; err.classList.remove('hidden') }
})
document.getElementById('login-pw').addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('btn-login').click() })

document.getElementById('btn-logout').addEventListener('click', async () => {
  await fetch('/admin/api/auth/logout', { method: 'POST', headers: { Authorization: `Bearer ${getToken()}` } }).catch(() => {})
  clearToken(); showAuthOverlay('login')
})


// ── UI Navigation ────────────────────────────────────────────────
document.querySelectorAll('.nav-item').forEach(el => {
  el.addEventListener('click', e => {
    e.preventDefault()
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'))
    document.querySelectorAll('.tab-content').forEach(n => n.classList.remove('active'))
    el.classList.add('active')
    $id(`tab-${el.dataset.tab}`).classList.add('active')
    if (el.dataset.tab === 'status') loadStatus()
    if (el.dataset.tab === 'mods') loadInstalledMods()
    if (el.dataset.tab === 'search') refreshInstalledCache()
    if (el.dataset.tab === 'configs') loadConfigs()
  })
})

// ── Toasts ───────────────────────────────────────────────────────
function showToast(msg) {
  const t = $id('toast')
  t.textContent = msg
  t.classList.add('show')
  setTimeout(() => t.classList.remove('show'), 3500)
}

// ── API Helpers ──────────────────────────────────────────────────
async function fetchApi(path, options = {}) {
  options.headers = options.headers || {}
  options.headers['Authorization'] = `Bearer ${getToken()}`
  const res = await fetch(path, options)
  if (res.status === 401) { clearToken(); showAuthOverlay('login'); throw new Error('Munkamenet lejárt.') }
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

function formatNumber(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K'
  return String(n)
}

// ── Status Tab ───────────────────────────────────────────────────
async function loadStatus() {
  try {
    const data = await fetchApi('/')
    $id('server-mod-count').textContent = `${data.modCount} db`
    $id('server-ip').textContent = `http://localhost:${data.port}`
    if (data.nextRestart) {
      const date = new Date(data.nextRestart)
      $id('server-restart-time').textContent = date.toLocaleTimeString('hu-HU', { hour: '2-digit', minute: '2-digit' })
    } else {
      $id('server-restart-time').textContent = '--'
    }
    updateStatusUI(data.status)
  } catch (e) { console.error('Státusz hiba:', e) }
}

function updateStatusUI(status) {
  const badge = $id('server-status')
  const s = $id('btn-start'), p = $id('btn-stop'), r = $id('btn-restart')
  if (status === 'running') {
    badge.className = 'badge badge-success'; badge.textContent = 'Fut'
    s.disabled = true; p.disabled = false; r.disabled = false
  } else if (status === 'stopped') {
    badge.className = 'badge badge-danger'; badge.textContent = 'Leállítva'
    s.disabled = false; p.disabled = true; r.disabled = true
  } else {
    badge.className = 'badge badge-warning'; badge.textContent = 'Folyamatban...'
    s.disabled = true; p.disabled = true; r.disabled = true
  }
}

setInterval(() => { if ($id('tab-status').classList.contains('active')) loadStatus() }, 2000)

async function serverAction(action) {
  try {
    const res = await fetchApi(`/admin/api/server/${action}`, { method: 'POST' })
    updateStatusUI(res.status); showToast('Parancs elküldve...')
  } catch (e) { showToast(`Hiba: ${e.message}`) }
}

$id('btn-start').addEventListener('click', () => serverAction('start'))
$id('btn-stop').addEventListener('click', () => serverAction('stop'))
$id('btn-restart').addEventListener('click', () => serverAction('restart'))

// ── Installed Mods ───────────────────────────────────────────────
let activeModFilter = 'all'
let modsFilterText = ''

async function loadInstalledMods() {
  const list = $id('installed-mods-list')
  list.innerHTML = '<p style="color:var(--text-muted)">Kérlek várj...</p>'
  try {
    const data = await fetchApi('/admin/api/mods')
    installedModsCache = data.mods
    if (!data.mods.length) {
      list.innerHTML = '<p style="color:var(--text-muted)">Nincsenek telepítve modok.</p>'
      updateModsFilterCount(0, 0); return
    }
    renderMods(data.mods)
    checkForUpdates(data.mods)
  } catch (e) { list.innerHTML = `<p style="color:red">Hiba: ${e.message}</p>` }
}

function getFilteredMods(mods) {
  let f = mods
  if (modsFilterText) {
    const q = modsFilterText.toLowerCase()
    f = f.filter(m => (m.realName || m.filename).toLowerCase().includes(q))
  }
  if (activeModFilter === 'custom') f = f.filter(m => !m.isBase)
  if (activeModFilter === 'base')   f = f.filter(m =>  m.isBase)
  if (activeModFilter === 'update') f = f.filter(m =>  m.updateAvailable)
  return f
}

function updateModsFilterCount(shown, total) {
  const el = $id('mods-filter-count')
  if (el) el.textContent = shown === total ? `${total} mod` : `${shown} / ${total} mod`
}

function renderMods(mods) {
  const list = $id('installed-mods-list')
  const filtered = getFilteredMods(mods)
  updateModsFilterCount(filtered.length, mods.length)
  if (!filtered.length) {
    list.innerHTML = '<p style="color:var(--text-muted);padding:20px 0">Nincs találat a szűrési feltételekre.</p>'
    return
  }
  list.innerHTML = filtered.map(mod => {
    const icon = mod.iconUrl || ''
    const title = mod.realName || mod.filename
    const vBadge = mod.currentVersion ? `<span class="badge" style="background:rgba(255,255,255,0.1);color:#aaa">v${mod.currentVersion}</span>` : ''
    const upBadge = mod.updateAvailable ? `<span class="badge badge-warning">Új: ${mod.newVersion}</span>` : ''
    const typeBadge = mod.isBase
      ? '<span class="badge badge-success">Modpack Alap</span>'
      : '<span class="badge" style="background:rgba(59,130,246,0.2);color:#3b82f6">Saját Mod</span>'
    return `
    <div class="mod-item">
      <div class="mod-icon" style="background-image:url('${icon}');background-size:cover;background-color:rgba(255,255,255,0.05);border-radius:10px;flex-shrink:0;width:56px;height:56px"></div>
      <div class="mod-info">
        <div class="mod-title">${title} ${typeBadge} ${vBadge} ${upBadge}</div>
        <div class="mod-author">Fájl: ${mod.filename} (${Math.round(mod.size/1024)} KB)</div>
      </div>
      <div class="mod-actions">
        ${mod.updateAvailable ? `<button class="btn-success" onclick="updateMod('${mod.projectId}','${mod.filename}',this)">Frissítés</button>` : ''}
        ${mod.isBase
          ? '<button class="btn-danger" disabled>Törlés</button>'
          : `<button class="btn-danger" onclick="removeMod('${mod.filename}','mods')">Törlés</button>`}
      </div>
    </div>`
  }).join('')
}

async function checkForUpdates(mods) {
  const hashes = mods.filter(m => m.sha1).map(m => m.sha1)
  if (!hashes.length) return
  try {
    const data = await fetchApi('/admin/api/enrich', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes })
    })
    let changed = false
    mods.forEach(mod => {
      if (!mod.sha1) return
      const vInfo = data.versions[mod.sha1]
      if (vInfo) {
        const pInfo = data.projects[vInfo.project_id]
        if (pInfo) { mod.realName = pInfo.title; mod.iconUrl = pInfo.icon_url || null }
        mod.currentVersion = vInfo.version_number
        mod.projectId = vInfo.project_id
        changed = true
      }
      if (!mod.isBase && data.updates?.[mod.sha1]) {
        const u = data.updates[mod.sha1]
        mod.updateAvailable = true
        mod.newVersion = u.version_number || 'Új verzió'
        mod.projectId = u.project_id || mod.projectId
        changed = true
      }
    })
    if (changed) renderMods(mods)
  } catch (e) { console.warn('Enrich hiba:', e) }
}

// ── Mods Filter Controls ──────────────────────────────────────────
$id('mods-filter-input').addEventListener('input', e => {
  modsFilterText = e.target.value.trim()
  renderMods(installedModsCache)
})
document.querySelectorAll('.filter-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
    btn.classList.add('active')
    activeModFilter = btn.dataset.filter
    renderMods(installedModsCache)
  })
})

// ── Shared mod actions (work from both tabs) ──────────────────────
async function updateMod(projectId, oldFilename, btn) {
  btn.disabled = true; btn.textContent = 'Frissítés...'
  try {
    await fetchApi('/admin/api/install', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, oldFilename })
    })
    showToast('Mod sikeresen frissítve!')
    await refreshInstalledCache()
    if ($id('tab-mods').classList.contains('active')) renderMods(installedModsCache)
    if (currentSearchHits.length) renderSearchResults(currentSearchHits)
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Frissítés'
    showToast(`Hiba: ${e.message}`)
  }
}

async function removeMod(filename, source) {
  if (!confirm(`Biztosan törlöd: ${filename}?`)) return
  try {
    await fetchApi('/admin/api/remove', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    })
    showToast('Mod sikeresen törölve.')
    closeModal()
    await refreshInstalledCache()
    if ($id('tab-mods').classList.contains('active')) renderMods(installedModsCache)
    if (currentSearchHits.length) renderSearchResults(currentSearchHits)
  } catch (e) { showToast(`Hiba: ${e.message}`) }
}

async function installMod(projectId, btn) {
  btn.disabled = true; btn.textContent = 'Telepítés...'
  try {
    await fetchApi('/admin/api/install', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId })
    })
    showToast('Mod sikeresen telepítve!')
    await refreshInstalledCache()
    if (currentSearchHits.length) renderSearchResults(currentSearchHits)
    // Update modal buttons if open
    if (!$id('mod-detail-modal').classList.contains('hidden')) openModDetailById(projectId)
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Telepítés'
    showToast(`Hiba: ${e.message}`)
  }
}

// ── Silent Cache Refresh (with enrich) ───────────────────────────
async function refreshInstalledCache() {
  try {
    const data = await fetchApi('/admin/api/mods')
    installedModsCache = data.mods
    const hashes = installedModsCache.filter(m => m.sha1).map(m => m.sha1)
    if (!hashes.length) return
    const enrichData = await fetchApi('/admin/api/enrich', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashes })
    })
    installedModsCache.forEach(mod => {
      if (!mod.sha1) return
      const vInfo = enrichData.versions[mod.sha1]
      if (vInfo) {
        const pInfo = enrichData.projects[vInfo.project_id]
        if (pInfo) { mod.realName = pInfo.title; mod.iconUrl = pInfo.icon_url || null }
        mod.currentVersion = vInfo.version_number
        mod.projectId = vInfo.project_id
      }
      if (!mod.isBase && enrichData.updates?.[mod.sha1]) {
        const u = enrichData.updates[mod.sha1]
        mod.updateAvailable = true
        mod.newVersion = u.version_number || 'Új verzió'
        mod.projectId = u.project_id || mod.projectId
      }
    })
  } catch (e) { console.warn('Cache hiba:', e) }
}

// ── Search Tab ────────────────────────────────────────────────────
const HITS_PER_PAGE = 10
let currentPage = 1
let totalHits = 0
let currentSort = 'relevance'
let currentSearchHits = []
let lastQuery = ''

$id('search-sort').addEventListener('change', e => {
  currentSort = e.target.value
  if (lastQuery) doSearch(1)
})
$id('btn-search').addEventListener('click', () => {
  const q = $id('search-input').value.trim()
  if (!q) return; lastQuery = q; doSearch(1)
})
$id('search-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') {
    const q = $id('search-input').value.trim()
    if (!q) return; lastQuery = q; doSearch(1)
  }
})

async function doSearch(page) {
  currentPage = page
  const resultsDiv = $id('search-results')
  const loading = $id('search-loading')
  const paginationEl = $id('search-pagination')
  resultsDiv.innerHTML = ''
  paginationEl.classList.add('hidden')
  loading.classList.remove('hidden')
  try {
    const facets = '[["categories:fabric"],["versions:1.21.1"],["project_type:mod"]]'
    const offset = (page - 1) * HITS_PER_PAGE
    const url = `https://api.modrinth.com/v2/search?query=${encodeURIComponent(lastQuery)}&facets=${encodeURIComponent(facets)}&limit=${HITS_PER_PAGE}&offset=${offset}&index=${currentSort}`
    const res = await fetch(url, { headers: { 'User-Agent': 'CobbleServerAdmin/1.0' } })
    const data = await res.json()
    loading.classList.add('hidden')
    totalHits = data.total_hits || 0
    if (!data.hits?.length) {
      resultsDiv.innerHTML = '<p>Nincs találat erre a verzióra.</p>'; return
    }
    currentSearchHits = data.hits
    // Store in hitsMap for safe onclick reference
    data.hits.forEach(h => { hitsMap[h.project_id] = h })
    renderSearchResults(data.hits, resultsDiv)
    renderPagination()
    // Scroll to top of results
    resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } catch (e) {
    loading.classList.add('hidden')
    resultsDiv.innerHTML = `<p style="color:red">Hiba: ${e.message}</p>`
  }
}

function renderPagination() {
  const el = $id('search-pagination')
  const totalPages = Math.ceil(totalHits / HITS_PER_PAGE)
  if (totalPages <= 1) { el.classList.add('hidden'); return }
  el.classList.remove('hidden')
  const start = (currentPage - 1) * HITS_PER_PAGE + 1
  const end = Math.min(currentPage * HITS_PER_PAGE, totalHits)
  const pages = []
  for (let i = Math.max(1, currentPage - 2); i <= Math.min(totalPages, currentPage + 2); i++) pages.push(i)
  el.innerHTML = `
    <div class="pagination-info">${start}–${end} / ${totalHits} találat (${totalPages} oldal)</div>
    <div class="pagination-controls">
      <button class="page-btn" onclick="doSearch(${currentPage-1})" ${currentPage<=1?'disabled':''}>← Előző</button>
      ${currentPage > 3 ? `<button class="page-btn" onclick="doSearch(1)">1</button><span class="page-ellipsis">…</span>` : ''}
      ${pages.map(p => `<button class="page-btn ${p===currentPage?'active':''}" onclick="doSearch(${p})">${p}</button>`).join('')}
      ${currentPage < totalPages-2 ? `<span class="page-ellipsis">…</span><button class="page-btn" onclick="doSearch(${totalPages})">${totalPages}</button>` : ''}
      <button class="page-btn" onclick="doSearch(${currentPage+1})" ${currentPage>=totalPages?'disabled':''}>Következő →</button>
    </div>`
}

function renderSearchResults(hits, container) {
  container = container || $id('search-results')
  container.innerHTML = hits.map(hit => {
    // Always use hitsMap for safe storage
    hitsMap[hit.project_id] = hit
    const installed = installedModsCache.find(m => m.projectId === hit.project_id)
    const hasUpdate = installed?.updateAvailable
    let actions = ''
    if (installed) {
      const upBtn = hasUpdate
        ? `<button class="btn-success" onclick="updateMod('${installed.projectId}','${installed.filename}',this)">Frissítés</button>` : ''
      const rmBtn = !installed.isBase
        ? `<button class="btn-danger" onclick="removeMod('${installed.filename}','search')">Eltávolítás</button>`
        : `<button class="btn-danger" disabled>Eltávolítás</button>`
      actions = `<span class="badge badge-success" style="align-self:center">Telepítve</span>${upBtn}${rmBtn}`
    } else {
      actions = `<button onclick="installMod('${hit.project_id}',this)">Telepítés</button>`
    }
    const dl = hit.downloads ? `<span class="hit-meta">⬇ ${formatNumber(hit.downloads)}</span>` : ''
    return `
      <div class="mod-item" data-project-id="${hit.project_id}">
        <img class="mod-icon" src="${hit.icon_url || ''}" alt="" onerror="this.style.visibility='hidden'">
        <div class="mod-info">
          <div class="mod-title">${hit.title} ${dl}</div>
          <div class="mod-author">Szerző: ${hit.author}</div>
          <div class="mod-desc">${hit.description}</div>
        </div>
        <div class="mod-actions">
          <button class="btn-info" onclick="openModDetailById('${hit.project_id}')">🔍 Részletek</button>
          ${actions}
        </div>
      </div>`
  }).join('')
}

// ── Mod Detail Modal (Modrinth API alapú) ────────────────────────
async function openModDetailById(projectId) {
  const modal = $id('mod-detail-modal')
  modal.classList.remove('hidden')

  // Show loading state immediately with basic info from hitsMap
  const basic = hitsMap[projectId]
  if (basic) {
    $id('modal-icon').src = basic.icon_url || ''
    $id('modal-name').textContent = basic.title
    $id('modal-author').textContent = `Szerző: ${basic.author}`
    $id('modal-desc').innerHTML = '<span style="color:var(--text-muted)">Részletek betöltése...</span>'
    $id('modal-downloads').textContent = basic.downloads ? formatNumber(basic.downloads) : '–'
    $id('modal-categories').textContent = (basic.categories || []).join(', ') || '–'
    $id('modal-versions').textContent = (basic.versions || []).slice(-3).reverse().join(', ') || '–'
    $id('modal-badges').innerHTML = ''
    $id('modal-modrinth-link').href = `https://modrinth.com/mod/${basic.slug || projectId}`
    $id('modal-gallery').innerHTML = ''
    renderModalActions(projectId)
  }

  // Fetch full project details from Modrinth
  try {
    const proj = await fetch(`https://api.modrinth.com/v2/project/${projectId}`, {
      headers: { 'User-Agent': 'CobbleServerAdmin/1.0' }
    }).then(r => r.json())

    $id('modal-icon').src = proj.icon_url || basic?.icon_url || ''
    $id('modal-name').textContent = proj.title
    $id('modal-author').textContent = proj.team ? `Szerző: ${basic?.author || '–'}` : `Szerző: ${basic?.author || '–'}`
    $id('modal-desc').textContent = proj.description || proj.body?.slice(0, 300) || 'Nincs leírás.'
    $id('modal-downloads').textContent = proj.downloads ? formatNumber(proj.downloads) : '–'
    $id('modal-categories').textContent = (proj.categories || []).join(', ') || '–'
    $id('modal-versions').textContent = (proj.game_versions || []).slice(-3).reverse().join(', ') || '–'
    $id('modal-modrinth-link').href = `https://modrinth.com/mod/${proj.slug || projectId}`

    // Store updated data in hitsMap
    if (basic) hitsMap[projectId] = { ...basic, ...proj }

    // Gallery
    const gallery = $id('modal-gallery')
    if (proj.gallery?.length) {
      gallery.innerHTML = proj.gallery.slice(0, 4).map(img =>
        `<img src="${img.url}" alt="${img.title || ''}" class="gallery-img" onclick="window.open('${img.url}','_blank')">`
      ).join('')
    } else { gallery.innerHTML = '' }

    // Badges
    const installed = installedModsCache.find(m => m.projectId === projectId)
    const badges = $id('modal-badges')
    badges.innerHTML = ''
    if (installed) badges.innerHTML += '<span class="badge badge-success">Telepítve</span> '
    if (installed?.updateAvailable) badges.innerHTML += '<span class="badge badge-warning">Frissítés elérhető</span>'

    renderModalActions(projectId)
  } catch (e) {
    $id('modal-desc').textContent = 'Nem sikerült betölteni a részleteket.'
  }
}

function renderModalActions(projectId) {
  const installed = installedModsCache.find(m => m.projectId === projectId)
  const el = $id('modal-actions')
  if (installed) {
    el.innerHTML =
      (installed.updateAvailable
        ? `<button class="btn-success" onclick="updateMod('${installed.projectId}','${installed.filename}',this)">⬆ Frissítés</button>` : '') +
      (!installed.isBase
        ? `<button class="btn-danger" onclick="removeMod('${installed.filename}','modal')">🗑 Eltávolítás</button>` : '')
  } else {
    el.innerHTML = `<button onclick="installMod('${projectId}',this)">📦 Telepítés</button>`
  }
}

function closeModal() { $id('mod-detail-modal').classList.add('hidden') }

$id('modal-close').addEventListener('click', closeModal)
$id('mod-detail-modal').addEventListener('click', e => { if (e.target === $id('mod-detail-modal')) closeModal() })
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal() })

// ── Config Editor ──────────────────────────────────────────────────
let configsCache = []
let activeConfigFile = null

async function loadConfigs() {
  const listEl = $id('config-list')
  listEl.innerHTML = '<div class="loading-spinner"></div>'
  try {
    const data = await fetchApi('/admin/api/configs')
    configsCache = data.configs || []
    renderConfigList()
  } catch (e) {
    listEl.innerHTML = `<p style="color:red">Hiba: ${e.message}</p>`
  }
}

function renderConfigList() {
  const listEl = $id('config-list')
  const q = $id('config-search').value.toLowerCase().trim()
  let filtered = configsCache
  
  if (q) {
    filtered = filtered.filter(f => f.toLowerCase().includes(q))
  }
  
  if (!filtered.length) {
    listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px">Nincs találat.</p>'
    return
  }
  
  listEl.innerHTML = filtered.map(f => `
    <div class="config-item ${f === activeConfigFile ? 'active' : ''}" onclick="openConfig('${f}')" title="${f}">
      📄 ${f}
    </div>
  `).join('')
}

$id('config-search').addEventListener('input', renderConfigList)

async function openConfig(filename) {
  if (activeConfigFile && activeConfigFile !== filename) {
    // Lehetne dirty state ellenőrzés is, de most egyelőre egyszerűen váltunk
  }
  
  activeConfigFile = filename
  renderConfigList() // Hogy a kijelölés (active class) frissüljön
  
  $id('config-editor-header').classList.remove('hidden')
  $id('config-textarea').classList.add('hidden')
  $id('config-placeholder').classList.remove('hidden')
  $id('config-placeholder').innerHTML = '<div class="loading-spinner"></div> Betöltés...'
  
  $id('config-current-file').textContent = filename
  
  try {
    const data = await fetchApi('/admin/api/config/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename })
    })
    
    $id('config-placeholder').classList.add('hidden')
    $id('config-textarea').classList.remove('hidden')
    $id('config-textarea').value = data.content
    
  } catch (e) {
    $id('config-placeholder').innerHTML = `<span style="color:red">Hiba a fájl olvasásakor: ${e.message}</span>`
  }
}

$id('btn-config-save').addEventListener('click', async () => {
  if (!activeConfigFile) return
  
  const btn = $id('btn-config-save')
  btn.disabled = true
  btn.textContent = 'Mentés...'
  
  const content = $id('config-textarea').value
  
  try {
    await fetchApi('/admin/api/config/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filename: activeConfigFile, content })
    })
    showToast('Konfiguráció sikeresen elmentve!')
  } catch (e) {
    showToast(`Hiba a mentés során: ${e.message}`)
  } finally {
    btn.disabled = false
    btn.textContent = 'Mentés'
  }
})

// Init – hitelesítés indítása
initAuth()
