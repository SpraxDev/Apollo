declare module 'express-session' {
  // noinspection JSUnusedGlobalSymbols
  interface SessionData {
    user: NasUser;
  }
}

declare module 'ejs' {
  // noinspection JSUnusedGlobalSymbols
  interface Options {
    includer?: (originalPath: string, parsedPath: string) => { filename?: string, template?: string };
  }
}

export interface IConfig {
  readonly oauth: {
    readonly github: {
      readonly client_id: string;
      readonly client_secret: string;
    }
  };

  readonly web: {
    readonly listen: {
      readonly usePath: boolean;
      readonly path: string;
      readonly host: string;
      readonly port: number;
    }

    readonly serveStatic: boolean;

    readonly urlPrefix: {
      readonly https: boolean;
      readonly dynamicContentHost: string;
      readonly staticContentHost: string;
    }
  };

  readonly postgreSQL: {
    readonly enabled: boolean;

    readonly host: string;
    readonly port: number;
    readonly ssl: boolean;

    readonly user: string;
    readonly password: string;

    readonly database: string;
  };

  readonly cookies: {
    readonly secure: boolean;
  };

  readonly secret: string;
}

export interface NasUser {
  readonly id: number;
  readonly githubId: number | null;

  readonly name: string;
}

export interface NasUserDb extends NasUser {
  readonly githubData?: {
    readonly id: number;

    readonly login: string;
    readonly name: string;
    readonly email: string;

    readonly avatar_url: string;
    readonly html_url: string;

    readonly created_at: string;
    readonly updated_at: string;
  };
}

export interface BrowsePageData extends IPageData {
  readonly page: {
    readonly type: 'data' | 'trash';
    readonly typeFront: 'browse' | 'trash';

    readonly breadcrumb: string[];

    readonly directories: { path: string, name: string }[];
    readonly files: { path: string, name: string, modifyDate: Date }[];
  };
}

export interface PreviewPageData extends IPageData {
  readonly page: {
    readonly raw?: string;

    readonly file: {
      readonly name: string;
      readonly mimeType: string;

      readonly downloadPath: string;

      readonly alternatives: Array<{
        readonly mimeType: string;
        readonly downloadPath: string;
      }>
    }
  };
}

export interface LivePageData extends IPageData {
  readonly page: {
    readonly file: {
      readonly name: string;
      readonly mimeType: string;
      readonly browsePath: string;
    }

    readonly hls: {
      readonly master: string;
    }
  };
}

export interface IPageData {
  readonly user: NasUser;
}
