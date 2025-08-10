// main entrypoint, parses cli args and starts sync
// the command to run this is not that pretty
// node [--use-system-ca] export.js [flags]
// not gonna talk about use system ca, see help or config
// gets values in this order:
// cli args > env > config
// you can preface env with FT_INV_CONFIG_OPTION, where option is the cli flag you want to pass
// for example: set FT_TO_INV_CONFIG_INSTANCE=https://invidous.example.com sets the instance flag to be https://invidious.example.com
const fs = require('fs');
const path = require('path');
const { loadConfig, runFirstTimeSetup, getDefaultFreeTubeDir, normalizePath, getEnv } = require('./config');
const {
  loadNDJSON,
  extractSubscriptions,
  readOldExport,
  writeNewExport,
  noSyncWrite,
  postToInvidious,
  getChannelName,
  writePlaylistImport
} = require('./utils');
const cron = require('node-cron');

const args = process.argv.slice(2);
// cron is the only arg that should reasonably have spaces, so we handle it specially
const getArg = (name, fallback = null) => {
  const index = args.findIndex(arg => arg === name || arg.startsWith(name + '='));
  if (index !== -1) {
    const split = args[index].split('=');
    if (split.length > 1) return split[1];
    // Special handling for --cron or -cron spaced format
    if (name === '--cron' || name === '-cron' || name === '--cron-schedule') {
      const cronParts = args.slice(index + 1, index + 6);
      if (cronParts.length >= 5 && cronParts.every(p => /^(\*|\d+)$/.test(p))) {
        return cronParts.join(' ');
      }
      // fallback: maybe it's just one arg
      if (args[index + 1]) return args[index + 1];
    }
    return args[index + 1];
  }
  return fallback;
};
/**
 * Resolves environment variables from the process.env object.
 * Intended for use of bulk resolution of environment variables.
 * Or if there's multiple aliases for the same config option.
 * @param {array<string>} env - An array of environment variable names to resolve.
 * @returns {string|undefined} - The value of the first found environment variable, or an empty variable if none are found.
 */
function resolveEnvVars(env = []) {
  let resolved = undefined;
  for (const key of env) {
    const value = process.env[key];
    if (value !== undefined) {
      resolved = getEnv(key);
      break; // Stop at the first found environment variable
    }
  }
  return resolved;
}
function sanitizeEnvBoolean(value) {
    if (typeof value !== 'boolean') {
        return false;
    }
    return value;
}

// -- Globals (to be assigned in bootstrap) --
let TOKEN, INSTANCE, VERBOSE, DRY_RUN, QUIET, INSECURE, NOSYNC, HELP, CRON_SCHEDULE, DONT_SHORTEN_PATHS;
let HISTORY_PATH, PLAYLIST_PATH, PROFILE_PATH;
let OUTPUT_FILE, OLD_EXPORT_PATH;
let FIRST_TIME_SETUP = false; // flag to indicate if we should run the first-time setup
// should be global so utils can access it
let FREETUBE_DIR 
let EXPORT_DIR 
// -- Bootstrap & main flow --
/**
 * Resolves a boolean flag from CLI args or config file.
 * meant for boolean args like verbose or dry run
 * @param {string[]} args - CLI arguments (e.g., from process.argv).
 * @param {string[]} aliases - List of CLI flags to check (e.g., ['--dry-run']).
 * @param {object} config - Parsed config object.
 * @param {string} configKey - Key in the config file (e.g., 'dry_run').
 * @param {string} envKey - Key in the environment variables (e.g., 'FT_TO_INV_CONFIG_DRY_RUN').
 * @returns {boolean} - Resolved boolean value.
 */
