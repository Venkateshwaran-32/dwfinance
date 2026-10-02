#!/bin/bash
# Double-click to start dwfinance on a Mac.
cd "$(dirname "$0")" || exit 1
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1
if ! command -v node >/dev/null 2>&1; then
  echo "dwfinance needs Node.js, which is free."
  echo "The download page is opening now. Install the LTS version, then double-click this file again."
  open "https://nodejs.org/en/download"
  read -r -p "Press Enter to close this window."
  exit 1
fi
node scripts/start.mjs
read -r -p "dwfinance has stopped. Press Enter to close this window."
