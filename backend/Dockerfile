# Built from the repository root (context "."), because the monthly report
# reuses the frontend's calculations and translations instead of copying them.
FROM node:26-alpine
# A Unicode font for the PDF report (€, −, →).
RUN apk add --no-cache font-dejavu
# Dates in the report and the send day follow this zone; override with TZ.
ENV TZ=Europe/Amsterdam
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm install --omit=dev
COPY backend/ ./
COPY frontend/package.json ../frontend/package.json
COPY frontend/src/finance.js ../frontend/src/finance.js
COPY frontend/src/locales/ ../frontend/src/locales/
EXPOSE 8080
CMD ["node", "server.js"]
