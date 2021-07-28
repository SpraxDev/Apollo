import express, { Router } from 'express';
import request from 'superagent';
import { NasUser } from '../global';
import { adminPassword, config, getDatabase } from '../index';
import { PageGenerator } from '../PageGenerator';
import { OAuthProviderEnum } from '../utils/Database';
import { JwtAudience, JwtUtils } from '../utils/JwtUtils';
import { Utils } from '../utils/Utils';
import { Web } from '../utils/Web';
import { WebServer } from '../WebServer';

type OAuthProviderList = Array<{
  available: boolean;

  name: OAuthProviderEnum;

  redirectUri: string;
  authUri: string;

  tokenExchange: {
    uri: string;
    jsonBody: boolean;
  };

  api: {
    authMethod: 'token' | 'Bearer';

    routes: { userInfo: string, profileImg?: string };

    extractUserInfo: (apiRes: { res: request.Response, body: Buffer }) => Promise<{ id: number | string, data: object, profileImg?: string | Buffer | null }>;
    extractProfileImage?: (apiRes: { res: request.Response, body: Buffer }) => Buffer;
  };
}>;

export class LoginRouter {
  static getRouter(pageGenerator: PageGenerator): Router {
    const router = Router();

    router.all('/', (req, res, next) => {
      Utils.restful(req, res, next, {
        get: () => {
          if (WebServer.isLoggedIn(req)) {
            res.redirect(pageGenerator.globals.url.base + '/browse');
          } else {
            if (!getDatabase().isAvailable()) {
              if (adminPassword) {
                res.status(401)
                    .set('WWW-Authenticate', 'Basic realm="Maintenance login", charset="UTF-8"')
                    .send('This instance is not connected to a database - If you need to login anyways, please check the app\'s startup log for credentials.');
              } else {    // This should not be possible but just in case
                res.status(403)
                    .send('This instance is not connected to a database.');
              }
            } else {
              let html = '<h1><u>You are not logged in.</u></h1><br><br>';

              for (const provider of this.getOAuthProvider(pageGenerator)) {
                html += `<a href="/login/${provider.name.toLowerCase()}">${provider.name}</a><br>`;
              }

              res.status(401)
                  .send(html);
            }
          }
        }
      });
    });

    router.all('/token', (req, res, next) => {
      const queryToken = req.query.t;

      Utils.restful(req, res, next, {
        get: async (): Promise<void> => {
          if (WebServer.isLoggedIn(req)) {
            return res.redirect('/login');
          }

          if (typeof queryToken != 'string' || queryToken.trim().length == 0) {
            res.status(401)
                .send('Invalid or expired Token');
            return;
          }

          try {
            await JwtUtils.verify(queryToken);  // Check if token is valid in general

            const jwtData = await JwtUtils.verify(queryToken, {audience: [JwtAudience.LOGIN, JwtAudience.LOGIN_NO_OAUTH]});
            const onlyWithoutOAuth: boolean = await JwtUtils.verify(queryToken, {audience: [JwtAudience.LOGIN_NO_OAUTH]})
                .then(() => true)
                .catch(() => false);

            if (!jwtData.iss) throw new Error(`JWT is missing 'issuer' information`);
            if (!jwtData.sub) throw new Error(`JWT is missing 'subject' information`);

            const issuerUser = await getDatabase().getUserByTokenId(jwtData.iss);
            if (!issuerUser) throw new Error(`JWT 'issuer' user does not exist`);

            const subjectUser = await getDatabase().getUserByTokenId(jwtData.sub);
            if (!subjectUser) throw new Error(`JWT 'subject' user does not exist`);

            if (!issuerUser.isAdmin && issuerUser.id != subjectUser.id) throw new Error(`JWT 'issuer' is not the subject and not an admin`);

            const oAuthCount = await getDatabase().getUsersOAuthProviderCount(subjectUser.id) ?? 0;

            if (onlyWithoutOAuth && oAuthCount > 0) {
              throw new Error(`JWT is to be considered expired as at least one OAuth provider is configured for 'subject' user`);
            }

            if (jwtData.jti && !(await getDatabase().invalidateOneTimeJWT(jwtData.jti))) {
              throw new Error('JWT token has already been used');
            }

            await this.updateSessionData(req, issuerUser, oAuthCount);

            res.redirect('/login');

            console.log(`User #${subjectUser.id} successfully logged in from ${req.ip} via JWT (User-Agent='${req.header('User-Agent') || ''}')`);
          } catch (err) {
            res.status(401)
                .send(`Invalid or expired Token (${err.message})`);
          }
        }
      });
    });

    for (const provider of LoginRouter.getOAuthProvider(pageGenerator)) {
      router.all(`/${provider.name.toLowerCase()}`, (req, res, next) => {
        Utils.restful(req, res, next, {
          get: async (): Promise<void> => {
            if (WebServer.isLoggedIn(req)) {
              return res.redirect('/login');
            }

            if (!provider.available) {
              res.status(409 /* Conflict */)
                  .send(`Login via ${provider.name} is not configured.`);
              return;
            }

            if (typeof req.query.code == 'string' && req.query.code.length > 0) {
              const tokenBodyData: { [key: string]: string } = {
                client_id: config.data.oauth[provider.name].client_id,
                client_secret: config.data.oauth[provider.name].client_secret,
                grant_type: 'authorization_code',

                code: req.query.code,
                redirect_uri: provider.redirectUri
              };

              let tokenBody;

              if (provider.tokenExchange.jsonBody) {
                tokenBody = tokenBodyData;
              } else {
                tokenBody = '';

                for (const bodyDataKey in tokenBodyData) {
                  if (tokenBody.length > 0) {
                    tokenBody += '&';
                  }

                  tokenBody += `${bodyDataKey}=${encodeURIComponent(tokenBodyData[bodyDataKey])}`;
                }
              }

              const tokenRes = await Web.httpPost(provider.tokenExchange.uri, {
                Accept: 'application/json',
                'Content-Type': provider.tokenExchange.jsonBody ? 'application/json' : 'application/x-www-form-urlencoded'
              }, tokenBody);
              const tokenResBody = JSON.parse(tokenRes.body.toString('utf-8'));

              if (!tokenResBody.error) {
                const userRes = await Web.httpGet(provider.api.routes.userInfo,
                    {
                      Accept: 'application/json',
                      Authorization: `${provider.api.authMethod} ${tokenResBody.access_token}`
                    });

                const userData = await provider.api.extractUserInfo(userRes);
                const dbUser = await getDatabase().getUserByOAuth(userData.id, provider.name);

                if (userData.id == null || (typeof userData.id == 'string' && userData.id.trim().length == 0)) {
                  res.status(400)
                      .send('Service returned an empty ID');
                  return;
                }

                if (dbUser) { // Account exists
                  await getDatabase().updateOAuthData(userData.id, provider.name, userData.data);

                  if (Buffer.isBuffer(userData.profileImg) || userData.profileImg === null) {
                    await getDatabase().setOAuthProfileImage(userData.id, provider.name, userData.profileImg);
                  } else {
                    try {
                      if (typeof userData.profileImg == 'string') {
                        const imgRes = await Web.httpGet(userData.profileImg, {Authorization: `${provider.api.authMethod} ${tokenResBody.access_token}`});
                        let fetchedImg;

                        if (imgRes.res.status === 200) {
                          fetchedImg = imgRes.body;
                        } else if (imgRes.res.status === 404) {
                          fetchedImg = null;
                        } else {
                          console.error(`Server returned HTTP status ${imgRes.res.status} for '${provider.api.routes.profileImg}'`);
                        }

                        if (fetchedImg != undefined) {
                          await getDatabase().setOAuthProfileImage(userData.id, provider.name, fetchedImg);
                        }

                      } else if (provider.api.routes.profileImg) {
                        const imgRes = await Web.httpGet(provider.api.routes.profileImg, {Authorization: `${provider.api.authMethod} ${tokenResBody.access_token}`});
                        let fetchedImg;

                        if (imgRes.res.status === 200) {
                          fetchedImg = imgRes.body;
                        } else if (imgRes.res.status === 404) {
                          fetchedImg = null;
                        } else {
                          console.error(`Server returned HTTP status ${imgRes.res.status} for '${provider.api.routes.profileImg}'`);
                        }

                        if (fetchedImg != undefined) {
                          await getDatabase().setOAuthProfileImage(userData.id, provider.name, fetchedImg);
                        }
                      }
                    } catch (err) {
                      console.error('Error fetching profile image', err);
                    }
                  }

                  await this.updateSessionData(req, dbUser);

                  res.redirect('/login');

                  console.log(`User #${dbUser.id} successfully logged in from ${req.ip} via ${provider.name} (User-Agent='${req.header('User-Agent') || ''}')`);
                } else {
                  res.send(`No account is associated with that ${provider.name} account.<br><code>${JSON.stringify(userData.data, null, 4).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>\n')}</code>`);
                }
              } else {
                res.send(`<b>Error:</b> ${tokenResBody.error || 'Unknown error'}\n<br><b>Error-Description:</b> ${tokenResBody.error_description || '-'}`);
              }
            } else if (req.query.error || req.query.error_description) {
              res.send(`<b>Error:</b> ${req.query.error || 'Unknown error'}\n<br><b>Error-Description:</b> ${req.query.error_description || '-'}`);
            } else {
              res.redirect(provider.authUri);
            }
          }
        });
      });
    }

    return router;
  }

