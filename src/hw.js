'use strict';
/* ================= HW Config (.cfg) – channels, reserves, checks =================
   HW Config parsing + module catalogue: PCS7-IO-Analyzer (vendor/parser.js, vendor/catalog.js, MIT). */

const HWST = {
  used:     {t:'použito',            cls:'ok',   col:'var(--ok)'},
  conflict: {t:'vícenásobný zápis',  cls:'err',  col:'var(--err)'},
  reserve:  {t:'rezerva',            cls:'res',  col:'var(--accent)'},
  named:    {t:'pojmenováno, v CFC nepoužito', cls:'warn', col:'var(--warn)'},
  dev:      {t:'data zařízení (nepoužito)',     cls:'',     col:'var(--c-ext)'},
  unknown:  {t:'neznámý počet kanálů', cls:'',  col:'var(--c-ext)'},
};
const IOTYPES = ['DI','DO','AI','AO','DEV'];

function normAddr(a){ return String(a||'').toUpperCase().replace(/\s+/g,'').replace(/^P(?=[IQ])/,''); }
function parseIOAddr(a){ const m = normAddr(a).match(/^([IQ])([BWD]?)(\d+)(?:\.(\d))?$/); if (!m) return null; return {dir:m[1], w:m[2]||'X', byte:+m[3], bit:m[4]!=null?+m[4]:null}; }
const RESERVE_RE = /\b(rezerv\w*|reserve|spare|voln[ýéá]|volny|nevyu[zž]ito)\b/i;

function hwWalk(n, fn, ctx={}){
  const c = Object.assign({}, ctx);
  if (n.kind==='project') c.project=n; if (n.kind==='station') c.station=n; if (n.kind==='controller') c.controller=n; if (n.kind==='device') c.device=n;
  fn(n, c);
  (n.children||[]).forEach(x=>hwWalk(x, fn, c));
}

function linkHW(M){
  const roots = M.hw.roots;
  const amap = new Map();
  for (const a of M.addrs.values()){ const k=normAddr(a.addr); let l=amap.get(k); if(!l){ l=[]; amap.set(k,l);} l.push(...a.refs); }
  const get = k => amap.get(k) || [];
  M.hw.ch = []; M.hw.byAddr = new Map(); M.hw.index = new Map(); M.hw.ranges = [];
  for (const r of roots) hwWalk(r, (n, ctx)=>{
    M.hw.index.set(n.id, {n, ctx});
    for (const a of n.inAddrs||[]) if (a[2]) M.hw.ranges.push({dir:'I', s:a[0], e:a[0]+a[2]-1, n});
    for (const a of n.outAddrs||[]) if (a[2]) M.hw.ranges.push({dir:'Q', s:a[0], e:a[0]+a[2]-1, n});
    for (const c of n.channels||[]){
      let refs = get(c.address), via = '';
      const p = parseIOAddr(c.address);
      if (!refs.length && p){
        // indirect: byte / word / dword access covering this channel
        const cand = [];
        if (p.w==='X'){ cand.push(`${p.dir}B${p.byte}`, `${p.dir}W${p.byte}`, `${p.dir}W${p.byte-1}`, `${p.dir}D${p.byte}`, `${p.dir}D${p.byte-1}`, `${p.dir}D${p.byte-2}`, `${p.dir}D${p.byte-3}`); }
        else if (p.w==='W'){ cand.push(`${p.dir}B${p.byte}`, `${p.dir}B${p.byte+1}`, `${p.dir}D${p.byte}`, `${p.dir}D${p.byte-2}`); }
        for (const k of cand){ const r=get(k); if (r.length){ refs = refs.concat(r); via = via || k; } }
      }
      const writers = new Set(refs.filter(r=>r.rw.includes('W')).map(r=>r.block+'.'+r.pin));
      let st;
      if (c.confidence==='unknown') st='unknown';
      else if (writers.size>1 && !via) st='conflict';
      else if (refs.length) st='used';
      else if (c.ioType==='DEV' || n.ioType==='DEV') st='dev';
      else if (!c.hwSymbol || RESERVE_RE.test(c.hwSymbol+' '+c.hwComment)) st='reserve';
      else st='named';
      const e = {c, n, ctx, refs, via, st, type: c.ioType || n.ioType};
      M.hw.ch.push(e); M.hw.byAddr.set(normAddr(c.address), e);
    }
  });
  // CFC I/Q references without a HW channel
  M.hw.orphans = [];
  for (const a of M.addrs.values()){
    const p = parseIOAddr(a.addr); if (!p) continue;
    const k = normAddr(a.addr);
    if (M.hw.byAddr.has(k)) continue;
    const rng = M.hw.ranges.find(r=>r.dir===p.dir && p.byte>=r.s && p.byte<=r.e);
    if (rng && (rng.n.channels||[]).length && p.w!=='X') continue;            // byte/word access to an existing card
    M.hw.orphans.push({a, p, rng: rng ? rng.n : null});
  }
}

