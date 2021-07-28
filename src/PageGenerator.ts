import * as ejs from 'ejs';
import { readFileSync } from 'fs';
import path, { join as joinPath } from 'path';
import { IConfig, IPageData } from './global';
import { config, runningInProduction } from './index';

export enum PageType {
  BROWSE,
  PREVIEW,
  LIVE,

  ADMIN
}

export class PageGenerator {
  private static readonly HTML_PATH = path.resolve(joinPath(__dirname, '..', 'resources', 'web', 'dynamic'));

  readonly globals: { url: { base: string, static: string } };

  readonly cachedPages: { [key in PageType]: string | (() => string) };

  constructor() {
    const FILE_PATHS: { [key in PageType]: string } = {
      [PageType.BROWSE]: joinPath(PageGenerator.HTML_PATH, 'browse.html'),
      [PageType.PREVIEW]: joinPath(PageGenerator.HTML_PATH, 'preview.html'),
      [PageType.LIVE]: joinPath(PageGenerator.HTML_PATH, 'live.html'),

      [PageType.ADMIN]: joinPath(PageGenerator.HTML_PATH, 'admin.html')
    };

    this.globals = {
      url: {
        base: PageGenerator.generateUrlPrefix(config.data.web, config.data.web.urlPrefix.dynamicContentHost),
        static: PageGenerator.generateUrlPrefix(config.data.web, config.data.web.urlPrefix.staticContentHost)
      }
    };

    const tmpCache: { [key: string]: string | (() => string) } = {};

    for (const filesKey in FILE_PATHS) {
      const getHtml = () => this.renderEjs(
          readFileSync((FILE_PATHS as { [key: string]: string })[filesKey], 'utf-8'),
          0, {globals: this.globals}
      );

      tmpCache[filesKey] = runningInProduction ? getHtml() : getHtml;
    }

    this.cachedPages = tmpCache as { [key in PageType]: string | (() => string) };
  }

  getPage(page: PageType, data: IPageData): string {
    // TODO: ServerTimings
    const html = this.cachedPages[page];

    return this.renderEjs(typeof html == 'string' ? html : html(), 2, data);
  }

  /**
   * * **Level 0**: Used when inserting `global`s or `_HEAD`, `_HEADER`, ...
   * * **Level 1**: Used when inserting localization string
   * * **Level 2**: Used when inserting/generating dynamic content
   */
  private renderEjs(str: string, level: 0 | 1 | 2, data?: ejs.Data): string {
    return ejs.render(str, data, {
      openDelimiter: '%{',
      closeDelimiter: '}',
      delimiter: `${level}`,

      includer: (originalPath: string) => {
        originalPath = path.resolve(joinPath(PageGenerator.HTML_PATH, originalPath.substring(path.isAbsolute(originalPath) ? 1 : 0)));

        if (!originalPath.startsWith(PageGenerator.HTML_PATH)) {
          throw new Error(`Trying to include '${originalPath}' which is outside of '${PageGenerator.HTML_PATH}'`);
        }

        return {filename: originalPath};
      }
    });
  }

  /**
   * Takes `host` and applies the chosen protocol from `cfg.web.urlPrefix.https`
   *
   * If the host is set to `auto`, host and port from `cfg.listen` are taken and used instead.
   * The port is automatically emitted when it is the default port for the chosen protocol
   *
   * @param cfg The webserver configuration
   * @param host Should be `auto` or a hostname with optional port (`host[:port]`)
   */
  static generateUrlPrefix(cfg: IConfig['web'], host: string | 'auto') {
    const protocol = `http${cfg.urlPrefix.https ? 's' : ''}`;

    if (host == 'auto') {
      host = cfg.listen.host;

      if ((cfg.urlPrefix.https && cfg.listen.port != 443) ||
          (!cfg.urlPrefix.https && cfg.listen.port != 80)) {
        host += `:${cfg.listen.port}`;
      }
    }

    return `${protocol}://${host}`;
  }
}
