import { Router } from 'express';
import { adminPassword, config, database } from '../index';
import { httpGet, httpPost } from '../utils/web';
import { WebServer } from '../WebServer';

const redirectUri = 'http://localhost:8092/login/github';

export class LoginRouter {
  static getRouter(): Router {
    const router = Router();

    router.all('/', (req, res, next) => {
      if (WebServer.isLoggedIn(req)) {
        res.send('You are logged in.');
      } else {
        if (!database?.isAvailable()) {
          if (adminPassword) {
            res.status(401)
                .set('WWW-Authenticate', 'Basic realm="Maintenance login", charset="UTF-8"')
                .send('This instance is not connected to a database - If you need to login anyways, please check the app\'s startup log for credentials.');
          } else {    // This should not be possible but just in case
            res.status(403)
                .send('This instance is not connected to a database.');
          }
        } else {
          res.status(401)
              .send('You are not logged in.');
        }
      }
    });

    router.all('/github', (req, res, next) => {
      if (WebServer.isLoggedIn(req)) {
        return res.redirect('/login');
      }

      if (config.data.oauth.github.client_id.length == 0) {
        return res.status(404)
            .send('Login via GitHub is not configured.');
      }

      if (req.query.code) {
        httpPost('https://github.com/login/oauth/access_token', {Accept: 'application/json'},
            {
              client_id: config.data.oauth.github.client_id,
              client_secret: config.data.oauth.github.client_secret,

              code: req.query.code,
              redirect_uri: redirectUri
            })
            .then((httpRes) => {
              const body = JSON.parse(httpRes.body.toString('utf-8'));

              if (!body.error) {
                httpGet('https://api.github.com/user',
                    {
                      Accept: 'application/json',
                      Authorization: `token ${body.access_token}`
                    })
                    .then((userRes) => {
                      const githubUser = JSON.parse(userRes.body.toString('utf-8'));

                      database?.getUserByGitHub(githubUser.id)
                          .then((nasUser) => {
                            if (nasUser) {
                              database?.updateUserGitHubData({
                                id: githubUser.id,

                                login: githubUser.login,
                                name: githubUser.name,
                                email: githubUser.email,

                                avatar_url: githubUser.avatar_url,
                                html_url: githubUser.html_url,

                                created_at: githubUser.created_at,
                                updated_at: githubUser.updated_at
                              })
                                  .then(() => {
                                    req.session.user = {
                                      id: nasUser.id,
                                      name: nasUser.name,
                                      githubId: nasUser.githubId
                                    };

                                    res.redirect('/login');
                                  })
                                  .catch(next);
                            } else {
                              res.send('No account is associated with that GitHub account.');
                            }
                          })
                          .catch(next);
                    })
                    .catch(next);
              } else {
                res.send(`<b>Error:</b> ${body.error || 'Unknown error'}\n<br><b>Error-Description:</b> ${body.error_description || '-'}`);
              }
            })
            .catch(next);
      } else {
        res.redirect('https://github.com/login/oauth/authorize' +
            `?client_id=${config.data.oauth.github.client_id}` +
            `&redirect_uri=${encodeURIComponent(redirectUri)}` /* TODO */ +
            `&allow_signup=false`);
      }
    });

    return router;
  }
}
