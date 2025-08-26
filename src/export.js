#!/usr/bin/env node
// main entrypoint, parses cli args and starts sync
// the command to run this is not that pretty
// node [--use-system-ca] export.js [flags]
// not gonna talk about use system ca, see help or config
// gets values in this order:
// cli args > env > config
// you can preface env with FT_INV_CONFIG_OPTION, where option is the cli flag you want to pass
// for example: set FT_TO_INV_CONFIG_INSTANCE=https://invidous.example.com sets the instance flag to be https://invidious.example.com
// THIS FILES 975 LINES WHAT HAVE I DONE
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';
import {
   loadConfig,
   runFirstTimeSetup,
   getDefaultFreeTubeDir,
   normalizePath,
   getEnv,
   prompt 
} from './config.js';
import { 
  loadNDJSON, 
  extractSubscriptions, 
  readOldExport, 
  writeNewExport, 
  noSyncWrite, 
  postToInvidious, 
  getChannelName, 
  writePlaylistImport, 
  getVideoNameAndAuthor,
  setConfig,
  retryPostRequest,  
} from './utils.js';
import { resolveConfig } from './args.js';
// to lazy to rename all the logs back from Clog right now, this will do
import { logConsoleOutput, log } from './logs.js'
import cron from 'node-cron';
import { clearFiles } from './clear-import-files.js';
import hints from './hints.json' with { type: 'json' } 
import { sanitize } from './sanitize.js';

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
      resolved = value;
      break; // Stop at the first found environment variable
    }
  }
  return resolved;
}
function sanitizeEnvBoolean(value) {
    if (value === null || value === undefined) {
        return false;
    }  
    if (typeof value === 'boolean') {
        return true;
    }
    if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
    }
    if (typeof value === 'number') {
        if (value !== 0) {
            return true;
        }
    }
    return false;
}
/// just tracks what args we should get, then warns if there's one shouldn't be there
const expectedArgs = {
  "TOKEN":              "--token, -t",
  "INSTANCE":           "--instance, -i",
  "VERBOSE":            "--verbose, -v",
  "DRY_RUN":            "--dry-run",
  "QUIET":              "--quiet, -q",
  "INSECURE":           "--insecure, --http",
  "NOSYNC":             "--no-sync",
  "HELP":               "--help, -h, -?, /?",
  "CRON_SCHEDULE":      "--cron-schedule, -cron, --cron",
  "DONT_SHORTEN_PATHS": "--dont-shorten-paths",
  "FIRST_TIME_SETUP":   "--first-time-setup, -fts",
  "DONT_RUN_SETUP":     "--dont-run-setup, -drs",
  "EXPORT_DIR":         "--export-dir, -e",
  "FREETUBE_DIR":       "--freetube-dir, -f, -cd",
  "RUN_FIRST_TIME_SETUP": "--run-first-time-setup, --first-time-setup, -fts",
  "DONT_RUN_FIRST_TIME_SETUP": "--dont-run-first-time-setup, --dont-run-setup, -drs",
  "CONFIG":             "--config, -c",
  "LOGS":               "--logs, -l",
  "HISTORY":            "--history, --dont-include-history, -hi",
  "PLAYLISTS":          "--playlists, --dont-include-playlists, -p",
  "SUBSCRIPTIONS":      "--subscriptions, --dont-include-subscriptions, -s"
}
// list of args that should reasonably have values, like -t <value>
const flagsExpectingValue = [
  '--token', '-t',
  '--config', '-c',
  '--export-dir', '-e',
  '--freetube-dir', '-f', '-cd',
  '--cron-schedule', '-cron',
  '--instance', '-i'
]
const validShortFlags = [
  '-t', '-c', '-e', '-f', '-cd', '-cron', '-i', '-fts', '-drs', '-h', '-?', '-q', '-v', '-p', '-hi', '-s', '-l'
]
const validPosArgs = [
  'token', 'help', 'instance', 'verbose', 'dry-run', 'quiet', 'insecure', 'no-sync', 'export-dir', 'freetube-dir', 'cron-schedule', 'dont-shorten-paths', 'first-time-setup', 'dont-run-setup', 'config', 'logs', 'history', 'playlists', 'subscriptions', 'test'
]
const posArgsExpectingValue = [
  'token', 'instance', 'export-dir', 'freetube-dir', 'cron-schedule', 'config', 'help', 
]
// gets args param from something like process.argv and checks it against expectedArgs
// if its not expected, we exit early with an error
async function isExpectedArg(argList = args) {
  const flatExpected = Object.values(expectedArgs)
    .flatMap(e => e.split(',').map(s => s.trim()));

  let lastWasValueFlag = false;
  const skip = new Set(); // indices of args we want to ignore (values/cron parts)

  for (let i = 0; i < argList.length; i++) {
    if (skip.has(i)) continue;

    const a = argList[i];

    if (lastWasValueFlag) {
      lastWasValueFlag = false;
      continue;
    }

    if (a.startsWith('--cron') || a.startsWith('-cron') || a.startsWith('--cron-schedule')) {
      // ignore the next 5 cron parts if they look like *, numbers, or step/intervals
      for (let j = 1; j <= 5; j++) {
        const nextArg = argList[i + j];
        if (nextArg && /^(\*|\d+|\*\/\d+|\d+-\d+)$/.test(nextArg)) {
          skip.add(i + j);
        }
      }
    }

    if (a.startsWith('--')) {
      const eqIndex = a.indexOf('=');
      const cleanArg = eqIndex !== -1 ? a.substring(0, eqIndex) : a;
      if (!flatExpected.includes(cleanArg)) {
        console.error(`❌ Unknown argument: ${cleanArg}`);
        process.exit(1);
      }
      if (flagsExpectingValue.includes(cleanArg)) {
        // only mark next if value not inline (--opt=val)
        if (eqIndex === -1 && argList[i + 1]) skip.add(i + 1);
      }
    }
    else if (a.startsWith('-') && a.length > 1) {
      if (validShortFlags.includes(a)) {
        if (flagsExpectingValue.includes(a)) {
          if (argList[i + 1]) skip.add(i + 1);
        }
      } else {
        // treat as combined single-letter flags: -vd
        const shortArgs = a.slice(1).split('');
        for (const sa of shortArgs) {
          const cleanArg = `-${sa}`;
          if (!flatExpected.includes(cleanArg)) {
            console.error(`❌ Unknown argument: ${cleanArg}`);
            process.exit(1);
          }
          if (flagsExpectingValue.includes(cleanArg)) {
            if (argList[i + 1]) skip.add(i + 1);
          }
        }
      }
    }
    else if (validPosArgs.includes(a)) {
        if (posArgsExpectingValue.includes(a)) {
          if (argList[i + 1]) skip.add(i + 1);
        }
        else {
          skip.add(i); // standalone positional arg, no value expected
        }
      }
    else {
      console.error(`❌ Unexpected positional argument: ${a}`);
      //process.exit(1);
    }
  }

  return true;
}

