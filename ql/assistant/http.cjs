'use strict';
const jwt = require('jsonwebtoken');
const {AssistantError, createAssistantCore, requireAccount} = require('./core.cjs');
function createAssistantHandler({db, jwtSecret, enabled = false}) {
  const core = createAssistantCore(db);
  return async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    if (!enabled) return res.status(404).json({error: 'Not found'});
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    res.on('close', cancel);
    try {
      // Use the normal bearer JWT, but never the legacy admin-key bypass or stale tier fallback.
      const header = req.headers.authorization;
      const authorize = () => {
        if (typeof header !== 'string' || !/^Bearer \S+$/.test(header))
          throw new AssistantError(401, 'UNAUTHENTICATED', 'Not authenticated');
        let claims;
        try { claims = jwt.verify(header.slice(7), jwtSecret); }
        catch { throw new AssistantError(401, 'UNAUTHENTICATED', 'Invalid token'); }
        requireAccount(db, claims.userId);
        return claims.userId;
      };
      res.json(await core.turn({request: req.body, authorize, signal: controller.signal}));
    } catch (error) {
      // No private input, records, provider errors or credentials enter logs/errors.
      if (!res.destroyed) res.status(error instanceof AssistantError ? error.status : 503).json({
        error: error instanceof AssistantError ? error.message : 'Assistant unavailable.',
        code: error instanceof AssistantError ? error.code : 'ASSISTANT_UNAVAILABLE'
      });
    } finally { res.off('close', cancel); }
  };
}
module.exports = {createAssistantHandler};
