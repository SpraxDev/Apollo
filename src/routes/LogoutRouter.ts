import { Router } from 'express';

export class LogoutRouter {
  static getRouter(): Router {
    const router = Router();

    router.all('/', (req, res, next) => {
      // Store cookie properties for manual deletion
      const cookie = req.session.cookie;
      cookie.maxAge = 0;

      // Destroy session
      req.session.destroy((err) => {
        if (err) return next(err);

        // Delete cookie
        res.clearCookie('sessID', {
          domain: cookie.domain,
          httpOnly: cookie.httpOnly,
          maxAge: 0,
          path: cookie.path,
          sameSite: cookie.sameSite,
          secure: cookie.secure
        });

        res.redirect('/login');
      });
    });

    return router;
  }
}