function resolveFlagArg(args, aliases, config, configKey, envKey) {
  // Check CLI args: if any alias is present, treat as true
  const cliValue = aliases.some(flag => args.includes(flag));
  if (cliValue) return true;
  // If not present in CLI, defer to env then config
  const envVal = resolveEnvVars(envKey);
  if (envVal !== undefined) return sanitizeEnvBoolean(envVal);
  if (config.hasOwnProperty(configKey)) {
    return config[configKey] === true;
  }
  return false; // Default fallback
}
// function to validate cron strings by checking if they has 5 parts, a number or * in each part, or 1 string
function isValidCron(cronString) {
  if (typeof cronString !== 'string') return false; // Add this line
  const parts = cronString.split(' ');
  if (parts.length !== 5) return false;
  return parts.every(part => /^\d+$/.test(part) || part === '*');
}
// see end of utils for why i moved this here
function stripDir(p) {
    if (!p || typeof p !== 'string') return p;
    if (DONT_SHORTEN_PATHS) return p;
    const toUnix = x => x.replaceAll('\\', '/');
    const norm = toUnix(path.resolve(p));
    const ft = toUnix(path.resolve(FREETUBE_DIR));
    const ex = toUnix(path.resolve(EXPORT_DIR));
    if (ft === ex) {
      console.warn('⚠️ Warning: FreeTube directory and export directory are the same, path shortening may be ambiguous.');
    }
    if (norm.startsWith(ft)) return norm.replace(ft, '<FreeTubeDir>');
    if (norm.startsWith(ex)) return norm.replace(ex, '<ExportDir>');
    return norm; 
  }
