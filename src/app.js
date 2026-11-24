'use strict';
/* ================= UI ================= */
let M = null;               // model
const TEXTS = {};           // kind -> {text, fileName}
const $ = s => document.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clip = (s,n) => { s=String(s||''); return s.length>n ? s.slice(0,Math.max(1,n-1))+'…' : s; };
const icon = (k, big) => `<img class="ico${big?' big':''}" src="${ICONS[k]}" alt="">`;

/* ---------- helpers on model ---------- */
const chartOf = b => b.chart ? M.charts.get(b.chart) : null;
function chartShort(path){ const {chain} = splitChartPath(path||''); return chain.join('\\'); }
function folderOf(path){ return splitChartPath(path||'').folder; }
function blockTitle(b){ return b.name || chartShort(b.id); }
function blockFull(b){ return b.chart ? chartShort(b.chart)+'\\'+b.name : chartShort(b.id); }
function catOf(b){
  if (!b) return 'ext';
  if (b.kind==='sfc') return 'sfc';
  if (b.kind==='sfci') return 'sfci';
  if (b.kind==='chart') return 'chart';
  const t=b.type||'';
  if (/^(Pcs7|FbAn|FbDi|FbDo|FbAo|MOD_|CH_|PA_|OB_|SUBNET|RACK|PO_UPD|DREP|PADP|DPAY|IM_|PS_|CPU_|PROFI|PN_|PNIO|W_BO|BO_W|DW_BO|BO_DW|W_DW)/i.test(t)) return 'drv';
  if (/^(AND|OR|XOR|NOT|NAND|NOR|And\d|Or\d|R_TRIG|F_TRIG|RS|SR|SEL_|SEL|CMP_|ADD|SUB|MUL|DIV|ABS|MOVE|Add\d|Sub\d*|Mul\d*|Div\d*|MAX|MIN|LIM|ABS_|NEG|SQRT|EXP|LN|SIN|COS|TAN|B_|I_|R_|DI_|DW_|Event|Timer|TON|TOF|TP|CTU|CTD|Counter|Max|Min|Lim|Ge|Gt|Le|Lt|Eq|Ne|Swi|SWI)/.test(t)) return 'logic';
  return 'tech';
}
const CATNAME = {tech:'technologické bloky', drv:'drivery / diagnostika', logic:'logika / matematika', sfc:'SFC chart', sfci:'SFC instance', chart:'vnořené CFC', addr:'adresa I/Q/M/DB', ext:'blok v jiném CFC'};
function runInfo(b){
  if (!b.run.length) return '';
  const cyc = b.run.filter(r=>!/OB10[0-2]$/.test(r.ob));
  const pick = cyc.length ? cyc : b.run;
  return pick.map(r=>`${r.ob} <span class="muted">${esc(r.obName.replace(/^.*?\(/,'(').replace(/^[^(]*$/,''))}</span>${r.group?` · ${esc(r.group)}`:''} · #${r.n}`).join('<br>');
}
function runOrder(b){ const r=b.run.find(r=>!/OB10[0-2]$/.test(r.ob)) || b.run[0]; return r ? r.pos : 1e9; }
function pinUsed(p){ return p.edges.length || p.addrs.length || p.sfc.length; }

/* ---------- links ---------- */
function bl(id, text, cls){ const b=M.blocks.get(id); const t = text || (b ? blockTitle(b) : id); return `<a class="lnk ${cls||''}" data-go="block" data-id="${esc(id)}" title="${esc(id)}">${esc(t)}</a>`; }
function cl(path, text){ return `<a class="lnk" data-go="chart" data-id="${esc(path)}" title="${esc(path)}">${esc(text||chartShort(path))}</a>`; }
function al(addr){ return `<a class="lnk mono" data-go="addr" data-id="${esc(addr)}">${esc(addr)}</a>`; }
function pinRef(blockId, pin, ownChart){
  const b = M.blocks.get(blockId); if (!b) return esc(blockId+'.'+pin);
  const chartTxt = (b.chart && b.chart!==ownChart) ? `<span class="muted">${esc(chartShort(b.chart))}\\</span>` : '';
  return `${chartTxt}${bl(blockId)}<span class="mono">.${esc(pin)}</span>`;
}

/* ---------- navigation ---------- */
let NAV = {view:'files'};
const HIST=[]; let HPOS=-1;
function go(state, push=true){
  NAV = Object.assign({}, state);
  if (push){ HIST.splice(HPOS+1); HIST.push(NAV); HPOS=HIST.length-1; }
  $('#back').disabled = HPOS<=0; $('#fwd').disabled = HPOS>=HIST.length-1;
  renderView();
}
function goBack(){ if (HPOS>0){ HPOS--; go(HIST[HPOS], false); } }
function goFwd(){ if (HPOS<HIST.length-1){ HPOS++; go(HIST[HPOS], false); } }

const TABS = [
  ['files','Soubory'],
  ['block','Blok'],
  ['chart','CFC / hierarchie'],
  ['neigh','Okolí (graf)'],
  ['sfc','SFC kontrola'],
  ['addr','Adresy'],
  ['hw','HW / rezervy'],
  ['run','Run sequence'],
  ['search','Hledání'],
];
function renderTabs(){
  $('#mtabs').innerHTML = TABS.map(([k,l])=>`<button data-tab="${k}" class="${NAV.view===k?'on':''}">${l}</button>`).join('');
}
const LAST = {};
function renderView(){
  renderTabs();
  const v = $('#view'); v.scrollTop = 0;
  if (!M && NAV.view!=='files'){ NAV.view='files'; renderTabs(); }
  LAST[NAV.view] = NAV;
  ({files:viewFiles, block:viewBlock, chart:viewChart, neigh:viewNeigh, sfc:viewSFC, addr:viewAddr, run:viewRun, search:viewSearch, hw:viewHW})[NAV.view](v);
  markSideSel();
}
function needFiles(kinds, what){
  const miss = kinds.filter(k=>!M || !M.files[k]);
  if (!miss.length) return '';
  return `<div class="need">Pro ${what} nahrajte export:<br><br>${miss.map(k=>`<div>${icon(k)} <b>${esc(FILE_KINDS[k].pcs7)}</b></div>`).join('')}</div>`;
}

/* ================= Files view ================= */
function viewFiles(v){
  const cards = Object.entries(FILE_KINDS).map(([k,f])=>{
    const ld = M && M.files[k];
    return `<div class="fcard ${ld?'on':''}">${icon(k,true)}<div><h4>${esc(f.pcs7)}</h4><p>${esc(f.gives)}</p>
      <div class="st">${ld ? `<span class="pill ok">načteno</span> <span class="muted">${esc(ld.fileName)} · ${ld.rows.toLocaleString('cs')} ${ld.unit||'řádků'}</span>` : '<span class="pill">nenačteno</span>'}</div></div></div>`;
  }).join('');
  const stats = M ? `<div class="card"><div class="row">
      <div class="stat"><b>${M.charts.size.toLocaleString('cs')}</b><span>CFC/SFC chartů</span></div>
      <div class="stat"><b>${M.blocks.size.toLocaleString('cs')}</b><span>bloků</span></div>
      <div class="stat"><b>${M.edges.length.toLocaleString('cs')}</b><span>propojení</span></div>
      <div class="stat"><b>${M.addrs.size.toLocaleString('cs')}</b><span>adres</span></div>
      <div class="stat"><b>${M.sfcTypes.size + M.sfcCharts.size}</b><span>SFC typů / chartů</span></div>
      <div class="flex1"></div><button id="clearAll">Vymazat data</button></div></div>` : '';
  v.innerHTML = `<div class="pad">
    <div id="drop">${Object.keys(FILE_KINDS).map(k=>icon(k,true)).join(' ')}<br><br>
      <b>Přetáhněte sem CSV exporty z PCS7</b> (Options → Chart Reference Data → File → Export…) a případně HW Config <span class="mono">.cfg</span> nebo
      <button class="primary" id="pick">Vybrat soubory…</button>
      <div class="muted" style="margin-top:8px">Typ exportu se pozná automaticky podle hlavičky – na názvu souboru nezáleží. Stačí jen některé – podle toho se zpřístupní funkce. Data zůstávají jen v prohlížeči.</div>
    </div>
    ${stats}
    <div class="fgrid">${cards}</div>
    <div class="card" style="margin-top:14px"><h3>Co která funkce potřebuje</h3>
      <table class="t"><tr><th>Funkce</th><th>Potřebné exporty</th><th>Volitelně obohatí</th></tr>
      <tr><td>Strom hierarchie, hledání bloků/typů</td><td>${icon('bt')} nebo ${icon('ic')}</td><td>${icon('rs')} komentáře, OB</td></tr>
      <tr><td>Graf CFC, okolí bloku, propojení</td><td>${icon('ic')}</td><td>${icon('bt')} nenapojené bloky, ${icon('cr')} adresy, ${icon('sx')} SFC</td></tr>
      <tr><td>SFC kontrola napojení (typy)</td><td>${icon('ac')} (nebo ${icon('sx')}) + ${icon('ic')}</td><td>${icon('cr')} ${icon('bt')}</td></tr>
      <tr><td>SFC kontrola (SFC charty)</td><td>${icon('sx')} + ${icon('ic')}</td><td>${icon('cr')}</td></tr>
      <tr><td>Adresy, vícenásobný zápis</td><td>${icon('cr')}</td><td></td></tr>
      <tr><td>Pořadí běhu, OB</td><td>${icon('rs')}</td><td></td></tr>
      <tr><td>HW: karty, kanály, hledač rezerv, kontroly HW ↔ CFC</td><td>${icon('hw')} + ${icon('cr')}</td><td>${icon('ic')} ${icon('bt')} (proklik do grafů)</td></tr></table></div>
  </div>`;
  $('#pick').onclick = ()=>$('#fileInput').click();
  const d=$('#drop');
  d.ondragover=e=>{e.preventDefault(); d.classList.add('over');};
  d.ondragleave=()=>d.classList.remove('over');
  if ($('#clearAll')) $('#clearAll').onclick=()=>{ for(const k in TEXTS) delete TEXTS[k]; M=null; renderChips(); renderSide(); go({view:'files'}); };
}

