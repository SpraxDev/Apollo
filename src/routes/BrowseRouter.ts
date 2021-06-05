import { NextFunction, Request, Response, Router } from 'express';
import { getDirectorySize } from 'fast-directory-size';
import fs, { mkdir } from 'fs';
import multer from 'multer';
import * as os from 'os';
import path from 'path';
import { promisify } from 'util';
import { BrowsePageData } from '../global';
import { PageGenerator, PageType } from '../PageGenerator';
import { NasUtils } from '../utils/NasUtils';
import { Utils } from '../utils/Utils';
import { WebServer } from '../WebServer';

const fsRename = promisify(fs.rename);
const fsRm = promisify(fs.rm);

export class BrowseRouter {
  static readonly handleFileUpload = multer({
    storage: multer.diskStorage({
      destination: fs.mkdtempSync(path.join(os.tmpdir(), 'NASWeb'))
    })
  });

  static getRouter(pageGenerator: PageGenerator) {
    const router = Router();

    router.use('/browse', this.getHandler(pageGenerator, 'data'));
    router.use('/trash', this.getHandler(pageGenerator, 'trash'));

    return router;
  }

  private static getHandler(pageGenerator: PageGenerator, type: 'data' | 'trash'): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      if (!WebServer.isLoggedIn(req) || req.session.user?.id == undefined) {
        return next(new Error('User is not authenticated'));
      }

      const user = req.session.user;

      Utils.restful(req, res, {
        'get': () => {
          try {
            const absPath = NasUtils.getRequestedPath(user, type, decodeURI(req.path));
            const isDirectory = NasUtils.isDirectory(absPath);

            if (isDirectory == null) {
              res.sendStatus(404);
            } else if (isDirectory) {
              NasUtils.fetchDirectory(absPath)
                  .then((content) => {
                    res.format({
                      html: () => {
                        const directories: BrowsePageData['page']['directories'] = [];
                        const files: BrowsePageData['page']['files'] = [];
                        const breadcrumb = decodeURI(req.path).split(path.sep);

                        if (!breadcrumb[0]) {
                          breadcrumb.shift();
                        }
                        if (!breadcrumb[breadcrumb.length - 1]) {
                          breadcrumb.pop();
                        }

                        const pathPrefix = decodeURI(Utils.stripQueryFromURI(req.originalUrl)).substring(1);
                        for (const dir of content.directories) {
                          directories.push({
                            path: path.join(pathPrefix, dir.name),
                            name: dir.name
                          });
                        }
                        for (const file of content.files) {
                          files.push({
                            path: path.join(pathPrefix, file.name),
                            name: file.name,
                            modifyDate: file.modifyDate
                          });
                        }

                        directories.sort((a, b) => Utils.compareStrings(a.name, b.name));
                        files.sort((a, b) => Utils.compareStrings(a.name, b.name));

                        const pageData: BrowsePageData = {
                          user,

                          page: {
                            type,
                            typeFront: type == 'data' ? 'browse' : type,
                            breadcrumb,
                            directories,
                            files
                          }
                        };

                        res.status(200)
                            .type('html')
                            .send(pageGenerator.getPage(PageType.BROWSE, pageData));
                      },
                      json: () => {
                        getDirectorySize(absPath)
                            .then((size) => {
                              res.send({
                                isDirectory,
                                sizeInByte: size,

                                directoryCount: content.directories.length,
                                fileCount: content.files.length
                              });

                            })
                            .catch(next);
                      }
                    });
                  })
                  .catch(next);
            } else {
              NasUtils.fetchFile(absPath)
                  .then((meta) => {
                    res.format({
                      html: () => {
                        res.type(meta.mime ?? 'text/plain')
                            .sendFile(absPath, (err) => {
                              if (err && err.message != 'Request aborted') next(err);
                            });
                      },
                      json: () => {
                        NasUtils.getExifToolData(absPath)
                            .then((exifData) => {
                              res.send({
                                isDirectory,
                                mime: meta.mime,
                                sizeInByte: meta.sizeInByte,
                                lastModified: meta.lastModified.valueOf(),
                                creationTime: meta.creationTime.valueOf(),

                                meta: exifData
                              });
                            }).catch(next);
                      }
                    });
                  })
                  .catch(next);
            }
          } catch (err) {
            next(err);
          }
        },

        'post': () => {
          if (typeof req.body['action'] == 'string') {
            if (req.body['action'] == 'mkdir') {
              if (type != 'data') return res.status(400).send({success: false, message: 'mkdir not allowed here'});

              const targetPath = NasUtils.getRequestedPath(user, 'data', path.join(decodeURI(req.path), req.body.relPath));
              try {
                fs.mkdirSync(targetPath, {recursive: true});

                res.status(200)
                    .send({success: true});
              } catch (err) {
                next(err);
              }
            } else {
              res.status(400)
                  .send('Unknown action');
            }
          } else {
            if (type != 'data') return res.status(400).send('File upload not allowed here');

            this.handleFileUpload.array('fUpload')(req, res, async (uploadErr?: any): Promise<void> => {
              if (uploadErr) return next(uploadErr);

              const uploadedFiles = req.files as Array<Express.Multer.File>;
              let succeeded = 0;
              const failed: Array<{ file: string, reason?: 'alreadyExisted' }> = [];

              for (const file of uploadedFiles) {
                const targetPath = NasUtils.getRequestedPath(user, 'data', path.join(decodeURI(req.path), file.originalname));

                try {
                  fs.mkdirSync(path.dirname(targetPath), {recursive: true});

                  if (fs.existsSync(targetPath)) {
                    failed.push({file: file.originalname, reason: 'alreadyExisted'});
                  } else {
                    await fsRename(file.path, targetPath);

                    ++succeeded;
                  }
                } catch (err) {
                  console.error(`An error occurred while uploading ${file.originalname} to ${targetPath}`, err);  // TODO log somewhere else
                  failed.push({file: file.originalname});
                }
              }

              res.status(200)
                  .send({
                    succeeded: succeeded,
                    failed
                  });
            });
          }
        },

        'delete': () => {
          const absPath = NasUtils.getRequestedPath(user, type, decodeURI(req.path));

          if (!fs.existsSync(absPath)) {
            return res.status(404)
                .send('Cannot delete a non existing file');
          }

          try {
            if (type != 'trash') {
              const targetPath = NasUtils.getRequestedPath(user, 'trash', decodeURI(req.path));

              fs.mkdirSync(path.dirname(targetPath), {recursive: true});

              NasUtils.moveFileGracefully(absPath, targetPath)
                  .then(() => {
                    res.status(200)
                        .send(`'${path.basename(absPath)}' has been moved into the trash.`);
                  })
                  .catch(next);
            } else {
              fsRm(absPath, {recursive: true})
                  .then(() => {
                    res.status(200)
                        .send(`'${path.basename(absPath)}' has been permanently deleted.`);
                  })
                  .catch(next);
            }
          } catch (err) {
            return next(err);
          }
        }
      });
    };
  }
}
