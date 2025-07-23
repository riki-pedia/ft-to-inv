// this script exports FreeTube data (history, playlists, subscriptions) to Invidious.
// it can be run once or scheduled with node-cron.
// you need to provide your Invidious SID cookie with --token.
// optionally, you can specify your Invidious instance with --instance (default: https://invidiou.s).
// you can specify FreeTube's data directory with --freetube-dir (default depends on OS).
// you can specify the output directory with --export-dir (default: same as FreeTube dir).
// there's a lot of other options, see --help.
// this isn't a very pretty script, but it works.
// usage: node --use-system-ca export.js --token YOUR_INVIDIOUS_SID_COOKIE 
// i might make this command look better later, maybe npx or something like that
const https = require('https');
const path = require('path');
const { argv } = require('process');
const fs = require('fs');
const readline = require('readline');
const cron = require('node-cron');
const { get } = require('http');
const commentJson = require('jsonc');
const { text } = require('stream/consumers');

const args = process.argv.slice(2);
// define global vars, edit them in bootstrap, use in sync
// Globals used throughout the script
let FREETUBE_DIR, TOKEN, INSTANCE, VERBOSE, DRY_RUN, QUIET, OUTPUT_FILE, OLD_EXPORT_PATH, CRON_SCHEDULE, INSECURE, DONT_SHORTEN_PATHS, NOSYNC;
let HISTORY_PATH, PLAYLIST_PATH, PROFILE_PATH, EXPORT_DIR;


// accept --flag value or --flag=value
const getArg = (name, fallback = null) => {
  const index = args.findIndex(arg => arg === name || arg.startsWith(name + '='));
  if (index !== -1) {
    const split = args[index].split('=');
    return split.length > 1 ? split[1] : args[index + 1];
  }
  return fallback;
};

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

  if (!home && os !== 'windows') return null;
  if (os === 'windows') return appData ? path.join(appData, 'FreeTube') : null;
  if (os === 'linux') return path.join(home, '.config', 'FreeTube');
  if (os === 'macos') return path.join(home, 'Library', 'Application Support', 'FreeTube');
  return null;
}

