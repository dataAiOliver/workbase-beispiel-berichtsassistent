// Datenbankzugriff und Migrationsrunner (db/schema.sql + db/migrations/NNN_name.sql).
import pg from 'pg';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
let pool = null;

export function getPool() {
  if (!process.env.DATABASE_URL) return null;
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 5, idleTimeoutMillis: 10_000 });
  return pool;
}

export async function closePool() {
  if (pool) await pool.end();
  pool = null;
}

export async function migrate(client) {
  await client.query(`select pg_advisory_lock(hashtext('elbservice-support:migrate'))`);
  try {
    await client.query(readFileSync(join(root, 'db/schema.sql'), 'utf8'));
    await client.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
    const { rows } = await client.query('select name from schema_migrations');
    const applied = new Set(rows.map((r) => r.name));
    const dir = join(root, 'db/migrations');
    const files = readdirSync(dir).filter((f) => /^\d{3}_.+\.sql$/.test(f)).sort();
    const ran = [];
    for (const file of files) {
      if (applied.has(file)) continue;
      await client.query('begin');
      try {
        await client.query(readFileSync(join(dir, file), 'utf8'));
        await client.query('insert into schema_migrations (name) values ($1)', [file]);
        await client.query('commit');
        ran.push(file);
      } catch (err) {
        await client.query('rollback');
        throw err;
      }
    }
    return ran;
  } finally {
    await client.query(`select pg_advisory_unlock(hashtext('elbservice-support:migrate'))`);
  }
}
