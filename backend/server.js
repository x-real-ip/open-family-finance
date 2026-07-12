/**
 * Open Family Finance — backend API.
 *
 * A tiny JSON-blob store on top of Postgres:
 *   GET    /api/state/:key   -> { key, value } | 404
 *   PUT    /api/state/:key   -> { key, value }   (body: { value })
 *   DELETE /api/state/:key   -> { key, deleted }
 *   GET    /api/health       -> { ok: true }
 *
 * Optional paperless-ngx integration (see paperless.js), enabled with
 * PAPERLESS_ENABLED + PAPERLESS_URL + PAPERLESS_API_TOKEN:
 *   GET  /api/paperless/correspondents                          -> [{ id, name }] | 404 when disabled
 *   POST /api/paperless/correspondents { name }                  -> { id, name }   | 404 when disabled
 *   GET  /api/paperless/labels                                   -> { types: [{id,name}], tags: [{id,name}] } | 404 when disabled
 *   GET  /api/paperless/correspondents/:id/latest-document
 *        [?labelKind=type|tag&labelId=]                          -> { id, title, created, documentType, url } | null | 404 when disabled
 *   GET  /api/paperless/documents?correspondentId=&query=         -> [{ id, title, created, documentType, url }] | 404 when disabled
 *   GET  /api/paperless/documents/:id                             -> { id, title, created, documentType, url } | null | 404 when disabled
 *
 * Optional bearer auth: set API_TOKEN and send "Authorization: Bearer <token>".
 * Startup retries the database connection, so boot order does not matter.
 */
import express from "express";
import { pool, initDb } from "./db.js";
import {
  paperlessEnabled, listCorrespondents, ensureCorrespondent, listDocumentTypes, listTags,
  latestDocumentForCorrespondent, searchDocuments, getDocument,
} from "./paperless.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.API_TOKEN; // optional: simple bearer protection

// Optional token check on all /api routes.
// /api/health is exempt: Kubernetes probes send no Authorization header,
// and the endpoint exposes no data.
app.use("/api", (req, res, next) => {
  if (!TOKEN) return next();
  if (req.path === "/health") return next();
  if (req.headers.authorization === `Bearer ${TOKEN}`) return next();
  res.status(401).json({ error: "unauthorized" });
});

app.get("/api/health", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ status: "ok" });
  } catch (e) {
    res.status(503).json({ status: "db-unavailable" });
  }
});

// Get state
app.get("/api/state/:key", async (req, res) => {
  try {
    const r = await pool.query("SELECT key, value FROM app_state WHERE key = $1", [req.params.key]);
    if (r.rowCount === 0) return res.status(404).json({ error: "not found" });
    res.json(r.rows[0]);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Save state (upsert)
app.put("/api/state/:key", async (req, res) => {
  try {
    await pool.query(
      `INSERT INTO app_state (key, value) VALUES ($1, $2::jsonb)
       ON CONFLICT (key) DO UPDATE SET value = $2::jsonb, updated_at = now()`,
      [req.params.key, JSON.stringify(req.body ?? {})]
    );
    res.json({ key: req.params.key, value: req.body });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// Delete state
app.delete("/api/state/:key", async (req, res) => {
  try {
    await pool.query("DELETE FROM app_state WHERE key = $1", [req.params.key]);
    res.status(204).end();
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "server error" });
  }
});

// List paperless-ngx correspondents, for the entry autocomplete.
app.get("/api/paperless/correspondents", async (_req, res) => {
  if (!paperlessEnabled) return res.status(404).json({ error: "paperless integration disabled" });
  try {
    res.json(await listCorrespondents());
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "paperless unavailable" });
  }
});

// Look up a correspondent by name, creating it in paperless if it doesn't exist yet.
app.post("/api/paperless/correspondents", async (req, res) => {
  if (!paperlessEnabled) return res.status(404).json({ error: "paperless integration disabled" });
  try {
    res.json(await ensureCorrespondent(req.body?.name));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "paperless unavailable" });
  }
});

// Document types and tags, for the per-entry "preferred label" picker.
app.get("/api/paperless/labels", async (_req, res) => {
  if (!paperlessEnabled) return res.status(404).json({ error: "paperless integration disabled" });
  try {
    const [types, tags] = await Promise.all([listDocumentTypes(), listTags()]);
    res.json({ types, tags });
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "paperless unavailable" });
  }
});

// Most relevant document (invoice, contract, ...) linked to a correspondent.
// ?labelKind=type|tag&labelId=<id> prefers a document with that label for
// this specific entry, ahead of the site-wide PAPERLESS_DOCUMENT_TYPE_PRIORITY.
app.get("/api/paperless/correspondents/:id/latest-document", async (req, res) => {
  if (!paperlessEnabled) return res.status(404).json({ error: "paperless integration disabled" });
  try {
    const { labelKind, labelId } = req.query;
    const label = labelKind && labelId ? { kind: labelKind, id: labelId } : null;
    res.json(await latestDocumentForCorrespondent(req.params.id, label));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "paperless unavailable" });
  }
});

// Search a correspondent's documents by free text, for manually picking one.
app.get("/api/paperless/documents", async (req, res) => {
  if (!paperlessEnabled) return res.status(404).json({ error: "paperless integration disabled" });
  const { correspondentId, query } = req.query;
  if (!correspondentId || !String(query || "").trim()) return res.json([]);
  try {
    res.json(await searchDocuments(correspondentId, query));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "paperless unavailable" });
  }
});

// A single document, to display one that was manually pinned to an entry.
app.get("/api/paperless/documents/:id", async (req, res) => {
  if (!paperlessEnabled) return res.status(404).json({ error: "paperless integration disabled" });
  try {
    res.json(await getDocument(req.params.id));
  } catch (e) {
    console.error(e);
    res.status(502).json({ error: "paperless unavailable" });
  }
});

// Try to initialize the database, retrying while it is still starting up.
// This makes the API resilient to startup ordering (Compose, Kubernetes, ...).
async function start() {
  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await initDb();
      app.listen(PORT, () => console.log(`Open Family Finance API listening on port ${PORT}`));
      return;
    } catch (e) {
      console.error(`Database not ready (attempt ${attempt}/${maxAttempts}): ${e.message}`);
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  console.error("Database still unavailable after retries, exiting.");
  process.exit(1);
}

start();