const normalizePath = (inputPath) => {
  if (!inputPath) return '';
  // Replace all forward slashes with backslashes on Windows, otherwise leave as-is
  return detectOs() === 'windows'
    ? path.normalize(inputPath.replace(/\//g, '\\'))
    : path.normalize(inputPath);
};

async function prompt(question, defaultValue = '') {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `, answer => {
      rl.close();
      resolve(answer || defaultValue);
    });
  });
}
// not making any helper scripts to keep this simple
// instead we have 700 lines of code in one file
function addComments(config) {
  if (!config || typeof config !== 'object') return config;
  const comments = {
    top: { 
      text: 'FreeTube to Invidious Exporter Configuration',
      text2: 'This file is in JSONC format, which allows comments.',
      text3: 'You can edit this file to change the configuration options.',
      text4: 'You can also specify these options as command line arguments.',
      text5: 'See --help for more information on command line options.',
    },
    token: {
      text: 'Your Invidious token (SID cookie)',
      text2: 'You can usually get a token by going to your instance > Settings/Preferences > Manage Tokens and pasting any of the tokens in',
      text3: 'Warning: Be careful with these, they give full read/write access to your Invidious account',
      text4: 'You can also specify this with --token',
      text5: 'this is the only required argument, but you probably want to specify the instance too',
    },
    instance: {
      text: 'Your Invidious instance URL',
      text2: 'Defaults to https://invidiou.s',
      text3: 'If you self-host Invidious with a custom TLS certificate, make sure to run with --use-system-ca.',
      text4: 'If you\'re on linux, node doesn\'t support --use-system-ca, but trusts the system store by default.',
      text5: 'Make sure to run with --use-system-ca if you get TLS errors or install the CA.',
      text6: 'If your instance runs on a port other than 443, you can specify it like https://invidious.example.com:3000',
    },
    freetube_dir: {
      text: 'Your FreeTube data directory',
      text2: 'On Windows, usually %AppData%\\FreeTube (yourUser/AppData/Roaming/FreeTube)',
      text3: 'On Linux, usually ~/.config/FreeTube',
      text4: 'On macOS, usually ~/Library/Application Support/FreeTube',
      // dont have a mac os machine to test this on, but it should work
      text5: 'You can also specify this with --freetube-dir',
    },
    export_dir: {
      text: 'The export output directory',
      text2: "Defaults to either the FreeTube directory or the current working directory",
      text3: 'You can also specify this with --export-dir',
    },
    verbose: {
      text: 'Enable verbose output?',
      text2: 'This will log more information about what the script is doing',
      text3: 'Useful for debugging or understanding the sync process',
    },
    dry_run: {
      text: 'Enable dry run mode (no uploads)?',
      text2: 'This will not upload anything to Invidious, just show what would be done',
      text3: 'Useful for testing the script without making changes',
    },
    dont_shorten_paths: {
      text: 'Show full paths in logs?',
      text2: 'By default, it shows things like <FreeTubeDir>/invidious-import.json',
      text3: 'instead of C:/Users/You/AppData/Roaming/FreeTube/invidious-import.json',
      text4: 'You can also specify this with --dont-shorten-paths',
    },
    cron_schedule: {
      text: 'A cron pattern to run the sync on a schedule',
      text2: 'If not provided, runs once and exits',
      text3: 'See https://crontab.guru/ for help with cron patterns',
      text4: 'You can also specify this with --cron-schedule',
    },
    no_sync: {
      text: 'Skip the sync to Invidious step',
      text2: 'Intended for cases where you want to bring the export file to Invidious yourself or can\'t use the API',
      text3: 'You can also specify this with --no-sync',
    },
    insecure: {
      text: 'Use HTTP instead of HTTPS for Invidious requests',
      text2: 'This is insecure and should only be used if you know what you\'re doing',
      text3: 'You can also specify this with --insecure',
      text4: 'This is useful for self-hosted instances on default configurations',
    },
    quiet: {
      text: 'Suppress all non-error output?',
      text2: 'This will hide all output from the script, including errors',
      text3: 'You can also specify this with --quiet',
    }
    // we have the comments, now we just need to add them to the config object
  };
  let commentedConfig = {};
  for (const key of Object.keys(config)) {
    if (comments[key]) {
      const commentLines = Object.values(comments[key]).join('\n');
      commentedConfig[`// ${commentLines}`] = undefined;
    }
    commentedConfig[key] = config[key];
  }
  return commentedConfig;
}
let configDefault = {
  token: '',
  instance: 'https://invidiou.s',
  freetube_dir: getDefaultFreeTubeDir(),
  export_dir: './',
  verbose: false,
  dry_run: false,
  dont_shorten_paths: false,
  cron_schedule: '',
  no_sync: false,
  insecure: false,
  quiet: false
};
async function runFirstTimeSetup() {
  console.log('\n🛠 First-time setup: Let\'s configure your FreeTube → Invidious sync\n');

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
  // Add comments to the config object
  const commentedConfig = addComments(config);
  try {
    fs.writeFileSync(configPath, JSON.stringify(commentedConfig, null, 2));
    console.log(`✅ Saved config to ${configPath}`);
  } catch (err) {
    console.error(`❌ Failed to write config: ${err.message}`);
  }

  return config;
}
const configArg = getArg('--config') || getArg('-c') || getArg('--config-file') || './ft-to-inv.jsonc';
const confNormalized = normalizePath(configArg);
const CONFIG_PATH = confNormalized
function loadConfig(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const parsed = commentJson.parse(raw);
    if (parsed.verbose) console.log(`Loaded config from ${filePath}`);
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return {};
    console.warn(`❌ Failed to read config file at ${filePath}:`, err.message);
    console.warn('Using ')
    return {};
  }
}

let CONFIG = loadConfig(CONFIG_PATH);

function isWSL () {
  const os = detectOs
   return os === 'linux' && fs.existsSync('/proc/version') && fs.readFileSync('/proc/version', 'utf8').toLowerCase.includes('microsoft');
}

// Detect first run if no config + no prior export file exists
const exportFileFallback = path.join(FREETUBE_DIR || '.', 'invidious-import.json');
const isFirstRun = Object.keys(CONFIG).length === 0 && !fs.existsSync(exportFileFallback);

