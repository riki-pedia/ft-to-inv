<!-- just a file to make the releases from for the automation script -->
<!-- edit this per release -->
<!-- when should i try properly versioning? -->
## minor release 2.1.0 - 2026-01-4
### Changelog: 
- add a single typescript definition file for the project, which should be enough
- add better context for plugins to use 
- minor code cleanup and refactoring
- better error handling and logging for plugin execution
- add some new log levels
- refactor logger internally
- add some directories for logs to be stored in
- i have some big things planned for the future, and this is just a small step towards that, make sure to stay tuned and star the repo if you haven't already so you don't miss out on the future updates
- stop reading this and go try the new version out
### Breaking Changes:
potentially breaks some plugins that relied on the old context, but i tried to make it as backwards compatible as possible. if your plugin is broken, please let me know and i'll help you fix it.
<!-- im quite lazy, so i don't update the readme often. -->
<!-- ill probably do it next release -->
### Install:
```
npm i -g ft-to-inv@2.1.0
ft-to-inv --first-time-setup
```
or install the same thing but on github:
```
npm i -g https://github.com/riki-pedia/ft-to-inv
ft-to-inv --first-time-setup
```
<!-- i am extremely unprofessional, so you'll see whatever i didn't feel like doing scattered throughout the codebase -->

