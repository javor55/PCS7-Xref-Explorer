'use strict';
/* ================= Graph layout + SVG renderer with pan/zoom ================= */
const G = {HEAD:34, PIN:15, GAPX:110, GAPY:18};

function textW(s, px){ return (s||'').length * px; }

function measureNode(n){
  const ins=n.ins||[], outs=n.outs||[];
  const rows = Math.max(ins.length, outs.length);
  n.h = n.small ? 26 + rows*G.PIN : G.HEAD + Math.max(rows,0)*G.PIN + (rows?6:4);
  const mi = Math.max(0,...ins.map(p=>textW(p,6.4)));
  const mo = Math.max(0,...outs.map(p=>textW(p,6.4)));
  n.w = Math.min(360, Math.max(110, textW(n.title,7.4)+22, textW(n.sub,5.9)+18, mi+mo+(mi&&mo?34:20)));
}

function layoutGraph(nodes, edges, opt={}){
  const byId = new Map(nodes.map(n=>[n.id,n]));
  nodes.forEach(measureNode);
  const succ=new Map(), pred=new Map();
  nodes.forEach(n=>{succ.set(n.id,new Set()); pred.set(n.id,new Set());});
  for (const e of edges){ if (e.from===e.to || !byId.has(e.from) || !byId.has(e.to)) continue; succ.get(e.from).add(e.to); pred.get(e.to).add(e.from); }
  // isolated nodes handled separately
  const conn = nodes.filter(n=>succ.get(n.id).size||pred.get(n.id).size);
  const iso = nodes.filter(n=>!(succ.get(n.id).size||pred.get(n.id).size));
  // break cycles (iterative DFS), ordered by preferred order
  const order = opt.order || new Map();
  const ord = n => order.has(n.id) ? order.get(n.id) : 1e9;
  const sorted = conn.slice().sort((a,b)=>ord(a)-ord(b) || natCmp(a.title,b.title));
  const state=new Map(); const back=new Set();
  for (const s of sorted){
    if (state.get(s.id)) continue;
    const stack=[[s.id, [...succ.get(s.id)]]]; state.set(s.id,1);
    while(stack.length){
      const top=stack[stack.length-1];
      if (!top[1].length){ state.set(top[0],2); stack.pop(); continue; }
      const nx = top[1].shift();
      const st = state.get(nx);
      if (st===1){ back.add(top[0]+'\u0000'+nx); continue; }
      if (!st){ state.set(nx,1); stack.push([nx,[...succ.get(nx)]]); }
    }
  }
  const S=new Map(), P=new Map();
  conn.forEach(n=>{S.set(n.id,[]);P.set(n.id,[]);});
  for (const [a,set] of succ) for (const b of set){ if (back.has(a+'\u0000'+b)) continue; if(S.has(a)){S.get(a).push(b);P.get(b).push(a);} }
  // longest path ranks (Kahn)
  const indeg=new Map(conn.map(n=>[n.id,P.get(n.id).length]));
  const q=conn.filter(n=>!indeg.get(n.id)).map(n=>n.id); const topo=[];
  const rank=new Map(conn.map(n=>[n.id,0]));
  while(q.length){ const a=q.shift(); topo.push(a); for (const b of S.get(a)){ rank.set(b, Math.max(rank.get(b), rank.get(a)+1)); indeg.set(b, indeg.get(b)-1); if(!indeg.get(b)) q.push(b);} }
  // pull sources right (next to their first successor)
  for (let i=topo.length-1;i>=0;i--){ const a=topo[i]; const s=S.get(a); if (!P.get(a).length && s.length){ rank.set(a, Math.min(...s.map(b=>rank.get(b)))-1); } }
  // fixed side placement
  let minR=Infinity,maxR=-Infinity; for (const r of rank.values()){minR=Math.min(minR,r);maxR=Math.max(maxR,r);}
  for (const n of conn){ if (n.side==='L') rank.set(n.id, Math.min(rank.get(n.id), minR)); if (n.side==='R') rank.set(n.id, Math.max(rank.get(n.id), maxR)); }
  for (const n of conn){ if (n.side==='L'){ const s=S.get(n.id); if(s.length) rank.set(n.id, Math.min(...s.map(b=>rank.get(b)))-1);} }
  minR=Infinity; for (const r of rank.values()) minR=Math.min(minR,r);
  const layers=[];
  for (const n of conn){ const r=rank.get(n.id)-minR; n.rank=r; (layers[r]=layers[r]||[]).push(n); }
  for (let i=0;i<layers.length;i++) layers[i]=layers[i]||[];
  layers.forEach(L=>L.sort((a,b)=>ord(a)-ord(b) || natCmp(a.title,b.title)));
  /* ---- dummy nodes: long edges get a lane in every intermediate column (edges from one pin share it) ---- */
  const dmap=new Map(); const segs=[];  // segment: {u,up,v,vp}
  const addSeg=(u,up,v,vp)=>{ const sg={u,up,v,vp}; segs.push(sg); (u._dn||(u._dn=[])).push(sg); (v._up||(v._up=[])).push(sg); };
  conn.forEach(n=>{ n._dn=[]; n._up=[]; });
  for (const e of edges){
    e._chain=null; e._back=false;
    const A=byId.get(e.from), B=byId.get(e.to); if(!A||!B||A.rank==null||B.rank==null) continue;
    if (B.rank<=A.rank){
      // feedback: lanes from A's column back to B's column, traversed right-to-left
      e._back=true; const chain=[]; let prev=null;
      for (let r=A.rank; r>=B.rank; r--){
        const key='b\u0000'+e.from+'\u0000'+(e.fp??'')+'\u0000'+e.to+'\u0000'+r;
        let d=dmap.get(key);
        if (!d){ d={id:'\u00a7'+key, dummy:true, back:true, w:0, h:4, rank:r, _dn:[], _up:[], _anc:[], _o:ord(A)}; dmap.set(key,d); layers[r].push(d);
          if (r===A.rank) d._anc.push({n:A, p:e.fp, out:true});
          if (r===B.rank) d._anc.push({n:B, p:e.tp, out:false});
          if (prev) addSeg(d, null, prev, null); }
        chain.push(d); prev=d;
      }
      e._chain=chain; continue;
    }
    let prev=A, prevPin=e.fp; const chain=[];
    for (let r=A.rank+1; r<B.rank; r++){
      const key=e.from+'\u0000'+(e.fp??'')+'\u0000'+r;
      let d=dmap.get(key);
      if (!d){ d={id:'§'+key, dummy:true, w:0, h:4, rank:r, _dn:[], _up:[], _o:ord(A)}; dmap.set(key,d); layers[r].push(d); addSeg(prev, prevPin, d, null); }
      chain.push(d); prev=d; prevPin=null;
    }
    e._chain=chain;
    if (!prev._dn.some(sg=>sg.v===B && sg.vp===e.tp && sg.up===prevPin)) addSeg(prev, prevPin, B, e.tp);
  }
  const ordX = n => n.dummy ? n._o : ord(n);
  layers.forEach(L=>L.sort((a,b)=>ordX(a)-ordX(b)));
  // crossing reduction: barycenter sweeps on adjacent layers
  const pos=new Map(); const setPos=L=>L.forEach((n,i)=>pos.set(n,i));
  layers.forEach(setPos);
  for (let it=0; it<12; it++){
    const down = it%2===0;
    const seq = down ? layers.slice(1) : layers.slice(0,-1).reverse();
    for (const L of seq){
      for (const n of L){ const nb = down ? n._up.map(sg=>sg.u) : n._dn.map(sg=>sg.v); n._bc = nb.length ? nb.reduce((s,x)=>s+pos.get(x),0)/nb.length : pos.get(n); }
      for (const n of L) if (n._anc && n._anc.length){ const a=n._anc[0]; n._bc = a.n._bc + (a.out ? 0.3 : -0.3); }
      L.sort((a,b)=>a._bc-b._bc || pos.get(a)-pos.get(b)); setPos(L);
    }
  }
  // x
  let x=0; const colX=[], colW=[];
  for (const L of layers){ colX.push(x); const w=Math.max(40,...L.filter(n=>!n.dummy).map(n=>n.w)); colW.push(w); L.forEach(n=>n.colW=w); x += w + G.GAPX; }
  layers.forEach((L,i)=>L.forEach(n=>{ if (n.dummy){ n.x=colX[i]; n.w=colW[i]; } else n.x = colX[i] + (n.side==='L' ? n.colW-n.w : 0); n.cx0=colX[i]; n.cx1=colX[i]+colW[i]; }));
  // y
  const gap=(a,b)=> (a.dummy||b.dummy) ? 8 : G.GAPY;
  layers.forEach(L=>{ let y=0; L.forEach((n,i)=>{ n.y=y; y+=n.h+(i<L.length-1?gap(n,L[i+1]):0); }); });
  const pinY = (n, pin, isOut) => { if (n.dummy) return n.y+n.h/2; const list = isOut ? n.outs : n.ins; const i = pin==null ? -1 : (list||[]).indexOf(pin); return i<0 ? n.y + n.h/2 : n.y + (n.small?26:G.HEAD) + i*G.PIN + G.PIN/2; };
  const relax = (L, want) => {
    // isotonic regression (PAV): keep order, no overlap, minimise distance to desired y
    let off=0; const items=L.map((n,i)=>{ const d=want(n); const it={n, off, z:(d==null?n.y:d)-off, w:d==null?0.05:(n.dummy?0.6:1)}; off+=n.h+(i<L.length-1?gap(n,L[i+1]):0); return it; });
    const blocks=[];
    for (const it of items){
      blocks.push({sum:it.z*it.w, w:it.w, cnt:1});
      while(blocks.length>1){ const B=blocks[blocks.length-1], A=blocks[blocks.length-2]; if (A.sum/A.w <= B.sum/B.w) break; A.sum+=B.sum; A.w+=B.w; A.cnt+=B.cnt; blocks.pop(); }
    }
    let k=0; for (const B of blocks){ const z=B.sum/B.w; for (let j=0;j<B.cnt;j++,k++){ items[k].n.y = z + items[k].off; } }
  };
  const anc = n => n._anc.reduce((s,a)=>s+pinY(a.n,a.p,a.out),0)/n._anc.length - n.h/2;
  const wantUp = n => { if (n._anc && n._anc.length) return anc(n); if (!n._up.length) return null; return n._up.reduce((s,sg)=>s+pinY(sg.u,sg.up,true)-(pinY(n,sg.vp,false)-n.y),0)/n._up.length; };
  const wantDn = n => { if (n._anc && n._anc.length) return anc(n); if (!n._dn.length) return null; return n._dn.reduce((s,sg)=>s+pinY(sg.v,sg.vp,false)-(pinY(n,sg.up,true)-n.y),0)/n._dn.length; };
  const wantBoth = n => { const a=wantUp(n), b=wantDn(n); return a==null ? b : b==null ? a : (a+b)/2; };
  for (let it=0; it<6; it++){
    for (let i=1;i<layers.length;i++) relax(layers[i], it<4 ? wantUp : wantBoth);
    for (let i=layers.length-2;i>=0;i--) relax(layers[i], it<4 ? wantDn : wantBoth);
  }
  const allItems = conn.concat([...dmap.values()]);
  // edge geometry
  for (const e of edges){
    const A=byId.get(e.from), B=byId.get(e.to); if (!A||!B||!e._chain||(!e._chain.length&&!e._back)) { e._pts=null; continue; }
    e._pts = e._chain.map(d=>[d.x, d.x+d.w, d.y+d.h/2]);
  }
  let minY=Infinity; allItems.forEach(n=>minY=Math.min(minY,n.y)); if(!isFinite(minY)) minY=0;
  allItems.forEach(n=>n.y-=minY);
  for (const e of edges) if (e._pts) e._pts.forEach(p=>p[2]-=minY);
  let maxY=0, maxX=0; conn.forEach(n=>{maxY=Math.max(maxY,n.y+n.h); maxX=Math.max(maxX,n.x+n.w);});
  // isolated nodes: grid below
  if (iso.length){
    iso.sort((a,b)=>ord(a)-ord(b)||natCmp(a.title,b.title));
    const W = Math.max(maxX, 1100); let cx=0, cy=maxY+(conn.length?60:0), rowH=0;
    for (const n of iso){ if (cx>0 && cx+n.w>W){ cx=0; cy+=rowH+G.GAPY; rowH=0; } n.x=cx; n.y=cy; cx+=n.w+30; rowH=Math.max(rowH,n.h); }
    if (conn.length) opt.isoTop = maxY+30;
  }
  return {nodes, edges, byId, pinY, isoTop:opt.isoTop};
}

