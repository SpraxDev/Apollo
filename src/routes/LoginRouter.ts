import { Router } from 'express';
import { adminPassword, config, getDatabase } from '../index';
import { Web } from '../utils/Web';
import { WebServer } from '../WebServer';

export class LoginRouter {
  static getRouter(): Router {
    const router = Router();

    router.all('/', (req, res, next) => {
      if (WebServer.isLoggedIn(req)) {
        res.send('You are logged in.');
      } else {
        if (!getDatabase()?.isAvailable()) {
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
        Web.httpPost('https://github.com/login/oauth/access_token', {Accept: 'application/json'},
            {
              client_id: config.data.oauth.github.client_id,
              client_secret: config.data.oauth.github.client_secret,

              code: req.query.code,
              redirect_uri: config.data.oauth.github.redirectUri
            })
            .then((httpRes) => {
              const body = JSON.parse(httpRes.body.toString('utf-8'));

              if (!body.error) {
                Web.httpGet('https://api.github.com/user',
                    {
                      Accept: 'application/json',
                      Authorization: `token ${body.access_token}`
                    })
                    .then((userRes) => {
                      const githubUser = JSON.parse(userRes.body.toString('utf-8'));

                      getDatabase()?.getUserByGitHub(githubUser.id)
                          .then((nasUser) => {
                            if (nasUser) {
                              getDatabase()?.updateUserGitHubData({
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

                                    console.log(`User #${nasUser.id} successfully logged in from ${req.ip} via GitHub (User-Agent=${req.header('User-Agent')})`);
                                    res.on('close', () => {
                                      console.log(res.getHeader('Set-Cookie'));
                                    });
                                  })
                                  .catch(next);
                            } else {
                              res.send(`No account is associated with that GitHub account.<br><code>${JSON.stringify(githubUser, null, 4).replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>\n')}</code>`);
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
      } else if (req.query.error || req.query.error_description) {
        res.send(`<b>Error:</b> ${req.query.error || 'Unknown error'}\n<br><b>Error-Description:</b> ${req.query.error_description || '-'}`);
      } else {
        res.redirect('https://github.com/login/oauth/authorize' +
            `?client_id=${config.data.oauth.github.client_id}` +
            `&redirect_uri=${encodeURIComponent(config.data.oauth.github.redirectUri)}` +
            `&allow_signup=false`);
      }
    });

    return router;
  }
}