function hwStats(list){
  const s = {all:list.length, used:0, conflict:0, reserve:0, named:0, dev:0, unknown:0, byType:{}};
  for (const t of IOTYPES) s.byType[t] = {all:0, used:0, reserve:0, named:0, other:0};
  for (const e of list){ s[e.st]++; const b=s.byType[e.type]||s.byType.DEV; b.all++; if (e.st==='used'||e.st==='conflict') b.used++; else if (e.st==='reserve') b.reserve++; else if (e.st==='named') b.named++; else b.other++; }
  return s;
}
function chUnder(node){ const out=[]; const ids=new Set(); hwWalk(node, n=>ids.add(n)); for (const e of M.hw.ch) if (ids.has(e.n)) out.push(e); return out; }
function hwNodeTitle(n){ const a = n.address!=null ? ` · ${n.bus==='PROFINET'?'PN':'DP'} ${n.address}` : ''; return (n.slot!=null && n.kind!=='device' ? `Slot ${n.slot}${n.subslot!=null?'.'+n.subslot:''} – ` : '') + n.name + (n.kind==='device'?a:''); }
function hwLoc(e, short){ const d=e.ctx.device; const parts=[]; if (!short && e.ctx.station) parts.push(e.ctx.station.name); if (d) parts.push(d.name); parts.push('slot '+(e.n.slot??'?')); return parts.join(' › '); }
function hwLink(id, text){ return `<a class="lnk" data-go="hw" data-id="${esc(id)}">${esc(text)}</a>`; }
function hwRefList(e){
  if (!e.refs.length) return '';
  return (e.via?`<span class="muted">přes ${esc(e.via)}:</span> `:'') + e.refs.slice(0,4).map(r=>{ const b=M.blocks.get(r.block); return `<span class="muted">${esc(b&&b.chart?chartShort(b.chart)+'\\':'')}</span>${bl(r.block)}<span class="mono">.${esc(r.pin)}</span> <span class="pill">${esc(r.rw)}</span>`; }).join('<br>') + (e.refs.length>4?`<br><span class="muted">… +${e.refs.length-4}</span>`:'');
}
function hwStatusPill(st){ const s=HWST[st]; return `<span class="pill ${s.cls}">${s.t}</span>`; }
function channelStrip(list){
  return `<span class="strip">${list.map(e=>`<i style="background:${HWST[e.st].col}" title="${esc(e.c.address+' '+(e.c.hwSymbol||'')+' – '+HWST[e.st].t)}"></i>`).join('')}</span>`;
}

/* ---------- sidebar ---------- */
function sideHW(f){
  if (!M.hw) return needFiles(['hw'],'strom HW');
  let h='';
  const rec = (n, depth) => {
    if (n.kind==='module' || n.kind==='submodule'){
      if (!n.processData) return '';
      const list = M.hw.ch.filter(e=>e.n===n); const s=hwStats(list);
      if (f && !(n.name+' '+n.mlfb+' '+list.map(e=>e.c.address+' '+e.c.hwSymbol).join(' ')).toLowerCase().includes(f)) return '';
      return `<div class="tn" data-tn="hw" data-id="${esc(n.id)}" title="${esc(n.mlfb)}"><span class="tw"></span><span class="pill">${esc(n.ioType)}</span><span>${esc(hwNodeTitle(n))}</span><span class="cnt">${s.reserve?`<b style="color:var(--accent)">${s.reserve}</b>/`:''}${s.all}</span></div>`;
    }
    const kids = (n.children||[]).map(c=>rec(c, depth+1)).join('');
    if (!kids && n.kind!=='project') return '';
    const key='H:'+n.id; const open = SIDE.open.has(key) || !!f || n.kind==='project' || n.kind==='station' || n.kind==='controller';
    const s=hwStats(chUnder(n));
    const ico = n.kind==='device' ? GI.rio : n.kind==='station' ? GI.cpu : n.kind==='project' ? GI.folder : GI.bus;
    return `<div class="tn" data-tn="hw" data-id="${esc(n.id)}"><span class="tw" data-tog="${esc(key)}">${open?'▾':'▸'}</span>${ico}<span>${esc(n.kind==='controller'?n.name.replace(/^CONTROLLER\s*/,''):hwNodeTitle(n))}</span><span class="cnt" title="rezervy / kanálů">${s.reserve?`<b style="color:var(--accent)">${s.reserve}</b>/`:''}${s.all||''}</span></div>${open?`<div class="tc">${kids}</div>`:''}`;
  };
  h += `<div class="tn" data-tn="hw" data-id=""><span class="tw"></span>${GI.folder}<b>Přehled HW a rezerv</b></div>`;
  for (const r of M.hw.roots) h += rec(r, 0);
  return h;
}

