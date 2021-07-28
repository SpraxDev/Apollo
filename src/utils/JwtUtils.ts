import jwt from 'jsonwebtoken';
import objectAssignDeep from 'object-assign-deep';
import { config } from '../index';

export class JwtUtils {
  static readonly USED_ALGORITHMS: Array<jwt.Algorithm> = ['HS512'];
  static readonly MAX_AGE = '30d';

  static readonly DEFAULT_SIGN_OPTIONS: jwt.SignOptions = {algorithm: 'HS512', expiresIn: '3d'};
  static readonly DEFAULT_VERIFY_OPTIONS: jwt.VerifyOptions = {
    algorithms: JwtUtils.USED_ALGORITHMS,
    maxAge: JwtUtils.MAX_AGE
  };

  static async sign(payload: string | object | Buffer, options?: jwt.SignOptions) {
    return new Promise((resolve, reject) => {
      options = objectAssignDeep({}, this.DEFAULT_SIGN_OPTIONS, options);

      jwt.sign(payload, this.getSecret(), options, ((err, encoded) => {
        if (err) return reject(err);
        if (encoded) return resolve(encoded);

        reject(new Error(`JWT token has been signed, but... Hasn't? (This should be dead-code)`));
      }));
    });
  }

  static async verify(token: string, options?: jwt.VerifyOptions): Promise<jwt.JwtPayload> {
    return new Promise((resolve, reject) => {
      options = objectAssignDeep({}, this.DEFAULT_VERIFY_OPTIONS, options);

      jwt.verify(token, this.getSecret(), options,
          (err, decoded) => {
            if (err) return reject(err);
            if (decoded) return resolve(decoded);

            reject(new Error(`JWT token seems valid but... Isn't? (This should be dead-code)`));
          });
    });
  }

  private static getSecret() {
    return Buffer.from(config.data.secret, 'base64').subarray(0, 512);
  }
}

export enum JwtAudience {
  LOGIN = 'SpraxNAS:Login',
  LOGIN_NO_OAUTH = 'SpraxNAS:Login:NoOAuth'
}
