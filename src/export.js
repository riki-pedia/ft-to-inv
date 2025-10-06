#!/usr/bin/env node
// main entrypoint, parses cli args and starts sync
// the command to run this is not that pretty
// node [--use-system-ca] export.js [flags]
// not gonna talk about use system ca, see help or config
// gets values in this order:
// cli args > env > config
// you can preface env with FT_INV_CONFIG_OPTION, where option is the cli flag you want to pass
// for example: set FT_TO_INV_CONFIG_INSTANCE=https://invidous.example.com sets the instance flag to be https://invidious.example.com
// when theres a huge file, sort it a little
// add some regions
// please.
// THIS FILES 1400 LINES WHAT HAVE I DONE
//#region imports and functions
// test comment for workflow
// i dont know why i decided to import fs and path like this
import { existsSync, readFileSync, writeFileSync, realpathSync } from 'fs';
import { resolve, join } from 'path';
import { Octokit } from 'octokit';
import ora from 'ora';
import semver from 'semver';
import {
   loadConfig,
   runFirstTimeSetup,
   getDefaultFreeTubeDir,
   normalizePath,
   prompt,
   detectOs
} from './config.js';
import { 
  loadNDJSON, 
  extractSubscriptions, 
  readOldExport, 
  writeNewExport, 
  noSyncWrite,
  getChannelName, 
  writePlaylistImport, 
  getVideoNameAndAuthor,
  setConfig,
  retryPostRequest,  
} from './utils.js';
import { resolveConfig } from './args.js';
async function sleep(s) {
  const ms = s * 1000;
  return new Promise(resolve => setTimeout(resolve, ms));
}
console.log("invidious is having issues right now due to recent youtube changes, the tool may not work as expected. please be patient while people find workarounds.")
console.log("\nalso report any bugs or issues you find on github: <https://github.com/riki-pedia/ft-to-inv/issues>")
await sleep(1.5)
import { logConsoleOutput, log } from './logs.js'
import cron from 'node-cron';
import { clearFiles } from './clear-import-files.js';
const dirname = fileURLToPath(new URL('.', import.meta.url));
const hintsPath = join(dirname, 'hints.json');
const hints = JSON.parse(readFileSync(hintsPath, "utf-8"));import { sanitizeConfig, sanitizePath } from './sanitize.js';
import { loadPlugins, runHook } from './loader.js';
import { 
  listInstalled, 
  listStore,
  installPlugin,
  removePlugin
} from './marketplace.js'
import { decryptToken, getPassphrase} from './encryption.js';
import { fileURLToPath } from "url";
const args = process.argv.slice(2);

import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { version } = require("../package.json");

console.log(`ft-to-inv v${version}:`);
//#endregion
//#region helper functions
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
  "PLAYLISTS":          "--playlists, --dont-include-playlists, -pl",
  "SUBSCRIPTIONS":      "--subscriptions, --dont-include-subscriptions, -s",
  "PLUGINS":            "--plugins, -p",
  "INSTALL":           "--install, -ins, --add, -add",
  "LIST":              "--list, -list",
  "MARKETPLACE":       "--marketplace, -m"
}
// list of args that should reasonably have values, like -t <value>
const flagsExpectingValue = [
  '--token', '-t',
  '--config', '-c',
  '--export-dir', '-e',
  '--freetube-dir', '-f', '-cd',
  '--cron-schedule', '-cron',
  '--instance', '-i',
  '--plugins', '-p',
  '--remove', '-r',
  '--install', '-ins',
  '--list', '-list',
  '--marketplace', '-m'
]
const validShortFlags = [
  '-t', '-c', '-e', '-f', '-cd', '-cron', '-i', '-fts', '-drs', '-h', '-?', '-q', '-v', '-pl', '-hi', '-s', '-l', '-p', '-ins', '-list', '-m', '-r', 
]
const validPosArgs = [
  'token', 'help', 'instance', 'verbose', 'dry-run', 'quiet', 'insecure', 'no-sync', 'export-dir', 'freetube-dir', 'cron-schedule', 'dont-shorten-paths', 'first-time-setup', 'dont-run-setup', 'config', 'logs', 'history', 'playlists', 'subscriptions', 'test', 'plugins', 'install', 'list', 'plugin', 'marketplace', 'remove', 'uninstall', 'add'
]
const posArgsExpectingValue = [
  'token', 'instance', 'export-dir', 'freetube-dir', 'cron-schedule', 'config', 'help', 'plugins', 'install', 'marketplace', 'remove', 'uninstall', 'add'
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
        throw new Error(`Unknown argument: ${cleanArg}`);
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
      throw new Error(`Unexpected positional argument: ${a}`);
    }
  }

  return true;
}
async function getToken(tokenArg) {
  //                       the name is stupid but i can't think of a better one
  const passphrase = await getPassOnAHeadlessMachine();
  if (tokenArg.includes(":")) {
    return await decryptToken(tokenArg, passphrase);
  } else {
    return tokenArg;
  }
}
const consoleOutput = []