/* ---------- main view ---------- */
function viewHW(v){
  if (!M) return;
  if (!M.hw){ v.innerHTML = needFiles(['hw'],'analýzu HW a rezerv') + `<div class="need">HW Config: SIMATIC Manager → HW Config → Station → Export… (.cfg). Pro párování s CFC přidejte ${icon('cr')} Cross-References Chart Element → Address.</div>`; return; }
  const item = NAV.id ? M.hw.index.get(NAV.id) : null;
  if (item && (item.n.kind==='module' || item.n.kind==='submodule') && item.n.processData) return viewHWModule(v, item);
  if (item && item.n.kind!=='project') return viewHWNode(v, item);
  return viewHWOverview(v);
}

function statTiles(s){
  return `<div class="row">
    <div class="stat"><b>${s.all}</b><span>kanálů</span></div>
    <div class="stat ok"><b>${s.used}</b><span>použito v CFC</span></div>
    <div class="stat" style="border-color:var(--accent)"><b>${s.reserve}</b><span>rezerv</span></div>
    <div class="stat warn"><b>${s.named}</b><span>pojmenováno, nepoužito</span></div>
    <div class="stat err"><b>${s.conflict}</b><span>vícenásobný zápis</span></div>
    ${s.dev?`<div class="stat"><b>${s.dev}</b><span>data zařízení</span></div>`:''}</div>`;
}
function typeTable(s){
  return `<table class="t" style="max-width:640px"><tr><th>Typ</th><th>Celkem</th><th>Použito</th><th>Rezerva</th><th>Pojmenováno/nepoužito</th><th>Volné %</th></tr>${IOTYPES.filter(t=>s.byType[t].all).map(t=>{ const b=s.byType[t]; return `<tr><td><b>${t}</b></td><td>${b.all}</td><td>${b.used}</td><td><b style="color:var(--accent)">${b.reserve}</b></td><td>${b.named}</td><td>${t==='DEV'?'':Math.round(100*b.reserve/Math.max(1,b.all))+' %'}</td></tr>`; }).join('')}</table>`;
}

