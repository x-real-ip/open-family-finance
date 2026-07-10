#!/bin/sh
# Renders env.js from the API_TOKEN, LANGUAGE, APP_TITLE and PAPERLESS_ENABLED
# env vars at container startup. This allows the browser app to use runtime
# configuration for locale, branding and optional integrations.
set -eu

envsubst '${API_TOKEN} ${LANGUAGE} ${APP_TITLE} ${PAPERLESS_ENABLED}' < /etc/nginx/env.js.template > /usr/share/nginx/html/env.js
