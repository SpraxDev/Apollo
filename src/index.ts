// TODO: RECODE and use classes

import { randomBytes } from 'crypto';
import { readFileSync } from 'fs';
import { join as joinPath, resolve as resolvePath } from 'path';

import * as rfs from 'rotating-file-stream';
import { Config } from './files/Config';
import { Database } from './utils/Database';
import { WebServer } from './WebServer';

let server: WebServer | null = null;

/* Register shutdown hook */
function shutdownHook() {
  console.log('Shutting down...');

  if (server != null) {
    server.close((err) => {
      if (err) console.error(err);

      process.exit();
    });

    server = null;
  }
}

process.on('SIGTERM', shutdownHook);
process.on('SIGINT', shutdownHook);
process.on('SIGQUIT', shutdownHook);
process.on('SIGHUP', shutdownHook);
process.on('SIGUSR2', shutdownHook);  // The package 'nodemon' is using this signal

export const runningInProduction = process.env.NODE_ENV == 'production';
export const appVersion: string = JSON.parse(readFileSync(joinPath(__dirname, '..', 'package.json'), 'utf-8')).version ?? 'UNKNOWN_APP_VERSION';

export const WORKING_DIR = resolvePath('/home/christian/Downloads/NAS - Test' /* TODO: REMOVE DEBUG */);
export const config = new Config();
export const database = config.data.postgreSQL.enabled ? new Database(config.data.postgreSQL) : null;
export const adminPassword = database ? null : randomBytes(16).toString('hex');

// TODO: Move LogStreams into own logging class
export const webAccessLogStream = rfs.createStream('access.log', {
  interval: '1d',
  maxFiles: 14,
  path: joinPath(process.cwd(), 'logs', 'access'),
  compress: true
});
webAccessLogStream.on('error', (err) => {
  console.error(500, 'webAccessLogStream called error-event', true, {err});
  // ApiError.log(500, 'webAccessLogStream called error-event', true, {err});
});

export const errorLogStream = rfs.createStream('error.log', {
  interval: '1d',
  maxFiles: 90,
  path: joinPath(process.cwd(), 'logs', 'error')
});
errorLogStream.on('error', (err) => {
  console.error(500, 'errorLogStream called error-event', true, {err});
  // ApiError.log(500, 'errorLogStream called error-event', true, {err});
});

// Start WebServer
server = new WebServer();
server.listen({listen: {port: 8092, host: '127.0.0.1', path: '', usePath: false}} /* TODO: REMOVE DEBUG */);


if (adminPassword) {
  console.log('='.repeat(24));
  console.log('No database connection - Temporary admin credentials have been generated');
  console.log('Username: nas_admin');
  console.log(`Password: ${adminPassword}`);
  console.log('='.repeat(24));
}
