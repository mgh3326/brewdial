import { getServerConfig, getSafeConfigStatus } from '../src/lib/server/config';
import { CouchError, getCouchInfo, getDatabaseInfo } from '../src/lib/server/couch';

async function main() {
  const config = getServerConfig(process.env);
  const safe = getSafeConfigStatus(config);
  console.log('BrewDial CouchDB health');
  console.log(`- url: ${safe.couchdbUrl}`);
  console.log(`- database: ${safe.database}`);
  console.log(`- hasUsername: ${safe.hasUsername}`);
  console.log(`- hasPassword: ${safe.hasPassword}`);

  try {
    const info = await getCouchInfo(config.couch);
    console.log(`- couchdb: ${info.couchdb ?? 'unknown'}`);
    console.log(`- version: ${info.version ?? 'unknown'}`);
  } catch (err) {
    if (err instanceof CouchError) {
      console.error(`- server: HTTP ${err.status}`);
    } else {
      console.error('- server: unreachable');
    }
    process.exitCode = 1;
    return;
  }

  try {
    const dbInfo = await getDatabaseInfo(config.couch);
    console.log(`- docCount: ${dbInfo.doc_count}`);
    console.log('- reachable: true');
  } catch (err) {
    if (err instanceof CouchError) {
      console.error(`- database: HTTP ${err.status}`);
    } else {
      console.error('- database: unreachable');
    }
    process.exitCode = 1;
  }
}

main().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error(`db-health failed: ${message}`);
  process.exitCode = 1;
});
