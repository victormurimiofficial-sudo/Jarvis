// Shared helpers: encrypted cookie session, Google token, Gmail + Calendar read and write.
const crypto = require('crypto');
const key = () => crypto.createHash('sha256').update(process.env.SESSION_SECRET || '').digest();

const seal = o => {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const b = Buffer.concat([c.update(JSON.stringify(o)), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), b]).toString('base64url');
};
const unseal = s => {
  try {
    const b = Buffer.from(String(s), 'base64url');
    const d = crypto.createDecipheriv('aes-256-gcm', key(), b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]));
  } catch { return null; }
};
const session = req => {
  const m = (req.headers.cookie || '').match(/(?:^|; )jv=([^;]+)/);
  return m ? unseal(m[1]) : null;
};
const setSession = (res, o) =>
  res.setHeader('Set-Cookie', `jv=${seal(o)}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=31536000`);
const same = (a, b) => {
  const h = x => crypto.createHash('sha256').update(String(x)).digest();
  return crypto.timingSafeEqual(h(a), h(b));
};

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/calendar.events'
].join(' ');
const redirectUri = req => `https://${req.headers['x-forwarded-host'] || req.headers.host}/api/callback`;
const GM = 'https://gmail.googleapis.com/gmail/v1/users/me';
const CAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';

async function tokenPost(p) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...p })
  });
  const j = await r.json();
  if (!r.ok) throw new Error(j.error_description || j.error);
  return j;
}
const access = async rt => (await tokenPost({ grant_type: 'refresh_token', refresh_token: rt })).access_token;

async function data(at, from, to) {
  const g = async url => {
    const r = await fetch(url, { headers: { Authorization: 'Bearer ' + at } });
    if (!r.ok) throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 160)}`);
    return r.json();
  };
  const ok = v => v && !isNaN(Date.parse(v));
  const tMin = ok(from) ? new Date(from).toISOString() : new Date(Date.now() - 12 * 36e5).toISOString();
  const tMax = ok(to) ? new Date(to).toISOString() : new Date(Date.now() + 18 * 36e5).toISOString();
  const [cal, inbox, list] = await Promise.all([
    g(CAL + '?' + new URLSearchParams({ timeMin: tMin, timeMax: tMax, singleEvents: 'true', orderBy: 'startTime', maxResults: '25' })),
    g(GM + '/labels/INBOX'),
    g(GM + '/messages?q=' + encodeURIComponent('is:unread in:inbox') + '&maxResults=10')
  ]);
  const mails = await Promise.all((list.messages || []).map(async m => {
    const x = await g(`${GM}/messages/${m.id}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID`);
    const h = n => (x.payload.headers.find(v => v.name.toLowerCase() === n.toLowerCase()) || {}).value || '';
    const raw = h('Reply-To') || h('From'), a = raw.match(/<([^>]+)>/);
    return { id: m.id, threadId: x.threadId, mid: h('Message-ID'), addr: (a ? a[1] : raw).trim(),
      from: h('From').replace(/<.*>/, '').replace(/"/g, '').trim() || h('From'),
      subject: h('Subject') || '(no subject)', snippet: x.snippet || '',
      days: Math.floor((Date.now() - +x.internalDate) / 864e5) };
  }));
  const events = (cal.items || []).filter(v => v.status !== 'cancelled').map(v => ({
    title: v.summary || '(no title)', start: v.start.dateTime || v.start.date, allDay: !v.start.dateTime }));
  return { unread: inbox.messagesUnread, mails, events };
}

const clean = s => String(s || '').replace(/[\r\n]+/g, ' ').trim();
const enc = s => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);

async function sendMail(at, { to, subject, body, threadId, inReplyTo }) {
  to = clean(to);
  if (!/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(to)) throw new Error('Invalid email address: ' + to);
  const h = [`To: ${to}`, `Subject: ${enc(clean(subject) || '(no subject)')}`, 'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64'];
  if (inReplyTo) h.push(`In-Reply-To: ${clean(inReplyTo)}`, `References: ${clean(inReplyTo)}`);
  const b64 = Buffer.from(String(body || '')).toString('base64').replace(/(.{76})/g, '$1\r\n');
  const raw = Buffer.from(h.join('\r\n') + '\r\n\r\n' + b64).toString('base64url');
  const r = await fetch(GM + '/messages/send', {
    method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify(threadId ? { raw, threadId } : { raw })
  });
  if (!r.ok) throw new Error('Gmail send failed: ' + (await r.text()).slice(0, 160));
}

async function createEvent(at, { title, start, end }) {
  const r = await fetch(CAL, {
    method: 'POST', headers: { Authorization: 'Bearer ' + at, 'Content-Type': 'application/json' },
    body: JSON.stringify({ summary: title, start: { dateTime: start }, end: { dateTime: end } })
  });
  if (!r.ok) throw new Error('Calendar failed: ' + (await r.text()).slice(0, 160));
}

async function gget(at, url) {
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + at } });
  if (!r.ok) throw new Error(`google ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return r.json();
}
async function mailMeta(at, id) {
  const x = await gget(at, `${GM}/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=From&metadataHeaders=Reply-To&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=Date`);
  const h = n => (x.payload.headers.find(v => v.name.toLowerCase() === n.toLowerCase()) || {}).value || '';
  const raw = h('Reply-To') || h('From'), a = raw.match(/<([^>]+)>/);
  return { id: x.id, threadId: x.threadId, mid: h('Message-ID'), addr: (a ? a[1] : raw).trim(),
    from: h('From').replace(/<.*>/, '').replace(/"/g, '').trim() || h('From'), subject: h('Subject') || '(no subject)',
    snippet: x.snippet || '', date: h('Date'), days: Math.floor((Date.now() - +x.internalDate) / 864e5) };
}
async function searchMail(at, q) {
  const l = await gget(at, GM + '/messages?q=' + encodeURIComponent(q) + '&maxResults=8');
  return Promise.all((l.messages || []).map(m => mailMeta(at, m.id)));
}
function textOf(p) {
  if (!p) return '';
  if (p.mimeType === 'text/plain' && p.body && p.body.data) return Buffer.from(p.body.data, 'base64url').toString('utf8');
  for (const c of p.parts || []) { const t = textOf(c); if (t) return t; }
  if (p.mimeType === 'text/html' && p.body && p.body.data)
    return Buffer.from(p.body.data, 'base64url').toString('utf8').replace(/<style[\s\S]*?<\/style>|<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  return '';
}
async function readMail(at, id) {
  const m = await mailMeta(at, id);
  const x = await gget(at, `${GM}/messages/${encodeURIComponent(id)}?format=full`);
  return { ...m, body: textOf(x.payload).trim().slice(0, 3500) };
}
async function listEvents(at, from, to) {
  if (isNaN(Date.parse(from)) || isNaN(Date.parse(to))) throw new Error('Bad date range');
  const j = await gget(at, CAL + '?' + new URLSearchParams({ timeMin: new Date(from).toISOString(), timeMax: new Date(to).toISOString(),
    singleEvents: 'true', orderBy: 'startTime', maxResults: '30' }));
  return (j.items || []).filter(v => v.status !== 'cancelled').map(v => ({
    title: v.summary || '(no title)', start: v.start.dateTime || v.start.date, end: v.end && (v.end.dateTime || v.end.date) }));
}

module.exports = { seal, unseal, session, setSession, same, SCOPES, redirectUri, tokenPost, access, data, sendMail, createEvent, mailMeta, searchMail, readMail, listEvents };
