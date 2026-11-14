#!/bin/bash

# Requires {{PRODUCT}} {{VERSION}} or later and Node.js {{NODE}} or later.
# Follow README.md for setup and keep this folder’s files together.

# @raycast.schemaVersion 1
# @raycast.title Search {{PRODUCT}}
# @raycast.mode fullOutput
# @raycast.packageName {{PRODUCT}}
# @raycast.icon 🔎
# @raycast.argument1 {"type":"text","placeholder":"Search saved text"}
# @raycast.author Hraness
# @raycast.authorURL https://hraness.com
# @raycast.description Find up to 20 results in your {{PRODUCT}} library.

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is required. Follow the Sponge setup in the README beside this command.'
  exit 1
fi
if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Enter one search phrase.'
  exit 1
fi
directory="$(cd -- "$(dirname -- "$0")" && pwd -P)"
exec node "$directory/sponge.mjs" search "$1"