const SVGNS='http://www.w3.org/2000/svg';
const CATCOL = {tech:'var(--c-tech)', drv:'var(--c-drv)', logic:'var(--c-logic)', sfc:'var(--c-sfc)', sfci:'var(--c-sfc)', chart:'var(--c-chart)', addr:'var(--c-addr)', ext:'var(--c-ext)'};

function renderGraph(host, L, opt={}){
  host.innerHTML='';
  host.classList.add('gwrap');
  const svg=document.createElementNS(SVGNS,'svg');
  const g=document.createElementNS(SVGNS,'g');
  svg.appendChild(g); host.appendChild(svg);
  const parts=[];
  if (L.isoTop!=null) parts.push(`<text x="0" y="${L.isoTop-8}" class="etext">Bez propojení v tomto pohledu:</text>`);
  // edges
  L.edges.forEach((e,i)=>{
    const a=L.byId.get(e.from), b=L.byId.get(e.to); if(!a||!b) return;
    const x1=a.x+a.w, y1=L.pinY(a,e.fp,true), x2=b.x, y2=L.pinY(b,e.tp,false);
    let d;
    const cv=(xa,ya,xb,yb)=>{ const dx=Math.max(20,(xb-xa)/2); return ` C${xa+dx},${ya} ${xb-dx},${yb} ${xb},${yb}`; };
    // leave/enter the column horizontally so curves only bend inside the gaps between columns
    const xs = (a.cx1!=null && a.cx1>x1) ? a.cx1 : x1, xe = (b.cx0!=null && b.cx0<x2) ? b.cx0 : x2;
    const head = `M${x1},${y1}` + (xs>x1 ? ` L${xs},${y1}` : ''), tail = xe<x2 ? ` L${x2},${y2}` : '';
    if (e._pts && e._back){
      d=`M${x1},${y1}`; let cx=x1, cy=y1, first=true;
      for (const [xl,xr,yy] of e._pts){
        if (first){ const tx=Math.max(x1,xr)+Math.min(50,G.GAPX/2-5); d+=` C${tx},${y1} ${tx},${yy} ${xr},${yy}`; first=false; }
        else { const dx=Math.max(20,(cx-xr)/2); d+=` C${cx-dx},${cy} ${xr+dx},${yy} ${xr},${yy}`; }
        d+=` L${xl},${yy}`; cx=xl; cy=yy;
      }
      const tx=Math.min(cx,xe)-Math.min(50,G.GAPX/2-5); d+=` C${tx},${cy} ${tx},${y2} ${xe},${y2}`+tail;
    }
    else if (e._pts){ d=head; let cx=xs, cy=y1; for (const [xa,xb,yy] of e._pts){ d+=cv(cx,cy,xa,yy)+` L${xb},${yy}`; cx=xb; cy=yy; } d+=cv(cx,cy,xe,y2)+tail; }
    else if (a===b){ const t=a.y-9, r=x1+22, l=x2-22; d=`M${x1},${y1} C${r},${y1} ${r},${t} ${x1-10},${t} L${x2+10},${t} C${l},${t} ${l},${y2} ${x2},${y2}`; }
    else if (xe > xs+10){ d=head+cv(xs,y1,xe,y2)+tail; }
    else { const off=60+Math.min(200,Math.abs(y2-y1)/4); d=`M${x1},${y1} C${x1+off},${y1} ${x2-off},${y2} ${x2},${y2}`; }
    parts.push(`<path class="edge ${e.cls||''}${e.dead?' dead':''}" d="${d}" data-i="${i}"><title>${esc(e.tip||'')}</title></path>`);
    if (e.label) parts.push(`<text class="etext" x="${(x1+x2)/2}" y="${(y1+y2)/2-3}" text-anchor="middle">${esc(e.label)}</text>`);
  });
  // nodes
  L.nodes.forEach((n,i)=>{
    const col = n.color || CATCOL[n.cat] || CATCOL.tech;
    const cls = ['node', n.cls||'', n.focus?'focus':''].join(' ');
    let s = `<g class="${cls}" data-n="${i}" transform="translate(${n.x},${n.y})"><title>${esc(n.tip||n.title)}</title>`;
    s += `<rect class="b" width="${n.w}" height="${n.h}" rx="5"/>`;
    s += `<rect class="h" width="${n.w}" height="${n.small?22:30}" rx="5" fill="${col}" opacity=".16"/><rect class="h" width="4" height="${n.h}" rx="2" fill="${col}"/>`;
    s += `<text class="t" x="10" y="15">${esc(clip(n.title, Math.floor((n.w-16)/7.2)))}</text>`;
    if (!n.small || n.sub) s += `<text class="s" x="10" y="${n.small?20:27}">${esc(clip(n.sub||'', Math.floor((n.w-14)/5.9)))}</text>`;
    const top = n.small ? 26 : G.HEAD;
    (n.ins||[]).forEach((p,k)=>{ const y=top+k*G.PIN+G.PIN/2; s+=`<line class="pl" x1="-6" y1="${y}" x2="0" y2="${y}"/><text class="p" x="7" y="${y+3.5}">${esc(p)}</text>`; });
    (n.outs||[]).forEach((p,k)=>{ const y=top+k*G.PIN+G.PIN/2; s+=`<line class="pl" x1="${n.w}" y1="${y}" x2="${n.w+6}" y2="${y}"/><text class="p" x="${n.w-7}" y="${y+3.5}" text-anchor="end">${esc(p)}</text>`; });
    s += '</g>';
    parts.push(s);
  });
  g.innerHTML = parts.join('');
  // index
  const edgeEls=[...g.querySelectorAll('path.edge')];
  const nodeEls=[...g.querySelectorAll('g.node')];
  const nodeIdx=new Map(L.nodes.map((n,i)=>[n.id,i]));
  const adj=L.nodes.map(()=>[]);
  edgeEls.forEach(el=>{ const e=L.edges[+el.dataset.i]; const a=nodeIdx.get(e.from), b=nodeIdx.get(e.to); if(a!=null) adj[a].push([el,b]); if(b!=null) adj[b].push([el,a]); });
  let pinned=null;
  const hilite=(i)=>{
    g.querySelectorAll('.hi,.dim').forEach(x=>x.classList.remove('hi','dim'));
    if (i==null) return;
    edgeEls.forEach(e=>e.classList.add('dim'));
    nodeEls.forEach(e=>e.classList.add('dim'));
    nodeEls[i].classList.remove('dim');
    for (const [el,o] of adj[i]){ el.classList.remove('dim'); el.classList.add('hi'); if(o!=null){ nodeEls[o].classList.remove('dim'); nodeEls[o].classList.add('hi'); } }
  };
  nodeEls.forEach((el,i)=>{
    el.addEventListener('mouseenter',()=>{ if(pinned==null) hilite(i); });
    el.addEventListener('mouseleave',()=>{ if(pinned==null) hilite(null); });
    el.addEventListener('click',ev=>{ ev.stopPropagation(); if (moved) return; pinned = pinned===i ? null : i; hilite(pinned); if (opt.onClick) opt.onClick(L.nodes[i], ev); });
    el.addEventListener('dblclick',ev=>{ ev.stopPropagation(); if (opt.onDbl) opt.onDbl(L.nodes[i], ev); });
  });
  // pan/zoom
  let tx=0, ty=0, sc=1, moved=false;
  const apply=()=>g.setAttribute('transform',`translate(${tx},${ty}) scale(${sc})`);
  const bbox=()=>{ let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; L.nodes.forEach(n=>{x0=Math.min(x0,n.x-10);y0=Math.min(y0,n.y-10);x1=Math.max(x1,n.x+n.w+10);y1=Math.max(y1,n.y+n.h+10);}); if(L.isoTop!=null) y0=Math.min(y0,L.isoTop-25); return {x0,y0,x1,y1}; };
  const fit=(maxScale=1)=>{ const r=host.getBoundingClientRect(); const b=bbox(); if(!isFinite(b.x0)) return; sc=Math.min(maxScale,(r.width-40)/(b.x1-b.x0),(r.height-40)/(b.y1-b.y0)); sc=Math.max(sc,0.05); tx=(r.width-(b.x1-b.x0)*sc)/2-b.x0*sc; ty=Math.max(20,(r.height-(b.y1-b.y0)*sc)/2)-b.y0*sc; apply(); };
  const focusNode=(id)=>{ const i=nodeIdx.get(id); if(i==null) return; const n=L.nodes[i]; const r=host.getBoundingClientRect(); sc=Math.max(sc,0.6); const fitsH=n.h*sc < r.height-40; tx=r.width/2-(n.x+n.w/2)*sc; ty= fitsH ? r.height/2-(n.y+n.h/2)*sc : 20-n.y*sc; apply(); };
  svg.addEventListener('wheel',ev=>{ ev.preventDefault(); const r=svg.getBoundingClientRect(); const mx=ev.clientX-r.left, my=ev.clientY-r.top; const f=Math.exp(-ev.deltaY*0.0015); const ns=Math.min(4,Math.max(0.03,sc*f)); tx=mx-(mx-tx)*ns/sc; ty=my-(my-ty)*ns/sc; sc=ns; apply(); },{passive:false});
  let drag=null;
  svg.addEventListener('mousedown',ev=>{ if(ev.button!==0) return; drag={x:ev.clientX,y:ev.clientY,tx,ty}; moved=false; svg.classList.add('drag'); });
  window.addEventListener('mousemove',ev=>{ if(!drag) return; const dx=ev.clientX-drag.x, dy=ev.clientY-drag.y; if(Math.abs(dx)+Math.abs(dy)>3) moved=true; tx=drag.tx+dx; ty=drag.ty+dy; apply(); });
  window.addEventListener('mouseup',()=>{ if(drag){ drag=null; svg.classList.remove('drag'); setTimeout(()=>moved=false,0);} });
  svg.addEventListener('click',()=>{ if(!moved){ pinned=null; hilite(null);} });
  const ctl=document.createElement('div'); ctl.className='gctl';
  ctl.innerHTML='<button title="Přiblížit">+</button><button title="Oddálit">−</button><button title="Celý graf">⤢</button><button title="Uložit jako SVG">⇩</button>';
  const [bi,bo,bf,bs]=ctl.children;
  const zoomBy=f=>{ const r=host.getBoundingClientRect(); const mx=r.width/2,my=r.height/2; const ns=Math.min(4,Math.max(0.03,sc*f)); tx=mx-(mx-tx)*ns/sc; ty=my-(my-ty)*ns/sc; sc=ns; apply(); };
  bi.onclick=()=>zoomBy(1.25); bo.onclick=()=>zoomBy(0.8); bf.onclick=()=>fit(1.5);
  bs.onclick=()=>exportSVG(L, opt.fileName||'graf');
  host.appendChild(ctl);
  if (opt.hint){ const h=document.createElement('div'); h.className='ghint'; h.textContent=opt.hint; host.appendChild(h); }
  const initView=()=>{ fit(1); if (sc<0.5){ if (opt.focus && nodeIdx.has(opt.focus)) { sc=0.75; focusNode(opt.focus); } else { let hub=-1, best=-1; adj.forEach((l,i)=>{ if(l.length>best){best=l.length;hub=i;} }); sc=0.6; if (hub>=0) focusNode(L.nodes[hub].id); else { const b=bbox(); tx=20-b.x0*sc; ty=20-b.y0*sc; apply(); } } } };
  requestAnimationFrame(initView);
  return {fit, focusNode, hilite: id=>{ const i=nodeIdx.get(id); pinned=i; hilite(i); }};
}

