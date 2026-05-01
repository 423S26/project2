/**
 * cleanup-bad-telemetry.mjs
 *
 * One-shot purge of partial-GPS-fix rows from the `telemetry` table.
 *
 * Background: the Goku Nano v3.1 occasionally emitted a Ping with a valid
 * latitude but a longitude near zero (the classic "lon=0.05" garbage seen in
 * /api/v1/telemetry responses).  The old `processSinglePing` gate was OR'd
 * (`lat != 0 || lon != 0`) so those rows were persisted.  The gate has since
 * been tightened to AND + bounds, but the historical garbage still lives in
 * the DB and dominates `GetTelemetry`'s `LIMIT 100`.
 *
 * Run once with:  node scripts/cleanup-bad-telemetry.mjs
 */

import { config } from 'dotenv';
import { neon } from '@neondatabase/serverless';

config({ path: '.env.local' });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set in .env.local');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

console.log('Scanning telemetry for partial-fix garbage rows…\n');

const preview = await sql`
  SELECT COUNT(*)::int AS bad_count
  FROM telemetry
  WHERE longitude IS NOT NULL
    AND latitude  IS NOT NULL
    AND (
      ABS(latitude)  > 90
      OR ABS(longitude) > 180
      OR (ABS(latitude) > 1 AND ABS(longitude) < 1)
    )
`;

const badCount = preview[0]?.bad_count ?? 0;
console.log(`Found ${badCount} bad row(s).`);

if (badCount === 0) {
  console.log('✅  Nothing to clean up.');
  process.exit(0);
}

const sample = await sql`
  SELECT device_id, latitude, longitude, "timestamp"
  FROM telemetry
  WHERE longitude IS NOT NULL
    AND latitude  IS NOT NULL
    AND (
      ABS(latitude)  > 90
      OR ABS(longitude) > 180
      OR (ABS(latitude) > 1 AND ABS(longitude) < 1)
    )
  ORDER BY "timestamp" DESC
  LIMIT 5
`;
console.log('\nSample rows being deleted:');
for (const row of sample) {
  console.log(
    `  ${row.timestamp?.toISOString?.() ?? row.timestamp}  device=${row.device_id}  lat=${row.latitude}  lon=${row.longitude}`,
  );
}

console.log('\nDeleting…');
const result = await sql`
  DELETE FROM telemetry
  WHERE longitude IS NOT NULL
    AND latitude  IS NOT NULL
    AND (
      ABS(latitude)  > 90
      OR ABS(longitude) > 180
      OR (ABS(latitude) > 1 AND ABS(longitude) < 1)
    )
`;

console.log(`✅  Deleted ${result.length ?? badCount} row(s).`);
console.log('Done. Reload the dashboard — /api/v1/telemetry should now return clean lat/lon.');
