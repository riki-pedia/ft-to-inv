#!/usr/bin/env node

// === export.js ===
// Main CLI entrypoint: bootstraps config, sets up paths, then runs sync()
const fs = require('fs');
const path = require('path');
const { loadConfig, runFirstTimeSetup, getDefaultFreeTubeDir, normalizePath } = require('./config');
const {
  loadNDJSON,
  extractSubscriptions,
  readOldExport,
  writeNewExport,
  noSyncWrite,
  postToInvidious,
  getChannelName
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
 * @returns {boolean} - Resolved boolean value.
 */
function resolveFlagArg(args, aliases, config, configKey) {
  // Check CLI args: if any alias is present, treat as true
  const cliValue = aliases.some(flag => args.includes(flag));
  if (cliValue) return true;
  // If not present in CLI, defer to config file value
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
    if (norm.startsWith(ft)) return norm.replace(ft, '<FreeTubeDir>');
    if (norm.startsWith(ex)) return norm.replace(ex, '<ExportDir>');
    return norm; 
  }
// Main function to run the export and sync process
async function main() {
  // get the first time setup flag at the top before it's run/skipped
  // the last two params look in the config file, so those should be blank here
  FIRST_TIME_SETUP = resolveFlagArg(args, ['--first-time-setup', '-fts'], {}, '');
  const ENV_CONFIG_PATH = process.env.FT_TO_INV_CONFIG || process.env.FT_TO_INV_CONFIG_PATH || process.env.FT_INV_CONFIG || process.env.CONFIG;
  // we parse configPath in config.js, but this gets used for checking if it's the first run
  const configPath = getArg('--config') || getArg('-c') || ENV_CONFIG_PATH || path.resolve('ft-to-inv.jsonc');
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
  EXPORT_DIR = normalizePath(getArg('--export-dir')) || normalizePath(getArg('-e')) || normalizePath(config.export_dir) || normalizePath('.');
  FREETUBE_DIR = normalizePath(getArg('--freetube-dir')) || normalizePath(getArg('-f')) || normalizePath(getArg('-cd')) || normalizePath(config.freetube_dir) || getDefaultFreeTubeDir();
  // these files are always those names, not taking args for them
  PROFILE_PATH = path.join(FREETUBE_DIR, 'profiles.db');
  HISTORY_PATH = path.join(FREETUBE_DIR, 'history.db');
  PLAYLIST_PATH = path.join(FREETUBE_DIR, 'playlists.db');
  // strings in cli, not boolean flags
  TOKEN              = getArg('--token') || getArg('-t')|| config.token;
  INSTANCE           = getArg('--instance') || getArg('-i') || config.instance;

  VERBOSE            = resolveFlagArg(args, ['--verbose', '-v'], config, 'verbose')
  DRY_RUN            = resolveFlagArg(args, ['--dry-run'], config, 'dry_run')
  QUIET              = resolveFlagArg(args, ['--quiet','-q'], config, 'quiet');
  INSECURE           = resolveFlagArg(args, ['--insecure'], config, 'insecure');
  NOSYNC             = resolveFlagArg(args, ['--no-sync'], config, 'no_sync');
  DONT_SHORTEN_PATHS = resolveFlagArg(args, ['--dont-shorten-paths'], config, 'dont_shorten_paths');

  OUTPUT_FILE        = exportPath || path.join(EXPORT_DIR, 'invidious-import.json');
  OLD_EXPORT_PATH    = path.join(EXPORT_DIR, 'import.old.json');
  // -c is for config
  CRON_SCHEDULE      = getArg('--cron-schedule') || getArg('-cron') || getArg('--cron') || config.cron_schedule || '';

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
    You can also copy your self-signed cert to /usr/local/share/ca-certificates/ and run sudo update-ca-certificates`
  )
  process.exit(0);
  }
  // Validate required files
  for (const f of [HISTORY_PATH, PLAYLIST_PATH, PROFILE_PATH]) {
    if (!fs.existsSync(f)) {
      console.log(HISTORY_PATH, PLAYLIST_PATH, PROFILE_PATH, EXPORT_DIR, OLD_EXPORT_PATH, FREETUBE_DIR);
      console.error(`❌ Required file missing: ${f}`);
      process.exit(1);
    }
  }

  if (!TOKEN && !DRY_RUN) {
    console.error('❌ No token specified.');
    process.exit(1);
  }
  if (VERBOSE) {
    console.log('🌐 Instance:', INSTANCE);
    console.log('📂 Paths:');
    console.log(`   FreeTube data directory: ${FREETUBE_DIR}, ${config.freetube_dir}, ${EXPORT_DIR}`);
    console.log(`   Export directory: ${EXPORT_DIR}, ${config.freetube_dir}, ${EXPORT_DIR}`);
    console.log(`   History: ${stripDir(HISTORY_PATH)}`);
    console.log(`   Playlists: ${stripDir(PLAYLIST_PATH)}`);
    console.log(`   Profiles: ${stripDir(PROFILE_PATH)}`);
    console.log(`   Export → ${stripDir(OUTPUT_FILE)}`);
    console.log(`   Old export → ${stripDir(OLD_EXPORT_PATH)}`);
  }// stripDir only takes one arg

  // Now call sync
  await sync();
}

// === sync logic ===
async function sync() {
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
    const markError = (label, error) => {
      hadErrors = true;
      console.error(`❌ ${label}:`, error);
      const message = String(error).toLowerCase();
      // node errors like UNABLE_TO_VERIFY_LEAF_SIGNATURE don't get included in the error object, this is all we get, but the full error is in the console
      // error: unable to verify the first certificate; if the root ca is installed locally, try running node.js with --use-system-ca
      if (message.includes("unable to verify the first certificate")) {
      console.error('⚠️ This may be due to an invalid or self-signed certificate. Try running with --use-system-ca or setting the NODE_EXTRA_CA_CERTS environment variable.');
      }
    };
    if (!NOSYNC) {
      if (newSubs.length === 0 && newHistory.length === 0 && newPlaylists.length === 0 && removedHistory.length === 0 && removedSubs.length === 0 && removedPlaylists.length === 0) {
        console.log('ℹ️ No changes to sync, not updating Invidious or export files');
        return;
      }
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
