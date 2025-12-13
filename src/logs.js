import { appendFileSync } from 'fs'
import chalk from 'chalk'
import { getGlobalVars } from './args.js'
let globals, LOGS_BOOLEAN
// took these from utils because it wasn't universal, this is the only way
const consoleOutput = []
// Sanitize the date to be used in a filename by replacing invalid characters.
const date = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')
let outFile = `ft-to-inv-log-${date}.txt`
let timesShown = 0
// function that takes all of the console output, and logs it to a file
export async function logConsoleOutput(file = outFile, outputArr = consoleOutput) {
  outFile = LOGS_BOOLEAN ? outFile : undefined
  globals = await getGlobalVars()
  LOGS_BOOLEAN = globals.logs || false
  if (file === undefined) return
  // Join the array and write it once. Use appendFileSync to add to existing file.
  const logData = outputArr.join('\n') + '\n'
  appendFileSync(file, logData)
  if (timesShown === 0) {
    console.log(`[ft-to-inv] ✅ Logged console output to ${file}`)
    timesShown += 1
  } // Clear the array after writing to prevent writing the same logs multiple times
  // if this function is called more than once.
  consoleOutput.length = 0
}
/**
 * Logs a message to the console and a provided output array with optional styling.
 * @param {string} message - The message to log.
 * @param {object} [options={}] - Optional parameters.
 * @param {Array<string>} [options.c=consoleOutput] - The output array to push the message into.
 * @param {string} [options.err] - If 'error' or 'warning', logs the message with appropriate styling.
 * @param {string} [options.color] - Optional chalk color to style the message.
 */
export function log(message, options = {}) {
  const { c = consoleOutput, err = null, color = null } = options
  const timestamp = new Date().toISOString()
  const formattedMessage = `[${timestamp}] ${message}`
  globals = getGlobalVars()
  const quiet = globals.quiet || false
  const silent = globals.silent || false
  c.push(formattedMessage)

  if (!err && !color) {
    console.log('[ft-to-inv] ' + message)
  }
  if (err === 'error') {
    console.error('[ft-to-inv] ' + chalk.red('Error! ') + message)
  }
  if (err === 'warning') {
    if (silent) return
    console.warn('[ft-to-inv] ' + chalk.yellow('Warning! ') + message)
  }
  if (err === 'info') {
    if (silent || quiet) return
    console.info('[ft-to-inv] ' + chalk.blue('Info: ') + message)
  }
  if (color !== null && color !== undefined) {
    console.log('[ft-to-inv] ' + chalk[color](message))
  }
}
