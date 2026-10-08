import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { WebSocketServer } from 'ws';

const __dir = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT) || 8080;

if (!process.env.TOPSEP_KEY || process.env.TOPSEP_KEY.length < 32) {
  console.error('Ustaw TOPSEP_KEY (min. 32 znaki). Wygeneruj: openssl rand -hex 32');
  process.exit(1);
}
const KEY = crypto.createHash('sha256').update(process.env.TOPSEP_KEY).digest();
const SESSION_MS = 30 * 24 * 3600 * 1000;

const db = new DatabaseSync(process.env.TOPSEP_DB || path.join(__dir, 'topsep.db'));
db.exec(`
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS users(nick TEXT PRIMARY KEY, pass TEXT NOT NULL, created INTEGER);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, nick TEXT NOT NULL, created INTEGER);
CREATE TABLE IF NOT EXISTS chats(id TEXT PRIMARY KEY, type TEXT NOT NULL, name TEXT);
CREATE TABLE IF NOT EXISTS members(chat TEXT, nick TEXT, PRIMARY KEY(chat, nick));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY AUTOINCREMENT, chat TEXT, sender TEXT, iv TEXT, ct TEXT, ts INTEGER);
CREATE INDEX IF NOT EXISTS msg_chat ON messages(chat, id);
`);
const q = sql => db.prepare(sql);

// ---- Szyfrowanie wiadomości w bazie (AES-256-GCM) ----
const encrypt = t => {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const ct = Buffer.concat([c.update(t, 'utf8'), c.final(), c.getAuthTag()]);
  return { iv: iv.toString('base64'), ct: ct.toString('base64') };
};
const decrypt = (iv, ct) => {
  try {
    const b = Buffer.from(ct, 'base64');
    const d = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64'));
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(0, -16)), d.final()]).toString('utf8');
  } catch { return '[nie można odszyfrować]'; }
};

// ---- Hasła (scrypt) ----
const hashPass = p => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(p, s, 64).toString('hex'); };
const checkPass = (p, stored) => {
  const [s, h] = stored.split(':');
  return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(p, s, 64));
};

// ---- Limit prób logowania (10 prób / 15 min na IP) ----
const attempts = new Map();
const tooMany = ip => { const a = attempts.get(ip); return !!a && a.until > Date.now() && a.n >= 10; };
const failed = ip => {
  const a = attempts.get(ip) || { n: 0, until: 0 };
  if (a.until < Date.now()) { a.n = 0; a.until = Date.now() + 15 * 60e3; }
  a.n++; attempts.set(ip, a);
};

const NICK = /^[a-z0-9_.]{3,20}$/;
const online = new Map(); // nick -> Set<ws>
const send = (ws, o) => ws.readyState === 1 && ws.send(JSON.stringify(o));
const sendTo = (nick, o) => (online.get(nick) || new Set()).forEach(ws => send(ws, o));
const userExists = n => q('SELECT 1 FROM users WHERE nick=?').get(n);
const isMember = (chat, nick) => q('SELECT 1 FROM members WHERE chat=? AND nick=?').get(chat, nick);
const membersOf = chat => q('SELECT nick FROM members WHERE chat=?').all(chat).map(r => r.nick);
const chatsOf = nick => q('SELECT c.id, c.type, c.name FROM chats c JOIN members m ON m.chat=c.id WHERE m.nick=?')
  .all(nick).map(c => ({ ...c, members: membersOf(c.id) }));
const pushChats = nick => sendTo(nick, { type: 'chats', chats: chatsOf(nick) });

