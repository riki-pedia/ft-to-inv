<!-- just a file to make the releases from for the automation script -->
<!-- edit this per release -->
## Hotfix 1.0.1 - 2025/9/23
### Changelog: 
- Add conditional running of the main sync function based on how you run it.
- This means if you run it with `npx` or just `ft-to-inv` it will run the main sync function.
- If you import the module in another script it will not run the main sync function automatically.
- This allows for better modularity and reusability of the code.
- I did something else but I can't remember what it was.

<!-- im quite lazy, so i don't update the readme often. -->
<!-- ill probably do it next release -->
### Install:
```
npm i -g ft-to-inv@1.0.2
ft-to-inv --first-time-setup
```
<!-- i am extremely unprofessional, so youll see whatever i didnt feel like doing scattered throughout the codebase -->
