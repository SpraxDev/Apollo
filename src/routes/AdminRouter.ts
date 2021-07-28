import { NextFunction, Request, Response, Router } from 'express';
import { AdminPageData } from '../global';
import { getDatabase } from '../index';
import { PageGenerator, PageType } from '../PageGenerator';
import { Utils } from '../utils/Utils';
import { WebServer } from '../WebServer';

export class AdminRouter {
  static getRouter(pageGenerator: PageGenerator) {
    const router = Router();

    router.use('/', this.getHandler(pageGenerator));

    return router;
  }

  private static getHandler(pageGenerator: PageGenerator): (req: Request, res: Response, next: NextFunction) => void {
    return (req, res, next) => {
      if (!WebServer.isLoggedIn(req) || req.session.user?.id == undefined) {
        return next(new Error('User is not authenticated'));
      }

      const user = req.session.user;

      Utils.restful(req, res, next, {
        'get': async (): Promise<void> => {
          if (!user.isAdmin) return next(new Error('You are not authorized to access this page'));

          const pageData: AdminPageData = {
            user,

            page: {
              accounts: await getDatabase().getUsers()
            }
          };

          res.send(pageGenerator.getPage(PageType.ADMIN, pageData));

          // let html = '<h1>List of all accounts</h1><ul>';
          //
          // for (const nasUser of (await getDatabase().getUsers())) {
          //   html += `<li><b>#${nasUser.id}</b> - <i>${nasUser.name}</i> (${nasUser.oauthCount} OAuth connections)</li>`;
          // }
          //
          // html += '</ul>';

          // JwtUtils.sign({test: true}, {
          //   issuer: user.tokenId,
          //   subject: user.tokenId,
          //   audience: JwtAudience.LOGIN,
          //   expiresIn: '2h',
          //   jwtid: (await getDatabase()?.createOneTimeJWT(new Date(Date.now() + 60 * 60 * 2 * 1000 /* 2h */)))
          // })
          //     .then(value => {
          //       res.send(value);
          //     })
          //     .catch(next);

          // res.send(html);
        },

        'post': () => {
          // if (typeof req.body['action'] == 'string') {
          //   if (req.body['action'] == 'mkdir') {
          //     if (type != 'data') return res.status(400).send({success: false, message: 'mkdir not allowed here'});
          //     if (typeof req.body['relPath'] != 'string') {
          //       return res.status(400)
          //           .send({
          //             success: false,
          //             message: `property 'relPath' not a string`
          //           });
          //     }
          //
          //     const targetPath = NasUtils.getRequestedPath(user, 'data', path.join(decodeURI(req.path), req.body['relPath']));
          //     try {
          //       fs.mkdirSync(targetPath, {recursive: true});
          //
          //       res.status(200)
          //           .send({success: true});
          //     } catch (err) {
          //       next(err);
          //     }
          //   } else if (req.body['action'] == 'rename') {
          //     if (type != 'data') return res.status(400).send({success: false, message: 'rename not allowed here'});
          //
          //     const filePath = NasUtils.getRequestedPath(user, 'data', decodeURI(req.path));
          //     const newFileName = req.body['name'];
          //
          //     if (typeof newFileName != 'string') {
          //       return res.status(400)
          //           .send({
          //             success: false,
          //             message: `property 'name' not a string`
          //           });
          //     } else if (path.basename(newFileName) != newFileName) {
          //       return res.status(400)
          //           .send({
          //             success: false,
          //             message: `property 'name' contains illegal characters`
          //           });
          //     }
          //
          //     const targetPath = NasUtils.getRequestedPath(user, 'data', decodeURI(req.path));
          //
          //     NasUtils.moveFileIfNotExists(filePath, path.join(path.dirname(targetPath), newFileName))
          //         .then(() => {
          //           res.status(200)
          //               .send({success: true});
          //         })
          //         .catch(next);
          //   } else if (req.body['action'] == 'ffprobe') {
          //     const filePath = NasUtils.getRequestedPath(user, type, decodeURI(req.path));
          //
          //     VideoUtils.getStreamList(filePath)
          //         .then((streams) => {
          //           res.status(200)
          //               .json(streams);
          //         })
          //         .catch(next);
          //   } else if (req.body['action'] == 'ffmpeg') {
          //     const filePath = NasUtils.getRequestedPath(user, type, decodeURI(req.path));
          //
          //     const options: { [key: number]: { hardSub?: boolean } } = {};
          //
          //     for (const streamId in req.body.options) {
          //       const value = req.body.options[streamId];
          //
          //       if (value !== true) continue;
          //
          //       if (streamId.indexOf('_') != -1) {
          //         const idStr = streamId.substring(0, streamId.indexOf('_'));
          //         const arg = streamId.substring(streamId.indexOf('_') + 1);
          //
          //         if (!Utils.isNumeric(idStr)) {
          //           return next(new Error(`'${idStr}' in '${streamId}' is not a valid streamId`));
          //         }
          //
          //         const id = parseInt(idStr);
          //
          //         if (arg.toLowerCase() == 'hardSub'.toLowerCase()) {
          //           if (!options[id]) return next(new Error('You must specify the stream itself before any args'));
          //
          //           options[id].hardSub = value === true;
          //         } else {
          //           return next(new Error(`'${arg}' is not a valid stream argument`));
          //         }
          //       } else if (Utils.isNumeric(streamId)) {
          //         options[parseInt(streamId)] = {};
          //       } else {
          //         return next(new Error(`'${streamId}' is not a valid streamId`));
          //       }
          //     }
          //
          //     console.log(`User #${user.id} (${user.name}) requested video transcoding.`);
          //     VideoUtils.transcodeVideo(filePath, path.dirname(filePath), options)
          //         .then((data) => {
          //           console.log('Finished transcode:', data);
          //         })
          //         .catch(console.error);
          //
          //     // TODO
          //     res.status(200)
          //         .send({todo: true, filePath});
          //
          //     // VideoUtils.parseStreamList(filePath)
          //     //     .then((streams) => {
          //     //       res.status(200)
          //     //           .json(streams);
          //     //     })
          //     //     .catch(next);
          //   } else {
          //     res.status(400)
          //         .send('Unknown action');
          //   }
          // } else {
          //   if (type != 'data') return res.status(400).send('File upload not allowed here');
          //
          //   handleFileUpload.array('fUpload')(req, res, async (uploadErr?: any): Promise<void> => {
          //     if (uploadErr) return next(uploadErr);
          //
          //     const uploadedFiles = req.files as Array<Express.Multer.File>;
          //     let succeeded = 0;
          //     const failed: Array<{ file: string, reason?: 'alreadyExisted' }> = [];
          //
          //     for (const file of uploadedFiles) {
          //       const targetPath = NasUtils.getRequestedPath(user, 'data', path.join(decodeURI(req.path), file.originalname));
          //
          //       try {
          //         fs.mkdirSync(path.dirname(targetPath), {recursive: true});
          //
          //         if (fs.existsSync(targetPath)) {
          //           failed.push({file: file.originalname, reason: 'alreadyExisted'});
          //         } else {
          //           await fsRename(file.path, targetPath);
          //
          //           ++succeeded;
          //         }
          //       } catch (err) {
          //         console.error(`An error occurred while uploading ${file.originalname} to ${targetPath}`, err);  // TODO log somewhere else
          //         failed.push({file: file.originalname});
          //       }
          //     }
          //
          //     res.status(200)
          //         .send({
          //           succeeded: succeeded,
          //           failed
          //         });
          //   });
          // }
        },

        'delete': () => {
          // const absPath = NasUtils.getRequestedPath(user, type, decodeURI(req.path));
          //
          // if (!fs.existsSync(absPath)) {
          //   return res.status(404)
          //       .send('Cannot delete a non existing file');
          // }
          //
          // try {
          //   if (type != 'trash') {
          //     const targetPath = NasUtils.getRequestedPath(user, 'trash', decodeURI(req.path));
          //
          //     fs.mkdirSync(path.dirname(targetPath), {recursive: true});
          //
          //     NasUtils.moveFileAndRenameExistingFileIfExists(absPath, targetPath)
          //         .then(() => {
          //           res.status(200)
          //               .send(`'${path.basename(absPath)}' has been moved into the trash.`);
          //         })
          //         .catch(next);
          //   } else {
          //     fsRm(absPath, {recursive: true})
          //         .then(() => {
          //           res.status(200)
          //               .send(`'${path.basename(absPath)}' has been permanently deleted.`);
          //         })
          //         .catch(next);
          //   }
          // } catch (err) {
          //   return next(err);
          // }
        }
      });
    };
  }
}
