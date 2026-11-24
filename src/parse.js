'use strict';
/* ================= Parsing PCS7 "Display Chart Reference Data" CSV exports ================= */

const FILE_KINDS = {
  bt: {name:'Block types', ico:'bt', pcs7:'Block types',
       gives:'Seznam všech bloků v CFC: typ, FB/FC, komentář. Základ hierarchie (i nenapojené bloky).'},
  ic: {name:'Block interconnections', ico:'ic', pcs7:'Block interconnections',
       gives:'Propojení blok.výstup → blok.vstup (i mezi CFC). Nutné pro grafy a kontrolu napojení.'},
  cr: {name:'Cross-References Chart Element → Address', ico:'cr', pcs7:'Cross-References Chart Element -> Address',
       gives:'Adresy I/Q/M/DB a symboly napojené na piny bloků.'},
  sx: {name:'Cross-References SFC → Chart Element', ico:'sx', pcs7:'Cross-References SFC -> Chart Element',
       gives:'Které piny CFC bloků čte/zapisuje SFC (kroky, tranzice).'},
  ac: {name:'Accesses in SFC types', ico:'ac', pcs7:'Accesses in SFC types',
       gives:'Které I/O SFC typu se používají uvnitř sekvence (kroky, tranzice, timery).'},
  rs: {name:'Run sequence', ico:'rs', pcs7:'Run sequence',
       gives:'Ve kterém OB / runtime skupině a v jakém pořadí blok běží.'},
  hw: {name:'HW Config', ico:'hw', pcs7:'HW Config – Station → Export (.cfg)',
       gives:'Stanice, RIO a karty s kanály. Spolu s Chart Element → Address ukáže rezervy a nepoužité kanály. Lze nahrát víc stanic.'},
};

function decodeBuffer(buf){
  const u8 = new Uint8Array(buf);
  if (u8[0]===0xFF && u8[1]===0xFE) return new TextDecoder('utf-16le').decode(u8);
  if (u8[0]===0xFE && u8[1]===0xFF) return new TextDecoder('utf-16be').decode(u8);
  try { return new TextDecoder('utf-8',{fatal:true}).decode(u8).replace(/^﻿/,''); }
  catch(e){ return new TextDecoder('windows-1250').decode(u8); }
}

/* Lenient ;-separated CSV parser. PCS7 does not escape quotes inside quoted fields
   (e.g. ""Run" operating state"), so a quote only closes a field if it is followed by ; or EOL. */
function parseCSV(text){
  const rows=[]; let row=[]; let i=0; const n=text.length;
  const isEnd = c => c===undefined || c===';' || c==='\r' || c==='\n';
  while(i<n){
    if(text[i]==='"'){
      let j=i+1, start=j, s='';
      while(j<n){
        if(text[j]==='"'){
          const nx=text[j+1];
          if(isEnd(nx)){ s+=text.slice(start,j); break; }
          if(nx==='"' && isEnd(text[j+2])){ s+=text.slice(start,j)+'"'; j++; break; }
        }
        j++;
      }
      if(j>=n) s+=text.slice(start,n);
      row.push(s); i=j+1;
    } else {
      let j=i; while(j<n && text[j]!==';' && text[j]!=='\r' && text[j]!=='\n') j++;
      row.push(text.slice(i,j)); i=j;
    }
    if(text[i]===';'){ i++; if(i<n && text[i]!=='\r' && text[i]!=='\n') continue; }
    if(text[i]==='\r') i++;
    if(text[i]==='\n') i++;
    if(!(row.length===1 && row[0]==='')) rows.push(row);
    row=[];
  }
  if(row.length) rows.push(row);
  return rows;
}