function exportSVG(L, name){
  const host=document.querySelector('.gwrap svg g'); if(!host) return;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity; L.nodes.forEach(n=>{x0=Math.min(x0,n.x-10);y0=Math.min(y0,n.y-10);x1=Math.max(x1,n.x+n.w+10);y1=Math.max(y1,n.y+n.h+10);});
  const cs=getComputedStyle(document.documentElement);
  const vars=['--edge','--edge-hi','--line','--node','--text','--muted','--panel2','--c-tech','--c-drv','--c-logic','--c-sfc','--c-chart','--c-addr','--c-ext','--accent'];
  let css=':root{'+vars.map(v=>v+':'+cs.getPropertyValue(v)).join(';')+'}';
  css+=`.edge{fill:none;stroke:var(--edge);stroke-width:1.2}.edge.dead{stroke-dasharray:5 3}.edge.sfc{stroke:var(--c-sfc);stroke-dasharray:2 3}.edge.addr{stroke:var(--c-addr)}
  .node rect.b{fill:var(--node);stroke:var(--line)}.node text{fill:var(--text);font:11px Segoe UI,Arial,sans-serif}.node text.t{font-weight:600;font-size:12px}.node text.s{fill:var(--muted);font-size:10px}.node text.p{font:10.5px Consolas,monospace}.node line.pl{stroke:var(--muted)}.node.focus rect.b{stroke:var(--accent);stroke-width:2.5}.node.ext rect.b{stroke-dasharray:4 3;fill:var(--panel2)}.etext{fill:var(--muted);font:10px Arial}`;
  const clone=host.cloneNode(true); clone.removeAttribute('transform'); clone.querySelectorAll('.hi,.dim').forEach(x=>x.classList.remove('hi','dim'));
  const svg=`<svg xmlns="${SVGNS}" viewBox="${x0} ${y0} ${x1-x0} ${y1-y0}" width="${x1-x0}" height="${y1-y0}"><style>${css}</style><rect x="${x0}" y="${y0}" width="${x1-x0}" height="${y1-y0}" fill="${cs.getPropertyValue('--bg')}"/>${clone.outerHTML}</svg>`;
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'})); a.download=name.replace(/[\\/:*?"<>|]+/g,'_')+'.svg'; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),2000);
}