function viewHWOverview(v){
  const mode = NAV.mode || 'sum';
  const s = hwStats(M.hw.ch);
  v.innerHTML = `<div class="fullv"><div class="toolbar"><b>${GI.cpu} HW a rezervy</b> <span class="muted">${esc(M.files.hw.fileName)}</span><span class="flex1"></span>
     <span class="seg" id="hwMode">${[['sum','Přehled'],['res','Hledač rezerv'],['chk','Kontroly']].map(([k,l])=>`<button data-m="${k}" class="${mode===k?'on':''}">${l}</button>`).join('')}</span></div>
     <div class="pad" id="hwBody" style="overflow:auto;flex:1"></div></div>`;
  $('#hwMode').onclick = e => { const m=e.target.dataset.m; if (m) go({view:'hw', mode:m}); };
  const body = $('#hwBody');
  if (!M.files.cr) body.insertAdjacentHTML('beforeend', `<div class="card" style="border-color:var(--warn)">Bez exportu ${icon('cr')} <b>Cross-References Chart Element → Address</b> nejde poznat, co je v CFC použité – všechny kanály se symbolem se tváří jako „pojmenováno, nepoužito“.</div>`);
  if (mode==='res') return hwReserveFinder(body);
  if (mode==='chk') return hwChecks(body);
  // devices table
  const devs=[]; for (const r of M.hw.roots) hwWalk(r, (n,ctx)=>{ if (n.kind==='device' || (n.kind==='station')) { const list=chUnder(n).filter(e=> n.kind==='device' || !e.ctx.device); if (list.length) devs.push({n, ctx, list}); } });
  body.insertAdjacentHTML('beforeend', `<div class="card"><h3>Celkem</h3>${statTiles(s)}<div style="margin-top:12px">${typeTable(s)}</div></div>
    <div class="card"><h3>Stanice / RIO</h3><div class="legend" style="margin-bottom:8px">${Object.entries(HWST).map(([k,x])=>`<span><i style="background:${x.col}"></i>${x.t}</span>`).join('')}</div>
    <table class="t"><tr><th>Stanice</th><th>Adresa</th><th>DI rez./celk.</th><th>DO</th><th>AI</th><th>AO</th><th>Kanály</th></tr>
    ${devs.map(d=>{ const st=hwStats(d.list); const c=t=>{ const b=st.byType[t]; return b.all?`<b style="color:var(--accent)">${b.reserve}</b> / ${b.all}`:'<span class="muted">–</span>'; };
      return `<tr><td>${d.n.kind==='device'?GI.rio:GI.cpu} ${hwLink(d.n.id, d.n.kind==='device'?d.n.name:d.n.name+' (centrální)')}<div class="muted" style="font-size:11px">${esc(d.n.comments?.[0]||'')}</div></td><td class="nw">${d.n.address!=null?(d.n.bus==='PROFINET'?'PN ':'DP ')+d.n.address:''}</td><td class="nw">${c('DI')}</td><td class="nw">${c('DO')}</td><td class="nw">${c('AI')}</td><td class="nw">${c('AO')}</td><td>${channelStrip(d.list)}</td></tr>`; }).join('')}</table></div>`);
}