async function loadFiles(list){
  const unknown=[];
  for (const f of list){
    const buf = await f.arrayBuffer();
    const text = decodeBuffer(buf);
    const k = detectKind(text);
    if (!k){ unknown.push(f.name); continue; }
    if (k==='hw') TEXTS.hw = (TEXTS.hw||[]).filter(x=>x.fileName!==f.name).concat({text, fileName:f.name});
    else TEXTS[k] = {text, fileName:f.name};
  }
  if (unknown.length) toast('Nerozpoznaný formát: '+unknown.join(', '));
  if (!Object.keys(TEXTS).length) return;
  toast('Zpracovávám…');
  await new Promise(r=>setTimeout(r,20));
  const t0=performance.now();
  M = buildModel(TEXTS);
  toast(`Načteno za ${Math.round(performance.now()-t0)} ms`);
  renderChips(); renderSide();
  if (NAV.view==='files') renderView(); else renderView();
}

function renderChips(){
  $('#fileChips').innerHTML = Object.entries(FILE_KINDS).map(([k,f])=>`<span class="chip ${M&&M.files[k]?'':'off'}" title="${esc(f.pcs7)}${M&&M.files[k]?' – '+esc(M.files[k].fileName):' – nenačteno'}" data-tab="files">${icon(k)}</span>`).join('');
}
let toastT=null;
function toast(msg){ const t=$('#toast'); t.textContent=msg; t.style.display='block'; clearTimeout(toastT); toastT=setTimeout(()=>t.style.display='none',2600); }

/* ================= Sidebar ================= */
let SIDE = {tab:'hier', filter:'', open:new Set([''])};
function renderSide(){
  $('#stabs').innerHTML = [['hier','Hierarchie'],['types','Typy'],['sfc','SFC'],['ob','OB'],['hw','HW']].map(([k,l])=>`<button data-stab="${k}" class="${SIDE.tab===k?'on':''}">${l}</button>`).join('');
  const s = $('#side');
  if (!M){ s.innerHTML = '<div class="empty">Nejdřív nahrajte exporty.</div>'; return; }
  const f = SIDE.filter.trim().toLowerCase();
  if (SIDE.tab==='hier') s.innerHTML = f ? sideFilterHier(f) : sideFolder(M.folderRoot, 0);
  else if (SIDE.tab==='types') s.innerHTML = sideTypes(f);
  else if (SIDE.tab==='sfc') s.innerHTML = sideSFC(f);
  else if (SIDE.tab==='hw') s.innerHTML = sideHW(f);
  else s.innerHTML = sideOB(f);
  markSideSel();
}
const GI = {
  folder:'<svg class="gico" viewBox="0 0 16 16"><path d="M1 4h5l1.5 1.5H15V13H1z" fill="#e8c35a" stroke="#a07c20"/></svg>',
  cfc:'<svg class="gico" viewBox="0 0 16 16"><rect x="2" y="1.5" width="12" height="13" fill="#fff" stroke="#2f5fa8"/><rect x="4" y="4" width="4" height="3" fill="#2f6db5"/><rect x="8.5" y="9" width="4" height="3" fill="#2f6db5"/><path d="M8 5.5h2v5h-1.5" fill="none" stroke="#2f6db5"/></svg>',
  sfc:'<svg class="gico" viewBox="0 0 16 16"><rect x="2" y="1.5" width="12" height="13" fill="#fff" stroke="#8a3fb8"/><rect x="5.5" y="3" width="5" height="3" fill="#8a3fb8"/><path d="M8 6v4M6 8h4" stroke="#8a3fb8"/><rect x="5.5" y="10" width="5" height="3" fill="none" stroke="#8a3fb8"/></svg>',
  blk:c=>`<svg class="gico" viewBox="0 0 16 16"><rect x="3" y="2" width="10" height="12" rx="1.5" fill="none" stroke="${CATCOL[c]||CATCOL.tech}" stroke-width="1.6"/><path d="M1 6h2M1 10h2M13 8h2" stroke="${CATCOL[c]||CATCOL.tech}" stroke-width="1.4"/></svg>`,
  rio:'<svg class="gico" viewBox="0 0 16 16"><rect x="1" y="3" width="14" height="10" fill="#dfe6ee" stroke="#5a6b80"/><rect x="2.5" y="4.5" width="2" height="7" fill="#2e8540"/><rect x="5.5" y="4.5" width="2" height="7" fill="#2f6db5"/><rect x="8.5" y="4.5" width="2" height="7" fill="#2f6db5"/><rect x="11.5" y="4.5" width="2" height="7" fill="#b06d00"/></svg>',
  cpu:'<svg class="gico" viewBox="0 0 16 16"><rect x="1" y="2" width="14" height="12" fill="#dfe6ee" stroke="#5a6b80"/><rect x="3" y="4" width="4" height="8" fill="#0f8a8a"/><rect x="8" y="4" width="2" height="8" fill="#7b8494"/><rect x="11" y="4" width="2" height="8" fill="#7b8494"/></svg>',
  bus:'<svg class="gico" viewBox="0 0 16 16"><path d="M1 8h14M4 8v-4M8 8v4M12 8v-4" stroke="#8a3fb8" stroke-width="2" fill="none"/></svg>',
  type:'<svg class="gico" viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" rx="2" fill="none" stroke="currentColor"/><text x="8" y="11.5" font-size="8" text-anchor="middle" fill="currentColor">T</text></svg>',
};
function sideFolder(f, depth){
  const open = SIDE.open.has('F:'+f.path) || f.path==='';
  let h = '';
  if (f.path!==''){
    h += `<div class="tn" data-tn="folder" data-id="${esc(f.path)}"><span class="tw" data-tog="F:${esc(f.path)}">${open?'▾':'▸'}</span>${GI.folder}<span>${esc(f.name)}</span><span class="cnt">${f.nCharts}</span></div>`;
  } else {
    h += `<div class="tn" data-tn="folder" data-id=""><span class="tw"></span>${GI.folder}<b>Celý projekt</b><span class="cnt">${f.nCharts}</span></div>`;
  }
  if (!open) return h;
  h += '<div class="tc">';
  for (const sub of [...f.folders.values()].sort((a,b)=>natCmp(a.name,b.name))) h += sideFolder(sub, depth+1);
  for (const cp of f.charts) h += sideChart(cp);
  h += '</div>';
  return h;
}
function sideChart(cp){
  const c = M.charts.get(cp); const open = SIDE.open.has('C:'+cp);
  const n = c.blocks.size;
  let h = `<div class="tn" data-tn="chart" data-id="${esc(cp)}"><span class="tw" ${n?`data-tog="C:${esc(cp)}"`:''}>${n?(open?'▾':'▸'):''}</span>${c.isSfc?GI.sfc:GI.cfc}<span>${esc(c.name)}</span><span class="cnt">${n||''}</span></div>`;
  if (open && n){
    h += '<div class="tc">';
    const ids = [...c.blocks].map(id=>M.blocks.get(id)).sort((a,b)=>(a.kind==='chart'?0:1)-(b.kind==='chart'?0:1) || natCmp(a.name,b.name));
    for (const b of ids){
      if (b.kind==='chart' && M.charts.has(b.id)) h += sideChart(b.id);
      else h += `<div class="tn" data-tn="block" data-id="${esc(b.id)}"><span class="tw"></span>${GI.blk(catOf(b))}<span>${esc(b.name)}</span> <span class="ty">${esc(b.type)}</span></div>`;
    }
    h += '</div>';
  }
  return h;
}
function matchTokens(hay, f){ const toks=f.split(/\s+/).filter(Boolean); return toks.every(t=>hay.includes(t)); }
function sideFilterHier(f){
  const charts=[], blocks=[];
  for (const c of M.charts.values()) if (matchTokens(c.path.toLowerCase(), f)) charts.push(c);
  for (const b of M.blocks.values()) if (b.kind!=='chart' && matchTokens((b.id+' '+b.type+' '+b.comment).toLowerCase(), f)) blocks.push(b);
  charts.sort((a,b)=>natCmp(a.path,b.path)); blocks.sort((a,b)=>natCmp(a.id,b.id));
  let h = `<div class="muted" style="padding:4px 6px">${charts.length} chartů, ${blocks.length} bloků</div>`;
  h += charts.slice(0,150).map(c=>`<div class="tn" data-tn="chart" data-id="${esc(c.path)}" title="${esc(c.path)}"><span class="tw"></span>${c.isSfc?GI.sfc:GI.cfc}<span>${esc(chartShort(c.path))}</span><span class="cnt">${esc(clip(c.folder,28))}</span></div>`).join('');
  h += blocks.slice(0,400).map(b=>`<div class="tn" data-tn="block" data-id="${esc(b.id)}" title="${esc(b.id)}"><span class="tw"></span>${GI.blk(catOf(b))}<span>${esc(b.name||chartShort(b.id))}</span> <span class="ty">${esc(b.type)}</span><span class="cnt">${esc(clip(b.chart?chartShort(b.chart):'',22))}</span></div>`).join('');
  if (blocks.length>400) h+='<div class="muted" style="padding:6px">… zúžte hledání</div>';
  return h;
}
function sideTypes(f){
  const types=new Map();
  for (const b of M.blocks.values()){ if (!b.type || b.kind==='chart') continue; (types.get(b.type)||types.set(b.type,[]).get(b.type)).push(b); }
  let list=[...types.entries()].sort((a,b)=>natCmp(a[0],b[0]));
  if (f) list=list.filter(([t,bs])=>t.toLowerCase().includes(f) || bs.some(b=>(b.fb||'').toLowerCase()===f));
  return list.map(([t,bs])=>{
    const open=SIDE.open.has('T:'+t);
    let h=`<div class="tn" data-tog="T:${esc(t)}"><span class="tw">${open?'▾':'▸'}</span>${GI.blk(catOf(bs[0]))}<span>${esc(t)}</span> <span class="ty">${esc(bs.find(b=>b.fb)?.fb||'')}</span><span class="cnt">${bs.length}</span></div>`;
    if (open){ h+='<div class="tc">'+bs.sort((a,b)=>natCmp(a.id,b.id)).slice(0,1000).map(b=>`<div class="tn" data-tn="block" data-id="${esc(b.id)}" title="${esc(b.id)}"><span class="tw"></span><span>${esc(b.name||chartShort(b.id))}</span><span class="cnt">${esc(clip(b.chart?chartShort(b.chart):'',26))}</span></div>`).join('')+'</div>'; }
    return h;
  }).join('') || '<div class="empty">Nic</div>';
}
function sfcList(){
  const out=[];
  for (const t of M.sfcTypes.values()){
    const inst=[...M.blocks.values()].filter(b=>b.type===t.name);
    out.push({kind:'type', id:t.name, name:t.name, inst, ios:t.ios.size});
  }
  for (const b of M.blocks.values()) if (b.kind==='sfc' && !M.sfcTypes.has(b.type)) out.push({kind:'chart', id:b.id, name:chartShort(b.id), path:b.id, rows:(M.sfcCharts.get(b.id)||{rows:[]}).rows.length});
  return out.sort((a,b)=>natCmp(a.name,b.name));
}
function sideSFC(f){
  const L=sfcList().filter(x=>!f || (x.name+' '+(x.path||'')+' '+(x.inst||[]).map(b=>b.id).join(' ')).toLowerCase().includes(f));
  return L.map(x=>{
    if (x.kind==='type') return `<div class="tn" data-tn="sfctype" data-id="${esc(x.id)}"><span class="tw"></span>${GI.sfc}<span>${esc(x.name)}</span> <span class="ty">typ</span><span class="cnt">${x.inst.length} inst.</span></div>`+
       x.inst.map(b=>`<div class="tn tc" data-tn="sfci" data-id="${esc(b.id)}" title="${esc(b.id)}"><span class="tw"></span>${GI.blk('sfci')}<span>${esc(chartShort(b.chart))}\\${esc(b.name)}</span></div>`).join('');
    return `<div class="tn" data-tn="sfci" data-id="${esc(x.id)}" title="${esc(x.path)}"><span class="tw"></span>${GI.sfc}<span>${esc(x.name)}</span> <span class="ty">SFC chart</span><span class="cnt">${esc(clip(folderOf(x.path),24))}</span></div>`;
  }).join('') || '<div class="empty">Žádné SFC. Nahrajte '+icon('ac')+' nebo '+icon('sx')+'</div>';
}
function sideOB(f){
  if (!M.files.rs) return needFiles(['rs'],'seznam OB');
  return [...M.obs.values()].sort((a,b)=>natCmp(a.ob,b.ob)).filter(o=>!f||(o.ob+' '+o.name).toLowerCase().includes(f))
   .map(o=>`<div class="tn" data-tn="ob" data-id="${esc(o.ob)}"><span class="tw"></span><span class="mono">${esc(o.ob)}</span> <span class="ty">${esc(o.name)}</span><span class="cnt">${o.count}</span></div>`).join('');
}
function markSideSel(){
  document.querySelectorAll('#side .tn.sel').forEach(e=>e.classList.remove('sel'));
  const id = NAV.id; if (id==null) return;
  const typ = {block:'block', chart:NAV.folder?'folder':'chart', sfc:NAV.inst?'sfci':'sfctype', run:'ob', hw:'hw'}[NAV.view];
  if (!typ) return;
  for (const el of document.querySelectorAll(`#side .tn[data-tn="${typ}"]`)) if (el.dataset.id===id){ el.classList.add('sel'); }
}