function detectKind(text){
  if (typeof PCS7Parser!=='undefined' && PCS7Parser.detect(text.slice(0,200000), '')==='hw') return 'hw';
  const first = text.slice(0, 400).split(/\r?\n/)[0];
  if (/^\s*OB\d+\s*;/.test(first)) return 'rs';
  const h = first.toLowerCase();
  if (h.startsWith('source chart;')) return 'ic';
  if (h.startsWith('block type;') && h.includes('s7 name')) return 'bt';
  if (h.startsWith('sfc type;')) return 'ac';
  if (h.includes('symbol') && h.includes('address') && h.includes('chart element')) return 'cr';
  if (h.includes('sfc') && h.includes('chart element')) return 'sx';
  return null;
}

function headerIndex(hdr, names){
  const low = hdr.map(x=>x.trim().toLowerCase());
  const out={};
  for (const [k,n] of Object.entries(names)){
    const i = low.indexOf(n.toLowerCase());
    out[k] = i;
  }
  return out;
}

/* ---------------- Model ---------------- */
function newModel(){
  return {
    files:{},           // kind -> {fileName, rows}
    blocks:new Map(),   // id -> block
    charts:new Map(),   // path -> chart
    edges:[],
    addrs:new Map(),    // address -> {addr, refs:[]}
    sfcTypes:new Map(), // type -> {name, ios:Map(base->io), fromAccess:bool}
    sfcCharts:new Map(),// path -> {path, rows:[]}
    run:[],             // run sequence entries
    obs:new Map(),      // ob -> {ob, name, count}
    folderRoot:null,
  };
}

const SEP2 = '\\\\'; // the PCS7 "\\" between hierarchy folder and chart

function splitChartPath(p){
  const k = p.indexOf(SEP2);
  if (k<0) return {folder:'', chain:[p]};
  return {folder:p.slice(0,k), chain:p.slice(k+2).split('\\')};
}

function ensureChart(M, path, isSfc){
  let c = M.charts.get(path);
  if (!c){
    const {folder, chain} = splitChartPath(path);
    const parent = chain.length>1 ? folder + SEP2 + chain.slice(0,-1).join('\\') : null;
    c = {path, folder, name:chain[chain.length-1], parent, blocks:new Set(), isSfc:false, top:null};
    M.charts.set(path, c);
    if (parent){ ensureChart(M, parent); const b = ensureBlockById(M, path, parent, c.name); b.kind = 'chart'; if(!b.type) b.type='(CFC chart)'; M.charts.get(parent).blocks.add(path); }
    c.top = parent ? M.charts.get(parent).top : path;
  }
  if (isSfc) c.isSfc = true;
  return c;
}

function ensureBlockById(M, id, chart, name){
  let b = M.blocks.get(id);
  if (!b){
    b = {id, chart, name, type:'', fb:'', comment:'', kind:'block', pins:new Map(), inE:[], outE:[], run:[], inBT:false};
    M.blocks.set(id, b);
  }
  return b;
}

/* chart + element ("Blk.Pin.Sub" or ".PIN" for the chart itself) -> {block, pin} */
function ensureElement(M, chartPath, element, type){
  ensureChart(M, chartPath, type==='(SFC chart)');
  const dot = element.indexOf('.');
  const bname = dot<0 ? element : element.slice(0,dot);
  const pin = dot<0 ? '' : element.slice(dot+1);
  let b;
  if (bname===''){ // the chart itself (SFC chart / chart interface)
    const c = M.charts.get(chartPath);
    b = ensureBlockById(M, chartPath, c.parent, c.name);
    if (type==='(SFC chart)'){ b.kind='sfc'; c.isSfc=true; }
    else if (b.kind==='block') b.kind='chart';
    if (!b.type && type) b.type = type;
  } else {
    const id = chartPath + '\\' + bname;
    if (M.charts.has(id) || type==='(CFC chart)'){ ensureChart(M, id); }
    b = ensureBlockById(M, id, chartPath, bname);
    M.charts.get(chartPath).blocks.add(id);
    if (type && (!b.type || b.type==='(CFC chart)')) b.type = type;
    if (type==='(CFC chart)') b.kind='chart';
    if (type==='(SFC chart)') b.kind='sfc';
  }
  return {b, pin};
}

