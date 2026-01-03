# script that loops through all files and converts CRLF to LF
set -euo pipefail
for file in /mnt/c/Users/Ricky/code/ft-export/*; do
  # check if directory, then go in directory
    if [ -d "$file" ] && [ "$file" != "/mnt/c/Users/Ricky/code/ft-export/node_modules" ]; then
        for subfile in "$file"/*; do
            dos2unix "$subfile"
        done
        continue
    fi
  dos2unix "$file"
done