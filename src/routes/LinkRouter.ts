import { NextFunction, Request, Response, Router } from 'express';
import FlakeId from 'flake-idgen';
import path from 'path';
import { NasUser } from '../global';
import { NasUtils } from '../utils/NasUtils';

const flakeId = new FlakeId();

type LinkData = {
  user: NasUser['id'];
  anyoneCanAccess: boolean;

  absPath: string;
  created: number;
  ttl?: number;
};

export class LinkRouter {
  private static links: { [key: string]: LinkData } = {};

  static getRouter(isUserExpectedToBeAuthenticated: boolean) {
    const router = Router();

    router.use(this.getHandler(isUserExpectedToBeAuthenticated));

    return router;
  }

  static getLink(id: string): LinkData | null {
    const linkData = this.links[id];

    if (this.isValidLink(id)) {
      return linkData;
    }

    return null;
  }

  static searchLink(user: NasUser, absPath: string, anyoneCanAccess: boolean = false): { key: string, data: LinkData } | null {
    for (const linkKey in this.links) {
      const linkData = this.links[linkKey];

      if (linkData.user == user.id &&
          linkData.absPath == absPath &&
          linkData.anyoneCanAccess == anyoneCanAccess &&
          this.isValidLink(linkKey)) {
        return {key: linkKey, data: linkData};
      }
    }

    return null;
  }

  static getOrCreateLink(user: NasUser, absPath: string, anyoneCanAccess: boolean = false, ttlInSeconds?: number): string {
    const link = this.searchLink(user, absPath, anyoneCanAccess);
    if (link) {
      return link.key;
    }

    const id = flakeId.next().toString('hex');

    // TODO: Validate path to be within NasWeb working directory just to be safe
    this.links[id] = {
      user: user.id,
      anyoneCanAccess,

      absPath,
      created: Date.now(),
      ttl: ttlInSeconds != undefined ? ttlInSeconds * 1000 : undefined
    };

    return id;
  }

  private static isValidLink(id: string): boolean {
    const linkData = this.links[id];

    if (linkData) {
      if (linkData.ttl) {
        if (linkData.created + linkData.ttl <= Date.now()) {
          return true;
        }

        delete this.links[id];
      } else {
        return true;
      }
    }

    return false;
  }

  /**
   * This handler can be called WITHOUT a user being logged in
   */
  private static getHandler(isUserExpectedToBeAuthenticated: boolean): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      res.setHeader('Access-Control-Allow-Origin', '*');

      const user = req.session?.user;

      try {
        const linkId = req.path.substring(1, req.path.indexOf('/', 1));

        const linkData = this.getLink(linkId);

        if (linkData) {
          if (linkData.anyoneCanAccess || linkData.user == user?.id) {
            const absPath = path.normalize(path.join(linkData.absPath, req.path.substring(req.path.indexOf(linkId) + linkId.length)));
            const isDirectory = NasUtils.isDirectory(absPath);

            if (isDirectory == null) {
              res.status(404)
                  .send('Could not find the file');
            } else if (isDirectory) {
              res.status(403)
                  .send('Not allowed to generate a file index for the given directory');
            } else {
              NasUtils.fetchFile(absPath)
                  .then((file) => {
                    res.header('Access-Control-Allow-Headers', 'Content-Type, Accept-Encoding, Range, Accept');
                    res.header('Access-Control-Allow-Origin', req.header('Origin') || '*');
                    if (req.header('Origin')) {
                      res.header('Vary', 'Origin');
                    }

                    if (path.basename(absPath).endsWith('.m3u8')) {
                      file.mime = 'application/x-mpegURL';
                    }

                    res
                        .type(file.mime || 'application/octet-stream')
                        .sendFile(absPath, (err) => {
                          if (err && err.message != 'Request aborted' && err.message != 'write EPIPE') next(err);
                        });
                  })
                  .catch(next);
            }
          } else if (!linkData.anyoneCanAccess) {
            return next(isUserExpectedToBeAuthenticated ? new Error('User is not authenticated') : undefined);
          } else {
            return next(isUserExpectedToBeAuthenticated ? new Error('User does not have access to this link') : undefined);
          }
        } else {
          if (isUserExpectedToBeAuthenticated) {
            return next();
          } else {
            res.sendStatus(404);
          }
        }
      } catch (err) {
        next(err);
      }
    };
  }
}
