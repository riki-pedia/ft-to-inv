import { appendFileSync, existsSync, mkdirSync } from 'fs'
import path from 'path'
import chalk from 'chalk'
import { getGlobalVars } from './args.js'
import { runHook } from './loader.js'
let globals, LOGS_BOOLEAN
const consoleOutput = []
let timesShown = 0
let written = false
// function that takes all of the console output, and logs it to a file
export async function logConsoleOutput() {
  try {
    const makeFilename = () => {
      // make a dynamic and READABLE filename based on a few things:
      // run status (success, error, etc) and timestamp
      // the time should be in a friendly format, not just ISO. maybe we make dirs based on date, and then have files named with time and status?
      const folderName = `${new Date().getFullYear()}-${new Date().getMonth() + 1}-${new Date().getDate()}`
      return folderName
    }
    // temporary usage
    const folder = makeFilename()
    if (written === true) return
    globals = getGlobalVars()
    LOGS_BOOLEAN = globals.logs || false
    if (LOGS_BOOLEAN === false) return
    else {
      const logData = consoleOutput.join('\n') + '\n'
      // check if log dir exists, if not create it. then append the log data to the file
      const logsDir = path.join(process.cwd(), 'logs')
      if (existsSync(logsDir) === false) {
        mkdirSync(logsDir)
      }
      if (existsSync(path.join(logsDir, folder)) === false) {
        mkdirSync(path.join(logsDir, folder))
      }
      const success = globals.success || false
      const status = success === true ? 'success' : 'error'
      let file = `ft-to-inv-${status}-log-${new Date().getHours()}-${new Date().getMinutes()}-${new Date().getSeconds()}.log`
      let filePath = path.join(logsDir, folder, file)
      if (existsSync(path.join(logsDir, folder, file)) == true) {
        // if file exists already, add a second timestamp to the end of the filename to prevent overwriting
        const newFile = `${file}-${new Date().getSeconds()}`
        filePath = path.join(logsDir, folder, newFile)
      }
      appendFileSync(filePath, logData)
      written = true
      if (timesShown === 0) {
        console.log(`[ft-to-inv] ✅ Logged console output to ${filePath}`)
        timesShown += 1
      }
    }
  } catch (err) {
    console.error('[ft-to-inv] ❌ Failed to write logs to a file:\n', err)
  } finally {
    // clear the console output after logging
    consoleOutput.length = 0
  }
}
/**
 * Logs a message to the console and a provided output array with optional styling.
 * @param {string} message - The message to log.
 * @param {object} [options={}] - Optional parameters.
 * @param {Array<string>} [options.c=consoleOutput] - The output array to push the message into.
 * @param {string} [options.err] - If 'error' or 'warning', logs the message with appropriate styling. (deprecated)
 * @param {string} [options.level] - The level of the log message ('info', 'warn', 'error'). This is the preferred option over 'err'.
 * @param {string} [options.color] - Optional chalk color to style the message.
 */
