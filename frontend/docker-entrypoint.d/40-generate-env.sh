#!/bin/sh
# Renders env.js from the API_TOKEN and LANGUAGE env vars at container startup.
# This allows the browser app to use runtime configuration for locale selection.
set -eu

envsubst '${API_TOKEN} ${LANGUAGE}' < /etc/nginx/env.js.template > /usr/share/nginx/html/env.js
