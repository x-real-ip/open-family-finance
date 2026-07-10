#!/bin/sh
# Renders env.js from the API_TOKEN, LANGUAGE and APP_TITLE env vars at container startup.
# This allows the browser app to use runtime configuration for locale and branding.
set -eu

envsubst '${API_TOKEN} ${LANGUAGE} ${APP_TITLE}' < /etc/nginx/env.js.template > /usr/share/nginx/html/env.js
