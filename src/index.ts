import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join as joinPath, resolve as resolvePath } from 'path';
import { Config } from './files/Config';
import { CacheUtils } from './utils/CacheUtils';
import { Database } from './utils/Database';
import { ProcessManager } from './utils/ProcessManager';
import { WebServer } from './WebServer';

let server: WebServer | null = null;
let database: Database | null = null;
let cacheUtils: CacheUtils;
export const processManager: ProcessManager = new ProcessManager();

/* Register shutdown hook */
function shutdownHook() {
  console.log('Shutting down...');

  const postWebserver = async (): Promise<never> => {
    if (database) {
      try {
        await database.shutdown();
      } catch (err) {
        console.error(err);
      } finally {
        console.log('Database handler has been shutdown.');
      }
    }

    if (cacheUtils) {
      try {
        await cacheUtils.shutdown();
      } catch (err) {
        console.error(err);
      } finally {
        console.log('Redis handler has been shutdown.');
      }
    }

    try {
      await processManager.shutdown();
    } catch (err) {
      console.error(err);
    } finally {
      console.log('ProcessManager shut down.');
    }

    process.exit();
  };

  if (server) {
    server.close((err): Promise<never> => {
      if (err) console.error(err);

      console.log('WebServer has been closed.');

      return postWebserver();
    });

    server = null;
  } else {
    postWebserver()
        .catch(console.error);
  }
}

process.on('SIGTERM', shutdownHook);
process.on('SIGINT', shutdownHook);
process.on('SIGQUIT', shutdownHook);
process.on('SIGHUP', shutdownHook);

export const runningInProduction = process.env.NODE_ENV == 'production';
export const appVersion: string = JSON.parse(readFileSync(joinPath(__dirname, '..', 'package.json'), 'utf-8')).version ?? 'UNKNOWN_APP_VERSION';

export const WORKING_DIR = resolvePath('/app/WORKING_DIR' /* TODO: REMOVE DEBUG */);
export const config = new Config();
database = config.data.postgreSQL.enabled ? new Database(config.data.postgreSQL) : null;
cacheUtils = new CacheUtils(config.data.redis);
export const adminPassword = database ? null : randomBytes(16).toString('hex');

export function getCacheUtils(): CacheUtils {
  return cacheUtils;
}

export function getDatabase(): Database | null {
  return database;
}

// Start WebServer
server = new WebServer();
server.listen({listen: {port: 8092, host: '0.0.0.0', path: '', usePath: false}} /* TODO: REMOVE DEBUG */);

if (adminPassword) {
  console.log('='.repeat(24));
  console.log('No database connection - Temporary admin credentials have been generated');
  console.log('Username: nas_admin');
  console.log(`Password: ${adminPassword}`);
  console.log('='.repeat(24));
}
