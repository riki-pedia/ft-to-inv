import { writeFileSync } from 'fs'
import chalk from 'chalk';
// took these from utils because it wasn't universal, this is the only way

// function that takes all of the console output, and logs it to a file
export function logConsoleOutput(file, outputArr) {
    writeFileSync(file, outputArr.join('\n'));
    console.log(`✅ Logged console output to ${file}`);
  }
  /**
   * Logs a message to the console and a provided output array with optional styling.
   * @param {string} message - The message to log.
   * @param {Array<string>} c - The output array to push the message into.
   * @param {boolean} err - If true, logs the message as an error.
   * @param {boolean} warn - If true, logs the message as a warning.
   * @param {string} color - Optional chalk color to style the message.
   */
export function log(message, c, err, warn, color) {
    c.push(message);
    if (!err && !warn && !color) {
        console.log(message);
    }
    if (err) {
        console.error(chalk.red("Error! ") + message);
    }
    if (warn) {
        console.warn(chalk.yellow("Warning! ") + message);
    }
    if (color !== undefined && color !== null) {
        console.log(chalk[color](message));
    }
}