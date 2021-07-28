import { NextFunction, Request, Response, Router } from 'express';
import { getDirectorySize } from 'fast-directory-size';
import fs, { mkdir } from 'fs';
import multer from 'multer';
import path from 'path';
import { promisify } from 'util';
import { BrowsePageData } from '../global';
import { PageGenerator, PageType } from '../PageGenerator';
import { NasUtils } from '../utils/NasUtils';
import { Utils } from '../utils/Utils';
import { VideoUtils } from '../utils/VideoUtils';
import { WebServer } from '../WebServer';

const fsRename = promisify(fs.rename);
const fsRm = promisify(fs.rm);

export class BrowseRouter {
  static getRouter(pageGenerator: PageGenerator) {
    const router = Router();

    const handleFileUpload = multer({
      storage: multer.diskStorage({
        destination: NasUtils.getTmpDir('upload').path
      })
    });

    router.use('/browse', this.getHandler(pageGenerator, handleFileUpload, 'data'));
    router.use('/trash', this.getHandler(pageGenerator, handleFileUpload, 'trash'));

    return router;
  }

  private static getHandler(pageGenerator: PageGenerator, handleFileUpload: multer.Multer, type: 'data' | 'trash'): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      if (!WebServer.isLoggedIn(req) || req.session.user?.id == undefined) {
        return next(new Error('User is not authenticated'));
      }

      const user = req.session.user;

      Utils.restful(req, res, next, {
        'get': () => {
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
                      console.log(0);
                      res.type(meta.mime ?? 'text/plain')
                          .sendFile(absPath, (err) => {
                            if (err && err.message != 'Request aborted' && err.message != 'write EPIPE') next(err);
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
        },

        'post': () => {
          if (typeof req.body['action'] == 'string') {
            if (req.body['action'] == 'mkdir') {
              if (type != 'data') {
                res.status(400)
                    .send({success: false, message: 'mkdir not allowed here'});

                return;
              }

              if (typeof req.body['relPath'] != 'string') {
                res.status(400)
                    .send({
                      success: false,
                      message: `property 'relPath' not a string`
                    });

                return;
              }

              const targetPath = NasUtils.getRequestedPath(user, 'data', path.join(decodeURI(req.path), req.body['relPath']));
              fs.mkdirSync(targetPath, {recursive: true});

              res.status(200)
                  .send({success: true});
            } else if (req.body['action'] == 'rename') {
              if (type != 'data') {
                res.status(400)
                    .send({success: false, message: 'rename not allowed here'});

                return;
              }

              const filePath = NasUtils.getRequestedPath(user, 'data', decodeURI(req.path));
              const newFileName = req.body['name'];

              if (typeof newFileName != 'string') {
                res.status(400)
                    .send({
                      success: false,
                      message: `property 'name' not a string`
                    });

                return;
              } else if (path.basename(newFileName) != newFileName) {
                res.status(400)
                    .send({
                      success: false,
                      message: `property 'name' contains illegal characters`
                    });

                return;
              }

              const targetPath = NasUtils.getRequestedPath(user, 'data', decodeURI(req.path));

              NasUtils.moveFileIfNotExists(filePath, path.join(path.dirname(targetPath), newFileName))
                  .then(() => {
                    res.status(200)
                        .send({success: true});
                  })
                  .catch(next);
            } else if (req.body['action'] == 'ffprobe') {
              const filePath = NasUtils.getRequestedPath(user, type, decodeURI(req.path));

              VideoUtils.getStreamList(filePath)
                  .then((streams) => {
                    res.status(200)
                        .json(streams);
                  })
                  .catch(next);
            } else if (req.body['action'] == 'ffmpeg') {
              const filePath = NasUtils.getRequestedPath(user, type, decodeURI(req.path));

              const options: { [key: number]: { hardSub?: boolean } } = {};

              for (const streamId in req.body.options) {
                const value = req.body.options[streamId];

                if (value !== true) continue;

                if (streamId.indexOf('_') != -1) {
                  const idStr = streamId.substring(0, streamId.indexOf('_'));
                  const arg = streamId.substring(streamId.indexOf('_') + 1);

                  if (!Utils.isNumeric(idStr)) {
                    return next(new Error(`'${idStr}' in '${streamId}' is not a valid streamId`));
                  }

                  const id = parseInt(idStr);

                  if (arg.toLowerCase() == 'hardSub'.toLowerCase()) {
                    if (!options[id]) return next(new Error('You must specify the stream itself before any args'));

                    options[id].hardSub = value === true;
                  } else {
                    return next(new Error(`'${arg}' is not a valid stream argument`));
                  }
                } else if (Utils.isNumeric(streamId)) {
                  options[parseInt(streamId)] = {};
                } else {
                  return next(new Error(`'${streamId}' is not a valid streamId`));
                }
              }

              console.log(`User #${user.id} (${user.name}) requested video transcoding.`);
              VideoUtils.transcodeVideo(filePath, path.dirname(filePath), options)
                  .then((data) => {
                    console.log('Finished transcode:', data);
                  })
                  .catch(console.error);

              // TODO
              res.status(200)
                  .send({todo: true, filePath});

              // VideoUtils.parseStreamList(filePath)
              //     .then((streams) => {
              //       res.status(200)
              //           .json(streams);
              //     })
              //     .catch(next);
            } else {
              res.status(400)
                  .send('Unknown action');
            }
          } else {
            if (type != 'data') {
              res.status(400)
                  .send('File upload not allowed here');

              return;
            }

            handleFileUpload.array('fUpload')(req, res, async (uploadErr?: any): Promise<void> => {
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
            res.status(404)
                .send('Cannot delete a non existing file');
            return;
          }

          if (type != 'trash') {
            const targetPath = NasUtils.getRequestedPath(user, 'trash', decodeURI(req.path));

            fs.mkdirSync(path.dirname(targetPath), {recursive: true});

            NasUtils.moveFileAndRenameExistingFileIfExists(absPath, targetPath)
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
        }
      });
    };
  }
}
