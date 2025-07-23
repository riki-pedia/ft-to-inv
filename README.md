# FreeTube to Invidious Exporter
Takes FreeTube data and exports it to invidious-import.json, where it can be optionally imported to invidious via the API
## Installation
This is a work in progress, for now you can just do this:
```
# clone the repo
git clone https://github.com/riki-pedia/ft-to-invidious-export 
# run the script with use system ca if your on windows/mac and self host an instance with https
# if your on linux, node trusts the system store by default
node --use-system-ca export.js
```