function ensurePin(b, name, dir, comment){
  let p = b.pins.get(name);
  if (!p){ p = {name, dir:dir||'', comment:'', edges:[], addrs:[], sfc:[]}; b.pins.set(name,p); }
  if (dir && !p.dir) p.dir = dir;
  if (comment && !p.comment) p.comment = comment;
  return p;
}

function loadBT(M, rows){
  const ix = headerIndex(rows[0], {type:'Block type', s7:'S7 name', chart:'Chart', block:'Block', comment:'Block comment'});
  for (let r=1;r<rows.length;r++){
    const x = rows[r]; const chart = x[ix.chart]; const name = x[ix.block];
    if (!chart || name===undefined) continue;
    const type = x[ix.type]||'';
    const {b} = ensureElement(M, chart, name, type);
    b.type = type || b.type; b.fb = x[ix.s7]||b.fb; if (x[ix.comment]) b.comment = x[ix.comment];
    b.inBT = true;
  }
}

function loadIC(M, rows){
  // duplicate header names -> fixed positions
  for (let r=1;r<rows.length;r++){
    const x = rows[r]; if (x.length<8) continue;
    const s = ensureElement(M, x[0], x[1], x[3]);
    const d = ensureElement(M, x[4], x[5], x[7]);
    const sp = ensurePin(s.b, s.pin, 'out', x[2]);
    const dp = ensurePin(d.b, d.pin, 'in', x[6]);
    const e = {a:s.b.id, ap:s.pin, b:d.b.id, bp:d.pin, dead:(x[8]||'').trim()!==''};
    M.edges.push(e); s.b.outE.push(e); d.b.inE.push(e); sp.edges.push(e); dp.edges.push(e);
  }
}

function loadCR(M, rows){
  const ix = headerIndex(rows[0], {sym:'Symbol', addr:'Address', dt:'Data type', rw:'R/W', chart:'Chart', el:'Chart element', com:'Element comment', type:'Type'});
  for (let r=1;r<rows.length;r++){
    const x = rows[r]; const addr = (x[ix.addr]||'').trim(); if (!addr || !x[ix.chart]) continue;
    const rw = (x[ix.rw]||'').trim();
    const {b,pin} = ensureElement(M, x[ix.chart], x[ix.el]||'', x[ix.type]);
    const sym = (x[ix.sym]||'').trim();
    const ref = {addr, sym: sym==='---'?'':sym, dt:x[ix.dt]||'', rw, block:b.id, pin, comment:x[ix.com]||''};
    const p = ensurePin(b, pin, rw.includes('W')&&!rw.includes('R') ? 'out' : 'in', ref.comment);
    p.addrs.push(ref);
    let a = M.addrs.get(addr); if (!a){ a={addr, refs:[], sym:'', dt:ref.dt}; M.addrs.set(addr,a); }
    if (ref.sym && !a.sym) a.sym = ref.sym;
    a.refs.push(ref);
  }
}

function sfcTypeEntry(M, name){
  let t = M.sfcTypes.get(name);
  if (!t){ t = {name, ios:new Map(), fromAccess:false}; M.sfcTypes.set(name,t); }
  return t;
}
function sfcIO(t, ioName){
  const base = ioName.split('.')[0];
  let io = t.ios.get(base);
  if (!io){ io = {name:ioName, base, section:'', assign:'', charact:'', rw:'', uses:[]}; t.ios.set(base, io); }
  return io;
}

function loadAC(M, rows){
  const ix = headerIndex(rows[0], {type:'SFC type', io:'I/O name', sec:'Section', as:'Assignment', ch:'Characteristic', rw:'R/W', seq:'Sequencer', ad:'Address', ty:'Type', val:'Value'});
  for (let r=1;r<rows.length;r++){
    const x = rows[r]; if (!x[ix.type]) continue;
    const t = sfcTypeEntry(M, x[ix.type]); t.fromAccess = true;
    const io = sfcIO(t, x[ix.io]||'');
    io.name = x[ix.io]; io.section = x[ix.sec]||io.section; io.assign = x[ix.as]||io.assign; io.charact = x[ix.ch]||io.charact;
    const rw = x[ix.rw]||''; if (!io.rw.includes(rw)) io.rw += rw;
    io.uses.push({seq:x[ix.seq]||'', addr:x[ix.ad]||'', kind:x[ix.ty]||'', rw, val:x[ix.val]||''});
  }
}

