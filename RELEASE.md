<!-- just a file to make the releases from for the automation script -->
<!-- edit this per release -->
<!-- when should i try properly versioning? -->
## minor release 2.2.0 - 2026-01-28
### Changelog: 
- add some new hooks:
    - beforeHistorySync
    - duringHistorySync
    - afterHistorySync
    - beforeSubSync
    - duringSubSync
    - afterSubSync
    - beforePlaylistSync
    - duringPlaylistSync
    - afterPlaylistSync
    - beforeHistoryRemoval
    - duringHistoryRemoval
    - afterHistoryRemoval
    - ( more just like the ones above for removed subscriptions and playlists )
    - onSyncError (runs on the markError function calls, which happens before throwing errors in sync processes)
    - onLog (note: this is the only hook that is synchronous and not async) (also runs on every log call)
    - onRetry (runs when a request is retried)
- improve help system
- improve internal logging and its usage
- better data for above hooks
- various small improvements and fixes
- official support for importing as a library
- update deps
- improve handling of cron jobs
### Breaking Changes:
- none 
<!-- im quite lazy, so i don't update the readme often. -->
<!-- ill probably do it next release -->
### Install:
```
npm i -g ft-to-inv@2.2.0
ft-to-inv --first-time-setup
```
or install the same thing but on github:
```
npm i -g https://github.com/riki-pedia/ft-to-inv
ft-to-inv --first-time-setup
```
<!-- i am extremely unprofessional, so you'll see whatever i didn't feel like doing scattered throughout the codebase -->

