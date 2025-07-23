// fine ill make a helper
const fs = require('fs');
const path = require('path');
const readline = require('readline');
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
  if (inputPath === '.' || inputPath === './' && detectOs() === 'windows') {
    return '.\\';
  }
  return detectOs() === 'windows'
    ? path.normalize(inputPath.replace(/\//g, '\\'))
    : path.normalize(inputPath);
}
// shouldnt need to correct paths on macOS/Linux
// ==== RESOLVE ALL FILE PATHS ====
// stopped using this in favor of hardcoding in export.js
// but vs still says it's used, so i'm not removing it yet
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
const defaultConfig = {
  "token": '',
  "instance": 'https://invidiou.s',
  "freetube_dir": getDefaultFreeTubeDir(),
  "export_dir": './',
  "verbose": false,
  "dry_run": false,
  "dont_shorten_paths": false,
  "noSync": false,
  "quiet": false,
  "insecure": false,
  "cron_schedule": ''
};
const comments = {
    "token": [
      'Your Invidious token (SID cookie)',
      'You can usually get a token by going to your instance > Settings/Preferences > Manage Tokens and pasting any of the tokens in',
      'Warning: Be careful with these, they give full read/write access to your Invidious account',
      'You can also specify this with --token',
      'this is the only required argument, but you probably want to specify the instance too',
    ],
    "instance": [
      'Your Invidious instance URL',
      'Defaults to https://invidiou.s',
      'If you self-host Invidious with a custom TLS certificate, make sure to run with --use-system-ca.',
      'If you\'re on linux, node doesn\'t support --use-system-ca, but trusts the system store by default.',
      'Make sure to run with --use-system-ca if you get TLS errors or install the CA.',
      'If your instance runs on a port other than 443, you can specify it like https://invidious.example.com:3000',
    ],
    "freetube_dir": [
      'Your FreeTube data directory',
      'On Windows, usually %AppData%\\FreeTube (yourUser/AppData/Roaming/FreeTube)',
      'On Linux, usually ~/.config/FreeTube',
      'On macOS, usually ~/Library/Application Support/FreeTube',
      // dont have a mac os machine to test this on, but it should work
      // if this is wrong, please open an issue on the GitHub repo
      'You can also specify this with --freetube-dir',
    ],
    "export_dir": [
      'The export output directory',
      "Defaults to either the FreeTube directory or the current working directory",
      'You can also specify this with --export-dir',
    ],
    "verbose": [
      'Enable verbose output?',
      'This will log more information about what the script is doing',
      'Useful for debugging or understanding the sync process',
    ],
    "dry_run": [
      'Enable dry run mode (no uploads)?',
      'This will not upload anything to Invidious, just show what would be done',
      'Useful for testing the script without making changes',
    ],
    "dont_shorten_paths": [
      'Show full paths in logs?',
      'By default, it shows things like <FreeTubeDir>/invidious-import.json',
      'instead of C:/Users/You/AppData/Roaming/FreeTube/invidious-import.json',
      'You can also specify this with --dont-shorten-paths',
    ],
    "cron_schedule": [
      'A cron pattern to run the sync on a schedule',
      'If not provided, runs once and exits',
      'See https://crontab.guru/ for help with cron patterns',
      'You can also specify this with --cron-schedule',
    ],
    "noSync": [
      'Skip the sync to Invidious step',
      'Intended for cases where you want to bring the export file to Invidious yourself or can\'t use the API',
      'You can also specify this with --no-sync',
    ],
    "insecure": [
      'Use HTTP instead of HTTPS for Invidious requests',
      'This is insecure and should only be used if you know what you\'re doing',
      'You can also specify this with --insecure',
      'This is useful for self-hosted instances on default configurations',
    ],
    "quiet": [
      'Suppress all non-error output?',
      'This will hide all output from the script, including errors',
      'You can also specify this with --quiet',
    ],
    // we have the comments, now we just need to add them to the config object
  };
function renderConfigWithComments(config, comments) {
  let lines = ['{'];
  for (const [key, value] of Object.entries(config)) {
    const commentLines = comments[key] || [];
    commentLines.forEach(c => lines.push(`  // ${c}`));
    const serialized = typeof value === 'string' ? JSON.stringify(value) : value;
    lines.push(`  "${key}": ${serialized},\n`);
  }
  lines.push('}');
  return lines.join('\n');
}
// ==== FIRST-TIME SETUP INTERACTIVE PROMPT ====
async function runFirstTimeSetup() {
  
  console.log('\n🛠 First-time setup: Let\'s configure your FreeTube → Invidious sync');

  const token = await prompt('Enter your Invidious token (SID cookie)');
  const instance = await prompt('Enter the Invidious instance URL', 'https://invidiou.s');
  const ftDir = await prompt('Enter your FreeTube data directory', getDefaultFreeTubeDir());
  const exportDir = await prompt('Enter the export output directory', './');

  const configPath = await prompt('Where do you want to save this config file?', './ft-to-inv.jsonc');

  const verbose = await prompt('Enable verbose output? (y/n)', 'n') === 'y';
  const dryRun = await prompt('Enable dry run mode (no uploads)? (y/n)', 'n') === 'y';
  const dontShorten = await prompt('Show full paths in logs? (y/n)', 'n') === 'y';

  let ftDirNormalized = normalizePath(ftDir);
  let exportDirNormalized = normalizePath(exportDir);

  const config = {
    "token": token,
    "instance": instance,
    "freetube_dir": ftDirNormalized,
    "export_dir": exportDirNormalized,
    "verbose": verbose,
    "dry_run": dryRun,
    "dont_shorten_paths": dontShorten
  };
  
  const mergedConfig = {
  ...defaultConfig,
  ...config // user-specified values override defaults
};


  const savePath = ENV_CONFIG_PATH || configPath || path.resolve(DEFAULT_CONFIG_FILENAME);
  const configFileContent = renderConfigWithComments(mergedConfig, comments);
  await fs.promises.writeFile(savePath, configFileContent);
  console.log(`✅ Config saved to ${savePath}`);
  console.log('✅ Config initialized successfully.');
  console.log('👉 Please run the command again to start syncing.');
  process.exit(0);
  // we exit here because the globals in export.js try to set while it's writing

}

// ==== MAIN LOAD FUNCTION ====
function loadConfig() {
  const configArg = getArg('--config') || getArg('-c');
  const configPath =
    configArg ||
    ENV_CONFIG_PATH ||
    path.resolve(DEFAULT_CONFIG_FILENAME);

  const fileConfig = fs.existsSync(configPath) ? loadJsonc(configPath) : {};
  const merged = { ...fileConfig };

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
