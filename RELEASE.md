<!-- just a file to make the releases from for the automation script -->
<!-- edit this per release -->
<!-- when should i try properly versioning? -->
## minor release 1.2.0 - 2025-10-31
### Changelog: 
- Add silent mode to reduce console output - literally just add `--silent` to the command
- add very-verbose mode for extra debugging info - add `--very-verbose` to the command
- improve error handling for network requests
- add some aliases for commands (eg: `rm` for `remove`)
- fix a bug where plugins that need internal functions dont work (this is because they uses my package as a dependency, which i removed a while ago)
- nice log marker `[ft-to-inv]` for better visibility in console (and to seperate from other jobs you may be running)
- some better marking of files and functions for ppl that want to contribute or make plugins
- change some other internal tools for better maintainability and usability
boo
<!-- im quite lazy, so i don't update the readme often. -->
<!-- ill probably do it next release -->
### Install:
```
npm i -g ft-to-inv@1.2.0
ft-to-inv --first-time-setup
```
or install the same thing but on github:
```
npm i -g https://github.com/riki-pedia/ft-to-inv
ft-to-inv --first-time-setup
```
<!-- i am extremely unprofessional, so you'll see whatever i didn't feel like doing scattered throughout the codebase -->