/* ================= Block view ================= */
function viewBlock(v){
  if (!M) return;
  const b = NAV.id && M.blocks.get(NAV.id);
  if (!b){ v.innerHTML = `<div class="empty">Vyberte blok ve stromu vlevo, v grafu nebo přes hledání.</div>`; return; }
  const c = chartOf(b);
  const pins=[...b.pins.values()].sort((x,y)=>(x.dir==='out')-(y.dir==='out') || natCmp(x.name,y.name));
  const nIn = pins.filter(p=>p.dir!=='out' && pinUsed(p)).length, nOut = pins.filter(p=>p.dir==='out' && pinUsed(p)).length;
  const nAddr = pins.reduce((s,p)=>s+p.addrs.length,0);
  const isSfc = b.kind==='sfci' || b.kind==='sfc';
  v.innerHTML = `<div class="fullv"><div class="pad" style="padding-bottom:6px">
    ${crumb(b.chart || b.id, b)}
    <div class="card"><div class="row" style="align-items:flex-start">
      <div class="flex1"><h2>${GI.blk(catOf(b))} ${esc(blockTitle(b))} <span class="pill">${esc(b.type||'?')}</span> ${b.fb?`<span class="pill">${esc(b.fb)}</span>`:''}</h2>
      <div class="muted">${esc(b.comment)}</div>
      <div class="kv" style="margin-top:8px"><b>Umístění</b><span class="mono">${esc(b.id)}</span>
        ${b.run.length?`<b>Běh</b><span>${runInfo(b)}</span>`:''}
        <b>Napojení</b><span>${nIn} vstupů · ${nOut} výstupů · ${nAddr} adres</span></div></div>
      <div class="row" style="flex-direction:column;align-items:stretch;gap:6px">
        ${b.chart?`<button data-go="chart" data-id="${esc(b.chart)}" data-focus="${esc(b.id)}">Zobrazit v CFC</button>`:''}
        ${M.charts.has(b.id)?`<button data-go="chart" data-id="${esc(b.id)}">Otevřít vnořený chart</button>`:''}
        <button data-go="neigh" data-id="${esc(b.id)}">Okolí (graf)</button>
        ${isSfc?`<button class="primary" data-go="sfci" data-id="${esc(b.id)}">SFC kontrola</button>`:''}
      </div></div></div></div>
    <div id="bgraph" style="height:420px;min-height:420px;margin:0 18px;border:1px solid var(--line);border-radius:8px"></div>
    <div class="pad"><h3 style="margin:4px 0 8px">Piny (${pins.length})</h3>
      ${pins.length ? `<div class="tablewrap"><table class="t"><tr><th>Pin</th><th>Směr</th><th>Komentář</th><th>Propojeno s</th><th>Adresa</th><th>SFC přístup</th></tr>
      ${pins.map(p=>`<tr><td class="mono nw">${esc(p.name)}</td><td>${p.dir==='out'?'OUT':p.dir==='in'?'IN':'?'}</td><td class="muted">${esc(p.comment)}</td>
        <td>${p.edges.map(e=> e.a===b.id && e.ap===p.name ? '→ '+pinRef(e.b,e.bp,b.chart) : '← '+pinRef(e.a,e.ap,b.chart)).join('<br>')}</td>
        <td>${p.addrs.map(a=>`${al(a.addr)} ${a.sym?`<span class="muted">${esc(a.sym)}</span>`:''} <span class="pill">${esc(a.rw)}</span>${M.hw?`<div style="font-size:11px">${hwAddrCell(a.addr)}</div>`:''}`).join('<br>')}</td>
        <td>${sfcUseSummary(p.sfc)}</td></tr>`).join('')}</table></div>`
      : '<div class="muted">Blok nemá žádné známé napojené piny (nebo chybí export '+icon('ic')+').</div>'}
    </div></div>`;
  const L = buildNeigh(b.id, 1, 'both', true, 80);
  renderGraph($('#bgraph'), layoutGraph(L.nodes, L.edges, {}), {focus:b.id, fileName:blockTitle(b), hint:'kolečko = zoom · táhnout = posun · klik = zvýraznit · dvojklik = otevřít',
    onDbl:n=>openNode(n)});
}
function sfcUseSummary(list){
  if (!list.length) return '';
  const by = new Map(); for (const r of list){ const k=r.sfc; (by.get(k)||by.set(k,[]).get(k)).push(r); }
  return [...by.entries()].map(([s,rs])=>`<details class="uses"><summary>${M.blocks.has(s)?bl(s, chartShort(s)):esc(s)} <span class="pill">${[...new Set(rs.map(r=>r.rw))].join('/')}</span> ${rs.length}×</summary>${rs.map(r=>`<div>${esc(r.seq)}: ${esc(r.addr)} <span class="muted">(${esc(r.kind)})</span></div>`).join('')}</details>`).join('');
}
function crumb(chartPath, b){
  const {folder, chain} = splitChartPath(chartPath||'');
  const parts=[]; let acc='';
  parts.push(`<a data-go="folder" data-id="">Projekt</a>`);
  if (folder) for (const seg of folder.split('\\')){ acc = acc?acc+'\\'+seg:seg; parts.push(`<a data-go="folder" data-id="${esc(acc)}">${esc(seg)}</a>`); }
  let cp = folder;
  chain.forEach((seg,i)=>{ cp = i===0 ? (folder? folder+SEP2+seg : seg) : cp+'\\'+seg; if (b && b.id===cp && !b.chart) parts.push(`<b>${esc(seg)}</b>`); else parts.push(`<a data-go="chart" data-id="${esc(cp)}">${GI.cfc} ${esc(seg)}</a>`); });
  if (b && b.chart) parts.push(`<b>${esc(b.name)}</b>`);
  return `<div class="crumb">${parts.join(' › ')}</div>`;
}
function folderCrumb(fp){
  const parts=[`<a data-go="folder" data-id="">Projekt</a>`]; let acc='';
  if (fp) for (const seg of fp.split('\\')){ acc=acc?acc+'\\'+seg:seg; parts.push(acc===fp?`<b>${esc(seg)}</b>`:`<a data-go="folder" data-id="${esc(acc)}">${esc(seg)}</a>`); }
  return `<div class="crumb" style="margin:0">${GI.folder} ${parts.join(' › ')}</div>`;
}
function openNode(n){
  if (n.ref && n.ref.type==='block') go({view:'block', id:n.ref.id});
  else if (n.ref && n.ref.type==='chart') go({view:'chart', id:n.ref.id});
  else if (n.ref && n.ref.type==='folder') go({view:'chart', id:n.ref.id, folder:true});
  else if (n.ref && n.ref.type==='addr') go({view:'addr', q:n.ref.id});
}