function hwFilterState(){ return Object.assign({types:['DI','DO','AI','AO'], scope:'', named:false, q:'', need:{DI:0,DO:0,AI:0,AO:0}}, NAV.opt||{}); }
function hwReserveFinder(body){
  const st = hwFilterState();
  const devs=[]; for (const r of M.hw.roots) hwWalk(r, n=>{ if (n.kind==='device'||n.kind==='station') devs.push(n); });
  body.innerHTML += `<div class="card"><div class="row">
      <span class="seg" id="rfTypes">${['DI','DO','AI','AO'].map(t=>`<button data-t="${t}" class="${st.types.includes(t)?'on':''}">${t}</button>`).join('')}</span>
      <select id="rfScope"><option value="">všechny stanice</option>${devs.map(n=>`<option value="${esc(n.id)}" ${st.scope===n.id?'selected':''}>${esc(n.name)}</option>`).join('')}</select>
      <label class="muted"><input type="checkbox" id="rfNamed" ${st.named?'checked':''}> i pojmenované, ale v CFC nepoužité</label>
      <input type="search" id="rfQ" placeholder="filtr: modul, adresa, symbol" value="${esc(st.q)}" style="width:220px">
      <span class="flex1"></span><button id="rfCsv">Export CSV</button></div>
    <div class="row" style="margin-top:10px"><b>Potřebuji:</b>${['DI','DO','AI','AO'].map(t=>`<label>${t} <input type="number" min="0" data-need="${t}" value="${st.need[t]||0}" style="width:60px"></label>`).join('')}
      <button class="primary" id="rfNeed">Navrhnout kanály</button><span class="muted">vybírá z karet s nejvíc rezervami, aby byly nové signály pohromadě</span></div></div>
    <div id="rfOut"></div>`;
  const scopeSet = st.scope ? new Set(chUnder(M.hw.index.get(st.scope).n)) : null;
  const q = st.q.trim().toLowerCase();
  let list = M.hw.ch.filter(e=> (e.st==='reserve' || (st.named && e.st==='named')) && st.types.includes(e.type) && (!scopeSet || scopeSet.has(e)));
  if (q) list = list.filter(e=>matchTokens((e.c.address+' '+e.c.hwSymbol+' '+e.c.hwComment+' '+e.n.name+' '+e.n.mlfb+' '+hwLoc(e)).toLowerCase(), q));
  // proposal
  const want = st.need; let pick = null;
  if (NAV.propose){
    pick = new Set();
    for (const t of ['DI','DO','AI','AO']){
      let rem = +want[t]||0; if (!rem) continue;
      const by = new Map(); for (const e of list.filter(e=>e.type===t)){ (by.get(e.n)||by.set(e.n,[]).get(e.n)).push(e); }
      const groups=[...by.values()].sort((a,b)=>b.length-a.length);
      // prefer a single card that fits all, otherwise largest first
      const fit = groups.filter(g=>g.length>=rem).sort((a,b)=>a.length-b.length)[0];
      for (const g of (fit?[fit]:groups)){ if (rem<=0) break; for (const e of g.slice(0,rem)) pick.add(e); rem -= Math.min(rem,g.length); }
      if (rem>0) toast(`Nedostatek rezerv ${t}: chybí ${rem}`);
    }
    list = list.filter(e=>pick.has(e));
  }
  // group by module
  const byMod = new Map(); for (const e of list){ (byMod.get(e.n)||byMod.set(e.n,[]).get(e.n)).push(e); }
  $('#rfOut').innerHTML = `<div class="muted" style="margin-bottom:6px">${list.length} kanálů na ${byMod.size} kartách${pick?' – <b>návrh</b> <a class="lnk" id="rfClr">zrušit návrh</a>':''}</div>
    <div class="tablewrap"><table class="t"><tr><th>Stanice › slot</th><th>Karta</th><th>Typ</th><th>Adresa</th><th>HW symbol</th><th>Komentář</th><th>Stav</th></tr>
    ${[...byMod.entries()].map(([n,es])=>es.map((e,i)=>`<tr>${i===0?`<td rowspan="${es.length}" class="nw">${esc(hwLoc(e,true))}</td><td rowspan="${es.length}">${hwLink(n.id, n.name)}<div class="muted mono" style="font-size:11px">${esc(n.mlfb)}</div><div class="muted" style="font-size:11px">${es.length} vol. z ${M.hw.ch.filter(x=>x.n===n).length}</div></td>`:''}
      <td>${esc(e.type)}</td><td class="mono nw">${esc(e.c.address)}</td><td>${esc(e.c.hwSymbol)}</td><td class="muted">${esc(e.c.hwComment)}</td><td>${hwStatusPill(e.st)}</td></tr>`).join('')).join('')}</table></div>`;
  const upd = patch => go({view:'hw', mode:'res', opt:Object.assign({}, st, patch)}, false);
  $('#rfTypes').onclick=e=>{ const t=e.target.dataset.t; if(!t) return; const ts=st.types.includes(t)?st.types.filter(x=>x!==t):st.types.concat(t); upd({types:ts}); };
  $('#rfScope').onchange=e=>upd({scope:e.target.value});
  $('#rfNamed').onchange=e=>upd({named:e.target.checked});
  let tm; $('#rfQ').oninput=e=>{ clearTimeout(tm); tm=setTimeout(()=>{ NAV.opt=Object.assign({},st,{q:e.target.value}); NAV.propose=false; viewHW($('#view')); const i=$('#rfQ'); i.focus(); i.setSelectionRange(i.value.length,i.value.length); },250); };
  $('#rfNeed').onclick=()=>{ const need={}; document.querySelectorAll('[data-need]').forEach(i=>need[i.dataset.need]=+i.value||0); go({view:'hw', mode:'res', opt:Object.assign({},st,{need}), propose:true}, false); };
  if ($('#rfClr')) $('#rfClr').onclick=()=>go({view:'hw', mode:'res', opt:st}, false);
  $('#rfCsv').onclick=()=>downloadCSV('rezervy.csv', [['Stanice','Slot','Karta','MLFB','Typ','Adresa','HW symbol','Komentář','Stav'], ...list.map(e=>[e.ctx.device?.name||e.ctx.station?.name||'', e.n.slot??'', e.n.name, e.n.mlfb, e.type, e.c.address, e.c.hwSymbol, e.c.hwComment, HWST[e.st].t])]);
}

