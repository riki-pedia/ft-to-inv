<!-- just a file to make the releases from for the automation script -->
<!-- edit this per release -->
<!-- when should i try properly versioning? -->
## Hotfix 1.0.4 - 2022-9-25
### Changelog: 
- Fixed a bug that borked all linux apt installs of Node.JS due to me using experimental stuff because i dev on windows and it works fine there
- also you can install with `npm i -g https://github.com/riki-pedia/ft-to-inv` if you want the github pkg.
- (its exactly the same as npm, just a different source)
- the command i used to provide was `npm i @riki-pedia/ft-to-inv` because i have a custom namespace in my .npmrc. 
- yall need to tell me when theres something like this because the only way i found it was testing in wsl
- start a github discussion please?
<!-- im quite lazy, so i don't update the readme often. -->
<!-- ill probably do it next release -->
### Install:
```
npm i -g ft-to-inv@1.0.4
ft-to-inv --first-time-setup
```
<!-- i am extremely unprofessional, so youll see whatever i didnt feel like doing scattered throughout the codebase -->

