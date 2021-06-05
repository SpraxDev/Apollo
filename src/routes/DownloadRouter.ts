import { NextFunction, Request, Response, Router } from 'express';
import { NasUtils } from '../utils/NasUtils';
import { Utils } from '../utils/Utils';
import { WebServer } from '../WebServer';

export class DownloadRouter {
  static getRouter() {
    const router = Router();

    router.use('/download', this.getHandler());

    return router;
  }

  private static getHandler(): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      if (!WebServer.isLoggedIn(req) || req.session.user?.id == undefined) {
        return next(new Error('User is not authenticated'));
      }

      const user = req.session.user;

      const forceDownload = req.query.force && req.query.force == '1';

      Utils.restful(req, res, {
        'get': () => {
          const absPath = NasUtils.getRequestedPath(user, 'data', decodeURI(req.path));
          const isDirectory = NasUtils.isDirectory(absPath);

          if (isDirectory == null || isDirectory) {
            res.sendStatus(404);
          } else {
            if (forceDownload) {
              res.download(absPath, (err) => {
                if (err && err.message != 'Request aborted') next(err);
              });
            } else {
              NasUtils.fetchFile(absPath)
                  .then((file) => {
                    res
                        .type(file.mime || 'application/octet-stream')
                        .sendFile(absPath, (err) => {
                          if (err && err.message != 'Request aborted') next(err);
                        });
                  })
                  .catch(next);
            }
          }
        }
      });
    };
  }
}
