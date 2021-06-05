import { Pool } from 'pg';
import { IConfig, NasUserDb } from '../global';

export class Database {
  private pool: Pool | null = null;
  private connectedClients: number = 0;

  constructor(dbCfg: IConfig['postgreSQL']) {
    if (dbCfg.enabled) {
      this.pool = new Pool({
        host: dbCfg.host,
        port: dbCfg.port,
        user: dbCfg.user,
        password: dbCfg.password,
        database: dbCfg.database,
        ssl: dbCfg.ssl ? {rejectUnauthorized: false} : false,
        max: 8,

        idleTimeoutMillis: 10 * 60 * 1000
      });

      this.pool.on('connect', (_client) => {
        if (this.connectedClients == 0) {
          console.log('[+] Connected to PostgreSQL database');
        }

        this.connectedClients++;
      });
      this.pool.on('remove', (_client) => {
        if (this.connectedClients == 1) {
          console.log('[-] Disconnected from PostgreSQL database');
        }

        this.connectedClients--;
      });
      this.pool.on('error', (err, _client) => {
        console.error('Unexpected error on idle client:', err);
      });
    }
  }

  async getUserByGitHub(githubId: number | string): Promise<NasUserDb | null> {
    return new Promise((resolve, reject) => {
      this.pool?.query('SELECT * FROM users WHERE github_id =$1;', [githubId])
          .then((dbRes) => {
            resolve(dbRes.rows.length > 0 ? RowUtils.toUser(dbRes.rows[0]) : null);
          })
          .catch(reject);
    });
  }

  async updateUserGitHubData(data: {} & NasUserDb['githubData']): Promise<void> {
    return new Promise((resolve, reject) => {
      this.pool?.query('UPDATE users SET github_data =$2 WHERE github_id =$1;', [data.id, data])
          .then(() => resolve())
          .catch(reject);
    });
  }

  /* Helper */

  isAvailable(): boolean {
    return this.pool != null;
  }

  async isReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.pool == null) return reject();

      this.pool.query('SELECT NOW();')
          .then(() => resolve())
          .catch((err) => reject(err));
    });
  }

  /**
   * This function should only be used for debugging purpose!
   */
  getPool(): Pool | null {
    return this.pool;
  }

  async shutdown(): Promise<void> {
    if (this.pool == null) return new Promise((resolve, _reject) => {
      resolve();
    });

    const result = this.pool.end();
    this.pool = null;

    return result;
  }

  // private shouldAbortTransaction(client: PoolClient, done: (release?: any) => void, err: Error): boolean {
  //     if (err) {
  //         client.query('ROLLBACK', (err) => {
  //             done();
  //             if (err) return ApiError.log('Error rolling back client', err);
  //         });
  //     }
  //
  //     return !!err;
  // }
}

class RowUtils {
  static toUser(row: any): NasUserDb {
    return {
      id: row.id,
      name: row.name,

      githubId: row.github_id,
      githubData: row.github_data
    };
  }
}
