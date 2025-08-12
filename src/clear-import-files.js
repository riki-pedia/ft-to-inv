// just a script to clear old import files and start fresh
// useful for testing functions like playlist import or writing configs
// assumes that export files are in the same directory as this script
// also optionally deletes ft-to-inv.jsonc if the user passes the --config flag
const fs = require('fs');
const path = require('path');

const readline = require('readline');
// where the script is run rather than __dirname because it points to src/
const clearDir = path.resolve('./')
async function localPrompt(question, defaultValue = 'n') {
  return new Promise(resolve => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    rl.question(`${question}${defaultValue ? ` [${defaultValue}]` : ''}: `, answer => {
      rl.close();
      resolve(answer.trim() || defaultValue);
    });
  });
}
async function clearFiles(configFlag = false) {
  try {
    let filesToClear = [];
    const delPrompt = await localPrompt('Delete all import files? (y/n)', 'n')
    if (delPrompt.toLowerCase() !== 'y') {
      console.log('Aborting file deletion.');
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
  const filePath = path.join(clearDir, file);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Deleted ${filePath}`);
  }
  else {
    console.log(`File ${filePath} does not exist, skipping.`);
  }
}
);
} catch (err) {
  console.error('Error clearing files:', err);
}
}
module.exports = {
  clearFiles
}