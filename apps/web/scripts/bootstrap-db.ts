import { getServerConfig, getSafeConfigStatus } from '../src/lib/server/config';
import { ensureDatabase } from '../src/lib/server/couch';
import { ensureGlobalPreferences } from '../src/lib/server/repositories/preferences';

async function main() {
  const config = getServerConfig(process.env);
  const safe = getSafeConfigStatus(config);
  const result = await ensureDatabase(config.couch);
  await ensureGlobalPreferences(config.couch);
  console.log('BrewDial CouchDB bootstrap');
  console.log(`- url: ${safe.couchdbUrl}`);
  console.log(`- database: ${safe.database}`);
  console.log(`- databaseCreated: ${result.created}`);
  console.log('- globalPreferences: ensured');
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`bootstrap-db failed: ${message}`);
  process.exitCode = 1;
});
