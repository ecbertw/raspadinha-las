import { DurableObject } from 'cloudflare:workers';
import { DEFAULT_WEIGHTS, validateWeights, drawPrize, expectedCost } from './core.js';

const te = new TextEncoder();
const td = new TextDecoder();
const rawKey = (secret) => crypto.subtle.digest('SHA-256', te.encode(secret))
  .then(raw => crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']));
function b64url(bytes) {
  let str = ''; for (const v of bytes) str += String.fromCharCode(v);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function unb64url(value) {
  let b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  b64 += '='.repeat((4 - b64.length % 4) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}
function token() { const bytes = new Uint8Array(32); crypto.getRandomValues(bytes); return b64url(bytes); }
async function sha(value) { return b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(value)))); }
async function matchPassword(candidate, correct) {
  const a = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(candidate)));
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', te.encode(correct)));
  let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function fail(status, message) { const e = new Error(message); e.status = status; throw e; }
function clean(value, field, max, min = 0) {
  if (typeof value !== 'string') fail(400, `${field}: texto inválido.`);
  const s = value.trim();
  if (s.length < min || s.length > max) fail(400, `${field}: tamanho inválido.`);
  return s;
}
function expiry(date) {
  if (date === null || date === '' || date === undefined) return null;
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) fail(400, 'Data de validade inválida.');
  const noon = Date.parse(`${date}T12:00:00.000Z`);
  if (!Number.isFinite(noon) || new Date(noon).toISOString().slice(0, 10) !== date) fail(400, 'Data de validade inválida.');
  const offsetName = new Intl.DateTimeFormat('en-US', {timeZone:'Europe/Lisbon',timeZoneName:'shortOffset'})
    .formatToParts(new Date(noon)).find(v => v.type === 'timeZoneName')?.value || 'GMT';
  const m = offsetName.match(/^GMT([+-])(\d{1,2})(?::(\d{2}))?$/);
  const offsetMin = m ? (m[1] === '+' ? 1 : -1) * (Number(m[2])*60 + Number(m[3]||0)) : 0;
  const end = Date.parse(`${date}T23:59:59.999Z`) - offsetMin * 60000;
  if (end < Date.now()) fail(400, 'Escolhe uma data a partir de hoje.');
  return end;
}
function input(data, fallbackWeights = null) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail(400, 'Dados inválidos.');
  let weights;
  try { weights = data.probabilities === undefined && fallbackWeights ? fallbackWeights : validateWeights(data.probabilities); }
  catch (e) { fail(400, e.message); }
  const las = data.lasCount ?? 0;
  if (!Number.isInteger(las) || las < 0 || las > 10000000) fail(400, 'Número de registos LAS inválido.');
  return {
    weights, name:clean(data.name,'Nome',90,2), las,
    notes:clean(data.notes ?? '', 'Notas',300), expires:expiry(data.expiresAt)
  };
}
function status(row) {
  if (row.status === 'available' && row.expires_at !== null && row.expires_at < Date.now()) return 'expired';
  return row.status;
}
function csvValue(value) {
  let v = value === null || value === undefined ? '' : String(value);
  if (/^[=+@\-\t\r]/.test(v)) v = "'" + v;
  return '"' + v.replaceAll('"', '""') + '"';
}
function makeResponse(code, body, type = 'application/json; charset=utf-8', extra = {}) {
  const headers = new Headers({
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'DENY',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    ...extra
  });
  return new Response(type.startsWith('application/json') ? JSON.stringify(body) : body, { status:code, headers });
}
const json = (status, data, more) => makeResponse(status, data, undefined, more);
async function bodyJSON(request) {
  const len = Number(request.headers.get('content-length') || 0);
  if (len > 32768) fail(413, 'Pedido demasiado grande.');
  const text = await request.text();
  if (te.encode(text).byteLength > 32768) fail(413, 'Pedido demasiado grande.');
  try { return JSON.parse(text || '{}'); } catch { fail(400, 'JSON inválido.'); }
}
function requireOrigin(req) {
  const origin = req.headers.get('Origin');
  if (origin && origin !== new URL(req.url).origin) fail(403, 'Origem não autorizada.');
}

