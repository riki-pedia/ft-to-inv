# FreeTube to Invidious Exporter
Takes FreeTube data and exports it to invidious-import.json, where it can be optionally imported to Invidious via the API. You can also schedule runs via the --cron flag, see below.
## Installation
You can get this CLI from npm, here's the install:
```
$ npm i -g ft-to-inv
$ ft-to-inv --first-time-setup
```
You can also clone the repo and run via `node`
```
git clone https://github.com/riki-pedia/ft-to-inv
cd ft-to-inv
node src/export.js --first-time-setup
```
## Config
You can do a lot with this, but I'm not very good at writing READMEs. Here's a list of the config flags and ways to use them. These are listed in the order that they take precedence 
  ### CLI Arguments
| Argument | Aliases | Explanation | Usage |
| ------- | -------- | ------- | ----- |
| --token| -t | Your Invidious SID token. This is required unless using no-sync or dry-run. You can get it by going to your instance > Settings/Preferences > Manage Tokens. | -t abc123 |
|--instance| -i | Your Invidious instance. Required unless you have no-sync or dry-run enabled. | -i https://invidious.example.com |
|--freetube-dir| -dir, -cd, -f| Path to the FreeTube data directory. Defaults to a certain path based on which OS you have. On Windows, it's yourUser\AppData\Roaming\FreeTube. On Linux, it's yourUsersHome/.config/FreeTube/. On MacOS, it defaults to you/Library/Application Support/FreeTube/. If it's not there you need to specify where it is with this flag.| -dir ./ |
| --export-dir | -e | Where export files should be saved. The default is wherever the command is being run from (./). Exports 2 files, 3 if there are playlists, *invidious-import.json,* *import.old.json*, and *playlist-import.json*. *invidious-import.json* is for you to import into invidious (if there's no API), *import.old.json* is a copy of *invidious-import.json* used for tracking diffs, and *playlist-import.json* is used for importing playlists specifically into Invidious as there's no API endpoint. | -e .\ |
| --verbose | -v | Enables more verbose logging (WIP!). Useful for debugging or seeing how it works| -v |
| --dry-run | none | Dry Run mode is useful for checking if you have correct files. It only reads the FreeTube files, checks what it would sync, then exits | --dry-run |
| --quiet | -q | Enables less verbose logging, surpresses all non-error messages. | -q |
| --no-sync | none | No-sync mode generates an *invidious-import.json* file but does not contact the Invidious API. Useful for cases where the API is disabled or where you don't feel comfortable pasting your Invidious token. | --no-sync |
| --dont-shorten-paths | none | Disables path shortening, by default your export and FreeTube data directories are replaced with *\<ExportDir\>* and *\<FreeTubeDir\>*| --dont-shorten-paths | 
| --dont-run-first-time-setup | -drs, --dont-run-setup| Skip the first time setup prompts and get straight to syncing. Useful for automated runs. | -drs |
| --run-first-time-setup | -fts, --first-time-setup | Runs the first time setup even if all the files are detected. Useful if there are malformed or corrupt entries, or something changed. | -fts |
| --insecure | --http | Tells the script to run in HTTP mode, rather than HTTPS. This is automatically set based on the protocol entered in --instance | --insecure |
| --cron-schedule | --cron, -cron | Allows you to schedule a run on a cron schedule. If not used with an = or quotes, it checks the next 4-5 args | --cron 0 * * * * |
| --config | -c | Path to the config file. | -c config.example.jsonc
| --help | -h, -?, /? | Displays a help message that is only slightly better than this README | -h | 
#### Usage with args
```
npx ft-to-inv -t abc123 -i localhost:3000 
```
### Environment Variables
This tool also supports using environment variables to control the config! Every variable has only a few possible aliases. Here's an example for `token`.
```
FT_TO_INV_TOKEN
FT_TO_INV_CONFIG_TOKEN
TOKEN
```
Most other flags have those 3 prefixes
### Config 
There's a config file that you can use to further change the program. The config is read after environment variables and CLI arguments, here's the order:
`cli args > envrironment variables > config`.
The config is a simple jsonc file, here's an excerpt:
```
{
  "token":"abc123",
  "instance":"http://localhost:3000",
  "verbose":"true",
  "dont_shorten_paths":"false"
}
```
If you need help with any of the config options, there's comments in the config file, and there's a help menu. If there's anything else, please open an issue on the repo.
## Contributing
This repo follows the standard approach to contributing, just make a fork of the repo and submit a PR. 