/* ---- neighbourhood graph ---- */
const PALETTE=['#2f6db5','#2e8540','#b05a00','#8a3fb8','#0f8a8a','#c0392b','#6b7a00','#b8327a','#4a5bd4','#7a5c3a'];
function buildNeigh(rootId, depth, dir, withAddr, maxN, colorByChart){
  const seen=new Map([[rootId,0]]); let frontier=[rootId]; const E=[];
  const eset=new Set();
  for (let d=1; d<=depth && frontier.length; d++){
    const next=[];
    for (const id of frontier){
      const b=M.blocks.get(id); if(!b) continue;
      const es=[]; if (dir!=='up') es.push(...b.outE.map(e=>[e,e.b])); if (dir!=='down') es.push(...b.inE.map(e=>[e,e.a]));
      for (const [e,o] of es){
        if (!seen.has(o)){ if (seen.size>=maxN) continue; seen.set(o,d); next.push(o); }
        eset.add(e);
      }
    }
    frontier=next;
  }
  // also edges among seen nodes
  for (const id of seen.keys()){ const b=M.blocks.get(id); if(!b) continue; for (const e of b.outE) if (seen.has(e.b)) eset.add(e); }
  const pinsIn=new Map(), pinsOut=new Map();
  const addP=(m,id,p)=>{ (m.get(id)||m.set(id,new Set()).get(id)).add(p); };
  const edges=[];
  for (const e of eset){ addP(pinsOut,e.a,e.ap); addP(pinsIn,e.b,e.bp); edges.push({from:e.a, fp:e.ap, to:e.b, tp:e.bp, dead:e.dead, tip:`${blockFull(M.blocks.get(e.a))}.${e.ap} → ${blockFull(M.blocks.get(e.b))}.${e.bp}${e.dead?' (implicit dead time)':''}`}); }
  const extra=[];
  if (withAddr){
    const root=M.blocks.get(rootId);
    for (const p of root.pins.values()){
      for (const a of p.addrs){
        const out = a.rw.includes('W') && !a.rw.includes('R');
        const nid='addr:'+a.addr+(out?':W':':R');
        if (!extra.some(n=>n.id===nid)) extra.push({id:nid, title:a.addr, sub:a.sym||a.dt, cat:'addr', cls:'addr', small:true, ins:[], outs:[], side: out?'R':'L', ref:{type:'addr', id:a.addr}});
        if (out){ addP(pinsOut,rootId,p.name); edges.push({from:rootId, fp:p.name, to:nid, tp:null, cls:'addr'}); }
        else { addP(pinsIn,rootId,p.name); edges.push({from:nid, fp:null, to:rootId, tp:p.name, cls:'addr'}); }
      }
      const bySfc=new Map(); for (const r of p.sfc){ (bySfc.get(r.sfc)||bySfc.set(r.sfc,new Set()).get(r.sfc)).add(r.rw); }
      for (const [s,rws] of bySfc){
        const w = rws.has('W');
        const nid='sfc:'+s+(w?':W':':R');
        if (!extra.some(n=>n.id===nid)) extra.push({id:nid, title:chartShort(s), sub:'SFC '+(w?'zapisuje':'čte'), cat:'sfc', small:true, ins:[], outs:[], side:w?'L':'R', ref:M.blocks.has(s)?{type:'block',id:s}:null});
        if (w){ addP(pinsIn,rootId,p.name); edges.push({from:nid, fp:null, to:rootId, tp:p.name, cls:'sfc'}); }
        else { addP(pinsOut,rootId,p.name); edges.push({from:rootId, fp:p.name, to:nid, tp:null, cls:'sfc'}); }
      }
    }
  }
  const charts=[...new Set([...seen.keys()].map(id=>M.blocks.get(id)?.chart||id))];
  const chartColor=new Map(charts.map((c,i)=>[c,PALETTE[i%PALETTE.length]]));
  const root=M.blocks.get(rootId);
  const nodes=[...seen.keys()].map(id=>{
    const b=M.blocks.get(id);
    const sameChart = b.chart===root.chart;
    return {id, title:blockTitle(b), sub:(sameChart?'':chartShort(b.chart||'')+' · ')+(b.type||''), cat:catOf(b),
      color: colorByChart ? chartColor.get(b.chart||id) : null,
      ins:[...(pinsIn.get(id)||[])].sort(natCmp), outs:[...(pinsOut.get(id)||[])].sort(natCmp), focus:id===rootId,
      cls: (!colorByChart && !sameChart) ? 'ext' : '', tip:b.id+(b.comment?'\n'+b.comment:''), ref:{type:'block', id}};
  });
  return {nodes:nodes.concat(extra), edges, chartColor};
}

function viewNeigh(v){
  if (!M) return;
  if (!M.files.ic){ v.innerHTML=needFiles(['ic'],'graf okolí'); return; }
  const b = NAV.id && M.blocks.get(NAV.id);
  if (!b){ v.innerHTML='<div class="empty">Vyberte blok (strom, hledání) a pak „Okolí“.</div>'; return; }
  const st = Object.assign({depth:2, dir:'both', addr:true, color:true, max:150}, NAV.opt||{});
  v.innerHTML = `<div class="fullv"><div class="toolbar"><b>${bl(b.id)}</b> <span class="muted">${esc(b.type)} · ${esc(chartShort(b.chart||''))}</span>
    <span class="flex1"></span>
    <label>Hloubka <select id="nDepth">${[1,2,3,4,5].map(d=>`<option ${d==st.depth?'selected':''}>${d}</option>`).join('')}</select></label>
    <span class="seg" id="nDir">${[['up','← odkud'],['both','obousměrně'],['down','kam →']].map(([k,l])=>`<button data-d="${k}" class="${st.dir===k?'on':''}">${l}</button>`).join('')}</span>
    <label><input type="checkbox" id="nAddr" ${st.addr?'checked':''}> adresy/SFC</label>
    <label><input type="checkbox" id="nCol" ${st.color?'checked':''}> barvy podle CFC</label>
    <label>max uzlů <select id="nMax">${[50,150,300,600].map(d=>`<option ${d==st.max?'selected':''}>${d}</option>`).join('')}</select></label></div>
    <div id="nlegend" class="toolbar legend"></div><div id="ngraph" class="gwrap"></div></div>`;
  const L = buildNeigh(b.id, st.depth, st.dir, st.addr, st.max, st.color);
  $('#nlegend').innerHTML = st.color ? [...L.chartColor.entries()].slice(0,30).map(([c,col])=>`<span><i style="background:${col}"></i>${cl(c)}</span>`).join('') : legendCats();
  renderGraph($('#ngraph'), layoutGraph(L.nodes, L.edges, {}), {focus:b.id, fileName:'okoli_'+blockTitle(b), hint:`${L.nodes.length} uzlů · ${L.edges.length} spojení · dvojklik = přejít na blok`,
    onDbl:n=>{ if(n.ref&&n.ref.type==='block') go({view:'neigh', id:n.ref.id, opt:st}); else openNode(n);} });
  const upd = patch => go({view:'neigh', id:b.id, opt:Object.assign({},st,patch)});
  $('#nDepth').onchange=e=>upd({depth:+e.target.value});
  $('#nMax').onchange=e=>upd({max:+e.target.value});
  $('#nAddr').onchange=e=>upd({addr:e.target.checked});
  $('#nCol').onchange=e=>upd({color:e.target.checked});
  $('#nDir').onclick=e=>{ const d=e.target.dataset.d; if(d) upd({dir:d}); };
}
function legendCats(){ return Object.entries(CATNAME).map(([k,l])=>`<span><i style="background:${CATCOL[k]}"></i>${l}</span>`).join('') + '<span>- - - implicit dead time</span>'; }

