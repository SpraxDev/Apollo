import * as fs from 'fs';
import { createClient, RedisClient } from 'redis';
import { promisify } from 'util';
import { IConfig, NasUser } from '../global';
import { HttpError } from './HttpError';
import { NasFileUtils, ThumbnailData } from './NasFileUtils';
import { Utils } from './Utils';

const fsStat = promisify(fs.stat);

export type RedisData = { type: 'err' | 'httpErr' | 'empty' | 'binary' | 'json' | 'thumbnail' | 'string', content: string };
export type CacheRes = { cacheHit: boolean };

export class CacheUtils {
  private static readonly CACHE_DURATION_THUMBNAILS: number = 90 * 24 * 60 * 60;  // 90d

  private static readonly EMPTY_VALUE: RedisData = {type: 'empty', content: ''};
  // private static readonly ERR_VALUE = JSON.stringify({'err': 'err'});

  private syncTaskQueue: { [key: string]: ((result: RedisData) => void)[] } = {};

  private redisReady: boolean = false;  // TODO: Make redis optional in the config
  private readonly redisClient?: RedisClient;  // TODO: Allow configuring the client
  private readonly redisGet?: (key: string) => Promise<string | null>;
  private readonly redisSetEx?: (key: string, ttl: number, value: RedisData) => Promise<string | null>;

  constructor(cfg: IConfig['redis']) {
    if (cfg.enabled) {
      this.redisClient = createClient({
        enable_offline_queue: false,
        host: cfg.host,
        port: cfg.port,
        db: cfg.db,
        password: cfg.password || undefined
      });

      this.redisGet = promisify(this.redisClient.get).bind(this.redisClient);

      const tmpSetEx = promisify(this.redisClient.setex).bind(this.redisClient);
      this.redisSetEx = async (key, ttl, value) => tmpSetEx(key, ttl, JSON.stringify(value));

      this.redisClient.on('ready', () => {
        this.redisReady = true;
        console.log('[+] Connected to Redis');
      });
      this.redisClient.on('end', () => {
        this.redisReady = false;
        console.log('[-] Disconnected from Redis');
      });
      this.redisClient.on('error', (err) => {
        console.error('Redis-Client encountered an error', err);
      });
    }
  }

  public async getThumbnail(user: NasUser, absPath: string, size: number): Promise<ThumbnailData /* & CacheRes TODO */ | null> {
    return new Promise(async (resolve, reject): Promise<void> => {
      const sha256 = await Utils.hashFileHead(absPath, {
        algorithm: 'sha256',
        prefixData: JSON.stringify({
          absPath,
          stat: await fsStat(absPath)
        })
      });

      const cacheKey = CacheUtils.getCacheKey(user, 'thumbnail', sha256, size.toString());

      const done = (data: RedisData) => {
        const result = CacheUtils.fromRedisData(data);

        if (data.type == 'thumbnail') {
          return resolve(result as ThumbnailData);
        } else if (data.type == 'empty') {
          return resolve(null);
        } else {
          return reject(result instanceof Error ? result : new Error(`Unexpected data: ${JSON.stringify(data)}`));
        }
      };

      if (this.startQueue(cacheKey, done)) {
        let result: RedisData = CacheUtils.EMPTY_VALUE;
        let resultFromRedis = false;

        // Check if data is already cached in Redis
        if (this.redisReady && this.redisGet) {
          try {
            let redisResult = await this.redisGet(cacheKey);

            if (redisResult != null) {
              try {
                redisResult = JSON.parse(redisResult);
              } catch (invalidJson) {
              }

              if (CacheUtils.isRedisData(redisResult)) {
                result = redisResult;
                resultFromRedis = true;
              } else {
                console.error(`Got invalid RedisData for key '${cacheKey}': ${redisResult}`);
              }
            }
          } catch (err) {
            console.error(`Redis-Client could not fetch data (key='${cacheKey}')`, err);
          }
        }

        // Generate data
        if (result.type == 'empty') {
          try {
            const thumbnail = await NasFileUtils.generateThumbnail(absPath, 500);

            if (thumbnail) {
              result = {
                type: 'thumbnail',
                content: JSON.stringify({mime: thumbnail.mime, data: thumbnail.data.toString('base64')})
              };
            }
          } catch (err) {
            result = CacheUtils.toRedisData(err);
          }
        }

        // Write to Redis cache
        if (!resultFromRedis && this.redisReady && this.redisSetEx) {
          if (result.type != 'err') {
            await this.redisSetEx(cacheKey, CacheUtils.CACHE_DURATION_THUMBNAILS, result);
          }
        }

        this.resolveQueue(cacheKey, result);
      }
    });
  }

