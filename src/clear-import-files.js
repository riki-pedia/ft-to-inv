// just a script to clear old import files and start fresh
// useful for testing functions like playlist import or writing configs
// assumes that export files are in the same directory as this script
// also optionally deletes ft-to-inv.jsonc if the user passes the --config flag
import { existsSync, unlinkSync } from 'fs';
import { resolve as _resolve, join } from 'path';
import chalk from 'chalk';
import { createInterface } from 'readline';
// where the script is run rather than __dirname because it points to src/
const clearDir = _resolve('./')
export async function localPrompt(question, defaultValue = 'n') {
  return new Promise(resolve => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `, answer => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}
export async function clearFiles(configFlag = false) {
  try {
    let filesToClear = [];
    const delPrompt = await localPrompt('Delete all import files? (y/n)', 'n')
    if (delPrompt.toLowerCase() !== 'y') {
      console.log(chalk.rgb(143, 17, 17)('Aborting file deletion.'));
      return;
}

if (configFlag) {
  filesToClear = ['invidious-import.json', 'import.old.json', 'playlist-import.json', 'ft-to-inv.jsonc'];
}
else {
  // only clear import files, not config
filesToClear = ['invidious-import.json', 'import.old.json', 'playlist-import.json'];
}
filesToClear.forEach(file => {
  const filePath = join(clearDir, file);
  if (existsSync(filePath)) {
    unlinkSync(filePath);
    console.log(chalk.red(`Deleted ${filePath}`));
  }
  else {
    console.log(chalk.yellow(`File ${filePath} does not exist, skipping.`));
  }
}
);
} catch (err) {
  console.error('Error clearing files:', err);
}
};