/* ================= Chart view ================= */
function viewChart(v){
  if (!M) return;
  if (NAV.folder || NAV.id==null || !M.charts.has(NAV.id)) return viewFolder(v, NAV.folder ? (NAV.id||'') : '');
  const c = M.charts.get(NAV.id);
  const st = Object.assign({addr:true, ext:true, sfc:true, iso:true}, NAV.opt||{});
  const B = new Set(c.blocks);
  const nodes=new Map(), edges=[];
  const pinsIn=new Map(), pinsOut=new Map();
  const addP=(m,id,p)=>{ (m.get(id)||m.set(id,new Set()).get(id)).add(p); };
  let nExtIn=0, nExtOut=0;
  for (const id of B){
    const b=M.blocks.get(id);
    for (const e of b.outE){
      if (B.has(e.b)){ addP(pinsOut,id,e.ap); addP(pinsIn,e.b,e.bp); edges.push({from:id,fp:e.ap,to:e.b,tp:e.bp,dead:e.dead,tip:`${b.name}.${e.ap} → ${M.blocks.get(e.b).name}.${e.bp}`}); }
      else { nExtOut++; if (!st.ext) continue; const xid='xo:'+e.b; addP(pinsOut,id,e.ap); addP(pinsIn,xid,e.bp); edges.push({from:id,fp:e.ap,to:xid,tp:e.bp,dead:e.dead,tip:`→ ${e.b}.${e.bp}`}); if(!nodes.has(xid)) nodes.set(xid,{id:xid, ext:e.b, side:'R'}); }
    }
    for (const e of b.inE){
      if (B.has(e.a)) continue;
      nExtIn++; if (!st.ext) continue;
      const xid='xi:'+e.a; addP(pinsIn,id,e.bp); addP(pinsOut,xid,e.ap); edges.push({from:xid,fp:e.ap,to:id,tp:e.bp,dead:e.dead,tip:`${e.a}.${e.ap} →`}); if(!nodes.has(xid)) nodes.set(xid,{id:xid, ext:e.a, side:'L'});
    }
    for (const p of b.pins.values()){
      if (st.addr) for (const a of p.addrs){
        const w = a.rw.includes('W') && !a.rw.includes('R');
        const xid='ad:'+a.addr+(w?':W':':R');
        if (!nodes.has(xid)) nodes.set(xid,{id:xid, addr:a, side:w?'R':'L'});
        if (w){ addP(pinsOut,id,p.name); edges.push({from:id,fp:p.name,to:xid,tp:null,cls:'addr'}); }
        else { addP(pinsIn,id,p.name); edges.push({from:xid,fp:null,to:id,tp:p.name,cls:'addr'}); }
      }
      if (st.sfc){
        const by=new Map(); for (const r of p.sfc) (by.get(r.sfc)||by.set(r.sfc,new Set()).get(r.sfc)).add(r.rw);
        for (const [s,rws] of by){ const w=rws.has('W'); const xid='sf:'+s+(w?':W':':R'); if(!nodes.has(xid)) nodes.set(xid,{id:xid, sfc:s, side:w?'L':'R'});
          if (w){ addP(pinsIn,id,p.name); edges.push({from:xid,fp:null,to:id,tp:p.name,cls:'sfc'}); } else { addP(pinsOut,id,p.name); edges.push({from:id,fp:p.name,to:xid,tp:null,cls:'sfc'}); } }
      }
    }
  }
  const order=new Map();
  const N=[];
  for (const id of B){ const b=M.blocks.get(id); order.set(id, runOrder(b));
    if (!st.iso && !pinsIn.has(id) && !pinsOut.has(id)) continue;
    N.push({id, title:b.name, sub:b.type + (b.comment?' · '+b.comment:''), cat:catOf(b), ins:[...(pinsIn.get(id)||[])].sort(natCmp), outs:[...(pinsOut.get(id)||[])].sort(natCmp), tip:b.id+'\n'+b.type+(b.comment?'\n'+b.comment:''), ref:{type:'block',id}, focus:id===NAV.focus}); }
  for (const x of nodes.values()){
    if (x.ext){ const xb=M.blocks.get(x.ext); N.push({id:x.id, title:blockTitle(xb), sub:chartShort(xb.chart||xb.id), cat:'ext', cls:'ext', side:x.side, ins:[...(pinsIn.get(x.id)||[])].sort(natCmp), outs:[...(pinsOut.get(x.id)||[])].sort(natCmp), tip:xb.id, ref:{type:'block',id:xb.id}}); }
    else if (x.addr){ N.push({id:x.id, title:x.addr.addr, sub:x.addr.sym||x.addr.dt, cat:'addr', cls:'addr', small:true, side:x.side, ins:[], outs:[], ref:{type:'addr', id:x.addr.addr}}); }
    else if (x.sfc){ N.push({id:x.id, title:chartShort(x.sfc), sub:'SFC '+(x.side==='L'?'zapisuje':'čte'), cat:'sfc', cls:'ext', small:true, side:x.side, ins:[], outs:[], ref:M.blocks.has(x.sfc)?{type:'block',id:x.sfc}:null}); }
  }
  v.innerHTML = `<div class="fullv"><div class="toolbar">${crumb(c.path).replace('class="crumb"','class="crumb" style="margin:0"')}
     <span class="flex1"></span>
     <label><input type="checkbox" id="cExt" ${st.ext?'checked':''}> externí (jiné CFC)</label>
     <label><input type="checkbox" id="cAddr" ${st.addr?'checked':''}> adresy</label>
     <label><input type="checkbox" id="cSfc" ${st.sfc?'checked':''}> SFC</label>
     <label><input type="checkbox" id="cIso" ${st.iso?'checked':''}> nenapojené bloky</label></div>
     <div class="toolbar legend">${legendCats()}<span class="flex1"></span><span>${B.size} bloků · ${edges.filter(e=>!String(e.from).includes(':')&&!String(e.to).includes(':')).length} interních spojení · ${nExtIn} vstupů z jiných CFC · ${nExtOut} výstupů do jiných CFC</span></div>
     <div id="cgraph" class="gwrap"></div></div>`;
  if (!M.files.ic) $('#cgraph').insertAdjacentHTML('beforebegin', `<div class="toolbar" style="color:var(--warn)">Bez exportu ${icon('ic')} Block interconnections nejsou vidět propojení.</div>`);
  const upd = patch => go({view:'chart', id:c.path, opt:Object.assign({},st,patch)});
  $('#cExt').onchange=e=>upd({ext:e.target.checked}); $('#cAddr').onchange=e=>upd({addr:e.target.checked}); $('#cSfc').onchange=e=>upd({sfc:e.target.checked}); $('#cIso').onchange=e=>upd({iso:e.target.checked});
  renderGraph($('#cgraph'), layoutGraph(N, edges, {order}), {focus:NAV.focus, fileName:c.name, hint:'Vlevo vstupy z jiných CFC/adres, vpravo výstupy. Dvojklik: blok → detail, externí → jeho CFC.',
    onDbl:n=>{ if (n.cls==='ext' && n.ref && n.ref.type==='block'){ const xb=M.blocks.get(n.ref.id); if (xb.chart) go({view:'chart', id:xb.chart, focus:xb.id}); else go({view:'block', id:xb.id}); } else openNode(n); } });
}

function topChartOf(b){ let cp = b.chart || b.id; let c=M.charts.get(cp); while(c && c.parent){ c=M.charts.get(c.parent); } return c ? c.path : cp; }
function viewFolder(v, fpath){
  const f = M.folderIndex.get(fpath) || M.folderRoot;
  const key = (b)=>{
    const tp = topChartOf(b); const fo = folderOf(tp);
    if (fo===f.path) return 'c:'+tp;
    if (f.path==='' ) return 'f:'+fo.split('\\')[0];
    if (fo.startsWith(f.path+'\\')) return 'f:'+f.path+'\\'+fo.slice(f.path.length+1).split('\\')[0];
    return 'x:'+(fo.split('\\')[0]||tp);
  };
  const agg=new Map(); const nodeSet=new Map();
  for (const sub of f.folders.values()) nodeSet.set('f:'+sub.path,0);
  for (const cp of f.charts) nodeSet.set('c:'+cp,0);
  if (M.files.ic) for (const e of M.edges){
    const ka=key(M.blocks.get(e.a)), kb=key(M.blocks.get(e.b));
    if (ka===kb) continue;
    if (ka.startsWith('x:') && kb.startsWith('x:')) continue;
    const k=ka+'\u0000'+kb; agg.set(k,(agg.get(k)||0)+1);
    if (!nodeSet.has(ka)) nodeSet.set(ka,0); if (!nodeSet.has(kb)) nodeSet.set(kb,0);
  }
  const N=[...nodeSet.keys()].map(k=>{
    const t=k[0], id=k.slice(2);
    if (t==='f'){ const sf=M.folderIndex.get(id); return {id:k, title:id.split('\\').pop(), sub:`složka · ${sf?sf.nCharts:'?'} chartů`, cat:'chart', ins:[], outs:[], ref:{type:'folder',id}}; }
    if (t==='c'){ const c=M.charts.get(id); return {id:k, title:c.name, sub:(c.isSfc?'SFC':'CFC')+` · ${c.blocks.size} bloků`, cat:c.isSfc?'sfc':'tech', ins:[], outs:[], ref:{type:'chart',id}}; }
    return {id:k, title:id, sub:'mimo tuto složku', cat:'ext', cls:'ext', ins:[], outs:[], ref:{type:'folder',id}};
  });
  const pair=new Map();
  for (const [k,n] of agg){ const [a,b]=k.split('\u0000'); const key=a<b?a+'\u0000'+b:b+'\u0000'+a; const x=pair.get(key)||{a,b,ab:0,ba:0}; if (x.a===a) x.ab+=n; else x.ba+=n; pair.set(key,x); }
  const nm=k=>k.slice(2).split('\\').pop();
  const E=[...pair.values()].map(x=>{ const fwd=x.ab>=x.ba; return {from:fwd?x.a:x.b, fp:null, to:fwd?x.b:x.a, tp:null, label:String(x.ab+x.ba), tip:`${nm(x.a)} → ${nm(x.b)}: ${x.ab}\n${nm(x.b)} → ${nm(x.a)}: ${x.ba}`}; });
  v.innerHTML = `<div class="fullv"><div class="toolbar">${folderCrumb(f.path)}<span class="flex1"></span><span class="muted">Přehled: složky a CFC charty v této úrovni, čísla = počet propojení. Dvojklik = otevřít.</span></div>
    <div id="fgraph" class="gwrap"></div></div>`;
  if (!N.length){ $('#fgraph').innerHTML='<div class="empty">Prázdné</div>'; return; }
  renderGraph($('#fgraph'), layoutGraph(N, E, {}), {fileName:'prehled_'+(f.name||'projekt'), onDbl:n=>openNode(n), hint:'dvojklik na složku = zanořit, na chart = otevřít CFC'});
}

/* ================= SFC view ================= */
function viewSFC(v){
  if (!M) return;
  if (!M.files.ac && !M.files.sx){ v.innerHTML=needFiles(['ac','sx','ic'],'kontrolu SFC'); return; }
  if (!NAV.id){
    const L=sfcList();
    v.innerHTML = `<div class="pad"><h3>SFC typy a SFC charty</h3><div class="sfcgrid">${L.map(x=> x.kind==='type'
      ? `<div class="sfccard" data-go="sfctype" data-id="${esc(x.id)}">${GI.sfc} <b>${esc(x.name)}</b> <span class="pill">typ</span><div class="muted">${x.ios} používaných I/O · ${x.inst.length} instancí</div>${x.inst.map(b=>`<div class="mono" style="font-size:11px">${esc(chartShort(b.chart))}\\${esc(b.name)}</div>`).join('')}</div>`
      : `<div class="sfccard" data-go="sfci" data-id="${esc(x.id)}">${GI.sfc} <b>${esc(x.name)}</b> <span class="pill">SFC chart</span><div class="muted">${esc(folderOf(x.path))}</div><div class="muted">${x.rows} přístupů do CFC</div></div>`).join('')}</div></div>`;
    return;
  }
  if (NAV.inst){
    const b=M.blocks.get(NAV.id);
    if (b && b.kind==='sfci') return viewSFCInstance(v, b, M.sfcTypes.get(b.type));
    if (b && b.kind==='sfc') return viewSFCChart(v, b);
  }
  const t=M.sfcTypes.get(NAV.id); if (!t){ v.innerHTML='<div class="empty">Nenalezeno</div>'; return; }
  const inst=[...M.blocks.values()].filter(b=>b.type===t.name);
  if (inst.length===1) return viewSFCInstance(v, inst[0], t);
  return viewSFCInstance(v, null, t, inst);
}

