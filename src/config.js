// fine ill make a helper
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const commentJson = require('comment-json');

const args = process.argv.slice(2);
const getArg = (name, fallback = null) => {
  const index = args.findIndex(arg => arg === name || arg.startsWith(name + '='));
  if (index !== -1) {
    const split = args[index].split('=');
    return split.length > 1 ? split[1] : args[index + 1];
  }
  return fallback;
};
/**
 * Get the value of an environment variable.
 * @param {string} option - The name of the environment variable to retrieve.
 * @returns {string|undefined} - The value of the environment variable, or undefined if not set.
 */
function getEnv(option) {
  return process.env[option] || undefined;
}
const DEFAULT_CONFIG_FILENAME = 'ft-to-inv.jsonc';

const ENV_CONFIG_PATH = normalizePath(getEnv('FT_INV_CONFIG')) || normalizePath(getEnv('FT_TO_INV_CONFIG')) || normalizePath(getEnv('CONFIG')) || normalizePath(getEnv('FT_TO_INV_CONFIG_PATH'));

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
function loadJsonc(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return commentJson.parse(raw);
  } catch (err) {
    console.warn(`⚠️ Failed to load config at ${filePath}: ${err.message}`);
    return {};
  }
}
function normalizePath(inputPath) {
  if (typeof inputPath !== 'string') return '';
  if (!inputPath) return '';
  if (inputPath === '.' || inputPath === './' && detectOs() === 'windows') {
    return '.\\';
  }
  if (detectOs() === 'windows') {
    return path.normalize(inputPath.replace(/\//g, '\\'));
  }
  return path.normalize(inputPath);
}
// stopped using this in favor of hardcoding in export.js
// but vs still says it's used, so i'm not removing it yet
function resolvePaths(config) {
  const base = normalizePath(config.freetube_dir || getDefaultFreeTubeDir() || '');
  const exportDir = normalizePath(config.export_dir || '.');
  return {
    HISTORY_PATH: path.join(base, 'history.db'),
    PLAYLIST_PATH: path.join(base, 'playlists.db'),
    PROFILE_PATH: path.join(base, 'profiles.db'),
    EXPORT_DIR: exportDir,
    OUTPUT_FILE: path.join(exportDir, 'invidious-import.json'),
    OLD_EXPORT_PATH: path.join(exportDir, 'last-export.json'),
  };
}

function setConfigPathEnv(path) {
  process.env.CONFIG = path;
  console.log(`Set CONFIG environment variable to ${path}`);
  console.log('debug:' + process.env.CONFIG);
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
  "cron_schedule": '',
  "logs": false
};
//comments at the top of the file
const topComments = [
  'This is the configuration file for the FreeTube to Invidious exporter.',
  'You can edit this file to change the settings, but please follow the format carefully.',
  'You can also run the script with --config <path> to specify a different config file.',
  'Here\'s what an example entry looks like:',
  '"token": "your_token_here",',
  '"instance": "https://invidious.example.com",',
  'Make sure all the values are in double quotes and end with a comma (the last one doesn\'t need a comma)'
]
const comments = {
    "token": [
      'Accepted values: a valid Invidious token',
      'Your Invidious token (SID cookie)',
      'You can usually get a token by going to your instance > Settings/Preferences > Manage Tokens and pasting any of the tokens in',
      'Warning: Be careful with these, they give full read/write access to your Invidious account',
      'You can also specify this with --token',
      'this is the only required argument, but you probably want to specify the instance too',
    ],
    "instance": [
      'Accepted values: a Invidious instance URL starting with https://',
      'If you use http://, you need to use insecure mode see below', 
      'Your Invidious instance URL',
      'Defaults to https://invidiou.s',
      'If you self-host Invidious with a custom TLS certificate, make sure to run with --use-system-ca.',
      'If you\'re on linux, node doesn\'t support --use-system-ca, but trusts the system store by default.',
      'Make sure to run with --use-system-ca if you get TLS errors or install the CA.',
      'If your instance runs on a port other than 443, you can specify it like https://invidious.example.com:3000',
    ],
    "freetube_dir": [
      'Accepted values: a valid FreeTube data directory path, youu should add proper slashes for your OS: \\ on Windows, / on Linux/Mac',
      'Your FreeTube data directory',
      'On Windows, usually %AppData%\\FreeTube (yourUser/AppData/Roaming/FreeTube)',
      'On Linux, usually ~/.config/FreeTube',
      'On macOS, usually ~/Library/Application Support/FreeTube',
      // dont have a mac os machine to test this on, but it should work
      // if this is wrong, please open an issue on the GitHub repo
      'You can also specify this with --freetube-dir',
    ],
    "export_dir": [
      'Accepted values: a valid export directory path, you should add proper slashes for your OS: \\ on Windows, / on Linux/Mac',
      'The export output directory',
      "Defaults to either the FreeTube directory or the current working directory",
      'You can also specify this with --export-dir',
    ],
    "verbose": [
      'Accepted values: true or false',
      'Enable verbose output?',
      'This will log more information about what the script is doing',
      'Useful for debugging or understanding the sync process',
    ],
    "dry_run": [
      'Accepted values: true or false',
      'Enable dry run mode (no uploads)?',
      'This will not upload anything to Invidious, just show what would be done',
      'Useful for testing the script without making changes',
    ],
    "dont_shorten_paths": [
      'Accepted values: true or false',
      'Show full paths in logs?',
      'By default, it shows things like <FreeTubeDir>/invidious-import.json',
      'instead of C:/Users/You/AppData/Roaming/FreeTube/invidious-import.json',
      'You can also specify this with --dont-shorten-paths',
    ],
    "cron_schedule": [
      'Accepted values: a valid cron pattern, like "0 0 * * *" for daily at midnight',
      'A cron pattern to run the sync on a schedule',
      'If not provided, runs once and exits',
      'See https://crontab.guru/ for help with cron patterns',
      'You can also specify this with --cron-schedule',
      'defaults to \'\' (empty string) which means it runs once and exits like normal',
    ],
    "noSync": [
      'Accepted values: true or false',
      'Skip the sync to Invidious step',
      'Intended for cases where you want to bring the export file to Invidious yourself or can\'t use the API',
      'You can also specify this with --no-sync',
    ],
    "insecure": [
      'Accepted values: true or false',
      'Use HTTP instead of HTTPS for Invidious requests',
      'This is insecure and should only be used if you know what you\'re doing',
      'You can also specify this with --insecure',
      'This is useful for self-hosted instances on default configurations',
      'when you run first-time setup, this adapts based on the instance you entered',
    ],
    "quiet": [
      'Accepted values: true or false',
      'Suppress all non-error output?',
      'This will hide all output from the script, including errors',
      'You can also specify this with --quiet, see help for aliases',
    ],
    "logs": [
      "accepted values: true or false",
      "enables logging of the console output",
      "name cannot be changed from ft-to-inv-(current time).log"
    ]
    // we have the comments, now we just need to add them to the config object
  };
function renderConfigWithComments(config, comments, topComments = []) {
  const lines = [];
  // Add top-level comments *before* the opening brace
  topComments.forEach(comment => {
    lines.push(`// ${comment}`);
  });
  // Then open the object
  lines.push('{');
  const keys = Object.keys(config);
  keys.forEach((key, index) => {
    const value = config[key];
    const commentLines = comments[key] || [];
    commentLines.forEach(c => lines.push(`  // ${c}`));
    const serialized = typeof value === 'string' ? JSON.stringify(value) : value;
    const comma = index < keys.length - 1 ? ',' : ''; // ← omit comma on last entry
    lines.push(`  "${key}": ${serialized}${comma}`);
  });
  lines.push('}');
  return lines.join('\n');
}
/**
 * Detect if a URL is using HTTPS or HTTP, and set config flags accordingly.
 * @param {string} url - The URL, including the protocol (http or https).
 * @returns {value} - The value of the insecure flag, either true or false.
 * we can use this function to detect the protocol, and set config flags like INSECURE accordingly
 */
let insecure = false;
function detectHttps(url) {
  if (url.startsWith('http://')) return (insecure = true);
  return false;
}
async function runFirstTimeSetup() {
  
  console.log('\n🛠 First-time setup: Let\'s configure your FreeTube → Invidious sync');

  const token = await prompt('Enter your Invidious token (SID cookie)');
  const instance = await prompt('Enter the Invidious instance URL', 'https://invidious.example.com');
  const ftDir = await prompt('Enter your FreeTube data directory', getDefaultFreeTubeDir());
  const exportDir = await prompt('Enter the export output directory', './');

  const configPath = await prompt('Where do you want to save this config file?', './ft-to-inv.jsonc');

  const verbose = await prompt('Enable verbose output? (y/n)', 'n') === 'y';
  const dryRun = await prompt('Enable dry run mode (no uploads)? (y/n)', 'n') === 'y';
  const dontShorten = await prompt('Show full paths in logs? (y/n)', 'n') === 'y';

  const logs = await prompt('Enable logging to a file? (y/n)', 'n') === 'y';

  let ftDirNormalized = normalizePath(ftDir);
  let exportDirNormalized = normalizePath(exportDir);
   
  detectHttps(instance)

  const config = {
    "token": token,
    "instance": instance,
    "freetube_dir": ftDirNormalized,
    "export_dir": exportDirNormalized,
    "verbose": verbose,
    "dry_run": dryRun,
    "dont_shorten_paths": dontShorten,
    "insecure": insecure || false,
    "logs": logs
  };
  
  const mergedConfig = {
  ...defaultConfig,
  ...config // user-specified values override defaults
};

  if (configPath !== './ft-to-inv.jsonc' || configPath !== normalizePath('./ft-to-inv.jsonc')) {
    setConfigPathEnv(configPath);
  }
  const savePath = ENV_CONFIG_PATH || configPath || path.resolve(DEFAULT_CONFIG_FILENAME);
  const configFileContent = renderConfigWithComments(mergedConfig, comments, topComments);
  await fs.promises.writeFile(savePath, configFileContent);
  console.log(`✅ Config saved to ${savePath}`);
  console.log('✅ Config initialized successfully.');
  console.log('👉 Please run the command again to start syncing.');
  process.exit(0);
  // we exit here because the globals in export.js try to set while it's writing

}

function loadConfig(conf) {
  const config = conf
  console.log('Loading config from:', config || 'ft-to-inv.jsonc (default)');
  const fileConfig = fs.existsSync(config) ? loadJsonc(config) : {};
  const merged = { ...fileConfig };

  return merged;
}

module.exports = {
  loadConfig,
  runFirstTimeSetup,
  resolvePaths,
  normalizePath,
  getDefaultFreeTubeDir,
  getEnv,
  prompt
};
