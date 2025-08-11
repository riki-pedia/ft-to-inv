// just a script to clear old import files and start fresh
// useful for testing functions like playlist import or writing configs
// assumes that export files are in the same directory as this script
// also optionally deletes ft-to-inv.jsonc if the user passes the --config flag
const fs = require('fs');
const path = require('path');

const args = process.argv.slice(2);
const clearDir = path.resolve('./')
/**
 * @param {string[]} args - CLI arguments (e.g., from process.argv).
 * @param {string[]} aliases - List of CLI flags to check (e.g., ['--dry-run']).
 * @param {object} config - Parsed config object.
 * @param {string} configKey - Key in the config file (e.g., 'dry_run').
 * @returns {boolean} - Resolved boolean value.
 */
function clearFiles(configFlag = false) {
let filesToClear = [];
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
});
}
module.exports = {
  clearFiles
}