# --- Build ---
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# --- Serve ---
FROM nginx:1.27-alpine
# The official nginx image substitutes ${BACKEND_URL} via envsubst at startup.
COPY default.conf.template /etc/nginx/templates/default.conf.template
# Optional bearer token: rendered into env.js from the API_TOKEN env var at
# container startup (not baked into the build), so the same secret the
# backend uses can be reused here. Leave API_TOKEN unset for an open API.
COPY env.js.template /etc/nginx/env.js.template
COPY --chmod=755 docker-entrypoint.d/40-generate-env.sh /docker-entrypoint.d/40-generate-env.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