let warn = true;
let error = true;
const consoleOutput = []

// -- Globals (to be assigned in bootstrap) --
let TOKEN, INSTANCE, VERBOSE, DRY_RUN, QUIET, INSECURE, NOSYNC, HELP, CRON_SCHEDULE, DONT_SHORTEN_PATHS, HELPCMD;
let HISTORY_PATH, PLAYLIST_PATH, PROFILE_PATH;
let OUTPUT_FILE, OLD_EXPORT_PATH;
let FIRST_TIME_SETUP = false; // flag to indicate if we should run the first-time setup
let LOGS_BOOLEAN, LOGS

let PLAYLISTS, HISTORY, SUBS

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
 * @param {string[]} envKey - Key in the environment variables (e.g., 'FT_TO_INV_CONFIG_DRY_RUN').
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
async function isValidCron(cronString) {
  try {
   return cron.validate(cronString);
  } catch (err) {
    return false;
  }
}
// see end of utils for why i moved this here
function stripDir(p) {
    if (!p || typeof p !== 'string') return p;
    if (DONT_SHORTEN_PATHS) return p;
    const toUnix = x => x.replaceAll('\\', '/');
    const norm = toUnix(resolve(p));
    const ft = toUnix(resolve(FREETUBE_DIR));
    const ex = toUnix(resolve(EXPORT_DIR));
    if (ft === ex) {
      log('⚠️ Warning: FreeTube directory and export directory are the same, path shortening may be ambiguous.', { err: 'warning' });
    }
    if (norm.startsWith(ft)) return norm.replace(ft, '<FreeTubeDir>');
    if (norm.startsWith(ex)) return norm.replace(ex, '<ExportDir>');
    return norm; 
  }
function getRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min)) + min;
}
function startHints() {
  function scheduleNextHint() {
    const delay = getRandomInt(10_000, 60_000); // 10s–1m
    setTimeout(() => {
      // note: cant be hints.length + 1 because that returns NaN. ill have to update this manually as i add more hints :/
      const hintNumber = getRandomInt(1, 76);
      log(`💡 ${hints[hintNumber === 76 ? 75 : hintNumber]}`);
      scheduleNextHint(); // queue another
    }, delay);
  }

  scheduleNextHint(); // kick off the loop
}

let timesShown = 0;
async function maybeSchedule() {
let validCron = await isValidCron(CRON_SCHEDULE);
if (typeof CRON_SCHEDULE !== 'string' || CRON_SCHEDULE.trim() === ''  || validCron !== true) {
  // silently fail because the user might not have set a cron schedule
  return;
} else {
  if (timesShown === 0) {
  console.log(`⏰ Scheduling sync with cron pattern: ${CRON_SCHEDULE}`);
  console.log('Press Ctrl+C to exit');
  log('Logs will only be saved for the initial run.', { err: 'warning' });
  timesShown++;
}
  // run once
  // runs below main() so we shouldn't call it here, just tell the user
  log('✅ Initial sync complete, now scheduling recurring job...');
  startHints();
  // run on interval
  cron.schedule(CRON_SCHEDULE, async () => {
    log(`🔄 Running scheduled sync at ${new Date().toLocaleString()}`);
   await main().catch(err => {
      log(`❌ Fatal error: ${err}`, { err: 'error' });
      process.exit(1);
    });
  });
}
}

