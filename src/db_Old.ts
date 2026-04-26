// src/db.ts
// ──────────────────────────────────────────────────────────────
//  Shared PostgreSQL client used by the agent tools and RAG pipeline.
//  Uses the 'pg' library (no ORM — the agent writes raw SQL).
// ──────────────────────────────────────────────────────────────

import pg from "pg";

const { Pool } = pg;

// Read connection details from .env
const pool = new Pool({
  host:     process.env.PG_HOST     ?? "localhost",
  port:     Number(process.env.PG_PORT ?? 5432),
  database: process.env.PG_DATABASE ?? "postgres",
  user:     process.env.PG_USER     ?? "postgres",
  password: process.env.PG_PASSWORD ?? "Hello123",
});

// Test the connection on first import
pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL error:", err);
});

/**
 * Run any SQL string and return all rows as plain objects.
 * The agent calls this function via the "query_database" tool.
 */
export async function query(sql: string): Promise<Record<string, unknown>[]> {
  const client = await pool.connect();
  try {
    const result = await client.query(sql);
    return result.rows;
  } finally {
    client.release(); // always return the connection to the pool
  }
}

/**
 * Safely close the pool — call this at the end of scripts.
 */
export async function closePool(): Promise<void> {
  await pool.end();
}