  public async shutdown(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.redisClient?.quit((err) => {
        if (err) return reject(err);

        return resolve();
      });
    });
  }

  private static getCacheKey(user: NasUser, type: 'thumbnail', identifier: string, subType?: string) {
    return `user_${user.id}:${type}:${identifier}${subType ? `:${subType}` : ''}`;
  }

  private startQueue(key: string, callback: (result: RedisData | any) => void): boolean {
    if (this.syncTaskQueue[key]) {
      this.syncTaskQueue[key].push(callback);

      return false;
    } else {
      this.syncTaskQueue[key] = [callback];

      return true;
    }
  }

  private resolveQueue(key: string, result: RedisData | any): void {
    const tasks = this.syncTaskQueue[key];

    if (tasks) {
      delete this.syncTaskQueue[key];

      for (const task of tasks) {
        try {
          task(result);
        } catch (err) {
          console.error('Could not run CacheUtils-Queue-Task', {key, result, 'tasks.length': tasks.length, err});
        }
      }
    }
  }

  private static isRedisData(data: any): data is RedisData {
    return typeof data == 'object' && data.type && typeof data.type == 'string' && typeof data.content == 'string';
  }

  private static toRedisData(data: Buffer | string | HttpError | Error | any): RedisData {
    if (Buffer.isBuffer(data)) {
      return {
        type: 'binary',
        content: data.toString('base64')
      };
    } else if (typeof data == 'string') {
      return {
        type: 'string',
        content: data
      };
    } else if (data instanceof HttpError) {
      return {
        type: 'httpErr',
        content: JSON.stringify({httpCode: data.httpCode, message: data.message})
      };
    } else if (data instanceof Error) {
      return {
        type: 'err',
        content: JSON.stringify({message: data.message})
      };
    } else {
      return {
        type: 'json',
        content: JSON.stringify(data)
      };
    }
  }

  private static fromRedisData(data: RedisData): null | Error | HttpError | Buffer | string | ThumbnailData | { [key: string]: any } | { [key: number]: any } {
    /* special basic types */
    if (data.type == 'empty') {
      return null;
    } else if (data.type == 'err') {
      return new Error(data.content);
    } else if (data.type == 'httpErr') {
      const dataObj = JSON.parse(data.content);

      return new HttpError(dataObj.message, dataObj.httpCode);
    }

    /* basic types */
    else if (data.type == 'binary') {
      return Buffer.from(data.content, 'base64');
    } else if (data.type == 'string') {
      return data.content;
    } else if (data.type == 'json') {
      return JSON.parse(data.content);
    }

    /* special types */
    else if (data.type == 'thumbnail') {
      const dataObj = JSON.parse(data.content);
      // noinspection UnnecessaryLocalVariableJS
      const result: ThumbnailData = {mime: dataObj.mime, data: Buffer.from(dataObj.data, 'base64')};

      return result;
    }

    throw new Error(`Unknown type: ${data.type}`);
  }

  /* Old code */

