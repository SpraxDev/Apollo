import crypto from 'crypto';
import { NextFunction, Request, Response } from 'express';
import * as fs from 'fs';

export class Utils {
  static isProcessRunning(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (ex) {
      return ex.code == 'EPERM';
    }
  }

  static sleep(millis: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, millis));
  }

  static isNumeric(str: string): boolean {
    return /^[0-9]+$/.test(str);
  }

  static stripQueryFromURI(str: string): string {
    const i = str.indexOf('?');

    if (i != -1) {
      str = str.substring(0, i);
    }

    return str;
  }

  static async readFirstNBytes(path: string, n: number): Promise<Buffer> {
    const data = [];

    for await (const chunk of fs.createReadStream(path, {start: 0, end: n})) {
      data.push(chunk);
    }

    return Buffer.from(data);
  }

  static async hashFileHead(absPath: string, options?: { algorithm?: string, bytes?: number, prefixData?: string | Buffer }): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash(options?.algorithm ?? 'sha256');

      if (options?.prefixData) {
        hash.update(options?.prefixData);
      }

      fs.createReadStream(absPath, {start: 0, end: options?.bytes ?? 16 * 1024 * 1024 /* 16MiB */})
          .on('data', (chunk) => hash.update(chunk))
          .on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * This shortcut function responses with HTTP 405 to the requests having
   * a method that does not have corresponding request handler.
   *
   * For example if a resource allows only GET and POST requests then
   * PUT, DELETE, etc. requests will be responded with the 405.
   *
   * HTTP 405 is required to have Allow-header set to a list of allowed
   * methods so in this case the response has "Allow: GET, POST, HEAD" in its headers.
   *
   * Example usage
   *
   *    // A handler that allows only GET (and HEAD) requests and returns
   *    app.all('/path', (req, res, next) => {
   *      restful(req, res, {
   *        get: () => {
   *          res.send('Hello world!');
   *        }
   *      });
   *    });
   *
   * Original author: https://stackoverflow.com/a/15754373/9346616
   */
  static restful(req: Request, res: Response, next: NextFunction, handlers: { [key: string]: () => void | Promise<void> }): void {
    const method = (req.method || '').toLowerCase();

    if (method in handlers) {
      try {
        const handlerResult = handlers[method]();

        if (handlerResult instanceof Promise) {
          handlerResult.catch(next);
        }
      } catch (err) {
        next(err);
      }
    } else if (method == 'head' && 'get' in handlers) {
      try {
        const handlerResult = handlers['get']();

        if (handlerResult instanceof Promise) {
          handlerResult.catch(next);
        }
      } catch (err) {
        next(err);
      }
    } else {
      const allowedMethods: string[] = Object.keys(handlers);
      if (!allowedMethods.includes('head')) {
        allowedMethods.push('head');
      }

      res.set('Allow', allowedMethods.join(', ').toUpperCase());
      res.sendStatus(405);
      // return next(ApiError.create(ApiErrs.METHOD_NOT_ALLOWED, { allowedMethods }));   // TODO: send error-custom body
    }
  }

  static compareStrings(a: string, b: string): -1 | 0 | 1 {
    a = a.toUpperCase();
    b = b.toUpperCase();

    if (a < b) {
      return -1;
    } else if (a > b) {
      return 1;
    }

    return 0;
  }
}
