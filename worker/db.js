import pg from 'pg';

let _pool = null;

/**
 * Get a Postgres connection pool for the worker process.
 */
export function getPool() {
  if (!_pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL not set — worker requires Postgres');
    }
    _pool = new pg.Pool({ connectionString });
  }
  return _pool;
}

/**
 * Update a job's status and metadata in the jobs table.
 */
export async function updateJob(jobId, fields) {
  const pool = getPool();
  const sets = [];
  const values = [];
  let idx = 1;

  for (const [key, value] of Object.entries(fields)) {
    // Convert camelCase to snake_case
    const col = key.replace(/[A-Z]/g, c => '_' + c.toLowerCase());
    sets.push(`${col} = $${idx}`);
    values.push(value);
    idx++;
  }

  sets.push(`updated_at = $${idx}`);
  values.push(Date.now());
  idx++;

  values.push(jobId);
  await pool.query(
    `UPDATE jobs SET ${sets.join(', ')} WHERE id = $${idx}`,
    values
  );
}

/**
 * Get a job record from the jobs table.
 */
export async function getJob(jobId) {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM jobs WHERE id = $1', [jobId]);
  return rows[0] || null;
}

/**
 * Insert a job_capabilities usage record.
 */
export async function recordCapabilityUsage(jobId, capabilityId, tokensUsed) {
  const pool = getPool();
  const id = crypto.randomUUID();
  await pool.query(
    `INSERT INTO job_capabilities (id, job_id, capability_id, tokens_used, created_at) VALUES ($1, $2, $3, $4, $5)`,
    [id, jobId, capabilityId, tokensUsed || 0, Date.now()]
  );
}

/**
 * Get all enabled capabilities.
 */
export async function getCapabilities() {
  const pool = getPool();
  const { rows } = await pool.query('SELECT * FROM capabilities WHERE enabled = 1');
  return rows;
}

/**
 * Close the pool (for graceful shutdown).
 */
export async function closePool() {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
