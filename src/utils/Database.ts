import { Pool, QueryConfig, QueryResult, QueryResultRow } from 'pg';
import { IConfig, NasUser } from '../global';

export type OAuthProviderEnum = 'GitHub' | 'Microsoft' | 'Google';

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

      // Cleanup tasks
      setInterval(() => {
        if (this.isAvailable()) {
          this.purgeExpiredOneTimeJWTs()
              .catch(console.error);
        }
      }, 48 * 60 * 60 * 1000 /* 48h */);
    }
  }

  /* User */

  async createUser(name: string): Promise<NasUser | null> {
    const dbRes = await this.query('INSERT INTO users (name) VALUES ($1) RETURNING *;', [name]);

    return dbRes.rows.length > 0 ? RowUtils.toUser(dbRes.rows[0]) : null;
  }

  async getUserByOAuth(oAuthId: number | string, provider: OAuthProviderEnum): Promise<NasUser | null> {
    const dbRes = await this.query('SELECT users.* FROM users JOIN user_oauth uo on users.id = uo.user_id WHERE oauth_id =$1 AND provider =$2;', [oAuthId, provider]);

    return dbRes.rows.length > 0 ? RowUtils.toUser(dbRes.rows[0]) : null;
  }

  async getUserByTokenId(tokenId: string): Promise<NasUser | null> {
    const dbRes = await this.query('SELECT users.* FROM users WHERE token_id =$1;', [tokenId]);

    return dbRes.rows.length > 0 ? RowUtils.toUser(dbRes.rows[0]) : null;
  }

  async getUsers(): Promise<Array<NasUser & { oauthCount: number }>> {
    const dbRes = await this.query('SELECT users.*, COUNT(uo.*) as oauth_count FROM users JOIN user_oauth uo on users.id = uo.user_id GROUP BY users.id;', []);

    const result: Array<NasUser & { oauthCount: number }> = [];

    for (const row of dbRes.rows) {
      result.push(Object.assign(RowUtils.toUser(row), {oauthCount: row.oauth_count}));
    }

    return result;
  }

  /* User-OAuth */

  async updateOAuthData(oAuthId: number | string, provider: OAuthProviderEnum, data: object): Promise<void> {
    await this.query('UPDATE user_oauth SET data =$3 WHERE oauth_id =$1 AND provider =$2;', [oAuthId, provider, data]);
  }

  async setOAuthProfileImage(oAuthId: number | string, provider: OAuthProviderEnum, image: Buffer | null): Promise<void> {
    await this.query('UPDATE user_oauth SET profile_img =$3 WHERE oauth_id =$1 AND provider =$2;', [oAuthId, provider, image]);
  }

  async getUsersOAuthProviderCount(userId: NasUser['id']): Promise<number> {
    const dbRes = await this.query('SELECT COUNT(*) as count FROM user_oauth WHERE user_id =$1;', [userId]);

    return dbRes.rows.length > 0 ? dbRes.rows[0].count : 0;
  }

  /* OTPs */
  async createOneTimeJWT(expires: Date): Promise<string> {
    const dbRes = await this.query('INSERT INTO one_time_jwt (expires) VALUES ($1) RETURNING jti;', [expires]);

    return dbRes.rows[0].jti;
  }

  async invalidateOneTimeJWT(jti: string): Promise<boolean> {
    const dbRes = await this.query('UPDATE one_time_jwt SET valid =false FROM one_time_jwt oldValues WHERE one_time_jwt.jti =oldValues.jti AND one_time_jwt.jti =$1 RETURNING oldValues.valid as was_valid;', [jti]);

    return dbRes.rows.length > 0 ? dbRes.rows[0].was_valid : true;
  }

  async purgeExpiredOneTimeJWTs(): Promise<void> {
    await this.query('DELETE FROM one_time_jwt WHERE CURRENT_TIMESTAMP > expires;', []);
  }

  /* Helper */

  isAvailable(): boolean {
    return this.pool != null;
  }

  async isReady(): Promise<void> {
    await this.query('SELECT NOW();');
  }

  getPool(): Pool {
    if (this.pool) return this.pool;

    throw new Error('No database connection available');
  }

  async shutdown(): Promise<void> {
    if (this.pool == null) return new Promise((resolve, _reject) => {
      resolve();
    });

    const result = this.pool.end();
    this.pool = null;

    return result;
  }

  private async query<R extends QueryResultRow = any, I extends any[] = any[]>(queryTextOrConfig: string | QueryConfig<I>, values?: I): Promise<QueryResult<R>> {
    return this.getPool().query(queryTextOrConfig, values);
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
  static toUser(row: any): NasUser {
    return {
      id: row.id,
      name: row.name,

      isAdmin: row.admin,

      tokenId: row.token_id,

      storageQuota: row.storage_quota
    };
  }
}
