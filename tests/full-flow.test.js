import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';

// Testa exatamente a lógica do Worker sem instalar Wrangler ou usar credenciais Cloudflare.
// Substitui apenas a classe de base da Cloudflare por uma implementação mínima em memória.
const path=new URL('../src/index.js',import.meta.url);
let code=await fs.readFile(path,'utf8');
code=code.replace("import { DurableObject } from 'cloudflare:workers';",'class DurableObject { constructor(ctx, env) { this.ctx=ctx; this.env=env; } }')
  .replace("from './core.js'",`from '${new URL('../src/core.js',import.meta.url).href}'`);
const {RaffleStore} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
function memoryStore(){
  const db=new DatabaseSync(':memory:');
  const sql={
    exec(query,...values){
      if (!values.length && (/CREATE TABLE|CREATE INDEX|INSERT OR IGNORE INTO settings/i.test(query)) && query.includes(';')) {
        db.exec(query);return {toArray:()=>[],rowsWritten:0};
      }
      const stmt=db.prepare(query.trim());
      if (/^\s*SELECT\b/i.test(query)) {
        const rows=stmt.all(...values);
        return {toArray:()=>rows,rowsWritten:0};
      }
      const result=stmt.run(...values);
      return {toArray:()=>[],rowsWritten:result.changes};
    }
  };
  const ctx={storage:{sql,transactionSync(fn){
    db.exec('BEGIN IMMEDIATE');
    try {const result=fn();db.exec('COMMIT');return result;}
    catch(e){db.exec('ROLLBACK');throw e;}
  }}};
  return {ctx,db};
}
const BASE='https://raspadinha-las.example';
function req(method,path,body=null,extra={}){
  return new Request(BASE+path,{
    method,
    headers:{Origin:BASE,...(body?{'Content-Type':'application/json'}:{}),...extra},
    ...(body?{body:JSON.stringify(body)}:{})
  });
}

// Integração do painel completo, do token e da idempotência do sorteio.
test('login, convite, raspagem única, confirmação de entrega e revogação',async()=>{
  const {ctx,db}=memoryStore();
  const store=new RaffleStore(ctx,{ADMIN_PASSWORD:'uma-pass-forte-com-15-caracteres',APP_SECRET:'esta-chave-aleatoria-com-mais-de-32-caracteres'});
  let response=await store.fetch(req('GET','/api/admin/me'));
  assert.deepEqual(await response.json(),{authenticated:false,csrf:null});
  response=await store.fetch(req('POST','/api/admin/login',{password:'incorreto'}));
  assert.equal(response.status,401);
  response=await store.fetch(req('POST','/api/admin/login',{password:'uma-pass-forte-com-15-caracteres'}));
  assert.equal(response.status,200);
  const sess=await response.json();
  const cookie=response.headers.get('set-cookie').split(';')[0];
  const auth={Cookie:cookie,'X-CSRF-Token':sess.csrf};
  const invite={name:'Ana Ferreira',lasCount:10,notes:'Meta LAS',probabilities:[0,0,0,100],expiresAt:null};
  response=await store.fetch(req('POST','/api/admin/invites',invite,auth));
  assert.equal(response.status,201);
  const info=(await response.json()).invite;
  assert.ok(info.link.startsWith(BASE+'/j/'));
  const token=info.link.split('/').at(-1);
  assert.equal(info.prize,null);
  assert.equal((await (await store.fetch(req('GET',`/api/game/${token}`))).json()).status,'available');
  let prize=await (await store.fetch(req('POST',`/api/game/${token}/reveal`))).json();
  assert.equal(prize.prize,50);
  assert.equal(prize.alreadyPlayed,false);
  let prize2=await (await store.fetch(req('POST',`/api/game/${token}/reveal`))).json();
  assert.equal(prize2.prize,50);
  assert.equal(prize2.alreadyPlayed,true);
  response=await store.fetch(req('GET','/api/admin/dashboard',null,auth));
  const dashboard=await response.json();
  assert.equal(dashboard.stats.played,1);
  assert.equal(dashboard.stats.spent,50);
  assert.equal(dashboard.invites[0].link,info.link);
  response=await store.fetch(req('POST',`/api/admin/invites/${info.id}/deliver`,null,auth));
  assert.equal(response.status,200);
  response=await store.fetch(req('POST',`/api/admin/invites/${info.id}/deliver`,null,auth));
  assert.equal(response.status,409);
  response=await store.fetch(req('POST','/api/admin/invites',{...invite,name:'Mário Silva'},auth));
  const second=(await response.json()).invite;
  response=await store.fetch(req('POST',`/api/admin/invites/${second.id}/revoke`,null,auth));
  assert.equal(response.status,200);
  response=await store.fetch(req('POST',`/api/game/${second.link.split('/').at(-1)}/reveal`));
  assert.equal(response.status,410);
  response=await store.fetch(req('GET','/api/admin/export.csv',null,auth));
  assert.ok((await response.text()).includes('Ana Ferreira'));
  db.close();
});