/** Um único Durable Object SQLite guarda todos os convites de forma transacional. */
export class RaffleStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.keyPromise = null;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK(id=1), weights TEXT NOT NULL);
      INSERT OR IGNORE INTO settings (id, weights) VALUES (1,'[7000,2000,800,200]');
      CREATE TABLE IF NOT EXISTS invites (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        token_hash TEXT UNIQUE NOT NULL,
        token_encrypted TEXT NOT NULL,
        name TEXT NOT NULL,
        las_count INTEGER NOT NULL DEFAULT 0,
        notes TEXT NOT NULL DEFAULT '',
        weights TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','awarded','revoked')),
        prize_eur INTEGER,
        created_at INTEGER NOT NULL,
        expires_at INTEGER,
        revealed_at INTEGER,
        delivered_at INTEGER,
        revoked_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS sessions (
        session_hash TEXT PRIMARY KEY, csrf TEXT NOT NULL, expires_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS login_attempts (
        ip TEXT PRIMARY KEY, attempts INTEGER NOT NULL, since_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS invites_created ON invites(created_at DESC);
    `);
  }
  get key() { return this.keyPromise ||= rawKey(this.env.APP_SECRET); }
  async encrypt(raw) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv}, await this.key, te.encode(raw)));
    return `${b64url(iv)}.${b64url(encrypted)}`;
  }
  async decrypt(stored) {
    const [iv, bytes] = stored.split('.');
    return td.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64url(iv)}, await this.key, unb64url(bytes)));
  }
  getOne(sql, ...args) { return this.sql.exec(sql, ...args).toArray()[0] ?? null; }
  async session(req) {
    const match = (req.headers.get('Cookie') || '').match(/(?:^|;\s*)las_session=([a-zA-Z0-9_-]+)/);
    if (!match) return null;
    return this.getOne('SELECT * FROM sessions WHERE session_hash=? AND expires_at>?', await sha(match[1]), Date.now());
  }
  async admin(req, checkCsrf=false) {
    const session = await this.session(req);
    if (!session) fail(401, 'Sessão expirada. Inicie sessão novamente.');
    if (checkCsrf && req.headers.get('X-CSRF-Token') !== session.csrf) fail(403, 'Pedido não autorizado. Atualize a página.');
    return session;
  }
  async toAdmin(row, origin) {
    const weights = JSON.parse(row.weights);
    return {
      id:row.id, name:row.name, lasCount:row.las_count, notes:row.notes, status:status(row),
      probabilities:weights.map(n=>n/100), expectedCost:expectedCost(weights), prize:row.prize_eur,
      createdAt:row.created_at, expiresAt:row.expires_at, revealedAt:row.revealed_at,
      deliveredAt:row.delivered_at,
      link:row.status !== 'revoked' ? `${origin}/j/${await this.decrypt(row.token_encrypted)}` : null
    };
  }
  async fetch(req) {
    try {
      if (!this.env.ADMIN_PASSWORD || this.env.ADMIN_PASSWORD.length < 12 || !this.env.APP_SECRET || this.env.APP_SECRET.length < 32) {
        return json(503,{error:'Falta configurar ADMIN_PASSWORD (mínimo 12 caracteres) e APP_SECRET (mínimo 32 caracteres) nas definições privadas do Cloudflare.'});
      }
      const url = new URL(req.url);
      const path = url.pathname, method = req.method;
      if (method === 'GET' && path === '/api/admin/me') {
        const sess = await this.session(req);
        return json(200,{authenticated:!!sess, csrf:sess?.csrf || null});
      }
      if (method === 'POST' && path === '/api/admin/login') {
        requireOrigin(req);
        const ip = (req.headers.get('CF-Connecting-IP') || 'unknown').slice(0,64);
        const now = Date.now();
        const attempt = this.getOne('SELECT * FROM login_attempts WHERE ip=?',ip);
        if (attempt && now-attempt.since_ms < 15*60000 && attempt.attempts >= 10) fail(429, 'Demasiadas tentativas. Tenta novamente dentro de 15 minutos.');
        const data = await bodyJSON(req);
        const pass = typeof data.password === 'string' ? data.password : '';
        if (!await matchPassword(pass, this.env.ADMIN_PASSWORD)) {
          if (!attempt || now-attempt.since_ms > 15*60000) this.sql.exec('INSERT OR REPLACE INTO login_attempts (ip,attempts,since_ms) VALUES (?,?,?)',ip,1,now);
          else this.sql.exec('UPDATE login_attempts SET attempts=attempts+1 WHERE ip=?',ip);
          fail(401,'Palavra-passe incorreta.');
        }
        this.sql.exec('DELETE FROM login_attempts WHERE ip=?',ip);
        this.sql.exec('DELETE FROM sessions WHERE expires_at<?',now);
        const sessionToken=token(), csrf=token();
        this.sql.exec('INSERT INTO sessions (session_hash,csrf,expires_at) VALUES (?,?,?)',await sha(sessionToken),csrf,now+12*3600000);
        const secure = url.protocol === 'https:' ? '; Secure' : '';
        return json(200,{authenticated:true,csrf},{'Set-Cookie':`las_session=${sessionToken}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`});
      }
      if (method === 'POST' && path === '/api/admin/logout') {
        requireOrigin(req); await this.admin(req,true);
        const m=(req.headers.get('Cookie') || '').match(/(?:^|;\s*)las_session=([a-zA-Z0-9_-]+)/);
        if (m) this.sql.exec('DELETE FROM sessions WHERE session_hash=?',await sha(m[1]));
        const secure = url.protocol === 'https:' ? '; Secure' : '';
        return json(200,{ok:true},{'Set-Cookie':`las_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`});
      }
      if (method === 'GET' && path === '/api/admin/dashboard') {
        await this.admin(req);
        const rows=this.sql.exec('SELECT * FROM invites ORDER BY created_at DESC, id DESC LIMIT 2000').toArray();
        const invites=await Promise.all(rows.map(r=>this.toAdmin(r,url.origin)));
        const awarded=invites.filter(x=>x.status==='awarded');
        const delivered=awarded.filter(x=>x.deliveredAt);
        const weights=JSON.parse(this.getOne('SELECT weights FROM settings WHERE id=1').weights);
        return json(200,{
          defaults:weights.map(x=>x/100),
          stats:{generated:invites.length, played:awarded.length,
            pending:invites.filter(x=>x.status==='available').length,
            delivered:delivered.length, spent:awarded.reduce((s,x)=>s+x.prize,0),
            pendingValue:awarded.filter(x=>!x.deliveredAt).reduce((s,x)=>s+x.prize,0)},
          invites
        });
      }
      if (method === 'PUT' && path === '/api/admin/defaults') {
        requireOrigin(req); await this.admin(req,true);
        const data=await bodyJSON(req); let weights;
        try { weights=validateWeights(data.probabilities); } catch(e) { fail(400,e.message); }
        this.sql.exec('UPDATE settings SET weights=? WHERE id=1',JSON.stringify(weights));
        return json(200,{ok:true});
      }
      if (method === 'POST' && path === '/api/admin/invites') {
        requireOrigin(req); await this.admin(req,true);
        const data=await bodyJSON(req);
        const defaults=JSON.parse(this.getOne('SELECT weights FROM settings WHERE id=1').weights);
        const a=input(data,defaults), raw=token();
        const hash=await sha(raw), encrypted=await this.encrypt(raw);
        this.sql.exec(`INSERT INTO invites (token_hash,token_encrypted,name,las_count,notes,weights,created_at,expires_at)
          VALUES (?,?,?,?,?,?,?,?)`,hash,encrypted,a.name,a.las,a.notes,JSON.stringify(a.weights),Date.now(),a.expires);
        const row=this.getOne('SELECT * FROM invites WHERE id=last_insert_rowid()');
        return json(201,{invite:await this.toAdmin(row,url.origin)});
      }
      const edit=path.match(/^\/api\/admin\/invites\/(\d+)$/);
      if (method === 'PATCH' && edit) {
        requireOrigin(req); await this.admin(req,true);
        const row=this.getOne('SELECT * FROM invites WHERE id=?',Number(edit[1]));
        if (!row) fail(404,'Convite não encontrado.');
        if (status(row)!=='available') fail(409,'Este convite já não pode ser alterado.');
        const data=await bodyJSON(req), a=input(data,JSON.parse(row.weights));
        this.sql.exec(`UPDATE invites SET name=?, las_count=?, notes=?, weights=?, expires_at=? WHERE id=? AND status='available'`,
          a.name,a.las,a.notes,JSON.stringify(a.weights),a.expires,row.id);
        return json(200,{invite:await this.toAdmin(this.getOne('SELECT * FROM invites WHERE id=?',row.id),url.origin)});
      }
      // A eliminacao aplica-se a todos os estados, incluindo premios revelados e entregues.
      // O token desaparece com o registo e deixa de poder ser utilizado.
      if (method === 'DELETE' && edit) {
        requireOrigin(req); await this.admin(req,true);
        const deleted=this.sql.exec('DELETE FROM invites WHERE id=?',Number(edit[1]));
        if (!deleted.rowsWritten) fail(404,'Raspadinha não encontrada ou já apagada.');
        return json(200,{ok:true});
      }
      const action=path.match(/^\/api\/admin\/invites\/(\d+)\/(revoke|deliver)$/);
      if (method === 'POST' && action) {
        requireOrigin(req); await this.admin(req,true);
        const id=Number(action[1]), what=action[2], now=Date.now();
        const cmd=what==='revoke'
          ? this.sql.exec("UPDATE invites SET status='revoked', revoked_at=? WHERE id=? AND status='available'",now,id)
          : this.sql.exec("UPDATE invites SET delivered_at=? WHERE id=? AND status='awarded' AND delivered_at IS NULL",now,id);
        if (!cmd.rowsWritten) fail(409,what==='revoke'?'Este link já foi utilizado ou revogado.':'Prémio já entregue ou ainda não atribuído.');
        return json(200,{ok:true});
      }
      if (method === 'GET' && path === '/api/admin/export.csv') {
        await this.admin(req);
        const rows=this.sql.exec('SELECT * FROM invites ORDER BY id DESC').toArray();
        const iso=v=>v?new Date(v).toISOString():'';
        const lines=[['ID','Colaborador','Registos LAS','Estado','Prémio (€)','Entregue','Criado em','Revelado em','Validade','Notas','Probabilidades (%)']];
        for (const r of rows) lines.push([r.id,r.name,r.las_count,status(r),r.prize_eur??'',r.delivered_at?'Sim':'Não',iso(r.created_at),iso(r.revealed_at),iso(r.expires_at),r.notes,JSON.parse(r.weights).map(x=>x/100).join(' / ')]);
        return makeResponse(200,'\uFEFF'+lines.map(r=>r.map(csvValue).join(';')).join('\r\n'),'text/csv; charset=utf-8',{'Content-Disposition':'attachment; filename="raspadinhas-las.csv"'});
      }
      const game=path.match(/^\/api\/game\/([a-zA-Z0-9_-]{30,100})(?:\/(reveal))?$/);
      if (game && (method === 'GET'&&!game[2] || method === 'POST'&&game[2]==='reveal')) {
        if (method === 'POST') requireOrigin(req);
        const hash=await sha(game[1]);
        const row=this.getOne('SELECT * FROM invites WHERE token_hash=?',hash);
        if (!row) fail(404,'Esta raspadinha não existe.');
        if (method === 'GET') return json(200,{name:row.name,status:status(row),prize:row.status==='awarded'?row.prize_eur:null,delivered:!!row.delivered_at,expiresAt:row.expires_at});
        // Mesmo com pedidos simultâneos, sorteia e guarda no máximo uma vez.
        const result=this.ctx.storage.transactionSync(()=>{
          const fresh=this.getOne('SELECT * FROM invites WHERE id=?',row.id);
          if (status(fresh)==='expired') fail(410,'Esta raspadinha expirou.');
          if (fresh.status==='revoked') fail(410,'Esta raspadinha foi anulada.');
          if (fresh.status==='awarded') return {name:fresh.name,prize:fresh.prize_eur,alreadyPlayed:true};
          const prize=drawPrize(JSON.parse(fresh.weights));
          this.sql.exec("UPDATE invites SET status='awarded',prize_eur=?,revealed_at=? WHERE id=? AND status='available'",prize,Date.now(),fresh.id);
          return {name:fresh.name,prize,alreadyPlayed:false};
        });
        return json(200,result);
      }
      fail(404,'Página não encontrada.');
    } catch (e) {
      if (!(e.status >= 400 && e.status < 600)) console.error('LAS API error',e);
      return json(e.status >= 400 && e.status < 600 ? e.status : 500,
        {error:e.status >= 400 && e.status < 600 ? e.message : 'Ocorreu um erro no servidor.'});
    }
  }
}

// A parte pública (ficheiros HTML/CSS/JS) é servida separadamente da API protegida.
export default {
  async fetch(request, env) {
    const url = new URL(request.url), path=url.pathname;
    if (request.method === 'GET' && path === '/health') return json(200,{ok:true});
    if (path.startsWith('/api/')) {
      if (!env.RAFFLE) return json(503,{error:'Armazenamento não configurado.'});
      return env.RAFFLE.getByName('las-production-v1').fetch(request);
    }
    const files = {
      '/':'/admin.html', '/admin':'/admin.html',
      '/style.css':'/style.css', '/admin.js':'/admin.js', '/game.js':'/game.js'
    };
    let dest=files[path];
    if (!dest && /^\/j\/[a-zA-Z0-9_-]{30,100}$/.test(path)) dest='/game.html';
    if (request.method !== 'GET' || !dest) return json(404,{error:'Página não encontrada.'});
    const response=await env.ASSETS.fetch(new Request(new URL(dest,request.url)));
    const h=new Headers(response.headers);
    h.set('Cache-Control','no-store');
    h.set('X-Content-Type-Options','nosniff');
    h.set('Referrer-Policy','no-referrer');
    h.set('X-Frame-Options','DENY');
    h.set('Content-Security-Policy',"default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    return new Response(response.body,{status:response.status,headers:h});
  }
};