// Main function to run the export and sync process
async function main() {
  // get the first time setup flag at the top before it's run/skipped
  // the last two params look in the config file, so those should be blank here
  FIRST_TIME_SETUP = resolveFlagArg(args, ['--first-time-setup', '-fts', '--run-first-time-setup'], {}, '', ['FT_TO_INV_CONFIG_FIRST_TIME_SETUP', 'FIRST_TIME_SETUP', 'FT_TO_INV_FIRST_TIME_SETUP', 'FTS']);
  const ENV_CONFIG_PATH = normalizePath(resolveEnvVars(['FT_TO_INV_CONFIG', 'FT_TO_INV_CONFIG_PATH', 'FT_INV_CONFIG', 'CONFIG']));
  // we parse configPath in config.js, but this gets used for checking if it's the first run
  const configPath = normalizePath(getArg('--config')) || normalizePath(getArg('-c')) || ENV_CONFIG_PATH || resolve('ft-to-inv.jsonc');
  const exportPath = join('./', 'invidious-import.json'); // default export path for first-run check
  let isFirstRun = false;
  if (!existsSync(configPath)) {
    isFirstRun = true;
  }
  // Only run setup if truly first time
  let config;
  let dontRunSetup = resolveFlagArg(args, ['--dont-run-setup', '-drs', '--dont-run-first-time-setup'], {}, '', ['DONT_RUN_SETUP', 'FT_TO_INV_CONFIG_DONT_RUN_SETUP', 'FT_TO_INV_CONFIG_DONT_RUN_FIRST_TIME_SETUP', 'FT_TO_INV_DRS', 'DRS']);
  if (dontRunSetup === true) {
    console.warn('⚠️ Warning: Skipping setup due to setting DONT_RUN_SETUP');
  }
  if ((isFirstRun && dontRunSetup !== true) || FIRST_TIME_SETUP === true) {
    config = await runFirstTimeSetup();
  } else {
    config = loadConfig(configPath);
  }
  await setConfig(config);
const clearFilesFlag = resolveFlagArg(args, ['--clear', '--clear-files', '--delete-files'], {}, null)
const clearConfigFlag = resolveFlagArg(args, ['--clear-config'], {}, null)
if (clearFilesFlag === true || clearConfigFlag === true) {
  clearFiles(clearConfigFlag);
  // exit early to prevent trying to sync with no files or config
  return
}
  // Load/merge CLI args + config file
  // Detect first-run (no config file or no prior export)
  // Assign globals from config
  EXPORT_DIR = await resolveConfig('export_dir', {
    cliNames: ['--export-dir', '-e'], 
    envNames: ['FT_TO_INV_CONFIG_EXPORT_DIR', 'EXPORT_DIR', 'FT_TO_INV_EXPORT_DIR'],
    config: config,
    args: args,
    fallback: resolve('.')
  }
  )
  FREETUBE_DIR = await resolveConfig('freetube_dir', {
      cliNames: ['--freetube-dir', '-f', '-cd'],
      envNames: ['FT_TO_INV_CONFIG_FREETUBE_DIR', 'FREETUBE_DIR', 'FT_TO_INV_FREETUBE_DIR'],
      config: config,
      args: args,
      fallback: getDefaultFreeTubeDir()
      }
     )
  // these files are always those names, not taking args for them
  // if theyre different make a symlink ig
  PROFILE_PATH = join(FREETUBE_DIR, 'profiles.db');
  HISTORY_PATH = join(FREETUBE_DIR, 'history.db');
  PLAYLIST_PATH = join(FREETUBE_DIR, 'playlists.db');
  // this looks trash, if you can make this better please do
  // also if you find a comment that i forgot to delete, specifically ones that say the flags while i transfer, pls open a pr to fix
  TOKEN = await resolveConfig('token', {
    cliNames: ['--token', '-t'],
    envNames: ['FT_TO_INV_CONFIG_TOKEN', 'FT_TO_INV_TOKEN', 'TOKEN'],
    config: config,
    args: args,
  });
  INSTANCE = await resolveConfig('instance', {
    cliNames: ['--instance', '-i'],
    envNames: ['FT_TO_INV_CONFIG_INSTANCE', 'INSTANCE', 'FT_TO_INV_INSTANCE'],
    config: config,
    args: args,
    fallback: 'https://invidious.example.com'
  })
  VERBOSE = await resolveConfig('verbose', {
    cliNames: ['--verbose', '-v'],
    envNames: ['FT_TO_INV_CONFIG_VERBOSE', 'VERBOSE', 'FT_TO_INV_VERBOSE'],
    config: config,
    args: args,
    isFlag: true
  }
)
  DRY_RUN = await resolveConfig('dry_run', {
    cliNames: ['--dry-run'],
    envNames: ['FT_TO_INV_CONFIG_DRY_RUN', 'DRY_RUN', 'FT_TO_INV_DRY_RUN'],
    config: config,
    args: args,
    isFlag: true
  }
)
  // --quiet, -q, config.quiet, FT_TO_INV_CONFIG_QUIET, QUIET, FT_TO_INV_QUIET
  QUIET = await resolveConfig('quiet', {
    cliNames: ['--quiet', '-q'],
    envNames: ['FT_TO_INV_CONFIG_QUIET', 'QUIET', 'FT_TO_INV_QUIET'],
    config: config,
    args: args,
    isFlag: true
  }
)
  INSECURE = await resolveConfig('insecure', {
    cliNames: ['--insecure', '--http'],
    envNames: ['FT_TO_INV_CONFIG_INSECURE', 'INSECURE', 'FT_TO_INV_INSECURE'],
    config: config,
    args: args,
    isFlag: true
  })
  NOSYNC = await resolveConfig('no_sync', {
    cliNames: ['--no-sync'],
    envNames: ['FT_TO_INV_CONFIG_NO_SYNC', 'NOSYNC', 'FT_TO_INV_NOSYNC'],
    config: config,
    args: args,
    isFlag: true
  })
  // --dont-shorten-paths, config.dont_shorten_paths, FT_TO_INV_CONFIG_DONT_SHORTEN_PATHS, DONT_SHORTEN_PATHS, FT_TO_INV_DONT_SHORTEN_PATHS
  DONT_SHORTEN_PATHS = await resolveConfig('dont_shorten_paths', {
    cliNames: ['--dont-shorten-paths'],
    envNames: ['FT_TO_INV_CONFIG_DONT_SHORTEN_PATHS', 'DONT_SHORTEN_PATHS', 'FT_TO_INV_DONT_SHORTEN_PATHS'],
    config: config,
    args: args,
    isFlag: true
  })

  PLAYLISTS  = await resolveConfig('playlists', {
    cliNames: ['--playlists', '--dont-include-playlists', '-p'],
    envNames: ['FT_TO_INV_CONFIG_PLAYLISTS', 'PLAYLISTS', 'FT_TO_INV_PLAYLISTS'],
    config: config,
    args: args,
    isFlag: true
  })
  HISTORY = await resolveConfig('history', {
    cliNames: ['--history', '--dont-include-history', '-hi'],
    envNames: ['FT_TO_INV_CONFIG_HISTORY', 'HISTORY', 'FT_TO_INV_HISTORY'],
    config: config,
    args: args,
    isFlag: true
  })
  SUBS = await resolveConfig('subscriptions', {
    cliNames: ['--subscriptions', '--dont-include-subs', '-s'],
    envNames: ['FT_TO_INV_CONFIG_SUBS', 'SUBS', 'FT_TO_INV_SUBS'],
    config: config,
    args: args,
    isFlag: true
  })

  OUTPUT_FILE        = exportPath || join(EXPORT_DIR, 'invidious-import.json');
  OLD_EXPORT_PATH    = join(EXPORT_DIR, 'import.old.json');
  CRON_SCHEDULE = await resolveConfig('cron_schedule', {
    cliNames: ['--cron-schedule', '-cron', '--cron'],
    envNames: ['FT_TO_INV_CONFIG_CRON_SCHEDULE', 'CRON_SCHEDULE', 'FT_TO_INV_CRON_SCHEDULE', 'CRON'],
    config: config,
    args: args,
    fallback: ''
  }) || '';

  LOGS_BOOLEAN       = await resolveConfig('logs', {
     cliNames: ['--logs', '-l'],
     envNames: ['FT_TO_INV_CONFIG_LOGS', 'LOGS', 'FT_TO_INV_LOGS'],
     config: config,
     args: args,
     isFlag: true
  })
  LOGS               = LOGS_BOOLEAN ? resolve('ft-to-inv-' + Date.now() + '.log') : undefined;
  // intended for cases like `ft-to-inv help instance`
  HELPCMD            = await resolveConfig('help', {
     config: config,
     args: args,
     isFlag: false,
     positionalArg: 'help',
     fallback: undefined
  });
   sanitize({
    token: TOKEN,
    instance: INSTANCE,
    export_dir: EXPORT_DIR,
    freetube_dir: FREETUBE_DIR,
    cron: CRON_SCHEDULE
   },
   {
    token: true,
    instance: true,
    export_dir: true,
    freetube_dir: true,
    cron: true
   })
  // leaving this one, exits early
  HELP               = resolveFlagArg(args, ['--help', '-h', '/?', '-?'], config, 'help');
  if (HELP === true) {
   console.log(
    `FreeTube to Invidious Exporter
    Configuration options:
    Argument                                  Explanation
    --token, -t               (required) Your Invidious SID cookie for authentication.
    --token continued          You can usually get a token by going to your instance > Settings/Prefrences > Manage Tokens and pasting the top one in
    --token continued          Warning: Be careful with these, they give full read/write access to your invidious account
    --instance, -i            (optional) Your Invidious instance URL. Defaults to https://invidious.example.com, you should change it
    --freetube-dir, -dir, -cd (optional) Path to FreeTube data directory. Defaults to OS-specific path.
    --freetube-dir continued. On Windows, usually %AppData%\\FreeTube (yourUser/AppData/Roaming/Freetube). On Linux, usually ~/.config/FreeTube. On macOS, usually ~/Library/Application Support/FreeTube
    --export-dir, -e          (optional) Directory to write the export file to. Defaults to FreeTube directory.
    --cron-schedule, -c       (optional) A cron pattern to run the sync on a schedule. If not provided, runs once and exits.
    --dry-run, -d             (optional) Run the script without making any changes to Invidious or the output file.
    --verbose, -v             (optional) Enable verbose logging.
    --no-sync, -n             (optional) Skip the sync to Invidious step, just export the file. Intended for cases where you want to bring the export file to invidious yourself or can't use the API
    --help, -h, /?, -?        Show this help message.
    --use-system-ca           (optional) Pass this flag to node (node --use-system-ca export.js ...) to trust system CAs, useful for self-hosted instances with custom certs. See below.
    --quiet, -q               (optional) Suppress non-error console output.
    --dont-shorten-paths      (optional) Don't show shortend paths for files like the export file, by default it shows things like <FreeTubeDir>/invidious-import.json
    --clear-files             (optional) Clear old import files before starting a new export.
    --clear-config            (optional) Clear the config file before starting a new export. Needs to be used with --clear-files. 
        continued             instead of C:/Users/You/AppData/Roaming/FreeTube/invidious-import.json
    --logs, -l                (optional) Enable logging to a file. Name is ft-to-inv-(time in epoch).log
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
     FT_TO_INV_CONFIG_TOKEN=abc123`
  )
  process.exit(0);
  }
  
  if (HELPCMD) {
    const h = HELPCMD.toLowerCase();
    if (h === 'instance') {
      console.log(
      `Instance:
        Your Invidious instance URL. Expects a valid url, like http://localhost:3000
       Usage:
        ft-to-inv instance
       Aliases:
        --instance, -i
        FT_TO_INV_CONFIG_INSTANCE, INSTANCE, FT_TO_INV_INSTANCE
        ft-to-inv instance
       Expects a valid webserver URL, anything resolvable by the host
       Can be in either http or https
       You can specify a port like this:
       ft-to-inv instance http://localhost:3000`);
    } else if (h === 'token') {
      log(`🔑 Token: ${TOKEN}`);
    } 
  }
  
  
  await isExpectedArg(args);
  if (QUIET && VERBOSE) {
    log('❌ Conflicting options: --quiet and --verbose', { err: 'error' });
    process.exit(1);
  }
  // Validate required files
  for (const f of [HISTORY_PATH, PLAYLIST_PATH, PROFILE_PATH]) {
    if (!existsSync(f)) {
      log(`❌ Required file missing: ${f}`, { err: 'error' });
      consoleOutput.push(`${HISTORY_PATH}, ${PLAYLIST_PATH}, ${PROFILE_PATH}, ${EXPORT_DIR}, ${OLD_EXPORT_PATH}, ${FREETUBE_DIR} (logged for debugging)`, consoleOutput);
      log(`❌ Required file missing: ${f}`, { err: 'error' });
      process.exit(1);
    }
  }
  if (!TOKEN && !DRY_RUN && !NOSYNC) {
    log('❌ No token specified.', { err: 'error' });
    process.exit(1);
  }
  if (VERBOSE) {
    log(`🌐 Instance: ${INSTANCE}`, { err: 'info' });
    log('📂 Paths:', { err: 'info' });
    log(`   FreeTube data directory: ${FREETUBE_DIR}`, { err: 'info' });
    log(`   Export directory: ${EXPORT_DIR}`, { err: 'info' });
    log(`   History: ${stripDir(HISTORY_PATH)}`, { err: 'info' });
    log(`   Playlists: ${stripDir(PLAYLIST_PATH)}`, { err: 'info' });
    log(`   Profiles: ${stripDir(PROFILE_PATH)}`, { err: 'info' });
    log(`   Export → ${stripDir(OUTPUT_FILE)}`, { err: 'info' });
    log(`   Old export → ${stripDir(OLD_EXPORT_PATH)}`, { err: 'info' });
  }

  // Now call sync
  await sync();
}
function certErrorHint(err) {
  const message = String(err).toLowerCase();
      // node errors like UNABLE_TO_VERIFY_LEAF_SIGNATURE don't get included in the error object, this is all we get, but the full error is in the console
      // error: unable to verify the first certificate; if the root ca is installed locally, try running node.js with --use-system-ca
      if (message.includes("unable to verify the first certificate")) {
        log('⚠️ This may be due to an invalid or self-signed certificate. Try running with --use-system-ca or setting the NODE_EXTRA_CA_CERTS environment variable.', { err: 'warning' });
      }
      else return;
    }