function hwChecks(body){
  const conf = M.hw.ch.filter(e=>e.st==='conflict');
  const named = M.hw.ch.filter(e=>e.st==='named');
  const orph = M.hw.orphans;
  const via = M.hw.ch.filter(e=>e.via);
  const sec=(t,d,n,html)=>`<div class="card"><h3>${t} <span class="pill ${n?'warn':'ok'}">${n}</span></h3><div class="muted" style="margin-bottom:8px">${d}</div>${n?html:''}</div>`;
  const tbl=(rows,cols)=>`<div class="tablewrap" style="max-height:420px"><table class="t"><tr>${cols.map(c=>`<th>${c}</th>`).join('')}</tr>${rows}</table></div>`;
  const orRow=o=>`<tr><td class="mono">${esc(o.a.addr)}</td><td>${esc(o.a.sym)}</td><td>${o.a.refs.map(r=>pinRef(r.block,r.pin)+' '+esc(r.rw)+' <span class="muted">'+esc(M.blocks.get(r.block)?.type||'')+'</span>').join('<br>')}</td><td class="muted">${o.rng?'v rozsahu karty '+esc(o.rng.name):'mimo HW'}</td></tr>`;
  const orCh = orph.filter(o=>o.p.w==='X'||o.p.w==='W'), orBy = orph.filter(o=>!(o.p.w==='X'||o.p.w==='W'));
  body.innerHTML += sec('Kanálové adresy použité v CFC, které nejsou v HW', 'Bitové adresy a IW/QW z cross-referencí, pro které v nahraném HW Configu neexistuje kanál (překlep, chybějící karta, nebo HW jiné stanice / nenahraný .cfg).', orCh.length,
      tbl(orCh.slice(0,1000).map(orRow).join(''), ['Adresa','Symbol','Použito v','Poznámka']))
    + (orBy.length ? `<div class="card"><details><summary><b>Bytové / dword adresy mimo HW</b> <span class="pill">${orBy.length}</span> <span class="muted">– typicky diagnostika (MOD_*, QC_CHNG) nebo adresy zařízení; jen pro informaci</span></summary><div style="margin-top:8px">${tbl(orBy.slice(0,1000).map(orRow).join(''), ['Adresa','Symbol','Použito v','Poznámka'])}</div></details></div>` : '')
    + sec('Vícenásobný zápis na výstupní kanál', 'Do jednoho kanálu zapisuje víc bloků/pinů.', conf.length,
      tbl(conf.map(e=>`<tr><td class="mono">${esc(e.c.address)}</td><td>${esc(e.c.hwSymbol)}</td><td>${hwLink(e.n.id, hwLoc(e,true))}</td><td>${hwRefList(e)}</td></tr>`).join(''), ['Adresa','HW symbol','Karta','Zapisují']))
    + sec('Pojmenované kanály, které CFC nepoužívá', 'Kanál má v HW symbol, ale v cross-referencích se nečte ani nezapisuje – připravený signál, zapomenutý driver, nebo nevyužitá rezerva.', named.length,
      tbl(named.slice(0,1500).map(e=>`<tr><td class="mono">${esc(e.c.address)}</td><td>${esc(e.c.hwSymbol)}</td><td class="muted">${esc(e.c.hwComment)}</td><td>${hwLink(e.n.id, hwLoc(e,true))}</td></tr>`).join(''), ['Adresa','HW symbol','Komentář','Karta']))
    + sec('Kanály použité jen přes byte/word', 'CFC nečte bit/kanál přímo, ale celý byte nebo word (např. W_BO). Kanál je brán jako použitý – ověřte.', via.length,
      tbl(via.slice(0,1000).map(e=>`<tr><td class="mono">${esc(e.c.address)}</td><td>${esc(e.c.hwSymbol)}</td><td>${hwRefList(e)}</td></tr>`).join(''), ['Adresa','HW symbol','Použito']));
}

