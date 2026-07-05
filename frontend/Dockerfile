# --- Build ---
FROM node:20-alpine AS build
WORKDIR /app
# Optional bearer token, baked into the bundle at build time. Must match the
# backend's API_TOKEN. Leave empty for an open API (e.g. on a private LAN).
ARG VITE_API_TOKEN=
ENV VITE_API_TOKEN=$VITE_API_TOKEN
COPY package*.json ./
RUN npm install
COPY . .
RUN npm run build

# --- Serve ---
FROM nginx:1.27-alpine
# The official nginx image substitutes ${BACKEND_URL} via envsubst at startup.
COPY default.conf.template /etc/nginx/templates/default.conf.template
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