function continueBootstrap(CONFIG) {
  // --- Get FreeTube directory ---
  const freetubeArg = getArg('--freetube-dir') || getArg('-dir') || getArg('-cd');
  const defaultFreetubeDir = CONFIG.freetube_dir || getDefaultFreeTubeDir();
  const ftArgClean = freetubeArg || defaultFreetubeDir;
  FREETUBE_DIR = normalizePath(ftArgClean);

  if (!FREETUBE_DIR || !fs.existsSync(FREETUBE_DIR)) {
    console.error(`❌ FreeTube directory not found: ${FREETUBE_DIR}`);
    process.exit(1);
  }

  // --- Get export directory ---
  const exportDirArg = getArg('--export-dir') || getArg('-e');
  const exportDirClean = exportDirArg || CONFIG.export_dir || FREETUBE_DIR;
  EXPORT_DIR = normalizePath(exportDirClean);

  if (!fs.existsSync(EXPORT_DIR)) {
    try {
      fs.mkdirSync(EXPORT_DIR, { recursive: true });
      console.log(`✅ Created export directory: ${EXPORT_DIR}`);
    } catch (err) {
      console.error(`❌ Could not create export directory: ${EXPORT_DIR}\n`, err);
      process.exit(1);
    }
  }

  const outputFileArg = getArg('--output-file') || getArg('-output');
  OUTPUT_FILE = outputFileArg
    ? path.join(EXPORT_DIR, outputFileArg)
    : path.join(EXPORT_DIR, 'invidious-import.json');

  // Required args
  TOKEN = getArg('--token') || getArg('-t') || CONFIG.token;
  if (!TOKEN) {
    console.error('❌ No Invidious token provided. Use --token or run setup.');
    process.exit(1);
  }

  INSTANCE = getArg('--instance') || getArg('-i') || CONFIG.instance || 'https://invidiou.s';

  // Flags
  DRY_RUN = args.includes('--dry-run') || args.includes('-d') || CONFIG.dry_run;
  VERBOSE = args.includes('--verbose') || args.includes('-v') || CONFIG.verbose;
  CRON_SCHEDULE = getArg('--cron-schedule') || getArg('--cron');
  const HELP = args.includes('--help') || args.includes('-h') || args.includes('/?') || args.includes('-?');
  NOSYNC = args.includes('--no-sync') || args.includes('-n');
  QUIET = args.includes('--quiet') || args.includes('-q');
  DONT_SHORTEN_PATHS = args.includes('--dont-shorten-paths') || CONFIG.dont_shorten_paths;
  INSECURE = args.includes('--insecure');

  if (HELP) {
  console.log(
    `FreeTube to Invidious Exporter\n 
    Configuration options: \n 
    Argument                                  Explanation\n +
    --token, -t               (required) Your Invidious SID cookie for authentication.\n 
    --token continued          You can usually get a token by going to your instance > Settings/Prefrences > Manage Tokens and pasting the top one in\n 
    --token continued          Warning: Be careful with these, they give full read/write access to your invidious account\n 
    --instance, -i            (optional) Your Invidious instance URL. Defaults to https://invidiou.s\n 
    --freetube-dir, -dir, -cd (optional) Path to FreeTube data directory. Defaults to OS-specific path.\n 
    --freetube-dir continued. On Windows, usually %AppData%\\FreeTube (yourUser/AppData/Roaming/Freetube). On Linux, usually ~/.config/FreeTube. On macOS, usually ~/Library/Application Support/FreeTube\n 
    --export-dir, -e          (optional) Directory to write the export file to. Defaults to FreeTube directory.\n 
    --output-file, -output    (optional) Name of the output file. Defaults to invidious-import.json.\n 
    --cron-schedule, -c       (optional) A cron pattern to run the sync on a schedule. If not provided, runs once and exits.\n 
    --dry-run, -d             (optional) Run the script without making any changes to Invidious or the output file.\n 
    --verbose, -v             (optional) Enable verbose logging.\n 
    --no-sync, -n             (optional) Skip the sync to Invidious step, just export the file. Intended for cases where you want to bring the export file to invidious yourself or can't use the API\n 
    --help, -h, /?, -?        Show this help message.\n 
    --use-system-ca           (optional) Pass this flag to node (node --use-system-ca export.js ...) to trust system CAs, useful for self-hosted instances with custom certs. See below.\n 
    --quiet, -q               (optional) Suppress non-error console output.\n 
    --dont-shorten-paths      (optional) Don't show shortend paths for files like the export file, by default it shows things like <FreeTubeDir>/invidious-import.json \n 
        continued             instead of C:/Users/You/AppData/Roaming/FreeTube/invidious-import.json\n 
                   Usage:\n +
    run once: node --use-system-ca export.js --token YOUR_INVIDIOUS_SID_COOKIE [other options]\n 
    cron job: node --use-system-ca export.js --token YOUR_INVIDIOUS_SID_COOKIE --cron-schedule "*/30 * * * *" [other options]\n 
    # cron job above runs every 30 minutes, see https://crontab.guru/ for help with cron patterns.\n 
    Note: If you self-host Invidious with a custom TLS certificate, make sure to run with --use-system-ca.\n 
    If you're on linux, node doesn't support --use-system-ca, but trust the system store by default.\n 
    If you get TLS errors, try NODE_EXTRA_CA_CERTS=/path/to/your/rootCA.crt\n
    You can also copy your self-signed cert to /usr/local/share/ca-certificates/ and run sudo update-ca-certificates\n`
  )
  process.exit(0);  
}
  
  // ⚠️ instance tweaks
  if (INSECURE && !QUIET) {
    INSTANCE = INSTANCE.replace(/^https:/, 'http:');
    console.warn('⚠️ Running in insecure mode, using HTTP instead of HTTPS.');
  }

  if (QUIET && VERBOSE) {
    console.error('❌ Cannot use --quiet and --verbose together.');
    process.exit(1);
  }

  if (!process.execArgv.includes('--use-system-ca') && !process.env.NODE_EXTRA_CA_CERTS && !DRY_RUN && !NOSYNC && !INSECURE) {
    console.warn('⚠️  Warning: Node.js may not trust invidious certificates...');
  }

  if (isWSL() && !QUIET) {
    console.warn("Detected WSL. Your FreeTube data might be in your Windows AppData folder\n" +
      "If you're on linux you can ignore this message\n" +
      "hint: You can access your C drive at /mnt/c/"
    )
  }

  if (detectOs() === 'linux'){
    console.warn("Detected Linux, node has different args than windows/macOS, so you might need to run with --use-system-ca\n" +
      "If you get TLS errors, try setting the environment variable NODE_EXTRA_CA_CERTS=/path/to/your/rootCA.crt\n");
  }

  if (VERBOSE) {
    console.log(`Detected OS: ${detectOs()}`);
    console.log(`Using FreeTube directory: ${FREETUBE_DIR}`);
    console.log(`Using export directory: ${EXPORT_DIR}`);
  }

  HISTORY_PATH = normalizePath(path.join(FREETUBE_DIR, `history.db`));
  PLAYLIST_PATH = normalizePath(path.join(FREETUBE_DIR, `playlists.db`));
  PROFILE_PATH = normalizePath(path.join(FREETUBE_DIR, `profiles.db`));
  OLD_EXPORT_PATH = normalizePath(path.join(EXPORT_DIR, `import.old.json`));

  const REQUIRED_FILES = ['history.db', 'playlists.db', 'profiles.db'];
  const missing = REQUIRED_FILES.filter(filename => !fs.existsSync(path.join(FREETUBE_DIR, filename)));

  if (missing.length > 0) {
  console.error(`❌ Missing required file${missing.length > 1 ? 's' : ''} in ${FREETUBE_DIR}: ${missing.join(', ')}`);
  console.error('ℹ️  Use --freetube-dir to manually specify the path.');
  process.exit(1);
}
  // You now have: FREETUBE_DIR, EXPORT_DIR, OUTPUT_FILE, TOKEN, INSTANCE, VERBOSE, etc.
  // Safe to move on to sync logic
}

