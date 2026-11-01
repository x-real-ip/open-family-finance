#!/bin/sh
# The API reuses the app's calculations and texts for transfer
# notifications. Its image is built from ./backend only, so it keeps its own
# copy in backend/shared/. Run this after changing frontend/src/finance.js
# or the locale texts; frontend/src/finance.test.js fails while the copy is
# out of date.
set -e
cd "$(dirname "$0")/.."
mkdir -p backend/shared/locales
cp frontend/src/finance.js backend/shared/finance.js
cp frontend/src/locales/nl.js frontend/src/locales/en.js backend/shared/locales/
echo "backend/shared is up to date"