// Main function to run the export and sync process
async function main() {
  // get the first time setup flag at the top before it's run/skipped
  // the last two params look in the config file, so those should be blank here
  FIRST_TIME_SETUP = resolveFlagArg(args, ['--first-time-setup', '-fts'], {}, '');
  const ENV_CONFIG_PATH = normalizePath(resolveEnvVars(['FT_TO_INV_CONFIG', 'FT_TO_INV_CONFIG_PATH', 'FT_INV_CONFIG', 'CONFIG']));
  // we parse configPath in config.js, but this gets used for checking if it's the first run
  const configPath = normalizePath(getArg('--config')) || normalizePath(getArg('-c')) || ENV_CONFIG_PATH || path.resolve('ft-to-inv.jsonc');
  const exportPath = path.join('./', 'invidious-import.json'); // default export path for first-run check
  const isFirstRun = !fs.existsSync(exportPath) && !fs.existsSync(configPath);
  // Only run setup if truly first time
  let config;
  let dontRunSetup = resolveFlagArg(args, ['--dont-run-setup', '-drs', '--dont-run-first-time-setup'], {}, '');
  if ((isFirstRun && dontRunSetup !== true) || FIRST_TIME_SETUP === true) {
    config = await runFirstTimeSetup();
  } else {
    config = loadConfig();
  }
  // Load/merge CLI args + config file
  // Detect first-run (no config file or no prior export)
  // Assign globals from config
  EXPORT_DIR = normalizePath(getArg('--export-dir')) || normalizePath(getArg('-e')) || normalizePath(resolveEnvVars(['FT_TO_INV_CONFIG_EXPORT_DIR', 'EXPORT_DIR', 'FT_TO_INV_EXPORT_DIR'])) || normalizePath(config.export_dir) ||  normalizePath('.');
  FREETUBE_DIR = normalizePath(getArg('--freetube-dir')) || normalizePath(getArg('-f')) || normalizePath(getArg('-cd')) || normalizePath(resolveEnvVars(['FT_TO_INV_CONFIG_FREETUBE_DIR', 'FREETUBE_DIR', 'FT_TO_INV_FREETUBE_DIR'])) || normalizePath(config.freetube_dir) || getDefaultFreeTubeDir();
  // these files are always those names, not taking args for them
  // if theyre different make a symlink ig
  PROFILE_PATH = path.join(FREETUBE_DIR, 'profiles.db');
  HISTORY_PATH = path.join(FREETUBE_DIR, 'history.db');
  PLAYLIST_PATH = path.join(FREETUBE_DIR, 'playlists.db');
  // this is a mess, if you can think of anything better for this pls open a pr
  TOKEN              = getArg('--token') || getArg('-t')|| resolveEnvVars(['FT_TO_INV_TOKEN', 'TOKEN', 'FT_TO_INV_CONFIG_TOKEN']) || config.token;
  INSTANCE           = getArg('--instance') || getArg('-i') || resolveEnvVars(['FT_TO_INV_INSTANCE', 'INSTANCE', 'FT_TO_INV_CONFIG_INSTANCE']) || config.instance;

  VERBOSE            = resolveFlagArg(args, ['--verbose', '-v'], config, 'verbose', ['FT_TO_INV_CONFIG_VERBOSE', 'VERBOSE', 'FT_TO_INV_VERBOSE'])
  DRY_RUN            = resolveFlagArg(args, ['--dry-run'], config, 'dry_run', ['FT_TO_INV_CONFIG_DRY_RUN', 'DRY_RUN', 'FT_TO_INV_DRY_RUN'])
  QUIET              = resolveFlagArg(args, ['--quiet','-q'], config, 'quiet', ['FT_TO_INV_CONFIG_QUIET', 'QUIET', 'FT_TO_INV_QUIET'])
  INSECURE           = resolveFlagArg(args, ['--insecure'], config, 'insecure', ['FT_TO_INV_CONFIG_INSECURE', 'INSECURE', 'FT_TO_INV_INSECURE'])
  NOSYNC             = resolveFlagArg(args, ['--no-sync'], config, 'no_sync', ['FT_TO_INV_CONFIG_NO_SYNC', 'NOSYNC', 'FT_TO_INV_NOSYNC'])
  DONT_SHORTEN_PATHS = resolveFlagArg(args, ['--dont-shorten-paths'], config, 'dont_shorten_paths', ['FT_TO_INV_CONFIG_DONT_SHORTEN_PATHS', 'DONT_SHORTEN_PATHS', 'FT_TO_INV_DONT_SHORTEN_PATHS'])

  OUTPUT_FILE        = exportPath || path.join(EXPORT_DIR, 'invidious-import.json');
  OLD_EXPORT_PATH    = path.join(EXPORT_DIR, 'import.old.json');
  // -c is for config
  CRON_SCHEDULE      = getArg('--cron-schedule') || getArg('-cron') || getArg('--cron') || resolveEnvVars(['FT_TO_INV_CONFIG_CRON_SCHEDULE', 'CRON_SCHEDULE', 'FT_TO_INV_CRON_SCHEDULE', 'CRON']) || config.cron_schedule || '';

  HELP               = resolveFlagArg(args, ['--help', '-h', '/?', '-?'], config, 'help');
  if (HELP === true) {
   console.log(
    `FreeTube to Invidious Exporter
    Configuration options:
    Argument                                  Explanation
    --token, -t               (required) Your Invidious SID cookie for authentication.
    --token continued          You can usually get a token by going to your instance > Settings/Prefrences > Manage Tokens and pasting the top one in
    --token continued          Warning: Be careful with these, they give full read/write access to your invidious account
    --instance, -i            (optional) Your Invidious instance URL. Defaults to https://invidiou.s
    --freetube-dir, -dir, -cd (optional) Path to FreeTube data directory. Defaults to OS-specific path.
    --freetube-dir continued. On Windows, usually %AppData%\\FreeTube (yourUser/AppData/Roaming/Freetube). On Linux, usually ~/.config/FreeTube. On macOS, usually ~/Library/Application Support/FreeTube
    --export-dir, -e          (optional) Directory to write the export file to. Defaults to FreeTube directory.
    --output-file, -output    (optional) Name of the output file. Defaults to invidious-import.json.
    --cron-schedule, -c       (optional) A cron pattern to run the sync on a schedule. If not provided, runs once and exits.
    --dry-run, -d             (optional) Run the script without making any changes to Invidious or the output file.
    --verbose, -v             (optional) Enable verbose logging.
    --no-sync, -n             (optional) Skip the sync to Invidious step, just export the file. Intended for cases where you want to bring the export file to invidious yourself or can't use the API
    --help, -h, /?, -?        Show this help message.
    --use-system-ca           (optional) Pass this flag to node (node --use-system-ca export.js ...) to trust system CAs, useful for self-hosted instances with custom certs. See below.
    --quiet, -q               (optional) Suppress non-error console output.
    --dont-shorten-paths      (optional) Don't show shortend paths for files like the export file, by default it shows things like <FreeTubeDir>/invidious-import.json
        continued             instead of C:/Users/You/AppData/Roaming/FreeTube/invidious-import.json
                   Usage:
    run once: node --use-system-ca export.js --token YOUR_INVIDIOUS_SID_COOKIE [other options]
    cron job: node --use-system-ca export.js --token YOUR_INVIDIOUS_SID_COOKIE --cron-schedule "*/30 * * * *" [other options]
    # cron job above runs every 30 minutes, see https://crontab.guru/ for help with cron patterns.
    Note: If you self-host Invidious with a custom TLS certificate, make sure to run with --use-system-ca.
    If you're on linux, node doesn't support --use-system-ca, but trust the system store by default.
    If you get TLS errors, try setting NODE_EXTRA_CA_CERTS=/path/to/your/rootCA.crt
    You can also copy your self-signed cert to /usr/local/share/ca-certificates/ and run sudo update-ca-certificates
     ENVIRONMENT VARIABLES:
     - FT_TO_INV_CONFIG_TOKEN: Your Invidious SID cookie for authentication.
     - FT_TO_INV_CONFIG_INSTANCE: Your Invidious instance URL.
     - FT_TO_INV_CONFIG_FREETUBE_DIR: Path to FreeTube data directory.
     - FT_TO_INV_CONFIG_EXPORT_DIR: Directory to write the export file to.
     - FT_TO_INV_CONFIG_OUTPUT_FILE: Name of the output file.
     - FT_TO_INV_CONFIG_CRON_SCHEDULE: A cron pattern to run the sync on a schedule.
     - FT_TO_INV_CONFIG_DRY_RUN: Run the script without making any changes.
     - FT_TO_INV_CONFIG_VERBOSE: Enable verbose logging.
     - FT_TO_INV_CONFIG_NO_SYNC: Skip the sync to Invidious step.
     - FT_TO_INV_CONFIG_QUIET: Suppress non-error console output.
     - FT_TO_INV_CONFIG_DONT_SHORTEN_PATHS: Don't show shortened paths for files.
     How they work:
     The environment variables are 2nd order in runtime config, so the order looks like this
     CLI ARGS > ENVIRONMENT VARIABLES > CONFIG (defaults)
     Any of the config options have an environment variable equivalent, and they all start with FT_TO_INV_CONFIG_.
     Here's an example:
     FT_TO_INV_CONFIG_TOKEN=abc123

     `
  )
  process.exit(0);
  }
  // Validate required files
  for (const f of [HISTORY_PATH, PLAYLIST_PATH, PROFILE_PATH]) {
    if (!fs.existsSync(f)) {
      console.log(HISTORY_PATH, PLAYLIST_PATH, PROFILE_PATH, EXPORT_DIR, OLD_EXPORT_PATH, FREETUBE_DIR, '(logged for debugging)');
      console.error(`❌ Required file missing: ${f}`);
      process.exit(1);
    }
  }
  if (!TOKEN && !DRY_RUN && !NOSYNC) {
    console.error('❌ No token specified.');
    process.exit(1);
  }
  if (VERBOSE) {
    console.log('🌐 Instance:', INSTANCE);
    console.log('📂 Paths:');
    console.log(`   FreeTube data directory: ${FREETUBE_DIR}`);
    console.log(`   Export directory: ${EXPORT_DIR}`);
    console.log(`   History: ${stripDir(HISTORY_PATH)}`);
    console.log(`   Playlists: ${stripDir(PLAYLIST_PATH)}`);
    console.log(`   Profiles: ${stripDir(PROFILE_PATH)}`);
    console.log(`   Export → ${stripDir(OUTPUT_FILE)}`);
    console.log(`   Old export → ${stripDir(OLD_EXPORT_PATH)}`);
  }

  // Now call sync
  await sync();
}
function certErrorHint(err) {
  const message = String(err).toLowerCase();
      // node errors like UNABLE_TO_VERIFY_LEAF_SIGNATURE don't get included in the error object, this is all we get, but the full error is in the console
      // error: unable to verify the first certificate; if the root ca is installed locally, try running node.js with --use-system-ca
      if (message.includes("unable to verify the first certificate")) {
      console.error('⚠️ This may be due to an invalid or self-signed certificate. Try running with --use-system-ca or setting the NODE_EXTRA_CA_CERTS environment variable.');
      }
      else return;
    }
