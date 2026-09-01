import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// Lazy initialization: importing this module during `next build` must never
// require DATABASE_URL (page-data collection imports route modules without a
// database present). The connection is created on FIRST actual use — i.e. at
// request time in production, where DATABASE_URL is configured.

const globalForDb = globalThis as typeof globalThis & {
  __auraNextJsPostgresqlPool?: Pool;
  __auraNextJsPostgresqlDb?: NodePgDatabase;
};

function init(): NodePgDatabase {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const pool = new Pool({
    connectionString: databaseUrl,
    // serverless-friendly: short idle timeout, dont hoard connections
    max: 5,
    idleTimeoutMillis: 20_000,
  });
  globalForDb.__auraNextJsPostgresqlPool = pool;
  const db = drizzle(pool);
  globalForDb.__auraNextJsPostgresqlDb = db;
  return db;
}

function getDb(): NodePgDatabase {
  return globalForDb.__auraNextJsPostgresqlDb ?? init();
}

function getPool(): Pool {
  getDb();
  return globalForDb.__auraNextJsPostgresqlPool!;
}

function lazy<T extends object>(resolve: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const real = resolve() as Record<PropertyKey, unknown>;
      const value = Reflect.get(real, prop, receiver);
      return typeof value === "function" ? value.bind(real) : value;
    },
  });
}

export const pool = lazy<Pool>(getPool);
export const db = lazy<NodePgDatabase>(getDb);
