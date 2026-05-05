'use strict'
/**
 * leaderboard-worker.js
 * ─────────────────────────────────────────────────────────────
 * Worker thread a leaderboard szinkronizáláshoz.
 * Fogad: { type: 'sync', statsDir, cobbleDir, usercachePath, dbConfig }
 * Küld:  { type: 'done', count } | { type: 'error', message }
 *
 * A fájlolvasás és DB upsert izolálva van a főszáltól,
 * így a Minecraft STDIN-je nem akad el a 15 perces sync alatt.
 */

const { parentPort } = require('worker_threads')
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const mysql = require('mysql2/promise')

parentPort.on('message', async ({ type, statsDir, cobbleDir, usercachePath, dbConfig }) => {
  if (type !== 'sync') return

  let pool = null
  try {
    pool = mysql.createPool(dbConfig)

    // ── 1. Usercache betöltése ──────────────────────────────────
    let usercache = []
    if (fs.existsSync(usercachePath)) {
      try {
        usercache = JSON.parse(fs.readFileSync(usercachePath, 'utf8'))
      } catch { /* silent */ }
    }

    const players = new Map() // uuid → data

    // ── 2. Minecraft alap statisztikák (playtime, pokedex) ──────
    if (fs.existsSync(statsDir)) {
      const files = fs.readdirSync(statsDir).filter(f => f.endsWith('.json'))
      for (const file of files) {
        const uuid = file.replace('.json', '')
        try {
          const stats = JSON.parse(fs.readFileSync(path.join(statsDir, file), 'utf8'))
          const custom = (stats.stats || {})['minecraft:custom'] || {}
          const ticks = custom['minecraft:play_time'] || 0
          const playtime = Math.round((ticks / 20 / 60 / 60) * 100) / 100
          const pokedex =
            custom['cobblemon:dex_entries'] ||
            custom['cobblemon:pokedex_count'] ||
            custom['cobblemon:pokedex_captured'] ||
            custom['cobblemon:pokedex_total'] || 0
          const user = usercache.find(u => u.uuid === uuid)
          players.set(uuid, {
            uuid,
            username: user ? user.name : 'Ismeretlen',
            playtime,
            pokedex,
            caught: 0,
            shiny: 0
          })
        } catch { /* hibás stat fájl, kihagyjuk */ }
      }
    }

    // ── 3. Cobblemon specifikus adatok (caught, shiny) ──────────
    if (fs.existsSync(cobbleDir)) {
      const walk = (dir) => {
        for (const file of fs.readdirSync(dir)) {
          const fullPath = path.join(dir, file)
          if (fs.statSync(fullPath).isDirectory()) {
            walk(fullPath)
          } else if (file.endsWith('.json') && !file.endsWith('.old')) {
            const uuid = file.replace('.json', '')
            try {
              const data = JSON.parse(fs.readFileSync(fullPath, 'utf8'))
              const getCaught = d =>
                d.totalCaptureCount ||
                (d.advancementData && d.advancementData.totalCaptureCount) ||
                (d.extraData && d.extraData['cobblemon:total_captured']) || 0
              const getShiny = d =>
                d.totalShinyCaptureCount ||
                (d.advancementData && d.advancementData.totalShinyCaptureCount) ||
                (d.extraData && d.extraData['cobblemon:total_shiny_captured']) || 0

              if (players.has(uuid)) {
                const p = players.get(uuid)
                p.caught = getCaught(data)
                p.shiny = getShiny(data)
              } else {
                const user = usercache.find(u => u.uuid === uuid)
                players.set(uuid, {
                  uuid,
                  username: user ? user.name : 'Ismeretlen',
                  playtime: 0,
                  pokedex: 0,
                  caught: getCaught(data),
                  shiny: getShiny(data)
                })
              }
            } catch { /* hibás cobblemon fájl, kihagyjuk */ }
          }
        }
      }
      walk(cobbleDir)
    }

    // ── 4. Upsert az adatbázisba ─────────────────────────────────
    const query = `
      INSERT INTO leaderboard (uuid, username, playtime, caught, pokedex, shiny)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE
        username = VALUES(username),
        playtime = VALUES(playtime),
        caught   = VALUES(caught),
        pokedex  = VALUES(pokedex),
        shiny    = VALUES(shiny)
    `
    let count = 0
    for (const p of players.values()) {
      if (p.playtime === 0 && p.caught === 0) continue
      await pool.execute(query, [p.uuid, p.username, p.playtime, p.caught, p.pokedex, p.shiny])
      count++
    }

    await pool.end()
    parentPort.postMessage({ type: 'done', count: players.size })
  } catch (err) {
    if (pool) try { await pool.end() } catch { /* silent */ }
    parentPort.postMessage({ type: 'error', message: err.message })
  }
})