function ioStatus(io, b){
  const p = b ? b.pins.get(io.base) : null;
  const conn = p ? (p.edges.length + p.addrs.length + p.sfc.length) : 0;
  const sec = io.section, as = io.assign;
  if (conn) return {k:'ok', t:'napojeno', p};
  if (as==='Timer') return {k:'info', t:'interní timer', p};
  if (as==='(Standard interface)' && sec==='OUT') return {k:'info', t:'std. výstup', p};
  if (as==='Parameter' || as==='Setpoint') return {k:'warn', t:'nenapojeno – hodnota parametru?', p};
  if (sec==='OUT') return {k:'warn', t:'zapisuje se, ale nikam nevede', p};
  return {k:'err', t:'používá se, ale NENÍ napojeno', p};
}
function viewSFCInstance(v, b, t, instList){
  const ios=[...t.ios.values()].sort((x,y)=>natCmp(x.section,y.section)||natCmp(x.base,y.base));
  const flt = NAV.flt || 'all';
  const rows = ios.map(io=>({io, st:ioStatus(io,b)}));
  const extra = b ? [...b.pins.values()].filter(p=>!t.ios.has(p.name) && pinUsed(p)) : [];
  const cnt = k => rows.filter(r=>r.st.k===k).length;
  const show = rows.filter(r=> flt==='all' || (flt==='prob' ? (r.st.k==='err'||r.st.k==='warn') : flt==='in' ? r.io.section!=='OUT' : r.io.section==='OUT'));
  const partner = (st)=>{ const p=st.p; if(!p) return ''; return [
      ...p.edges.map(e=> e.a===b.id ? '→ '+pinRef(e.b,e.bp,b.chart) : '← '+pinRef(e.a,e.ap,b.chart)),
      ...p.addrs.map(a=>`${al(a.addr)} <span class="muted">${esc(a.sym)}</span>`),
      ...p.sfc.map(r=>`SFC ${esc(chartShort(r.sfc))} ${esc(r.rw)}`)].join('<br>'); };
  const usesHtml = io => { const st=io.uses.filter(u=>u.kind==='Step').length, tr=io.uses.filter(u=>u.kind==='Transition').length, sc=io.uses.length-st-tr;
    return `<details class="uses"><summary>${io.uses.length}× <span class="muted">(${st} kroků, ${tr} tranzic${sc?`, ${sc} start/jiné`:''})</span></summary>${io.uses.map(u=>`<div>${esc(u.seq)} · ${esc(u.addr)} <span class="muted">${esc(u.kind)} ${esc(u.rw)}${u.val?' = '+esc(u.val):''}</span></div>`).join('')}</details>`; };
  v.innerHTML = `<div class="pad">
    ${b ? crumb(b.chart, b) : ''}
    <div class="card"><div class="row"><div class="flex1"><h2>${GI.sfc} ${esc(t.name)} ${b?`<span class="muted" style="font-weight:400">instance</span> ${bl(b.id, chartShort(b.chart)+'\\'+b.name)}`:''}</h2>
      <div class="muted">${t.fromAccess?`Zdroj: ${icon('ac')} Accesses in SFC types`:`Zdroj: ${icon('sx')} Cross-References SFC → Chart Element (méně detailů)`}${M.files.ic?'':` · <span style="color:var(--err)">chybí ${icon('ic')} Block interconnections – nelze ověřit napojení</span>`}</div>
      ${instList ? `<div style="margin-top:8px">Vyberte instanci: ${instList.map(x=>`<a class="lnk" data-go="sfci" data-id="${esc(x.id)}">${esc(chartShort(x.chart))}\\${esc(x.name)}</a>`).join(' · ') || '<i>žádná instance v nahraných datech</i>'}</div>`:''}</div>
      ${b?`<div class="row"><button data-go="chart" data-id="${esc(b.chart)}" data-focus="${esc(b.id)}">CFC</button><button data-go="neigh" data-id="${esc(b.id)}">Okolí</button></div>`:''}</div>
      <div class="row" style="margin-top:10px">
        <div class="stat err"><b>${cnt('err')}</b><span>použito, nenapojeno</span></div>
        <div class="stat warn"><b>${cnt('warn')}</b><span>výstup/parametr bez spojení</span></div>
        <div class="stat ok"><b>${cnt('ok')}</b><span>napojeno</span></div>
        <div class="stat"><b>${cnt('info')}</b><span>interní (timery, std.)</span></div>
        ${b?`<div class="stat"><b>${extra.length}</b><span>napojeno, ale v sekvenci nepoužito</span></div>`:''}
      </div></div>
    <div class="row" style="margin-bottom:8px"><span class="seg" id="sfFlt">${[['all','Vše'],['prob','Jen problémy'],['in','IN'],['out','OUT']].map(([k,l])=>`<button data-f="${k}" class="${flt===k?'on':''}">${l}</button>`).join('')}</span>
      <span class="muted">Status vychází z exportů – „napojeno“ = propojení na blok, adresu nebo přístup z jiného SFC.</span></div>
    <div class="tablewrap"><table class="t"><tr><th></th><th>I/O</th><th>Sekce</th><th>Přiřazení</th><th>Charakteristika</th><th>Použití v sekvenci</th><th>${b?'Napojení v CFC':'Status'}</th></tr>
      ${show.map(({io,st})=>`<tr><td><span class="pill ${st.k==='info'?'':st.k}">${esc(st.t)}</span></td><td class="mono nw">${esc(io.name)}</td><td>${esc(io.section)}</td><td>${esc(io.assign)}</td><td>${esc(io.charact)}</td><td>${usesHtml(io)}</td><td>${b?partner(st):''}</td></tr>`).join('')}
    </table></div>
    ${extra.length ? `<h3 style="margin:16px 0 8px">Napojené piny instance, které sekvence nepoužívá</h3><div class="muted" style="margin-bottom:6px">Mohou to být čistě informační výstupy, nebo I/O používané jen v rozhraní/OS.</div>
      <div class="tablewrap"><table class="t"><tr><th>Pin</th><th>Směr</th><th>Napojení</th></tr>${extra.map(p=>`<tr><td class="mono">${esc(p.name)}</td><td>${p.dir.toUpperCase()}</td><td>${partner({p})}</td></tr>`).join('')}</table></div>`:''}
  </div>`;
  $('#sfFlt').onclick=e=>{ const f=e.target.dataset.f; if(f) go(Object.assign({},NAV,{flt:f}), false); };
}

