#!/bin/bash

# Requires {{PRODUCT}} {{VERSION}} or later and Node.js {{NODE}} or later.
# Follow README.md for setup and keep this folder’s files together.

# @raycast.schemaVersion 1
# @raycast.title Save URL to {{PRODUCT}}
# @raycast.mode compact
# @raycast.packageName {{PRODUCT}}
# @raycast.icon 🔖
# @raycast.argument1 {"type":"text","placeholder":"URL"}
# @raycast.author Hraness
# @raycast.authorURL https://hraness.com
# @raycast.description Queue a URL in your {{PRODUCT}} reading library.

set -euo pipefail
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Node.js is required. Follow the Sponge setup in the README beside this command.'
  exit 1
fi
if [ "$#" -ne 1 ]; then
  printf '%s\n' 'Enter one URL.'
  exit 1
fi
directory="$(cd -- "$(dirname -- "$0")" && pwd -P)"
exec node "$directory/sponge.mjs" save "$1"
