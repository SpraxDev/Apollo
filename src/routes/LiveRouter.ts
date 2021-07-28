import { NextFunction, Request, Response, Router } from 'express';
import path from 'path';
import { LivePageData } from '../global';
import { PageGenerator, PageType } from '../PageGenerator';
import { NasUtils } from '../utils/NasUtils';
import { ProcessData } from '../utils/ProcessManager';
import { Utils } from '../utils/Utils';
import { VideoUtils } from '../utils/VideoUtils';
import { WebServer } from '../WebServer';
import { LinkRouter } from './LinkRouter';

const additionalSupportedTypes = [/*'application/pdf', 'application/ogg'*/];
const liveEncodings: { [key: string]: { m3u8Path: string, processData: ProcessData } } = {};

export class LiveRouter {
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
            .then(async (file): Promise<void> => {
              if (file.mime) {
                if (
                    // file.mime.startsWith('image/') ||
                    // file.mime.startsWith('audio/') ||
                    file.mime.startsWith('video/') /*||
                      additionalSupportedTypes.includes(file.mime)*/) {
                  console.log(`User #${user.id} (${user.name}) requested live transcoding.`);

                  if (!liveEncodings[absPath]) {
                    liveEncodings[absPath] = await VideoUtils.liveTranscodeVideo(absPath);
                    console.log(`New live transcoding task started (log: ${liveEncodings[absPath].processData.logStream.path})...`);
                  } else {
                    console.log(`Found already existing transcode for user #${user.id} (${user.name}) that can be used.`);
                  }

                  const live = liveEncodings[absPath];
                  const liveDirLinkId = LinkRouter.getOrCreateLink(user, path.dirname(live.m3u8Path));
                  const liveDirLinkUnauthorizedId = LinkRouter.getOrCreateLink(user, path.dirname(live.m3u8Path), true);

                  const pageData: LivePageData = {
                    user,
                    page: {
                      file: {
                        name: path.basename(absPath),
                        mimeType: file.mime,
                        browsePath: decodeURI(Utils.stripQueryFromURI(req.originalUrl)).substring(5)
                      },

                      hls: {
                        master: `/link/${liveDirLinkId}/${path.basename(live.m3u8Path)}`,
                        masterUnauthorized: `/link/${liveDirLinkUnauthorizedId}/${path.basename(live.m3u8Path)}`
                      }
                    }
                  };

                  res.type('html')
                      .send(pageGenerator.getPage(PageType.LIVE, pageData));
                } else {
                  res.status(415)
                      .send(`Cannot generate a live version for file type '${file.mime}'`);
                }
              } else {
                res.status(415)
                    .send(`Cannot generate a live version for file type '${file.mime}'`);
              }
            })
            .catch(next);
      }
    };
  }
}
