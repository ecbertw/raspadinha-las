'use strict';
let csrf = null;
let dashboard = null;
let editingId = null;
const $ = id => document.getElementById(id);
const euro = n => new Intl.NumberFormat('pt-PT',{style:'currency',currency:'EUR',maximumFractionDigits:2}).format(n);
const date = n => n ? new Date(n).toLocaleDateString('pt-PT') : 'Sem prazo';
const pct = n => Number(n.toFixed(2)).toLocaleString('pt-PT',{maximumFractionDigits:2});
const weightsFor = selector => [...document.querySelectorAll(selector)].map(el=>el.value.trim()===''?NaN:Number(el.value));
const sum = a => a.reduce((p,c)=>p+c,0);
function toast(message) {const node=$('toast');node.textContent=message;node.classList.add('show');clearTimeout(toast.timer);toast.timer=setTimeout(()=>node.classList.remove('show'),3400);}
function feedback(id,message,ok=false) {const el=$(id);el.textContent=message;el.classList.toggle('success',ok);}
async function request(url,{method='GET',body}={}) {
  const options={method,credentials:'same-origin',headers:{}};
  if(body!==undefined){options.headers['Content-Type']='application/json';options.body=JSON.stringify(body);}
  if(method!=='GET' && csrf)options.headers['X-CSRF-Token']=csrf;
  let res;
  try {res=await fetch(url,options);} catch {throw new Error('Não foi possível ligar ao servidor.');}
  const data=await res.json().catch(()=>({}));
  if(!res.ok){if(res.status===401 && url!=='/api/admin/login') showLogin(); throw new Error(data.error || 'Ocorreu um erro.');}
  return data;
}
function showLogin() {$('login-view').classList.remove('hidden');$('dashboard-view').classList.add('hidden');$('logout').classList.add('hidden');$('admin-user').textContent='ÁREA PRIVADA';}
function showDashboard() {$('login-view').classList.add('hidden');$('dashboard-view').classList.remove('hidden');$('logout').classList.remove('hidden');$('admin-user').textContent='ADMINISTRADOR';}
function setOdds(selector,values) {document.querySelectorAll(selector).forEach((e,i)=>{e.value=values[i]});}
function showOddsSummary(type) {
  const values=weightsFor(type==='invite'?'[data-odds]':'[data-default]');
  const total=sum(values);
  const valid=values.every(v=>Number.isFinite(v) && v>=0 && v<=100) && Math.abs(total-100)<1e-7;
  if(type==='invite') {
    $('invite-total').textContent=Number.isFinite(total)?`${pct(total)}%`:'—';
    $('invite-total').classList.toggle('invalid',!valid);
    $('expected-cost').textContent=valid?`Valor médio esperado por convite: ${euro(values.reduce((acc,v,i)=>acc+v*[5,10,20,50][i],0)/100)}`:'As quatro probabilidades devem somar 100%.';
  } else {$('defaults-total').textContent=Number.isFinite(total)?`Total: ${pct(total)}%`:'Total: —';$('defaults-total').classList.toggle('invalid',!valid);}
}
function safeNode(tag, cls, text) { const n=document.createElement(tag);if(cls)n.className=cls;if(text!==undefined)n.textContent=text;return n; }
function makeButton(text,cls,onClick) {const b=safeNode('button','btn '+cls,text);b.type='button';b.addEventListener('click',onClick);return b;}
async function copyText(value) {
  try {await navigator.clipboard.writeText(value);toast('Link copiado! Pronto a enviar.');}
  catch {
    const input=document.createElement('textarea');input.value=value;document.body.appendChild(input);input.select();const ok=document.execCommand('copy');input.remove(); if(ok) toast('Link copiado!'); else window.prompt('Copia o link:',value);
  }
}
function renderInvites() {
  const place=$('invites');place.replaceChildren();
  const word=$('search').value.trim().toLocaleLowerCase('pt-PT');
  const filter=$('filter').value;
  const rows=dashboard.invites.filter(r=>(filter==='all'||r.status===filter) && (!word||r.name.toLocaleLowerCase('pt-PT').includes(word)));
  $('count-invites').textContent=String(rows.length);
  if(!rows.length) {place.appendChild(safeNode('div','empty','Sem convites para apresentar.'));return;}
  for(const r of rows) {
    const item=safeNode('article','invite-row');
    const head=safeNode('div','invite-row-head');const name=safeNode('div','invite-name',r.name);
    const statusNames={available:'Disponível',awarded:'Premiado',expired:'Expirado',revoked:'Anulado'};
    const pill=safeNode('span','status '+r.status,statusNames[r.status]);
    head.append(name,pill);item.append(head);
    const info=safeNode('div','invite-meta',`LAS: ${r.lasCount}  ·  Criado: ${date(r.createdAt)}  ·  Validade: ${date(r.expiresAt)}`);item.append(info);
    if(r.notes)item.append(safeNode('div','invite-note',r.notes));
    item.append(safeNode('div','invite-chances',`Probabilidades (5 / 10 / 20 / 50 €): ${r.probabilities.map(x=>pct(x)+'%').join(' · ')}`));
    if(r.status==='awarded') {
      const prize=safeNode('div','won-label',`★ Cartão Dá ${r.prize} €`);
      prize.append(safeNode('span',r.deliveredAt?'delivered':'undelivered',r.deliveredAt?'  ·  Entregue':'  ·  Por entregar'));
      item.append(prize);
    }
    const actions=safeNode('div','invite-actions');
    if(r.status==='available') {
      actions.append(makeButton('Copiar link','btn-copy',()=>copyText(r.link)));
      actions.append(makeButton('Editar','btn-small',()=>editInvite(r)));
      actions.append(makeButton('Anular','btn-small muted-button',async()=>{
        if(!confirm(`Anular o convite de ${r.name}? O link deixará de funcionar.`))return;
        try{await request(`/api/admin/invites/${r.id}/revoke`,{method:'POST'});toast('Convite anulado.');await refresh();}catch(e){toast(e.message);}
      }));
    }
    if(r.status==='awarded'&&r.link)actions.append(makeButton('Copiar comprovativo','btn-small',()=>copyText(r.link)));
    if(r.status==='awarded'&&!r.deliveredAt)actions.append(makeButton('Marcar como entregue','btn-copy',async()=>{
      if(!confirm(`Confirmas a entrega do Cartão Dá de ${r.prize} € a ${r.name}?`))return;
      try {await request(`/api/admin/invites/${r.id}/deliver`,{method:'POST'});toast('Entrega registada.');await refresh();}catch(e){toast(e.message);}
    }));
    if(actions.childElementCount)item.append(actions);
    place.append(item);
  }
}
function resetInvite() {
  editingId=null; $('form-title').textContent='Criar raspadinha';$('submit-invite').innerHTML='Gerar link único <span>↗</span>';
  $('cancel-edit').classList.add('hidden');$('invite-form').reset();$('las-count').value='0';setOdds('[data-odds]',dashboard?.defaults||[70,20,8,2]);
  feedback('invite-feedback','');showOddsSummary('invite');
}
function editInvite(r) {
  editingId=r.id;$('form-title').textContent='Editar convite';$('submit-invite').innerHTML='Guardar alterações <span>✓</span>';
  $('cancel-edit').classList.remove('hidden');$('staff-name').value=r.name;$('las-count').value=r.lasCount;
  $('notes').value=r.notes;$('expiry').value=r.expiresAt?new Date(r.expiresAt).toISOString().slice(0,10):'';
  setOdds('[data-odds]',r.probabilities);showOddsSummary('invite');feedback('invite-feedback','');
  $('new-invite-panel').scrollIntoView({behavior:'smooth',block:'start'});
}
async function refresh() {
  dashboard=await request('/api/admin/dashboard');
  showDashboard();
  $('stat-generated').textContent=dashboard.stats.generated;
  $('stat-played').textContent=dashboard.stats.played;
  $('stat-spent').textContent=euro(dashboard.stats.spent);
  $('stat-pending-value').textContent=euro(dashboard.stats.pendingValue);
  setOdds('[data-default]',dashboard.defaults);showOddsSummary('defaults');
  if(!editingId)resetInvite();
  renderInvites();
}
$('login-form').addEventListener('submit',async e=>{
  e.preventDefault();feedback('login-feedback','');
  try {const data=await request('/api/admin/login',{method:'POST',body:{password:$('password').value}});csrf=data.csrf;$('password').value='';await refresh();}
  catch(e){feedback('login-feedback',e.message);}
});
$('logout').addEventListener('click',async()=>{try{await request('/api/admin/logout',{method:'POST'});}catch{}csrf=null;showLogin();});
$('invite-form').addEventListener('submit',async e=>{
  e.preventDefault();feedback('invite-feedback','');
  const probabilities=weightsFor('[data-odds]');
  const data={name:$('staff-name').value,lasCount:Number($('las-count').value),notes:$('notes').value,expiresAt:$('expiry').value||null,probabilities};
  try {
    if(editingId){await request(`/api/admin/invites/${editingId}`,{method:'PATCH',body:data});toast('Convite atualizado.');resetInvite();await refresh();}
    else {const res=await request('/api/admin/invites',{method:'POST',body:data});await refresh();await copyText(res.invite.link);feedback('invite-feedback','Raspadinha criada! Link copiado para partilhares.',true);}
  }catch(err){feedback('invite-feedback',err.message);}
});
$('defaults-form').addEventListener('submit',async e=>{
  e.preventDefault();feedback('defaults-feedback','');
  try{await request('/api/admin/defaults',{method:'PUT',body:{probabilities:weightsFor('[data-default]')}});await refresh();feedback('defaults-feedback','Probabilidades predefinidas guardadas.',true);}
  catch(err){feedback('defaults-feedback',err.message);}
});
$('cancel-edit').addEventListener('click',resetInvite);
$('filter').addEventListener('change',()=>dashboard&&renderInvites());
$('search').addEventListener('input',()=>dashboard&&renderInvites());
document.querySelectorAll('[data-odds]').forEach(n=>n.addEventListener('input',()=>showOddsSummary('invite')));
document.querySelectorAll('[data-default]').forEach(n=>n.addEventListener('input',()=>showOddsSummary('default')));
(async()=>{try{const sess=await request('/api/admin/me');if(sess.authenticated){csrf=sess.csrf;await refresh();}else showLogin();}catch(e){showLogin();feedback('login-feedback',e.message);}})();
