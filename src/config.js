// fine ill make a helper
import { readFileSync, promises, existsSync } from 'fs'
import { join, normalize, resolve as _resolve, resolve } from 'path'
import { createInterface } from 'readline'
import { parse } from 'comment-json'
import http from 'http'
import https from 'https'
import { resolveConfig } from './args.js'
import { encryptToken, getPassphrase, decryptToken } from './encryption.js'
/**
 * Get the value of an environment variable.
 * @param {string} option - The name of the environment variable to retrieve.
 * @returns {string|undefined} - The value of the environment variable, or undefined if not set.
 */
export function getEnv(option) {
  return process.env[option] || undefined
}
const DEFAULT_CONFIG_FILENAME = 'ft-to-inv.jsonc'
// ignore for right now, might use later
//const ENV_CONFIG_PATH = normalizePath(getEnv('FT_INV_CONFIG')) || normalizePath(getEnv('FT_TO_INV_CONFIG')) || normalizePath(getEnv('CONFIG')) || normalizePath(getEnv('FT_TO_INV_CONFIG_PATH'));

// args parsed in export.js
export function detectOs() {
  const platform = process.platform
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'macos'
  if (platform === 'linux') return 'linux'
  return 'unknown'
}

export function getDefaultFreeTubeDir() {
  const os = detectOs()
  const home = process.env.HOME || process.env.USERPROFILE
  const appData = process.env.APPDATA
  if (!home && os !== 'windows') return null
  if (os === 'windows') return appData ? join(appData, 'FreeTube') : null
  if (os === 'linux') return join(home, '.config', 'FreeTube')
  if (os === 'macos') return join(home, 'Library', 'Application Support', 'FreeTube')
  if (os === 'unknown') return null
  return null
}
function loadJsonc(filePath) {
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return parse(raw)
  } catch (err) {
    console.warn(`⚠️ Failed to load config at ${filePath}: ${err.message}`)
    return {}
  }
}
const bot_headers = {
  'User-Agent': 'ft-to-inv-bot/1.0 (+https://ft-to-inv-bot.riki-pedia.org/)',
  Accept: 'application/json',
}
async function testToken(instance, token) {
  try {
    const skipVer = resolveConfig('skip_verification', {
      cliNames: ['--skip-verification', '-skip-verification', '--skip-ver', '-skip-ver'],
      envNames: [
        'SKIP_VERIFICATION',
        'SKIP_VER',
        'FT_INV_SKIP_VERIFICATION',
        'FT_TO_INV_SKIP_VERIFICATION',
      ],
      isFlag: true,
      fallback: false,
    })
    if (skipVer === true) return true
    console.log('Testing token...')
    const client = instance.startsWith('http:') ? http : https
    return new Promise((resolve, reject) => {
      // test a known token protected endpoint, but dont care about the response, just the status code
      const req = client.get(`${instance.replace(/\/$/, '')}/api/v1/auth/history`, {
        headers: {
          Cookie: `SID=${token}`,
          ...bot_headers,
        },
      })
      req.on('response', res => {
        if (res.statusCode === 200 || res.statusCode === 204) {
          console.log('✅ Token and instance verified successfully.')
          resolve(true)
        } else {
          reject(new Error(`Invalid token or instance, received status code ${res.statusCode}`))
        }
      })
      req.on('error', err => {
        console.warn(`⚠️ Failed to verify token: ${err.message}`)
        reject(new Error(`Failed to verify token: ${err.message}`))
      })
    })
  } catch (err) {
    console.warn(`⚠️ Failed to verify token: ${err.message}`)
    return false
  }
}
export function normalizePath(inputPath) {
  if (typeof inputPath !== 'string') return ''
  if (!inputPath) return ''
  if (inputPath === '.' || (inputPath === './' && detectOs() === 'windows')) {
    return '.\\'
  }
  if (detectOs() === 'windows') {
    return normalize(inputPath.replace(/\//g, '\\'))
  }
  return normalize(inputPath)
}
// stopped using this in favor of hardcoding in export.js
// but vs still says it's used, so i'm not removing it yet
export function resolvePaths(config) {
  const base = normalizePath(config.freetube_dir || getDefaultFreeTubeDir() || '')
  const exportDir = normalizePath(config.export_dir || '.')
  return {
    HISTORY_PATH: join(base, 'history.db'),
    PLAYLIST_PATH: join(base, 'playlists.db'),
    PROFILE_PATH: join(base, 'profiles.db'),
    EXPORT_DIR: exportDir,
    OUTPUT_FILE: join(exportDir, 'invidious-import.json'),
    OLD_EXPORT_PATH: join(exportDir, 'import.old.json'),
  }
}

function setConfigPathEnv(path) {
  const envToWrite = path
  console.log(`Setting CONFIG environment variable to ${envToWrite}`)
  promises.writeFile('.env', `CONFIG=${envToWrite}\n`, { flag: 'a' })
}
// checks if the prompts down below return y/n
async function checkBoolean(prompt) {
  if (prompt !== 'y' && prompt !== 'n') return false
  return true
}
// prompt
export async function prompt(question, defaultValue = '') {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(resolve => {
    rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `, answer => {
      rl.close()
      resolve(answer || defaultValue)
    })
  })
}
const defaultConfig = {
  token: '',
  instance: 'https://invidiou.s',
  freetube_dir: getDefaultFreeTubeDir(),
  export_dir: './',
  verbose: false,
  dry_run: false,
  dont_shorten_paths: false,
  noSync: false,
  quiet: false,
  insecure: false,
  cron_schedule: '',
  logs: false,
}
//comments at the top of the file
const topComments = [
  'This is the configuration file for the FreeTube to Invidious exporter.',
  'You can edit this file to change the settings, but please follow the format carefully.',
  'You can also run the script with --config <path> to specify a different config file.',
  "Here's what an example entry looks like:",
  '"token": "your_token_here",',
  '"instance": "https://invidious.example.com",',
  "Make sure all the values are in double quotes and end with a comma (the last one doesn't need a comma)",
]
const comments = {
  token: [
    'Accepted values: a valid Invidious token',
    'Your Invidious token (SID cookie)',
    'You can usually get a token by going to your instance > Settings/Preferences > Manage Tokens and pasting any of the tokens in',
    'Warning: Be careful with these, they give full read/write access to your Invidious account',
    'You can also specify this with --token',
    'this is the only required argument, but you probably want to specify the instance too',
    'the token here is encrypted at rest using the system keychain via keytar',
    'if you want to change the passphrase, you can delete it from your keychain and it will prompt you again',
    'the default passphrase is "ilikewaffles" + 8 random hex characters, you should change this',
  ],
  instance: [
    'Accepted values: a Invidious instance URL starting with https://',
    'If you use http://, you need to use insecure mode see below',
    'Your Invidious instance URL',
    'Defaults to https://invidious.example.com (not a real instance)',
    'If you self-host Invidious with a custom TLS certificate, make sure to run with --use-system-ca.',
    "If you're on linux, node doesn't support --use-system-ca, but trusts the system store by default.",
    'Make sure to run with --use-system-ca if you get TLS errors or install the CA.',
    'If your instance runs on a port other than 443, you can specify it like https://invidious.example.com:3000',
  ],
  freetube_dir: [
    'Accepted values: a valid FreeTube data directory path, you should add proper slashes for your OS: \\ on Windows, / on Linux/Mac',
    'Your FreeTube data directory',
    'On Windows, usually %AppData%\\FreeTube (yourUser/AppData/Roaming/FreeTube)',
    'On Linux, usually ~/.config/FreeTube',
    'On macOS, usually ~/Library/Application Support/FreeTube',
    // dont have a mac os machine to test this on, but it should work
    // if this is wrong, please open an issue on the GitHub repo
    'You can also specify this with --freetube-dir',
  ],
  export_dir: [
    'Accepted values: a valid export directory path, you should add proper slashes for your OS: \\ on Windows, / on Linux/Mac',
    'The export output directory',
    'Defaults to either the FreeTube directory or the current working directory',
    'You can also specify this with --export-dir',
  ],
  verbose: [
    'Accepted values: true or false',
    'Enable verbose output?',
    'This will log more information about what the script is doing',
    'Useful for debugging or understanding the sync process',
  ],
  dry_run: [
    'Accepted values: true or false',
    'Enable dry run mode (no uploads)?',
    'This will not upload anything to Invidious, just show what would be done',
    'Useful for testing the script without making changes',
  ],
  dont_shorten_paths: [
    'Accepted values: true or false',
    'Show full paths in logs?',
    'By default, it shows things like <FreeTubeDir>/invidious-import.json',
    'instead of C:/Users/You/AppData/Roaming/FreeTube/invidious-import.json',
    'You can also specify this with --dont-shorten-paths',
  ],
  cron_schedule: [
    'Accepted values: a valid cron pattern, like "0 0 * * *" for daily at midnight',
    'A cron pattern to run the sync on a schedule',
    'If not provided, runs once and exits',
    'See https://crontab.guru/ for help with cron patterns',
    'You can also specify this with --cron-schedule',
    "defaults to '' (empty string) which means it runs once and exits like normal",
  ],
  noSync: [
    'Accepted values: true or false',
    'Skip the sync to Invidious step',
    "Intended for cases where you want to bring the export file to Invidious yourself or can't use the API",
    'You can also specify this with --no-sync',
  ],
  insecure: [
    'Accepted values: true or false',
    'Use HTTP instead of HTTPS for Invidious requests',
    "This is insecure and should only be used if you know what you're doing",
    'You can also specify this with --insecure',
    'This is useful for self-hosted instances on default configurations',
    'when you run first-time setup, this adapts based on the instance you entered',
  ],
  quiet: [
    'Accepted values: true or false',
    'Suppress all non-error output?',
    'This will hide all output from the script, including errors',
    'You can also specify this with --quiet, see help for aliases',
  ],
  logs: [
    'accepted values: true or false',
    'enables logging of the console output',
    'name cannot be changed from ft-to-inv-(current time).log',
  ],
  // we have the comments, now we just need to add them to the config object
}
function renderConfigWithComments(config, comments, topComments = []) {
  const lines = []
  // Add top-level comments *before* the opening brace
  topComments.forEach(comment => {
    lines.push(`// ${comment}`)
  })
  // Then open the object
  lines.push('{')
  const keys = Object.keys(config)
  keys.forEach((key, index) => {
    const value = config[key]
    const commentLines = comments[key] || []
    commentLines.forEach(c => lines.push(`  // ${c}`))
    const serialized = typeof value === 'string' ? JSON.stringify(value) : value
    const comma = index < keys.length - 1 ? ',' : '' // ← omit comma on last entry
    lines.push(`  "${key}": ${serialized}${comma}`)
  })
  lines.push('}')
  return lines.join('\n')
}
/**
 * Detect if a URL is using HTTPS or HTTP, and set config flags accordingly.
 * @param {string} url - The URL, including the protocol (http or https).
 * @returns {value} - The value of the insecure flag, either true or false.
 * we can use this function to detect the protocol, and set config flags like INSECURE accordingly
 */
let insecure = false
function detectHttps(url) {
  if (url.startsWith('http://')) return (insecure = true)
  return false
}
export async function runFirstTimeSetup() {
  console.log("\n🛠 First-time setup: Let's configure your FreeTube → Invidious sync")

  const token = await prompt('Enter your Invidious token (SID cookie)')
  const pass = await getPassphrase()
  const encryptedToken = encryptToken(token, pass)
  const decryptedToken = decryptToken(encryptedToken, pass)
  const instance = await prompt('Enter the Invidious instance URL', 'https://invidious.example.com')
  const ftDir = await prompt('Enter your FreeTube data directory', getDefaultFreeTubeDir())
  const exportDir = await prompt('Enter the export output directory', './')

  const configPath = await prompt(
    'Where do you want to save this config file?',
    './ft-to-inv.jsonc'
  )

  let verbose = (await prompt('Enable verbose output? (y/n)', 'n')) === 'y'
  if (!checkBoolean(verbose)) console.log('Invalid input, expected y or n, defaulting to n')
  let dryRun = (await prompt('Enable dry run mode (no uploads)? (y/n)', 'n')) === 'y'
  if (!checkBoolean(dryRun)) console.log('Invalid input, expected y or n, defaulting to n')
  let dontShorten = (await prompt('Show full paths in logs? (y/n)', 'n')) === 'y'
  if (!checkBoolean(dontShorten)) console.log('Invalid input, expected y or n, defaulting to n')

  let logs = (await prompt('Enable logging to a file? (y/n)', 'n')) === 'y'
  if (!checkBoolean(logs)) console.log('Invalid input, expected y or n, defaulting to n')

  let ftDirNormalized = normalizePath(ftDir)
  let exportDirNormalized = normalizePath(exportDir)

  detectHttps(instance)

  const config = {
    token: encryptedToken,
    instance: instance,
    freetube_dir: ftDirNormalized,
    export_dir: exportDirNormalized,
    verbose: verbose,
    dry_run: dryRun,
    dont_shorten_paths: dontShorten,
    insecure: insecure || false,
    logs: logs,
  }

  const mergedConfig = {
    ...defaultConfig,
    ...config, // user-specified values override defaults
  }
  console.log('\nVerifying token and instance, please wait...')
  const valid = await testToken(mergedConfig.instance, decryptedToken)
  if (!valid) {
    console.error(
      '❌ Token verification failed. Please check your token and instance URL and try again.'
    )
    console.log('👉 You can bypass these checks with the --skip-verification flag')
    process.exit(1)
  }
  if (
    configPath !== './ft-to-inv.jsonc' ||
    configPath !== normalizePath('./ft-to-inv.jsonc') ||
    configPath !== resolve('./ft-to-inv.jsonc')
  ) {
    setConfigPathEnv(configPath)
  }
  const savePath = configPath || _resolve(DEFAULT_CONFIG_FILENAME)
  const configFileContent = renderConfigWithComments(mergedConfig, comments, topComments)
  await promises.writeFile(savePath, configFileContent)
  console.log(`✅ Config saved to ${savePath}`)
  console.log('✅ Config initialized successfully.')
  console.log('👉 Please run the command again to start syncing.')
  process.exit(0)
  // we exit here because the globals in export.js try to set while it's writing
}

export function loadConfig(conf) {
  const config = conf
  const fileConfig = existsSync(config) ? loadJsonc(config) : {}
  const merged = { ...fileConfig }

  return merged
}
