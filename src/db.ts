// src/db.ts
import sql from "mssql";

// Read connection details from .env
const config = {
  server:     process.env.MSSQL_HOST     ?? "192.168.0.122",
  port:       Number(process.env.MSSQL_PORT ?? 1433),
  database:   process.env.MSSQL_DATABASE ?? "YunuscoERP",
  user:       process.env.MSSQL_USER     ?? "sa",
  password:   process.env.MSSQL_PASSWORD ?? "Hello123",
  options: {
    encrypt: true,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  connectionTimeout: 60000,
  requestTimeout: 60000,
};

let pool = null;

async function getPool() {
  if (!pool) {
    pool = await sql.connect(config);
    console.log("✅ Connected to MSSQL database");
  }
  return pool;
}

export async function query(sqlQuery) {
  const connectionPool = await getPool();
  try {
    const result = await connectionPool.request().query(sqlQuery);
    return result.recordset;
  } catch (err) {
    console.error("MSSQL Query Error:", err);
    throw err;
  }
}

export async function closePool() {
  if (pool) {
    await pool.close();
    pool = null;
    console.log("✅ MSSQL connection closed");
  }
}

process.on("SIGINT", async () => {
  await closePool();
  process.exit(0);
});