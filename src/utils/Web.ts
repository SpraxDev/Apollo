import { type as osType } from 'os';
import {
  get as saGet,
  parse as agentParsers,
  post as saPost,
  Response as saResponse,
  SuperAgentRequest
} from 'superagent';
import { appVersion } from '../index';

export class Web {
  static readonly httpUserAgent = `NAS-Web/${appVersion} (${osType()}; ${process.arch}; ${process.platform}) (+https://github.com/SpraxDev/NAS-Web#readme)`;

  /**
   * @param url The URL to send the request to
   * @param headers Optional. Headers to send with the request (additionally to the default headers)
   */
  static async httpGet(url: string, headers?: { [key: string]: string }): Promise<{ res: saResponse, body: Buffer }> {
    return new Promise<{ res: saResponse, body: Buffer }>((resolve, reject) => {
      this.applyDefaults(saGet(url), headers)
          .end(this.getReqHandler(resolve, reject));
    });
  }

  /**
   * @param url The URL to send the request to
   * @param headers Optional. Headers to send with the request (additionally to the default headers)
   * @param body Optional. The request body to send
   */
  static async httpPost(url: string, headers?: { [key: string]: string }, body?: string | object): Promise<{ res: saResponse, body: Buffer }> {
    return new Promise<{ res: saResponse, body: Buffer }>((resolve, reject) => {
      this.applyDefaults(saPost(url), headers, body)
          .end(this.getReqHandler(resolve, reject));
    });
  }

  private static applyDefaults(req: SuperAgentRequest, headers?: { [key: string]: string }, body?: string | object): SuperAgentRequest {
    // set own default headers
    req.set('User-Agent', this.httpUserAgent);

    // Set optional headers
    if (headers) {
      for (const header in headers) {
        if (Object.prototype.hasOwnProperty.call(headers, header)) {
          req.set(header, headers[header]);
        }
      }
    }

    // Force the response body to be a Buffer instead of a String
    req.buffer(true)
        .parse(agentParsers['application/octet-stream']);

    // Set optional body
    if (body) {
      req.send(body);
    }

    // Return same req for chaining
    return req;
  }

  private static getReqHandler(resolve: Function, reject: Function): (err: any, res: saResponse) => void {
    return (err, res) => {
      if (err && !res) return reject(err);  // An error occurred (HTTP errors are excluded! 404 is not an error in my eyes as the request itself was successful)

      return resolve({res, body: res.body});
    };
  }
}
