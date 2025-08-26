// :skull a 5th helper
// i dont actually need to import :D
// Handles both `--flag value` and `--flag=value`
// was almost safe from the ES nonsense
const args = process.argv.slice(2);
const getArg = (args, names) => {
  for (const name of names) {
    const index = args.findIndex(arg => arg === name || arg.startsWith(name + '='));
    if (name === '--cron' || name === '-cron' || name === '--cron-schedule') {
     const cronParts = args.slice(index + 1, index + 6);
     if (cronParts.length >= 5 && cronParts.every(p => /^(\*|\d+)$/.test(p))) {
       return cronParts.join(' ');
     }
    }
    if (index !== -1) {
      const split = args[index].split('=');
      if (split.length > 1) return split[1];
      return args[index + 1];
    }
  }
  return undefined;
}
function resolveEnvVars(names) {
  for (const key of names) {
    if (process.env[key] !== undefined) return process.env[key];
  }
  return undefined;
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
 *         - positionalArg: string indicating a positional argument name (e.g., "instance"), default null
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
    positionalArg = null
  }
) {
  if (isFlag) {
    // 1. CLI flags
    if (cliNames.some(flag => args.includes(flag))) return true;
    // 2. Positional flag, like `ft-to-inv verbose`
    if (positionalArg !== null && args.includes(positionalArg)) {
      return true;
    }
    // 3. Env flags
    const envVal = resolveEnvVars(envNames);
    if (envVal !== undefined) return envVal === 'true';
    // 4. Config flags
    if (config.hasOwnProperty(key)) return config[key] === true;
    return false;
  } else {
    // 1. CLI values (--foo, -f, --foo=value)
    const cliVal = getArg(args, cliNames);
    if (cliVal !== undefined) return cliVal;
    // 2. Named positional arg, like `ft-to-inv instance https://foo`
    if (positionalArg) {
      const idx = args.indexOf(positionalArg);
      if (idx !== -1 && args[idx + 1] && !args[idx + 1].startsWith('-')) {
        return args[idx + 1];
      }
    }
    // 3. Env values
    const envVal = resolveEnvVars(envNames);
    if (envVal !== undefined) return envVal;
    // 4. Config values
    if (config.hasOwnProperty(key)) return config[key];
    // 5. Fallback
    return fallback;
  }
}