// === sync logic ===
async function sync() {
    
    let historyData = await loadNDJSON(HISTORY_PATH);
    if (HISTORY === true) {
      historyData = [];
    }
    let playlistData = await loadNDJSON(PLAYLIST_PATH);
    if (PLAYLISTS === true) {
      playlistData = [];
    }
    let subscriptions = await extractSubscriptions(PROFILE_PATH);
    if (SUBS === true) {
      subscriptions = [];
    }
    const watch_history = [...new Set(historyData.map(entry => entry.videoId))] || [];

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
        default_home: "Popular",
        annotations: false,
        autoplay: false,
        dark_mode: "true",
        region: "US",
        quality: "dash",
        player_style: "invidious",
        watch_history: true,
        max_results: 40
      },
      playlists
    };
    let historyjson, playlistsjson, subscriptionsjson;
    if (HISTORY) {
      log('Ignoring history due to passing ignore history in');
       historyjson = {};
    }
    if (PLAYLISTS) {
      log('Ignoring playlists due to passing ignore playlists in');
       playlistsjson = {};
    }
    if (SUBS) {
      log('Ignoring subscriptions due to passing ignore subscriptions in');
      subscriptionsjson = {};
    }

   if (VERBOSE) log(`Calculating diffs...`, {err: 'info'});

  const old = readOldExport();
  const safeOldPlaylists = (old.playlists || []).filter(
  op => op && typeof op.title === 'string' && Array.isArray(op.videos)
);
const safeNewPlaylists = (output.playlists || []).filter(
  p => p && typeof p.title === 'string' && Array.isArray(p.videos)
);
const newPlaylists = playlistsjson || safeNewPlaylists.filter(
  p => !safeOldPlaylists.some(
    op => op.title === p.title && JSON.stringify(op.videos) === JSON.stringify(p.videos)
  )
);
const removedPlaylists = playlistsjson || safeOldPlaylists.filter(
  op => !safeNewPlaylists.some(p => p.title === op.title)
);
    const newHistory = historyjson || output.watch_history.filter(id => !old.watch_history.includes(id));
    const newSubs = subscriptionsjson || output.subscriptions.filter(id => !old.subscriptions.includes(id));

    const removedHistory = historyjson || old.watch_history.filter(id => !output.watch_history.includes(id));
    const removedSubs = subscriptionsjson || old.subscriptions.filter(id => !output.subscriptions.includes(id));

    var useSVideo = newHistory.length !== 1 ? "s" : "";
    var useSSub = newSubs.length !== 1 ? "s" : "";
    var useSPlaylist = newPlaylists.length !== 1 ? "s" : "";

   const prettyNewHistory = [];
   const prettyNewSubs = [];
   const prettyNewPlaylists = [];

   const prettyRemovedHistory = [];
   const prettyRemovedSubs = [];
   const prettyRemovedPlaylists = [];
  if (DRY_RUN) {
   for (const id of newHistory) {
      const video = await getVideoNameAndAuthor(id, INSTANCE, TOKEN);
      prettyNewHistory.push(`- ${video.title} by ${video.author} (${id})`);
   }
   for (const channel of newSubs) {
     const channelInfo = await getChannelName(channel, INSTANCE);
     prettyNewSubs.push(`- ${channelInfo} (${channel})`);
   }
   for (const playlist of newPlaylists) {
    // dont have a helper for playlists, we just read the properties instead
     prettyNewPlaylists.push(`- ${playlist.title}`);
   }
   for (const playlist of removedPlaylists) {
    // dont have a helper for playlists, we just read the properties instead
     prettyRemovedPlaylists.push(`- ${playlist.title}`);
   }
   for (const id of removedHistory) {
      const video = await getVideoNameAndAuthor(id, INSTANCE, TOKEN);
      prettyRemovedHistory.push(`- ${video.title} by ${video.author} (${id})`);
   }
   for (const channel of removedSubs) {
     const channelInfo = await getChannelName(channel, INSTANCE);
     prettyRemovedSubs.push(`- ${channelInfo} (${channel})`);
   }
  }

   const newH = newHistory.length ? `${newHistory.length} video${useSVideo}` : '0 videos';
   const newS = newSubs.length ? `${newSubs.length} subscription${useSSub}` : '0 subscriptions';
   const newP = newPlaylists.length ? `${newPlaylists.length} playlist${useSPlaylist}` : '0 playlists';
   const rmH = removedHistory.length ? `${removedHistory.length} video${removedHistory.length !== 1 ? 's' : ''}` : '0 videos';
   const rmS = removedSubs.length ? `${removedSubs.length} channel${removedSubs.length !== 1 ? 's' : ''}` : '0 channels';
   const rmP = removedPlaylists.length ? `${removedPlaylists.length} playlist${removedPlaylists.length !== 1 ? 's' : ''}` : '0 playlists';

    if (DRY_RUN) {
      log(`🧪 [DRY RUN] ${newHistory.length && newSubs.length && newPlaylists.length ? '' : 'Would add'} ${newH}, ${newS}, ${newP}.`);
      log(`🧪 [DRY RUN] Would remove ${rmH}, ${rmS}, ${rmP}.`);
      const continuePrompt = await prompt('Do you want a full layout of the diffs? (y/n)', 'n');
      if (continuePrompt === 'y') {
        if (newHistory.length) {
          log('New videos to sync:');
          for (const line of prettyNewHistory) log(line, { color: 'green' });
        }
        if (newSubs.length) {
          log('New subscriptions to sync:');
          for (const line of prettyNewSubs) log(line, { color: 'green' });
        }
        if (newPlaylists.length) {
          log('New playlists to sync:');
          for (const line of prettyNewPlaylists) log(line, { color: 'green' });
        }
        if (removedHistory.length) {
          log('Videos to remove from watch history:');
          for (const line of prettyRemovedHistory) log(line, { color: 'red' });
        }
        if (removedSubs.length) {
          log('Channels to unsubscribe from:');
          for (const line of prettyRemovedSubs) log(line, { color: 'red' });
        }
        if (removedPlaylists.length) {
          log('Playlists to delete:');
          for (const line of prettyRemovedPlaylists) log(line, { color: 'red' });
        }
        if (!newHistory.length && !newSubs.length && !newPlaylists.length && !removedHistory.length && !removedSubs.length && !removedPlaylists.length) {
          log('Nothing to remove or add.');
        }
      }
      return;
    }

    if (HISTORY && SUBS && PLAYLISTS) {
        log('why are you ignoring everything?');
        return;
      }
    
    if (VERBOSE) {
      if (!HISTORY) {
        log(`Found ${newHistory.length} new video${useSVideo} to sync`, { color: 'green' });
      }
      else {
        log('Ignoring history, not calculating new videos to sync', { err: 'warning' });
      }
      if (!SUBS) {
        log(`Found ${newSubs.length} new subscription${useSSub} to sync`, { color: 'green' });
      }
      else {
        log('Ignoring subscriptions, not calculating new subscriptions to sync', { err: 'warning' });
      }
      if (!PLAYLISTS) {
        log(`Found ${newPlaylists.length} new playlist${useSPlaylist} to sync`, { color: 'green' });
      }
      else {
        log('Ignoring playlists, not calculating new playlists to sync', { err: 'warning' });
      }
      if (removedHistory.length) {
        log(`Found ${removedHistory.length} video${removedHistory.length !== 1 ? 's' : ''} to remove from watch history`, { color: 'red' });
      }
      if (removedSubs.length) {
        log(`Found ${removedSubs.length} channel${removedSubs.length !== 1 ? 's' : ''} to unsubscribe from`, { color: 'red' });
      }
      if (removedPlaylists.length) {
        log(`Found ${removedPlaylists.length} playlist${removedPlaylists.length !== 1 ? 's' : ''} to delete`, { color: 'red' });
      }
    }

    let hadErrors = false;
    const markError = (label, error) => {
      hadErrors = true;
      log(`❌ ${label}: ${error.message || error}`, { err: 'error' });
      certErrorHint(error);
    };
    if (!NOSYNC) {
      if (newSubs.length === 0 && newHistory.length === 0 && newPlaylists.length === 0 && removedHistory.length === 0 && removedSubs.length === 0 && removedPlaylists.length === 0) {
        log('ℹ️ No changes to sync, not updating Invidious or export files',{ err: 'info' });
        return;
      }
      let historyCount = 0;
      if (newHistory.length && !HISTORY) {
      for (const videoId of newHistory) {
       try {
        historyCount++;
        log(`Video ${historyCount}/${newHistory.length}`, { err: 'info' });
        const { author, title } = await getVideoNameAndAuthor(videoId, INSTANCE, TOKEN);
        const prettyTitle = JSON.stringify(title) || 'Unknown Title';
        const prettyAuthor = JSON.stringify(author) || 'Unknown Author';
       const res = await retryPostRequest(`/auth/history/${videoId}`, {}, TOKEN, INSTANCE, INSECURE);
       if (!QUIET) {
       log(`✅ Marked ${prettyTitle} by ${prettyAuthor} as watched (HTTP ${res.code})`, { err: 'info' });
       }
      }
      catch (err) {
        markError('Failed to sync watch history', err);
      }
    }
  }
    let subCount = 0;
    for (const sub of newSubs) {
      try {
        subCount++;
        log(`Channel ${subCount}/${newSubs.length}`, { err: 'info' });
        const res = await retryPostRequest(`/auth/subscriptions/${sub}`, {}, TOKEN, INSTANCE, INSECURE);
        const name = await getChannelName(sub, INSTANCE);
        if (!QUIET) {
          Clog(`📺 Subscribed to ${name} (${sub}) with HTTP ${res.code}`, consoleOutput, false, false, 'green');
        }
        } catch (err) {
        markError(`Failed to subscribe to ${sub}`, err);
      }
    }
    if (VERBOSE) log(`Starting playlist export...`, { err: 'info' });
 const playlistsToImport = [];
const oldPlaylistTitles = new Set(
  (old.playlists || [])
    .filter(pl => pl && typeof pl.title === 'string' && pl.title.trim() !== '')
    .map(pl => pl.title.toLowerCase())
);
let plCount = 0;
try {
for (const pl of newPlaylists) {
  if (!pl || typeof pl.title !== 'string') {
    log(`⚠️ Skipping invalid playlist entry: ${JSON.stringify(pl)}`, { err: 'warning' });
    continue;
  }
  plCount++;
  log(`Playlist ${plCount}/${newPlaylists.length}`, { err: 'info' });
  log(`ℹ️ Found new playlist: "${pl.title}"`, { err: 'info' });
  if (oldPlaylistTitles.has(pl.title.toLowerCase())) {
    log(`ℹ️ Skipping existing playlist: "${pl.title}"`, { err: 'info' });
    continue;
  }
  // Add to playlist import structure
  playlistsToImport.push({
    title: pl.title,
    description: pl.description,
    privacy: pl.privacy ?? 'Private',
    videos: pl.videos
  });
  log(`🎵 Queued playlist "${pl.title}" for import, \n you will need to import it manually into Invidious. \n Head to Settings > Import/Export > Import Invidious JSON data and select the generated playlist-import.json file.`, { color: 'green' });

}
if (playlistsToImport.length > 0) {
  const importPath = './playlist-import.json';
  writePlaylistImport(playlistsToImport, importPath);
  log(`📤 Wrote ${playlistsToImport.length} playlists to ${importPath}`, { color: 'green' });
} else {
  log(`✅ No new playlists to import`);
}
} catch (err) {
  markError('Failed to prepare playlist import', err);
}   
let removedHisCnt = 0;
// Remove watched videos
    if (removedHistory.length) {
     for (const videoId of removedHistory) {
      try {
        removedHisCnt++;
        log(`Removed video ${removedHisCnt}/${removedHistory.length}`, { err: 'info' });
      const res = await retryPostRequest(`/auth/history/${videoId}`, null, TOKEN, INSTANCE, INSECURE, 'DELETE');
      if (!QUIET) {
        log(`🗑️ Removed ${videoId} from watch history (HTTP ${res.code})`, { err: 'info' });
      }
     } catch (err) {
       markError('Failed to remove from watch history', err);
      }
    }
  }
  let removedSubCnt = 0;
    // Unsubscribe from channels
    for (const ucid of removedSubs) {
     try {
       removedSubCnt++;
       log(`Unsubscribed from ${ucid} (${removedSubCnt}/${removedSubs.length})`, { err: 'info' });
      const res = await retryPostRequest(`/auth/subscriptions/${ucid}`, null, TOKEN, INSTANCE, INSECURE, 'DELETE');
      if (!QUIET) {
       log(`👋 Unsubscribed from ${ucid} (HTTP ${res.code})`, { err: 'info' });
      }
      } catch (err) {
       markError(`Failed to unsubscribe from ${ucid}`, err);
     }
    }
  if (VERBOSE) log(`Processing removed playlists...`, { err: 'info' });
  // Remove deleted playlists from playlist-import.json
  const importPath = './playlist-import.json';
  if (removedPlaylists.length > 0 && existsSync(importPath)) {
    try {
    const importData = JSON.parse(readFileSync(importPath, 'utf-8'));
    
    // Filter out any playlists matching removed titles (case-insensitive)
    importData.playlists = importData.playlists.filter(pl =>
      !removedPlaylists.some(rp => rp.title.toLowerCase() === pl.title.toLowerCase())
    );
    
    writeFileSync(importPath, JSON.stringify(importData, null, 2));
    log(`🗑️ Removed ${removedPlaylists.length} playlists from ${importPath}`, { err: 'info' });
  } catch (err) {
    markError(`Failed to update ${importPath} after removals`, err);
  }
}
    if (!hadErrors) {
      writeNewExport(output);
      if (!QUIET) {
        log(`✅ Exported to ${stripDir(OUTPUT_FILE)} and updated ${stripDir(OLD_EXPORT_PATH)}`);
      }
      if (QUIET) {
        log(`Sync complete. Exported to ${stripDir(OUTPUT_FILE)} and updated ${stripDir(OLD_EXPORT_PATH)}`);
      }
    } else {
      log('⚠️ Some sync operations failed. Export not saved. Run with -v or --verbose for details.', { err: 'warning' });
    }
  } else {
     if (!hadErrors) {
      noSyncWrite(output, OUTPUT_FILE, QUIET);
      }
    else {
      log('⚠️ Some sync operations failed. Export not saved. Run with -v or --verbose for details.', { err: 'warning' });
    }
  }

}
// Kick off
await main().catch(err => {
  log(`❌ Fatal error: ${err}`, { err: 'error' });
  process.exit(1);
});
await maybeSchedule();
logConsoleOutput();