function createChat(id, type, name, members) {
  q('INSERT OR IGNORE INTO chats(id,type,name) VALUES(?,?,?)').run(id, type, name);
  for (const m of members) q('INSERT OR IGNORE INTO members(chat,nick) VALUES(?,?)').run(id, m);
  members.forEach(pushChats);
}
function bind(ws, nick) {
  ws.nick = nick;
  if (!online.has(nick)) online.set(nick, new Set());
  online.get(nick).add(ws);
}
function login(ws, nick, pass, isReg) {
  if (tooMany(ws.ip)) return send(ws, { type: 'auth', ok: false, error: 'Za dużo prób. Spróbuj za 15 minut.' });
  if (!NICK.test(nick) || pass.length < 6 || pass.length > 200)
    return send(ws, { type: 'auth', ok: false, error: 'Nick 3–20 znaków (a–z, 0–9, _ .), hasło min. 6' });
  const u = q('SELECT pass FROM users WHERE nick=?').get(nick);
  if (isReg) {
    if (u) return send(ws, { type: 'auth', ok: false, error: 'Nick zajęty' });
    q('INSERT INTO users VALUES(?,?,?)').run(nick, hashPass(pass), Date.now());
  } else if (!u || !checkPass(pass, u.pass)) {
    failed(ws.ip);
    return send(ws, { type: 'auth', ok: false, error: 'Zły nick lub hasło' });
  }
  const token = crypto.randomBytes(32).toString('hex');
  q('INSERT INTO sessions VALUES(?,?,?)').run(token, nick, Date.now());
  ws.token = token;
  bind(ws, nick);
  send(ws, { type: 'auth', ok: true, nick, token });
}
function history(ws, chat) {
  if (!isMember(chat, ws.nick)) return;
  const rows = q('SELECT id, sender, iv, ct, ts FROM messages WHERE chat=? ORDER BY id DESC LIMIT 100').all(chat).reverse();
  send(ws, { type: 'history', chat, msgs: rows.map(r => ({ id: r.id, from: r.sender, text: decrypt(r.iv, r.ct), ts: r.ts })) });
}
function sendMsg(ws, chat, text) {
  text = String(text ?? '').slice(0, 4000);
  if (!text.trim() || !isMember(chat, ws.nick)) return;
  const { iv, ct } = encrypt(text);
  const ts = Date.now();
  const id = q('INSERT INTO messages(chat,sender,iv,ct,ts) VALUES(?,?,?,?,?)').run(chat, ws.nick, iv, ct, ts).lastInsertRowid;
  const msg = { id: Number(id), chat, from: ws.nick, text, ts };
  membersOf(chat).forEach(n => sendTo(n, { type: 'msg', msg }));
}

// ---- Serwer plików statycznych (tylko folder public/) ----
const PUBLIC = path.join(__dir, 'public');
const server = http.createServer((req, res) => {
  const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  const file = path.join(PUBLIC, urlPath === '/' ? 'index.html' : path.normalize(urlPath));
  if (!file.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Nie znaleziono'); }
    res.writeHead(200, {
      'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
});

// ---- WebSocket ----
const wss = new WebSocketServer({ server, maxPayload: 64 * 1024 });
wss.on('connection', (ws, req) => {
  ws.ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;
  ws.on('message', raw => {
    let d; try { d = JSON.parse(raw); } catch { return; }
    if (!ws.nick) {
      if (d.type === 'register' || d.type === 'login')
        return login(ws, String(d.nick || '').toLowerCase(), String(d.pass || ''), d.type === 'register');
      if (d.type === 'token') {
        const s = q('SELECT nick FROM sessions WHERE token=? AND created>?').get(String(d.token), Date.now() - SESSION_MS);
        if (s) { ws.token = d.token; bind(ws, s.nick); send(ws, { type: 'auth', ok: true, nick: s.nick, token: d.token }); }
        else send(ws, { type: 'auth', ok: false });
      }
      return;
    }
    switch (d.type) {
      case 'sync': return pushChats(ws.nick);
      case 'history': return history(ws, String(d.chat));
      case 'send': return sendMsg(ws, String(d.chat), d.text);
      case 'logout':
        q('DELETE FROM sessions WHERE token=?').run(ws.token);
        return send(ws, { type: 'loggedout' });
      case 'dm': {
        const o = String(d.nick || '').toLowerCase();
        if (!NICK.test(o) || o === ws.nick || !userExists(o)) return send(ws, { type: 'error', error: 'Nie ma takiego użytkownika' });
        return createChat('dm:' + [ws.nick, o].sort().join('|'), 'dm', null, [ws.nick, o]);
      }
      case 'group': {
        const others = [...new Set((d.members || []).map(n => String(n).toLowerCase()))].filter(n => n !== ws.nick);
        const bad = others.filter(n => !NICK.test(n) || !userExists(n));
        if (bad.length) return send(ws, { type: 'error', error: 'Nieznane nicki: ' + bad.join(', ') });
        return createChat('grp:' + crypto.randomUUID(), 'group', String(d.name || 'Grupa').slice(0, 40), [ws.nick, ...others]);
      }
      case 'signal': {
        // sygnalizacja WebRTC tylko między osobami z czatu prywatnego
        const to = String(d.to || '');
        if (!q('SELECT 1 FROM chats WHERE id=?').get('dm:' + [ws.nick, to].sort().join('|'))) return;
        return sendTo(to, { type: 'signal', from: ws.nick, data: d.data });
      }
    }
  });
  ws.on('close', () => { if (ws.nick) online.get(ws.nick)?.delete(ws); });
});

server.listen(PORT, () => console.log('TopSep działa na porcie', PORT));
