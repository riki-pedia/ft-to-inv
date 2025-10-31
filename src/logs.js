import { appendFileSync } from 'fs'
import chalk from 'chalk'
import { resolveConfig } from './args.js'
const args = process.argv.slice(2)
const LOGS_BOOLEAN = await resolveConfig('logs', {
  cliNames: ['--logs', '-l'],
  envNames: ['FT_TO_INV_CONFIG_LOGS', 'LOGS', 'FT_TO_INV_LOGS'],
  config: {},
  args: args,
  isFlag: true,
})

// took these from utils because it wasn't universal, this is the only way
const consoleOutput = []
// Sanitize the date to be used in a filename by replacing invalid characters.
const date = new Date().toISOString().replace(/:/g, '-').replace(/\./g, '-')
const outFile = LOGS_BOOLEAN ? `ft-to-inv-${date}.log` : undefined
let timesShown = 0
// function that takes all of the console output, and logs it to a file
export function logConsoleOutput(file = outFile, outputArr = consoleOutput) {
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
  c.push(formattedMessage)

  if (!err && !color) {
    console.log('[ft-to-inv] ' + message)
  }
  if (err === 'error') {
    console.error('[ft-to-inv] ' + chalk.red('Error! ') + message)
  }
  if (err === 'warning') {
    console.warn('[ft-to-inv] ' + chalk.yellow('Warning! ') + message)
  }
  if (err === 'info') {
    console.info('[ft-to-inv] ' + chalk.blue('Info: ') + message)
  }
  if (color !== null && color !== undefined) {
    console.log('[ft-to-inv] ' + chalk[color](message))
  }
}