function viewHWNode(v, {n, ctx}){
  const list = chUnder(n); const s = hwStats(list);
  const mods=[]; hwWalk(n, m=>{ if ((m.kind==='module'||m.kind==='submodule') && m.processData) mods.push(m); });
  v.innerHTML = `<div class="pad">${hwCrumb(n, ctx)}
    <div class="card"><h2>${n.kind==='device'?GI.rio:GI.cpu} ${esc(n.kind==='controller'?n.name.replace(/^CONTROLLER\s*/,''):n.name)} ${n.mlfb?`<span class="pill">${esc(n.mlfb)}</span>`:''} ${n.address!=null?`<span class="pill">${n.bus==='PROFINET'?'PN':'DP'} ${n.address}</span>`:''}</h2>
      <div class="muted">${esc((n.comments||[]).join(' · '))}</div><div style="margin-top:10px">${statTiles(s)}</div><div style="margin-top:10px">${typeTable(s)}</div></div>
    <div class="tablewrap"><table class="t"><tr><th>Slot</th><th>Karta</th><th>Typ</th><th>Adresy</th><th>Rezerva</th><th>Kanály</th></tr>
    ${mods.map(m=>{ const l=M.hw.ch.filter(e=>e.n===m); const ms=hwStats(l); const ad=[...(m.inAddrs||[]).map(a=>'I'+a[0]+(a[2]>1?'–'+(a[0]+a[2]-1):'')), ...(m.outAddrs||[]).map(a=>'Q'+a[0]+(a[2]>1?'–'+(a[0]+a[2]-1):''))].join(', ');
      return `<tr><td>${m.slot??''}${m.subslot!=null?'.'+m.subslot:''}</td><td>${hwLink(m.id, m.name)}<div class="muted mono" style="font-size:11px">${esc(m.mlfb)}${m.confidence!=='verified'?` · <span title="${esc(m.basis)}">odvozeno</span>`:''}</div></td><td>${esc(m.ioType)}</td><td class="mono nw">${esc(ad)}</td><td><b style="color:var(--accent)">${ms.reserve}</b> / ${ms.all}</td><td>${channelStrip(l)}</td></tr>`; }).join('')}</table></div></div>`;
}
function hwCrumb(n, ctx){
  const p=[hwLink('', 'HW')]; for (const k of ['station','controller','device']) if (ctx[k] && ctx[k]!==n) p.push(hwLink(ctx[k].id, k==='controller'?ctx[k].name.replace(/^CONTROLLER\s*/,''):ctx[k].name));
  p.push(`<b>${esc(hwNodeTitle(n))}</b>`); return `<div class="crumb">${p.join(' › ')}</div>`;
}
function viewHWModule(v, {n, ctx}){
  const list = M.hw.ch.filter(e=>e.n===n); const s=hwStats(list);
  v.innerHTML = `<div class="pad">${hwCrumb(n, ctx)}
    <div class="card"><div class="row" style="align-items:flex-start"><div class="flex1"><h2><span class="pill">${esc(n.ioType)}</span> ${esc(n.name)}</h2>
      <div class="kv" style="margin-top:6px"><b>MLFB</b><span class="mono">${esc(n.mlfb||'?')}</span><b>Rozpoznání</b><span>${esc(n.basis)}${n.family?' · '+esc(n.family):''}${n.devType?' · '+esc(n.devType):''}</span>
      <b>Umístění</b><span>${esc(hwLoc({ctx,n}))}</span>${(n.comments||[]).length?`<b>Komentář</b><span>${esc(n.comments.join(' · '))}</span>`:''}</div></div>
      <div>${statTiles(s)}</div></div></div>
    <div class="tablewrap"><table class="t"><tr><th>#</th><th>Adresa</th><th>HW symbol</th><th>HW komentář</th><th>Stav</th><th>Použito v CFC</th><th>Typ bloku</th></tr>
    ${list.map(e=>`<tr><td class="muted">${e.c.index}</td><td class="mono nw"><a class="lnk" data-go="addr" data-id="${esc(e.c.address)}">${esc(e.c.address)}</a></td><td>${esc(e.c.hwSymbol)}</td><td class="muted">${esc(e.c.hwComment)}</td><td>${hwStatusPill(e.st)}</td><td>${hwRefList(e)}</td><td>${[...new Set(e.refs.map(r=>M.blocks.get(r.block)?.type||''))].map(esc).join(', ')}</td></tr>`).join('')}</table></div></div>`;
}

function downloadCSV(name, rows){
  const txt = '\uFEFF' + rows.map(r=>r.map(x=>{ x=String(x??''); return /[;"\n]/.test(x) ? '"'+x.replace(/"/g,'""')+'"' : x; }).join(';')).join('\r\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([txt],{type:'text/csv;charset=utf-8'})); a.download=name; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
function hwForAddr(addr){ if (!M.hw) return null; return M.hw.byAddr.get(normAddr(addr)) || null; }
function hwAddrCell(addr){ const e=hwForAddr(addr); if (!e) return M.hw ? '<span class="muted">není v HW</span>' : ''; return `${hwLink(e.n.id, hwLoc(e,true))} <span class="muted">${esc(e.c.hwSymbol)}</span>`; }
