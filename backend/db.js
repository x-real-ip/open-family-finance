import pg from "pg";

const { Pool } = pg;

// Connection via DATABASE_URL — no credentials in the code.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create the table if it does not exist yet (idempotent, runs at startup).
export async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS app_state (
      key        TEXT PRIMARY KEY,
      value      JSONB NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
}
