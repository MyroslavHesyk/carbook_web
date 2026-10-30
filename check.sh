#!/usr/bin/env bash
set -euo pipefail

node --check app.js
node --check core.mjs
node --check sw.js
node --test tests/*.test.mjs
