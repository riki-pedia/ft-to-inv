// utils.js
// Utility functions for FreeTube → Invidious sync

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { loadConfig, normalizePath } = require('./config');
const { stringify } = require('comment-json');
let config = loadConfig();
let OUTPUT_FILE = path.join(config.export_dir || '.', 'invidious-import.json');
let OLD_EXPORT_PATH = path.join(config.export_dir || '.', 'import.old.json');
// Load a newline-delimited JSON file into an array of objects
async function loadNDJSON(filePath) {
  const lines = fs.readFileSync(filePath, 'utf-8').split(/\r?\n/);
  const results = [];
  for (const line of lines) {
    if (line.trim()) {
      try {
        results.push(JSON.parse(line));
      } catch (err) {
        console.warn(`❌ Could not parse line in ${filePath}: ${line}`);
      }
    }
  }
  return results;
}

// Extract subscription IDs from FreeTube profiles.db lines
async function extractSubscriptions(profileDbPath) {
  const profiles = await loadNDJSON(profileDbPath);
  for (const p of profiles) {
    if (p._id === 'allChannels' && Array.isArray(p.subscriptions)) {
      return p.subscriptions.map(sub => sub.id);
    }
  }
  return [];
}

// Read previous export JSON (old) safely
function readOldExport() {
  try {
    return JSON.parse(fs.readFileSync(OLD_EXPORT_PATH, 'utf-8'));
  } catch {
    return { watch_history: [], playlists: [], subscriptions: [] };
  }
}

// Write new export JSON and update old export file
function writeNewExport(data) {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
  fs.copyFileSync(OUTPUT_FILE, OLD_EXPORT_PATH);
}

// Write export JSON without updating old export (no-sync mode)
function noSyncWrite(outputObj, outputPath, quiet) {
  const json = JSON.stringify(outputObj, null, 2);
  fs.writeFileSync(outputPath, json);
  if (!quiet) console.log(`✅ Wrote export to ${outputPath} (no-sync mode)`);
}
let INSECURE = config.insecure || false;
let INSTANCE = config.instance;
let TOKEN = config.token;
let retryCount = 0;
async function retryPostRequest(path, json, token, instance, insecure, method) {
  return new Promise((resolve, reject) => {
    const attemptRequest = async () => {
      while (retryCount < 3) {
        retryCount++;
        await postToInvidious(path, json, token, instance, insecure, method);
        
      }
    };
    attemptRequest();
  });
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
function postToInvidious(path, json = {}, token, instance, insecure = false, method = 'POST') {
  const isSecure = !insecure;
  const client = isSecure ? https : http;
  const fullPath = `${instance.replace(/\/$/, '')}/api/v1${path}`;
  const payload = JSON.stringify(json ?? {}); 
  return new Promise((resolve, reject) => {
    const req = client.request(fullPath, {
      method,
      headers: {
        'Cookie': `SID=${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', async () => {
        const bodyLowercase = body.toLowerCase() 
        if (res.statusCode === 403 && bodyLowercase.includes('request must be authenticated')) {
          console.log(`⚠️ Invidious API request failed: Either you have a bad token or the api is disabled. If the api is disabled, try using NO-SYNC mode and upload the invidious-import.json file manually through this url: 
            ${instance}/data_control.`);
        }
        if (res.statusCode >= 400) {
          console.error(`❌ Invidious API request failed with HTTP ${res.statusCode}: ${body}`);
        } else {
          resolve({ code: res.statusCode, body });
        }
        if (bodyLowercase.includes('error') && res.statusCode !== 404) {
          console.log(`request failed, retrying... (${retryCount})`);
          await retryPostRequest(path, json, token, instance, insecure, method);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
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
function writePlaylistImport(playlists, outputPath = './playlist-import.json') {
  const minimalImport = {
    version: 1,
    subscriptions: [],
    watch_history: [],
    preferences: {
      default_home: "Subscriptions",
      annotations: false,
      autoplay: false,
      dark_mode: "true",
      region: "US",
      quality: "dash",
      player_style: "youtube",
      watch_history: true,
      max_results: 40
    },
    playlists
  };

  fs.writeFileSync(outputPath, JSON.stringify(minimalImport, null, 2));
  console.log(`✅ Playlist import written to ${outputPath}`);
}

// Fetch channel metadata to get friendly name
async function getChannelName(ucid, instance = INSTANCE) {
  try {
    const url = new URL(`/api/v1/channels/${ucid}`, instance).href;
    const res = await fetch(url, { headers:  {
        'Content-Type': 'application/json',
        'Cookie': `SID=${TOKEN}`
      } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.author || ucid;
  } catch (err) {
     console.warn(`⚠️ Failed to get channel name for ${ucid}:`, err.message);
    return ucid; // Fallback to ID if failed
  }
}
async function getVideoNameAndAuthor(vid, instance, token) {
  try {
    const url = new URL(`/api/v1/videos/${vid}`, instance).href;
    const res = await fetch(url, { headers:  {
        'Content-Type': 'application/json',
        'Cookie': `SID=${token}`
      } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return { author: data.author || 'Unknown', title: data.title || vid};
  } catch (err) {
     console.warn(`⚠️ Failed to get channel name for ${vid}:`, err.message);
     const errTL = err.message.toLowerCase();
     if (errTL.includes('fetch failed')) {
        console.log('potential cert problem, see docs about --use-system-ca')
     }
    return { author: 'Unknown', title: vid };
  }
}

//stripDir goes in export, not used here
module.exports = {
  loadNDJSON,
  extractSubscriptions,
  readOldExport,
  writeNewExport,
  noSyncWrite,
  postToInvidious,
  getChannelName,
  writePlaylistImport,
  getVideoNameAndAuthor
};