async function loadNDJSON(path) {
  const rl = readline.createInterface({
    input: fs.createReadStream(path),
    crlfDelay: Infinity
  });
  const data = [];
  for await (const line of rl) {
    if (line.trim()) {
      try {
        data.push(JSON.parse(line));
      } catch (err) {
        console.warn(`❌ Could not parse line: ${line}`);
      }
    }
  }
  return data;
}
function stripDir(p) {
    if (!p || typeof p !== 'string') return p;
    if (DONT_SHORTEN_PATHS) return p;
    const toUnix = x => x.replaceAll('\\', '/');
    const norm = toUnix(path.resolve(p));
    const ft = toUnix(path.resolve(FREETUBE_DIR));
    const ex = toUnix(path.resolve(EXPORT_DIR));
    if (norm.startsWith(ft)) return norm.replace(ft, '<FreeTubeDir>');
    if (norm.startsWith(ex)) return norm.replace(ex, '<ExportDir>');
    return norm;
  }

async function extractSubscriptions(path) {
  const lines = await loadNDJSON(path);
  for (const profile of lines) {
    if (profile._id === "allChannels") {
      return profile.subscriptions.map(sub => sub.id);
    }
  }
  return [];
}

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

function readOldExport() {
  try {
    return JSON.parse(fs.readFileSync(OLD_EXPORT_PATH, 'utf-8'));
  } catch {
    return { watch_history: [], playlists: [], subscriptions: [] };
  }
}

