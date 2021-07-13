import { NextFunction, Request, Response, Router } from 'express';
import path, { join as joinPath } from 'path';
import { getCacheUtils } from '../index';
import { HttpError } from '../utils/HttpError';
import { NasUtils } from '../utils/NasUtils';
import { Utils } from '../utils/Utils';
import { WebServer } from '../WebServer';

// Use https://github.com/ideawu/ssdb as thumbnail cache
export class ThumbnailRouter {
  private static readonly FALLBACK_IMG_PATH = path.resolve(joinPath(__dirname, '..', '..', 'resources', 'web', 'static', 'img', 'noimgsmol.png'));

  static getRouter() {
    const router = Router();

    router.use('/browse', this.getHandler('data'));
    router.use('/trash', this.getHandler('trash'));

    return router;
  }

  private static getHandler(type: 'data' | 'trash'): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      if (!WebServer.isLoggedIn(req) || req.session.user?.id == undefined) {
        return next(new Error('User is not authenticated'));
      }

      const user = req.session.user;

      try {
        const absPath = NasUtils.getRequestedPath(user, type, decodeURI(req.path));
        const isDirectory = NasUtils.isDirectory(absPath);

        if (isDirectory == null) {
          res.status(404)
              .send('Could not find the file');
        } else if (isDirectory) {
          res.status(404)
              .send('Cannot generate a thumbnail for a directory');
        } else {
          const sizeStr = req.query.size;
          let size = 500;

          if (sizeStr) {
            if (typeof sizeStr != 'string' || !Utils.isNumeric(sizeStr)) {
              res.status(400)
                  .send(`Only numeric values are allowed for the query-param 'size'`);
              return;
            }

            size = parseInt(sizeStr);

            if (size > 2000) {
              res.status(400)
                  .send(`Thumbnails can currently not exceed a size of 2000px`);
              return;
            }
          }

          getCacheUtils()
              .getThumbnail(user, absPath, size)
              .then(thumbnail => {
                if (thumbnail) {
                  res.status(200)
                      .type(thumbnail.mime)
                      .send(thumbnail.data);
                } else {
                  res.status(404)
                      .type('txt')
                      .send('Could not generate a thumbnail for the given file (does it exist?)');
                }
              })
              .catch((err) => {
                if (err instanceof HttpError) {
                  res.status(err.httpCode);

                  if (err.httpCode == 415) {
                    res.type('png')
                        .sendFile(this.FALLBACK_IMG_PATH, (err) => {
                          if (err && err.message != 'Request aborted' && err.message != 'write EPIPE') next(err);
                        });
                  } else {
                    res.type('txt')
                        .send(err.message);
                  }
                } else {
                  next(err);
                }
              });
        }
      } catch (err) {
        next(err);
      }
    };
  }
}
