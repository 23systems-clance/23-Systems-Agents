const pg = require('pg');
const c = new pg.Client(process.env.DATABASE_URL);
(async () => {
  await c.connect();
  const r1 = await c.query('SELECT slack_team_id, status FROM workspace_installations');
  console.log('WORKSPACES:', JSON.stringify(r1.rows));
  const r2 = await c.query('SELECT slack_team_id, count(*) as cnt FROM managed_clients GROUP BY slack_team_id');
  console.log('MC_BY_TEAM:', JSON.stringify(r2.rows));
  const r3 = await c.query('SELECT count(*) as cnt FROM managed_clients WHERE slack_team_id IS NULL');
  console.log('NULL_COUNT:', JSON.stringify(r3.rows));
  await c.end();
})().catch(e => { console.error('ERROR:', e.message); process.exit(1); });
