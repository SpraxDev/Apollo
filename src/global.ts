import { OAuthProviderEnum } from './utils/Database';

declare module 'express-session' {
  // noinspection JSUnusedGlobalSymbols
  interface SessionData {
    suggestOAuthSetup: boolean;

    user: NasUser;
  }
}

declare module 'ejs' {
  // noinspection JSUnusedGlobalSymbols
  interface Options {
    includer?: (originalPath: string, parsedPath: string) => { filename?: string, template?: string };
  }
}

export interface IConfigOAuthProvider {
  readonly client_id: string;
  readonly client_secret: string;
}

export interface IConfig {
  readonly oauth: { [key in OAuthProviderEnum]: IConfigOAuthProvider };

  readonly web: {
    readonly listen: {
      readonly usePath: boolean;
      readonly path: string;
      readonly host: string;
      readonly port: number;
    };

    readonly serveStatic: boolean;
    readonly trustProxy: boolean;

    readonly urlPrefix: {
      readonly https: boolean;
      readonly dynamicContentHost: string;
      readonly staticContentHost: string;
    };
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

  readonly redis: {
    readonly enabled: boolean;

    readonly host: string;
    readonly port: number;

    readonly db: number;
    readonly password: string;
  };

  readonly cookies: {
    readonly secure: boolean;
  };

  readonly secret: string;
}

export interface NasUser {
  readonly id: number;

  readonly name: string;

  readonly isAdmin: boolean;

  readonly tokenId: string;

  readonly storageQuota: number | null;
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
      readonly livePath: string;
      readonly downloadPathNoAuth: string;

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
      readonly masterUnauthorized: string;
    }
  };
}

export interface AdminPageData extends IPageData {
  readonly page: {
    readonly accounts: Array<NasUser & { oauthCount: number }>;
  };
}

export interface IPageData {
  readonly user: NasUser;
}
