<!-- just a file to make the releases from for the automation script -->
<!-- edit this per release -->
<!-- when should i try properly versioning? -->
## major release 2.0.0 - 2026-01-1
my new years resolution is to use semver properly
### Changelog: 
- fix a bug where some logs wouldn't be silenced with the `--silent` flag
- happy new year person reading this!
- add some better sanitization for paths and filenames
- fix keytar loading on linux systems
- cleanup codebase and directories a bit
- qol improvements
- also some internal changes that shouldn't affect users (like better comments and stuff)
### Breaking Changes:
- some people will need to redo token encryption due to changes in keytar loading on linux systems
- changed the way paths are sanitized, so if you had a really weird path before, you might need to change it
- also only allow filenames for certain things like config files, which doesn't allow things like `../` or absolute paths
<!-- im quite lazy, so i don't update the readme often. -->
<!-- ill probably do it next release -->
### Install:
```
npm i -g ft-to-inv@2.0.0
ft-to-inv --first-time-setup
```
or install the same thing but on github:
```
npm i -g https://github.com/riki-pedia/ft-to-inv
ft-to-inv --first-time-setup
```
<!-- i am extremely unprofessional, so you'll see whatever i didn't feel like doing scattered throughout the codebase -->

