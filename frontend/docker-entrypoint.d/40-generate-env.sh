#!/bin/sh
# Renders env.js from the API_TOKEN env var at container startup, so the same
# secret the backend uses can be passed to the frontend without baking it
# into the (public) image at build time.
set -eu

envsubst '${API_TOKEN}' < /etc/nginx/env.js.template > /usr/share/nginx/html/env.js
