// utils.js

import { readFileSync, writeFileSync, copyFileSync } from 'fs'
import { join } from 'path'
import https from 'https'
import http from 'http'
import { log } from './logs.js'
import { runHook } from './loader.js'
let config = {}
const DEFAULT_HEADERS = {
  'User-Agent': 'ft-to-inv-bot/1.0 (+https://ft-to-inv-bot.riki-pedia.org/)',
  Accept: 'application/json',
}
import { getGlobalVars } from './args.js'
// Load a newline-delimited JSON file into an array of objects
export async function loadNDJSON(filePath) {
  const lines = readFileSync(filePath, 'utf-8').split(/\r?\n/)
  const results = []
  for (const line of lines) {
    if (line.trim()) {
      try {
        results.push(JSON.parse(line))
      } catch (err) {
        log(
          `❌ Could not parse line in ${filePath}: ${line}. the error was: ${err.message || err}`,
          { level: 'warning' }
        )
      }
    }
  }
  return results
}

export async function setConfig(conf) {
  config = conf
}

let OUTPUT_FILE = join(config.export_dir || '.', 'invidious-import.json')
let OLD_EXPORT_PATH = join(config.export_dir || '.', 'import.old.json')

// Extract subscription IDs from FreeTube profiles.db lines
export async function extractSubscriptions(profileDbPath) {
  const profiles = await loadNDJSON(profileDbPath)
  for (const p of profiles) {
    if (p._id === 'allChannels' && Array.isArray(p.subscriptions)) {
      return p.subscriptions.map(sub => sub.id)
    }
  }
  return []
}

// Read previous export JSON (old) safely
export function readOldExport() {
  try {
    return JSON.parse(readFileSync(OLD_EXPORT_PATH, 'utf-8'))
  } catch {
    return { watch_history: [], playlists: [], subscriptions: [] }
  }
}

// Write new export JSON and update old export file
export function writeNewExport(data) {
  writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2))
  copyFileSync(OUTPUT_FILE, OLD_EXPORT_PATH)
}

// Write export JSON without updating old export (no-sync mode)
export function noSyncWrite(outputObj, outputPath, quiet) {
  const json = JSON.stringify(outputObj, null, 2)
  writeFileSync(outputPath, json)
  if (!quiet) log(`✅ Wrote export to ${outputPath} (no-sync mode)`)
}
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}
export async function retryPostRequest(
  path,
  json,
  token,
  instance,
  insecure,
  method,
  maxRetries = 4
) {
  let lastError
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // funny thing is that postToInvidious was promise based before, but i just now made it async. the await was used here ages ago, but since its promise based it didnt break anything
      return await postToInvidious(path, json, token, instance, insecure, method)
    } catch (err) {
      lastError = err
      if (attempt < maxRetries) {
        runHook('onRetry', { attempt, error: err })
        const delay = Math.pow(2, attempt) * 1000 // 2s, 4s, 8s...
        log(`⚠️ Attempt ${attempt} failed (${err.message}), retrying in ${delay / 1000}s...`, {
          level: 'warning',
        })
        await sleep(delay)
      }
    }
  }
  throw new Error(`❌ All ${maxRetries - 1} retries failed. Last error:\n ${lastError.message}`)
}

/**
 * Send a POST request to Invidious API
 * @param {string} path - The API endpoint path.
 * @param {object|null} json - The JSON payload to send (or null for no payload).
 * @param {string} token - The authentication token.
 * @param {string} instance - The Invidious instance URL.
 * @param {boolean} insecure - Whether to use HTTP instead of HTTPS (default: false), expects a boolean, usually passed by config or cli arg
 * @param {string} method - The HTTP method to use (default: 'POST').
 */
// ill deal with this later

export async function postToInvidious(
  path,
  json = {},
  token,
  instance,
  // this is automatically assumed now, but im keeping the param for compatibility (even though its useless now)
  // this is mainly for my functions because at least one of them passes it (because im lazy and havent refactored it yet)
  // put this message here at like 1.17, it's now 1.21
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  insecure = false,
  method = 'POST'
) {
  const client = instance.startsWith('http:') ? http : https
  const fullPath = `${instance.replace(/\/$/, '')}/api/v1${path}`
  const payload = JSON.stringify(json ?? {})
  const argTable = getGlobalVars()
  const { veryVerbose } = argTable
  if (veryVerbose)
    log(
      `[very-verbose] Sending request to Invidious:\n ➡️  ${method} ${fullPath} Payload: ${payload}`
    )
  return new Promise((resolve, reject) => {
    const req = client.request(
      fullPath,
      {
        method,
        headers: {
          Cookie: `SID=${token}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
          ...DEFAULT_HEADERS,
        },
      },
      res => {
        let body = ''
        res.on('data', chunk => (body += chunk))
        res.on('end', () => {
          const bodyLowercase = body.toLowerCase()
          if (res.statusCode === 403 && bodyLowercase.includes('request must be authenticated')) {
            log(
              `⚠️ Invidious API request failed: bad token or API disabled. 
If API is disabled, try NO-SYNC and upload invidious-import.json manually: ${instance}/data_control`,
              { level: 'warning' }
            )
            return reject(new Error(`Authentication error (403): ${body}`))
          }
          if (
            res.statusCode >= 400 ||
            (bodyLowercase.includes('error') && res.statusCode !== 404)
          ) {
            return reject(new Error(`HTTP ${res.statusCode}: ${body}`))
          }
          if (res.statusCode === 404) {
            const errMsg = `Endpoint not found (404). The instance '${instance}' may be outdated or down.`
            log(`⚠️ ${errMsg}`, { level: 'warning' })
            return reject(new Error(errMsg))
            // invidious' default behavior is to return 200 with a blank page for unknown endpoints, our tool expects 204 for success
          } else if (res.statusCode === 200) {
            const vv = argTable.veryVerbose
            if (vv)
              log(
                `[very-verbose] Warning: Received 200 OK instead of 204 No Content. This means the endpoint isn't found because we wanted 204 for success.\n update your instance or contact the admin.\n got response: ${body.length <= 100 ? body : 'data too long to display'}`,
                { level: 'warning' }
              )
            const errMsg = `Expected 204 No Content but got 200 OK. The instance ${instance} may be outdated.`
            log(`⚠️ ${errMsg}`, { level: 'warning' })
            return reject(new Error(errMsg))
          }
          if (veryVerbose)
            log(
              `[very-verbose] Received response: ${body.length === 0 ? '(empty response)' : body.length <= 100 ? body : 'data too long to display'}, status ${res.statusCode}`
            )
          resolve({ code: res.statusCode, body })
        })
      }
    )
    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

