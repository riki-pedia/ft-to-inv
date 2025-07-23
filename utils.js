// utils.js
// Utility functions for FreeTube → Invidious sync

const fs = require('fs');
const path = require('path');
const https = require('https');
const { loadConfig, normalizePath } = require('./config');
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
// Send a POST request to Invidious API
function postToInvidious(path, json) {
  if (!INSECURE) {
  return new Promise((resolve, reject) => {
    const req = https.request(`${INSTANCE}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': `SID=${TOKEN}`
      }
    }, res => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        if (res.statusCode >= 400) {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        } else {
          resolve({ code: res.statusCode, body });
        }
      });
    });

    req.on('error', reject);   
    req.write(JSON.stringify(json));
    req.end();
  }
  )} else if (INSECURE) {
    return new Promise((resolve, reject) => {
      try {
        console.warn(`using port 3000 to connect to ${INSTANCE}${path}`);
        const req = get(`${INSTANCE.replace(/\/$/, '')}:3000${path}`, {
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `SID=${TOKEN}`
          }
        }, res => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            } else {
              resolve({ code: res.statusCode, body });
            }
          });
        });

        req.end();
      }
      catch (err) {
        const req = get(`${INSTANCE}${path}`, {
          headers: {
            'Content-Type': 'application/json',
            'Cookie': `SID=${TOKEN}`
          }
        }, res => {
          let body = '';
          res.on('data', chunk => body += chunk);
          res.on('end', () => {
            if (res.statusCode >= 400) {
              reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            } else {
              resolve({ code: res.statusCode, body });
            }
          });
        });
        req.on('error', reject);
        req.end();
      }
   } )}
  }

// Fetch channel metadata to get friendly name
async function getChannelName(ucid) {
  try {
    const url = new URL(`/api/v1/channels/${ucid}`, INSTANCE).href;
    const res = await fetch(url, { headers:  {
        'Content-Type': 'application/json',
        'Cookie': `SID=${TOKEN}`
      } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.author || ucid;
  } catch (err) {
    if (VERBOSE) console.warn(`⚠️ Failed to get channel name for ${ucid}:`, err.message);
    return ucid; // Fallback to ID if failed
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
};