// public async getUser(nameOrUUID: string, waitForDbSkinImport: boolean = false): Promise<MinecraftUser | null> {
//   return new Promise(async (resolve, reject): Promise<void> => {
//     let uuid: string;
//     let uuidExists = false;
//
//     if (isUUID(nameOrUUID) || isUUID(nameOrUUID.trim())) {
//       uuid = nameOrUUID.trim().toLowerCase().replace(/-/g, '');
//     } else {
//       try {
//         const mcUUID = await this.getUUID(nameOrUUID);
//
//         if (!mcUUID) return resolve(null);
//
//         uuid = mcUUID.id;
//         uuidExists = true;
//       } catch (err) {
//         return reject(err);
//       }
//     }
//
//     try {
//       const profile = await this.getProfile(uuid, waitForDbSkinImport);
//
//       if (!profile && uuidExists) return reject(new Error(`Got Null-Profile for existing profile '${uuid}'`));
//       if (!profile) return resolve(null);
//
//       const nameHistory = profile ? await this.getNameHistory(profile.id) : null;
//       if (!nameHistory && profile) return reject(new Error(`Got Null-NameHistory for existing profile '${profile.id}'`));
//
//       // TODO: replace User-Agent
//       const user = profile ? new MinecraftUser(profile, nameHistory as MinecraftNameHistoryElement[], await getUserAgent(null)) : null;
//
//       resolve(user);
//     } catch (err) {
//       return reject(err);
//     }
//   });
// }
//
// public async getUUID(username: string, at?: number): Promise<MinecraftUUIDResponse | null> {
//   return new Promise(async (resolve, reject): Promise<void> => {
//     const key = CacheUtils.KEY_PREFIX_UUID + username.toLowerCase() + (at ? `@${at}` : '');
//
//     const done = (result: unknown) => {
//       if (result == null || result == CacheUtils.ERR_VALUE) {
//         return reject(new Error(`An error occurred while trying to get the UUID for '${username}': ${JSON.stringify(result)}`));
//       } else if (result == CacheUtils.EMPTY_VALUE) {
//         return resolve(null);
//       } else {
//         return resolve(typeof result == 'string' ? JSON.parse(result) : result);
//       }
//     };
//
//     if (this.startQueue(key, done)) {
//       let result: object | string | null = null;
//       let resultFromRedis = false;
//
//       // Check if data is already cached in Redis
//       if (this.redisReady && this.redisGet) {
//         try {
//           const redisResult = await this.redisGet(key);
//
//           if (redisResult != null) {
//             result = redisResult;
//             resultFromRedis = true;
//           }
//         } catch (err) {
//           ApiError.log('Redis-Client could not fetch data', {key, err});
//         }
//       }
//
//       // If not cached in Redis, check if username is already know in the database
//       // This also allows to resolve invalid usernames that exist but are not resolved by the Mojang-API
//       if (!result && !at && db.isAvailable()) {
//         try {
//           const dbProfile = await db.getProfileByName(username);
//
//           // Make sure that the profile from the db is still accurate
//           // by requesting the profile for that UUID
//           // if the names match, we successfully avoided contacting the strictly rate-limited Name->UUID API-Route
//           if (dbProfile) {
//             const freshProfile = await this.getProfile(dbProfile.id);
//
//             if (dbProfile?.name == freshProfile?.name) {
//               result = {id: freshProfile.id, name: freshProfile?.name};
//             }
//           }
//         } catch (err) {
//           ApiError.log('CacheUtils encountered an error while fetching a profile from the database', {key, err});
//         }
//       }
//
//       // Requesting data from Mojang-API
//       if (!result) {
//         try {
//           const uuid = await fetchUUID(username, at);
//
//           result = uuid ? uuid : CacheUtils.EMPTY_VALUE;
//         } catch (err) {
//           ApiError.log('CacheUtils encountered an error while fetching an UUID from Mojang', {key, err});
//         }
//       }
//
//       // Write to Redis cache
//       if (!resultFromRedis && this.redisReady && this.redisSetEx) {
//         if (result == CacheUtils.EMPTY_VALUE || result == null) {
//           await this.redisSetEx(key, CacheUtils.CACHE_TIME_EMPTY, CacheUtils.EMPTY_VALUE);
//         } else if (result == CacheUtils.ERR_VALUE) {
//           await this.redisSetEx(key, CacheUtils.CACHE_DURATION, CacheUtils.ERR_VALUE);
//         } else {
//           await this.redisSetEx(key, CacheUtils.CACHE_DURATION, typeof result != 'string' ? JSON.stringify(result) : result);
//         }
//       }
//
//       this.resolveQueue(key, result);
//     }
//   });
// }
//
// public async getProfile(uuid: string, waitForDbSkinImport: boolean = false): Promise<MinecraftProfile | null> {
//   return new Promise(async (resolve, reject): Promise<void> => {
//     const cleanUUID = uuid.toLowerCase().replace(/-/g, '');
//     const key = CacheUtils.KEY_PREFIX_PROFILE + cleanUUID;
//
//     const done = (result: unknown) => {
//       if (result == null || result == CacheUtils.ERR_VALUE) {
//         return reject(new Error(`An error occurred while trying to get the profile for '${uuid}': ${JSON.stringify(result)}`));
//       } else if (result == CacheUtils.EMPTY_VALUE) {
//         return resolve(null);
//       } else {
//         return resolve(typeof result == 'string' ? JSON.parse(result) : result);
//       }
//     };
//
//     if (this.startQueue(key, done)) {
//       let result: MinecraftProfile | string | null = null;
//       let resultFromRedis = false;
//
//       // Check if data is already cached in Redis
//       if (this.redisReady && this.redisGet) {
//         try {
//           const redisResult = await this.redisGet(key);
//
//           if (redisResult != null) {
//             result = redisResult;
//             resultFromRedis = true;
//           }
//         } catch (err) {
//           ApiError.log('Redis-Client could not fetch data', {key, err});
//         }
//       }
//
//       // If not cached in Redis, check if profile is already know in the database
//       if (!result && db.isAvailable()) {
//         try {
//           const dbProfile = await db.getProfile(cleanUUID, true);
//
//           if (dbProfile) {
//             result = dbProfile;
//           }
//         } catch (err) {
//           ApiError.log('CacheUtils encountered an error while fetching a profile from the database', {key, err});
//         }
//       }
//
//       // Requesting data from Mojang-API
//       if (!result) {
//         try {
//           const profile = await fetchProfile(cleanUUID);
//
//           result = profile ? profile : CacheUtils.EMPTY_VALUE;
//
//           // Write new data to database
//           if (db.isAvailable()) {
//             if (!profile) {
//               // We don't care about the result as the profile does not exist anymore (or never did)
//               db.markUserDeleted(uuid)
//
//                   .catch((err) => {
//                     // Just log errors that occurred
//                     ApiError.log('Could not mark user as deleted in database', {uuid: uuid, stack: err.stack});
//                   })
//                   .finally(() => {
//                     if (waitForDbSkinImport) {
//                       this.resolveQueue(key, result);
//                     }
//                   });
//             } else {
//               db.updateProfile(profile)
//                   .then(async (): Promise<void> => {
//                     const tempUser = new MinecraftUser(profile, [], await getUserAgent(null));
//
//                     /* Skin */
//                     if (tempUser.textureValue) {
//                       try {
//                         const importedTextures = await importByTexture(tempUser.textureValue, tempUser.textureSignature, tempUser.userAgent);
//
//                         if (importedTextures.cape && db.isAvailable()) {
//                           try {
//                             await db.addCapeToUserHistory(profile.id, importedTextures.cape, new Date(MinecraftUser.extractMinecraftProfileTextureProperty(tempUser.textureValue).timestamp));
//                           } catch (err) {
//                             ApiError.log(`Could not update cape-history in database`, {
//                               cape: importedTextures.cape.id,
//                               profile: profile.id,
//                               stack: err.stack
//                             });
//                           }
//                         }
//                       } catch (err) {
//                         ApiError.log('Could not import skin/cape from profile', {
//                           skinURL: tempUser.skinURL,
//                           profile: profile.id,
//                           stack: (err || new Error()).stack
//                         });
//                       }
//                     }
//
//                     /* Capes */
//                     const processCape = (capeURL: string | MinecraftUser, capeType: CapeType): Promise<void> => {
//                       return new Promise((resolve, reject) => {
//                         if (!capeURL) return resolve();
//
//                         importCapeByURL(capeURL, capeType, tempUser.userAgent, tempUser.textureValue || undefined, tempUser.textureSignature || undefined)
//                             .then((cape) => {
//                               if (!cape) return resolve();
//
//                               if (capeType != 'MOJANG' && db.isAvailable()) {
//                                 db.addCapeToUserHistory(profile.id, cape, tempUser.textureValue ? new Date(MinecraftUser.extractMinecraftProfileTextureProperty(tempUser.textureValue).timestamp) : 'now')
//                                     .then(resolve)
//                                     .catch((err) => {
//                                       ApiError.log(`Could not update cape-history in database`, {
//                                         cape: cape.id,
//                                         profile: profile.id,
//                                         stack: err.stack
//                                       });
//                                       reject(err);
//                                     });
//                               }
//                             })
//                             .catch((err) => {
//                               ApiError.log(`Could not import cape(type=${capeType}) from profile`, {
//                                 capeURL: capeURL,
//                                 profile: profile.id,
//                                 stack: err.stack
//                               });
//                               reject(err);
//                             });
//                       });
//                     };
//
//                     try {
//                       await processCape(tempUser.getOptiFineCapeURL(), CapeType.OPTIFINE);
//                     } catch (err) {
//                       ApiError.log('Could not process OptiFine-Cape', err);
//                     }
//
//                     try {
//                       await processCape(tempUser, CapeType.LABYMOD);
//                     } catch (err) {
//                       ApiError.log('Could not process LabyMod-Cape', err);
//                     }
//
//                     if (waitForDbSkinImport) {
//                       this.resolveQueue(key, result);
//                     }
//                   })
//                   .catch((err) => {
//                     ApiError.log('Could not update user in database', {profile: profile.id, stack: err.stack});
//
//                     if (waitForDbSkinImport) {
//                       this.resolveQueue(key, result);
//                     }
//                   });
//             }
//           }
//         } catch (err) {
//           ApiError.log('CacheUtils encountered an error while fetching a profile from Mojang', {key, err});
//         }
//       }
//
//       // Write to Redis cache
//       if (!resultFromRedis && this.redisReady && this.redisSetEx) {
//         if (result == CacheUtils.EMPTY_VALUE || result == null) {
//           await this.redisSetEx(key, CacheUtils.CACHE_TIME_EMPTY, CacheUtils.EMPTY_VALUE);
//         } else if (result == CacheUtils.ERR_VALUE) {
//           await this.redisSetEx(key, CacheUtils.CACHE_DURATION, CacheUtils.ERR_VALUE);
//         } else {
//           await this.redisSetEx(key, CacheUtils.CACHE_DURATION, typeof result != 'string' ? JSON.stringify(result) : result);
//         }
//       }
//
//       if (!waitForDbSkinImport || !db.isAvailable()) {
//         this.resolveQueue(key, result);
//       }
//     }
//   });
// }
//
// public async getNameHistory(uuid: string): Promise<MinecraftNameHistoryElement[] | null> {
//   return new Promise(async (resolve, reject): Promise<void> => {
//     const cleanUUID = uuid.toLowerCase().replace(/-/g, '');
//     const key = CacheUtils.KEY_PREFIX_NAME_HISTORY + cleanUUID;
//
//     const done = (result: unknown) => {
//       if ((typeof result != 'string' && !Array.isArray(result)) ||
//           result == CacheUtils.ERR_VALUE) {
//         return reject(new Error(`An error occurred while trying to get the Name-History for '${uuid}'`));
//       } else if (result == CacheUtils.EMPTY_VALUE) {
//         return resolve(null);
//       } else {
//         return resolve(typeof result == 'string' ? JSON.parse(result) : result);
//       }
//     };
//
//     if (this.startQueue(key, done)) {
//       let result: object | string | null = null;
//       let resultFromRedis = false;
//
//       // Check if data is already cached in Redis
//       if (this.redisReady && this.redisGet) {
//         try {
//           const redisResult = await this.redisGet(key);
//
//           if (redisResult != null) {
//             result = redisResult;
//             resultFromRedis = true;
//           }
//         } catch (err) {
//           ApiError.log('Redis-Client could not fetch data', {key, err});
//         }
//       }
//
//       // If not cached in Redis, check if username is already know in the database
//       if (!result && db.isAvailable()) {
//         try {
//           if (await db.isNameHistoryUpToDate(cleanUUID)) {
//             const nameHistory = await db.getNameHistory(cleanUUID);
//
//             // Make sure that the profile from the db is still accurate
//             // by requesting the profile for that UUID
//             // if the names match, we successfully avoided contacting the strictly rate-limited Name->UUID API-Route
//             if (nameHistory) {
//               const freshProfile = await this.getProfile(cleanUUID);
//
//               if (freshProfile?.name == nameHistory[0].name) {
//                 result = nameHistory;
//               }
//             }
//           }
//         } catch (err) {
//           ApiError.log('CacheUtils encountered an error while fetching a name-history from the database', {key, err});
//         }
//       }
//
//       // Requesting data from Mojang-API
//       if (!result) {
//         try {
//           const nameHistory = await fetchNameHistory(cleanUUID);
//
//           result = nameHistory ? nameHistory : CacheUtils.EMPTY_VALUE;
//         } catch (err) {
//           ApiError.log('CacheUtils encountered an error while fetching a name-history from Mojang', {key, err});
//         }
//       }
//
//       // Write to Redis cache
//       if (!resultFromRedis && this.redisReady && this.redisSetEx) {
//         if (result == CacheUtils.EMPTY_VALUE || result == null) {
//           await this.redisSetEx(key, CacheUtils.CACHE_TIME_EMPTY, CacheUtils.EMPTY_VALUE);
//         } else if (result == CacheUtils.ERR_VALUE) {
//           await this.redisSetEx(key, CacheUtils.CACHE_DURATION, CacheUtils.ERR_VALUE);
//         } else {
//           await this.redisSetEx(key, CacheUtils.CACHE_DURATION, typeof result != 'string' ? JSON.stringify(result) : result);
//         }
//       }
//
//       this.resolveQueue(key, result);
//     }
//   });
// }
//
// public async getBlockedServers(): Promise<string[]> {
//   return new Promise(async (resolve, reject): Promise<void> => {
//     const key = CacheUtils.KEY_BLOCKED_SERVERS;
//
//     const done = (result: unknown) => {
//       if (result == null || !Array.isArray(result)) {
//         return reject(new Error(`An error occurred while trying to get the list of blocked Minecraft servers`));
//       }
//
//       return resolve(result);
//     };
//
//     if (this.startQueue(key, done)) {
//       let result: string[] | null = null;
//       let resultFromRedis = false;
//
//       // Check if data is already cached in Redis
//       if (this.redisReady && this.redisGet) {
//         try {
//           const redisResult = await this.redisGet(key);
//
//           if (redisResult != null) {
//             result = JSON.parse(redisResult) as string[];
//             resultFromRedis = true;
//           }
//         } catch (err) {
//           ApiError.log('Redis-Client could not fetch data', {err});
//         }
//       }
//
//       // TODO: store into db (hash history that shows added and removed dates)
//
//       // Requesting data from Mojang-API
//       if (!result) {
//         try {
//           result = await fetchBlockedServers();
//         } catch (err) {
//           ApiError.log('CacheUtils encountered an error while fetching blocked servers from Mojang', {err});
//         }
//       }
//
//       // Write to Redis cache
//       if (!resultFromRedis && this.redisReady && this.redisSetEx) {
//         await this.redisSetEx(key, CacheUtils.CACHE_DURATION_BLOCKED_SERVERS, JSON.stringify(result));
//       }
//
//       this.resolveQueue(key, result);
//     }
//   });
// }
//
// public async isProfileInRedis(uuid: string): Promise<boolean> {
//   return new Promise(async (resolve): Promise<void> => {
//     // Check if data is already cached in Redis
//     if (this.redisReady && this.redisGet) {
//       try {
//         const redisResult = await this.redisGet(CacheUtils.KEY_PREFIX_PROFILE + uuid.toLowerCase().replace(/-/g, ''));
//
//         if (redisResult != null) {
//           return resolve(true);
//         }
//       } catch (err) {
//         ApiError.log('CacheUtils encountered an error inside #isProfileInRedis', {err});
//       }
//     }
//
//     resolve(false);
//   });
// }
}