// === sync logic ===
async function sync() {
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
  const safeOldPlaylists = (old.playlists || []).filter(
  op => op && typeof op.title === 'string' && Array.isArray(op.videos)
);
const safeNewPlaylists = (output.playlists || []).filter(
  p => p && typeof p.title === 'string' && Array.isArray(p.videos)
);
const newPlaylists = safeNewPlaylists.filter(
  p => !safeOldPlaylists.some(
    op => op.title === p.title && JSON.stringify(op.videos) === JSON.stringify(p.videos)
  )
);
const removedPlaylists = safeOldPlaylists.filter(
  op => !safeNewPlaylists.some(p => p.title === op.title)
);
    const newHistory = output.watch_history.filter(id => !old.watch_history.includes(id));
    const newSubs = output.subscriptions.filter(id => !old.subscriptions.includes(id));

    const removedHistory = old.watch_history.filter(id => !output.watch_history.includes(id));
    const removedSubs = old.subscriptions.filter(id => !output.subscriptions.includes(id));

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
        console.log(`Found ${removedHistory.length} video${removedHistory.length !== 1 ? 's' : ''} to remove from watch history`);
      }
      if (removedSubs.length) {
        console.log(`Found ${removedSubs.length} channel${removedSubs.length !== 1 ? 's' : ''} to unsubscribe from`);
      }
      if (removedPlaylists.length) {
        console.log(`Found ${removedPlaylists.length} playlist${removedPlaylists.length !== 1 ? 's' : ''} to delete`);
      }
    }

    let hadErrors = false;
    const markError = (label, error) => {
      hadErrors = true;
      console.error(`❌ ${label}:`, error);
      certErrorHint(error);
    };
    if (!NOSYNC) {
      if (newSubs.length === 0 && newHistory.length === 0 && newPlaylists.length === 0 && removedHistory.length === 0 && removedSubs.length === 0 && removedPlaylists.length === 0) {
        console.log('ℹ️ No changes to sync, not updating Invidious or export files');
        return;
      }
      if (newHistory.length) {
      for (const videoId of newHistory) {
       try {
       console.log(videoId)
       const res = await postToInvidious(`/auth/history/${videoId}`, {}, TOKEN, INSTANCE, INSECURE);
       if (!QUIET) {
       console.log(`✅ Marked ${videoId} as watched (HTTP ${res.code})`);
       }
      }
      catch (err) {
        markError('Failed to sync watch history', err);
      }
    }
  }
    for (const sub of newSubs) {
      try {
        const res = await postToInvidious(`/auth/subscriptions/${sub}`, {}, TOKEN, INSTANCE, INSECURE);
        const name = await getChannelName(sub, INSTANCE);
        if (!QUIET) {
          console.log(`📺 Subscribed to ${name} (${sub}) with HTTP ${res.code}`);
        }
        } catch (err) {
        markError(`Failed to subscribe to ${sub}`, err);
      }
    }
 const playlistsToImport = [];
// console.log(`found ${pl} and ${pl.title}`)
const oldPlaylistTitles = new Set(
  (old.playlists || [])
    .filter(pl => pl && typeof pl.title === 'string' && pl.title.trim() !== '')
    .map(pl => pl.title.toLowerCase())
);

try {
for (const pl of newPlaylists) {
  if (!pl || typeof pl.title !== 'string') {
    console.warn(`⚠️ Skipping invalid playlist entry: ${JSON.stringify(pl)}`);
    continue;
  }
  console.log(`ℹ️ Found new playlist: "${pl.title}"`);
  if (oldPlaylistTitles.has(pl.title.toLowerCase())) {
    console.log(`ℹ️ Skipping existing playlist: "${pl.title}"`);
    continue;
  }
  // Add to playlist import structure
  playlistsToImport.push({
    title: pl.title,
    description: pl.description,
    privacy: pl.privacy ?? 'Private',
    videos: pl.videos
  });
  console.log(`🎵 Queued playlist "${pl.title}" for import, \n you will need to import it manually into Invidious. \n Head to Settings > Import/Export > Import Invidious JSON data and select the generated playlist-import.json file.`);

}
if (playlistsToImport.length > 0) {
  const importPath = './playlist-import.json';
  writePlaylistImport(playlistsToImport, importPath);
  console.log(`📤 Wrote ${playlistsToImport.length} playlists to ${importPath}`);
} else {
  console.log(`✅ No new playlists to import`);
}
} catch (err) {
  markError('Failed to prepare playlist import', err);
}   
// Remove watched videos
    if (removedHistory.length) {
     for (const videoId of removedHistory) {
      try {
      const res = await postToInvidious(`/auth/history/${videoId}`, null, TOKEN, INSTANCE, INSECURE, 'DELETE');
      if (!QUIET) {
      console.log(`🗑️ Removed ${videoId} from watch history (HTTP ${res.code})`);
      }
     } catch (err) {
       markError('Failed to remove from watch history', err);
      }
    }
  }
    // Unsubscribe from channels
    for (const ucid of removedSubs) {
     try {
      const res = await postToInvidious(`/auth/subscriptions/${ucid}`, null, TOKEN, INSTANCE, INSECURE, 'DELETE');
      if (!QUIET) {
       console.log(`👋 Unsubscribed from ${ucid} (HTTP ${res.code})`);
      }
      } catch (err) {
       markError(`Failed to unsubscribe from ${ucid}`, err);
     }
    }

    // Delete playlists
// Remove deleted playlists from playlist-import.json
const importPath = './playlist-import.json';
if (removedPlaylists.length > 0 && fs.existsSync(importPath)) {
  try {
    const importData = JSON.parse(fs.readFileSync(importPath, 'utf-8'));
    
    // Filter out any playlists matching removed titles (case-insensitive)
    importData.playlists = importData.playlists.filter(pl =>
      !removedPlaylists.some(rp => rp.title.toLowerCase() === pl.title.toLowerCase())
    );

    fs.writeFileSync(importPath, JSON.stringify(importData, null, 2));
    console.log(`🗑️ Removed ${removedPlaylists.length} playlists from ${importPath}`);
  } catch (err) {
    markError(`Failed to update ${importPath} after removals`, err);
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
      noSyncWrite(output, OUTPUT_FILE, QUIET);
      }
    else {
      console.warn('⚠️ Some sync operations failed. Export not saved. Run with -v or --verbose for details.');
    }
  }
}
// Kick off
main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
let validCron = isValidCron(CRON_SCHEDULE);
if (typeof CRON_SCHEDULE !== 'string' || CRON_SCHEDULE.trim() === '' && CRON_SCHEDULE.length < 4  || validCron !== true) {
  // silently fail because the user might not have set a cron schedule
  return;
} else {
  console.log(`⏰ Scheduling sync with cron pattern: ${CRON_SCHEDULE}`);
  // run once
  // runs below main() so we shouldn't call it here, just tell the user
  console.log('✅ Initial sync complete, now scheduling recurring job...');
  // run on interval
  cron.schedule(CRON_SCHEDULE, () => {
    console.log(`🔄 Running scheduled sync at ${new Date().toLocaleString()}`);
    main().catch(err => {
      console.error('❌ Fatal error:', err);
      process.exit(1);
    });
  });
}