function writeNewExport(data) {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
  fs.copyFileSync(OUTPUT_FILE, OLD_EXPORT_PATH);
}

function noSyncWrite(data) {
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(data, null, 2));
  if (!QUIET) {
  console.log(`✅ Wrote export to ${OUTPUT_FILE} (no-sync mode, not updating old export)`);
  }
}

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

if (!TOKEN && !DRY_RUN) {
  console.error("❌ No token specified. Use --token or run with --dry-run.");
  process.exit(1);
}

if (VERBOSE) {
  console.log(`Using instance: ${INSTANCE}`);
  console.log(`Using files:\n ${stripDir(HISTORY_PATH)},\n ${stripDir(PLAYLIST_PATH)},\n ${stripDir(PROFILE_PATH)},\n ${stripDir(OLD_EXPORT_PATH)}.\n Output will be written to ${stripDir(OUTPUT_FILE)}`);
}

async function sync() {
  try {
    if (VERBOSE) {
      console.log(TOKEN);
    }
    const historyData = await loadNDJSON(HISTORY_PATH);
    const playlistData = await loadNDJSON(PLAYLIST_PATH);
    const subscriptions = await extractSubscriptions(PROFILE_PATH);
    const watch_history = [...new Set(historyData.map(entry => entry.videoId))];

    const seenPlaylists = new Set();
    const playlists = [];
    for (const p of playlistData) {
      const name = p.playlistName?.trim().toLowerCase();
      if (!p.videos?.length || name === "favorites" || seenPlaylists.has(name)) continue;
      seenPlaylists.add(name);
      playlists.push({
        title: p.playlistName || "Untitled",
        description: p.description || "",
        privacy: "Private",
        videos: p.videos.map(v => v.videoId)
      });
    }

    const output = {
      version: 1,
      subscriptions,
      watch_history,
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

    const old = readOldExport();
    const newHistory = output.watch_history.filter(id => !old.watch_history.includes(id));
    const newSubs = output.subscriptions.filter(id => !old.subscriptions.includes(id));
    const newPlaylists = output.playlists.filter(p => !old.playlists.some(op => op.title === p.title && JSON.stringify(op.videos) === JSON.stringify(p.videos)));

    const removedHistory = old.watch_history.filter(id => !output.watch_history.includes(id));
    const removedSubs = old.subscriptions.filter(id => !output.subscriptions.includes(id));
    const removedPlaylists = old.playlists.filter(op =>
     !output.playlists.some(p => p.title === op.title)
);


    var useSVideo = newHistory.length !== 1 ? "s" : "";
    var useSSub = newSubs.length !== 1 ? "s" : "";
    var useSPlaylist = newPlaylists.length !== 1 ? "s" : "";

    if (DRY_RUN) {
      console.log(`🧪 [DRY RUN] Would sync ${newHistory.length} new video${useSVideo}, ${newSubs.length} new subscription${useSSub}, and ${newPlaylists.length} playlist${useSPlaylist}`);
      return;
    }

    if (VERBOSE) {
      console.log(`Found ${newHistory.length} new video${useSVideo} to sync`);
      console.log(`Found ${newSubs.length} new subscription${useSSub} to sync`);
      console.log(`Found ${newPlaylists.length} new playlist${useSPlaylist} to sync`);
      if (removedHistory.length) {
        console.log(`Found ${removedHistory.length} watched video${removedHistory.length !== 1 ? 's' : ''} to remove from watch history`);
      }
      if (removedSubs.length) {
        console.log(`Found ${removedSubs.length} subscription${removedSubs.length !== 1 ? 's' : ''} to unsubscribe from`);
      }
      if (removedPlaylists.length) {
        console.log(`Found ${removedPlaylists.length} playlist${removedPlaylists.length !== 1 ? 's' : ''} to delete`);
      }
    }

    let hadErrors = false;
    const markError = (label, err) => {
      hadErrors = true;
      console.error(`❌ ${label}:`, err);
    };
    if (!NOSYNC) {
    if (newHistory.length) {
      try {
        const res = await postToInvidious('/watch_history', newHistory);
        if (!QUIET) {
        console.log(`✅ Synced ${newHistory.length} new watched video${useSVideo} (HTTP ${res.code})`);
        }
        } catch (err) {
        markError('Failed to sync watch history', err);
      }
    }

    for (const sub of newSubs) {
      try {
        const res = await postToInvidious('/subscribe_ajax', { action: 'subscribe', ucid: sub });
        const name = await getChannelName(sub);
        if (!QUIET) {
          console.log(`📺 Subscribed to ${name} (${sub}) with HTTP ${res.code}`);
        }
        } catch (err) {
        markError(`Failed to subscribe to ${sub}`, err);
      }
    }

    const oldPlaylistTitles = new Set(old.playlists.map(p => p.title));
    for (const pl of newPlaylists) {
      if (oldPlaylistTitles.has(pl.title)) {
        console.log(`ℹ️ Skipping existing playlist: "${pl.title}"`);
        continue;
      }
      try {
        const res = await postToInvidious('/playlists/create', pl);
        console.log(`🎵 Created playlist "${pl.title}" (HTTP ${res.code})`);
      } catch (err) {
        markError(`Failed to create playlist "${pl.title}"`, err);
      }
    }
   
    // Remove watched videos
    if (removedHistory.length) {
     try {
      const res = await postToInvidious('/watch_history/delete', removedHistory);
      if (!QUIET) {
      console.log(`🗑️ Removed ${removedHistory.length} video${removedHistory.length !== 1 ? 's' : ''} from watch history (HTTP ${res.code})`);
      }
     } catch (err) {
       markError('Failed to remove from watch history', err);
      }
    }

    // Unsubscribe from channels
    for (const ucid of removedSubs) {
     try {
      const res = await postToInvidious('/subscribe_ajax', { action: 'unsubscribe', ucid });
      if (!QUIET) {
       console.log(`👋 Unsubscribed from ${ucid} (HTTP ${res.code})`);
      }
      } catch (err) {
       markError(`Failed to unsubscribe from ${ucid}`, err);
     }
    }

    // Delete playlists
    for (const op of removedPlaylists) {
     try {
      const res = await postToInvidious('/playlists/delete', { title: op.title });
      if (!QUIET) {
       console.log(`🗑️ Deleted playlist "${op.title}" (HTTP ${res.code})`);
      }
    } catch (err) {
      markError(`Failed to delete playlist "${op.title}"`, err);
    }
   }

    if (!hadErrors) {
      writeNewExport(output);
      if (!QUIET) {
      console.log(`✅ Exported to ${stripDir(OUTPUT_FILE)} and updated ${stripDir(OLD_EXPORT_PATH)}`);
      }
      if (QUIET) {
        console.log(`Sync complete. Exported to ${stripDir(OUTPUT_FILE)} and updated ${stripDir(OLD_EXPORT_PATH)}`);
      }
    } else {
      console.warn('⚠️ Some sync operations failed. Export not saved. Run with -v or --verbose for details.');
    }
  } else {
     if (!hadErrors) {
      noSyncWrite(output);
      }
    else {
      console.warn('⚠️ Some sync operations failed. Export not saved. Run with -v or --verbose for details.');
    }
  }
    if (CRON_SCHEDULE) {
    console.log("sync complete, waiting for next scheduled run...");
    }
  } catch (err) {
    console.error('❌ Uncaught error during sync:', err);
    process.exit(1);
  }
}
if (CRON_SCHEDULE) {
  console.log(`🕒 Scheduling sync with cron pattern: ${CRON_SCHEDULE}`);
  console.log('Press Ctrl+C to exit.');
  console.log("syncing now...")
  sync().catch(err => console.error('❌ Initial sync failed:', err));
  cron.schedule(CRON_SCHEDULE, () => {
    console.log(`🕒 Running scheduled sync at ${new Date().toLocaleString()}`);
    sync().catch(err => console.error('❌ Cron job failed:', err));
  });
} else {
  sync();
}
async function main() {
  if (isFirstRun) {
    const USER_CONFIG = await runFirstTimeSetup();
    await continueBootstrap(USER_CONFIG);
  } else {
    await continueBootstrap(CONFIG);
  }

  await sync();
}

main().catch(err => {
  console.error("❌ Unhandled error:", err);
  process.exit(1);
});