/**
 * Writes a standalone playlist-import.json file for Invidious
 * @param {Array} playlists - Array of playlists in your format:
 * [
 *   {
 *     title: "My Playlist",
 *     description: "",
 *     privacy: "Private",
 *     videos: ["abc123", "def456"]
 *   },
 *   ...
 * ]
 * @param {string} outputPath - Where to write the file:
 * defaults to './playlist-import.json'
 */
export async function writePlaylistImport(playlists, outputPath = './playlist-import.json') {
  const minimalImport = {
    version: 1,
    subscriptions: [],
    watch_history: [],
    preferences: {
      default_home: 'Popular',
      annotations: false,
      autoplay: false,
      dark_mode: 'true',
      region: 'US',
      quality: 'dash',
      player_style: 'invidious',
      watch_history: true,
      max_results: 40,
    },
    playlists,
  }

  writeFileSync(outputPath, JSON.stringify(minimalImport, null, 2))
  const conf = getGlobalVars()
  const quiet = conf.quiet || false
  const silent = conf.silent || false
  if (!quiet && !silent) {
    log(`✅ Playlist import written to ${outputPath}`)
  }
}

// Fetch channel metadata to get friendly name
export async function getChannelName(ucid, instance) {
  try {
    const argTable = getGlobalVars()
    const vv = argTable.veryVerbose
    const TOKEN = argTable.token
    if (!instance) instance = argTable.instance
    if (vv) log(`[very-verbose] Fetching channel name for UCID: ${ucid}`)
    const url = new URL(`/api/v1/channels/${ucid}`, instance).href
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Cookie: `SID=${TOKEN}`,
        ...DEFAULT_HEADERS,
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (vv)
      log(
        `[very-verbose] Received channel data: ${data.length <= 100 ? JSON.stringify(data) : 'data too long to display'}`
      )
    if (vv) log(`[very-verbose] Channel name for ${ucid} is ${data.author || ucid}`)
    return data.author || ucid
  } catch (err) {
    console.warn(`⚠️ Failed to get channel name for ${ucid}:`, err.message)
    return ucid // Fallback to ID if failed
  }
}
export async function getVideoNameAndAuthor(vid, instance, token) {
  try {
    const argTable = getGlobalVars()
    const vv = argTable.veryVerbose
    if (!instance) instance = argTable.instance
    if (!token) token = argTable.token
    if (vv) log(`[very-verbose] Fetching video info for VID: ${vid}`)
    const url = new URL(`/api/v1/videos/${vid}`, instance).href
    const res = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        Cookie: `SID=${token}`,
        ...DEFAULT_HEADERS,
      },
    })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const data = await res.json()
    if (vv)
      log(
        `[very-verbose] Received video data: ${data.length <= 100 ? JSON.stringify(data) : 'data too long to display'}`
      )
    if (vv) log(`[very-verbose] Video title for ${vid} is ${data.title || vid + '(fallback)'}`)
    if (vv)
      log(
        //                                                       this is kind of dumb but whatever
        `[very-verbose] Video author for ${vid} is ${data.author || `Unknown (got undefined)`}`
      )
    return { author: data.author || 'Unknown', title: data.title || vid }
  } catch (err) {
    log(`⚠️ Failed to get channel name for ${vid}: ${err.message}`, { level: 'warning' })
    const errTL = err.message.toLowerCase()
    if (errTL.includes('fetch failed')) {
      log('potential cert problem, see docs about --use-system-ca', { level: 'warning' })
      const argTable = getGlobalVars()
      if (argTable.veryVerbose) {
        log(
          `[very-verbose] Try this if your cert is failing:
           [very-verbose] Windows: set NODE_EXTRA_CA_CERTS=C:\\path\\to\\ca-bundle.crt
           [very-verbose] macOS/Linux: export NODE_EXTRA_CA_CERTS=/path/to/ca-bundle.crt
           [very-verbose] or set it in .bashrc/.zshrc/etc.
           [very-verbose] TempleOS: how did you get node on here
           [very-verbose] See https://nodejs.org/api/cli.html#--use-system-ca-certs for more info
          `
        )
      }
      return { author: 'Unknown', title: vid }
    }
  }
}
