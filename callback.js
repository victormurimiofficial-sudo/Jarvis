const core = require('../lib/core');

module.exports = async (req, res) => {
  try {
    const s = core.session(req);
    if (!s || !s.ok) { res.writeHead(302, { Location: '/' }); return res.end(); }
    const j = await core.tokenPost({ grant_type: 'authorization_code', code: req.query.code, redirect_uri: core.redirectUri(req) });
    if (!j.refresh_token) throw new Error('Google sent no refresh token. Remove the app at myaccount.google.com/permissions, then connect again.');
    core.setSession(res, { ok: 1, rt: j.refresh_token });
    res.writeHead(302, { Location: '/' });
    res.end();
  } catch (e) { res.status(500).send('Connect failed: ' + e.message); }
};
