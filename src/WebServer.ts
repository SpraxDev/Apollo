import expressSessionPG from 'connect-pg-simple';
import express from 'express';
import expressSession from 'express-session';
import {
  chmodSync,
  existsSync as fileExistsSync,
  mkdirSync,
  readFileSync,
  unlinkSync as unlinkFileSync,
  writeFileSync
} from 'fs';
import { createServer, Server } from 'http';
import morgan from 'morgan';
import { join as joinPath } from 'path';
import { config, database, runningInProduction, webAccessLogStream } from './index';
import { PageGenerator } from './PageGenerator';
import { BrowseRouter } from './routes/BrowseRouter';
import { DownloadRouter } from './routes/DownloadRouter';
import { LinkRouter } from './routes/LinkRouter';
import { LiveRouter } from './routes/LiveRouter';
import { LoginRouter } from './routes/LoginRouter';
import { PreviewRouter } from './routes/PreviewRouter';
import { ThumbnailRouter } from './routes/ThumbnailRouter';
import { ServerTiming } from './utils/ServerTiming';

export class WebServer {
  readonly pageGenerator;
  readonly expressApp;
  private server: Server | null = null;

  constructor() {
    this.pageGenerator = new PageGenerator();

    this.expressApp = express();
    this.expressApp.disable('x-powered-by');
    this.expressApp.set('trust proxy', false);  // TODO REMOVE DEBUG

    // Prepare Server-Timings
    this.expressApp.use(ServerTiming.getExpressMiddleware(!runningInProduction));

    // Setup first Routes
    this.setupLoggingRoutes();
    this.setupNonSessionRoutes();

    // Setup json body parser
    const jsonMiddleware = express.json();
    this.expressApp.use((req, res, next) => {
      jsonMiddleware(req, res, (err) => {
        if (err) {
          next(new Error('Invalid JSON body'));
          // next(ApiError.create(ApiErrs.INVALID_JSON_BODY));
        } else {
          next();
        }
      });
    });

    // Setup session handler
    this.expressApp.use(expressSession({
      name: 'sessID',
      store: database?.isAvailable() ?
          new (expressSessionPG(expressSession))({
            tableName: 'sessions',
            pruneSessionInterval: 24 * 60 * 60, /* 24h */
            pool: database.getPool() ?? undefined
          })
          : undefined,
      secret: config.data.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      unset: 'destroy',
      cookie: {
        secure: config.data.cookies.secure,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: database?.isAvailable() ? 30 * 24 * 60 * 60 * 1000 /* 30d */ : 30 * 60 * 1000 /* 30min */
      }
    }));

    // Setup the remaining routes
    this.setupNormalRoutes();

    // Setup error handling
    this.setupErrorHandling();
  }

  public listen(cfg: { listen: { port: number, host: string, path: string, usePath: boolean } }): void {
    if (this.server != null) {
      throw new Error(`Server is already listening on ${cfg.listen.usePath ? cfg.listen.path : (cfg.listen.host + ':' + cfg.listen.port)}`);
    }

    this.server = createServer(this.expressApp);

    // Prepare socket

    // TODO: Do not handle errors in here but rather throw errors or allow a handler to be provided
    this.server.on('error', (err: { syscall: string, code: string }) => {
      if (err.syscall != 'listen') {
        throw err;
      }

      const errPrefix = cfg.listen.usePath ? `path ${cfg.listen.path}` : `port ${cfg.listen.port}`;
      switch (err.code) {
        case 'EACCES':
          console.error(`${errPrefix} requires elevated privileges`);
          process.exit(1);
          break;
        case 'EADDRINUSE':
          console.error(`${errPrefix} is already in use`);
          process.exit(1);
          break;
        default:
          throw err;
      }
    });
    this.server.on('listening', () => {
      const addr = this.server?.address();
      console.log(`Listening on ${addr && typeof addr != 'string' ? (addr.address + ':' + addr.port) : addr}`);

      console.log(`You should be able to visit ${PageGenerator.generateUrlPrefix(config.data.web, config.data.web.urlPrefix.dynamicContentHost)}`);
    });

    // Mount socket

    if (cfg.listen.usePath) {
      const unixSocketPath = cfg.listen.path,
          unixSocketPIDPath = cfg.listen.path + '.pid',
          parentDir = require('path').dirname(unixSocketPath);

      if (!fileExistsSync(parentDir)) {
        mkdirSync(parentDir, {recursive: true});
      }

      const isProcessRunning = (pid: number): boolean => {
        try {
          process.kill(pid, 0);
          return true;
        } catch (ex) {
          return ex.code == 'EPERM';
        }
      };

      if (fileExistsSync(unixSocketPath)) {
        let isRunning: boolean = false;
        let runningPID: number = -1;
        if (!fileExistsSync(unixSocketPIDPath) || !(isRunning = isProcessRunning(runningPID = parseInt(readFileSync(unixSocketPIDPath, 'utf-8'))))) {
          unlinkFileSync(unixSocketPath);
        }

        if (isRunning) {
          console.error(`The process (PID: ${runningPID}) that created '${unixSocketPath}' is still running!`);
          process.exit(1);
        }
      }

      writeFileSync(unixSocketPIDPath, process.pid.toString());
      this.server.listen(unixSocketPath);
      chmodSync(unixSocketPath, '0777');
    } else {
      this.server.listen(cfg.listen.port, cfg.listen.host);
    }
  }