// -- Globals (to be assigned in bootstrap) --
let TOKEN, INSTANCE, VERBOSE, DRY_RUN, QUIET, INSECURE, NOSYNC, HELP, CRON_SCHEDULE, DONT_SHORTEN_PATHS, HELPCMD;
let HISTORY_PATH, PLAYLIST_PATH, PROFILE_PATH;
let OUTPUT_FILE, OLD_EXPORT_PATH;
let FIRST_TIME_SETUP = false; // flag to indicate if we should run the first-time setup
// this is a false linter error, its used in main()
// eslint-disable-next-line @typescript-eslint/no-unused-vars
let LOGS_BOOLEAN, LOGS;

let PLUGINS, INSTALL, LIST, MARKETPLACE, REMOVE;
let PLAYLISTS, HISTORY, SUBS;

// should be global so utils can access it
let FREETUBE_DIR;
let EXPORT_DIR;
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
  // eslint-disable-next-line no-prototype-builtins
  if (config.hasOwnProperty(configKey)) {
    return config[configKey] === true;
  }
  return false; // Default fallback
}
async function isValidCron(cronString) {
  try {
   return cron.validate(cronString);
  } catch {
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
      const hintNumber = getRandomInt(1, 77);
      log(`💡 ${hints[hintNumber === 77 ? 76 : hintNumber]}`);
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
  await runHook('cronWait', {cron: CRON_SCHEDULE});
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
// this new logic checks from package.json
// compares current version to latest release on github
// if the version is different, it tells the user to update
const currentTag = version;
async function getLatestRelease() {
  try {
    log('Checking for updates...', { err: 'info' });
    const octokit = new Octokit(); //       maybe ${} instead, but it looks like it works
    const response = await octokit.request('GET /repos/{owner}/{repo}/releases/latest', {
      owner: 'riki-pedia',
      repo: 'ft-to-inv'
    });
    const latestTag = response.data.tag_name.replace(/^v/, "");
    if (semver.gt(latestTag, currentTag)) {
      log(`📣 New release available: ${latestTag} (current: ${currentTag}) 📣 \n You can install it with: \`npm install -g ft-to-inv@${latestTag}\``, { err: 'info' });
      return latestTag;
    } else {
      log(`✅ You are running the latest release: ${currentTag}`, { err: 'info' });
      return currentTag;
    }
  } catch (error) {
    log(`❌ Error fetching latest release: ${error}`, { err: 'error' });
    return null;
  }

}
async function getPassOnAHeadlessMachine() {
  // if keytar fails, we try to get the passphrase from env var
  // ✨ programming is my passion ✨
  const badName = resolveConfig(null, {
    cliNames: ["--dont-use-keytar"],
    envNames: ["FT_TO_INV_DONT_USE_KEYTAR", "DONT_USE_KEYTAR", "FT_TO_INV_CONFIG_DONT_USE_KEYTAR"],
    args: args,
    isFlag: true,
  })
  if (process.env.FT_INV_KEY && (badName === true || badName === 'true')) {
    return process.env.FT_INV_KEY;
  }
  else return getPassphrase();
}
async function linuxWarning() {
  // warn about keytar on linux
  const os = detectOs();
  if (os === 'linux') {
    log(`⚠️ Warning: Keytar may not work properly on Linux without libsecret installed. \n try running this: \n \`sudo apt install -y libsecret-1-0\` \n if you run this in a headless machine, it could be broken.`, { err: 'warning' });
    log(`If you want to avoid this warning, set the env var FT_TO_INV_DONT_USE_KEYTAR to true. Then set your passphrase in the env var FT_INV_KEY with \n \` export FT_INV_KEY=<your-passphrase>\``, { err: 'warning' });
  }
}
//#endregion
//#region main fts
// Main function to run the export and sync process
export async function main(overrides = {}) {
  // get the first time setup flag at the top before it's run/skipped
  // the last two params look in the config file, so those should be blank here
  await getLatestRelease();
  await linuxWarning();
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
  //#endregion
  //#region plugins, etc.,
   PLUGINS = await resolveConfig('plugins', {
    cliNames: ['--plugins', '-p'],
    envNames: ['FT_TO_INV_CONFIG_PLUGINS', 'PLUGINS', 'FT_TO_INV_PLUGINS'],
    config: config,
    args: args,
    positionalArgs: ['plugins', 'plugin']
  });
  if (typeof PLUGINS === 'string' ) {
  if(PLUGINS.toLowerCase() === 'list') {
      await listInstalled();
      return
  }
  else if (PLUGINS.toLowerCase() === 'add' || PLUGINS.toLowerCase() === 'install') {
       log('install a plugin with ft-to-inv install <plugin-name>')
       return
  }}
  INSTALL = await resolveConfig('install', {
    cliNames: ['--install', '-ins'],
    envNames: ['FT_TO_INV_CONFIG_INSTALL', 'INSTALL', 'FT_TO_INV_INSTALL'],
    config: config,
    args: args,
    positionalArgs: ['install', 'add']
  });
  if (INSTALL !== undefined && INSTALL !== null && typeof INSTALL === 'string' && INSTALL !== '') {
    await installPlugin(INSTALL)
    return;
  }
  // lists installed plugins
  LIST = await resolveConfig('list', {
    cliNames: ['--list', '-list'],
    envNames: ['FT_TO_INV_CONFIG_LIST', 'LIST', 'FT_TO_INV_LIST'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['list']
  });
  if (LIST) {
    await listInstalled();
    return;
  }
  MARKETPLACE = await resolveConfig('marketplace', {
    cliNames: ['--marketplace', '-m'],
    envNames: ['FT_TO_INV_CONFIG_MARKETPLACE', 'MARKETPLACE', 'FT_TO_INV_MARKETPLACE'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['marketplace']
  });
  if (MARKETPLACE) {
    await listStore();
    return;
  }
  REMOVE = await resolveConfig('remove', {
    cliNames: ['--remove', '-r'],
    envNames: ['FT_TO_INV_CONFIG_REMOVE', 'REMOVE', 'FT_TO_INV_REMOVE'],
    config: config,
    args: args,
    positionalArgs: ['remove', 'uninstall']
  });
  if (REMOVE !== undefined && REMOVE !== null && typeof REMOVE === 'string' && REMOVE !== '') {
    await removePlugin(REMOVE);
    return;
  }
  await loadPlugins();
  await runHook('beforeMain', { overrides });
const clearFilesFlag = resolveFlagArg(args, ['--clear', '--clear-files', '--delete-files'], {}, null)
const clearConfigFlag = resolveFlagArg(args, ['--clear-config'], {}, null)
if (clearFilesFlag === true || clearConfigFlag === true) {
  clearFiles(clearConfigFlag);
  // exit early to prevent trying to sync with no files or config
  return
}
//#endregion
//#region load/merge config and args
  // spaghetti code isn't that far off of what this is
  // but it works so whatever
  // this section:
  // Load/merge CLI args + config file
  // Detect first-run (no config file or no prior export)
  // Assign globals from config
  const baseExportDir = await resolveConfig('export_dir', {
    cliNames: ['--export-dir', '-e'], 
    envNames: ['FT_TO_INV_CONFIG_EXPORT_DIR', 'EXPORT_DIR', 'FT_TO_INV_EXPORT_DIR'],
    config: config,
    args: args,
    fallback: resolve('.'),
    positionalArgs: ['export-dir', 'export']
  }
  )
  EXPORT_DIR = await sanitizePath(baseExportDir);
  const baseFtDir = await resolveConfig('freetube_dir', {
      cliNames: ['--freetube-dir', '-f', '-cd'],
      envNames: ['FT_TO_INV_CONFIG_FREETUBE_DIR', 'FREETUBE_DIR', 'FT_TO_INV_FREETUBE_DIR'],
      config: config,
      args: args,
      fallback: getDefaultFreeTubeDir(),
      positionalArgs: ['freetube-dir', 'freetube']
    }
  )
  FREETUBE_DIR = await sanitizePath(baseFtDir);
  // this looks trash, if you can make this better please do
  const baseToken = await resolveConfig('token', {
    cliNames: ['--token', '-t'],
    envNames: ['FT_TO_INV_CONFIG_TOKEN', 'FT_TO_INV_TOKEN', 'TOKEN'],
    config: config,
    args: args,
    positionalArgs: ['token', 't', 'auth']
  });
  TOKEN = await getToken(baseToken);
  // did i seriously forget to remove the debug log :skull:
  INSTANCE = await resolveConfig('instance', {
    cliNames: ['--instance', '-i'],
    envNames: ['FT_TO_INV_CONFIG_INSTANCE', 'INSTANCE', 'FT_TO_INV_INSTANCE'],
    config: config,
    args: args,
    fallback: 'https://invidious.example.com',
    positionalArgs: ['instance', 'i']
  });
  VERBOSE = await resolveConfig('verbose', {
    cliNames: ['--verbose', '-v'],
    envNames: ['FT_TO_INV_CONFIG_VERBOSE', 'VERBOSE', 'FT_TO_INV_VERBOSE'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['verbose']
  }
)
  DRY_RUN = await resolveConfig('dry_run', {
    cliNames: ['--dry-run'],
    envNames: ['FT_TO_INV_CONFIG_DRY_RUN', 'DRY_RUN', 'FT_TO_INV_DRY_RUN'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['dry-run', 'dryRun', 'dry']
  }
)
  QUIET = await resolveConfig('quiet', {
    cliNames: ['--quiet', '-q'],
    envNames: ['FT_TO_INV_CONFIG_QUIET', 'QUIET', 'FT_TO_INV_QUIET'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['quiet']
  }
)
runHook('duringMain', {overrides})
  INSECURE = await resolveConfig('insecure', {
    cliNames: ['--insecure', '--http'],
    envNames: ['FT_TO_INV_CONFIG_INSECURE', 'INSECURE', 'FT_TO_INV_INSECURE'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['insecure', 'http']
  })
  NOSYNC = await resolveConfig('no_sync', {
    cliNames: ['--no-sync'],
    envNames: ['FT_TO_INV_CONFIG_NO_SYNC', 'NOSYNC', 'FT_TO_INV_NOSYNC'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['no-sync', 'noSync', 'nosync']
  })
  DONT_SHORTEN_PATHS = await resolveConfig('dont_shorten_paths', {
    cliNames: ['--dont-shorten-paths'],
    envNames: ['FT_TO_INV_CONFIG_DONT_SHORTEN_PATHS', 'DONT_SHORTEN_PATHS', 'FT_TO_INV_DONT_SHORTEN_PATHS'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['dont-shorten-paths', 'dontShortenPaths', 'dontShorten']
  })

  PLAYLISTS  = await resolveConfig('playlists', {
    cliNames: ['--playlists', '--dont-include-playlists', '-p'],
    envNames: ['FT_TO_INV_CONFIG_PLAYLISTS', 'PLAYLISTS', 'FT_TO_INV_PLAYLISTS'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['playlists']
  })
  HISTORY = await resolveConfig('history', {
    cliNames: ['--history', '--dont-include-history', '-hi'],
    envNames: ['FT_TO_INV_CONFIG_HISTORY', 'HISTORY', 'FT_TO_INV_HISTORY'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['history']
  })
  SUBS = await resolveConfig('subscriptions', {
    cliNames: ['--subscriptions', '--dont-include-subs', '-s'],
    envNames: ['FT_TO_INV_CONFIG_SUBS', 'SUBS', 'FT_TO_INV_SUBS'],
    config: config,
    args: args,
    isFlag: true,
    positionalArgs: ['subscriptions', 'subs']
  })

  OUTPUT_FILE        = exportPath || join(EXPORT_DIR, 'invidious-import.json');
  OLD_EXPORT_PATH    = join(EXPORT_DIR, 'import.old.json');
  CRON_SCHEDULE = await resolveConfig('cron_schedule', {
    cliNames: ['--cron-schedule', '-cron', '--cron'],
    envNames: ['FT_TO_INV_CONFIG_CRON_SCHEDULE', 'CRON_SCHEDULE', 'FT_TO_INV_CRON_SCHEDULE', 'CRON'],
    config: config,
    args: args,
    fallback: '',
    positionalArgs: ['cron-schedule', 'cron']
  }) 

  LOGS_BOOLEAN       = await resolveConfig('logs', {
     cliNames: ['--logs', '-l'],
     envNames: ['FT_TO_INV_CONFIG_LOGS', 'LOGS', 'FT_TO_INV_LOGS'],
     config: config,
     args: args,
     isFlag: true,
     positionalArgs: ['logs']
  })
  LOGS               = LOGS_BOOLEAN ? resolve('ft-to-inv-' + Date.now() + '.log') : undefined;
  // intended for cases like `ft-to-inv help instance`
  HELPCMD            = await resolveConfig('help', {
     config: config,
     args: args,
     isFlag: false,
     positionalArgs: ['help'],
     fallback: undefined
  });
//#endregion
//#region overrides
  INSTANCE = overrides.instance || INSTANCE;
  TOKEN = overrides.token || TOKEN;
  FREETUBE_DIR = overrides.freetube_dir || FREETUBE_DIR;
  EXPORT_DIR = overrides.export_dir || EXPORT_DIR;
  VERBOSE = overrides.verbose || VERBOSE;
  DRY_RUN = overrides.dry_run || DRY_RUN;
  DONT_SHORTEN_PATHS = overrides.dont_shorten_paths || DONT_SHORTEN_PATHS;
  NOSYNC = overrides.noSync || NOSYNC;
  QUIET = overrides.quiet || QUIET;
  INSECURE = overrides.insecure || INSECURE;
  CRON_SCHEDULE = overrides.cron_schedule || CRON_SCHEDULE;
  LOGS_BOOLEAN = overrides.logs || LOGS_BOOLEAN;
  HISTORY = overrides.history || HISTORY;
  HELPCMD = overrides.helpcmd || HELPCMD;
  SUBS = overrides.subscriptions || SUBS;
  PLAYLISTS = overrides.playlists || PLAYLISTS;
  const conf = {
    instance: INSTANCE,
    token: TOKEN,
    freetube_dir: FREETUBE_DIR,
    export_dir: EXPORT_DIR,
    verbose: VERBOSE,
    dry_run: DRY_RUN,
    dont_shorten_paths: DONT_SHORTEN_PATHS,
    no_sync: NOSYNC,
    quiet: QUIET,
    insecure: INSECURE,
    cron_schedule: CRON_SCHEDULE,
    logs: LOGS_BOOLEAN,
    history: HISTORY,
    helpcmd: HELPCMD,
    subscriptions: SUBS,
    playlists: PLAYLISTS
  }
  // needed to change because config was always {}
  // this is only so plugins can use it
  await runHook('afterMain', { overrides, conf });
  // leaving this one, exits early
  HELP               = resolveFlagArg(args, ['--help', '-h', '/?', '-?'], config, 'help');
  //#endregion
  //#region help
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
  // |-/
  if (HELPCMD) {
    const h = HELPCMD.toLowerCase();
    if (h === 'instance') {
      console.log(
      `
Instance:
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
  ft-to-inv instance http://localhost:3000
       `);
    } else if (h === 'token' || h === 't' || h === 'auth' ) {
      log(`
Token:
 Your Invidious SID cookie for authentication.
Usage:
 ft-to-inv token foo
Aliases:
 --token, -t
 FT_TO_INV_CONFIG_TOKEN, TOKEN, FT_TO_INV_TOKEN
 You can usually get a token by going to your instance > Settings/Preferences > Manage Tokens and pasting the top one in
 Warning: Be careful with these, they give full read/write access to your Invidious account
 Expects 40ish characters and a token ending with = (like current versions should)
 If you host an older instance before newer tokens you can rollback to version 0.2.9 of ft-to-inv. `);
    } 
    else if (h === 'freetube-dir' || h === 'freetube' ) {
      log(`
FreeTube Directory:
 The path to your FreeTube data directory. Expects a valid directory path.
Usage:
 ft-to-inv freetube-dir /path/to/freetube
Aliases:
 --freetube-dir, -f, -cd
 FT_TO_INV_CONFIG_FREETUBE_DIR, FREETUBE_DIR, FT_TO_INV_FREETUBE_DIR

On Linux, this is usually located at:
~/.config/FreeTube

On Windows, this is usually located at:
C:\\Users\\<YourUsername>\\AppData\\Roaming\\FreeTube

On macOS, this is usually located at:
~/Library/Application Support/FreeTube
(note: i dont actually have a mac)

Checks for FreeTube's file structure:
 history.db - history, duh
 playlists.db - playlists
 profiles.db - profiles, holds your current user config with subs
 `);
    }
    else if (h === 'export-dir' || h === 'export') {
      log(`
Export Directory:
 The directory to write the export file to. Expects a valid directory path.
Usage:
 ft-to-inv export-dir /path/to/export
Aliases:
 --export-dir, -e
 FT_TO_INV_CONFIG_EXPORT_DIR, EXPORT_DIR, FT_TO_INV_EXPORT_DIR
 Defaults to the current working directory.
 The Invidius export files (invidious-import.json, import.old.json, and playlist-import.json) will be here
 `);
    }
    else if (h === 'verbose') {
      log(`
Verbose:
 Enable verbose logging.
Usage:
 ft-to-inv verbose
Aliases:
 --verbose, -v
 FT_TO_INV_CONFIG_VERBOSE, VERBOSE, FT_TO_INV_VERBOSE
 This is really simple, just makes the tool output more information about what it's doing.
 `);
    }
    else if (h === 'dry-run') {
      log(`
Dry Run:
 Run the tool without making any changes.
Usage:
 ft-to-inv dry-run
Aliases:
 --dry-run, -d
 FT_TO_INV_CONFIG_DRY_RUN, DRY_RUN, FT_TO_INV_DRY_RUN
 Runs the tool and checks what *would* happen without making any changes. You can also have it display a "neat" table of the changes it would make.
 `);
    }
    else if (h === 'quiet') {
      log(`
Quiet:
 Suppress all output except for errors.
Usage:
 ft-to-inv quiet
Aliases:
 --quiet, -q
 FT_TO_INV_CONFIG_QUIET, QUIET, FT_TO_INV_QUIET
 Opposite of --verbose. Silences most output except for errors and warnings.
 `);
    }
    else if (h === 'insecure' || h === 'http') {
      log(`
Insecure:
 Allow insecure connections (HTTP).
Usage:
 ft-to-inv insecure
Aliases:
 --insecure, --http
 FT_TO_INV_CONFIG_INSECURE, INSECURE, FT_TO_INV_INSECURE
 ft-to-inv http
 Requires http instead of https. Most of the time this is automatically set, but it's still best practice to set it anyway.
 `);
      }
      else if (h === 'noSync' || h === 'no-sync' || h === 'nosync') {
        log(`
No Sync:
 Disable syncing with the Invidious API.
Usage:
 ft-to-inv no-sync
Aliases:
 --noSync, -n
 FT_TO_INV_CONFIG_NO_SYNC, NO_SYNC, FT_TO_INV_NO_SYNC
 Exports your data without syncing with the Invidious API. Useful when you can't use the API or don't trust me enough to give the tool your token.
 (you should btw)
 `);
      }
      else if (h === 'dont-shorten-paths' || h === 'dontShortenPaths' || h === 'dontShorten') {
        log(`
Don't Shorten Paths:
 Don't shorten file paths in the output.
Usage:
 ft-to-inv dont-shorten-paths
Aliases:
 --dont-shorten-paths
 FT_TO_INV_CONFIG_DONT_SHORTEN_PATHS, DONT_SHORTEN_PATHS, FT_TO_INV_DONT_SHORTEN_PATHS
 By default, file paths are shortened in the terminal output. It would look like this:
   <ExportDir>/invidious-import.json
 Instead, it will show the full path:
   /home/you/ft-to-inv/export/invidious-import.json
 `);
      }
      else if (h === 'playlists' || h === 'playlist') {
        log(`
Playlists:
 Skip exporting playlists.
Usage:
 ft-to-inv playlists
Aliases:
 --playlists, -p, --dont-include-playlists
 FT_TO_INV_CONFIG_PLAYLISTS, PLAYLISTS, FT_TO_INV_PLAYLISTS
 Used for cases where you want to skip exporting playlists.
 `);
      }
      else if (h === 'history') {
        log(`
History:
 Skip exporting history.
Usage:
 ft-to-inv history
Aliases:
 --history, -h, --dont-include-history
 FT_TO_INV_CONFIG_HISTORY, HISTORY, FT_TO_INV_HISTORY
 Used for cases where you want to skip exporting history.
 `);
      }
      else if (h === 'subscriptions' || h === 'subs') {
        log(`
Subscriptions:
 Skip exporting subscriptions.
Usage:
 ft-to-inv subscriptions
Aliases:
 --subscriptions, -s, --dont-include-subs
 FT_TO_INV_CONFIG_SUBS, SUBS, FT_TO_INV_SUBS
 Used for cases where you want to skip exporting subscriptions.
 `);
      }
      else if (h === 'cron' || h === 'cron-schedule') {
        log(`
Cron Schedule:
 Set a cron schedule for the export.
Usage:
 ft-to-inv cron
Aliases:
 --cron, -cron --cron-schedule
 FT_TO_INV_CONFIG_CRON, CRON, FT_TO_INV_CRON
 Takes a valid cron string, checks it, and sets the tool to run on a schedule based off it. For help with cron strings, see https://crontab.guru/.
 `);
      } 
      else if (h === 'logs') {
        log(`
Logs:
 Enable logging for the export process.
Usage:
 ft-to-inv logs
Aliases:
 --logs, -l
 FT_TO_INV_CONFIG_LOGS, LOGS, FT_TO_INV_LOGS
 This is useful for debugging and monitoring the export process. This only sets logging, you can't change the name of the file. If you REALLY want a custom file, run something like this:
 ft-to-inv | tee custom-log-file.txt
 `);
      }
      return;
    }
    //#endregion
    //#region validation
if (!overrides || Object.keys(overrides).length === 0) {
  try {
    config = await sanitizeConfig({
      token: TOKEN,
      instance: INSTANCE,
      export_dir: EXPORT_DIR,
      freetube_dir: FREETUBE_DIR,
      cron_schedule: CRON_SCHEDULE
    });
  } catch (err) {
    log(`❌ ${err.message}`, { err: "error" });
    process.exit(1);
  }

  await isExpectedArg(args);

} else {
  log("⚠️ Bypassing sanitization and argument checks (overrides present)", { err: "warning" });
  config = overrides; // trust caller to pass in already-clean values
}
  // these files are always those names, not taking args for them
  // if theyre different make a symlink ig
  PROFILE_PATH = join(FREETUBE_DIR, 'profiles.db');
  HISTORY_PATH = join(FREETUBE_DIR, 'history.db');
  PLAYLIST_PATH = join(FREETUBE_DIR, 'playlists.db');
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
    log('❌ No token specified.\n See ft-to-inv help token for more info.', { err: 'error' });
    process.exit(1);
  }
  if (VERBOSE) {
    log(`🌐 Instance: ${INSTANCE}`, { err: 'info' });
    log(` Paths:`, { err: 'info' });
    log(`   FreeTube data directory: ${FREETUBE_DIR}`, { err: 'info' });
    log(`   Export directory: ${EXPORT_DIR}`, { err: 'info' });
    log(`   History: ${stripDir(HISTORY_PATH)}`, { err: 'info' });
    log(`   Playlists: ${stripDir(PLAYLIST_PATH)}`, { err: 'info' });
    log(`   Profiles: ${stripDir(PROFILE_PATH)}`, { err: 'info' });
    log(`   Export → ${stripDir(OUTPUT_FILE)}`, { err: 'info' });
    log(`   Old export → ${stripDir(OLD_EXPORT_PATH)}`, { err: 'info' });
  }
   await runHook('beforeSync', { overrides });
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
//#endregion
//#region sync
export async function sync() {
    
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
    // disabled because || [] is to catch undefined, but map on undefined errors anyway
    // eslint-disable-next-line no-constant-binary-expression
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
    //#region diffs
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

   const newData = {history: newHistory, subs: newSubs, playlists: newPlaylists};
   await runHook('duringSync', {data: newData})
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
   //#endregion
   //#region dry run
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
    const markError = async (label, error) => {
      hadErrors = true;
      log(`❌ ${label}: ${error.message || error}`, { err: 'error' });
      certErrorHint(error);
    };
    //#endregion
    //#region api sync
    if (!NOSYNC) {
      if (newSubs.length === 0 && newHistory.length === 0 && newPlaylists.length === 0 && removedHistory.length === 0 && removedSubs.length === 0 && removedPlaylists.length === 0) {
        log('ℹ️ No changes to sync, not updating Invidious or export files',{ err: 'info' });
        return;
      }
      // its really hard for me to see the seperation between these regions on vscode
      // so we add region names
      // "you could just add spaces"
      // but im lazy
      //#endregion
      //#region new history
      let historyCount = 0;
      const hisSummary = [];
      if (newHistory.length && !HISTORY) {
        const spinner = ora(`Syncing history... (${historyCount}/${newHistory.length} videos)`).start();
        for (const [i, videoId] of newHistory.entries()) {
       try {
        if (!QUIET) {
          const { author, title } = await getVideoNameAndAuthor(videoId, INSTANCE, TOKEN);
          const prettyTitle = title || 'Unknown Title';
          const prettyAuthor = author || 'Unknown Author';
          const hisToAdd = `- ${prettyTitle} by ${prettyAuthor} (${videoId})`;
          hisSummary.push(hisToAdd);
        }
        await retryPostRequest(`/auth/history/${videoId}`, {}, TOKEN, INSTANCE, INSECURE);
        historyCount++;
        spinner.text = `Syncing history... (${historyCount}/${newHistory.length} videos)`;
        } catch (err) {
        spinner.fail(`(${i + 1}/${newHistory.length}) ❌ Failed for ${videoId}: ${err.message || err}`);
        await markError(`Failed to add ${videoId} to watch history`, err);
        }
       }
  if (newHistory.length <= 10 && !QUIET) for (const line of hisSummary) log(line, { color: 'green' });
  else if (!QUIET) log(`✅ Added ${newHistory.length} videos to watch history (too many to log them all)`, { color: 'green' });
  spinner.succeed(`✅ Synced ${historyCount}/${newHistory.length} videos to watch history`);
}   
    //#endregion
    //#region new subs
    let subCount = 0;
    const subSpinner = ora(`Syncing subscriptions... (${subCount}/${newSubs.length} channel${newSubs.length === 1 ? '' : 's'})`).start();
    const subSummary = [];
    subSummary.push('New subscriptions added:');
    if (newSubs.length && !SUBS) {    
    for (const sub of newSubs) {
      try {
        subCount++;
        subSpinner.text = `Syncing subs... (${subCount}/${newSubs.length} channels)`;
        await retryPostRequest(`/auth/subscriptions/${sub}`, {}, TOKEN, INSTANCE, INSECURE);
        const name = await getChannelName(sub, INSTANCE);
        const prettySum = `- ${name} (${sub})`;
        subSummary.push(prettySum);
        } catch (err) {
          subSpinner.fail(`(${subCount}/${newSubs.length}) ❌ Failed for ${sub}: ${err.message || err}`);
          await markError(`Failed to subscribe to ${sub}`, err);
      }
    }
    subSpinner.succeed(`✅ Synced ${subCount}/${newSubs.length} channel${newSubs.length === 1 ? '' : 's'}`);
    if (!QUIET) {
    if (newSubs.length <= 10) for (const line of subSummary) log(line, { color: 'green' });
    else log(`✅ Added ${newSubs.length} subscriptions (too many to log)`, { color: 'green' });
    }}
    //#endregion
    //#region new playlists
    if (VERBOSE) log(`Starting playlist export...`, { err: 'info' });
  const plSummary = [];
  plSummary.push(`You will need to import the playlists manually into Invidious. Go to your instance > Settings > Import/Export > Import Invidious JSON data and select the generated playlist-import.json file. The playlists are:`);
  const plSpinner = ora(`Preparing playlist export...`).start();
  const playlistsToImport = [];
  plSummary.push('Playlists to import:');
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
        continue; // probably should break here but eh
      }
  plCount++;
  plSpinner.text = `Preparing playlist export... (${plCount}/${newPlaylists.length} playlists)`;
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
  plSummary.push(` - "${pl.title}"`);

}
for (const line of plSummary) log(line, { color: 'green' });
plSpinner.succeed(`✅ Prepared ${playlistsToImport.length} playlist${playlistsToImport.length === 1 ? '' : 's'} for import`);
if (playlistsToImport.length > 0 && hadErrors === false) {
  const importPath = './playlist-import.json';
  writePlaylistImport(playlistsToImport, importPath);
  log(`📤 Wrote ${playlistsToImport.length} playlists to ${importPath}`, { color: 'green' });
} else {
  log(`✅ No new playlists to import`);
}
} catch (err) {
  plSpinner.fail(`❌ Failed to prepare playlist import, ${err.message || err}`);
  await markError('Failed to prepare playlist import', err);
}
    //#endregion
    //#region removed history
let removedHisCnt = 0;
// Remove watched videos
    if (removedHistory.length) {
      const rmHSpinner = ora(`Removing videos from watch history... (${removedHisCnt}/${removedHistory.length} videos)`).start();
      const hisRmSummary = [];
      hisRmSummary.push('Videos removed from watch history:');
      for (const videoId of removedHistory) {
      try {
        removedHisCnt++;
        rmHSpinner.text = `Removing videos from watch history... (${removedHisCnt}/${removedHistory.length} videos)`;
      await retryPostRequest(`/auth/history/${videoId}`, null, TOKEN, INSTANCE, INSECURE, 'DELETE');
      const { title, author } = await getVideoNameAndAuthor(videoId, INSTANCE, TOKEN);
      hisRmSummary.push(` - Removed "${title}" by ${author}`);
     } catch (err) {
      rmHSpinner.fail(`(${removedHisCnt}/${removedHistory.length}) ❌ Failed for ${videoId}: ${err.message || err}`);
      await markError('Failed to remove from watch history', err);
      }
    }
    if (!QUIET) {
    if (removedHistory.length <= 10) for (const line of hisRmSummary) log(line);
    else log(`✅ Removed ${removedHistory.length} videos from watch history (too many to log)`, { color: 'green' });
    }
    rmHSpinner.succeed(`✅ Removed ${removedHisCnt}/${removedHistory.length} videos from watch history`);
  }
    //#endregion
    //#region removed subs
  let removedSubCnt = 0;
  const subRmSummary = [];
  subRmSummary.push('Channels unsubscribed from:');
  if (removedSubs.length && !SUBS) {
  const rmSSpinner = ora(`Unsubscribing from channels... (${removedSubCnt}/${removedSubs.length} channels)`).start();
    // Unsubscribe from channels
    for (const ucid of removedSubs) {
     try {
       removedSubCnt++;
      // maybe i should use the `const res = ...` block i removed here to check for 404s and stuff
      // but ill only do that if someone complains
      await retryPostRequest(`/auth/subscriptions/${ucid}`, null, TOKEN, INSTANCE, INSECURE, 'DELETE');
      const name = await getChannelName(ucid, INSTANCE);
      const prettySum = `- ${name} (${ucid})`;
      subRmSummary.push(prettySum);
      rmSSpinner.text = `Unsubscribing from channels... (${removedSubCnt}/${removedSubs.length} channels)`;
      } catch (err) {
        rmSSpinner.fail(`(${removedSubCnt}/${removedSubs.length}) ❌ Failed for ${ucid}: ${err.message || err}`);
        await markError(`Failed to unsubscribe from ${ucid}`, err);
     }
    }
    rmSSpinner.succeed(`✅ Unsubscribed from ${removedSubCnt}/${removedSubs.length} channels`);
    for (const line of subRmSummary) log(line, { color: 'green' });
  }
    //#endregion
    //#region removed playlists
  if (VERBOSE) log(`Processing removed playlists...`, { err: 'info' });
  // Remove deleted playlists from playlist-import.json
  const importPath = './playlist-import.json';
  if (removedPlaylists.length > 0 && existsSync(importPath)) {
    try {
    log(`sorry but the way I made this logic, there won't be a nice spinner for this part`, { err: 'info' });
    const importData = JSON.parse(readFileSync(importPath, 'utf-8'));
    
    // Filter out any playlists matching removed titles (case-insensitive)
    importData.playlists = importData.playlists.filter(pl =>
      !removedPlaylists.some(rp => rp.title.toLowerCase() === pl.title.toLowerCase())
    );
    
    writeFileSync(importPath, JSON.stringify(importData, null, 2));
    log(`🗑️ Removed ${removedPlaylists.length} playlists from ${importPath}`, { err: 'info' });
  } catch (err) {
    await markError(`Failed to update ${importPath} after removals`, err);
  }
}   //#endregion
   //#region final write 
    if (!hadErrors) {
      writeNewExport(output);
      if (!QUIET) {
        log(`✅ Exported to ${stripDir(OUTPUT_FILE)} and updated ${stripDir(OLD_EXPORT_PATH)}`);
      }
      if (QUIET) {
        log(`Sync complete. Exported to ${stripDir(OUTPUT_FILE)} and updated ${stripDir(OLD_EXPORT_PATH)}`);
      }
    } else {
      await runHook('onError', { error: 'check cmd' });
      log('⚠️ Some sync operations failed. Export not saved. Run with -v or --verbose for details.', { err: 'warning' });
    }
  } else {
     if (!hadErrors) {
      noSyncWrite(output, OUTPUT_FILE, QUIET);
      }
    else {
      // do this stupid log message because i dont have data from markerror
      // i know i could just pass the error message, but i want to release this sooner
      // this is extremely unprofessional, but that also reflects on the code quality
      await runHook('onError', { error: 'look at the terminal idk bro' });
      log('⚠️ Some sync operations failed. Export not saved. Run with -v or --verbose for details.', { err: 'warning' });
    }
  }
await runHook('afterSync', { data: newData });
}
//#endregion
//#region call main and schedule
// Kick off
const modulePath = realpathSync(fileURLToPath(import.meta.url));
const entryPath = realpathSync(resolve(process.argv[1] || ""));
if (modulePath === entryPath) {
await main().catch( async err => {
  log(`❌ Fatal error: ${err}`, { err: 'error' });
  logConsoleOutput();
  await runHook('onError', { error: err });
  console.log('waiting for writes to finish before exiting')
setTimeout(() => {
  process.exit(1);
}, 100);
});
};
await maybeSchedule();
logConsoleOutput();
export default main;