function loadSX(M, rows){
  const ix = headerIndex(rows[0], {chart:'Chart', el:'Chart element', bt:'Block type', rw:'R/W', sfc:'SFC', ad:'Address', ty:'Type'});
  for (let r=1;r<rows.length;r++){
    const x = rows[r]; if (!x[ix.chart]) continue;
    const sfcFull = x[ix.sfc]||''; const li = sfcFull.lastIndexOf('\\');
    const sfcId = li>0 ? sfcFull.slice(0,li) : sfcFull; const seq = li>0 ? sfcFull.slice(li+1) : '';
    const rw = x[ix.rw]||''; const btype = x[ix.bt]||'';
    const use = {seq, addr:x[ix.ad]||'', kind:x[ix.ty]||'', rw};
    if (!sfcId.includes(SEP2) && sfcId===btype){
      // SFC type instance accessing its own interface -> fallback for "Accesses in SFC types"
      const {b,pin} = ensureElement(M, x[ix.chart], x[ix.el]||'', btype);
      const t = sfcTypeEntry(M, btype);
      if (!t.fromAccess){
        const io = sfcIO(t, pin);
        if (!io.rw.includes(rw)) io.rw += rw;
        if (!io.section) io.section = rw==='W' ? 'OUT' : 'IN';
        io.uses.push(Object.assign({inst:b.id}, use));
      }
      continue;
    }
    const {b,pin} = ensureElement(M, x[ix.chart], x[ix.el]||'', btype);
    const p = ensurePin(b, pin, rw==='W' ? 'in' : '', '');
    const ref = Object.assign({sfc:sfcId, block:b.id, pin}, use);
    p.sfc.push(ref);
    if (sfcId.includes(SEP2)){
      ensureChart(M, sfcId, true);
      const sb = ensureBlockById(M, sfcId, M.charts.get(sfcId).parent, M.charts.get(sfcId).name); sb.kind='sfc'; if(!sb.type) sb.type='(SFC chart)';
      let sc = M.sfcCharts.get(sfcId); if (!sc){ sc={path:sfcId, rows:[]}; M.sfcCharts.set(sfcId, sc); }
      sc.rows.push(ref);
    } else {
      // another SFC type accessing a foreign block (rare)
      let sc = M.sfcCharts.get(sfcId); if (!sc){ sc={path:sfcId, rows:[], isType:true}; M.sfcCharts.set(sfcId, sc); }
      sc.rows.push(ref);
    }
  }
}