  public close(callback?: (err?: Error) => void): void {
    if (this.server != null) {
      this.server.close(callback);
      this.server = null;
    }
  }

  private setupLoggingRoutes() {
    this.expressApp.use(morgan('[:date[web]] :remote-addr by :remote-user | :method :url :status with :res[content-length] bytes | ":user-agent" referred from ":referrer" | :response-time[3] ms',
        {stream: webAccessLogStream}));

    if (process.env.NODE_ENV == 'production') {
      this.expressApp.use(morgan('dev', {skip: (_req, res) => res.statusCode < 500}));
    } else {
      this.expressApp.use(morgan('dev'));
    }
  }

  private setupNonSessionRoutes() {
    // Serving static files too
    if (config.data.web.serveStatic) {
      this.expressApp.use(express.static(joinPath(__dirname, '..', 'resources', 'web', 'static')));
    }
  }

  private setupNormalRoutes() {
    this.expressApp.use('/login', LoginRouter.getRouter());

    this.expressApp.use((req, res, next) => {
      if (!WebServer.isLoggedIn(req)) {
        res.redirect('/login');
      } else {
        return next();
      }
    });

    // TODO: remove debug
    this.expressApp.get('/', (req, res) => {
      res.redirect('/browse/');
    });

    this.expressApp.use(DownloadRouter.getRouter());
    this.expressApp.use(BrowseRouter.getRouter(this.pageGenerator));
    this.expressApp.use('/thumbnail', ThumbnailRouter.getRouter());
    this.expressApp.use('/preview', PreviewRouter.getRouter(this.pageGenerator));
    this.expressApp.use('/live', LiveRouter.getRouter(this.pageGenerator));
    this.expressApp.use('/link', LinkRouter.getRouter());
  }

  private setupErrorHandling() {
    this.expressApp.use((req, _res, next) => {
      const err: any = new Error('Not Found');
      err.httpCode = 404;

      next(err);

      // next(ApiError.create(ApiErrs.NOT_FOUND, {url: `${req.protocol}://${req.hostname}/${req.originalUrl}`}));
    });

    this.expressApp.use((err: any /*ApiError */ /* is 'any' or 'unknown' (using ApiError for IntelliSense etc.) */, _req: express.Request, res: express.Response, next: express.NextFunction) => {
      // TODO
      // if (err == undefined) {
      //   err = new ApiError(500, 'The error handler has been called without providing an error', true, {
      //     typeof: typeof err,
      //     err
      //   });
      // } else if (typeof err != 'object' || !(err instanceof Error)) {
      //   err = new ApiError(500, 'The error handler has been called with an invalid error', true, {
      //     typeof: typeof err,
      //     err
      //   });
      // } else if (err instanceof ReferenceError && err.message.startsWith('ejs')) {
      // // TODO
      // } else if (err instanceof multer.MulterError) {
      // // TODO
      // } else if (!(err instanceof ApiError)) {
      //   err = ApiError.fromError(err);
      // }

      if (res.headersSent) return next(err);  // Calls express default handler

      if ((err?.httpCode ?? 500) == 500) {
        console.error(err);
      }

      res.status(err?.httpCode ?? 500)
          .send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Error ${err.httpCode}</title></head>` +
              `<body><h1>Error ${err.httpCode}</h1><small>${err.message.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>\n')}</small></body></html>`);
      // TODO: Send html based on templates
    });
  }

  public static isLoggedIn(req: express.Request): boolean {
    if (database?.isAvailable()) {
      return !!req.session?.user;
    }

    // Disabled for now
    // Maintenance login
    // if (adminPassword) {
    //   const authStr = req.header('Authorization');
    //
    //   if (authStr && authStr.toLowerCase().startsWith('basic ')) {
    //     const auth = Buffer.from(authStr.substring('basic '.length), 'base64').toString('utf-8');
    //     const username = auth.substring(0, auth.indexOf(':'));
    //     const password = auth.substring(auth.indexOf(':') + 1);
    //
    //     return username === 'nas_admin' && password === adminPassword;
    //   }
    // }

    return false;
  }
}