export function log(message, options = {}) {
  // backwards compatibility for plugins that use err instead of level
  try {
    const { level = null, color = null, err = null } = options
    const timestamp = new Date().toISOString()
    globals = getGlobalVars()
    const quiet = globals.quiet
    const silent = globals.silent

    if (!level && !color && !err && silent !== true && quiet !== true) {
      // make [ft-to-inv] stick out
      consoleOutput.push(`${timestamp} [ft-to-inv] INFO: ${message}`)
      runHook('onLog', { message, level: 'info', timestamp, name: 'ft-to-inv' })
      console.log(chalk.white('[ft-to-inv] ') + message)
    }
    if ((level || err) === 'fatal') {
      consoleOutput.push(`${timestamp} [ft-to-inv] FATAL: ${message}`)
      runHook('onLog', { message, level, timestamp, name: 'ft-to-inv' })
      console.error('[ft-to-inv] ' + chalk.bgRed.white('Fatal Error! ') + message)
      // rather than exiting here, we can go on the assumption that the error is caught and exited in export.js with additional context, so we just log it as fatal and let export.js handle the rest
    }
    if ((level || err) === 'error') {
      consoleOutput.push(`${timestamp} [ft-to-inv] ERROR: ${message}`)
      runHook('onLog', { message, level, timestamp, name: 'ft-to-inv' })
      console.error('[ft-to-inv] ' + chalk.red('Error! ') + message)
    }
    if ((level || err) === 'warning') {
      if (silent) return
      consoleOutput.push(`${timestamp} [ft-to-inv] WARN: ${message}`)
      runHook('onLog', { message, level, timestamp, name: 'ft-to-inv' })
      console.warn('[ft-to-inv] ' + chalk.yellow('Warning! ') + message)
    }
    if ((level || err) === 'info') {
      if (silent === true || quiet === true) return
      consoleOutput.push(`${timestamp} [ft-to-inv] INFO: ${message}`)
      runHook('onLog', { message, level, timestamp, name: 'ft-to-inv' })
      console.info('[ft-to-inv] ' + chalk.blue('Info: ') + message)
    }
    if (color !== null && color !== undefined) {
      if (silent === true || quiet === true) return
      consoleOutput.push(`${timestamp} [ft-to-inv] INFO: ${message}`)
      runHook('onLog', { message, level: 'info', timestamp, name: 'ft-to-inv' })
      console.log('[ft-to-inv] ' + chalk[color](message))
    }
  } catch {
    // stdout probably doesnt exist, just skip logging
  }
}
export function pluginLog(message, options = {}) {
  // similar to log but for plugins; adds [plugin] tag
  try {
    const { level = null, color = null, err = null, name = 'name-not-provided' } = options
    const timestamp = new Date().toISOString()
    globals = getGlobalVars()
    const quiet = globals.quiet
    const silent = globals.silent

    if (!level && !color && !err && silent !== true && quiet !== true) {
      // make [plugin] stick out
      consoleOutput.push(
        `${timestamp} [plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] INFO: ${message}`
      )
      runHook('onLog', {
        message,
        level: 'info',
        timestamp,
        name: `plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}`,
      })
      console.log(
        chalk.white(`[plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] `) +
          message
      )
    }
    if ((level || err) === 'fatal') {
      consoleOutput.push(
        `${timestamp} [plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] FATAL: ${message}`
      )
      runHook('onLog', {
        message,
        level,
        timestamp,
        name: `plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}`,
      })
      console.error(
        `[plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] ` +
          chalk.bgRed.white('Fatal Error! ') +
          message
      )
    }
    if ((level || err) === 'error') {
      consoleOutput.push(
        `${timestamp} [plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] ERROR: ${message}`
      )
      runHook('onLog', {
        message,
        level,
        timestamp,
        name: `plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}`,
      })
      console.error(
        `[plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] ` +
          chalk.red('Error! ') +
          message
      )
    }
    if ((level || err) === 'warning') {
      if (silent) return
      consoleOutput.push(
        `${timestamp} [plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] WARN: ${message}`
      )
      runHook('onLog', {
        message,
        level,
        timestamp,
        name: `plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}`,
      })
      console.warn(
        `[plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] ` +
          chalk.yellow('Warning! ') +
          message
      )
    }
    if ((level || err) === 'info') {
      if (silent === true || quiet === true) return
      consoleOutput.push(
        `${timestamp} [plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] INFO: ${message}`
      )
      runHook('onLog', {
        message,
        level,
        timestamp,
        name: `plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}`,
      })
      console.info(
        `[plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] ` +
          chalk.blue('Info: ') +
          message
      )
    }
    if (color !== null && color !== undefined) {
      consoleOutput.push(
        `${timestamp} [plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] INFO: ${message}`
      )
      runHook('onLog', {
        message,
        level: 'info',
        timestamp,
        // make sure plugin devs cant get any funny ideas
        name: `plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}`,
      })
      console.log(
        `[plugin: ${name.trim() === 'ft-to-inv' ? 'imposter-ft-to-inv' : name}] ` +
          chalk[color](message)
      )
    }
  } catch {
    // stdout probably doesnt exist, just skip logging
  }
}
