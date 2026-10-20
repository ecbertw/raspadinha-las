'use strict';
const $ = id => document.getElementById(id);
const canvas=$('scratch'), ctx=canvas.getContext('2d',{willReadFrequently:true});
const area=$('scratch-area');
const token=location.pathname.split('/').pop();
let active=false, revealed=false, busy=false, strokeCount=0, lastPercent=0;
function message(value) {$('game-feedback').textContent=value;}
async function api(path,method='GET') {
  let response;
  try {response=await fetch(path,{method,credentials:'omit'});}
  catch {throw new Error('Não foi possível ligar ao servidor. Verifica a tua ligação à Internet.');}
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw new Error(data.error||'Ocorreu um erro.');
  return data;
}
function showUnavailable(msg) {
  canvas.classList.add('hidden');$('scratch-note').classList.add('hidden');
  $('prize-header').textContent='CONVITE INDISPONÍVEL';$('prize-value').textContent='—';
  $('prize-footer').textContent='Contacta a organização';$('progress-text').textContent='Não é possível participar';message(msg);
}
function drawCover() {
  const w=canvas.width,h=canvas.height;
  ctx.globalCompositeOperation='source-over';
  const gradient=ctx.createLinearGradient(0,0,w,h);gradient.addColorStop(0,'#dee0e6');gradient.addColorStop(.48,'#a9adbc');gradient.addColorStop(1,'#e4e5e9');
  ctx.fillStyle=gradient;ctx.fillRect(0,0,w,h);
  ctx.strokeStyle='rgba(255,255,255,.14)';ctx.lineWidth=1;
  for(let x=-h;x<w+h;x+=14) {ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x+h,h);ctx.stroke();}
  ctx.fillStyle='rgba(55,60,90,.10)';
  for(let y=16;y<h;y+=26){for(let x=20;x<w;x+=30){ctx.beginPath();ctx.arc(x+(y%30),y,1.1,0,Math.PI*2);ctx.fill();}}
  ctx.fillStyle='#484e63';ctx.font='900 30px system-ui, sans-serif';ctx.textAlign='center';ctx.fillText('✳  RASPA AQUI  ✳',w/2,h/2+11);
}
function point(e) {const r=canvas.getBoundingClientRect();return {x:(e.clientX-r.left)*canvas.width/r.width,y:(e.clientY-r.top)*canvas.height/r.height};}
function erase(e) {
  if(!active || revealed || busy) return;
  e.preventDefault();const p=point(e);ctx.globalCompositeOperation='destination-out';ctx.lineCap='round';ctx.lineJoin='round';ctx.lineWidth=64;
  if(erase.last){ctx.beginPath();ctx.moveTo(erase.last.x,erase.last.y);ctx.lineTo(p.x,p.y);ctx.stroke();}else {ctx.beginPath();ctx.arc(p.x,p.y,32,0,2*Math.PI);ctx.fill();}
  erase.last=p;
  strokeCount++;
  if(strokeCount%3===0){
    const data=ctx.getImageData(0,0,canvas.width,canvas.height).data;let clear=0;let all=0;
    for(let i=3;i<data.length;i+=28){all++;if(data[i]<90)clear++;}
    lastPercent=Math.round(clear/all*100);
    $('progress-bar').style.width=`${lastPercent}%`;
    $('progress-text').textContent=`${Math.min(lastPercent,100)}% raspado`;
    if(lastPercent>=42)finish();
  }
}
async function finish() {
  if(busy||revealed)return;
  busy=true;message('A descobrir o teu prémio...');
  try {const result=await api(`/api/game/${token}/reveal`,'POST');win(result.prize);}
  catch(e){busy=false;message(e.message+' Continua a raspar para tentar novamente.');}
}
function win(prize) {
  revealed=true;busy=false;canvas.classList.add('hidden');$('scratch-note').classList.add('hidden');
  $('prize-header').textContent='PARABÉNS! GANHASTE';$('prize-value').textContent=`${prize} €`;
  $('prize-footer').textContent='CARTÃO DÁ';
  $('progress-bar').style.width='100%';$('progress-text').textContent='Raspadinha concluída';
  area.classList.add('won');message(`🎉 Parabéns! O teu prémio é um Cartão Dá de ${prize} €. Contacta a organização para a entrega.`);
  for(let i=0;i<18;i++){const x=document.createElement('i');x.className='confetti';area.appendChild(x);}
}
canvas.addEventListener('pointerdown',e=>{if(!active||busy||revealed)return;canvas.setPointerCapture(e.pointerId);erase.last=null;erase(e);});
canvas.addEventListener('pointermove',e=>{if(e.buttons!==1||!canvas.hasPointerCapture(e.pointerId))return;erase(e);});
canvas.addEventListener('pointerup',()=>{erase.last=null;});
canvas.addEventListener('pointercancel',()=>{erase.last=null;});
(async()=>{
  if(!/^[a-zA-Z0-9_-]{30,100}$/.test(token)){showUnavailable('Link inválido.');return;}
  try {
    const data=await api(`/api/game/${token}`);
    $('greeting').textContent=data.name?`${data.name}, esta é para ti!`:'Esta é para ti!';
    if(data.status==='awarded'){win(data.prize);message(`Esta raspadinha já foi utilizada. Prémio atribuído: Cartão Dá ${data.prize} €${data.delivered?' (entregue)':''}.`);return;}
    if(data.status==='revoked'){showUnavailable('Esta raspadinha foi anulada pela organização.');return;}
    if(data.status==='expired'){showUnavailable('O prazo de utilização desta raspadinha terminou.');return;}
    active=true;drawCover();
    $('scratch-note').classList.add('hidden');
  }catch(e){showUnavailable(e.message);}
})();
