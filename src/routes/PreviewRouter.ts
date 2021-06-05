import { NextFunction, Request, Response, Router } from 'express';
import * as fs from 'fs';
import path from 'path';
import { PreviewPageData } from '../global';
import { PageGenerator, PageType } from '../PageGenerator';
import { NasUtils } from '../utils/NasUtils';
import { WebServer } from '../WebServer';

const additionalSupportedTypes = ['application/pdf', 'application/ogg'];

export class PreviewRouter {
  static getRouter(pageGenerator: PageGenerator) {
    const router = Router();

    router.use(this.getHandler(pageGenerator));

    return router;
  }

  private static getHandler(pageGenerator: PageGenerator): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      if (!WebServer.isLoggedIn(req) || req.session.user?.id == undefined) {
        return next(new Error('User is not authenticated'));
      }

      if (!req.path.startsWith('/browse/')) {
        res.status(400)
            .send('Cannot generate a preview for files located inside the trash bin or similar locations');
        return;
      }

      const user = req.session.user;

      try {
        const absPath = NasUtils.getRequestedPath(user, 'data', decodeURI(req.path.substring(req.path.indexOf('/', 1))));
        const isDirectory = NasUtils.isDirectory(absPath);

        if (isDirectory == null) {
          res.status(404)
              .send('Could not find the file');
        } else if (isDirectory) {
          res.status(404)
              .send('Cannot generate a thumbnail for a directory');
        } else {
          // const originalFile = req.query.original && req.query.original == '1';

          NasUtils.fetchFile(absPath)
              .then((file) => {
                if (file.mime) {
                  const downloadPath = `/download${req.path.substring(req.path.indexOf('/', 1))}`;

                  if (file.mime.startsWith('text/')) {
                    const pageData: PreviewPageData = {
                      user,
                      page: {
                        raw: fs.readFileSync(absPath, 'utf-8'),
                        file: {
                          name: path.basename(absPath),
                          mimeType: file.mime,
                          downloadPath,
                          alternatives: []
                        }
                      }
                    };

                    res.type('html')
                        .send(pageGenerator.getPage(PageType.PREVIEW, pageData));
                  } else if (file.mime.startsWith('image/') ||
                      file.mime.startsWith('audio/') ||
                      file.mime.startsWith('video/') ||
                      additionalSupportedTypes.includes(file.mime)) {
                    const pageData: PreviewPageData = {
                      user,
                      page: {
                        file: {
                          name: path.basename(absPath),
                          mimeType: file.mime,
                          downloadPath,
                          alternatives: []
                        }
                      }
                    };

                    res.type('html')
                        .send(pageGenerator.getPage(PageType.PREVIEW, pageData));
                  } else {
                    res.status(415)
                        .send(`Cannot generate a preview for file type '${file.mime}'`);
                  }
                } else {
                  res.status(415)
                      .send(`Cannot generate a preview for file type '${file.mime}'`);
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