function downstream(blockId, pin, rw){
  const b=M.blocks.get(blockId); if(!b) return {k:'err', t:'blok nenalezen', d:''};
  if (rw==='W'){
    const outs=b.outE.length, ad=[...b.pins.values()].reduce((s,p)=>s+p.addrs.filter(a=>a.rw.includes('W')).length,0);
    const sfcR=[...b.pins.values()].reduce((s,p)=>s+p.sfc.filter(r=>r.rw==='R').length,0);
    const list=[...b.outE.slice(0,4).map(e=>'→ '+pinRef(e.b,e.bp,b.chart)), ...[...b.pins.values()].flatMap(p=>p.addrs.filter(a=>a.rw.includes('W')).map(a=>'→ '+al(a.addr)))].slice(0,5).join('<br>');
    if (outs||ad) return {k:'ok', t:`výstupy bloku dál: ${outs} spojení${ad?`, ${ad} adres`:''}`, d:list+(outs>4?`<br><span class="muted">… a další</span>`:'')};
    if (sfcR) return {k:'warn', t:'výstup čte jen SFC', d:''};
    if (b.kind==='chart' || b.kind==='sfci') return {k:'warn', t:'nelze ověřit (vnořený chart)', d:''};
    return {k:'err', t:'blok nemá napojené výstupy', d:''};
  } else {
    const ins=b.inE.length, ad=[...b.pins.values()].reduce((s,p)=>s+p.addrs.filter(a=>!a.rw.includes('W')||a.rw.includes('R')).length,0);
    const list=[...b.inE.slice(0,4).map(e=>'← '+pinRef(e.a,e.ap,b.chart)), ...[...b.pins.values()].flatMap(p=>p.addrs.filter(a=>a.rw.includes('R')).map(a=>'← '+al(a.addr)))].slice(0,5).join('<br>');
    if (ins||ad) return {k:'ok', t:`vstupy bloku z: ${ins} spojení${ad?`, ${ad} adres`:''}`, d:list+(ins>4?`<br><span class="muted">… a další</span>`:'')};
    return {k:'warn', t:'blok nemá napojené vstupy (hodnota pevná / z OS?)', d:''};
  }
}
function viewSFCChart(v, sb){
  const sc = M.sfcCharts.get(sb.id) || {rows:[]};
  const by=new Map();
  for (const r of sc.rows){ const k=r.block+'\u0000'+r.pin; let x=by.get(k); if(!x){ x={block:r.block, pin:r.pin, rws:new Set(), uses:[]}; by.set(k,x);} x.rws.add(r.rw); x.uses.push(r); }
  const items=[...by.values()].map(x=>{ const rw=x.rws.has('W')?'W':'R'; return Object.assign(x,{rw, st:downstream(x.block,x.pin,rw)}); })
    .sort((a,b)=>natCmp(a.rw,b.rw)||natCmp(a.block,b.block)||natCmp(a.pin,b.pin));
  const flt = NAV.flt || 'all';
  const show = items.filter(x=>flt==='all'||(flt==='prob'?x.st.k!=='ok':flt==='in'?x.rw==='R':x.rw==='W'));
  const own=[...sb.pins.values()].filter(pinUsed);
  const cnt=k=>items.filter(x=>x.st.k===k).length;
  v.innerHTML = `<div class="pad">${crumb(sb.id, sb)}
    <div class="card"><div class="row"><div class="flex1"><h2>${GI.sfc} ${esc(chartShort(sb.id))} <span class="pill">SFC chart</span></h2>
      <div class="muted">${esc(sb.id)}</div>${sb.run.length?`<div class="kv" style="margin-top:6px"><b>Běh</b><span>${runInfo(sb)}</span></div>`:''}</div>
      <button data-go="neigh" data-id="${esc(sb.id)}">Okolí</button></div>
      <div class="row" style="margin-top:10px">
        <div class="stat"><b>${items.filter(x=>x.rw==='W').length}</b><span>pinů zapisuje</span></div>
        <div class="stat"><b>${items.filter(x=>x.rw==='R').length}</b><span>pinů čte</span></div>
        <div class="stat ok"><b>${cnt('ok')}</b><span>dál napojeno</span></div>
        <div class="stat warn"><b>${cnt('warn')}</b><span>k ověření</span></div>
        <div class="stat err"><b>${cnt('err')}</b><span>nikam nevede</span></div></div></div>
    ${own.length?`<div class="card"><h3>Rozhraní SFC chartu</h3>${own.map(p=>`<div><span class="mono">${esc(p.name)}</span> ${p.edges.map(e=>e.a===sb.id?'→ '+pinRef(e.b,e.bp):'← '+pinRef(e.a,e.ap)).join(', ')}</div>`).join('')}</div>`:''}
    ${sc.rows.length ? `<div class="row" style="margin-bottom:8px"><span class="seg" id="sfFlt">${[['all','Vše'],['prob','Jen k ověření'],['in','Čte (R)'],['out','Zapisuje (W)']].map(([k,l])=>`<button data-f="${k}" class="${flt===k?'on':''}">${l}</button>`).join('')}</span>
      <span class="muted">Pro zápis (W) se kontroluje, zda blok, do kterého SFC píše, má dál napojené výstupy. Pro čtení (R), zda má blok napojené vstupy.</span></div>
    <div class="tablewrap"><table class="t"><tr><th>Element v CFC</th><th>R/W</th><th>Kde v SFC</th><th>Status</th><th>Dál v CFC</th></tr>
      ${show.map(x=>`<tr><td>${pinRef(x.block,x.pin)}<div class="muted" style="font-size:11px">${esc(M.blocks.get(x.block)?.type||'')}</div></td><td>${x.rw}</td>
        <td><details class="uses"><summary>${x.uses.length}×</summary>${x.uses.map(u=>`<div>${esc(u.seq)} · ${esc(u.addr)} <span class="muted">${esc(u.kind)}</span></div>`).join('')}</details></td>
        <td><span class="pill ${x.st.k}">${esc(x.st.t)}</span></td><td>${x.st.d}</td></tr>`).join('')}</table></div>`
      : needFiles(['sx'],'přístupy SFC chartu do CFC')}
  </div>`;
  const f=$('#sfFlt'); if (f) f.onclick=e=>{ const k=e.target.dataset.f; if(k) go(Object.assign({},NAV,{flt:k}), false); };
}

/* ================= Address view ================= */
function addrKey(a){ const m=a.match(/^([A-Z]+)\s*(\d+)?(?:\.(?:[A-Z]*)(\d+))?(?:\.(\d+))?/i); if(!m) return [a,0,0,0]; return [m[1].toUpperCase(), +(m[2]||0), +(m[3]||0), +(m[4]||0)]; }
function areaOf(a){ const t=addrKey(a)[0]; if (t.startsWith('DB')) return 'DB'; if (t.startsWith('PI')) return 'PI'; if (t.startsWith('PQ')) return 'PQ'; return t[0]; }
function viewAddr(v){
  if (!M) return;
  if (!M.files.cr){ v.innerHTML=needFiles(['cr'],'přehled adres'); return; }
  const st=Object.assign({q:'', area:'', multi:false, nosym:false}, NAV.opt||{}); if (NAV.q!=null){ st.q=NAV.q; }
  v.innerHTML = `<div class="fullv"><div class="toolbar"><input type="search" id="aq" placeholder="adresa, symbol, chart, blok… (např. I12 nebo Pump01)" value="${esc(st.q)}" style="width:340px">
     <select id="aArea"><option value="">všechny oblasti</option>${['I','Q','M','DB','PI','PQ'].map(x=>`<option ${st.area===x?'selected':''}>${x}</option>`).join('')}</select>
     <label><input type="checkbox" id="aMulti" ${st.multi?'checked':''}> jen vícenásobný zápis (W)</label>
     <label><input type="checkbox" id="aNoSym" ${st.nosym?'checked':''}> jen bez symbolu</label><span class="flex1"></span><span id="aCnt" class="muted"></span></div>
     <div class="pad" style="padding-top:8px" id="aBody"></div></div>`;
  const draw=()=>{
    const q=st.q.trim().toLowerCase();
    let list=[...M.addrs.values()];
    if (st.area) list=list.filter(a=>areaOf(a.addr)===st.area);
    if (st.multi) list=list.filter(a=>a.refs.filter(r=>r.rw.includes('W')).length>1 && new Set(a.refs.filter(r=>r.rw.includes('W')).map(r=>r.block+r.pin)).size>1);
    if (st.nosym) list=list.filter(a=>!a.sym);
    if (q) list=list.filter(a=>matchTokens((a.addr+' '+a.sym+' '+a.refs.map(r=>r.block+'.'+r.pin+' '+r.comment).join(' ')).toLowerCase(), q));
    list.sort((x,y)=>{ const a=addrKey(x.addr), b=addrKey(y.addr); return natCmp(a[0],b[0])||a[1]-b[1]||a[2]-b[2]||a[3]-b[3]; });
    $('#aCnt').textContent = list.length+' adres';
    const lim=list.slice(0,1500);
    $('#aBody').innerHTML = `<div class="tablewrap"><table class="t"><tr><th>Adresa</th><th>Symbol</th><th>Typ</th><th>R/W</th><th>Chart \\ blok.pin</th><th>Komentář</th><th>Typ bloku</th>${M.hw?'<th>HW kanál</th>':''}</tr>
      ${lim.map(a=>a.refs.map((r,i)=>{ const b=M.blocks.get(r.block); const multiW = a.refs.filter(x=>x.rw.includes('W')).length>1 && r.rw.includes('W');
        return `<tr>${i===0?`<td rowspan="${a.refs.length}" class="mono nw"><b>${esc(a.addr)}</b></td><td rowspan="${a.refs.length}">${esc(a.sym)}</td><td rowspan="${a.refs.length}">${esc(a.dt)}</td>`:''}
        <td>${multiW?`<span class="pill err">${esc(r.rw)}</span>`:esc(r.rw)}</td><td><span class="muted">${esc(b&&b.chart?chartShort(b.chart)+'\\':'')}</span>${bl(r.block)}<span class="mono">.${esc(r.pin)}</span></td><td class="muted">${esc(r.comment)}</td><td>${esc(b?b.type:'')}</td>${M.hw&&i===0?`<td rowspan="${a.refs.length}">${hwAddrCell(a.addr)}</td>`:''}</tr>`; }).join('')).join('')}</table></div>
      ${list.length>1500?'<div class="muted" style="padding:8px">Zobrazeno prvních 1500 – zužte filtr.</div>':''}`;
  };
  let tm; $('#aq').oninput=e=>{ clearTimeout(tm); tm=setTimeout(()=>{ st.q=e.target.value; NAV.q=st.q; NAV.opt=st; draw(); },180); };
  $('#aArea').onchange=e=>{ st.area=e.target.value; NAV.opt=st; draw(); };
  $('#aMulti').onchange=e=>{ st.multi=e.target.checked; NAV.opt=st; draw(); };
  $('#aNoSym').onchange=e=>{ st.nosym=e.target.checked; NAV.opt=st; draw(); };
  draw();
}

/* ================= Run sequence ================= */
function viewRun(v){
  if (!M) return;
  if (!M.files.rs){ v.innerHTML=needFiles(['rs'],'pořadí běhu'); return; }
  const obs=[...M.obs.values()].sort((a,b)=>natCmp(a.ob,b.ob));
  const ob = NAV.id || (obs.find(o=>o.ob==='OB35')||obs.find(o=>o.count>0)||obs[0]).ob;
  const q0 = NAV.q||'';
  v.innerHTML = `<div class="fullv"><div class="toolbar"><select id="rOb">${obs.map(o=>`<option value="${esc(o.ob)}" ${o.ob===ob?'selected':''}>${esc(o.ob)} – ${esc(o.name)} (${o.count})</option>`).join('')}</select>
    <input type="search" id="rq" placeholder="filtr: skupina, chart, blok, typ" value="${esc(q0)}" style="width:300px"><span class="flex1"></span><span class="muted" id="rCnt"></span></div><div class="pad" style="padding-top:8px" id="rBody"></div></div>`;
  const draw=()=>{
    const q=$('#rq').value.trim().toLowerCase();
    let list=M.run.filter(r=>r.ob===ob);
    if (q) list=list.filter(r=>{ const b=M.blocks.get(r.block); return matchTokens((r.group+' '+r.block+' '+(b?b.type+' '+b.comment:'')).toLowerCase(), q); });
    $('#rCnt').textContent=list.length+' bloků';
    let last=null;
    $('#rBody').innerHTML=`<div class="tablewrap"><table class="t"><tr><th>#</th><th>Runtime skupina</th><th>Redukce</th><th>Chart \\ blok</th><th>Typ</th><th>Komentář</th></tr>${list.slice(0,3000).map(r=>{ const b=M.blocks.get(r.block); const g=r.group!==last; last=r.group;
      return `<tr><td class="muted">${r.n}</td><td>${g?`<b>${esc(r.group)}</b>`:''}</td><td class="muted nw">${g?esc(r.ratio):''}</td><td><span class="muted">${esc(b&&b.chart?chartShort(b.chart)+'\\':'')}</span>${bl(r.block)}</td><td>${esc(b?b.type:'')}</td><td class="muted">${esc(b?b.comment:'')}</td></tr>`; }).join('')}</table></div>${list.length>3000?'<div class="muted">… zobrazeno 3000</div>':''}`;
  };
  $('#rOb').onchange=e=>go({view:'run', id:e.target.value});
  let tm; $('#rq').oninput=()=>{ clearTimeout(tm); tm=setTimeout(()=>{ NAV.q=$('#rq').value; draw(); },180); };
  draw();
}

