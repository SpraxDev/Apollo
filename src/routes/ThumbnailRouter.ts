import { NextFunction, Request, Response, Router } from 'express';
import path, { join as joinPath } from 'path';
import sharp from 'sharp';
import { NasUtils } from '../utils/NasUtils';
import { Utils } from '../utils/Utils';
import { WebServer } from '../WebServer';

const sharpTypes = [
  'application/pdf', 'image/bmp', 'image/gif', 'image/jpeg',
  'image/png', 'image/svg+xml', 'image/tiff', 'image/webp'
];

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
              return res.status(400)
                  .send(`Only numeric values are allowed for the query-param 'size'`);
            }

            size = parseInt(sizeStr);

            if (size > 2000) {
              return res.status(400)
                  .send(`Thumbnails can currently not exceed a size of 2000px`);
            }
          }

          NasUtils.fetchFile(absPath)
              .then(async (file): Promise<void> => {
                if (file.mime) {
                  if (sharpTypes.includes(file.mime)) {
                    sharp(absPath, {
                      failOnError: false,
                      sequentialRead: true,
                      density: 500
                    })
                        .on('error', (err) => {
                          res.status(400)
                              .send(`The given file seems to be corrupted or invalid (${err.message})`);
                        })
                        .resize(size, size, {
                          // fit: 'cover',
                          // position: 'attention',
                          fit: 'inside',
                          fastShrinkOnLoad: true,
                          withoutEnlargement: true
                        })
                        .png()
                        .pipe(res);
                  } else if (file.mime.startsWith('video/')) {
                    const thumbnail = await NasUtils.extractVideoThumbnail(absPath);

                    thumbnail.img
                        .resize(size, size, {
                          fit: 'inside',
                          fastShrinkOnLoad: true,
                          withoutEnlargement: true
                        })
                        .png()
                        .pipe(res);

                    res.on('close', thumbnail.done);
                  } else {
                    res.status(415)
                        .type('png')
                        .sendFile(this.FALLBACK_IMG_PATH, (err) => {
                          if (err && err.message != 'Request aborted') next(err);
                        });
                  }
                } else {
                  res.status(415)
                      .type('png')
                      .sendFile(this.FALLBACK_IMG_PATH, (err) => {
                        if (err && err.message != 'Request aborted') next(err);
                      });
                }
              })
              .catch(next);
        }
      } catch (err) {
        next(err);
      }
    };
  }
}
