import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getServerConfig } from '$lib/server/config';
import { getDatabaseInfo } from '$lib/server/couch';

export const GET = async () => {
  const config = getServerConfig(env);
  try {
    const info = await getDatabaseInfo(config.couch);
    return json({
      ok: true,
      service: 'brewdial-web',
      database: {
        configured: true,
        reachable: true,
        name: info.db_name,
        docCount: info.doc_count
      }
    });
  } catch {
    return json(
      {
        ok: false,
        service: 'brewdial-web',
        database: {
          configured: true,
          reachable: false,
          name: config.couch.database
        },
        error: 'CouchDB unreachable or database missing'
      },
      { status: 503 }
    );
  }
};