  static getOAuthProvider(pageGenerator: PageGenerator): OAuthProviderList {
    const userInfoHttpErrMsg = (httpCode: number) => `Got HTTP code ${httpCode} when trying to get UserInfo`;

    const result: OAuthProviderList = [
      {
        available: false,

        name: 'GitHub',

        redirectUri: '%REDIRECT_URI%',
        authUri: 'https://github.com/login/oauth/authorize' +
            `?client_id=%CLIENT_ID%` +
            `&redirect_uri=%REDIRECT_URI%` +
            '&response_type=code' +
            '&allow_signup=false',

        tokenExchange: {
          uri: 'https://github.com/login/oauth/access_token',
          jsonBody: true
        },

        api: {
          authMethod: 'token',

          routes: {
            userInfo: 'https://api.github.com/user'
          },

          extractUserInfo: async (httpRes) => {
            if (httpRes.res.status != 200) throw new Error(userInfoHttpErrMsg(httpRes.res.status));

            const githubUser = JSON.parse(httpRes.body.toString('utf-8'));

            return {
              id: githubUser.id,
              profileImg: githubUser.avatar_url ?? null,

              data: {
                id: githubUser.id,

                login: githubUser.login,
                name: githubUser.name,
                email: githubUser.email,

                avatar_url: githubUser.avatar_url,
                html_url: githubUser.html_url,

                created_at: githubUser.created_at,
                updated_at: githubUser.updated_at
              }
            };
          }
        }
      },
      {
        available: false,

        name: 'Microsoft',

        redirectUri: '%REDIRECT_URI%',
        authUri: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/authorize' +
            `?client_id=%CLIENT_ID%` +
            `&redirect_uri=%REDIRECT_URI%` +
            `&response_type=code` +
            `&response_mode=query` +
            `&scope=${encodeURIComponent('openid profile')}`,

        tokenExchange: {
          uri: 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token',
          jsonBody: false
        },

        api: {
          authMethod: 'Bearer',

          routes: {
            userInfo: 'https://graph.microsoft.com/oidc/userinfo',
            profileImg: 'https://graph.microsoft.com/beta/users/UserIdOrPrincipalName/photo/$value'
          },

          extractUserInfo: async (httpRes) => {
            if (httpRes.res.status != 200) throw new Error(userInfoHttpErrMsg(httpRes.res.status));

            const microsoftUser = JSON.parse(httpRes.body.toString('utf-8'));

            return {
              id: microsoftUser.sub,

              data: {
                sub: microsoftUser.sub,

                name: microsoftUser.name,
                email: microsoftUser.email
              }
            };
          }
        }
      },
      {
        available: false,

        name: 'Google',

        redirectUri: '%REDIRECT_URI%',
        authUri: 'https://accounts.google.com/o/oauth2/v2/auth' +
            `?client_id=%CLIENT_ID%` +
            `&redirect_uri=%REDIRECT_URI%` +
            `&response_type=code` +
            '&include_granted_scopes=true' +
            `&scope=${encodeURIComponent('https://www.googleapis.com/auth/userinfo.profile')}`,

        tokenExchange: {
          uri: 'https://oauth2.googleapis.com/token',
          jsonBody: false
        },

        api: {
          authMethod: 'Bearer',

          routes: {
            userInfo: 'https://www.googleapis.com/userinfo/v2/me'
          },

          extractUserInfo: async (httpRes) => {
            if (httpRes.res.status != 200) throw new Error(userInfoHttpErrMsg(httpRes.res.status));

            const googleUser = JSON.parse(httpRes.body.toString('utf-8'));

            return {
              id: googleUser.id,
              profileImg: googleUser.picture,

              data: {
                id: googleUser.id,

                name: googleUser.name,
                email: googleUser.email
              }
            };
          }
        }
      }
    ];

    for (const provider of result) {
      const clientId = config.data.oauth[provider.name].client_id;
      const clientSecret = config.data.oauth[provider.name].client_secret;

      provider.available = !!(clientId && clientSecret);

      if (provider.available) {
        provider.redirectUri = `${pageGenerator.globals.url.base}/login/${provider.name.toLowerCase()}`;

        provider.authUri = provider.authUri
            .replace(/%CLIENT_ID%/g, encodeURIComponent(clientId))
            .replace(/%REDIRECT_URI%/g, encodeURIComponent(provider.redirectUri));
      }
    }

    return result;
  }

  static async updateSessionData(req: express.Request, user: NasUser, oAuthProviderCount?: number): Promise<void> {
    if (typeof oAuthProviderCount != 'number') {
      oAuthProviderCount = await getDatabase().getUsersOAuthProviderCount(user.id);
    }

    req.session.suggestOAuthSetup = oAuthProviderCount <= 0;

    req.session.user = user;
  }
}