/* ================= Search ================= */
function viewSearch(v){
  if (!M) return;
  const q=(NAV.q||'').trim();
  if (!q){ v.innerHTML='<div class="empty">Zadejte hledaný výraz nahoře.<br><br>Více slov = všechna musí sedět (např. <span class="mono">linka1 motl</span>).<br>Prefixy: <span class="mono">t:MotL</span> (typ bloku), <span class="mono">p:FbkRun</span> (pin), <span class="mono">a:I12</span> (adresa).</div>'; return; }
  let toks=q.toLowerCase().split(/\s+/).filter(Boolean);
  const tType=toks.filter(t=>t.startsWith('t:')).map(t=>t.slice(2)); const tPin=toks.filter(t=>t.startsWith('p:')).map(t=>t.slice(2)); const tAddr=toks.filter(t=>t.startsWith('a:')).map(t=>t.slice(2));
  toks=toks.filter(t=>!/^[tpa]:/.test(t));
  const blocks=[], charts=[], addrs=[], pins=[];
  if (!tAddr.length){
    for (const b of M.blocks.values()){
      if (tType.length && !tType.every(t=>b.type.toLowerCase().includes(t))) continue;
      if (tPin.length){ for (const p of b.pins.values()) if (tPin.every(t=>p.name.toLowerCase().includes(t)) && matchTokens((b.id+' '+b.type).toLowerCase(), toks.join(' '))) pins.push([b,p]); continue; }
      if (matchTokens((b.id+' '+b.type+' '+b.comment+' '+b.fb).toLowerCase(), toks.join(' '))) blocks.push(b);
    }
    if (!tType.length && !tPin.length) for (const c of M.charts.values()) if (matchTokens(c.path.toLowerCase(), toks.join(' '))) charts.push(c);
  }
  if (!tType.length && !tPin.length) for (const a of M.addrs.values()){ const hay=(a.addr+' '+a.sym).toLowerCase(); if ((tAddr.every(t=>a.addr.toLowerCase().startsWith(t))) && matchTokens(hay, toks.join(' '))) addrs.push(a); }
  blocks.sort((a,b)=>natCmp(a.id,b.id)); charts.sort((a,b)=>natCmp(a.path,b.path));
  const sec=(t,n,body)=> n ? `<h3 style="margin:14px 0 6px">${t} <span class="muted">(${n})</span></h3>${body}` : '';
  v.innerHTML = `<div class="pad"><div class="muted">Hledání: <b>${esc(q)}</b></div>
    ${sec('Charty', charts.length, `<div class="tablewrap"><table class="t">${charts.slice(0,200).map(c=>`<tr><td>${c.isSfc?GI.sfc:GI.cfc} ${cl(c.path)}</td><td class="muted">${esc(c.folder)}</td><td>${c.blocks.size} bloků</td></tr>`).join('')}</table></div>`)}
    ${sec('Bloky', blocks.length, `<div class="tablewrap"><table class="t"><tr><th>Blok</th><th>Typ</th><th>Chart</th><th>Komentář</th></tr>${blocks.slice(0,800).map(b=>`<tr><td>${GI.blk(catOf(b))} ${bl(b.id)}</td><td>${esc(b.type)}</td><td>${b.chart?cl(b.chart):''}</td><td class="muted">${esc(b.comment)}</td></tr>`).join('')}</table></div>${blocks.length>800?'<div class="muted">… prvních 800</div>':''}`)}
    ${sec('Piny', pins.length, `<div class="tablewrap"><table class="t"><tr><th>Blok.pin</th><th>Typ</th><th>Napojení</th></tr>${pins.slice(0,800).map(([b,p])=>`<tr><td>${pinRef(b.id,p.name)}</td><td>${esc(b.type)}</td><td>${p.edges.map(e=> e.a===b.id ? '→ '+pinRef(e.b,e.bp,b.chart) : '← '+pinRef(e.a,e.ap,b.chart)).join('<br>')} ${p.addrs.map(a=>al(a.addr)).join(' ')}${pinUsed(p)?'':'<span class="pill err">nenapojeno</span>'}</td></tr>`).join('')}</table></div>`)}
    ${sec('Adresy', addrs.length, `<div class="tablewrap"><table class="t">${addrs.slice(0,300).map(a=>`<tr><td>${al(a.addr)}</td><td>${esc(a.sym)}</td><td>${a.refs.map(r=>pinRef(r.block,r.pin)+' '+esc(r.rw)).join('<br>')}</td></tr>`).join('')}</table></div>`)}
    ${!(blocks.length+charts.length+addrs.length+pins.length)?'<div class="empty">Nic nenalezeno.</div>':''}</div>`;
}

/* ================= wiring ================= */
function init(){
  $('#fileInput').onchange=e=>{ loadFiles([...e.target.files]); e.target.value=''; };
  const mask=$('#dragmask'); let dc=0;
  window.addEventListener('dragenter',e=>{ if([...e.dataTransfer.types].includes('Files')){ dc++; mask.classList.add('on'); } });
  window.addEventListener('dragleave',()=>{ dc=Math.max(0,dc-1); if(!dc) mask.classList.remove('on'); });
  window.addEventListener('dragover',e=>e.preventDefault());
  window.addEventListener('drop',e=>{ e.preventDefault(); dc=0; mask.classList.remove('on'); if (e.dataTransfer.files.length) loadFiles([...e.dataTransfer.files]); });
  $('#back').onclick=goBack; $('#fwd').onclick=goFwd;
  window.addEventListener('keydown',e=>{ if(e.altKey&&e.key==='ArrowLeft') goBack(); if(e.altKey&&e.key==='ArrowRight') goFwd(); if(e.key==='/' && document.activeElement.tagName!=='INPUT'){ e.preventDefault(); $('#gsearch').focus(); } });
  $('#gsearch').addEventListener('keydown',e=>{ if(e.key==='Enter' && M) go({view:'search', q:e.target.value}); });
  let sft; $('#sfilter').oninput=e=>{ clearTimeout(sft); sft=setTimeout(()=>{ SIDE.filter=e.target.value; renderSide(); },200); };
  $('#theme').onclick=()=>{ const r=document.documentElement; const cur=r.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'); r.dataset.theme = cur==='dark'?'light':'dark'; try{localStorage.setItem('pcs7x-theme', r.dataset.theme);}catch(e){} renderView(); };
  try{ const t=localStorage.getItem('pcs7x-theme'); if(t) document.documentElement.dataset.theme=t; }catch(e){}
  // sidebar resize
  const sp=$('#split'); sp.onmousedown=e=>{ e.preventDefault(); const mv=ev=>{ document.body.style.setProperty('--sbw', Math.max(200,Math.min(700,ev.clientX))+'px'); $('#body').style.setProperty('--sbw', Math.max(200,Math.min(700,ev.clientX))+'px'); }; const up=()=>{ window.removeEventListener('mousemove',mv); window.removeEventListener('mouseup',up); }; window.addEventListener('mousemove',mv); window.addEventListener('mouseup',up); };
  document.addEventListener('click',e=>{
    const tab=e.target.closest('[data-tab]'); if (tab){ const k=tab.dataset.tab; go(LAST[k] && k!=='files' ? LAST[k] : {view:k}); return; }
    const st=e.target.closest('[data-stab]'); if (st){ SIDE.tab=st.dataset.stab; renderSide(); return; }
    const tog=e.target.closest('[data-tog]');
    if (tog && (tog.classList.contains('tw') || !tog.dataset.tn)){ const k=tog.dataset.tog; SIDE.open.has(k)?SIDE.open.delete(k):SIDE.open.add(k); renderSide(); return; }
    const tn=e.target.closest('.tn[data-tn]');
    if (tn){ const id=tn.dataset.id, t=tn.dataset.tn;
      if (t==='folder') go({view:'chart', id, folder:true});
      else if (t==='chart'){ if (M.blocks.get(id)?.kind==='sfc' && M.charts.get(id)?.blocks.size===0) go({view:'sfc', id, inst:true}); else go({view:'chart', id}); }
      else if (t==='block') go({view:'block', id});
      else if (t==='sfctype') go({view:'sfc', id});
      else if (t==='sfci') go({view:'sfc', id, inst:true});
      else if (t==='ob') go({view:'run', id});
      else if (t==='hw') go({view:'hw', id});
      return; }
    const g=e.target.closest('[data-go]');
    if (g){ e.preventDefault(); const id=g.dataset.id, t=g.dataset.go;
      if (t==='block') go({view:'block', id});
      else if (t==='chart') go({view:'chart', id, focus:g.dataset.focus});
      else if (t==='folder') go({view:'chart', id, folder:true});
      else if (t==='addr') go({view:'addr', q:id, opt:null});
      else if (t==='neigh') go({view:'neigh', id});
      else if (t==='hw') go({view:'hw', id});
      else if (t==='sfctype') go({view:'sfc', id});
      else if (t==='sfci') go({view:'sfc', id, inst:true});
    }
  });
  renderChips(); renderSide(); go({view:'files'});
}
document.addEventListener('DOMContentLoaded', init);