function loadRS(M, text){
  const lines = text.split(/\r?\n/);
  const joined=[];
  for (const l of lines){
    if (/^\s*OB\d+\s*;/.test(l)) joined.push(l);
    else if (joined.length && l.trim()) joined[joined.length-1] += ' ' + l.trim();
  }
  let idx=0;
  for (const l of joined){
    const m = l.match(/^\s*(OB\d+)\s*;(.*)$/); if (!m) continue;
    const ob = m[1]; const parts = m[2].split(';');
    const obName = parts[0].replace(/"/g,'').replace(/\s+/g,' ').trim();
    let o = M.obs.get(ob); if (!o){ o={ob, name:obName, count:0}; M.obs.set(ob,o); }
    let group='', ratio='', path='', type='', comment='';
    if (parts.length===2 && parts[1].includes(SEP2)) { path = parts[1].trim(); }
    else if (parts.length>=5){
      group = parts[1].trim(); ratio = parts[2].replace(/"/g,'').replace(/\s+/g,' ').trim(); path = parts[4].trim();
      const tc = parts.slice(5).join(';').trim().replace(/^"/,'').replace(/"$/,'');
      const bar = tc.indexOf('|');
      type = (bar<0 ? tc : tc.slice(0,bar)).trim(); comment = bar<0 ? '' : tc.slice(bar+1).trim();
    } else continue;
    if (!path.includes(SEP2)) continue;
    const k = path.indexOf(SEP2); const li = path.lastIndexOf('\\');
    let b;
    if (li > k+1){
      const chart = path.slice(0,li), name = path.slice(li+1);
      b = ensureElement(M, chart, name, type).b;
      if (!b.type) b.type = type;
      if (comment && !b.comment) b.comment = comment;
    } else {
      ensureChart(M, path);
      const c = M.charts.get(path);
      b = ensureBlockById(M, path, c.parent, c.name);
      if (b.kind==='block') b.kind = 'sfc';
      c.isSfc = true; if (!b.type) b.type='(SFC chart)';
    }
    const e = {ob, obName, group, ratio, block:b.id, pos:++idx, n:++o.count};
    b.run.push(e); M.run.push(e);
  }
}

function buildFolders(M){
  const root = {name:'Projekt', path:'', folders:new Map(), charts:[], nCharts:0};
  for (const c of M.charts.values()){
    if (c.parent) continue;
    let f = root;
    if (c.folder){
      let acc='';
      for (const seg of c.folder.split('\\')){
        acc = acc ? acc+'\\'+seg : seg;
        let nf = f.folders.get(seg);
        if (!nf){ nf={name:seg, path:acc, folders:new Map(), charts:[], nCharts:0}; f.folders.set(seg,nf); }
        f = nf;
      }
    }
    f.charts.push(c.path);
  }
  const count = f => { let n=f.charts.length; for (const s of f.folders.values()) n+=count(s); f.nCharts=n; f.charts.sort(natCmpChart); return n; };
  count(root);
  M.folderRoot = root;
  M.folderIndex = new Map();
  const idx = f => { M.folderIndex.set(f.path, f); for (const s of f.folders.values()) idx(s); };
  idx(root);
}
function natCmp(a,b){ return a.localeCompare(b, undefined, {numeric:true, sensitivity:'base'}); }
function natCmpChart(a,b){ return natCmp(a,b); }

function buildModel(texts){
  const M = newModel();
  const order = ['bt','ic','cr','ac','sx','rs'];
  for (const k of order){
    const f = texts[k]; if (!f || k==='hw') continue;
    if (k==='rs'){ loadRS(M, f.text); M.files[k] = {fileName:f.fileName, rows:M.run.length}; continue; }
    const rows = parseCSV(f.text);
    ({bt:loadBT, ic:loadIC, cr:loadCR, ac:loadAC, sx:loadSX})[k](M, rows);
    M.files[k] = {fileName:f.fileName, rows:rows.length-1};
  }
  if (texts.hw && texts.hw.length && typeof PCS7Parser!=='undefined'){
    M.hw = {roots: texts.hw.map(f=>PCS7Parser.parseHw(f.text, f.fileName))};
    let mods=0; for (const r of M.hw.roots) hwWalk(r, n=>{ if (n.processData) mods++; });
    M.files.hw = {fileName: texts.hw.map(f=>f.fileName).join(', '), rows: mods, unit:'karet'};
    linkHW(M);
  }
  // SFC instance pin directions from SFC type I/O sections
  for (const b of M.blocks.values()){
    const t = M.sfcTypes.get(b.type);
    if (t){ b.kind = 'sfci';
      for (const io of t.ios.values()){ const p=b.pins.get(io.base); if (p && io.section) p.dir = io.section==='OUT' ? 'out' : 'in'; }
    }
  }
  buildFolders(M);
  return M;
}

if (typeof module!=='undefined') module.exports = {parseCSV, detectKind, buildModel, decodeBuffer, splitChartPath};
