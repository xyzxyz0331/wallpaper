'use strict';

module.exports = function requireAuth(req, res, next) {
  if (req.session && req.session.authed) {
    return next();
  }
  res.status(401).json({ error: 'Unauthorized' });
};
