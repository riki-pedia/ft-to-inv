// :skull a 5th helper
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
const dirname = fileURLToPath(import.meta.url)
import path from 'path'
const envPath = path.join(dirname, '../../.env')
dotenv.config({ path: envPath, quiet: true })
// Handles both `--flag value` and `--flag=value`
// was almost safe from the ES nonsense
const getArg = (args, names) => {
  for (const name of names) {
    // args here is a param for the function, not process.argv
    // you would pass in process.argv.slice(2) or something else
    // is it smart? probably not
    // does it work? yes
    // is it worth the effort to make it smarter? no
    const index = args.findIndex(arg => arg === name || arg.startsWith(name + '='))
    if (name === '--cron' || name === '-cron' || name === '--cron-schedule') {
      const cronParts = args.slice(index + 1, index + 6)
      if (cronParts.length >= 5 && cronParts.every(p => /^(\*|\d+)$/.test(p))) {
        return cronParts.join(' ')
      }
    }
    if (index !== -1) {
      const split = args[index].split('=')
      if (split.length > 1) return split[1]
      return args[index + 1]
    }
  }
  return undefined
}
function resolveEnvVars(names) {
  for (const key of names) {
    if (process.env[key] !== undefined) return process.env[key]
  }
  return undefined
}
// isFlag means its either true or false
/**
 *
 * @param {string} key - config key name
 * @param {Object} options - options object
 *         - cliNames: array of CLI argument names (e.g., ['--flag', '-f'])
 *         - envNames: array of environment variable names (e.g., ['ENV_VAR', 'ANOTHER_ENV'])
 *         - config: config object to check for the key, should be config which gives a json object
 *         - args: array of CLI arguments (e.g., process.argv.slice(2)) or just args
 *         - fallback: value to return if not found in any source, default undefined
 *         - isFlag: boolean indicating if the option is a flag (true) or a value (false), default false
 *         - positionalArgs: an array indicating positional argument names (e.g., ["instance", "i"]), default empty array
 *
 */
export async function resolveConfig(
  key,
  {
    cliNames = [],
    envNames = [],
    config = {},
    args = [],
    fallback = undefined,
    isFlag = false,
    positionalArgs = [],
  }
) {
  if (isFlag) {
    // 1. CLI flags (--foo, -f)
    if (cliNames.some(flag => args.includes(flag))) return true
    // 2. Positional flags (like "verbose" or ["verbose","v"])
    for (const alias of positionalArgs) {
      if (args.includes(alias)) return true
    }
    // 3. Env
    const envVal = resolveEnvVars(envNames)
    if (envVal !== undefined) return envVal === 'true'
    // 4. Config
    // ignore linter, looks really dumb when you type it out.
    // eslint-disable-next-line no-prototype-builtins
    if (config.hasOwnProperty(key)) return config[key] === true
    return false
  } else {
    // 1. CLI value args (--foo=bar, --foo bar, etc.)
    const cliVal = getArg(args, cliNames)
    if (cliVal !== undefined) return cliVal
    // 2. Positional value args
    for (const alias of positionalArgs) {
      const idx = args.indexOf(alias)
      if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
        return args[idx + 1]
      }
    }
    // 3. Env
    const envVal = resolveEnvVars(envNames)
    if (envVal !== undefined) return envVal
    // 4. Config
    // eslint-disable-next-line no-prototype-builtins
    if (config.hasOwnProperty(key)) return config[key]
    return fallback
  }
}
// global arg table. the above function will set these values
// strings should be null if not set, booleans should be false if not set
// apparently i use snake_case for the config object but camelCase for literally everything else
export const argTable = {
  token: null,
  instance: null,
  insecure: false,
  cron: null,
  marketplace: null,
  silent: false,
  veryVerbose: false,
  verbose: false,
  freetube_dir: null,
  export_dir: null,
  quiet: false,
  no_sync: false,
  subs: false,
  history: false,
  playlists: false,
  dry_run: false,
  dont_shorten_paths: false,
  logs: false,
}
async function sleep(s) {
  return new Promise(resolve => setTimeout(resolve, s * 1000))
}
// i conveniently export an object for plugins that contains the full config
// we just need to set argTable values from the config object
export async function setGlobalVars(config) {
  Object.assign(argTable, config)
  await sleep(0.5)
}
export async function getGlobalVars() {
  return argTable
}
export default { argTable, resolveConfig, setGlobalVars, getGlobalVars }
