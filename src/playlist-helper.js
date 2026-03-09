import { postToInvidious } from './utils.js'
import { getGlobalVars } from './args.js'
import http from 'http'
import https from 'https'
import { log } from './logs.js'
const defaultHeaders = {
  'Content-Type': 'application/json',
  'User-Agent': 'ft-to-inv-bot/1.0 (+https://ft-to-inv-bot.riki-pedia.org/)',
  Accept: 'application/json',
}

async function prompt(message) {
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })
  return new Promise(resolve => {
    rl.question(message, answer => {
      rl.close()
      resolve(answer)
    })
  })
}
let existingPlaylistsCache = null
async function fetchExistingPlaylists() {
  if (existingPlaylistsCache) {
    return existingPlaylistsCache
  } else {
    try {
      const { token, instance } = getGlobalVars()
      const client = instance.startsWith('https') ? https : http
      const existingPlaylists = await new Promise((resolve, reject) => {
        const req = client.request(`${instance}/api/v1/auth/playlists`, {
          method: 'GET',
          headers: {
            ...defaultHeaders,
            Cookie: `SID=${token}`,
          },
        })
        req.on('response', res => {
          let data = ''
          res.on('data', chunk => {
            data += chunk
          })
          res.on('end', () => {
            resolve(JSON.parse(data))
          })
        })
        req.on('error', err => {
          reject(err)
        })
        req.end()
      })
      existingPlaylistsCache = existingPlaylists
      return existingPlaylists
    } catch (error) {
      log(`error fetching existing playlists: ${error.message}`, 'error')
    }
  }
}
export async function migratePlaylist(playlistData) {
  const { token, instance } = getGlobalVars()
  const name = playlistData.title || 'Untitled Playlist'
  const description = playlistData.description || ''
  const videos = playlistData.videos || []
  // check if it already exists on invidious
  const answer = await prompt('do you want to migrate playlists to invidious with the api? (y/n): ')
  if (answer.toLowerCase() !== 'y') {
    console.log('Skipping playlist migration.')
    return
  }
  const existingPlaylists = await fetchExistingPlaylists()
  let playlistId = null
  if (existingPlaylists.some(p => p.name === name)) {
    playlistId =
      existingPlaylists.find(p => p.name === name).id ||
      existingPlaylists.find(p => p.name === name).playlistId ||
      null
  }
}
