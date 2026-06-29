import express from "express";
import { pool, initDb } from "./db.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

const PORT = process.env.PORT || 8080;
const TOKEN = process.env.API_TOKEN; // optional: simple bearer protection

// Optional token check on all /api routes
app.use("/api", (req, res, next) => {
  if (!TOKEN) return next();
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
