// fine ill make a helper
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const stripJsonComments = require('strip-json-comments');
const commentJson = require('comment-json');
const { get } = require('http');

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.findIndex(arg => arg === name || arg.startsWith(name + '='));
  if (index !== -1) {
    const split = args[index].split('=');
    return split.length > 1 ? split[1] : args[index + 1];
  }
  return fallback;
};

// ==== Defaults ====
const DEFAULT_CONFIG_FILENAME = 'ft-to-inv.jsonc';

// ==== ENV ====
const ENV_CONFIG_PATH = process.env.FT_INV_CONFIG;

// args parsed in export.js
function detectOs() {
  const platform = process.platform;
  if (platform === 'win32') return 'windows';
  if (platform === 'darwin') return 'macos';
  if (platform === 'linux') return 'linux';
  return 'unknown';
}

function getDefaultFreeTubeDir() {
  const os = detectOs();
  const home = process.env.HOME || process.env.USERPROFILE;
  const appData = process.env.APPDATA;
  console.log(`called getDefaultFreeTubeDir, os: ${os}, home: ${home}, appData: ${appData}`);
  if (!home && os !== 'windows') return  null;
  if (os === 'windows') return appData ? path.join(appData, 'FreeTube') : null;
  if (os === 'linux') return path.join(home, '.config', 'FreeTube');
  if (os === 'macos') return path.join(home, 'Library', 'Application Support', 'FreeTube');
  if (os === 'unknown') return null;
  return null;
}

// ==== LOAD JSONC CONFIG ====
function loadJsonc(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return commentJson.parse(raw);
  } catch (err) {
    console.warn(`⚠️ Failed to load config at ${filePath}: ${err.message}`);
    console.warn  ("Verbose: this error comes from config.js file, which loads the config file and parses it.")
    return {};
  }
}

// ==== NORMALIZE PATHS ====
function normalizePath(inputPath) {
  if (!inputPath) return '';
  return detectOs() === 'windows'
    ? path.normalize(inputPath.replace(/\//g, '\\'))
    : path.normalize(inputPath);
}
// shouldnt need to correct paths on macOS/Linux
// ==== RESOLVE ALL FILE PATHS ====
function resolvePaths(config) {
  const base = normalizePath(config.freetube_dir || getDefaultFreeTubeDir() || '');
  const exportDir = normalizePath(config.export_dir || '.');
  console.log(`
    This message is called in config.js at line ~74 under resolvePaths function.
    Resolving paths with base: ${base}, exportDir: ${exportDir}
    `);
  return {
    HISTORY_PATH: path.join(base, 'history.db'),
    PLAYLIST_PATH: path.join(base, 'playlists.db'),
    PROFILE_PATH: path.join(base, 'profiles.db'),
    EXPORT_DIR: exportDir,
    OUTPUT_FILE: path.join(exportDir, 'invidious-import.json'),
    OLD_EXPORT_PATH: path.join(exportDir, 'last-export.json'),
  };
}
// prompt
async function prompt(question, defaultValue = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `, answer => {
      rl.close();
      resolve(answer || defaultValue);
    });
  });
}
export const defaultConfig = {
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
  dont_shorten_paths: false,
  cron_schedule: '' 


};
// ==== FIRST-TIME SETUP INTERACTIVE PROMPT ====
async function runFirstTimeSetup() {
  
  console.log('\n🛠 First-time setup: Let\'s configure your FreeTube → Invidious sync');

  const token = await prompt('Enter your Invidious token (SID cookie)');
  const instance = await prompt('Enter the Invidious instance URL', 'https://invidiou.s');
  const ftDir = await prompt('Enter your FreeTube data directory', getDefaultFreeTubeDir());
  const exportDir = await prompt('Enter the export output directory', './');

  const configPath = await prompt('Where do you want to save this config file?', './ft-to-inv.jsonc');

  const verbose = await prompt('Enable verbose output? (y/n)', 'y') === 'y';
  const dryRun = await prompt('Enable dry run mode (no uploads)? (y/n)', 'n') === 'y';
  const dontShorten = await prompt('Show full paths in logs? (y/n)', 'n') === 'y';



  const config = {
    token,
    instance,
    freetube_dir: normalizePath(ftDir),
    export_dir: normalizePath(exportDir),
    verbose,
    dry_run: dryRun,
    dont_shorten_paths: dontShorten
  };

  const savePath = ENV_CONFIG_PATH || path.resolve(DEFAULT_CONFIG_FILENAME);
  fs.writeFileSync(savePath, JSON.stringify(config, null, 2));
  console.log(`✅ Config saved to ${savePath}`);
  return config;
}

// ==== MAIN LOAD FUNCTION ====
function loadConfig() {
  const configArg = getArg('--config') || getArg('-c');
  console.log(configArg)
  const configPath =
    configArg ||
    ENV_CONFIG_PATH ||
    path.resolve(DEFAULT_CONFIG_FILENAME);

  const fileConfig = fs.existsSync(configPath) ? loadJsonc(configPath) : {};
  const merged = { ...fileConfig, ...cliArgs };

  return merged;
}

// ==== EXPORTS ====
module.exports = {
  loadConfig,
  runFirstTimeSetup,
  resolvePaths,
  normalizePath,
  getDefaultFreeTubeDir,
};
