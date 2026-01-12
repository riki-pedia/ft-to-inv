import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import https from 'https'
import { log } from './logs.js'
const DEFAULT_HEADERS = {
  'User-Agent': 'ft-to-inv-bot/1.0 (+https://dev.riki-pedia.org/projects/ft-to-inv.html)',
  Accept: 'application/json',
}

function sha256(data) {
  return crypto.createHash('sha256').update(data).digest('hex')
}
function fetchText(url) {
  const options = new URL(url)
  options.headers = DEFAULT_HEADERS
  return new Promise((resolve, reject) => {
    https
      .get(options, res => {
        if (res.statusCode !== 200) {
          return reject(new Error(`Failed to fetch ${url}, HTTP ${res.statusCode}`))
        }
        let data = ''
        res.on('data', chunk => (data += chunk))
        res.on('end', () => resolve(data))
      })
      .on('error', reject)
  })
}
const registryUrl = 'https://ft-to-inv-pkg.riki-pedia.org/marketplace.json'
let regis
try {
  const registryData = await fetchText(registryUrl)
  regis = JSON.parse(registryData)
} catch (err) {
  log(`Failed to load or parse registry from ${registryUrl}: ${err.message || err}`, {
    level: 'error',
  })
  // catch then throw???
  throw err
}
let hasNoErrors = true
async function verifyPlugin(url, sha) {
  const res = await fetchText(url)
  // remove the beginning "https://raw.githubusercontent.com/riki-pedia/ft-to-inv-pkg/refs/heads/main/plugins" from the url to get something like "example-plugin/example-plugin.js" for better logging
  const friendlyName = url.replace(
    'https://raw.githubusercontent.com/riki-pedia/ft-to-inv-pkg/refs/heads/main/plugins/',
    ''
  )
  const actualSha = sha256(res)
  if (actualSha.toLowerCase() !== sha.toLowerCase()) {
    throw new Error(
      `[ft-to-inv] ❌ SHA mismatch for ${friendlyName}. Expected ${sha}, got ${actualSha}`
    )
  }
  log(`✅ Verified ${friendlyName} (${actualSha})`)
}

export async function installPlugin(name, registry = regis) {
  const plugin = registry[name]
  if (!plugin) throw new Error(`[ft-to-inv] Plugin '${name}' not found in registry`)

  const pluginsDir = path.resolve('./plugins')
  if (!fs.existsSync(pluginsDir)) fs.mkdirSync(pluginsDir)

  const pluginDir = path.join(pluginsDir, name)
  if (!fs.existsSync(pluginDir)) fs.mkdirSync(pluginDir)

  log(`📦 Installing ${plugin.name} v${plugin.version}...`)

  if (plugin.json && plugin.script) {
    // new format
    try {
      const jsonDest = path.join(pluginDir, `${name}.json`)
      const json = await fetchText(plugin.json)
      await verifyPlugin(plugin.json, plugin.jsonSha).catch(err => {
        log(`Failed to verify ${plugin.json}: ${err.message || err}`, { level: 'error' })
        hasNoErrors = false
      })
      const js = await fetchText(plugin.script)
      const scriptDest = js.includes('.mjs')
        ? path.join(pluginDir, `${name}.mjs`)
        : js.includes('.cjs')
          ? path.join(pluginDir, `${name}.cjs`)
          : path.join(pluginDir, `${name}.js`)
      await verifyPlugin(plugin.script, plugin.scriptSha).catch(err => {
        log(`Failed to verify ${plugin.script}: ${err.message || err}`, { level: 'error' })
        hasNoErrors = false
      })
      if (hasNoErrors === true) {
        // looks dangerous, but comes from my website, and i verify the sha256
        fs.writeFileSync(jsonDest, json)
        fs.writeFileSync(scriptDest, js)
      }
    } catch (error) {
      log(`Failed to install ${plugin.name}: ${error.message || error}`, { level: 'error' })
    }
  } else if (plugin.url && plugin.sha256) {
    // legacy format
    const scriptDest = path.join(pluginDir, `${name}.js`)
    const js = await fetchText(plugin.url)
    await verifyPlugin(plugin.url, plugin.sha256 + 1).catch(err => {
      log(`Failed to verify ${plugin.url}: ${err.message || err}`, { level: 'error' })
      hasNoErrors = false
    })
    if (hasNoErrors === true) {
      // def issue here, but its legacy so idc
      fs.writeFileSync(scriptDest, js)
    }
  } else {
    throw new Error(`Registry entry for '${name}' is invalid`)
  }
  if (hasNoErrors === true) {
    log(`🎉 Installed '${plugin.name}' successfully!`)
  } else {
    throw new Error(`Errors occured while installing ${name}`)
  }
}

export async function listStore(registry = regis) {
  log('🛒 Available plugins:')
  for (const [key, info] of Object.entries(registry)) {
    log(
      `- ${info.name} (${info.version}): ${info.desc}\n To install, run: \`ft-to-inv add ${key}\``
    )
  }
  log('More plugins coming soon!')
}

export async function listInstalled() {
  const pluginsDir = path.resolve('./plugins')
  if (!fs.existsSync(pluginsDir)) {
    log('⚠️ No plugins installed')
    return
  }
  const dirs = fs.readdirSync(pluginsDir)
  log('🔌 Installed plugins:')
  for (const dir of dirs) {
    const manifestPath = path.join(pluginsDir, dir, `${dir}.json`)
    if (fs.existsSync(manifestPath)) {
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'))
      log(`- ${manifest.name} v${manifest.version}`)
    } else {
      log(`- ${dir} (legacy or missing manifest)`)
    }
  }
}
export async function removePlugin(plugin) {
  const pluginsDir = path.resolve('./plugins')
  const pluginDir = path.join(pluginsDir, plugin)
  if (fs.existsSync(pluginDir)) {
    fs.rmSync(pluginDir, { recursive: true, force: true })
    log(`🗑️ Removed plugin '${plugin}'`)
  } else {
    throw new Error(`[ft-to-inv] ⚠️ Plugin '${plugin}' not found`)
  }
}
