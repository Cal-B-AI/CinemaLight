(()=>{
"use strict";
const $=(s,r=document)=>r.querySelector(s);
const uid=()=>Math.random().toString(36).slice(2,9);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const now=()=>performance.now();
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const hex2rgb=h=>{const n=parseInt((h||"#000000").slice(1),16);return[(n>>16&255)/255,(n>>8&255)/255,(n&255)/255]};
const KEY="cuelight-show-v1";
const DEMO_NAME="Black Box — Act 1";
const SURF_COLORS=["#f2a93b","#3ec6b5","#8f7cf6","#e5679b","#6fb3ff","#b5d96a","#ff8a5c"];
const GROUP_COLORS=["#ffd166","#7bdff2","#f49cbb","#b8f2a0","#c3a6ff"];
const RESOLUTIONS=[[1920,1080],[1280,720],[1280,800],[1024,768],[1920,1200],[3840,2160]];
const GENS={
  solid:{label:"Solid color",mode:1},wash:{label:"Color wash",mode:2},gradient:{label:"Gradient sweep",mode:3},
  stripes:{label:"Stripes",mode:4},plasma:{label:"Plasma",mode:5},pulse:{label:"Breathe",mode:6},
  strobe:{label:"Strobe",mode:7},sparkle:{label:"Starfield",mode:8},grid:{label:"Test grid",mode:9}
};
const SYNTHS={drone:"Ambient pad",chime:"Chime"};
const CUE_TYPES={look:"Look",fade:"Fade",audio:"Audio",audiofade:"Fade audio",wait:"Wait",blackout:"Blackout",timeline:"Timeline"};
const CONT={none:"",ac:"auto-continue",af:"auto-follow"};

/* ---------- geometry helpers ---------- */
// Points are [x, y, curved?] in a projector's output space, 0..1 across its frame.
function homog(p){
  const[x0,y0]=p[0],[x1,y1]=p[1],[x2,y2]=p[2],[x3,y3]=p[3];
  const dx1=x1-x2,dx2=x3-x2,dx3=x0-x1+x2-x3,dy1=y1-y2,dy2=y3-y2,dy3=y0-y1+y2-y3;
  let a,b,c,d,e,f,g,h;
  if(Math.abs(dx3)<1e-9&&Math.abs(dy3)<1e-9){a=x1-x0;b=x3-x0;c=x0;d=y1-y0;e=y3-y0;f=y0;g=0;h=0;}
  else{const den=(dx1*dy2-dx2*dy1)||1e-9;g=(dx3*dy2-dx2*dy3)/den;h=(dx1*dy3-dx3*dy1)/den;a=x1-x0+g*x1;b=x3-x0+h*x3;c=x0;d=y1-y0+g*y1;e=y3-y0+h*y3;f=y0;}
  return[a,b,c,d,e,f,g,h];
}
function homoPt(H,u,v){const w=H[6]*u+H[7]*v+1;return[(H[0]*u+H[1]*v+H[2])/w,(H[3]*u+H[4]*v+H[5])/w];}
const cr=(a,b,c,d,t)=>{const t2=t*t,t3=t2*t;return 0.5*(2*b+(-a+c)*t+(2*a-5*b+4*c-d)*t2+(-a+3*b-3*c+d)*t3)};
function gridPt(g,i,j){
  const ex=(a,b)=>[2*a[0]-b[0],2*a[1]-b[1]];
  if(j<0)return ex(gridPt(g,i,0),gridPt(g,i,1));
  if(j>g.r)return ex(gridPt(g,i,g.r),gridPt(g,i,g.r-1));
  if(i<0)return ex(gridPt(g,0,j),gridPt(g,1,j));
  if(i>g.c)return ex(gridPt(g,g.c,j),gridPt(g,g.c-1,j));
  return g.pts[j*(g.c+1)+i];
}
function gridEval(g,u,v){
  const x=u*g.c,y=v*g.r,i=Math.min(Math.floor(x),g.c-1),j=Math.min(Math.floor(y),g.r-1),t=x-i,s=y-j;
  const col=[];
  for(let k=-1;k<=2;k++){const p0=gridPt(g,i-1,j+k),p1=gridPt(g,i,j+k),p2=gridPt(g,i+1,j+k),p3=gridPt(g,i+2,j+k);col.push([cr(p0[0],p1[0],p2[0],p3[0],t),cr(p0[1],p1[1],p2[1],p3[1],t)]);}
  return[cr(col[0][0],col[1][0],col[2][0],col[3][0],s),cr(col[0][1],col[1][1],col[2][1],col[3][1],s)];
}
function posAt(s,u,v){return s.warp==="grid"&&s.grid?gridEval(s.grid,u,v):homoPt(homog(s.pts),u,v);}
function gridFromCorners(corners,c,r){const H=homog(corners),pts=[];for(let j=0;j<=r;j++)for(let i=0;i<=c;i++){const p=homoPt(H,i/c,j/r);pts.push([p[0],p[1],0]);}return{c,r,pts};}
function regrid(s,c,r){const pts=[];for(let j=0;j<=r;j++)for(let i=0;i<=c;i++){const p=posAt(s,i/c,j/r);pts.push([p[0],p[1],0]);}s.grid={c,r,pts};}
// Where a point sits inside a surface's content (u,v), the inverse of posAt. Corner warps invert exactly; grids use a few Newton steps.
function homoInv(H,x,y){const[a,b,c,d,e,f,g,h]=H,A=e-f*h,B=c*h-b,C=b*f-c*e,D=f*g-d,E=a-c*g,F=c*d-a*f,G=d*h-e*g,Hh=b*g-a*h,I=a*e-b*d,w=G*x+Hh*y+I||1e-9;return[(A*x+B*y+C)/w,(D*x+E*y+F)/w];}
function uvOf(s,x,y){let[u,v]=homoInv(homog(cornersOf(s)),x,y);if(!(s.warp==="grid"&&s.grid))return[u,v];
  for(let k=0;k<10;k++){const p=posAt(s,u,v),e=1e-3,pu=posAt(s,u+e,v),pv=posAt(s,u,v+e),a=(pu[0]-p[0])/e,b=(pv[0]-p[0])/e,c=(pu[1]-p[1])/e,d=(pv[1]-p[1])/e,det=a*d-b*c;if(Math.abs(det)<1e-9)break;
    const rx=x-p[0],ry=y-p[1];u+=(d*rx-b*ry)/det;v+=(-c*rx+a*ry)/det;if(Math.abs(rx)+Math.abs(ry)<1e-6)break;}return[u,v];}
// After the outline grows past the content, stretch the content (keeping its warp) so the whole outline is filled.
function fitWarpToShape(s){if(!s||!s.shape||s.shape.length<3)return false;
  let u0=0,v0=0,u1=1,v1=1;for(const p of sampleOutline(s.shape)){const[u,v]=uvOf(s,p[0],p[1]);if(!isFinite(u)||!isFinite(v))continue;u0=Math.min(u0,u);v0=Math.min(v0,v);u1=Math.max(u1,u);v1=Math.max(v1,v);}
  const pad=0.002;if(u0>=-pad&&v0>=-pad&&u1<=1+pad&&v1<=1+pad)return false;
  if(s.warp==="grid"&&s.grid){const g=s.grid,pts=[];for(let j=0;j<=g.r;j++)for(let i=0;i<=g.c;i++){const q=gridEval(g,u0+(u1-u0)*i/g.c,v0+(v1-v0)*j/g.r);pts.push([q[0],q[1],0]);}s.grid={c:g.c,r:g.r,pts};}
  else{const H=homog(s.pts);s.pts=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([u,v])=>{const q=homoPt(H,u,v);return[q[0],q[1],0];});}
  geomV++;return true;}
function cornersOf(s){if(s.warp==="grid"&&s.grid){const g=s.grid;return[gridPt(g,0,0),gridPt(g,g.c,0),gridPt(g,g.c,g.r),gridPt(g,0,g.r)];}return s.pts;}
function bbox(pts){const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);const x0=Math.min(...xs),x1=Math.max(...xs),y0=Math.min(...ys),y1=Math.max(...ys);return[[x0,y0,0],[x1,y0,0],[x1,y1,0],[x0,y1,0]];}
function sampleOutline(pts){
  const n=pts.length,out=[];if(n<3)return pts.map(p=>[p[0],p[1]]);
  for(let i=0;i<n;i++){
    const p=pts[i],q=pts[(i+1)%n],pr=pts[(i-1+n)%n],q2=pts[(i+2)%n];
    if(!p[2]&&!q[2]){out.push([p[0],p[1]]);continue;}
    const c1=p[2]?[p[0]+(q[0]-pr[0])/6,p[1]+(q[1]-pr[1])/6]:[p[0],p[1]];
    const c2=q[2]?[q[0]-(q2[0]-p[0])/6,q[1]-(q2[1]-p[1])/6]:[q[0],q[1]];
    for(let k=0;k<14;k++){const t=k/14,m=1-t;out.push([m*m*m*p[0]+3*m*m*t*c1[0]+3*m*t*t*c2[0]+t*t*t*q[0],m*m*m*p[1]+3*m*m*t*c1[1]+3*m*t*t*c2[1]+t*t*t*q[1]]);}
  }
  return out;
}
function presetShape(kind,cx=0.5,cy=0.5,r=0.2,res=curRes()){
  const ax=res[1]/res[0];
  if(kind==="circle"){const p=[];for(let k=0;k<8;k++){const a=k*Math.PI/4;p.push([cx+r*ax*Math.cos(a),cy+r*Math.sin(a),1]);}return p;}
  if(kind==="triangle")return[[cx,cy-r,0],[cx+r*ax*1.1,cy+r*0.8,0],[cx-r*ax*1.1,cy+r*0.8,0]];
  if(kind==="arch"){const rx=r*ax*0.8,ry=r*0.8,x0=cx-rx,x1=cx+rx,top=cy-r,spring=top+ry,bot=cy+r,k=0.7071;
    return[[x0,bot,0],[x1,bot,0],[x1,spring,0],[cx+rx*k,spring-ry*k,1],[cx,top,1],[cx-rx*k,spring-ry*k,1],[x0,spring,0]];}
  return[[cx-r*ax,cy-r*0.75,0],[cx+r*ax,cy-r*0.75,0],[cx+r*ax,cy+r*0.75,0],[cx-r*ax,cy+r*0.75,0]];
}

/* ---------- show model ---------- */
function baseMedia(){
  const M=(id,gen,name,c1,c2,speed=1)=>({id,kind:"gen",gen,name,c1,c2,speed});
  return[
    M("m-wash","wash","Dusk wash","#1d3f99","#c2417a",1),
    M("m-grad","gradient","Amber sweep","#f2a93b","#4a1608",1),
    M("m-stripes","stripes","Barber stripes","#f2efe8","#1a1f27",1),
    M("m-plasma","plasma","Plasma","#00b3a4","#4b1d7a",1),
    M("m-pulse","pulse","Breathe red","#ff4a3d","#000000",1),
    M("m-strobe","strobe","Strobe","#ffffff","#000000",1),
    M("m-stars","sparkle","Starfield","#ffffff","#070b18",1),
    M("m-warm","solid","Warm white","#ffe6c4","#000000",1),
    M("m-moon","pulse","Moonglow","#cfe0ff","#000000",0.4),
    M("m-sky","wash","Night sky","#050b2b","#243b8f",0.5),
    {id:"a-pad",kind:"synth",gen:"drone",name:"Ambient pad"},
    {id:"a-chime",kind:"synth",gen:"chime",name:"Chime"}
  ];
}
function demoShow(){
  const o1=uid(),o2=uid();
  const s1=uid(),s2=uid(),s3=uid(),s4=uid(),s5=uid(),s6=uid();
  const g1=uid(),g2=uid();
  const leftCorners=[[0.06,0.17,0],[0.31,0.24,0],[0.31,0.80,0],[0.06,0.89,0]];
  const leftGrid=gridFromCorners(leftCorners,4,2);
  leftGrid.pts.forEach((p,k)=>{const i=k%5;p[0]-=0.018*Math.sin(Math.PI*i/4);});
  const moon=presetShape("circle",0.5,0.115,0.07,[1920,1080]);
  const C=(num,name,type,o)=>Object.assign({id:uid(),num,name,type,preWait:0,duration:0,cont:"none"},o);
  const row=(target,mediaId,level=1)=>({target,mediaId,level});
  const S=(id,outputId,name,color,o)=>Object.assign({id,outputId,name,color,feather:0,look:null,warp:"corner",grid:null,shape:null},o);
  return {
    v:3,name:DEMO_NAME,media:baseMedia(),
    outputs:[{id:o1,name:"Stage",res:[1920,1080]},{id:o2,name:"Cyc",res:[1280,800]}],
    surfaces:[
      S(s1,o1,"Curved wall",SURF_COLORS[0],{feather:0.02,warp:"grid",grid:leftGrid,pts:leftCorners}),
      S(s2,o1,"Center box",SURF_COLORS[1],{pts:[[0.38,0.22,0],[0.62,0.22,0],[0.62,0.80,0],[0.38,0.80,0]]}),
      S(s3,o1,"Ruined flat",SURF_COLORS[2],{pts:[[0.68,0.17,0],[0.94,0.17,0],[0.94,0.89,0],[0.68,0.89,0]],
        shape:[[0.68,0.80,0],[0.68,0.31,0],[0.715,0.26,0],[0.745,0.32,0],[0.79,0.21,0],[0.83,0.28,0],[0.87,0.18,0],[0.905,0.25,1],[0.935,0.22,0],[0.935,0.89,0]]}),
      S(s4,o1,"Moon",SURF_COLORS[3],{shape:moon,pts:bbox(moon)}),
      S(s5,o2,"Cyc left",SURF_COLORS[4],{feather:0.04,pts:[[0.04,0.08,0],[0.49,0.1,0],[0.49,0.92,0],[0.04,0.9,0]]}),
      S(s6,o2,"Cyc right",SURF_COLORS[5],{feather:0.04,pts:[[0.51,0.1,0],[0.96,0.08,0],[0.96,0.9,0],[0.51,0.92,0]]})
    ],
    masks:[{id:uid(),outputId:o1,name:"Doorway",pts:[[0.455,0.80,0],[0.455,0.57,0],[0.47,0.52,1],[0.5,0.505,1],[0.53,0.52,1],[0.545,0.57,0],[0.545,0.80,0]]}],
    groups:[{id:g1,name:"Walls",color:GROUP_COLORS[0],members:[s1,s3]},{id:g2,name:"Sky",color:GROUP_COLORS[1],members:[s4,s5,s6]}],
    cues:[
      C("1","Preshow — dusk wash everywhere","look",{duration:3,assign:[row("all","m-wash"),row("g:"+g2,"m-sky"),row(s4,"m-moon")]}),
      C("2","Pad in","audio",{duration:4,mediaId:"a-pad",level:0.55,loop:true,cont:"ac"}),
      C("3","Walls go amber","look",{duration:2,assign:[row("g:"+g1,"m-grad")]}),
      C("4","Plasma build on box","look",{duration:5,assign:[row(s2,"m-plasma")],cont:"af"}),
      C("5","Hold","wait",{duration:2,cont:"af"}),
      C("6","Chime","audio",{duration:0,mediaId:"a-chime",level:0.8,loop:false,cont:"ac"}),
      C("7","Strobe hit on stage projector","look",{duration:0.1,assign:[row("o:"+o1,"m-strobe")]}),
      C("8","Starfield in the sky","look",{duration:2.5,assign:[row("o:"+o1,"m-warm",0.25),row("g:"+g2,"m-stars"),row(s4,"m-moon")]}),
      C("9","Walls dim to 30%","fade",{duration:3,target:"g:"+g1,level:0.3}),
      C("10","Cyc fades out","fade",{duration:4,target:"o:"+o2,level:0}),
      C("11","End — blackout","blackout",{duration:4,withAudio:true})
    ]
  };
}
function emptyShow(){const o=uid();return{v:3,name:"Untitled show",media:baseMedia(),outputs:[{id:o,name:"Projector 1",res:[1920,1080]}],surfaces:[],masks:[],groups:[],cues:[]};}

let show;
const mediaRT={};
const rt={surf:{},tweens:[],active:[],audio:[],playhead:0,testPattern:true,mode:"map",out:null,sel:null,selPt:-1,edit:"warp",selMedia:null,frame:0,drawing:null};
let geomV=1;
/* ---------- projects: each one is a full show kept in this browser ---------- */
const IDX_KEY="cuelight-projects-v1",PKEY=id=>"cuelight-proj-"+id;
const proj={idx:{current:null,list:[]},thumbAt:0};
function lsGet(k){try{return localStorage.getItem(k);}catch(e){return null;}}
function lsSet(k,v){try{localStorage.setItem(k,v);return true;}catch(e){return false;}}
function lsDel(k){try{localStorage.removeItem(k);}catch(e){}}
function saveIdx(){lsSet(IDX_KEY,JSON.stringify(proj.idx));}
function projEntry(id){return proj.idx.list.find(p=>p.id===id);}
function showStats(sh){return{outs:sh.outputs?.length||1,surfs:sh.surfaces?.length||0,cues:sh.cues?.length||0,media:(sh.media||[]).filter(m=>m.kind==="video"||m.kind==="image"||m.kind==="audio").length};}
function readProject(id){try{const s=JSON.parse(lsGet(PKEY(id)));return s&&Array.isArray(s.surfaces)?s:null;}catch(e){return null;}}
function writeProject(id,json){
  if(!lsSet(PKEY(id),json)){if(!proj.warned){proj.warned=true;toast("This browser is out of space for saving projects. Delete old projects or export this one from Projects.");}return false;}return true;
}
function newProjectRecord(sh){const id=uid()+uid();const t=Date.now();const e={id,name:sh.name||"Untitled show",created:t,updated:t,stats:showStats(sh),thumb:null};proj.idx.list.unshift(e);writeProject(id,JSON.stringify(sh));saveIdx();return e;}
function loadStored(){
  try{const raw=lsGet(IDX_KEY);if(raw){const ix=JSON.parse(raw);if(ix&&Array.isArray(ix.list))proj.idx=ix;}}catch(e){}
  if(!proj.idx.list.length){
    // first run with projects: keep whatever show was already in this browser
    let old=null;try{old=JSON.parse(lsGet(KEY));}catch(e){}
    const first=old&&Array.isArray(old.surfaces)&&!((old.v||1)<3&&old.name===DEMO_NAME)?old:demoShow();
    proj.idx.current=newProjectRecord(first).id;saveIdx();
  }
  let cur=projEntry(proj.idx.current)||proj.idx.list[0];proj.idx.current=cur.id;
  let sh=readProject(cur.id);
  if(!sh){sh=demoShow();writeProject(cur.id,JSON.stringify(sh));}
  return sh;
}
/* ---------- save + undo history ---------- */
// Edits are committed after a short pause, so one drag or one burst of typing is one undo step.
let saveT=0;
const hist={undo:[],redo:[],last:null,pending:false};
function commit(){
  clearTimeout(saveT);const cur=JSON.stringify(show);
  if(hist.last!==null&&cur!==hist.last){hist.undo.push(hist.last);if(hist.undo.length>200)hist.undo.shift();hist.redo=[];}
  hist.last=cur;hist.pending=false;
  const id=proj.idx.current;if(id){writeProject(id,cur);const e=projEntry(id);if(e){e.updated=Date.now();e.name=show.name||"Untitled show";e.stats=showStats(show);
    if(Date.now()-proj.thumbAt>8000){proj.thumbAt=Date.now();e.thumb=projThumb();}saveIdx();}}
  syncUndoBtns();syncSaved();
}
function projThumb(){try{const o=show.outputs[0],c=oc[o.id]?.cv;if(!c)return null;const t=document.createElement("canvas");t.width=192;t.height=Math.round(192*o.res[1]/o.res[0]);t.getContext("2d").drawImage(c,0,0,t.width,t.height);return t.toDataURL("image/jpeg",0.6);}catch(e){return null;}}
function syncSaved(){const el=$("#savedState");if(el)el.textContent=hist.pending?"Saving…":"Saved";}
function save(){geomV++;hist.pending=true;setTimeout(syncSaved,0);clearTimeout(saveT);saveT=setTimeout(commit,350);syncUndoBtns();}
function syncUndoBtns(){const u=$("#undoBtn"),r=$("#redoBtn");if(u)u.disabled=!hist.undo.length&&!hist.pending;if(r)r.disabled=!hist.redo.length||hist.pending;}
function undo(){
  if(hist.pending)commit();
  if(!hist.undo.length){toast("Nothing to undo.");return;}
  hist.redo.push(hist.last);restoreSnap(hist.undo.pop(),"Undone.");
}
function redo(){
  if(hist.pending)commit();
  if(!hist.redo.length){toast("Nothing to redo.");return;}
  hist.undo.push(hist.last);restoreSnap(hist.redo.pop(),"Redone.");
}
function restoreSnap(json,msg){
  const oldLooks=new Map(show.surfaces.map(s=>[s.id,s.look]));
  hist.last=json;show=migrate(JSON.parse(json));geomV++;
  ensureRT();ensureOutputs();
  for(const s of show.surfaces)if(oldLooks.has(s.id)&&oldLooks.get(s.id)!==s.look)applyLook([{surfaceId:s.id,mediaId:s.look,level:1}],0.3);
  if(!output(rt.out))rt.out=show.outputs[0].id;
  if(rt.sel&&!selObj())rt.sel=null;
  rt.selPt=-1;rt.drawing=null;drag=null;rt.playhead=Math.min(rt.playhead,show.cues.length);
  if(rt.selMedia&&!media(rt.selMedia))rt.selMedia=null;
  $("#showName").value=show.name||"";showStage();renderTabs();renderBin();renderPanel();
  try{localStorage.setItem(KEY,json)}catch(e){}
  syncUndoBtns();toast(msg);
}
function ensureRT(){
  for(const s of show.surfaces){if(!rt.surf[s.id])rt.surf[s.id]={level:1,players:s.look?[{mediaId:s.look,op:1,sid:s.id}]:[]};}
  for(const id in rt.surf){if(!show.surfaces.find(s=>s.id===id))delete rt.surf[id];}
}
const BLACK_M={id:"__black",kind:"gen",gen:"solid",name:"Black",c1:"#000000",c2:"#000000",speed:1};
const media=id=>id==="__black"?BLACK_M:show.media.find(m=>m.id===id);
const TRANS={xfade:"Crossfade",cut:"Cut",black:"Fade through black",wiper:"Wipe →",wipel:"Wipe ←",wiped:"Wipe ↓",wipeu:"Wipe ↑",iris:"Iris open",dissolve:"Dissolve"};
const TRANS_CODE={wiper:1,wipel:2,wiped:3,wipeu:4,iris:5,dissolve:6};
const surf=id=>show.surfaces.find(s=>s.id===id);
const output=id=>show.outputs.find(o=>o.id===id);
const group=id=>show.groups.find(g=>g.id===id);
const curOut=()=>output(rt.out)||show.outputs[0];
const curRes=()=>curOut()?.res||[1920,1080];
const onOut=list=>list.filter(x=>x.outputId===rt.out);
const isVisual=m=>m&&(m.kind==="gen"||m.kind==="video"||m.kind==="image");
const isAudio=m=>m&&(m.kind==="audio"||m.kind==="synth");
const missing=m=>(m.kind==="video"||m.kind==="image"||m.kind==="audio")&&!mediaRT[m.id];

/* ---------- targets: surface id, "g:<group>", "o:<projector>", or "all" ---------- */
function resolveTarget(t){
  if(!t)return[];
  if(t==="all")return show.surfaces.map(s=>s.id);
  if(t.startsWith("o:"))return show.surfaces.filter(s=>s.outputId===t.slice(2)).map(s=>s.id);
  if(t.startsWith("g:")){const g=group(t.slice(2));return g?g.members.filter(id=>surf(id)):[];}
  if(t.startsWith("m:"))return t.slice(2).split(",").filter(id=>surf(id));
  return surf(t)?[t]:[];
}
function targetLabel(t){
  if(t==="all")return"All surfaces";
  if(t?.startsWith("o:"))return"Projector: "+(output(t.slice(2))?.name||"missing");
  if(t?.startsWith("g:"))return"Group: "+(group(t.slice(2))?.name||"missing");
  if(t?.startsWith("m:")){const ids=resolveTarget(t);return ids.length<=2?ids.map(id=>surf(id).name).join(" + ")||"No surfaces":`${ids.length} surfaces on ${output(surf(ids[0]).outputId)?.name||"projector"}`;}
  return surf(t)?.name||"Missing surface";
}
function targetColor(t){
  if(t==="all")return"#f2a93b";
  if(t?.startsWith("o:"))return"#8b93a2";
  if(t?.startsWith("g:"))return group(t.slice(2))?.color||"#8b93a2";
  if(t?.startsWith("m:"))return surf(resolveTarget(t)[0])?.color||"#8b93a2";
  return surf(t)?.color||"#8b93a2";
}
function targetOptions(cur){
  let h=cur?.startsWith("m:")?`<optgroup label="Chosen surfaces">${opt(cur,targetLabel(cur),cur)}</optgroup>`:"";
  h+=`<optgroup label="Everything">${opt("all","All surfaces",cur)}</optgroup>`;
  h+=`<optgroup label="Projectors">${show.outputs.map(o=>opt("o:"+o.id,o.name+" (whole projector)",cur)).join("")}</optgroup>`;
  if(show.groups.length)h+=`<optgroup label="Groups">${show.groups.map(g=>opt("g:"+g.id,g.name+` (${g.members.length})`,cur)).join("")}</optgroup>`;
  for(const o of show.outputs){const ss=show.surfaces.filter(s=>s.outputId===o.id);if(ss.length)h+=`<optgroup label="Surfaces on ${esc(o.name)}">${ss.map(s=>opt(s.id,s.name,cur)).join("")}</optgroup>`;}
  return h;
}

/* ---------- mesh + outline cache ---------- */
const N=32;
const meshCache=new WeakMap(),outlineCache=new WeakMap();
function meshFor(s){
  let c=meshCache.get(s);if(c&&c.v===geomV)return c;
  const pos=new Float32Array((N+1)*(N+1)*2);
  const H=s.warp==="grid"&&s.grid?null:homog(s.pts);
  for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){const p=H?homoPt(H,i/N,j/N):gridEval(s.grid,i/N,j/N);const k=(j*(N+1)+i)*2;pos[k]=p[0];pos[k+1]=p[1];}
  const P=(i,j)=>[pos[(j*(N+1)+i)*2],pos[(j*(N+1)+i)*2+1]],border=[];
  for(let i=0;i<N;i+=2)border.push(P(i,0));for(let j=0;j<N;j+=2)border.push(P(N,j));
  for(let i=N;i>0;i-=2)border.push(P(i,N));for(let j=N;j>0;j-=2)border.push(P(0,j));
  c={v:geomV,pos,border};meshCache.set(s,c);return c;
}
function outlineFor(pts){let c=outlineCache.get(pts);if(c&&c.v===geomV)return c.poly;const poly=sampleOutline(pts);outlineCache.set(pts,{v:geomV,poly});return poly;}
const surfOutline=s=>s.shape&&s.shape.length>=3?outlineFor(s.shape):meshFor(s).border;

/* ---------- WebGL renderer: one GL context renders every projector, then copies into each projector's canvas ---------- */
const glc=document.createElement("canvas");
const ov=$("#ov"),ovx=ov.getContext("2d");
const gl=glc.getContext("webgl",{stencil:true,antialias:true,alpha:false,premultipliedAlpha:false,preserveDrawingBuffer:true});
const VS=`attribute vec2 aPos;attribute vec2 aUv;varying vec2 vUv;varying vec2 vPos;uniform vec4 uXf;
void main(){vUv=aUv;vPos=aPos;vec2 p=aPos*uXf.xy+uXf.zw;gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0);}`;
const FS=`precision highp float;varying vec2 vUv;varying vec2 vPos;uniform int uSpan;uniform vec4 uSpanXf;uniform sampler2D uTex;uniform int uMode;uniform vec3 uC1;uniform vec3 uC2;
uniform float uT;uniform float uOp;uniform float uFeather;uniform vec2 uAsp;uniform int uTrans;uniform float uProg;uniform float uA;uniform vec2 uBox;uniform vec2 uOff;uniform int uRot;uniform vec2 uFlip;
float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
void main(){vec2 uv=uSpan==1?vPos*uSpanXf.xy+uSpanXf.zw:vUv;float t=uT;vec3 col=vec3(0.0);float inM=1.0;
if(uMode==0){vec2 q=vec2((uv.x-0.5)*uA,uv.y-0.5)-uOff;vec2 r=q;
 if(uRot==1)r=vec2(q.y,-q.x);else if(uRot==2)r=-q;else if(uRot==3)r=vec2(-q.y,q.x);
 vec2 tc=r/uBox+0.5;if(uFlip.x>0.5)tc.x=1.0-tc.x;if(uFlip.y>0.5)tc.y=1.0-tc.y;
 inM=step(0.0,tc.x)*step(tc.x,1.0)*step(0.0,tc.y)*step(tc.y,1.0);col=texture2D(uTex,clamp(tc,0.0,1.0)).rgb;}
else if(uMode==1){col=uC1;}
else if(uMode==2){float k=0.5+0.5*sin(t*0.6+uv.x*3.0+uv.y*1.7);col=mix(uC1,uC2,smoothstep(0.0,1.0,k));}
else if(uMode==3){float k=abs(fract(uv.x*0.8-t*0.15)*2.0-1.0);col=mix(uC2,uC1,smoothstep(0.0,1.0,k));}
else if(uMode==4){vec2 q=uv*uAsp;float s=fract((q.x+q.y)*4.0-t*0.6);col=mix(uC1,uC2,smoothstep(0.47,0.5,s)-smoothstep(0.97,1.0,s));}
else if(uMode==5){vec2 p=uv*uAsp*3.0;float v=sin(p.x*1.4+t)+sin(p.y*1.7+t*0.7)+sin((p.x+p.y)*0.9+t*1.3)+sin(length(p-1.5)*2.2-t*1.1);v=0.5+0.125*v;col=mix(uC1,uC2,v)*(0.75+0.25*sin(v*6.283+t));}
else if(uMode==6){col=uC1*(0.12+0.88*(0.5+0.5*sin(t*1.6)));}
else if(uMode==7){col=uC1*step(0.82,fract(t*5.0));}
else if(uMode==8){vec2 q=uv*uAsp*26.0;vec2 g=floor(q);float r=hash(g);float tw=0.5+0.5*sin(t*(1.0+r*3.0)+r*40.0);vec2 o=vec2(hash(g+3.1),hash(g+7.7))*0.5+0.25;float d=length(fract(q)-o);float st=step(0.86,r)*smoothstep(0.18,0.0,d)*tw;col=mix(uC2,uC1,st);}
else if(uMode==9){vec2 q=uv*uAsp;vec2 d=abs(fract(uv*8.0+0.5)-0.5);float ln=max(step(d.x,0.025),step(d.y,0.025));
 float ck=mod(floor(uv.x*8.0)+floor(uv.y*8.0),2.0);float bd=step(min(min(q.x,uAsp.x-q.x),min(q.y,uAsp.y-q.y)),0.02);
 float dg=max(step(abs(uv.x-uv.y),0.004),step(abs(uv.x+uv.y-1.0),0.004));float ci=step(abs(length((uv-0.5)*uAsp)-0.3*min(uAsp.x,uAsp.y)),0.006);
 col=uC1*(0.16+0.06*ck);col=mix(col,uC1*0.9,ln*0.8);col=mix(col,uC1,max(dg,ci));col=mix(col,vec3(1.0),bd);}
float e=min(min(vUv.x,1.0-vUv.x),min(vUv.y,1.0-vUv.y));float fa=uFeather>0.0?smoothstep(0.0,uFeather,e):1.0;
float tm=1.0;
if(uTrans>0){float s=0.08;float e=uProg*(1.0+s)-s;
 if(uTrans==1)tm=1.0-smoothstep(e,e+s,uv.x);
 else if(uTrans==2)tm=1.0-smoothstep(e,e+s,1.0-uv.x);
 else if(uTrans==3)tm=1.0-smoothstep(e,e+s,uv.y);
 else if(uTrans==4)tm=1.0-smoothstep(e,e+s,1.0-uv.y);
 else if(uTrans==5){float dd=length((uv-0.5)*uAsp)/length(0.5*uAsp);tm=1.0-smoothstep(e,e+s,dd);}
 else if(uTrans==6){float nz=hash(floor(uv*uAsp*48.0));tm=1.0-smoothstep(e,e+s,nz);}}
gl_FragColor=vec4(col,uOp*fa*tm*inM);}`;
const MVS=`attribute vec2 aP;uniform vec4 uXf;void main(){vec2 p=aP*uXf.xy+uXf.zw;gl_Position=vec4(p.x*2.0-1.0,1.0-p.y*2.0,0.0,1.0);}`;
const MFS=`precision mediump float;void main(){gl_FragColor=vec4(0.0,0.0,0.0,1.0);}`;
function prog(vs,fs){const p=gl.createProgram();for(const[t,src]of[[gl.VERTEX_SHADER,vs],[gl.FRAGMENT_SHADER,fs]]){const s=gl.createShader(t);gl.shaderSource(s,src);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))console.error(gl.getShaderInfoLog(s));gl.attachShader(p,s);}gl.linkProgram(p);return p;}
let P,PM,U={},uvBuf,posBuf,idxBuf,mBuf,XF=[1,1,0,0];
const IDX_COUNT=N*N*6;
if(gl){
  P=prog(VS,FS);for(const n of["uTex","uMode","uC1","uC2","uT","uOp","uFeather","uAsp","uTrans","uProg","uA","uBox","uOff","uRot","uFlip","uXf","uSpan","uSpanXf"])U[n]=gl.getUniformLocation(P,n);
  P.aPos=gl.getAttribLocation(P,"aPos");P.aUv=gl.getAttribLocation(P,"aUv");
  PM=prog(MVS,MFS);PM.aP=gl.getAttribLocation(PM,"aP");PM.uXf=gl.getUniformLocation(PM,"uXf");
  const uv=new Float32Array((N+1)*(N+1)*2),idx=new Uint16Array(IDX_COUNT);
  for(let j=0;j<=N;j++)for(let i=0;i<=N;i++){const k=(j*(N+1)+i)*2;uv[k]=i/N;uv[k+1]=j/N;}
  let q=0;for(let j=0;j<N;j++)for(let i=0;i<N;i++){const a=j*(N+1)+i,b=a+1,c=a+N+1,d=c+1;idx.set([a,b,c,b,d,c],q);q+=6;}
  uvBuf=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,uvBuf);gl.bufferData(gl.ARRAY_BUFFER,uv,gl.STATIC_DRAW);
  idxBuf=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,idxBuf);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,idx,gl.STATIC_DRAW);
  posBuf=gl.createBuffer();mBuf=gl.createBuffer();
}
function attribsOff(){for(let i=0;i<4;i++)gl.disableVertexAttribArray(i);}
function useSurfProg(pos){
  gl.useProgram(P);attribsOff();gl.uniform4fv(U.uXf,XF);
  gl.bindBuffer(gl.ARRAY_BUFFER,uvBuf);gl.enableVertexAttribArray(P.aUv);gl.vertexAttribPointer(P.aUv,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ARRAY_BUFFER,posBuf);gl.bufferData(gl.ARRAY_BUFFER,pos,gl.DYNAMIC_DRAW);gl.enableVertexAttribArray(P.aPos);gl.vertexAttribPointer(P.aPos,2,gl.FLOAT,false,0,0);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,idxBuf);
}
function stencilPoly(poly){
  gl.useProgram(PM);attribsOff();gl.uniform4fv(PM.uXf,XF);
  gl.bindBuffer(gl.ARRAY_BUFFER,mBuf);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(poly.flat()),gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(PM.aP);gl.vertexAttribPointer(PM.aP,2,gl.FLOAT,false,0,0);
  gl.enable(gl.STENCIL_TEST);gl.stencilMask(0xff);gl.clear(gl.STENCIL_BUFFER_BIT);
  gl.colorMask(false,false,false,false);gl.stencilFunc(gl.ALWAYS,0,0xff);gl.stencilOp(gl.KEEP,gl.KEEP,gl.INVERT);
  gl.drawArrays(gl.TRIANGLE_FAN,0,poly.length);
  gl.colorMask(true,true,true,true);gl.stencilFunc(gl.NOTEQUAL,0,0xff);gl.stencilOp(gl.KEEP,gl.KEEP,gl.KEEP);
}
function quadAsp(p,res){
  const W=res[0],H=res[1],L=(a,b)=>Math.hypot((a[0]-b[0])*W,(a[1]-b[1])*H);
  const w=(L(p[0],p[1])+L(p[3],p[2]))/2,h=(L(p[0],p[3])+L(p[1],p[2]))/2,a=h>0?w/h:1;
  return a>=1?[a,1]:[1,1/a];
}
function texFor(m){
  const r=mediaRT[m.id];if(!r||!r.el)return null;
  if(!r.tex){r.tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,r.tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);}
  gl.bindTexture(gl.TEXTURE_2D,r.tex);
  try{
    if(m.kind==="image"){if(!r.up&&(r.el.width||r.el.naturalWidth)){gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,r.el);r.up=true;}}
  }catch(e){}
  return r.up?r.tex:null;
}
const GRID_MEDIA={kind:"gen",gen:"grid",speed:1};
/* ---------- video players: each surface gets its own video element, so trims and timing are per surface ---------- */
const vidSet=new Set();
const vidPool=document.createElement("div");vidPool.setAttribute("aria-hidden","true");
vidPool.style.cssText="position:fixed;left:0;top:0;width:2px;height:2px;overflow:hidden;opacity:0.01;pointer-events:none;z-index:-1";
document.body.appendChild(vidPool);
// If the browser view refuses a file link for video, retry with the file embedded directly.
function videoFallback(m,code){
  const r=mediaRT[m.id];if(!r)return;
  if(r.blob&&!r.triedData){
    r.triedData=true;const fr=new FileReader();
    fr.onload=()=>{if(mediaRT[m.id]!==r)return;r.url=fr.result;r.via="embedded";
      for(const sid in rt.surf)for(const p of rt.surf[sid].players)if(p.mediaId===m.id&&p.vid){try{p.vid.remove();}catch(e){}vidSet.delete(p.vid);p.vid=null;}
      makeThumb(m,r.url);};
    fr.onerror=()=>mediaFail(m,mediaErr(m,r.blob,code));
    fr.readAsDataURL(r.blob);return;
  }
  mediaFail(m,mediaErr(m,r.blob,code));
}
function trimOf(sid,mid){const s=surf(sid),t=s?.trims?.[mid]||{};return{in:Math.max(0,+t.in||0),out:Math.max(0,+t.out||0),loop:t.loop!==false,rate:+t.rate||1};}
function ensureVid(p){
  if(p.vid)return p.vid;const m=media(p.mediaId),r=m&&mediaRT[m.id];if(!r||m.kind!=="video")return null;
  if(r.err||!r.url)return null;
  const v=document.createElement("video");v.addEventListener("error",()=>videoFallback(m,v.error?.code),{once:true});v.muted=!m.sound;v.setAttribute("muted","");v.setAttribute("playsinline","");v.src=r.url;vidPool.appendChild(v);v.playsInline=true;v.preload="auto";v._mid=m.id;v._sid=p.sid;
  v.addEventListener("loadedmetadata",()=>{const tr=trimOf(v._sid,v._mid);try{v.currentTime=tr.in;}catch(e){}v.playbackRate=tr.rate;},{once:true});
  if(!rt.testPattern)v.play().catch(()=>{});
  if(AC&&AU().deviceId&&v.setSinkId)v.setSinkId(AU().deviceId).catch(()=>{});
  p.vid=v;vidSet.add(v);return v;
}
function vidTex(p){
  const v=ensureVid(p);if(!v)return null;
  if(!v._tex){v._tex=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,v._tex);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);}
  gl.bindTexture(gl.TEXTURE_2D,v._tex);
  if(v.readyState>=2&&v._lf!==rt.frame){try{gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,v);v._up=true;}catch(e){}v._lf=rt.frame;}
  return v._up?v._tex:null;
}
function surfVideo(sid){const r=rt.surf[sid];if(!r)return null;const p=[...r.players].reverse().find(x=>media(x.mediaId)?.kind==="video");return p?ensureVid(p):null;}
function drawLayer(m,color,op,t,player){
  if(m.kind==="gen"){
    gl.uniform1i(U.uMode,GENS[m.gen]?.mode??1);
    gl.uniform3fv(U.uC1,hex2rgb(color||m.c1));gl.uniform3fv(U.uC2,hex2rgb(m.c2||"#000000"));
    gl.uniform1f(U.uT,t*(m.speed??1));
  }else{
    const tex=m.kind==="video"?vidTex(player):texFor(m);if(!tex)return;
    setFrameUniforms(m,player);
    gl.activeTexture(gl.TEXTURE0);gl.bindTexture(gl.TEXTURE_2D,tex);gl.uniform1i(U.uTex,0);gl.uniform1i(U.uMode,0);
  }
  gl.uniform1i(U.uTrans,player?.trans||0);gl.uniform1f(U.uProg,player?.prog??1);
  gl.uniform1f(U.uOp,op);gl.drawElements(gl.TRIANGLES,IDX_COUNT,gl.UNSIGNED_SHORT,0);
}
/* ---------- media framing inside a surface: fill / fit / stretch, size, position, rotate, flip ---------- */
let lastAsp=[1,1];
const FIT={fill:"Fill",fit:"Fit",stretch:"Stretch"};
const FIT_TIP={fill:"Fill the surface, cropping the edges",fit:"Show the whole frame, with black where it doesn't reach",stretch:"Squeeze to the surface shape"};
function normFrame(f){f=f||{};return{fit:FIT[f.fit]?f.fit:"fill",zoom:+f.zoom||1,x:+f.x||0,y:+f.y||0,rot:((+f.rot||0)%4+4)%4,fh:!!f.fh,fv:!!f.fv};}
function frameOf(sid,mid){const f=surf(sid)?.frames?.[mid]||{};return{fit:FIT[f.fit]?f.fit:"fill",zoom:+f.zoom||1,x:+f.x||0,y:+f.y||0,rot:((+f.rot||0)%4+4)%4,fh:!!f.fh,fv:!!f.fv};}
function frameEdit(s,mid){s.frames=s.frames||{};return s.frames[mid]=s.frames[mid]||{};}
function mediaAspect(m,player){
  if(m.kind==="video"){const v=player?.vid;if(v&&v.videoWidth)return v.videoWidth/v.videoHeight;const r=mediaRT[m.id];return r?.w?r.w/r.h:16/9;}
  const r=mediaRT[m.id];return r?.w?r.w/r.h:16/9;
}
function frameBoxSize(f,A,M){const Me=f.rot%2===1?1/M:M;let bw,bh;
  if(f.fit==="stretch"){bw=A;bh=1;}else if((f.fit==="fit")===(Me>A)){bw=A;bh=A/Me;}else{bh=1;bw=Me;}
  return[bw*f.zoom,bh*f.zoom];}
function setFrameUniforms(m,player){
  const A=lastAsp[0]/lastAsp[1],f=player?.frame?normFrame(player.frame):frameOf(player?.sid,m.id),odd=f.rot%2===1;
  const[bw,bh]=frameBoxSize(f,A,mediaAspect(m,player));
  gl.uniform1f(U.uA,A);gl.uniform2f(U.uBox,odd?bh:bw,odd?bw:bh);gl.uniform2f(U.uOff,f.x*A,f.y);gl.uniform1i(U.uRot,f.rot);gl.uniform2f(U.uFlip,f.fh?1:0,f.fv?1:0);
}
/* per-projector 2D canvases (what the stage, thumbnails and output windows show) */
const oc={};
function ensureOutputs(){
  let mw=1,mh=1;
  for(const o of show.outputs){
    if(!oc[o.id]){const c=document.createElement("canvas");c.className="outc";oc[o.id]={cv:c,ctx:c.getContext("2d")};}
    const c=oc[o.id].cv;if(c.width!==o.res[0]||c.height!==o.res[1]){c.width=o.res[0];c.height=o.res[1];}
    mw=Math.max(mw,o.res[0]);mh=Math.max(mh,o.res[1]);
  }
  for(const id in oc)if(!output(id)){delete oc[id];}
  if(rt.roomGL){mw=Math.max(mw,rt.roomGL[0]);mh=Math.max(mh,rt.roomGL[1]);}
  if(glc.width!==mw||glc.height!==mh){glc.width=mw;glc.height=mh;}
}
/* ---------- layers: surfaces and masks share one front-to-back order per projector ---------- */
function layersOn(oid){return[...show.surfaces.filter(x=>x.outputId===oid).map(o=>({kind:"surface",o})),...show.masks.filter(x=>x.outputId===oid).map(o=>({kind:"mask",o}))].sort((a,b)=>(+a.o.z||0)-(+b.o.z||0));}
function renumberLayers(oid){layersOn(oid).forEach((it,i)=>it.o.z=i);}
function topZ(oid){const l=layersOn(oid);return l.length?(+l[l.length-1].o.z||0)+1:0;}
function layerMove(o,how){
  const l=layersOn(o.outputId),i=l.findIndex(it=>it.o===o);if(i<0)return;const[it]=l.splice(i,1);
  const j=how==="front"?l.length:how==="back"?0:clamp(i+(+how),0,l.length);l.splice(j,0,it);l.forEach((x,k)=>x.o.z=k);
  save();renderPanel();
  toast(j===l.length-1?`${o.name} is now in front of everything on this projector.`:j===0?`${o.name} is now behind everything on this projector.`:`${o.name} moved ${how>0?"forward":"back"}.`);
}
// vp (room view only): render this projector's pieces into a w×h view with xf=[sx,sy,ox,oy] placing its 0..1 space, so nothing is cut off at the projector edge
/* ---------- spanning: one picture across several surfaces ----------
   A spanning player is shared by every surface it covers, and each surface shows the part of the picture
   that falls on it, as if one big image were projected across them all (room positions, so it can cross projectors). */
const spanCache=new Map();
function spanArea(sids){const k=sids.join(",")+"|"+geomV+"|"+JSON.stringify(show.mv?.layout||{});let a=spanCache.get(k);if(a)return a;
  let x0=Infinity,y0=Infinity,x1=-Infinity,y1=-Infinity;const L=mvLayout();
  for(const id of sids){const s=surf(id);if(!s)continue;const r=mvRect(output(s.outputId),L);for(const p of surfOutline(s)){const X=r.x+p[0]*r.w,Y=r.y+p[1]*r.h;x0=Math.min(x0,X);y0=Math.min(y0,Y);x1=Math.max(x1,X);y1=Math.max(y1,Y);}}
  if(!isFinite(x0)||x1-x0<1e-6||y1-y0<1e-6)return null;a={x0,y0,w:x1-x0,h:y1-y0};if(spanCache.size>200)spanCache.clear();spanCache.set(k,a);return a;}
function spanXf(o,a){const r=mvRect(o,mvLayout());return[r.w/a.w,r.h/a.h,(r.x-a.x0)/a.w,(r.y-a.y0)/a.h];}
function spanAsp(a){const A=a.w/a.h;return A>=1?[A,1]:[1,1/A];}
// The span area as a flat "surface" on projector o, so the framing box and handles work exactly like a single surface.
function spanVirtual(sids,o){const a=spanArea(sids);if(!a)return null;const r=mvRect(o,mvLayout()),loc=(u,v)=>[(a.x0+u*a.w-r.x)/r.w,(a.y0+v*a.h-r.y)/r.h,0];
  return{id:"span:"+sids.join(","),outputId:o.id,warp:"corner",pts:[loc(0,0),loc(1,0),loc(1,1),loc(0,1)],virtual:true};}
function drawOutput(o,t,state=rt.surf,dest=oc[o.id]?.ctx,tp=rt.testPattern,vp=null){
  const[w,h]=vp?[vp.w,vp.h]:o.res;XF=vp?vp.xf:[1,1,0,0];
  gl.viewport(0,0,w,h);gl.enable(gl.SCISSOR_TEST);gl.scissor(0,0,w,h);
  gl.clearColor(0,0,0,1);gl.clearStencil(0);gl.clear(gl.COLOR_BUFFER_BIT|gl.STENCIL_BUFFER_BIT);
  for(const it of layersOn(o.id)){
    if(it.kind==="mask"){const mk=it.o;if(mk.pts.length<3)continue;const poly=outlineFor(mk.pts);
      gl.disable(gl.BLEND);stencilPoly(poly);gl.drawArrays(gl.TRIANGLE_FAN,0,poly.length);gl.disable(gl.STENCIL_TEST);continue;}
    const s=it.o;
    const r=state[s.id];
    const layers=tp?[1]:(r?r.players.filter(p=>media(p.mediaId)&&p.op*r.level>0.002):[]);
    if(!layers.length)continue;
    const shaped=s.shape&&s.shape.length>=3;
    if(shaped)stencilPoly(outlineFor(s.shape));
    useSurfProg(meshFor(s).pos);
    gl.enable(gl.BLEND);gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    const surfAsp=quadAsp(cornersOf(s),o.res);gl.uniform1f(U.uFeather,+s.feather||0);
    const setSpan=p=>{const a=p&&p.span&&spanArea(p.span.sids);if(a){gl.uniform1i(U.uSpan,1);gl.uniform4fv(U.uSpanXf,spanXf(o,a));lastAsp=spanAsp(a);}else{gl.uniform1i(U.uSpan,0);lastAsp=surfAsp;}gl.uniform2fv(U.uAsp,lastAsp);};
    if(tp){setSpan(null);drawLayer(GRID_MEDIA,s.color,1,t);}
    else for(const p of layers){setSpan(p);drawLayer(media(p.mediaId),null,p.op*r.level,t,p);}
    if(shaped)gl.disable(gl.STENCIL_TEST);
  }
  gl.disable(gl.BLEND);
  gl.disable(gl.SCISSOR_TEST);XF=[1,1,0,0];
  if(dest)dest.drawImage(glc,0,glc.height-h,w,h,0,0,w,h);
}
// Live edits: while you build or edit a cue (or work in the timeline), the projectors show it too.
// Blind: they keep the running show until GO.
rt.liveEdit=(()=>{try{return localStorage.getItem("cuelight-live-edit")!=="0";}catch(e){return true;}})();
function projFollowsEdit(){return rt.liveEdit&&(previewActive()||rt.mode==="timeline");}
function projState(){
  if(rt.liveEdit&&previewActive())return{state:rt.preview.surf,tp:false};
  if(rt.liveEdit&&rt.mode==="timeline")return{state:tl.surf,tp:false};
  const toTL=rt.outSrc==="timeline";return{state:toTL?tl.surf:rt.surf,tp:toTL?false:rt.testPattern};
}
// While mapping, the projectors also show your crosshair, the shape you're drawing and the selected piece's points,
// so you can place points right on the set while watching the set.
rt.ptr=null;rt.guides=(()=>{try{return localStorage.getItem("cuelight-guides")!=="0";}catch(e){return true;}})();
function ptrLocal(o){if(!rt.ptr)return null;const ev={clientX:rt.ptr.x,clientY:rt.ptr.y};if(rt.room)return roomLocal(ev,o);return o.id===rt.out?toN(ev):null;}
function drawProjGuides(o){
  if(rt.mode!=="map"||!rt.guides)return;const d=oc[o.id];if(!d)return;const c=d.ctx,W=d.cv.width,H=d.cv.height,lw=Math.max(1.5,W/960);
  const P=p=>[p[0]*W,p[1]*H],line=(pts,close)=>{c.beginPath();pts.forEach((p,i)=>{const[x,y]=P(p);i?c.lineTo(x,y):c.moveTo(x,y);});if(close)c.closePath();};
  const stroke=(col,w,dash)=>{c.setLineDash(dash||[]);c.lineWidth=w+2*lw;c.strokeStyle="rgba(0,0,0,.75)";c.stroke();c.lineWidth=w;c.strokeStyle=col;c.stroke();c.setLineDash([]);};
  const dot=(p,r,fill)=>{const[x,y]=P(p);c.beginPath();c.arc(x,y,r,0,Math.PI*2);c.fillStyle="#000";c.fill();c.beginPath();c.arc(x,y,r-lw,0,Math.PI*2);c.fillStyle=fill;c.fill();};
  // selected piece: outline and its points
  const so=selObj();if(so&&rt.sel.kind!=="group"&&so.outputId===o.id&&!rt.drawing){const arr=editArr()||so.pts;
    line(rt.sel.kind==="mask"?outlineFor(so.pts):surfOutline(so),true);stroke(rt.sel.kind==="mask"?"#e5484d":"#f2a93b",lw*1.5,[8*lw,6*lw]);
    arr.forEach((p,i)=>dot(p,6*lw,i===rt.selPt?"#fff":"#f2a93b"));}
  // shape being drawn
  if(rt.drawing&&o.id===rt.out){const dp=rt.drawing.pts,hv=rt.drawing.hover;if(dp.length){line(hv?[...dp,hv]:dp,false);stroke("#fff",lw*1.5);dp.forEach((p,i)=>dot(p,(i?5:8)*lw,i?"#fff":"#f2a93b"));}}
  // crosshair
  const q=ptrLocal(o);if(q&&q[0]>-0.02&&q[0]<1.02&&q[1]>-0.02&&q[1]<1.02){const[x,y]=P(q);
    c.beginPath();c.moveTo(0,y);c.lineTo(W,y);c.moveTo(x,0);c.lineTo(x,H);stroke("rgba(255,255,255,.85)",lw);
    c.beginPath();c.arc(x,y,14*lw,0,Math.PI*2);stroke("#f2a93b",lw*1.5);}
}
function draw(n){
  if(!gl)return;
  if(tlActive())tlStep(n);
  const ps=projState();
  for(const o of show.outputs){drawOutput(o,n/1000,ps.state,oc[o.id]?.ctx,ps.tp);drawProjGuides(o);}
  if(stageUsesPvc()){const o=curOut();if(pvc.width!==o.res[0]||pvc.height!==o.res[1]){pvc.width=o.res[0];pvc.height=o.res[1];}drawOutput(o,n/1000,previewActive()?rt.preview.surf:tl.surf,pvx,false);}
}
function drawThumbs(){
  document.querySelectorAll("canvas.thumb").forEach(c=>{const d=oc[c.dataset.id];if(!d)return;c.getContext("2d").drawImage(d.cv,0,0,c.width,c.height);});
}
function manageVideos(){
  const live=new Set();
  for(const p of Object.values(tl.players))if(p.vid)live.add(p.vid);
  const maps=[[rt.surf,!rt.testPattern]];if(rt.preview)maps.push([rt.preview.surf,previewActive()]);
  for(const[map,on]of maps)for(const sid in map){const r=map[sid];for(const p of r.players){if(!p.vid)continue;live.add(p.vid);if(p.tl)continue;const v=p.vid;
    // trim: loop back to the in point, or hold the last frame at the out point
    const tr=trimOf(v._sid,v._mid),end=tr.out>0?Math.min(tr.out,v.duration||tr.out):v.duration;
    if(v.playbackRate!==tr.rate)v.playbackRate=tr.rate;
    if(end&&v.currentTime>=end-0.04){if(tr.loop){try{v.currentTime=tr.in;}catch(e){}}else{v._done=true;if(!v.paused)v.pause();}}
    if(rt.frame%10===0){const want=on&&p.op*r.level>0.002&&!v._done;
      if(want&&v.paused)v.play().catch(()=>{});else if(!want&&!v.paused)v.pause();}}}
  if(rt.frame%30)return;
  for(const v of vidSet)if(!live.has(v)){try{v.pause();v.removeAttribute("src");v.load();v.remove();}catch(e){}if(v._tex&&gl)gl.deleteTexture(v._tex);vidSet.delete(v);}
}

/* ---------- cue preview: the stage shows the look at the selected cue; projectors keep the live show ---------- */
const pvc=document.createElement("canvas");pvc.className="outc";const pvx=pvc.getContext("2d");
rt.previewOn=true;
function selCue(){return rt.mode==="cues"?show.cues[rt.playhead]:null;}
function previewActive(){const c=selCue();return!!(c&&c.type==="look"&&rt.previewOn&&rt.preview);}
// What every surface shows once the cue list has run up to cue i (tracking, like a lighting desk).
function cueState(i){
  const st={};for(const s of show.surfaces)st[s.id]={mediaId:s.look||null,level:1,frame:null};
  for(let k=0;k<=i&&k<show.cues.length;k++){const c=show.cues[k];
    if(c.type==="look")for(const row of c.assign||[]){const sids=resolveTarget(row.target),span=row.span&&sids.length>1&&row.mediaId?{key:row.mediaId+"|"+sids.join(","),sids}:null;
      for(const sid of sids){if(!st[sid])continue;st[sid].mediaId=row.mediaId||null;st[sid].level=row.level??1;st[sid].frame=span?row.spanFrame||null:row.frames?.[sid]||null;st[sid].span=span;}}
    else if(c.type==="fade")resolveTarget(c.target).forEach(sid=>{if(st[sid])st[sid].level=+c.level;});
    else if(c.type==="blackout")Object.values(st).forEach(x=>x.level=0);}
  return st;
}
function syncPreview(){
  const c=selCue();if(!c||c.type!=="look"){if(rt.preview&&!c)rt.preview=null;return;}
  const st=cueState(rt.playhead),pv=rt.preview||(rt.preview={surf:{}});
  for(const sid in pv.surf)if(!st[sid])delete pv.surf[sid];
  const shared={};for(const sid in pv.surf){const q=pv.surf[sid].players[0];if(q&&q.span)shared[q.span.key]=q;}
  for(const sid in st){const w=st[sid],r=pv.surf[sid]||(pv.surf[sid]={level:1,players:[]});r.level=w.mediaId?w.level:0;
    const p=r.players[0];if(!w.mediaId){r.players=[];continue;}
    if(w.span){const q=shared[w.span.key]||(shared[w.span.key]={mediaId:w.mediaId,op:1,sid:w.span.sids[0],frame:w.frame,span:{key:w.span.key,sids:w.span.sids}});q.frame=w.frame;r.players=[q];continue;}
    if(p&&p.mediaId===w.mediaId&&!p.span)p.frame=w.frame;else r.players=[{mediaId:w.mediaId,op:1,sid,frame:w.frame}];}
}
function cueRowFor(c,sid){let row=null;for(const r of c?.assign||[])if(resolveTarget(r.target).includes(sid))row=r;return row;}
function cueEditSurfaces(c){return show.surfaces.filter(s=>{const r=cueRowFor(c,s.id);return r&&r.mediaId&&isVisual(media(r.mediaId))&&media(r.mediaId).kind!=="gen";});}
function ensureCueEdit(){
  const c=selCue();if(!c||c.type!=="look"){rt.cedit=null;return;}
  const ok=cueEditSurfaces(c);if(rt.cedit&&rt.cedit.cue===c.id&&ok.some(s=>s.id===rt.cedit.sid))return;
  const first=ok.find(s=>s.outputId===rt.out)||ok[0];rt.cedit=first?{cue:c.id,sid:first.id}:null;
}
function spanSids(row){const ids=row&&row.span&&row.mediaId?resolveTarget(row.target):[];return ids.length>1?ids:null;}
function clipSpanSids(cl){const ids=cl&&cl.span?[cl.lane,...cl.span.filter(id=>id!==cl.lane&&surf(id))]:[];return ids.length>1?ids:null;}
function cueFrame(create){
  const c=selCue(),sid=rt.cedit?.sid;if(!c||!sid)return null;const row=cueRowFor(c,sid);if(!row||!row.mediaId)return null;
  if(spanSids(row)){if(!row.spanFrame){if(!create)return{row,f:normFrame({}),own:false,span:true};row.spanFrame=normFrame({});syncPreview();}return{row,f:row.spanFrame,own:true,span:true};}
  if(!row.frames?.[sid]){if(!create)return{row,f:frameOf(sid,row.mediaId),own:false};row.frames=row.frames||{};row.frames[sid]={...frameOf(sid,row.mediaId)};syncPreview();
    for(const id in rt.surf)for(const p of rt.surf[id].players)if(p.sid===sid&&p.mediaId===row.mediaId&&!p.frame&&show.cues[rt.playhead]===c)p.frame=row.frames[sid];}
  return{row,f:row.frames[sid],own:true};
}
// The media box on a surface, in the surface's own 0..1 coordinates.
function mediaBox(s,m,f,pl){
  const asp=quadAsp(cornersOf(s),output(s.outputId).res),A=asp[0]/asp[1];
  const p=pl!==undefined?pl:rt.preview?.surf[s.id]?.players[0];const[bw,bh]=frameBoxSize(f,A,mediaAspect(m,p));
  return{cu:0.5+f.x,cv:0.5+f.y,hu:bw/A/2,hv:bh/2};
}
function boxPoly(s,b,steps=10){const pts=[];const c=[[-1,-1],[1,-1],[1,1],[-1,1]];
  for(let k=0;k<4;k++){const a=c[k],n=c[(k+1)%4];for(let i=0;i<steps;i++){const t=i/steps;pts.push(posAt(s,b.cu+b.hu*(a[0]+(n[0]-a[0])*t),b.cv+b.hv*(a[1]+(n[1]-a[1])*t)));}}return pts;}
function syncCueFrameUI(f){for(const k of["zoom","x","y"]){const el=$("#cfr-"+k);if(!el)continue;if(document.activeElement!==el)el.value=f[k]??(k==="zoom"?1:0);const n=el&&el.parentElement.querySelector(".frn");if(n&&document.activeElement!==n)n.value=Math.round((f[k]??(k==="zoom"?1:0))*100);}}
rt.cdrag=null;
function frameProv(){
  if(rt.mode==="cues"&&previewActive()){const sid=rt.cedit?.sid,cf=sid&&cueFrame(false);if(!cf)return null;
    const ss=spanSids(cf.row);
    if(ss)return{sid,mid:cf.row.mediaId,own:cf.own,span:ss,surface:spanVirtual(ss,curOut()),player:rt.preview?.surf[sid]?.players[0],get:cr=>cueFrame(cr)?.f,
      reset:()=>{delete cf.row.spanFrame;syncPreview();}};
    return{sid,mid:cf.row.mediaId,own:cf.own,player:rt.preview?.surf[sid]?.players[0],get:cr=>cueFrame(cr)?.f,
      reset:()=>{if(!cf.own)return;delete cf.row.frames[sid];for(const id in rt.surf)for(const p of rt.surf[id].players)if(p.frame===cf.f)p.frame=null;syncPreview();}};}
  if(rt.mode==="timeline"){const cl=tlClip(rt.tsel);if(!cl||!surf(cl.lane))return null;const m=media(cl.mediaId);if(!m||(m.kind!=="video"&&m.kind!=="image"))return null;
    const ss=clipSpanSids(cl);
    if(ss)return{sid:cl.lane,mid:m.id,own:!!cl.frame,span:ss,surface:spanVirtual(ss,curOut()),player:tl.players[cl.id],
      get:cr=>{if(!cl.frame&&cr){cl.frame=normFrame({});const p=tl.players[cl.id];if(p)p.frame=cl.frame;}return cl.frame||normFrame({});},
      reset:()=>{delete cl.frame;const p=tl.players[cl.id];if(p)p.frame=null;}};
    return{sid:cl.lane,mid:m.id,own:!!cl.frame,player:tl.players[cl.id],
      get:cr=>{if(!cl.frame&&cr){cl.frame={...frameOf(cl.lane,m.id)};const p=tl.players[cl.id];if(p)p.frame=cl.frame;}return cl.frame||frameOf(cl.lane,m.id);},
      reset:()=>{delete cl.frame;const p=tl.players[cl.id];if(p)p.frame=null;}};}
  return null;
}
function frameEditDown(e){
  const[x,y,r]=toN(e);const W=r.width,H=r.height;
  const near=(p,R)=>Math.hypot((p[0]-x)*W,(p[1]-y)*H)<R;
  const pv=frameProv(),s=pv&&(pv.surface||surf(pv.sid));
  if(s&&s.outputId===rt.out){const b=mediaBox(s,media(pv.mid),normFrame(pv.get(false)),pv.player);
    const corners=[[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,bb])=>posAt(s,b.cu+b.hu*a,b.cv+b.hv*bb)),ctr=posAt(s,b.cu,b.cv);
    const ci=corners.findIndex(p=>near(p,14));
    if(ci>=0){const f=pv.get(true);rt.cdrag={type:"zoom",f,ctr,d0:Math.hypot((corners[ci][0]-ctr[0])*W,(corners[ci][1]-ctr[1])*H)||1,z0:+f.zoom||1};ov.setPointerCapture(e.pointerId);return true;}
    if(inPoly([x,y],boxPoly(s,b))){
      const f=pv.get(true),e1=0.01,p0=posAt(s,b.cu,b.cv),pu=posAt(s,b.cu+e1,b.cv),pvv=posAt(s,b.cu,b.cv+e1);
      const a11=(pu[0]-p0[0])/e1,a21=(pu[1]-p0[1])/e1,a12=(pvv[0]-p0[0])/e1,a22=(pvv[1]-p0[1])/e1,det=a11*a22-a12*a21||1e-6;
      rt.cdrag={type:"move",f,x,y,ox:+f.x||0,oy:+f.y||0,inv:[a22/det,-a12/det,-a21/det,a11/det]};ov.setPointerCapture(e.pointerId);return true;}}
  const hit=[...onOut(show.surfaces)].reverse().find(sf=>inPoly([x,y],surfOutline(sf)));
  if(!hit)return false;
  if(rt.mode==="timeline"){tlPickSurface(hit);return true;}
  const c=selCue();if(!c)return false;const row=cueRowFor(c,hit.id);
  if(row&&row.mediaId&&media(row.mediaId)?.kind!=="gen"){rt.cedit={cue:c.id,sid:hit.id};renderPanel();return true;}
  toast(row?`${hit.name} shows an effect in this cue, so there's nothing to frame.`:`Cue ${c.num} doesn't change ${hit.name}. Use Edit cue… to add it.`);return true;
}
function cueEditMove(e){
  const d=rt.cdrag;if(!d)return false;const[x,y,r]=toN(e);
  if(d.type==="zoom"){d.f.zoom=clamp(d.z0*Math.hypot((x-d.ctr[0])*r.width,(y-d.ctr[1])*r.height)/d.d0,0.01,100);}
  else{const dx=x-d.x,dy=y-d.y;d.f.x=d.ox+d.inv[0]*dx+d.inv[1]*dy;d.f.y=d.oy+d.inv[2]*dx+d.inv[3]*dy;}
  syncCueFrameUI(d.f);return true;
}
/* ---------- timeline editor: lanes per surface, clips with transitions, synced video and audio ---------- */
const tl={t:0,playing:false,t0:0,wall0:0,surf:{},players:{},aud:{},pps:40,snap:true,tool:"select",loopRange:false,linked:(()=>{try{return localStorage.getItem("cuelight-linked")!=="0";}catch(e){return true;}})()};
rt.tsel=null;rt.outSrc="cues";
function audioLanes(){const n=Math.max(1,show?.timeline?.audioLanes||2);return Array.from({length:n},(_,i)=>["a"+(i+1),"Audio "+(i+1)]);}
const isAudioLane=l=>/^a\d+$/.test(l||"");
function T(){return show.timeline||(show.timeline={duration:60,loop:false,clips:[]});}
function tlClip(id){return id?T().clips.find(c=>c.id===id):null;}
function laneList(){const out=[];for(const o of show.outputs){out.push({hdr:true,name:o.name});for(const s of show.surfaces.filter(x=>x.outputId===o.id))out.push({id:s.id,name:s.name,color:s.color});}
  out.push({hdr:true,name:"Sound",sound:true});for(const[id,n]of audioLanes())out.push({id,name:n,color:"#8b93a2",audio:true});return out;}
function laneName(id){return isAudioLane(id)?"Audio "+id.slice(1):surf(id)?.name||"Missing surface";}
function fmtTC(t){t=Math.max(0,t||0);const m=Math.floor(t/60),s=t-m*60;return`${m}:${s.toFixed(2).padStart(5,"0")}`;}
function srcDur(m){return m&&(m.kind==="video"||m.kind==="audio")?(mediaRT[m.id]?.dur||null):null;}
function tlActive(){return rt.mode==="timeline"||rt.outSrc==="timeline"||tl.playing;}
function tlSeek(t){tl.t=clamp(t,0,T().duration);if(tl.playing){tl.t0=tl.t;tl.wall0=now();}}
function tlPlay(from){if(from!=null)tl.t=clamp(+from||0,0,T().duration);if(tl.t>=T().duration-0.01)tl.t=0;
  const rg=T().range;if(rg&&rg.out>rg.in&&(tl.t<rg.in||tl.t>=rg.out-0.01))tl.t=rg.in;tl.playing=true;tl.t0=tl.t;tl.wall0=now();ac();renderTLTransport();}
function tlPause(){tl.playing=false;renderTLTransport();}
function tlToggle(){if(tl.playing){tlPause();return;}
  // Live edits: Play goes to the projectors (and keeps going if you leave the timeline). Blind: Play previews here until you send it out.
  if(rt.liveEdit){if(rt.outSrc!=="timeline"){rt.outSrc="timeline";showStage();renderPanel();toast("Playing on the projectors. Switch to Blind edits (top bar) to rehearse here without changing them.");}}
  else if(rt.outSrc!=="timeline")toast("Blind: playing on this screen only. Click “Projectors: showing cues” to send the timeline out.");
  show.tour=show.tour||{};show.tour.go=true;tlPlay();}
const spd=c=>clamp(+c.speed||1,0.1,8);
function srcAt(c,t){return(+c.in||0)+(t-c.start)*spd(c);}
const FPS=30;
function clipOp(c,t){
  const local=t-c.start,end=c.start+c.dur;let op=c.level??1,trans=0,prog=1;
  const tin=Math.min(+c.tin||0,c.dur),ty=TRANS[c.ttype]?c.ttype:"xfade";
  if(tin>0&&local<tin&&ty!=="cut"){const k=clamp(local/tin,0,1);if(TRANS_CODE[ty]){trans=TRANS_CODE[ty];prog=k;}else op*=k;}
  const fo=Math.min(+c.fout||0,c.dur);if(fo>0&&end-t<fo)op*=clamp((end-t)/fo,0,1);
  return{op,trans,prog};
}
// Sound level for a clip at time t: its volume shaped by fade-in and fade-out ramps.
function clipGain(c,t,vol,fi,fo){const local=t-c.start,end=c.start+c.dur;let g=clamp(vol??1,0,1);
  fi=Math.min(+fi||0,c.dur);fo=Math.min(+fo||0,c.dur);
  if(fi>0&&local<fi)g*=clamp(local/fi,0,1);if(fo>0&&end-t<fo)g*=clamp((end-t)/fo,0,1);return g;}
const laneSt=id=>(T().lanes||{})[id]||{};
// A video clip plays its own sound unless it's muted, its lane is muted, the file has no sound, or the sound was separated.
function videoClipSounds(c){const m=media(c.mediaId);return m&&m.kind==="video"&&!c.mute&&!laneSt(c.lane).mute&&mediaRT[m.id]?.noAudio!==true;}
function dropTlAudio(a){try{a.pause();a.removeAttribute("src");}catch(e){}try{a._src&&a._src.disconnect();a._g&&a._g.disconnect();}catch(e){}try{a._R&&a._R.dispose();}catch(e){}}
// A video clip's sound goes through the speaker router too (connected the first time it needs to make sound).
function vidSound(v,c,gain){const ctx=ac();if(!ctx)return;if(!v._g){try{v._src=ctx.createMediaElementSource(v);v._g=ctx.createGain();v._src.connect(v._g);v._R=makeRouter(()=>tlClip(v._clipId)?.route);v._g.connect(v._R.input);}catch(e){v.muted=false;v.volume=gain;return;}}
  v._clipId=c.id;v.muted=false;v._g.gain.setTargetAtTime(gain,ctx.currentTime,0.01);}
function tlStep(n){
  const TT=T();
  const rg=TT.range;
  if(tl.playing&&rg&&rg.out>rg.in&&tl.t0<rg.out){const t2=tl.t0+(n-tl.wall0)/1000;if(t2>=rg.out){if(tl.loopRange){tl.t0=rg.in;tl.wall0=n;tl.t=rg.in;}else{tl.t=rg.out;tl.playing=false;renderTLTransport();}}}
  if(tl.playing){tl.t=tl.t0+(n-tl.wall0)/1000;if(tl.t>=TT.duration){if(TT.loop){tl.t=0;tl.t0=0;tl.wall0=n;}else{tl.t=TT.duration;tl.playing=false;renderTLTransport();}}}
  const t=tl.t,st={},keep=new Set();
  for(const s of show.surfaces)st[s.id]={level:1,players:[]};
  const clips=TT.clips.filter(c=>!isAudioLane(c.lane)&&!laneSt(c.lane).mute&&!c.off).sort((a,b)=>a.start-b.start);
  for(const c of clips){
    const active=t>=c.start&&t<c.start+c.dur,warm=!active&&c.start>t&&c.start-t<2.5;
    if(!active&&!warm)continue;const m=media(c.mediaId);if(!m||!st[c.lane])continue;
    let p=tl.players[c.id];if(!p||p.mediaId!==c.mediaId||p.sid!==c.lane)p=tl.players[c.id]={mediaId:c.mediaId,sid:c.lane,op:1,tl:true};
    p.frame=c.frame||null;keep.add(c.id);
    if(m.kind==="video"){const v=ensureVid(p);if(v){const want=active?srcAt(c,t):(+c.in||0);if(Math.abs(v.playbackRate-spd(c))>0.001)v.playbackRate=spd(c);
      const snd=active&&tl.playing&&videoClipSounds(c);
      if(snd)vidSound(v,c,clipGain(c,t,c.vol,c.afi,c.afo));else if(v._g)v._g.gain.value=0;else v.muted=true;
      if(active&&tl.playing){if(v.paused&&v.readyState>=1)v.play().catch(()=>{});if(Math.abs(v.currentTime-want)>0.3){try{v.currentTime=want;}catch(e){}}}
      else{if(!v.paused)v.pause();if(Math.abs(v.currentTime-want)>0.04&&!v.seeking){try{v.currentTime=want;}catch(e){}}}}}
    const ss=clipSpanSids(c);p.span=ss?{key:"clip:"+c.id,sids:ss}:null;
    if(active){const o=clipOp(c,t);p.op=o.op;p.trans=o.trans;p.prog=o.prog;for(const sid of ss||[c.lane])if(st[sid]&&!laneSt(sid).mute)st[sid].players.push(p);}
  }
  for(const id in tl.players)if(!keep.has(id))delete tl.players[id];
  tl.surf=st;
  // Sound lanes: sound files, or the sound of a video file (from Separate audio, or dropped on a sound lane).
  const akeep=new Set();
  for(const c of TT.clips){
    if(!isAudioLane(c.lane)||laneSt(c.lane).mute||c.off)continue;const m=media(c.mediaId),r=m&&mediaRT[m.id];if(!r||!r.url||(m.kind!=="audio"&&m.kind!=="video"))continue;
    const active=t>=c.start&&t<c.start+c.dur;if(!active&&!(c.start>t&&c.start-t<2))continue;akeep.add(c.id);
    let a=tl.aud[c.id];if(!a||a._mid!==m.id){if(a)dropTlAudio(a);a=tl.aud[c.id]=new Audio(r.url);a._mid=m.id;a.preload="auto";
      const ctx=ac();if(ctx){try{a._src=ctx.createMediaElementSource(a);a._g=ctx.createGain();a._g.gain.value=0;a._R=makeRouter(()=>tlClip(c.id)?.route);a._src.connect(a._g);a._g.connect(a._R.input);}catch(e){}}}
    const want=active?srcAt(c,t):(+c.in||0),gain=clipGain(c,t,c.level??1,c.tin,c.fout);if(Math.abs(a.playbackRate-spd(c))>0.001)a.playbackRate=spd(c);
    if(active&&tl.playing){if(a._g)a._g.gain.setTargetAtTime(gain,AC.currentTime,0.01);else a.volume=gain;if(a.paused)a.play().catch(()=>{});if(Math.abs(a.currentTime-want)>0.3){try{a.currentTime=want;}catch(e){}}}
    else{if(a._g)a._g.gain.value=0;if(!a.paused)a.pause();if(Math.abs(a.currentTime-want)>0.05){try{a.currentTime=want;}catch(e){}}}
  }
  for(const id in tl.aud)if(!akeep.has(id)){dropTlAudio(tl.aud[id]);delete tl.aud[id];}
}
/* waveforms: decoded once per file, drawn inside clips */
const peakQ=[];let peakBusy=false;
function hasSoundTrack(m){return m&&(m.kind==="audio"||(m.kind==="video"&&mediaRT[m.id]?.noAudio!==true));}
function ensurePeaks(m){const r=m&&mediaRT[m.id];if(!r||!r.url||r.peaks||r.peaking||r.noPeaks)return;r.peaking=true;peakQ.push(m);runPeaks();}
async function runPeaks(){if(peakBusy)return;const m=peakQ.shift();if(!m)return;peakBusy=true;const r=mediaRT[m.id];
  try{const ctx=ac();if(!ctx)throw 0;let buf;
    if(r.blob){if(r.blob.size>500*1048576)throw 0;buf=await r.blob.arrayBuffer();}else buf=await (await fetch(r.url)).arrayBuffer();
    const ab=await new Promise((res,rej)=>{const pr=ctx.decodeAudioData(buf,res,rej);if(pr&&pr.then)pr.then(res,rej);});
    const rate=100,n=Math.ceil(ab.duration*rate),step=ab.sampleRate/rate,out=new Uint8Array(n),chs=[];for(let k=0;k<ab.numberOfChannels;k++)chs.push(ab.getChannelData(k));
    for(let i=0;i<n;i++){let mx=0;const a=Math.floor(i*step),b=Math.min(ab.length,Math.floor((i+1)*step));for(const ch of chs)for(let q=a;q<b;q+=4){const v=Math.abs(ch[q]);if(v>mx)mx=v;}out[i]=Math.min(255,Math.round(Math.sqrt(mx)*255));}
    r.peaks={rate,data:out};if(m.kind==="video")r.noAudio=false;
  }catch(e){if(m.kind==="video")r.noAudio=true;r.noPeaks=true;}
  r.peaking=false;peakBusy=false;if(rt.mode==="timeline")renderTimeline();runPeaks();}
function drawWave(cv){
  const c=tlClip(cv.dataset.wc);if(!c)return;const m=media(c.mediaId),r=m&&mediaRT[m.id];const d=window.devicePixelRatio||1,W=Math.max(1,Math.round(cv.clientWidth*d)),H=Math.max(1,Math.round(cv.clientHeight*d));
  cv.width=W;cv.height=H;const x=cv.getContext("2d");x.clearRect(0,0,W,H);
  const aud=isAudioLane(c.lane),vol=aud?c.level??1:c.vol??1,fi=aud?c.tin:c.afi,fo=aud?c.fout:c.afo,muted=aud?laneSt(c.lane).mute:!videoClipSounds(c);
  const g=k=>clipGain(c,c.start+k*c.dur,vol,fi,fo);
  if(r?.peaks){const P=r.peaks;x.fillStyle=muted?"rgba(139,147,162,.35)":"rgba(62,198,181,.85)";
    for(let px=0;px<W;px++){const k=px/W,ts=(+c.in||0)+k*c.dur*spd(c),i=Math.floor(ts*P.rate);const v=(P.data[i]||0)/255*g(k);const h=Math.max(1,v*H*0.92);x.fillRect(px,(H-h)/2,1,h);}}
  // volume envelope: the line you see is the level; ramps are the fades
  x.strokeStyle=muted?"rgba(230,232,237,.35)":"rgba(255,255,255,.9)";x.lineWidth=1.5*d;x.beginPath();
  const steps=Math.min(400,W);for(let i=0;i<=steps;i++){const k=i/steps,y=(1-g(k))*(H-3*d)+1.5*d;i?x.lineTo(k*W,y):x.moveTo(0,y);}x.stroke();
}
function stageUsesPvc(){return previewActive()||(rt.mode==="timeline"&&rt.outSrc!=="timeline");}
/* snapping */
function snapPts(exId){const p=[0,tl.t,T().duration];for(const c of T().clips)if(c.id!==exId)p.push(c.start,c.start+c.dur);return p;}
function snapT(v,exId){if(!tl.snap)return v;let best=v,bd=8/tl.pps;for(const p of snapPts(exId)){const d=Math.abs(p-v);if(d<bd){bd=d;best=p;}}return best;}
function snapMove(st,dur,exId){if(!tl.snap)return st;let best=st,bd=8/tl.pps;for(const p of snapPts(exId)){let d=Math.abs(p-st);if(d<bd){bd=d;best=p;}d=Math.abs(p-(st+dur));if(d<bd){bd=d;best=p-dur;}}return Math.max(0,best);}
/* editing */
function tlAddClip(m,lane,start){
  if(!m)return;
  if(m.kind==="synth"){toast("Built-in synth sounds can't go on the timeline yet. Upload a sound file, or use an Audio cue.");return;}
  const onSound=isAudioLane(lane);
  if(onSound&&m.kind!=="audio"&&m.kind!=="video"){toast("Only sound files, or the sound of a video, go on the sound lanes. Images and effects go on a surface lane.");return;}
  if(!onSound&&m.kind==="audio"){toast("Sound files go on the sound lanes at the bottom.");return;}
  if(laneSt(lane).lock){toast(`${laneName(lane)} is locked. Unlock it in its lane header to add clips.`);return;}
  const sd=srcDur(m);
  const c={id:uid(),lane,mediaId:m.id,start:snapT(Math.max(0,start)),dur:sd?Math.min(sd,30):5,in:0,tin:0,ttype:"xfade",fout:0,level:1};
  if(m.kind==="video"&&!onSound){c.vol=1;c.afi=0;c.afo=0;ensurePeaks(m);}if(onSound)ensurePeaks(m);
  if(!sd&&(m.kind==="video"||m.kind==="audio"))c.auto=true;
  T().clips.push(c);if(c.start+c.dur>T().duration)T().duration=Math.ceil(c.start+c.dur+5);
  rt.tsel=c.id;save();renderTimeline();renderPanel();
  toast(m.kind==="video"&&!onSound?`“${m.name}” added with its sound. Drag the small squares on the clip to fade the picture (top) or the sound (bottom).`:`“${m.name}” added to ${laneName(lane)} at ${fmtTC(c.start)}. Drag its edges to trim, overlap clips to transition.`);
}
function tlFixAutoDur(m){const sd=srcDur(m);if(!sd||!show?.timeline)return;let ch=false;for(const c of T().clips)if(c.auto&&c.mediaId===m.id){c.dur=Math.min(sd,30);delete c.auto;ch=true;}if(ch){save();renderTimeline();}}
// Cut one clip in two at time t; returns the new right-hand part.
function splitClip(c,t){if(!c||t<=c.start+0.02||t>=c.start+c.dur-0.02||laneSt(c.lane).lock)return null;
  const m=media(c.mediaId),src=m&&(m.kind==="video"||m.kind==="audio");
  const c2={...JSON.parse(JSON.stringify(c)),id:uid(),start:t,dur:c.start+c.dur-t,in:src?srcAt(c,t):0,tin:0};delete c2.link;
  c2.afi=0;c.dur=t-c.start;c.fout=0;c.afo=0;T().clips.push(c2);return c2;}
// With linked selection on, a video and its separated sound are cut, moved and deleted together.
function linkedOf(c){if(!tl.linked||!c?.link)return null;const o=tlClip(c.link);return o&&o.link===c.id?o:null;}
function splitWithLink(c,t){const o=linkedOf(c),c2=splitClip(c,t);if(c2&&o){const o2=splitClip(o,t);if(o2){c2.link=o2.id;o2.link=c2.id;}}return c2;}
function tlSplit(){
  const ids=tlSelIds(),t=tl.t;const cs=(ids.length?ids.map(tlClip):[]).filter(c=>c&&t>c.start+0.02&&t<c.start+c.dur-0.02);
  if(!cs.length){toast("Select a clip and put the playhead inside it to split it (or use the blade, B).");return;}
  let last=null;for(const c of cs)last=splitWithLink(c,t)||last;if(last){rt.tmulti.clear();rt.tsel=last.id;}save();renderTimeline();renderPanel();toast("Split at the playhead.");
}
rt.tmulti=new Set();
function tlSelIds(){const ids=new Set(rt.tmulti);if(rt.tsel)ids.add(rt.tsel);return[...ids].filter(id=>tlClip(id));}
function tlSelect(id,add){const lk=linkedOf(tlClip(id));
  if(!add){rt.tmulti.clear();rt.tsel=id;if(lk)rt.tmulti.add(lk.id);return;}if(rt.tmulti.has(id)||rt.tsel===id){rt.tmulti.delete(id);if(rt.tsel===id){rt.tsel=[...rt.tmulti][0]||null;}}else{if(rt.tsel)rt.tmulti.add(rt.tsel);rt.tmulti.add(id);rt.tsel=id;}}
function tlClearSel(){rt.tsel=null;rt.tmulti.clear();}
function growTo(c){if(c.start+c.dur>T().duration)T().duration=Math.ceil(c.start+c.dur+5);}
function tlDup(){const ids=tlSelIds();if(!ids.length)return;const cs=ids.map(tlClip),lo=Math.min(...cs.map(c=>c.start)),hi=Math.max(...cs.map(c=>c.start+c.dur));
  const made=cs.map(c=>{const c2={...JSON.parse(JSON.stringify(c)),id:uid(),start:c.start+(hi-lo)};delete c2.link;T().clips.push(c2);growTo(c2);return c2;});
  rt.tmulti=new Set(made.map(c=>c.id));rt.tsel=made[made.length-1].id;save();renderTimeline();renderPanel();}
function unlinkRefs(gone){for(const c of T().clips)if(c.link&&gone.has(c.link)){delete c.link;if(!isAudioLane(c.lane))c.mute=false;}}
function tlDel(ripple){const ids=tlSelIds().filter(id=>!laneSt(tlClip(id).lane).lock);if(!ids.length)return;const gone=new Set(ids),cs=ids.map(tlClip);
  show.timeline.clips=T().clips.filter(x=>!gone.has(x.id));unlinkRefs(gone);
  if(ripple)for(const c of cs){for(const o of T().clips)if(o.lane===c.lane&&o.start>=c.start+c.dur-1e-6)o.start=Math.max(0,o.start-c.dur);}
  tlClearSel();save();renderTimeline();renderPanel();toast(`${ids.length===1?"Clip":ids.length+" clips"} deleted${ripple?" and the gap closed":""}.`,{label:"Undo",fn:undo});}
let tlClipboard=null;
function tlCopy(cut){const ids=tlSelIds();if(!ids.length)return;const cs=ids.map(tlClip),lo=Math.min(...cs.map(c=>c.start));tlClipboard=cs.map(c=>({...JSON.parse(JSON.stringify(c)),off:c.start-lo}));
  if(cut)tlDel();else toast(`${cs.length===1?"Clip":cs.length+" clips"} copied. Move the playhead and press ⌘V to paste.`);}
function tlPaste(){if(!tlClipboard)return;const made=tlClipboard.map(c=>{const c2={...JSON.parse(JSON.stringify(c)),id:uid(),start:tl.t+c.off};delete c2.off;delete c2.link;if(!laneList().some(l=>l.id===c2.lane))return null;T().clips.push(c2);growTo(c2);return c2;}).filter(Boolean);
  if(!made.length)return;rt.tmulti=new Set(made.map(c=>c.id));rt.tsel=made[0].id;save();renderTimeline();renderPanel();toast(`Pasted at ${fmtTC(tl.t)}.`);}
function tlTrimTo(side){const c=tlClip(rt.tsel),t=tl.t;if(!c||t<=c.start+0.02||t>=c.start+c.dur-0.02){toast("Select a clip and put the playhead inside it to trim to the playhead.");return;}
  const m=media(c.mediaId),src=m&&(m.kind==="video"||m.kind==="audio");
  if(side==="start"){const k=t-c.start;c.start=t;c.dur-=k;if(src)c.in=(+c.in||0)+k*spd(c);}else c.dur=t-c.start;save();renderTimeline();renderPanel();}
function tlSeparate(){const c=tlClip(rt.tsel);if(!c)return;const m=media(c.mediaId);if(!m||m.kind!=="video"||isAudioLane(c.lane))return;
  const busy=l=>T().clips.some(o=>o.lane===l&&o.start<c.start+c.dur&&o.start+o.dur>c.start),lane=audioLanes().map(a=>a[0]).find(l=>!busy(l))||(T().audioLanes=audioLanes().length+1,"a"+T().audioLanes);
  const a={id:uid(),lane,mediaId:m.id,start:c.start,dur:c.dur,in:+c.in||0,speed:c.speed,tin:+c.afi||0,ttype:"xfade",fout:+c.afo||0,level:c.vol??1,link:c.id,route:c.route?JSON.parse(JSON.stringify(c.route)):undefined};if(!a.route)delete a.route;if(!a.speed)delete a.speed;
  T().clips.push(a);c.mute=true;c.link=a.id;rt.tmulti.clear();rt.tsel=a.id;save();renderTimeline();renderPanel();
  toast(`Sound separated onto ${laneName(lane)}. Move, trim or fade it on its own; the video stays silent.`);}
function tlRejoin(){const c=tlClip(rt.tsel);if(!c||!c.link)return;const o=tlClip(c.link);const v=isAudioLane(c.lane)?o:c,a=isAudioLane(c.lane)?c:o;
  if(v){v.mute=false;delete v.link;if(a){v.vol=a.level??1;v.afi=+a.tin||0;v.afo=+a.fout||0;}}if(a)show.timeline.clips=T().clips.filter(x=>x!==a);
  rt.tmulti.clear();rt.tsel=v?.id||null;save();renderTimeline();renderPanel();toast("Sound joined back to the video.");}
function tlNudge(sec){const ids=tlSelIds().filter(id=>!laneSt(tlClip(id).lane).lock);if(!ids.length)return;const cs=ids.map(tlClip),lo=Math.min(...cs.map(c=>c.start));const k=Math.max(sec,-lo);cs.forEach(c=>{c.start=+(c.start+k).toFixed(4);growTo(c);});save();renderTimeline();renderPanel();}
function tlToggleOff(){const ids=tlSelIds();if(!ids.length)return;const on=ids.some(id=>!tlClip(id).off);ids.forEach(id=>{const c=tlClip(id);if(on)c.off=true;else delete c.off;});save();renderTimeline();renderPanel();toast(on?"Clip disabled: it stays on the timeline but doesn't play. Press D again to turn it back on.":"Clip enabled.");}
function tlSetRange(k){const TT=T(),rg=TT.range||(TT.range={in:0,out:TT.duration});rg[k]=+tl.t.toFixed(3);if(rg.out<=rg.in){if(k==="in")rg.out=TT.duration;else rg.in=0;}save();renderTimeline();toast(`${k==="in"?"In":"Out"} point at ${fmtTC(rg[k])}. Play stays between in and out${tl.loopRange?" and loops":""}.`);}
function tlClearRange(){delete T().range;save();renderTimeline();toast("In and out points cleared.");}
function tlZoomFit(){const sc=$("#tlScroll");if(!sc)return;tl.pps=clamp((sc.clientWidth-190)/Math.max(1,T().duration),5,200);renderTimeline();}
// Lane a media item lands on: the selected clip's lane if it fits, otherwise the first lane that takes that kind.
function targetLane(m){const sel=tlClip(rt.tsel),snd=m.kind==="audio";if(sel&&isAudioLane(sel.lane)===snd&&!laneSt(sel.lane).lock)return sel.lane;
  return laneList().find(l=>!l.hdr&&!!l.audio===snd&&!laneSt(l.id).lock)?.id||null;}
// Overwrite replaces whatever is on the lane in that time; Insert pushes later clips along; Append adds at the lane's end.
function tlPlace(mode){const m=media(rt.selMedia);if(!m){toast("Select something in the media library first (click its tile).");return;}
  if(m.kind==="synth"){toast("Built-in synth sounds can't go on the timeline yet.");return;}
  const lane=targetLane(m);if(!lane){toast("There's no unlocked lane for that kind of media.");return;}
  const sd=srcDur(m),dur=sd?Math.min(sd,30):5;let start=tl.t;
  const onLane=()=>T().clips.filter(c=>c.lane===lane);
  if(mode==="append")start=Math.max(0,...onLane().map(c=>c.start+c.dur));
  if(mode==="insert"){const under=onLane().find(c=>start>c.start+0.02&&start<c.start+c.dur-0.02);if(under)splitClip(under,start);for(const c of onLane())if(c.start>=start-1e-6){c.start+=dur;growTo(c);}}
  if(mode==="overwrite"){const end=start+dur;for(const c of onLane()){const ce=c.start+c.dur;if(ce<=start+1e-6||c.start>=end-1e-6)continue;
      if(c.start<start&&ce>end){const r=splitClip(c,end);c.dur=start-c.start;void r;}
      else if(c.start<start)c.dur=start-c.start;
      else if(ce>end){const k=end-c.start,src=m&&(media(c.mediaId)?.kind==="video"||media(c.mediaId)?.kind==="audio");c.start=end;c.dur-=k;if(src)c.in=(+c.in||0)+k*spd(c);}
      else show.timeline.clips=T().clips.filter(x=>x!==c);}}
  const c={id:uid(),lane,mediaId:m.id,start,dur,in:0,tin:0,ttype:"xfade",fout:0,level:1};if(m.kind==="video"&&!isAudioLane(lane)){c.vol=1;c.afi=0;c.afo=0;}if(!sd&&(m.kind==="video"||m.kind==="audio"))c.auto=true;
  T().clips.push(c);growTo(c);rt.tmulti.clear();rt.tsel=c.id;if(mode!=="append")tlSeek(start+dur);save();renderTimeline();renderPanel();
  toast(`${{insert:"Inserted",overwrite:"Placed over",append:"Added at the end of"}[mode]} ${laneName(lane)}: “${m.name}”.`);}
// Ctrl/⌘T: a one-second crossfade where the clip at the playhead meets the one before it on the same lane.
function tlAddTransition(){const t=tl.t,TT=T();const lane=tlClip(rt.tsel)?.lane;
  const cands=TT.clips.filter(c=>(!lane||c.lane===lane)&&Math.abs(c.start-t)<Math.max(0.6,12/tl.pps)).sort((a,b)=>Math.abs(a.start-t)-Math.abs(b.start-t));
  const c=cands[0];if(!c){toast("Put the playhead on the point where two clips meet, then press ⌘T.");return;}
  const prev=TT.clips.filter(o=>o.lane===c.lane&&o!==c&&o.start<c.start&&Math.abs(o.start+o.dur-c.start)<0.05).sort((a,b)=>b.start-a.start)[0];
  const L=Math.min(1,c.dur/2),aud=isAudioLane(c.lane);
  if(prev){const pm=media(prev.mediaId),psd=srcDur(pm),room=psd?(psd-(+prev.in||0))/spd(prev)-prev.dur:Infinity;
    if(room>=L)prev.dur+=L;else if((+c.in||0)>=L*spd(c)){c.start-=L;c.dur+=L;c.in-=L*spd(c);}else{prev.fout=Math.max(+prev.fout||0,L/2);}}
  if(aud)c.tin=L;else{c.tin=L;if(!c.ttype||c.ttype==="cut")c.ttype="xfade";}
  if(prev&&aud)prev.fout=Math.max(+prev.fout||0,L);
  save();renderTimeline();renderPanel();toast(prev?"Crossfade added between the two clips.":"Fade-in added to the clip.");}
function tlMarker(){const TT=T();TT.markers=TT.markers||[];const mk={id:uid(),t:+tl.t.toFixed(3),name:"Marker "+(TT.markers.length+1)};TT.markers.push(mk);TT.markers.sort((a,b)=>a.t-b.t);save();renderTimeline();renderPanel();toast(`${mk.name} added at ${fmtTC(mk.t)}. Rename it in the panel.`);}
function editPoints(){const p=new Set([0,T().duration]);for(const c of T().clips){p.add(+c.start.toFixed(3));p.add(+(c.start+c.dur).toFixed(3));}for(const mk of T().markers||[])p.add(mk.t);return[...p].sort((a,b)=>a-b);}
function tlJump(dir){const pts=editPoints(),t=tl.t;const n=dir>0?pts.find(x=>x>t+0.005):[...pts].reverse().find(x=>x<t-0.005);if(n!=null)tlSeek(n);}
function tlPickSurface(sf){
  const on=T().clips.filter(c=>c.lane===sf.id&&tl.t>=c.start&&tl.t<c.start+c.dur).sort((a,b)=>b.start-a.start)[0];
  if(!on){toast(`Nothing plays on ${sf.name} at ${fmtTC(tl.t)}. Drag media onto its lane.`);return;}
  rt.tsel=on.id;renderTimeline();renderPanel();
}
/* timeline dock UI */
const ICON_EYE='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8z" fill="none" stroke="currentColor" stroke-width="1.4"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
const ICON_SPK='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2 6h3l4-3v10L5 10H2z" fill="currentColor"/><path d="M11 5.5a3.5 3.5 0 010 5M12.5 3.5a6 6 0 010 9" fill="none" stroke="currentColor" stroke-width="1.3"/></svg>';
const ICON_LOCK='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="3" y="7" width="10" height="7" rx="1.5" fill="currentColor"/><path d="M5 7V5a3 3 0 016 0v2" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';
function clipHTML(c){
  const m=media(c.mediaId),pps=tl.pps,sel=rt.tsel===c.id||rt.tmulti.has(c.id),aud=isAudioLane(c.lane),lk=laneSt(c.lane).lock;
  const vid=m&&m.kind==="video"&&!aud,band=aud||(vid&&!c.link&&mediaRT[m.id]?.noAudio!==true);
  if(m&&(aud||vid))ensurePeaks(m);
  const w=Math.max(6,c.dur*pps),fx=v=>Math.min(Math.max(0,+v||0),c.dur)*pps;
  const vi=aud?0:fx(c.ttype==="cut"?0:c.tin),vo=aud?0:fx(c.fout),ai=fx(aud?c.tin:c.afi),ao=fx(aud?c.fout:c.afo);
  const label=`${esc(m?.name||"Missing media")}${spd(c)!==1?` · ${Math.round(spd(c)*100)}%`:""}${c.off?" · off":""}${clipSpanSids(c)?` · across ${clipSpanSids(c).length}`:""}${vid&&c.mute&&!c.link?" · muted":""}${vid&&c.link?" · sound separated":""}${aud&&m?.kind==="video"?" · sound":""}`;
  return`<div class="clip${sel?" sel":""}${c.off?" off":""}${aud?" aud":""}${band&&!aud?" hasaud":""}${lk?" locked":""}${!m||missing(m)||mediaRT[m?.id]?.err?" bad":""}" data-clip="${c.id}" style="left:${c.start*pps}px;width:${w}px" title="${esc(m?.name||"Missing media")} · ${fmtTC(c.start)} → ${fmtTC(c.start+c.dur)}">
    ${aud?"":`<span class="cl-th" style="${m?swatchCSS(m):"background:#333"}"></span>`}
    ${vi>0?`<span class="cl-in" style="width:${vi}px"></span>`:""}${vo>0?`<span class="cl-out" style="width:${vo}px"></span>`:""}
    <span class="cl-nm">${label}</span>
    ${band?`<span class="cl-band"><canvas class="cl-wave" data-wc="${c.id}"></canvas></span>`:""}
    ${!lk&&!aud&&w>28?`<i class="cl-fh vi" data-fh="vi" style="left:${vi}px" title="Drag to fade the picture in"></i><i class="cl-fh vo" data-fh="vo" style="right:${vo}px" title="Drag to fade the picture out"></i>`:""}
    ${!lk&&band&&w>28?`<i class="cl-fh ai" data-fh="ai" style="left:${ai}px" title="Drag to fade the sound in"></i><i class="cl-fh ao" data-fh="ao" style="right:${ao}px" title="Drag to fade the sound out"></i>`:""}
    ${lk?"":`<i class="cl-h l" data-h="l"></i><i class="cl-h r" data-h="r"></i>`}</div>`;
}
function laneHead(l){const ls=laneSt(l.id);
  return`<div class="tl-head" title="${esc(l.name)}"><span class="chip" style="background:${l.color}"></span><span class="nm">${esc(l.name)}</span>
    <span class="ln-acts"><button class="ln-btn${ls.mute?" on":""}" data-act="ln-mute" data-id="${l.id}" aria-pressed="${!!ls.mute}" title="${l.audio?(ls.mute?"Unmute this lane":"Mute this lane"):(ls.mute?"Show this lane":"Hide this lane")}" aria-label="${l.audio?"Mute":"Hide"} ${esc(l.name)}">${l.audio?ICON_SPK:ICON_EYE}</button><button class="ln-btn${ls.lock?" on":""}" data-act="ln-lock" data-id="${l.id}" aria-pressed="${!!ls.lock}" title="${ls.lock?"Unlock this lane":"Lock this lane so clips can't be moved"}" aria-label="Lock ${esc(l.name)}">${ICON_LOCK}</button></span></div>`;}
function renderTimeline(){
  const dock=$("#tlDock");if(!dock)return;if(rt.mode!=="timeline"){dock.hidden=true;return;}dock.hidden=false;
  const sc=$("#tlScroll"),sl=sc?.scrollLeft||0,st=sc?.scrollTop||0;
  const TT=T(),pps=tl.pps,W=Math.max(TT.duration*pps+60,320),lanes=laneList();
  const lab=[0.5,1,2,5,10,15,30,60,120].find(v=>v*pps>=72)||300,minor=lab*pps/5>=8?lab/5:lab;
  let ticks="";for(let x=0;x<=TT.duration+1e-6;x=+(x+minor).toFixed(4)){const maj=Math.abs(x/lab-Math.round(x/lab))<1e-6;
    ticks+=`<i class="tk${maj?" maj":""}" style="left:${x*pps}px">${maj?`<b>${fmtTC(x).replace(/\.00$/,"")}</b>`:""}</i>`;}
  const marks=(TT.markers||[]).map(mk=>`<button class="tl-mk" data-act="mk-go" data-id="${mk.id}" style="left:${mk.t*pps}px" title="${esc(mk.name)} · ${fmtTC(mk.t)}"><span>${esc(mk.name)}</span></button>`).join("");
  const clipsBy={};for(const c of TT.clips)(clipsBy[c.lane]=clipsBy[c.lane]||[]).push(c);
  const nSel=tlSelIds().length;
  const rg=TT.range,hasM=!!media(rt.selMedia);
  dock.innerHTML=`<div class="tl-bar">
      <button class="btn" data-act="tl-home" title="Go to start (Home)" aria-label="Go to start">⏮</button>
      <button class="btn" data-act="tl-prev" title="Previous edit point (↑)" aria-label="Previous edit point">⇤</button>
      <button class="btn primary tl-play" id="tlPlay" data-act="tl-play" aria-keyshortcuts="Space"></button>
      <button class="btn" data-act="tl-next" title="Next edit point (↓)" aria-label="Next edit point">⇥</button>
      <button class="tl-tc mono" id="tlTC" data-act="tl-tc" title="Click to type a time">${fmtTC(tl.t)}</button><span class="tl-len mono">/ ${fmtTC(TT.duration)}</span>
      ${rg?`<span class="tl-rg mono" title="In and out points (I, O; ⌥X clears)">In ${fmtTC(rg.in)} · Out ${fmtTC(rg.out)}</span><label class="inline tl-ck"><input id="tlLoopR" type="checkbox" ${tl.loopRange?"checked":""}> Loop</label><button class="btn ghost" data-act="tl-rg-clear" aria-label="Clear in and out">✕</button>`:""}
      <span class="tl-sp"></span>
      <label class="inline tl-ck"><input id="tlSnap" type="checkbox" ${tl.snap?"checked":""}> Snap</label>
      <label class="inline tl-ck"><input id="tlOutl" type="checkbox" ${tl.outlines!==false?"checked":""}> Outlines</label>
      <label class="inline tl-zoom">Zoom <input id="tlZoom" type="range" min="5" max="200" step="1" value="${pps}" aria-label="Timeline zoom"></label>
      <button class="btn" data-act="tl-fit" title="Zoom to fit the whole timeline (⇧Z)">Fit</button>
      <button class="btn" id="tlSend" data-act="tl-send"></button></div>
    <div class="tl-bar tl-bar2">
      <span class="seg tl-toolseg" role="radiogroup" aria-label="Tool">
        <button role="radio" data-act="tl-tool" data-v="select" aria-checked="${tl.tool!=="blade"}" title="Selection tool (A)">↖ Select</button>
        <button role="radio" data-act="tl-tool" data-v="blade" aria-checked="${tl.tool==="blade"}" title="Blade tool (B): click a clip to cut it there">✂ Blade</button></span>
      <button class="btn${tl.linked?" on":""}" data-act="tl-linked" aria-pressed="${!!tl.linked}" title="Linked selection: a video and its separated sound move, cut and delete together">🔗 Linked</button>
      <span class="tl-tools" role="group" aria-label="Edit">
        <button class="btn" data-act="tl-split" title="Split the selected clips at the playhead (S, or ⌘B)">Split</button>
        <button class="btn" data-act="tl-trim-s" title="Trim the clip's start to the playhead ([)" aria-label="Trim start to playhead">⇥|</button>
        <button class="btn" data-act="tl-trim-e" title="Trim the clip's end to the playhead (])" aria-label="Trim end to playhead">|⇤</button>
        <button class="btn" data-act="tl-ripple" title="Delete and close the gap (⇧Delete)" ${nSel?"":"disabled"}>Ripple delete</button>
        <button class="btn" data-act="tl-trans" title="Crossfade at the edit under the playhead (⌘T)">+ Transition</button>
        <button class="btn" data-act="tl-marker" title="Add a marker at the playhead (⇧M)">+ Marker</button></span>
      <span class="tl-tools" role="group" aria-label="Add selected media">
        <button class="btn" data-act="tl-place" data-v="insert" ${hasM?"":"disabled"} title="Insert the selected library item at the playhead, pushing later clips along (F9)">Insert</button>
        <button class="btn" data-act="tl-place" data-v="overwrite" ${hasM?"":"disabled"} title="Place the selected library item at the playhead over what's there (F10)">Overwrite</button>
        <button class="btn" data-act="tl-place" data-v="append" ${hasM?"":"disabled"} title="Add the selected library item at the end of its lane (⇧F12)">Append</button></span></div>
    <div class="tl-scroll" id="tlScroll"><div class="tl-inner" style="width:${170+W}px">
      <div class="tl-row tl-ruler"><div class="tl-head tl-corner">Time</div><div class="tl-track" id="tlRuler" style="width:${W}px">${rg?`<span class="tl-range" style="left:${rg.in*pps}px;width:${Math.max(1,(rg.out-rg.in)*pps)}px"></span>`:""}${ticks}${marks}<span class="tl-end" style="left:${TT.duration*pps}px" title="End of timeline"></span></div></div>
      ${lanes.map(l=>l.hdr?`<div class="tl-row tl-grp"><div class="tl-head">${esc(l.name)}${l.sound?`<span class="ln-acts"><button class="ln-btn wide" data-act="tl-lane-add" title="Add a sound lane">+</button><button class="ln-btn wide" data-act="tl-lane-del" title="Remove the last sound lane (if it's empty)">−</button></span>`:""}</div><div class="tl-track" style="width:${W}px"></div></div>`
        :`<div class="tl-row${l.audio?" aud":" vis"}${laneSt(l.id).mute?" muted":""}" data-lane="${l.id}">${laneHead(l)}
          <div class="tl-track" data-lane="${l.id}" style="width:${W}px">${(clipsBy[l.id]||[]).sort((a,b)=>a.start-b.start).map(clipHTML).join("")}</div></div>`).join("")}
      ${(TT.markers||[]).map(mk=>`<div class="tl-mkline" style="left:${170+mk.t*pps}px"></div>`).join("")}
      ${rg?`<div class="tl-rgline" style="left:${170+rg.in*pps}px"></div><div class="tl-rgline" style="left:${170+rg.out*pps}px"></div>`:""}
      <div class="tl-box" id="tlBox" hidden></div>
      <div class="tl-ph" id="tlPh" style="left:${170+tl.t*pps}px"><span></span></div>
    </div></div>
    <p class="note tl-help"><kbd>A</kbd>/<kbd>B</kbd> select/blade · <kbd>I</kbd><kbd>O</kbd> in/out · <kbd>,</kbd><kbd>.</kbd> nudge a frame · <kbd>D</kbd> disable · <kbd>⌘T</kbd> transition · <kbd>Space</kbd> play · <kbd>J</kbd><kbd>K</kbd><kbd>L</kbd> back/stop/play · <kbd>↑</kbd><kbd>↓</kbd> edit points · <kbd>S</kbd> split · <kbd>[</kbd><kbd>]</kbd> trim to playhead · <kbd>⇧</kbd>-click select more · <kbd>⌘C</kbd>/<kbd>⌘V</kbd> copy/paste · <kbd>⇧Delete</kbd> ripple delete · <kbd>⇧M</kbd> marker. Drag the small squares on a clip to fade picture (top) or sound (bottom); drag the white line to set the volume.</p>`;
  document.body.classList.toggle("blade",tl.tool==="blade");
  const nsc=$("#tlScroll");nsc.scrollLeft=sl;nsc.scrollTop=st;renderTLTransport();
  requestAnimationFrame(()=>dock.querySelectorAll("canvas.cl-wave").forEach(drawWave));
}
function renderTLTransport(){
  const p=$("#tlPlay");if(p)p.textContent=tl.playing?"⏸ Pause":"▶ Play";
  const s=$("#tlSend");if(s&&rt.liveEdit){s.hidden=true;}else if(s){s.hidden=false;const on=rt.outSrc==="timeline";s.setAttribute("aria-pressed",on);s.textContent=on?"Projectors: showing timeline":"Projectors: showing cues";s.title=on?"Switch the projectors back to the cue show; Play then only previews here":"Send the timeline to the projectors";}
}
function updateTL(){
  if(rt.mode!=="timeline")return;const ph=$("#tlPh"),tc=$("#tlTC");if(!ph)return;
  ph.style.left=(170+tl.t*tl.pps)+"px";if(tc)tc.textContent=fmtTC(tl.t);
  if(tl.playing&&!tdrag){const sc=$("#tlScroll"),x=tl.t*tl.pps;if(x>sc.scrollLeft+sc.clientWidth-170-40||x<sc.scrollLeft)sc.scrollLeft=Math.max(0,x-60);}
}
let tdrag=null;
const dockEl=$("#tlDock");
function refreshClip(c){const el=document.querySelector(`.clip[data-clip="${c.id}"]`);if(!el)return null;const t=document.createElement("div");t.innerHTML=clipHTML(c);const n=t.firstElementChild;el.replaceWith(n);n.querySelectorAll("canvas.cl-wave").forEach(drawWave);return n;}
dockEl.addEventListener("pointerdown",e=>{
  if(e.button!==0)return;
  if(e.target.closest("button"))return;
  const clipEl=e.target.closest(".clip");
  if(clipEl&&tl.tool==="blade"&&!e.target.dataset.h){const c=tlClip(clipEl.dataset.clip);if(!c)return;e.preventDefault();
    const tr=clipEl.parentElement.getBoundingClientRect();let t=(e.clientX-tr.left)/tl.pps;if(Math.abs(t-tl.t)*tl.pps<6)t=tl.t;
    const targets=e.shiftKey?T().clips.filter(x=>t>x.start+0.02&&t<x.start+x.dur-0.02):[c];let last=null;
    for(const x of targets)last=splitWithLink(x,t)||last;if(!last){toast("Too close to the clip's edge to cut there.");return;}
    rt.tmulti.clear();rt.tsel=last.id;save();renderTimeline();renderPanel();return;}
  if(clipEl){const c=tlClip(clipEl.dataset.clip);if(!c)return;e.preventDefault();
    const add=e.shiftKey||e.metaKey||e.ctrlKey,inSel=rt.tsel===c.id||rt.tmulti.has(c.id),lk=laneSt(c.lane).lock;
    if(add){tlSelect(c.id,true);renderTimeline();renderPanel();return;}
    if(!inSel)tlSelect(c.id,false);else rt.tsel=c.id;
    if(lk){renderTimeline();renderPanel();toast(`${laneName(c.lane)} is locked. Unlock it in its lane header to move clips.`);return;}
    const fh=e.target.dataset.fh,h=e.target.dataset.h;
    // drag the volume line inside the sound band
    const band=e.target.closest(".cl-band");let vol=false;
    if(band&&!fh){const r=band.getBoundingClientRect(),aud=isAudioLane(c.lane),k=(e.clientX-r.left)/r.width,g=clipGain(c,c.start+k*c.dur,aud?c.level??1:c.vol??1,aud?c.tin:c.afi,aud?c.fout:c.afo);
      if(Math.abs((r.top+(1-g)*r.height)-e.clientY)<6)vol={top:r.top,h:r.height};}
    const ids=tlSelIds();
    tdrag={kind:"clip",c,el:clipEl,mode:fh?"fade":vol?"vol":h==="l"?"l":h==="r"?"r":"move",fh,vol,x0:e.clientX,y0:e.clientY,
      o:{start:c.start,dur:c.dur,in:+c.in||0,lane:c.lane},group:ids.length>1&&!fh&&!vol&&!h?ids.filter(id=>id!==c.id).map(id=>{const x=tlClip(id);return{c:x,start:x.start};}).filter(g=>!laneSt(g.c.lane).lock):null,moved:false};
    dockEl.setPointerCapture(e.pointerId);
    document.querySelectorAll(".clip.sel").forEach(x=>{if(!ids.includes(x.dataset.clip))x.classList.remove("sel");});clipEl.classList.add("sel");renderPanel();return;}
  const ruler=e.target.closest("#tlRuler"),track=e.target.closest(".tl-track[data-lane]");
  if(ruler){const r=ruler.getBoundingClientRect();tlSeek((e.clientX-r.left)/tl.pps);tdrag={kind:"scrub",left:r.left};dockEl.setPointerCapture(e.pointerId);return;}
  // empty lane: click moves the playhead; drag draws a box that selects every clip it touches
  if(track){const r=track.getBoundingClientRect();tdrag={kind:"box",x0:e.clientX,y0:e.clientY,seek:(e.clientX-r.left)/tl.pps,add:e.shiftKey||e.metaKey,moved:false};dockEl.setPointerCapture(e.pointerId);}
});
dockEl.addEventListener("pointermove",e=>{
  if(!tdrag)return;
  if(tdrag.kind==="scrub"){tlSeek((e.clientX-tdrag.left)/tl.pps);return;}
  if(tdrag.kind==="box"){const d=tdrag;if(!d.moved&&Math.hypot(e.clientX-d.x0,e.clientY-d.y0)<5)return;d.moved=true;
    const inner=dockEl.querySelector(".tl-inner"),ir=inner.getBoundingClientRect(),bx=$("#tlBox");const x0=Math.min(d.x0,e.clientX),x1=Math.max(d.x0,e.clientX),y0=Math.min(d.y0,e.clientY),y1=Math.max(d.y0,e.clientY);
    bx.hidden=false;bx.style.left=(x0-ir.left)+"px";bx.style.top=(y0-ir.top)+"px";bx.style.width=(x1-x0)+"px";bx.style.height=(y1-y0)+"px";
    const hit=new Set(d.add?tlSelIds():[]);dockEl.querySelectorAll(".clip").forEach(el=>{const r=el.getBoundingClientRect();const c=tlClip(el.dataset.clip);if(!c||laneSt(c.lane).lock)return;if(r.right>x0&&r.left<x1&&r.bottom>y0&&r.top<y1)hit.add(c.id);});
    rt.tmulti=new Set(hit);rt.tsel=[...hit][0]||null;dockEl.querySelectorAll(".clip").forEach(el=>el.classList.toggle("sel",hit.has(el.dataset.clip)));return;}
  const d=tdrag,c=d.c,o=d.o,dt=(e.clientX-d.x0)/tl.pps,m=media(c.mediaId),src=m&&(m.kind==="video"||m.kind==="audio");
  if(Math.abs(e.clientX-d.x0)>2||Math.abs(e.clientY-d.y0)>2)d.moved=true;if(!d.moved)return;
  if(d.mode==="fade"){const r=d.el.getBoundingClientRect(),aud=isAudioLane(c.lane);
    const inSide=d.fh==="vi"||d.fh==="ai",len=clamp(inSide?(e.clientX-r.left)/tl.pps:(r.right-e.clientX)/tl.pps,0,c.dur);
    const key={vi:"tin",vo:"fout",ai:aud?"tin":"afi",ao:aud?"fout":"afo"}[d.fh];c[key]=+len.toFixed(2);if(key==="tin"&&!aud&&c.ttype==="cut")c.ttype="xfade";
    d.el=refreshClip(c)||d.el;return;}
  if(d.mode==="vol"){const v=+clamp(1-(e.clientY-d.vol.top)/d.vol.h,0,1).toFixed(2);if(isAudioLane(c.lane))c.level=v;else c.vol=v;d.el=refreshClip(c)||d.el;return;}
  if(d.mode==="move"){c.start=snapMove(Math.max(0,o.start+dt),o.dur,c.id);const sh=c.start-o.start;
    if(d.group){const minS=Math.min(...d.group.map(g=>g.start));const k=Math.max(sh,-minS);if(k!==sh)c.start=o.start+k;
      for(const g of d.group){g.c.start=Math.max(0,g.start+(c.start-o.start));const ge=document.querySelector(`.clip[data-clip="${g.c.id}"]`);if(ge)ge.style.left=g.c.start*tl.pps+"px";}}
    else{const row=document.elementFromPoint(e.clientX,e.clientY)?.closest(".tl-row[data-lane]"),nl=row?.dataset.lane,mk=m?.kind;
      const ok=nl&&nl!==c.lane&&!laneSt(nl).lock&&(isAudioLane(nl)?(mk==="audio"||mk==="video"):mk!=="audio")&&(isAudioLane(nl)===isAudioLane(o.lane));
      if(ok){c.lane=nl;row.querySelector(".tl-track").appendChild(d.el);}}}
  else if(d.mode==="l"){let ns=snapT(clamp(o.start+dt,0,o.start+o.dur-0.1),c.id);if(src)ns=Math.max(ns,o.start-o.in/spd(c));const k=ns-o.start;c.start=ns;c.dur=o.dur-k;if(src)c.in=Math.max(0,o.in+k*spd(c));}
  else{const ne=snapT(o.start+o.dur+dt,c.id);c.dur=Math.max(0.1,ne-o.start);const sd=srcDur(m);if(sd)c.dur=Math.min(c.dur,(sd-(+c.in||0))/spd(c));}
  d.el.style.left=c.start*tl.pps+"px";d.el.style.width=Math.max(6,c.dur*tl.pps)+"px";
});
const tlUp=()=>{if(!tdrag)return;const d=tdrag;tdrag=null;
  if(d.kind==="box"){const bx=$("#tlBox");if(bx)bx.hidden=true;if(!d.moved){tlSeek(d.seek);if(rt.tsel||rt.tmulti.size){tlClearSel();dockEl.querySelectorAll(".clip.sel").forEach(x=>x.classList.remove("sel"));}}renderPanel();if(d.moved)renderTimeline();return;}if(d.kind==="clip"&&d.moved){delete d.c.auto;growTo(d.c);if(d.group)d.group.forEach(g=>growTo(g.c));save();renderTimeline();renderPanel();}};
dockEl.addEventListener("pointerup",tlUp);dockEl.addEventListener("pointercancel",tlUp);
dockEl.addEventListener("wheel",e=>{if(e.ctrlKey||e.metaKey){e.preventDefault();const sc=$("#tlScroll"),r=sc.getBoundingClientRect(),tAt=(e.clientX-r.left-170+sc.scrollLeft)/tl.pps;
  tl.pps=clamp(tl.pps*Math.exp(-clamp(e.deltaY,-50,50)*0.01),5,200);renderTimeline();const s2=$("#tlScroll");s2.scrollLeft=Math.max(0,tAt*tl.pps-(e.clientX-r.left-170));}},{passive:false});
/* clip inspector */
function provFrameHTML(){
  const pv=frameProv();if(!pv)return"";const f=normFrame(pv.get(false)),m=media(pv.mid),s=surf(pv.sid);
  return`<div class="vtrim cue-frame"><div class="vt-head"><span class="lab">Framing for this clip</span>${pv.own?`<span class="tag">custom</span>`:`<span class="tag dim">surface default</span>`}</div>
    <div class="seg fitseg" role="group" aria-label="How the media fills the surface">${Object.entries(FIT).map(([k,l])=>`<button data-act="cfr-fit" data-v="${k}" aria-pressed="${f.fit===k}" title="${FIT_TIP[k]}">${l}</button>`).join("")}</div>
    <div class="vt-grid">
      <label for="cfr-zoom">Size</label><div class="inline"><input id="cfr-zoom" type="range" min="0.05" max="10" step="0.01" data-cfr="zoom" value="${f.zoom}"><input type="number" class="frn" data-frk="zoom" step="1" min="1" value="${Math.round(f.zoom*100)}" aria-label="Size percent"><span class="fru">%</span></div>
      <label for="cfr-x">Left ↔ right</label><div class="inline"><input id="cfr-x" type="range" min="-3" max="3" step="0.005" data-cfr="x" value="${f.x}"><input type="number" class="frn" data-frk="x" step="1" value="${Math.round(f.x*100)}" aria-label="Offset"><span class="fru"></span></div>
      <label for="cfr-y">Up ↕ down</label><div class="inline"><input id="cfr-y" type="range" min="-3" max="3" step="0.005" data-cfr="y" value="${f.y}"><input type="number" class="frn" data-frk="y" step="1" value="${Math.round(f.y*100)}" aria-label="Offset"><span class="fru"></span></div></div>
    <div class="btns" style="margin-top:0"><button class="btn" data-act="cfr-rot" data-v="-1">⟲ 90°</button><button class="btn" data-act="cfr-rot" data-v="1">⟳ 90°</button>
      <button class="btn" data-act="cfr-flip" data-v="fh" aria-pressed="${f.fh}">Flip ↔</button><button class="btn" data-act="cfr-flip" data-v="fv" aria-pressed="${f.fv}">Flip ↕</button>${pv.own?`<button class="btn ghost" data-act="cfr-reset">Use surface default</button>`:""}</div>
    <p class="note">${pv.span?`One picture across ${pv.span.length} surfaces (outlined in orange). Drag inside the dashed box to move it over the set, or a white corner to size it.`:s.outputId!==rt.out?`${esc(s.name)} is on ${esc(output(s.outputId).name)}. Pick that projector above the stage to drag it there.`:`On the stage, drag inside the dashed box to move “${esc(m.name)}”, or drag a white corner to resize it.`}</p></div>`;
}
function timelinePanel(){
  const TT=T(),c=tlClip(rt.tsel),ids=tlSelIds();
  let h=`<div class="sec"><div class="sec-head"><h3>Timeline</h3></div>
    <div class="vt-grid"><label for="tl-dur">Length (s)</label><input id="tl-dur" type="number" min="1" step="1" value="${TT.duration}">
      <label for="tl-loop">At the end</label><select id="tl-loop">${opt("0","Stop",TT.loop?"1":"0")}${opt("1","Loop back to the start",TT.loop?"1":"0")}</select></div>
    <p class="note">${rt.liveEdit?"Live edits is on, so the projectors show this timeline while you work here.":"Blind: the projectors keep the cue show while you edit. Press Play or a Timeline cue to send it out."} To run it during a show, add a <b>Timeline</b> cue. <kbd>Space</kbd> plays the timeline here; the GO button still fires cues.</p></div>`;
  const mks=TT.markers||[];
  if(mks.length)h+=`<div class="sec"><div class="sec-head"><h3>Markers</h3><div class="acts"><button class="btn" data-act="tl-marker">+ At playhead</button></div></div>
    <div class="mk-list">${mks.map(mk=>`<div class="mk-row"><button class="btn ghost" data-act="mk-go" data-id="${mk.id}" title="Jump here">▸</button><input type="text" data-mk="${mk.id}" value="${esc(mk.name)}" aria-label="Marker name"><input type="number" step="0.01" min="0" data-mk="${mk.id}" data-f="t" value="${mk.t}" aria-label="Marker time (s)"><button class="btn ghost danger" data-act="mk-del" data-id="${mk.id}" aria-label="Delete marker">✕</button></div>`).join("")}</div></div>`;
  if(ids.length>1)return h+`<div class="sec"><div class="sec-head"><h3>${ids.length} clips selected</h3><div class="acts"><button class="btn" data-act="tl-dup">Duplicate</button><button class="btn ghost danger" data-act="tl-del">Delete</button></div></div>
    <p class="note" style="margin:0">Drag any of them to move them together. <kbd>⌘C</kbd> copies them, <kbd>⇧Delete</kbd> deletes them and closes the gaps. <button class="btn ghost" data-act="tl-sel-none">Clear selection</button></p></div>`;
  if(!c)return h+`<div class="sec"><p class="note" style="margin:0">Select a clip to edit it, or drag something from the media library onto a lane. Videos bring their sound with them.</p></div>`;
  const m=media(c.mediaId),src=m&&(m.kind==="video"||m.kind==="audio"),aud=isAudioLane(c.lane),vid=m&&m.kind==="video"&&!aud;
  const lanes=laneList().filter(l=>!l.hdr&&!!l.audio===aud);
  h+=`<div class="sec"><div class="sec-head"><h3>${aud?"Sound clip":"Clip"}</h3><div class="acts"><button class="btn" data-act="tl-dup">Duplicate</button><button class="btn ghost danger" data-act="tl-del">Delete</button></div></div>
    <button class="pickbtn" data-act="tl-pick"><span class="pk-sw" style="${m?swatchCSS(m):"background:#000"}"></span><span class="pk-nm">${esc(m?.name||"Missing media")}</span><span class="pk-k">${m?esc(m.kind==="gen"?"effect":aud&&m.kind==="video"?"sound of video":m.kind):""}</span><span aria-hidden="true">▾</span></button>
    <div class="vt-grid" style="margin-top:8px">
      <label for="tc-lane">${aud?"Lane":"Surface"}</label><select id="tc-lane">${lanes.map(l=>opt(l.id,l.name+(aud?"":` · ${output(surf(l.id)?.outputId)?.name||""}`),c.lane)).join("")}</select>
      <label for="tc-start">Starts at (s)</label><input id="tc-start" type="number" min="0" step="0.01" data-tc="start" value="${+c.start.toFixed(2)}">
      <label for="tc-dur">Length (s)</label><input id="tc-dur" type="number" min="0.1" step="0.01" data-tc="dur" value="${+c.dur.toFixed(2)}">
      ${src?`<label for="tc-speed">Speed (%)</label><input id="tc-speed" type="number" min="10" max="800" step="5" data-tc="speed" value="${Math.round(spd(c)*100)}" title="100 is normal speed. Changing it keeps the same part of the video and changes the clip's length.">`:""}
      ${src?`<label for="tc-in">Source starts at (s)</label><input id="tc-in" type="number" min="0" step="0.01" data-tc="in" value="${+(+c.in||0).toFixed(2)}">`:""}
      ${aud?"":`<label for="tc-ttype">Transition in</label><select id="tc-ttype" data-tc="ttype">${Object.entries(TRANS).map(([k,v])=>opt(k,v,c.ttype||"xfade")).join("")}</select>
      <label for="tc-tin">Transition time (s)</label><input id="tc-tin" type="number" min="0" step="0.1" data-tc="tin" value="${+c.tin||0}">
      <label for="tc-fout">Fade out (s)</label><input id="tc-fout" type="number" min="0" step="0.1" data-tc="fout" value="${+c.fout||0}">
      <label for="tc-level">Brightness</label><div class="inline"><input id="tc-level" type="range" min="0" max="1" step="0.01" data-tc="level" value="${c.level??1}"><output>${Math.round((c.level??1)*100)}%</output></div>`}
    </div>
    <div class="btns"><button class="btn" data-act="tl-split">✂ Split at playhead</button><button class="btn" data-act="tl-goto">Playhead to clip start</button><button class="btn" data-act="tl-off" title="Keep the clip but don't play it (D)">${c.off?"Enable clip":"Disable clip"}</button></div></div>`;
  // sound
  if(aud)h+=`<div class="sec"><div class="sec-head"><h3>Sound</h3>${c.link?`<div class="acts"><button class="btn" data-act="tl-rejoin">Join back to video</button></div>`:""}</div>
    <div class="vt-grid"><label for="tc-level">Volume</label><div class="inline"><input id="tc-level" type="range" min="0" max="1" step="0.01" data-tc="level" value="${c.level??1}"><output>${Math.round((c.level??1)*100)}%</output></div>
      <label for="tc-tin">Fade in (s)</label><input id="tc-tin" type="number" min="0" step="0.1" data-tc="tin" value="${+c.tin||0}">
      <label for="tc-fout">Fade out (s)</label><input id="tc-fout" type="number" min="0" step="0.1" data-tc="fout" value="${+c.fout||0}"></div>
    ${routeHTML(c,"clip")}
    <p class="note">${c.link?"This is the sound separated from a video. ":""}On the clip, drag the small squares to fade and the white line to change the volume.</p></div>`;
  else if(vid){const noA=mediaRT[m.id]?.noAudio===true;
    h+=`<div class="sec"><div class="sec-head"><h3>Sound</h3>${noA?"":`<div class="acts">${c.link?`<button class="btn" data-act="tl-rejoin">Join sound back</button>`:`<button class="btn" data-act="tl-sep" title="Move the sound to its own lane so you can edit it separately">Separate audio</button>`}</div>`}</div>
    ${noA?`<p class="note" style="margin:0">This video has no sound.</p>`:c.link?`<p class="note" style="margin:0">The sound is on ${esc(laneName(tlClip(c.link)?.lane||"a1"))}. Select it there to change its volume and fades.</p>`:`
    <div class="vt-grid"><label class="inline" style="grid-column:1/-1"><input type="checkbox" data-tc="mute" ${c.mute?"":"checked"}> Play this video's sound</label>
      <label for="tc-vol">Volume</label><div class="inline"><input id="tc-vol" type="range" min="0" max="1" step="0.01" data-tc="vol" value="${c.vol??1}" ${c.mute?"disabled":""}><output>${Math.round((c.vol??1)*100)}%</output></div>
      <label for="tc-afi">Fade in (s)</label><input id="tc-afi" type="number" min="0" step="0.1" data-tc="afi" value="${+c.afi||0}" ${c.mute?"disabled":""}>
      <label for="tc-afo">Fade out (s)</label><input id="tc-afo" type="number" min="0" step="0.1" data-tc="afo" value="${+c.afo||0}" ${c.mute?"disabled":""}></div>
    ${routeHTML(c,"clip")}
    <p class="note">The sound plays with the video. Drag the bottom squares on the clip to fade it, or use Separate audio to edit it on its own lane.</p>`}</div>`;}
  if(!aud&&m&&m.kind!=="audio"){const others=show.surfaces.filter(x=>x.id!==c.lane),on=new Set(c.span||[]);
    h+=`<div class="sec"><div class="sec-head"><h3>Across surfaces</h3></div>
      <p class="note" style="margin-top:0">Tick more surfaces to play this as <b>one picture across all of them</b>: one video, and each surface shows the part that falls on it.</p>
      <div class="span-list">${others.map(x=>`<label class="inline"><input type="checkbox" data-tspan="${x.id}" ${on.has(x.id)?"checked":""}><span class="chip" style="background:${x.color}"></span>${esc(x.name)} <span class="note" style="margin:0">· ${esc(output(x.outputId)?.name||"")}</span></label>`).join("")||`<span class="note">Add more surfaces in Map mode to span them.</span>`}</div></div>`;}
  return h+provFrameHTML();
}
/* ---------- stage + projector tabs ---------- */
const frameEl=$("#stageFrame");
function showStage(){
  const o=curOut();if(!o)return;
  const c=stageCanvas();
  frameEl.querySelectorAll("canvas.outc").forEach(x=>{if(x!==c)x.remove();});
  if(c&&c.parentNode!==frameEl)frameEl.insertBefore(c,ov);
  if(rt.room){const b=roomBox();frameEl.style.aspectRatio=`${b.w.toFixed(4)} / ${b.h.toFixed(4)}`;}else frameEl.style.aspectRatio=`${o.res[0]} / ${o.res[1]}`;
  if(typeof sizeStage==="function")sizeStage();
  applyView();
}
const ICON_EDIT='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M10.8 2.7l2.5 2.5L6 12.5H3.5V10z" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>';
const ICON_DEL='<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M2.8 4.5h10.4M6.3 4.5V2.8h3.4v1.7M4.3 4.5l.7 8.7h6l.7-8.7M6.7 7v4M9.3 7v4" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round"/></svg>';
const KIND_LABEL={media:"media",output:"projector",surface:"surface",mask:"mask",group:"group",cue:"cue"};
function rowActs(kind,id,name){return`<span class="row-acts"><button class="ib" data-act="rename" data-kind="${kind}" data-id="${id}" title="Rename" aria-label="Rename ${esc(name)}">${ICON_EDIT}</button><button class="ib danger" data-act="delete" data-kind="${kind}" data-id="${id}" title="Delete" aria-label="Delete ${esc(name)}">${ICON_DEL}</button></span>`;}
function renderTabs(){
  $("#outTabs").innerHTML=`<button class="otab all" data-act="room" aria-pressed="${!!rt.room}" title="Edit every projector together as one room (M)"><span class="ot-grid" aria-hidden="true"><i></i><i></i><i></i><i></i></span><span class="ot-name">Room</span><span class="ot-meta">${show.outputs.length} projector${show.outputs.length===1?"":"s"}</span></button>`+show.outputs.map(o=>{const n=show.surfaces.filter(s=>s.outputId===o.id).length,tw=112,th=Math.round(tw*o.res[1]/o.res[0]);
    return`<div class="otab-wrap"><button class="otab" data-act="out" data-id="${o.id}" aria-pressed="${o.id===rt.out}"><canvas class="thumb" data-id="${o.id}" width="${tw}" height="${th}"></canvas>
      <span class="ot-name" data-rn="output:${o.id}" title="Double-click to rename">${esc(o.name)}</span><span class="ot-meta">${o.res[0]}×${o.res[1]} · ${n} surface${n===1?"":"s"}</span></button>${rowActs("output",o.id,o.name)}</div>`}).join("")
    +`<button class="otab add" data-act="add-out"><span class="ot-plus">+</span><span class="ot-name">Projector</span></button>`;
  syncRoomTools();
}
function setOut(id){if(rt.out===id)return;rt.out=id;rt.sel=null;rt.selPt=-1;rt.drawing=null;showStage();renderTabs();renderPanel();}

/* ---------- multiview: every projector at once ---------- */
function mvLayout(){show.mv=show.mv||{};if(show.mv.v!==2){show.mv.layout={};show.mv.v=2;}const L=show.mv.layout;
  for(const id in L)if(!output(id))delete L[id];
  const o0=show.outputs.find(o=>L[o.id])||show.outputs[0],h0=o0?(L[o0.id]?.w||1)*o0.res[1]/o0.res[0]:0.5625,x0=o0&&L[o0.id]?L[o0.id].x:0,y0=o0&&L[o0.id]?L[o0.id].y:0,w0=o0&&L[o0.id]?L[o0.id].w:1;
  for(const o of show.outputs)if(!L[o.id]){const h=w0*o.res[1]/o.res[0];L[o.id]={x:x0,y:y0+(h0-h)/2,w:w0};}
  return L;}
function roomLayout(kind){const L=mvLayout();let x=0;const H0=show.outputs[0]?show.outputs[0].res[1]/show.outputs[0].res[0]:0.5625;
  for(const o of show.outputs){const h=o.res[1]/o.res[0];if(kind==="row"){L[o.id]={x,y:(H0-h)/2,w:1};x+=1.06;}else L[o.id]={x:0,y:(H0-h)/2,w:1};}
  save();showStage();}
function mvRect(o,L){const l=L[o.id];return{x:l.x,y:l.y,w:l.w,h:l.w*o.res[1]/o.res[0]};}
function nowPlaying(state,sid){const r=state&&state[sid];if(!r||!r.players.length)return null;const p=[...r.players].reverse().find(x=>(x.op??1)>0.01);if(!p)return null;const m=media(p.mediaId);return m?m.name:null;}
function mvInPoly(x,y,poly){let c=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){const[xi,yi]=poly[i],[xj,yj]=poly[j];if((yi>y)!==(yj>y)&&x<(xj-xi)*(y-yi)/(yj-yi)+xi)c=!c;}return c;}
/* ---------- room: every projector edited together on one stage ---------- */
const roomCv=document.createElement("canvas");roomCv.className="outc";const roomCx=roomCv.getContext("2d");
function roomBox(){if(rt.roomFreeze)return rt.roomFreeze;const L=mvLayout(),R=show.outputs.map(o=>mvRect(o,L));
  const x0=Math.min(...R.map(r=>r.x)),y0=Math.min(...R.map(r=>r.y)),x1=Math.max(...R.map(r=>r.x+r.w)),y1=Math.max(...R.map(r=>r.y+r.h)),pad=0.04*Math.max(x1-x0,y1-y0);
  return{x0:x0-pad,y0:y0-pad,w:x1-x0+2*pad,h:y1-y0+2*pad};}
function roomFrac(o){const b=roomBox(),r=mvRect(o,mvLayout());return{x:(r.x-b.x0)/b.w,y:(r.y-b.y0)/b.h,w:r.w/b.w,h:r.h/b.h};}
function stageXf(o){const r=ov.getBoundingClientRect(),v=view(),W=r.width*v.z,H=r.height*v.z;if(!rt.room)return{tx:v.tx,ty:v.ty,W,H};
  const f=roomFrac(o||curOut());return{tx:v.tx+f.x*W,ty:v.ty+f.y*H,W:f.w*W,H:f.h*H};}
function stageCanvas(){return rt.room?roomCv:stageUsesPvc()?pvc:oc[rt.out]?.cv;}
function setRoom(on){rt.room=!!on;rt.roomArrange=false;rt.roomFreeze=null;rt.drawing=null;frameEl.classList.toggle("room",rt.room);showStage();renderTabs();renderPanel();}
function syncRoomTools(){const b=$("#roomArrBtn");if(b){b.hidden=!rt.room;b.setAttribute("aria-pressed",!!rt.roomArrange);}document.querySelectorAll("[data-act=room-layout]").forEach(x=>x.hidden=!rt.room||!rt.roomArrange);}
function composeRoom(n){if(!rt.room||!gl)return;const r=ov.getBoundingClientRect();if(!r.width)return;
  const k=Math.min(1,2560/Math.max(ov.width,ov.height)),W=Math.max(1,Math.round(ov.width*k)),H=Math.max(1,Math.round(ov.height*k));
  if(roomCv.width!==W||roomCv.height!==H){roomCv.width=W;roomCv.height=H;}
  if(glc.width<W||glc.height<H){rt.roomGL=[Math.max(W,glc.width),Math.max(H,glc.height)];ensureOutputs();}
  const c=roomCx,ps=projState();c.globalCompositeOperation="source-over";c.fillStyle="#000";c.fillRect(0,0,W,H);c.globalCompositeOperation="lighter";
  for(const o of show.outputs){const x=stageXf(o),pv=o.id===rt.out&&stageUsesPvc();
    const state=pv?(previewActive()?rt.preview.surf:tl.surf):ps.state,tp=pv?false:ps.tp;
    drawOutput(o,n/1000,state,null,tp,{w:W,h:H,xf:[x.W/r.width,x.H/r.height,x.tx/r.width,x.ty/r.height]});
    c.drawImage(glc,0,glc.height-H,W,H,0,0,W,H);}
  c.globalCompositeOperation="source-over";}
function roomLocal(e,o){const r=ov.getBoundingClientRect(),x=stageXf(o);return[(e.clientX-r.left-x.tx)/x.W,(e.clientY-r.top-x.ty)/x.H,{width:x.W,height:x.H}];}
function itemAtLocal(oid,x,y,withMasks=true){const L=layersOn(oid).slice().reverse();for(const it of L){if(it.kind==="mask"&&!withMasks)continue;const poly=it.kind==="mask"?outlineFor(it.o.pts):surfOutline(it.o);if(mvInPoly(x,y,poly))return it;}return null;}
function roomFind(e,withMasks=true){const cur=curOut(),list=[cur,...show.outputs.filter(o=>o!==cur).reverse()];
  for(const o of list){const[x,y]=roomLocal(e,o);const it=itemAtLocal(o.id,x,y,withMasks);if(it)return{o,it};}return null;}
function roomSwitch(id){if(rt.out===id)return;rt.out=id;rt.selPt=-1;showStage();renderTabs();}
function polyArea(p){let a=0;for(let i=0,j=p.length-1;i<p.length;j=i++)a+=(p[j][0]+p[i][0])*(p[j][1]-p[i][1]);return Math.abs(a/2);}
function roomHits(e,map){const hits=[];
  for(const o of show.outputs){const[lx,ly,lr]=roomLocal(e,o);
    for(const it of layersOn(o.id)){if(it.kind==="mask"&&!map)continue;const poly=it.kind==="mask"?outlineFor(it.o.pts):surfOutline(it.o);
      if(mvInPoly(lx,ly,poly))hits.push({o,it,A:polyArea(poly)*lr.width*lr.height});}}
  return hits.sort((p,q)=>p.A-q.A);}
function roomTake(h,map){if(h.o.id!==rt.out)roomSwitch(h.o.id);
  if(map)selectItem(h.it.kind,h.it.o);else if(rt.mode==="cues"&&rt.cedit&&h.it.kind==="surface")rt.cedit={...rt.cedit,sid:h.it.o.id};
  renderPanel();}
function roomPick(e){const[x,y,r]=toN(e),map=rt.mode==="map";rt.roomCyc=null;
  if(map){const arr=editArr();if(arr&&arr.some(p=>Math.hypot((p[0]-x)*r.width,(p[1]-y)*r.height)<16))return;
    const so=selObj();if(so&&rt.sel.kind!=="group"&&so.outputId===rt.out){const k=rt.sel.kind,nx=(hx,hy,R)=>Math.hypot((hx-x)*r.width,(hy-y)*r.height)<R;
      if(resizeHandles(k,so,r.width,r.height).some(h=>nx(h.x,h.y,14))||edgeGhosts(k,so,r.width,r.height).some(g=>nx(g.x,g.y,12)))return;
      const poly=k==="mask"?outlineFor(so.pts):surfOutline(so);
      // already selected: a plain click (no drag) steps to the next piece underneath, so overlapping pieces are all reachable
      if(mvInPoly(x,y,poly)){rt.roomCyc={x:e.clientX,y:e.clientY,hits:roomHits(e,map)};return;}}}
  else if(previewActive()||rt.mode==="timeline"){const pv=frameProv(),ps=pv&&surf(pv.sid);if(ps&&ps.outputId===rt.out&&mvInPoly(x,y,surfOutline(ps)))return;}
  // smallest piece under the pointer wins, on any projector
  const hits=roomHits(e,map);if(hits.length)roomTake(hits[0],map);}
function roomCycUp(e){const c=rt.roomCyc;rt.roomCyc=null;if(!c||Math.hypot(e.clientX-c.x,e.clientY-c.y)>4||c.hits.length<2)return;
  const i=c.hits.findIndex(h=>h.it.o.id===rt.sel?.id);roomTake(c.hits[(i+1)%c.hits.length],true);}
function roomPt(e,b){const r=ov.getBoundingClientRect(),v=view();return[b.x0+(e.clientX-r.left-v.tx)/(r.width*v.z)*b.w,b.y0+(e.clientY-r.top-v.ty)/(r.height*v.z)*b.h];}
function roomArrDown(e){const b=roomBox(),[wx,wy]=roomPt(e,b),L=mvLayout(),r0=ov.getBoundingClientRect(),tol=12/(r0.width*view().z)*b.w;
  for(let k=show.outputs.length-1;k>=0;k--){const o=show.outputs[k],r=mvRect(o,L);
    if(Math.abs(wx-(r.x+r.w))<tol&&Math.abs(wy-(r.y+r.h))<tol){rt.roomDrag={type:"size",l:L[o.id],ar:o.res[1]/o.res[0],b};break;}
    if(wx>=r.x&&wx<=r.x+r.w&&wy>=r.y&&wy<=r.y+r.h){rt.roomDrag={type:"move",l:L[o.id],x:wx,y:wy,ox:L[o.id].x,oy:L[o.id].y,b};break;}}
  if(rt.roomDrag){rt.roomFreeze=b;const o=show.outputs.find(o=>L[o.id]===rt.roomDrag.l);if(o){roomSwitch(o.id);renderPanel();}try{ov.setPointerCapture(e.pointerId)}catch(err){}}}
function roomArrMove(e){const d=rt.roomDrag;if(!d)return false;const[wx,wy]=roomPt(e,d.b);
  if(d.type==="move"){d.l.x=d.ox+(wx-d.x);d.l.y=d.oy+(wy-d.y);}else{d.l.w=Math.max(0.1,Math.max(wx-d.l.x,(wy-d.l.y)/d.ar));}return true;}
function roomArrUp(){if(!rt.roomDrag)return;rt.roomDrag=null;rt.roomFreeze=null;save();showStage();}
function drawRoomContext(c,d){const state=rt.outSrc==="timeline"?tl.surf:rt.surf;const topY=Math.min(...show.outputs.map(o=>stageXf(o).ty))*d;
  for(const o of show.outputs){const x=stageXf(o),X=x.tx*d,Y=x.ty*d,w=x.W*d,h=x.H*d,cur=o.id===rt.out;
    c.setTransform(1,0,0,1,0,0);
    if(rt.roomArrange){c.setLineDash(cur?[]:[6*d,4*d]);c.lineWidth=(cur?1.5:1)*d;c.strokeStyle=cur?"rgba(242,169,59,.8)":"rgba(230,232,237,.35)";c.strokeRect(X,Y,w,h);c.setLineDash([]);
      c.font=`600 ${11*d}px "Barlow Condensed","Arial Narrow",sans-serif`;c.textAlign="left";c.textBaseline="top";c.fillStyle=cur?"#f2a93b":"rgba(230,232,237,.6)";c.fillText(o.name.toUpperCase(),X+6*d,Math.max(Y,topY)+(5+15*show.outputs.indexOf(o))*d);
      c.fillStyle="#f2a93b";c.fillRect(X+w-6*d,Y+h-6*d,12*d,12*d);}
    if(cur)continue;
    c.setTransform(1,0,0,1,X,Y);const path=poly=>{c.beginPath();poly.forEach(([px,py],i)=>i?c.lineTo(px*w,py*h):c.moveTo(px*w,py*h));c.closePath();};
    for(const it of layersOn(o.id)){
      if(it.kind==="mask"){path(outlineFor(it.o.pts));c.setLineDash([4*d,3*d]);c.lineWidth=1*d;c.strokeStyle="rgba(229,72,77,.6)";c.stroke();c.setLineDash([]);continue;}
      const sf=it.o,poly=surfOutline(sf);path(poly);c.lineWidth=1*d;c.strokeStyle=sf.color||"#f2a93b";c.globalAlpha=.6;c.stroke();c.globalAlpha=1;
      const cx=poly.reduce((a,p)=>a+p[0],0)/poly.length*w,cy=poly.reduce((a,p)=>a+p[1],0)/poly.length*h,np=nowPlaying(state,sf.id);
      c.textAlign="center";c.textBaseline="middle";c.lineJoin="round";c.font=`600 ${11*d}px "Barlow Condensed","Arial Narrow",sans-serif`;
      const t1=sf.name.toUpperCase();c.lineWidth=3.5*d;c.strokeStyle="rgba(0,0,0,.8)";c.strokeText(t1,cx,cy-6*d);c.fillStyle="rgba(230,232,237,.8)";c.fillText(t1,cx,cy-6*d);
      c.font=`500 ${10*d}px "Barlow","Arial",sans-serif`;const t2=np?(np.length>28?np.slice(0,27)+"…":np):"dark";c.strokeText(t2,cx,cy+7*d);c.fillStyle=np?"rgba(242,169,59,.85)":"#8a8f9c";c.fillText(t2,cx,cy+7*d);}}
  c.setTransform(1,0,0,1,0,0);
  if(!rt.roomArrange){const t="EDITING · "+(curOut()?.name||"").toUpperCase();c.font=`600 ${11*d}px "Barlow Condensed","Arial Narrow",sans-serif`;c.textAlign="left";c.textBaseline="top";
    const tw=c.measureText(t).width;c.fillStyle="rgba(0,0,0,.6)";c.fillRect(6*d,6*d,tw+12*d,18*d);c.fillStyle="#f2a93b";c.fillText(t,12*d,10*d);}}

/* ---------- overlay ---------- */
function sizeOverlay(){
  const r=ov.getBoundingClientRect(),d=window.devicePixelRatio||1;
  ov.width=Math.max(1,Math.round(r.width*d));ov.height=Math.max(1,Math.round(r.height*d));
}
new ResizeObserver(()=>{sizeOverlay();applyView();}).observe(ov);
function selObj(){if(!rt.sel)return null;if(rt.sel.kind==="group")return group(rt.sel.id)||null;return rt.sel.kind==="surface"?surf(rt.sel.id):show.masks.find(m=>m.id===rt.sel.id)||null}
function editArr(){
  if(!rt.sel||rt.sel.kind==="group")return null;
  const o=selObj();if(!o||o.outputId!==rt.out)return null;
  if(rt.sel.kind==="mask")return o.pts;
  if(rt.edit==="shape"&&o.shape)return o.shape;
  return o.warp==="grid"&&o.grid?o.grid.pts:o.pts;
}
const editingOutline=()=>rt.sel&&rt.sel.kind!=="group"&&(rt.sel.kind==="mask"||(rt.edit==="shape"&&selObj()?.shape));
function drawCueOverlay(c,w,h,d){
  const path=(poly)=>{c.beginPath();poly.forEach(([x,y],i)=>i?c.lineTo(x*w,y*h):c.moveTo(x*w,y*h));c.closePath();};
  const pv=frameProv();
  if(rt.mode==="cues"){const cue=selCue();if(!cue)return;
    for(const s of onOut(show.surfaces)){const row=cueRowFor(cue,s.id),sel=rt.cedit?.sid===s.id;if(!row)continue;
      path(surfOutline(s));c.setLineDash(sel?[]:[5*d,4*d]);c.lineWidth=(sel?2:1.2)*d;c.strokeStyle=sel?"#f2a93b":"rgba(242,169,59,.7)";c.stroke();c.setLineDash([]);}}
  else if(tl.outlines!==false){const cl=tlClip(rt.tsel),selSid=cl&&cl.lane;
    for(const it of layersOn(rt.out)){
      if(it.kind==="mask"){path(outlineFor(it.o.pts));c.setLineDash([5*d,4*d]);c.lineWidth=1*d;c.strokeStyle="rgba(229,72,77,.75)";c.stroke();c.setLineDash([]);continue;}
      const sf=it.o,sel=sf.id===selSid,poly=surfOutline(sf);path(poly);c.lineWidth=(sel?2.5:1.2)*d;c.strokeStyle=sel?"#f2a93b":sf.color;c.globalAlpha=sel?1:.8;c.stroke();c.globalAlpha=1;
      const cx=poly.reduce((a,p)=>a+p[0],0)/poly.length*w,cy=poly.reduce((a,p)=>a+p[1],0)/poly.length*h,busy=T().clips.some(k=>!k.off&&(k.lane===sf.id||(clipSpanSids(k)||[]).includes(sf.id))&&tl.t>=k.start&&tl.t<k.start+k.dur);
      c.font=`600 ${12*d}px "Barlow Condensed","Arial Narrow",sans-serif`;c.textAlign="center";c.textBaseline="middle";const txt=sf.name.toUpperCase()+(busy?"":" · EMPTY");
      c.lineWidth=4*d;c.strokeStyle="rgba(0,0,0,.75)";c.strokeText(txt,cx,cy);c.fillStyle=sel?"#f2a93b":"#e6e8ed";c.fillText(txt,cx,cy);}}
  const s=pv&&(pv.surface||surf(pv.sid));if(!s||s.outputId!==rt.out)return;
  if(pv.span){c.save();c.globalAlpha=0.9;for(const id of pv.span){const sf=surf(id);if(!sf||sf.outputId!==rt.out)continue;path(surfOutline(sf));c.lineWidth=1.5*d;c.strokeStyle="#f2a93b";c.setLineDash([3*d,3*d]);c.stroke();}c.setLineDash([]);c.restore();}
  const b=mediaBox(s,media(pv.mid),normFrame(pv.get(false)),pv.player);
  path(boxPoly(s,b,14));c.lineWidth=1.5*d;c.strokeStyle="#fff";c.setLineDash([6*d,4*d]);c.stroke();c.setLineDash([]);
  for(const[a,bb]of[[-1,-1],[1,-1],[1,1],[-1,1]]){const p=posAt(s,b.cu+b.hu*a,b.cv+b.hv*bb),X=p[0]*w,Y=p[1]*h,R=6*d;c.fillStyle="#fff";c.fillRect(X-R,Y-R,R*2,R*2);c.lineWidth=2*d;c.strokeStyle="#000";c.strokeRect(X-R,Y-R,R*2,R*2);}
  const ctr=posAt(s,b.cu,b.cv);c.beginPath();c.arc(ctr[0]*w,ctr[1]*h,4*d,0,7);c.fillStyle="#f2a93b";c.fill();
}
function drawOverlay(){
  const c=ovx,d=window.devicePixelRatio||1;c.setTransform(1,0,0,1,0,0);c.clearRect(0,0,ov.width,ov.height);
  if(rt.room)drawRoomContext(c,d);
  const xf=stageXf();c.setTransform(1,0,0,1,xf.tx*d,xf.ty*d);const w=xf.W*d,h=xf.H*d;
  const path=(poly,close=true)=>{c.beginPath();poly.forEach(([x,y],i)=>i?c.lineTo(x*w,y*h):c.moveTo(x*w,y*h));if(close)c.closePath();};
  if(rt.dropHover){
    for(const s of onOut(show.surfaces)){const on=s.id===rt.dropHover;path(surfOutline(s));c.setLineDash(on?[]:[5*d,4*d]);c.lineWidth=(on?3:1)*d;c.strokeStyle=on?"#f2a93b":"rgba(230,232,237,.5)";c.stroke();if(on){c.fillStyle="rgba(242,169,59,.22)";c.fill();
      c.font=`600 ${15*d}px "Barlow Condensed","Arial Narrow",sans-serif`;c.textAlign="center";c.textBaseline="middle";const pl=surfOutline(s),cx=pl.reduce((a,p)=>a+p[0],0)/pl.length*w,cy=pl.reduce((a,p)=>a+p[1],0)/pl.length*h;
      c.lineWidth=4*d;c.strokeStyle="rgba(0,0,0,.8)";c.strokeText("DROP ON "+s.name.toUpperCase(),cx,cy);c.fillStyle="#f2a93b";c.fillText("DROP ON "+s.name.toUpperCase(),cx,cy);}}
    c.setLineDash([]);return;
  }
  if(rt.mode!=="map"){if(previewActive()||rt.mode==="timeline")drawCueOverlay(c,w,h,d);return;}
  const label=(txt,poly,col)=>{const cx=poly.reduce((a,p)=>a+p[0],0)/poly.length*w,cy=poly.reduce((a,p)=>a+p[1],0)/poly.length*h;
    c.font=`600 ${13*d}px "Barlow Condensed","Arial Narrow",sans-serif`;c.textAlign="center";c.textBaseline="middle";
    c.lineWidth=4*d;c.strokeStyle="rgba(0,0,0,.75)";c.strokeText(txt.toUpperCase(),cx,cy);c.fillStyle=col;c.fillText(txt.toUpperCase(),cx,cy);};
  const handles=(pts,col)=>pts.forEach((p,i)=>{const on=i===rt.selPt,R=(on?8:6)*d,x=p[0]*w,y=p[1]*h;
    c.beginPath();if(p[2])c.arc(x,y,R,0,7);else c.rect(x-R,y-R,R*2,R*2);
    c.fillStyle=on?"#fff":col;c.fill();c.lineWidth=2*d;c.strokeStyle="#000";c.stroke();});
  const grp=rt.sel?.kind==="group"?group(rt.sel.id):null;
  for(const it of layersOn(rt.out)){
    if(it.kind==="surface"){const s=it.o;
      const sel=rt.sel?.kind==="surface"&&rt.sel.id===s.id,inG=grp&&grp.members.includes(s.id),poly=surfOutline(s);
      path(poly);c.setLineDash([]);c.lineWidth=(sel||inG?2.5:1)*d;c.strokeStyle=inG?grp.color:sel?"#f2a93b":s.color;c.globalAlpha=sel||inG?1:.75;c.stroke();c.globalAlpha=1;
      if(inG){c.fillStyle=grp.color+"22";c.fill();}
      label(s.name,poly,inG?grp.color:sel?"#f2a93b":"#e6e8ed");
    }else{const m=it.o;
      const sel=rt.sel?.kind==="mask"&&rt.sel.id===m.id,poly=outlineFor(m.pts);
      path(poly);c.fillStyle="rgba(229,72,77,.14)";c.fill();c.setLineDash([6*d,4*d]);c.lineWidth=(sel?2:1)*d;c.strokeStyle=sel?"#f2a93b":"#e5484d";c.stroke();c.setLineDash([]);
      label(m.name+" (mask)",poly,sel?"#f2a93b":"#f08a8d");}
  }
  const so=rt.sel?.kind==="surface"?selObj():null;
  if(so&&so.outputId===rt.out&&!editingOutline()){
    const lines=so.warp==="grid"&&so.grid?[so.grid.c,so.grid.r]:[4,4];
    c.lineWidth=1*d;c.strokeStyle="rgba(242,169,59,.55)";c.setLineDash([3*d,3*d]);
    for(let i=0;i<=lines[0];i++){const pl=[];for(let k=0;k<=24;k++)pl.push(posAt(so,i/lines[0],k/24));path(pl,false);c.stroke();}
    for(let j=0;j<=lines[1];j++){const pl=[];for(let k=0;k<=24;k++)pl.push(posAt(so,k/24,j/lines[1]));path(pl,false);c.stroke();}
    c.setLineDash([]);
  }else if(so&&so.outputId===rt.out&&so.shape){
    path(meshFor(so).border);c.setLineDash([3*d,4*d]);c.lineWidth=1*d;c.strokeStyle="rgba(230,232,237,.35)";c.stroke();c.setLineDash([]);
  }
  const sso=!rt.drawing&&selOnStage();
  if(sso){
    const[x0,y0,x1,y1]=boundsOf(rt.sel.kind,sso);
    c.setLineDash([4*d,4*d]);c.lineWidth=1*d;c.strokeStyle="rgba(255,255,255,.45)";c.strokeRect(x0*w,y0*h,(x1-x0)*w,(y1-y0)*h);c.setLineDash([]);
    for(const hh of resizeHandles(rt.sel.kind,sso,w/d,h/d)){const X=hh.x*w,Y=hh.y*h,R=5*d;
      c.beginPath();c.moveTo(hh.corner[0]*w,hh.corner[1]*h);c.lineTo(X,Y);c.strokeStyle="rgba(255,255,255,.45)";c.stroke();
      c.fillStyle="#fff";c.fillRect(X-R,Y-R,R*2,R*2);c.lineWidth=2*d;c.strokeStyle="#000";c.strokeRect(X-R,Y-R,R*2,R*2);}
    for(const g of edgeGhosts(rt.sel.kind,sso,w/d,h/d)){const X=g.x*w,Y=g.y*h,R=6*d;
      c.beginPath();c.arc(X,Y,R,0,7);c.fillStyle="rgba(10,12,16,.85)";c.fill();c.lineWidth=1.5*d;c.strokeStyle="#f2a93b";c.stroke();
      c.beginPath();c.moveTo(X-3*d,Y);c.lineTo(X+3*d,Y);c.moveTo(X,Y-3*d);c.lineTo(X,Y+3*d);c.stroke();}
  }
  const arr=editArr();if(arr)handles(arr,"#f2a93b");
  if(rt.drawing){
    const dp=rt.drawing.pts,live=rt.drawing.hover?[...dp,[...rt.drawing.hover,0]]:dp;
    if(live.length>1){path(dp.length>=3?sampleOutline(live):live,dp.length>=3);c.fillStyle="rgba(242,169,59,.12)";if(dp.length>=3)c.fill();c.lineWidth=2*d;c.strokeStyle="#f2a93b";c.stroke();}
    handles(dp,"#f2a93b");
    if(dp.length>=3){c.beginPath();c.arc(dp[0][0]*w,dp[0][1]*h,13*d,0,7);c.lineWidth=2*d;c.strokeStyle="#fff";c.stroke();}
  }
}
function inPoly(p,pts){let ins=false;for(let i=0,j=pts.length-1;i<pts.length;j=i++){const[xi,yi]=pts[i],[xj,yj]=pts[j];if(((yi>p[1])!==(yj>p[1]))&&(p[0]<(xj-xi)*(p[1]-yi)/(yj-yi)+xi))ins=!ins;}return ins;}
let drag=null;
function toN(e){const r=ov.getBoundingClientRect(),x=stageXf();return[(e.clientX-r.left-x.tx)/x.W,(e.clientY-r.top-x.ty)/x.H,{width:x.W,height:x.H}];}
function bodiesOf(kind,o){return kind==="mask"?[o.pts]:[o.pts,o.grid?.pts,o.shape].filter(Boolean);}
function selectItem(kind,o){
  if(!(rt.sel&&rt.sel.id===o.id))rt.edit=kind==="surface"&&o.shape?"shape":"warp";
  rt.sel={kind,id:o.id};
}
function nearEdge(arr,x,y,r){
  let best=-1,bd=18;const px=p=>[p[0]*r.width,p[1]*r.height],P=[x*r.width,y*r.height];
  arr.forEach((p,k)=>{const a=px(p),b=px(arr[(k+1)%arr.length]);const vx=b[0]-a[0],vy=b[1]-a[1],L=vx*vx+vy*vy||1;
    const t=clamp(((P[0]-a[0])*vx+(P[1]-a[1])*vy)/L,0,1);const dd=Math.hypot(a[0]+vx*t-P[0],a[1]+vy*t-P[1]);if(dd<bd){bd=dd;best=k;}});
  return best;
}
/* ---------- stage zoom + pan (editor view only; projector output is never zoomed) ---------- */
rt.views={};
const view=()=>{const k=rt.room?"__room":rt.out;return rt.views[k]||(rt.views[k]={z:1,tx:0,ty:0});};
function clampView(v){
  const r=ov.getBoundingClientRect(),W=r.width,H=r.height;if(rt.room){v.z=clamp(v.z,0.1,8);return;}v.z=clamp(v.z,0.5,8);
  if(v.z<=1){v.tx=(W-W*v.z)/2;v.ty=(H-H*v.z)/2;}
  else{const mx=0.15*W*v.z,my=0.15*H*v.z;v.tx=clamp(v.tx,W-W*v.z-mx,mx);v.ty=clamp(v.ty,H-H*v.z-my,my);}
}
function applyView(){
  if(!rt.out)return;const v=view();clampView(v);
  const c=stageCanvas();if(c&&rt.room){c.style.transform="none";}else if(c)c.style.transform=`translate(${v.tx}px,${v.ty}px) scale(${v.z})`;
  const l=$("#zoomLbl");if(l)l.textContent=Math.round(v.z*100)+"%";
}
function zoomAt(px,py,f){const v=view(),z2=clamp(v.z*f,rt.room?0.1:0.5,8),k=z2/v.z;v.tx=px-(px-v.tx)*k;v.ty=py-(py-v.ty)*k;v.z=z2;applyView();}
function zoomCenter(f){const r=ov.getBoundingClientRect();zoomAt(r.width/2,r.height/2,f);}
function zoomFit(){const v=view();v.z=1;v.tx=0;v.ty=0;
  if(rt.room){let x0=0,y0=0,x1=1,y1=1;for(const o of show.outputs){const f=roomFrac(o);for(const it of layersOn(o.id)){const P=it.kind==="mask"?it.o.pts:surfOutline(it.o);for(const p of P){const X=f.x+p[0]*f.w,Y=f.y+p[1]*f.h;x0=Math.min(x0,X);y0=Math.min(y0,Y);x1=Math.max(x1,X);y1=Math.max(y1,Y);}}}
    const r=ov.getBoundingClientRect(),m=0.03;v.z=Math.min(1,1/((x1-x0)*(1+2*m)),1/((y1-y0)*(1+2*m)));v.tx=r.width*(0.5-(x0+x1)/2*v.z);v.ty=r.height*(0.5-(y0+y1)/2*v.z);}
  applyView();}
const ptrs=new Map();let pan=null,pinch=null;
function startPan(e){const v=view();pan={x:e.clientX,y:e.clientY,tx:v.tx,ty:v.ty,moved:false};try{ov.setPointerCapture(e.pointerId)}catch(err){}}
ov.addEventListener("pointerdown",e=>{
  ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(ptrs.size===2){
    if(drag){drag=null;save();}pan=null;
    const[a,b]=[...ptrs.values()],r=ov.getBoundingClientRect(),v=view();
    const mx=(a.x+b.x)/2-r.left,my=(a.y+b.y)/2-r.top;
    pinch={d0:Math.hypot(a.x-b.x,a.y-b.y)||1,z0:v.z,cx:(mx-v.tx)/v.z,cy:(my-v.ty)/v.z};
    e.stopImmediatePropagation();return;
  }
  if(e.button===1){e.preventDefault();startPan(e);e.stopImmediatePropagation();return;}
  if(rt.room&&rt.roomArrange){e.preventDefault();e.stopImmediatePropagation();roomArrDown(e);if(!rt.roomDrag)startPan(e);return;}
  if(rt.room&&!rt.drawing&&e.button===0)roomPick(e);
  if(rt.mode!=="map"&&!rt.drawing){e.preventDefault();e.stopImmediatePropagation();if((previewActive()||rt.mode==="timeline")&&frameEditDown(e))return;startPan(e);}
});
ov.addEventListener("pointermove",e=>{
  if(ptrs.has(e.pointerId))ptrs.set(e.pointerId,{x:e.clientX,y:e.clientY});
  if(pinch&&ptrs.size>=2){
    const[a,b]=[...ptrs.values()],r=ov.getBoundingClientRect(),v=view();
    v.z=clamp(pinch.z0*Math.hypot(a.x-b.x,a.y-b.y)/pinch.d0,0.5,8);
    v.tx=(a.x+b.x)/2-r.left-pinch.cx*v.z;v.ty=(a.y+b.y)/2-r.top-pinch.cy*v.z;applyView();
    e.stopImmediatePropagation();return;
  }
  if(rt.roomDrag){roomArrMove(e);e.stopImmediatePropagation();return;}
  if(rt.cdrag){cueEditMove(e);e.stopImmediatePropagation();return;}
  if(pan){const dx=e.clientX-pan.x,dy=e.clientY-pan.y;if(Math.hypot(dx,dy)>3)pan.moved=true;
    if(pan.moved){const v=view();v.tx=pan.tx+dx;v.ty=pan.ty+dy;applyView();ov.style.cursor="grabbing";}
    e.stopImmediatePropagation();}
});
const endPtr=e=>{ptrs.delete(e.pointerId);if(ptrs.size<2)pinch=null;roomArrUp();roomCycUp(e);if(rt.cdrag){rt.cdrag=null;save();}if(pan){pan=null;ov.style.cursor="";}};
ov.addEventListener("pointerup",endPtr);ov.addEventListener("pointercancel",endPtr);
function syncFrameUI(f){for(const k of["zoom","x","y"]){const el=$("#fr-"+k);if(!el)continue;if(document.activeElement!==el)el.value=f[k]??(k==="zoom"?1:0);const n=el&&el.parentElement.querySelector(".frn");if(n&&document.activeElement!==n)n.value=Math.round((f[k]??(k==="zoom"?1:0))*100);}}
ov.addEventListener("wheel",e=>{
  if(e.altKey&&rt.mode==="map"){const so=selOnStage();if(so&&rt.sel.kind==="surface"){const t=topImagery(so);if(t){e.preventDefault();const f=frameEdit(so,t.m.id);f.zoom=clamp((+f.zoom||1)*Math.exp(-clamp(e.deltaY*(e.deltaMode?30:1),-50,50)*0.006),0.01,100);syncFrameUI(f);save();return;}}}
  const r=ov.getBoundingClientRect(),v=view();
  if(e.ctrlKey||e.metaKey){e.preventDefault();zoomAt(e.clientX-r.left,e.clientY-r.top,Math.exp(-clamp(e.deltaY*(e.deltaMode?30:1),-50,50)*0.008));return;}
  if(v.z>1||rt.room){e.preventDefault();v.tx-=e.deltaX;v.ty-=e.deltaY;applyView();}
},{passive:false});
ov.addEventListener("auxclick",e=>{if(e.button===1)e.preventDefault();});
function segMid(arr,i){
  const n=arr.length,p=arr[i],q=arr[(i+1)%n],pr=arr[(i-1+n)%n],q2=arr[(i+2)%n];
  if(!p[2]&&!q[2])return[(p[0]+q[0])/2,(p[1]+q[1])/2];
  const c1=p[2]?[p[0]+(q[0]-pr[0])/6,p[1]+(q[1]-pr[1])/6]:p,c2=q[2]?[q[0]-(q2[0]-p[0])/6,q[1]-(q2[1]-p[1])/6]:q;
  return[(p[0]+3*c1[0]+3*c2[0]+q[0])/8,(p[1]+3*c1[1]+3*c2[1]+q[1])/8];
}
function boundsOf(kind,o){
  const pts=kind==="mask"?outlineFor(o.pts):surfOutline(o);
  const xs=pts.map(p=>p[0]),ys=pts.map(p=>p[1]);return[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
// Resize handles sit just outside the selection's bounding box, so they never cover a shape's own points.
function resizeHandles(kind,o,W,H){
  const[x0,y0,x1,y1]=boundsOf(kind,o),off=18;
  return[[x0,y0,-1,-1,x1,y1],[x1,y0,1,-1,x0,y1],[x1,y1,1,1,x0,y0],[x0,y1,-1,1,x1,y0]].map(([cx,cy,dx,dy,ax,ay])=>({x:cx+dx*off/W,y:cy+dy*off/H,corner:[cx,cy],anchor:[ax,ay],center:[(x0+x1)/2,(y0+y1)/2],dir:dx*dy}));
}
// "+" handles at the middle of each edge: drag one to add a point there.
function edgeGhosts(kind,o,W,H){
  let arr=null,convert=false;
  if(editingOutline())arr=editArr();
  else if(kind==="surface"&&!o.shape&&o.warp!=="grid"){arr=o.pts;convert=true;}
  if(!arr)return[];
  const out=[];
  arr.forEach((p,i)=>{const q=arr[(i+1)%arr.length];if(Math.hypot((p[0]-q[0])*W,(p[1]-q[1])*H)<40)return;
    const m=segMid(arr,i);out.push({x:m[0],y:m[1],i,convert,flag:p[2]&&q[2]?1:0});});
  return out;
}
function scaleBodies(bodies,orig,anc,sx,sy){bodies.forEach((a,bi)=>a.forEach((_,i)=>{const o=orig[bi][i];a[i]=[anc[0]+(o[0]-anc[0])*sx,anc[1]+(o[1]-anc[1])*sy,o[2]||0];}));geomV++;}
const selOnStage=()=>{const so=selObj();return so&&rt.sel.kind!=="group"&&so.outputId===rt.out?so:null;};
ov.addEventListener("pointerdown",e=>{
  if(rt.mode!=="map")return;
  if(show.mapLocked&&!rt.drawing){toast("Mapping is locked so nothing gets bumped during the show. Click Unlock mapping above the stage to edit.");return;}
  const[x,y,r]=toN(e);const nearXY=(px,py,R)=>Math.hypot((px-x)*r.width,(py-y)*r.height)<R,near=pt=>nearXY(pt[0],pt[1],14);
  if(rt.drawing){
    const dp=rt.drawing.pts;
    if(dp.length>=3&&near(dp[0])){finishDrawing();return;}
    dp.push([x,y,e.shiftKey?1:0]);renderPanel();return;
  }
  const so=selOnStage(),kind=rt.sel?.kind;
  if(e.altKey&&so&&kind==="surface"&&inPoly([x,y],surfOutline(so))){const t=topImagery(so);
    if(t){const f=frameEdit(so,t.m.id),[bx0,by0,bx1,by1]=boundsOf("surface",so);drag={type:"frame",x,y,f,ox:+f.x||0,oy:+f.y||0,w:Math.max(.001,bx1-bx0),h:Math.max(.001,by1-by0)};ov.setPointerCapture(e.pointerId);ov.style.cursor="move";return;}
    toast("Alt-drag moves media inside a surface. Put a video or image on this surface first.");return;}
  let hit=null;const arr=editArr();
  if(arr){const i=arr.findIndex(near);if(i>=0)hit={kind,o:so,arr,pt:i};}
  if(!hit&&so){
    const h=resizeHandles(kind,so,r.width,r.height).find(hh=>nearXY(hh.x,hh.y,13));
    if(h){const b=bodiesOf(kind,so);drag={type:"scale",h,bodies:b,orig:b.map(a=>a.map(p=>[...p]))};ov.setPointerCapture(e.pointerId);return;}
    const g=edgeGhosts(kind,so,r.width,r.height).find(gg=>nearXY(gg.x,gg.y,11));
    if(g){
      if(g.convert){so.shape=so.pts.map(p=>[p[0],p[1],0]);rt.edit="shape";toast("Now a custom outline. Drag the new point; the content warp stays as it was.");}
      const a=editArr();a.splice(g.i+1,0,[g.x,g.y,g.flag]);rt.selPt=g.i+1;
      drag={x,y,arr:a,pt:g.i+1,orig:[...a[g.i+1]]};geomV++;ov.setPointerCapture(e.pointerId);renderPanel();return;
    }
  }
  const items=layersOn(rt.out).reverse();
  if(!hit)for(const it of items){
    if(rt.sel&&it.o.id===rt.sel.id)continue;
    const prim=it.kind==="mask"?it.o.pts:(it.o.shape||(it.o.warp==="grid"?null:it.o.pts));
    const i=prim?prim.findIndex(near):-1;
    if(i>=0){selectItem(it.kind,it.o);rt.edit=it.kind==="surface"&&it.o.shape?"shape":"warp";hit={...it,arr:prim,pt:i};break;}
  }
  if(!hit&&rt.room&&so&&inPoly([x,y],kind==="mask"?outlineFor(so.pts):surfOutline(so)))hit={kind,o:so,pt:-1};
  if(!hit)for(const it of items){const poly=it.kind==="mask"?outlineFor(it.o.pts):surfOutline(it.o);if(inPoly([x,y],poly)){hit={...it,pt:-1};break;}}
  if(!hit&&arr&&editingOutline()&&nearEdge(arr,x,y,r)>=0)return;
  if(!hit){rt.sel=null;rt.selPt=-1;renderPanel();startPan(e);return;}
  selectItem(hit.kind,hit.o);rt.selPt=hit.pt;
  if(hit.pt>=0)drag={x,y,arr:hit.arr,pt:hit.pt,orig:[...hit.arr[hit.pt]]};
  else{const b=bodiesOf(hit.kind,hit.o);drag={x,y,pt:-1,bodies:b,orig:b.map(a=>a.map(p=>[...p]))};}
  ov.setPointerCapture(e.pointerId);renderPanel();
});
ov.addEventListener("pointermove",e=>{
  const[x,y,r]=toN(e);
  if(rt.drawing){rt.drawing.hover=[x,y];return;}
  if(!drag){hoverCursor(x,y,r);return;}
  if(drag.type==="frame"){drag.f.x=drag.ox+(x-drag.x)/drag.w;drag.f.y=drag.oy+(y-drag.y)/drag.h;syncFrameUI(drag.f);return;}
  if(drag.type==="scale"){
    const h=drag.h,anc=e.altKey?h.center:h.anchor,W=r.width,H=r.height;
    const ox=(h.corner[0]-anc[0])*W,oy=(h.corner[1]-anc[1])*H,cx=(x-anc[0])*W,cy=(y-anc[1])*H;
    let sx,sy;
    if(e.shiftKey){sx=Math.abs(ox)>2?cx/ox:1;sy=Math.abs(oy)>2?cy/oy:1;}
    else sx=sy=(cx*ox+cy*oy)/((ox*ox+oy*oy)||1);
    scaleBodies(drag.bodies,drag.orig,anc,Math.max(sx,0.03),Math.max(sy,0.03));return;
  }
  const dx=x-drag.x,dy=y-drag.y,cl=v=>v;
  if(drag.pt>=0){const o=drag.orig;drag.arr[drag.pt]=[cl(o[0]+dx),cl(o[1]+dy),o[2]||0];}
  else drag.bodies.forEach((a,bi)=>a.forEach((_,i)=>{const o=drag.orig[bi][i];a[i]=[cl(o[0]+dx),cl(o[1]+dy),o[2]||0];}));
  geomV++;
});
function hoverCursor(x,y,r){
  if(rt.mode!=="map"){let cur=view().z>1?"grab":"default";
    if(previewActive()||rt.mode==="timeline"){const pv=frameProv(),s=pv&&surf(pv.sid);
      if(s&&s.outputId===rt.out){const b=mediaBox(s,media(pv.mid),normFrame(pv.get(false)),pv.player);const W=r.width,H=r.height;
        if([[-1,-1],[1,-1],[1,1],[-1,1]].some(([a,bb])=>{const p=posAt(s,b.cu+b.hu*a,b.cv+b.hv*bb);return Math.hypot((p[0]-x)*W,(p[1]-y)*H)<14;}))cur="nwse-resize";
        else if(inPoly([x,y],boxPoly(s,b)))cur="move";}
      if(cur==="default"&&onOut(show.surfaces).some(sf=>inPoly([x,y],surfOutline(sf))))cur="pointer";}
    ov.style.cursor=cur;return;}
  const so=selOnStage();let cur="crosshair";
  if(so){const near=(px,py,R)=>Math.hypot((px-x)*r.width,(py-y)*r.height)<R;
    const h=resizeHandles(rt.sel.kind,so,r.width,r.height).find(hh=>near(hh.x,hh.y,13));
    if(h)cur=h.dir>0?"nwse-resize":"nesw-resize";
    else if(edgeGhosts(rt.sel.kind,so,r.width,r.height).some(g=>near(g.x,g.y,11)))cur="copy";
    else if((editArr()||[]).some(p=>near(p[0],p[1],14)))cur="grab";}
  ov.style.cursor=cur;
}
ov.addEventListener("pointerleave",()=>{if(rt.drawing)rt.drawing.hover=null;rt.ptr=null;});
ov.addEventListener("pointermove",e=>{rt.ptr={x:e.clientX,y:e.clientY};},{capture:true});
const endDrag=()=>{if(drag){drag=null;if(rt.mode==="map"){show.tour=show.tour||{};show.tour.fit=true;
  const so=rt.sel?.kind==="surface"?selObj():null;if(so&&so.shape&&fitWarpToShape(so))renderPanel();}save();}};
ov.addEventListener("pointerup",endDrag);ov.addEventListener("pointercancel",endDrag);
ov.addEventListener("dblclick",e=>{
  if(rt.mode!=="map"||rt.drawing||!editingOutline())return;
  const[x,y,r]=toN(e);const arr=editArr();if(!arr)return;
  const i=arr.findIndex(p=>Math.hypot((p[0]-x)*r.width,(p[1]-y)*r.height)<16);
  if(i>=0){arr[i][2]=arr[i][2]?0:1;rt.selPt=i;save();renderPanel();return;}
  const best=nearEdge(arr,x,y,r);
  if(best>=0){arr.splice(best+1,0,[x,y,0]);rt.selPt=best+1;save();renderPanel();}
});
function startDrawing(kind){rt.mode="map";rt.drawing={kind,pts:[],hover:null};rt.sel=null;rt.selPt=-1;renderPanel();renderBin();}
function finishDrawing(){
  const d=rt.drawing;if(!d)return;
  if(d.pts.length<3){toast("Place at least three points around the shape first.");return;}
  rt.drawing=null;
  if(d.kind==="mask"){const m={id:uid(),outputId:rt.out,z:topZ(rt.out),name:"Mask "+(show.masks.length+1),pts:d.pts};show.masks.push(m);rt.sel={kind:"mask",id:m.id};}
  else{const s=newSurface("Shape "+(show.surfaces.length+1),d.pts);rt.sel={kind:"surface",id:s.id};rt.edit="shape";}
  rt.selPt=-1;save();renderTabs();renderPanel();toast("Shape added. Drag points to refine; double-click a point to curve it.");
}
function cancelDrawing(){rt.drawing=null;renderPanel();}
function newSurface(name,shape){
  const k=show.surfaces.length;
  const s={id:uid(),outputId:rt.out,name,color:SURF_COLORS[k%SURF_COLORS.length],feather:0,look:null,warp:"corner",grid:null,shape:shape||null,
    pts:shape?bbox(shape):presetShape("rect",0.5+(k%5)*0.03,0.5+(k%5)*0.03,0.2)};
  s.z=topZ(rt.out);show.surfaces.push(s);ensureRT();return s;
}

/* ---------- tweens ---------- */
const ease=k=>k*k*(3-2*k);
function tween(obj,key,to,dur,onDone,delay=0){
  rt.tweens=rt.tweens.filter(t=>!(t.obj===obj&&t.key===key));
  if(!(dur>0)&&!(delay>0)){obj[key]=to;onDone&&onDone();return;}
  rt.tweens.push({obj,key,from:obj[key],to,t0:now()+delay*1000,dur:Math.max(1,dur*1000),onDone,started:!(delay>0)});
}
function stepTweens(n){
  for(const t of[...rt.tweens]){
    if(n<t.t0)continue;
    if(!t.started){t.started=true;t.from=t.obj[t.key];}
    const k=clamp((n-t.t0)/t.dur,0,1);t.obj[t.key]=t.from+(t.to-t.from)*ease(k);
    if(k>=1){rt.tweens=rt.tweens.filter(x=>x!==t);t.onDone&&t.onDone();}
  }
}

/* ---------- looks ---------- */
// Each change can use its own transition: crossfade, cut, fade through black, wipes, iris or dissolve.
function applyLook(assign,dur,restart){
  const spans={};
  // A spanning player is created once and shared; its fades run once and tidy up every surface when done.
  const tw=(a,obj,key,to,d,done,delay)=>{if(!a.span||!obj.span){tween(obj,key,to,d,done,delay);return;}
    const sp=spans[a.span.key]||(spans[a.span.key]={fins:{},started:{}});(sp.fins[key]=sp.fins[key]||[]).push(done);
    if(!sp.started[key]){sp.started[key]=true;tween(obj,key,to,d,()=>sp.fins[key].forEach(f=>f&&f()),delay);}};
  for(const a of assign||[]){
    const r=rt.surf[a.surfaceId];if(!r)continue;
    const target=a.level??1,tr=TRANS[a.trans]?a.trans:"xfade",d=tr==="cut"?0:dur;
    const top=r.players[r.players.length-1];
    const live=r.level>0.01&&r.players.some(p=>p.op>0.01);
    const mid=a.mediaId||(TRANS_CODE[tr]&&live?"__black":null);
    if(!mid){const old=r.players.slice();old.forEach(p=>tween(p,"op",0,tr==="black"?d/2:d,()=>{r.players=r.players.filter(x=>x!==p)}));continue;}
    const same=a.span?(top&&top.span&&top.span.key===a.span.key):(top&&!top.span);
    if(same&&top.mediaId===mid&&top.op>0.001&&!top.trans){top.frame=a.frame||null;if(restart&&top.vid){try{top.vid.currentTime=trimOf(a.surfaceId,mid).in;}catch(e){}top.vid._done=false;}tween(top,"op",1,d);tween(r,"level",target,d);continue;}
    if(r.level<0.01){r.players=[];r.level=target;}else tween(r,"level",target,d);
    const old=r.players.slice();let p;
    if(a.span&&mid!=="__black"){const sp=spans[a.span.key]||(spans[a.span.key]={fins:{},started:{}});p=sp.p||(sp.p={mediaId:mid,op:0,sid:a.span.sids[0],frame:a.frame||null,span:{key:a.span.key,sids:a.span.sids}});}
    else p={mediaId:mid,op:0,sid:a.surfaceId,frame:a.frame||null};
    r.players.push(p);
    const finish=()=>{r.players=r.players.filter(x=>!old.includes(x));if(mid==="__black")r.players=r.players.filter(x=>x!==p);};
    if(TRANS_CODE[tr]&&live){p.op=1;p.trans=TRANS_CODE[tr];if(!p.span||!spans[a.span.key].started.prog)p.prog=0;tw(a,p,"prog",1,d,()=>{p.trans=0;finish();});}
    else if(tr==="black"&&live){old.forEach(o=>tween(o,"op",0,d/2));tw(a,p,"op",1,d/2,finish,d/2);}
    else{if(target<1)old.forEach(o=>tween(o,"op",0,d));tw(a,p,"op",1,d,finish);}
  }
}
// Rows apply top to bottom; a later row overrides earlier ones for the surfaces it covers.
function applyLookRows(rows,dur,restart,cueTrans){
  const per=new Map();
  for(const row of rows||[]){const sids=resolveTarget(row.target),span=row.span&&sids.length>1&&row.mediaId?{key:row.mediaId+"|"+sids.join(","),sids}:null;
    for(const sid of sids)per.set(sid,{surfaceId:sid,mediaId:row.mediaId,level:row.level??1,frame:span?row.spanFrame||null:row.frames?.[sid]||null,span,trans:TRANS[row.trans]?row.trans:(cueTrans||"xfade")});}
  applyLook([...per.values()],dur,restart);
}
function captureLook(){
  return show.surfaces.map(s=>{const r=rt.surf[s.id];const live=[...(r?.players||[])].reverse().find(p=>p.op>0.5);
    return{target:s.id,mediaId:live&&live.mediaId!=="__black"?live.mediaId:null,level:r&&r.level>0.01?+r.level.toFixed(2):1};});
}

/* ---------- audio ---------- */
let AC=null,master=null;
function ac(){
  if(!AC){const C=window.AudioContext||window.webkitAudioContext;if(!C)return null;AC=new C();master=AC.createGain();master.connect(AC.destination);applyAudioDevice();}
  if(AC.state==="suspended")AC.resume();return AC;
}
/* ---------- audio mapping: speakers are channels on the chosen output device ----------
   Every sound goes through a router: its left and right are sent to any speakers at any level, then merged
   into one many-channel signal for the output device (an audio interface, or the Mac's own two speakers). */
function AU(){const a=show.audio||(show.audio={deviceId:"",deviceLabel:"",speakers:[]});if(!a.speakers.length)a.speakers=[{id:"spk-l",name:"Left",ch:0},{id:"spk-r",name:"Right",ch:1}];return a;}
let NCH=2;const routers=new Set();
function defaultRoute(){const sp=AU().speakers;if(sp.length>=2)return{[sp[0].id]:{src:"L",lvl:1},[sp[1].id]:{src:"R",lvl:1}};return sp[0]?{[sp[0].id]:{src:"LR",lvl:1}}:{};}
async function applyAudioDevice(){const ctx=AC;if(!ctx)return;const id=AU().deviceId||"";
  if(ctx.setSinkId&&(ctx.sinkId||"")!==id){try{await ctx.setSinkId(id);}catch(e){toast("That sound output isn't available right now, so Cuelight is using the system output. Check Speakers.");try{await ctx.setSinkId("");}catch(e2){}}}
  NCH=Math.max(1,Math.min(32,ctx.destination.maxChannelCount||2));
  for(const n of[ctx.destination,master]){try{n.channelCount=NCH;n.channelCountMode="explicit";n.channelInterpretation="discrete";}catch(e){}}
  rebuildRouters();
  document.querySelectorAll("video,audio").forEach(el=>{try{el.setSinkId&&el.setSinkId(id).catch(()=>{});}catch(e){}});
  if(typeof renderAudioSetup==="function")renderAudioSetup();}
function rebuildRouters(){routers.forEach(r=>r.rebuild());}
function makeRouter(getRoute){const ctx=ac();if(!ctx)return null;
  const inp=ctx.createGain();inp.channelCount=2;inp.channelCountMode="explicit";inp.channelInterpretation="speakers";
  const sp=ctx.createChannelSplitter(2);inp.connect(sp);let merger=null,xs=[];
  const R={input:inp,
    rebuild(){xs.forEach(g=>{try{g.disconnect();}catch(e){}});xs=[];if(merger){try{merger.disconnect();}catch(e){}}
      merger=ctx.createChannelMerger(NCH);merger.connect(master);const route=getRoute()||defaultRoute();
      for(const spk of AU().speakers){const r=route[spk.id];if(!r||!(r.lvl>0)||spk.ch>=NCH)continue;
        const add=(chIn,k)=>{const g=ctx.createGain();g.gain.value=r.lvl*k;sp.connect(g,chIn);g.connect(merger,0,spk.ch);xs.push(g);};
        if(r.src==="L")add(0,1);else if(r.src==="R")add(1,1);else{add(0,0.5);add(1,0.5);}}},
    dispose(){routers.delete(R);try{inp.disconnect();}catch(e){}xs.forEach(g=>{try{g.disconnect();}catch(e){}});if(merger){try{merger.disconnect();}catch(e){}}}};
  routers.add(R);R.rebuild();return R;}
// A short burst of noise on one speaker, to check which speaker is which.
function testSpeaker(spk){const ctx=ac();if(!ctx)return;if(spk.ch>=NCH){toast(`${spk.name} is on channel ${spk.ch+1}, but this output only has ${NCH}.`);return;}
  const len=Math.floor(ctx.sampleRate*0.9),buf=ctx.createBuffer(1,len,ctx.sampleRate),d=buf.getChannelData(0);let b0=0,b1=0,b2=0;
  for(let i=0;i<len;i++){const w=Math.random()*2-1;b0=0.997*b0+w*0.029;b1=0.985*b1+w*0.032;b2=0.95*b2+w*0.048;const env=Math.min(1,i/800,(len-i)/4000);d[i]=(b0+b1+b2+w*0.02)*0.5*env;}
  const src=ctx.createBufferSource();src.buffer=buf;const m=ctx.createChannelMerger(NCH);src.connect(m,0,spk.ch);m.connect(master);src.start();src.onended=()=>{try{m.disconnect();}catch(e){}};}
function startAudio(m,level,fade,loop,onEnd,route){
  const ctx=ac();if(!ctx||!m)return null;
  const g=ctx.createGain();g.gain.value=0;const R=makeRouter(()=>route);g.connect(R.input);
  const inst={id:uid(),m,g,R,lvl:0,nodes:[],el:null,done:false};
  const finish=()=>{if(inst.done)return;inst.done=true;killAudio(inst);onEnd&&onEnd();};
  if(m.kind==="audio"){
    const r=mediaRT[m.id];if(!r){g.disconnect();return null;}
    const el=new Audio(r.url);el.loop=!!loop;const src=ctx.createMediaElementSource(el);src.connect(g);el.play().catch(()=>{});
    el.onended=finish;inst.el=el;inst.nodes.push(src);
  }else if(m.gen==="drone"){
    const f=ctx.createBiquadFilter();f.type="lowpass";f.frequency.value=700;f.Q.value=2;f.connect(g);
    const lfo=ctx.createOscillator(),lg=ctx.createGain();lfo.frequency.value=0.08;lg.gain.value=450;lfo.connect(lg);lg.connect(f.frequency);lfo.start();
    for(const[fr,ty,v]of[[110,"sawtooth",.18],[110.8,"sawtooth",.18],[164.8,"triangle",.12],[55,"sine",.3]]){
      const o=ctx.createOscillator(),og=ctx.createGain();o.type=ty;o.frequency.value=fr;og.gain.value=v;o.connect(og);og.connect(f);o.start();inst.nodes.push(o,og);}
    inst.nodes.push(f,lfo,lg);
  }else{
    const t0=ctx.currentTime;
    for(const[mul,v,dec]of[[1,.35,3.2],[2.76,.18,1.8],[5.4,.1,1],[8.93,.05,.6]]){
      const o=ctx.createOscillator(),og=ctx.createGain();o.type="sine";o.frequency.value=659.25*mul;
      og.gain.setValueAtTime(0,t0);og.gain.linearRampToValueAtTime(v,t0+0.005);og.gain.exponentialRampToValueAtTime(0.0001,t0+dec);
      o.connect(og);og.connect(g);o.start(t0);o.stop(t0+dec+0.1);inst.nodes.push(o,og);}
    inst.timer=setTimeout(finish,3400);
  }
  rt.audio.push(inst);tween(inst,"lvl",level,fade);
  return inst;
}
function killAudio(inst){
  inst.done=true;clearTimeout(inst.timer);
  try{inst.el&&inst.el.pause()}catch(e){}
  for(const n of inst.nodes){try{n.stop&&n.stop()}catch(e){}try{n.disconnect()}catch(e){}}
  try{inst.g.disconnect()}catch(e){}try{inst.R&&inst.R.dispose()}catch(e){}
  rt.audio=rt.audio.filter(a=>a!==inst);rt.tweens=rt.tweens.filter(t=>t.obj!==inst);
}
function fadeAllAudio(to,dur,stop){for(const a of[...rt.audio])tween(a,"lvl",to,dur,stop?()=>killAudio(a):null);}
function applyAudioLevels(){if(!AC)return;for(const a of rt.audio)a.g.gain.setTargetAtTime(Math.max(0,a.lvl),AC.currentTime,0.012);}

/* ---------- cue engine ---------- */
/* ---------- triggers: each cue starts on GO, with another cue, after another cue ends, or N seconds after another cue ---------- */
const TRIG={go:"On GO",with:"With cue",after:"After cue ends",delay:"Seconds after cue"};
const trig=c=>{const t=c?.trigger;return t&&TRIG[t.type]?t:{type:"go"};};
function fire(i,extraMs=0,chain=[]){
  const c=show.cues[i];if(!c)return;
  rt.active.push({iid:uid(),cue:c,idx:i,t0:now(),pre:Math.max(0,+c.preWait||0)*1000+extraMs,state:"pre",start:0,end:0,hold:false,chain});
}
// Start any cues linked to cue c. A cue already in this chain is skipped, so loops can't run forever.
function fireLinked(c,when,chain){
  const ch=[...(chain||[]),c.id];
  show.cues.forEach((d,i)=>{const t=trig(d);if(t.cue!==c.id||ch.includes(d.id))return;
    const from=t.from==="end"?"end":"start";
    if(when==="start"&&(t.type==="with"||(t.type==="delay"&&from==="start")))fire(i,t.type==="delay"?Math.max(0,+t.secs||0)*1000:0,ch);
    if(when==="end"&&(t.type==="after"||(t.type==="delay"&&from==="end")))fire(i,t.type==="delay"?Math.max(0,+t.secs||0)*1000:0,ch);});
}
function startCue(inst,n){
  const c=inst.cue,d=Math.max(0,+c.duration||0);
  inst.state="run";inst.start=n;inst.end=n+d*1000;
  if((c.type==="look"||c.type==="fade"||c.type==="blackout")&&rt.outSrc==="timeline"){rt.outSrc="cues";tlPause();showStage();}
  switch(c.type){
    case"timeline":if(c.action==="stop"){tlPause();rt.outSrc="cues";}else if(c.action==="pause")tlPause();else{tlPlay(+c.from||0);rt.outSrc="timeline";}showStage();renderTLTransport();break;
    case"look":applyLookRows(c.assign,d,c.restart,c.trans);break;
    case"fade":resolveTarget(c.target).forEach(id=>rt.surf[id]&&tween(rt.surf[id],"level",+c.level,d));break;
    case"audio":{const m=media(c.mediaId);
      const hold=m&&((m.kind==="audio"&&!c.loop)||(m.kind==="synth"&&m.gen==="chime"));inst.hold=!!hold;
      inst.audio=startAudio(m,+c.level,d,c.loop,()=>{inst.hold=false;},c.route);
      if(!inst.audio){inst.hold=false;if(m&&missing(m))toast(`“${m.name}” needs its file re-added before it can play.`);}
      break;}
    case"audiofade":fadeAllAudio(+c.level,d,+c.level<=0.001);break;
    case"blackout":show.surfaces.forEach(s=>rt.surf[s.id]&&tween(rt.surf[s.id],"level",0,d));if(c.withAudio)fadeAllAudio(0,d,true);break;
  }
  fireLinked(c,"start",inst.chain);
}
function stepCues(n){
  for(const inst of[...rt.active]){
    if(inst.state==="pre"&&n-inst.t0>=inst.pre)startCue(inst,n);
    if(inst.state==="run"&&n>=inst.end&&!inst.hold){rt.active=rt.active.filter(x=>x!==inst);fireLinked(inst.cue,"end",inst.chain);}
  }
}
function go(){
  ac();
  if(rt.playhead>=show.cues.length){toast("End of the cue list. Click a cue to stand by on it.");return;}
  if(rt.testPattern){rt.testPattern=false;syncTP();}
  fire(rt.playhead);rt.previewOn=false;show.tour=show.tour||{};show.tour.go=true;
  let j=rt.playhead+1;while(j<show.cues.length&&trig(show.cues[j]).type!=="go")j++;
  rt.playhead=j;renderPanel();
}
let lastPanic=0;
function panic(){
  const n=now(),hard=n-lastPanic<1200;lastPanic=n;
  rt.active=[];const d=hard?0:1;if(rt.outSrc==="timeline"||tl.playing){tlPause();rt.outSrc="cues";showStage();renderTLTransport();}
  show.surfaces.forEach(s=>rt.surf[s.id]&&tween(rt.surf[s.id],"level",0,d));
  if(hard)[...rt.audio].forEach(killAudio);else fadeAllAudio(0,d,true);
  toast(hard?"Hard stop. Everything is out.":"Panic: fading everything out. Press again for a hard stop.");
}

/* ---------- running strip ---------- */
const runRows=new Map();
function fmt(s){return s>=60?`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`:s.toFixed(1)+"s"}
function updateRunning(n){
  const box=$("#running");const live=new Set();
  for(const inst of rt.active){
    live.add(inst.iid);let row=runRows.get(inst.iid);
    if(!row){row=document.createElement("div");row.className="run-row";
      row.innerHTML=`<span class="n">${esc(inst.cue.num)}</span><span class="nm">${esc(inst.cue.name)} <span class="type">${CUE_TYPES[inst.cue.type]}</span></span><span class="t"></span><button class="x" title="Stop this cue" aria-label="Stop cue ${esc(inst.cue.num)}">×</button><span class="bar"><i></i></span>`;
      row.querySelector(".x").onclick=()=>{rt.active=rt.active.filter(x=>x!==inst);if(inst.audio)killAudio(inst.audio);};
      box.appendChild(row);runRows.set(inst.iid,row);}
    let k,txt;
    if(inst.state==="pre"){k=inst.pre?(n-inst.t0)/inst.pre:1;txt="pre "+fmt(Math.max(0,(inst.pre-(n-inst.t0))/1000));row.classList.add("pre");}
    else{row.classList.remove("pre");const el=inst.audio?.el;
      if(inst.hold&&el&&isFinite(el.duration)&&el.duration>0){k=el.currentTime/el.duration;txt=fmt(el.duration-el.currentTime);}
      else{const dur=inst.end-inst.start;k=dur>0?(n-inst.start)/dur:1;txt=inst.hold?"playing":fmt(Math.max(0,(inst.end-n)/1000));}}
    row.querySelector("i").style.width=(clamp(k,0,1)*100).toFixed(1)+"%";row.querySelector(".t").textContent=txt;
  }
  for(const[id,row]of runRows)if(!live.has(id)){row.remove();runRows.delete(id);}
  let empty=box.querySelector(".empty");
  if(!rt.active.length&&!empty){empty=document.createElement("div");empty.className="empty";box.appendChild(empty);}
  if(empty){if(rt.active.length)empty.remove();else empty.textContent=rt.audio.length?`Nothing running. ${rt.audio.length} sound${rt.audio.length>1?"s":""} still playing; Panic or a Fade audio cue stops ${rt.audio.length>1?"them":"it"}.`:"Nothing running. Press GO to fire the cue on standby.";}
  const running=new Set(rt.active.map(a=>a.cue.id));
  document.querySelectorAll("tr[data-cue]").forEach(tr=>tr.classList.toggle("running",running.has(tr.dataset.cue)));
}

/* ---------- media bin ---------- */
function swatchCSS(m){
  if(m.kind==="image"&&mediaRT[m.id]?.thumb)return`background-image:url(${mediaRT[m.id].thumb})`;
  if(m.kind==="video"&&mediaRT[m.id]?.thumb)return`background-image:url(${mediaRT[m.id].thumb})`;
  if(m.kind!=="gen")return m.kind==="video"?"background:repeating-linear-gradient(90deg,#1c212a 0 10px,#151920 10px 20px)":"background:linear-gradient(180deg,#151920,#1c212a)";
  const a=m.c1,b=m.c2;
  switch(m.gen){
    case"solid":return`background:${a}`;
    case"wash":return`background:linear-gradient(120deg,${a},${b})`;
    case"gradient":return`background:linear-gradient(90deg,${b},${a},${b})`;
    case"stripes":return`background:repeating-linear-gradient(45deg,${a} 0 7px,${b} 7px 14px)`;
    case"plasma":return`background:radial-gradient(circle at 25% 30%,${a},transparent 55%),radial-gradient(circle at 75% 70%,${b},transparent 60%),${b}`;
    case"pulse":return`background:radial-gradient(circle,${a},#000 78%)`;
    case"strobe":return`background:repeating-linear-gradient(90deg,${a} 0 3px,#000 3px 14px)`;
    case"sparkle":return`background:radial-gradient(${a} 0.8px,transparent 1.4px) 0 0/9px 9px,radial-gradient(${a} 0.6px,transparent 1.2px) 4px 5px/13px 13px,${b}`;
    case"grid":return`background:linear-gradient(${a} 1px,transparent 1px) 0 0/12px 12px,linear-gradient(90deg,${a} 1px,transparent 1px) 0 0/12px 12px,#111`;
  }
  return"background:#000";
}
function kindLabel(m){return m.kind==="gen"?(GENS[m.gen]?.label||"Visual"):m.kind==="synth"?"Synth audio":m.kind[0].toUpperCase()+m.kind.slice(1)}
const LIB_FILTERS={all:"All",video:"Videos",image:"Images",gen:"Effects",audio:"Audio"};
const libKind=m=>m.kind==="synth"?"audio":m.kind;
function usedIn(m){return show.cues.filter(c=>(c.assign||[]).some(r=>r.mediaId===m.id)||c.mediaId===m.id).length;}
function renderBin(){
  const f=rt.libFilter||"all",q=(rt.libQuery||"").trim().toLowerCase();
  const counts={all:show.media.length};for(const m of show.media)counts[libKind(m)]=(counts[libKind(m)]||0)+1;
  $("#libBar").innerHTML=`<div class="chips" role="group" aria-label="Filter media">${Object.entries(LIB_FILTERS).map(([k,l])=>`<button class="chipbtn" data-act="lib-filter" data-v="${k}" aria-pressed="${f===k}">${l} <span>${counts[k]||0}</span></button>`).join("")}</div>
    <input id="libQ" type="search" placeholder="Search media" value="${esc(rt.libQuery||"")}" aria-label="Search media">`;
  const list=show.media.filter(m=>(f==="all"||libKind(m)===f)&&(!q||m.name.toLowerCase().includes(q)));
  if(!list.length){$("#bin").innerHTML=`<p class="note" style="grid-column:1/-1">${show.media.length?"Nothing matches. Try another filter or search.":"Your library is empty. Upload videos and images, or add an effect."}</p>`;renderMediaInsp();return;}
  $("#bin").innerHTML=list.map(m=>{const u=usedIn(m);return`<button class="tile${rt.selMedia===m.id?" on":""}${missing(m)||mediaRT[m.id]?.err?" missing":""}" data-act="media" data-id="${m.id}" title="${esc(m.name)}${isVisual(m)?" — drag onto a surface":""}" ${(isVisual(m)||m.kind==="audio")&&!missing(m)?'draggable="true"':""}>
    <span class="sw" style="${swatchCSS(m)}"><span>${esc(m.kind==="gen"?"":m.kind==="synth"?"♪ SYNTH":m.kind==="audio"?"♪ AUDIO":m.kind==="video"?"▶ "+(fmtDur(mediaRT[m.id]?.dur)||"VIDEO"):"IMAGE")}</span></span>
    <span class="nm" data-rn="media:${m.id}">${missing(m)?"Missing: ":mediaRT[m.id]?.err?"⚠ ":""}${esc(m.name)}</span>${u?`<span class="used" title="Used in ${u} cue${u===1?"":"s"}">${u} cue${u===1?"":"s"}</span>`:""}</button>`}).join("");
  renderMediaInsp();
}
function renderMediaInsp(){
  const box=$("#mediaInsp");const m=media(rt.selMedia);
  if(!m){box.hidden=true;return;}box.hidden=false;
  let h=`<div class="sec-head"><h3>${esc(kindLabel(m))}</h3><div class="acts">
    ${m.kind==="gen"?`<button class="btn" data-act="dup-media">Duplicate</button>`:""}
    <button class="btn ghost danger" data-act="delete" data-kind="media" data-id="${m.id}">Delete</button></div></div>
    <div class="field"><label for="md-name">Name</label><input id="md-name" type="text" data-md="name" value="${esc(m.name)}"></div>`;
  if(m.kind==="gen"){
    h+=`<div class="field"><span class="lab">Colors</span><div class="inline"><input id="md-c1" type="color" data-md="c1" value="${m.c1}" aria-label="Color 1">${["solid","pulse","strobe","grid"].includes(m.gen)?"":`<input id="md-c2" type="color" data-md="c2" value="${m.c2}" aria-label="Color 2">`}</div></div>
      <div class="field"><label for="md-speed">Speed</label><div class="inline"><input id="md-speed" type="range" min="0" max="4" step="0.05" data-md="speed" value="${m.speed??1}"><output>${(+(m.speed??1)).toFixed(2)}×</output></div></div>`;
  }
  if(m.kind==="video"&&mediaRT[m.id]?.dur)h+=`<div class="field"><span class="lab">Clip</span><span class="mono" style="font-size:12.5px">${fmtDur(mediaRT[m.id].dur)} · ${mediaRT[m.id].w}×${mediaRT[m.id].h}</span></div>`;
  if(m.kind==="video")h+=`<div class="field"><span class="lab">Sound in cues</span><label class="inline"><input id="md-sound" type="checkbox" data-md="sound" ${m.sound?"checked":""}> Play its sound when a cue shows it</label></div><p class="note" style="margin-top:-4px">On the timeline, each clip has its own sound switch and fades.</p>`;
  if(mediaRT[m.id]?.err)h+=`<p class="note media-err">${esc(mediaRT[m.id].err)}</p>`;
  if(m.kind==="video"&&mediaRT[m.id]){const r=mediaRT[m.id],v=document.createElement("video"),cp=t=>v.canPlayType(t)?"yes":"no";
    h+=`<details class="vcheck"><summary>Playback check</summary><div class="mono">
      File: ${esc(r.blob?.name||m.name)} · ${esc(r.blob?.type||"type not reported")} · ${r.blob?((r.blob.size/1048576).toFixed(1)+" MB"):"?"}<br>
      Status: ${r.err?"can't play":r.dur?`ready · ${fmtDur(r.dur)} · ${r.w}×${r.h}`:"loading…"} · loaded via ${esc(r.via||"?")}<br>
      This browser plays: MP4/H.264 ${cp('video/mp4; codecs="avc1.42E01E"')} · HEVC ${cp('video/mp4; codecs="hvc1.1.6.L93.B0"')} · WebM/VP9 ${cp('video/webm; codecs="vp9"')} · MOV ${cp("video/quicktime")}<br>
      Running ${window.top!==window?"inside Claude":"as the standalone file"}</div></details>`;}
  if(missing(m))h+=`<p class="note">This file isn't loaded on this machine. <label class="btn" for="relinkIn">Re-add file…</label></p>`;
  if(isVisual(m)&&!missing(m)){
    const uc=rt.uc||(rt.uc={target:rt.sel?.kind==="surface"?rt.sel.id:rt.sel?.kind==="group"?"g:"+rt.sel.id:"all",trans:"xfade"});
    if(!resolveTarget(uc.target).length&&uc.target!=="all")uc.target="all";
    const cur=show.cues[rt.playhead],canAdd=rt.mode==="cues"&&cur&&cur.type==="look";
    h+=`<div class="usecue"><div class="vt-head"><span class="lab">Use in a cue</span></div>
      <div class="vt-grid">
        <label for="uc-target">Put it on</label><select id="uc-target">${targetOptions(uc.target)}</select>
        <label for="uc-trans">Transition</label><select id="uc-trans">${Object.entries(TRANS).map(([k,v])=>opt(k,v,uc.trans)).join("")}</select>
      </div>
      <div class="btns"><button class="btn primary" data-act="uc-new">New Look cue</button>${canAdd?`<button class="btn" data-act="uc-add">Add to cue ${esc(cur.num)} · ${esc(cur.name)}</button>`:""}</div>
      <p class="note">You can also drag this tile onto a cue in the cue list, onto a row in a Look cue, or onto a surface on the stage.</p></div>`;
  }
  if(m.kind==="audio"||m.kind==="synth")h+=`<p class="note">Sound plays from Audio cues. Add one in Cues mode.</p>`;
  box.innerHTML=h+`<input id="relinkIn" type="file" class="sr" accept="${m.kind}/*">`;
}
function addFiles(files,quiet){
  const made=[];
  for(const f of files){
    const kind=fileKind(f);
    if(!kind){toast(`“${f.name}” isn't a file type Cuelight recognises. Use video (MP4, MOV, WebM), images (JPG, PNG, GIF, WebP) or audio (MP3, WAV, M4A).`);continue;}
    const m={id:uid(),kind,name:f.name.replace(/\.[^.]+$/,""),sound:false};
    show.media.push(m);loadFile(m,f);rt.selMedia=m.id;made.push(m);storeFile(m.id,f);
  }
  save();renderBin();if(!quiet)renderPanel();
  if(made.length&&!quiet)toast(`${made.length===1?`“${made[0].name}”`:made.length+" files"} added to the media bin. Drag ${made.length===1?"it":"a tile"} onto a surface on the stage to use ${made.length===1?"it":"them"}.`);
  return made;
}
/* ---------- library files are kept in this browser (IndexedDB), so they survive a reload ---------- */
const IDB={db:null,
  open(){if(this.db)return Promise.resolve(this.db);return new Promise(res=>{try{const q=indexedDB.open("cuelight-media",1);q.onupgradeneeded=()=>q.result.createObjectStore("files");q.onsuccess=()=>{this.db=q.result;res(this.db);};q.onerror=()=>res(null);}catch(e){res(null);}});},
  async tx(mode,fn){const db=await this.open();if(!db)return null;return new Promise(res=>{try{const t=db.transaction("files",mode),st=t.objectStore("files");const r=fn(st);t.oncomplete=()=>res(r?.result??true);t.onerror=()=>res(null);}catch(e){res(null);}});},
  put(id,b){return this.tx("readwrite",st=>st.put(b,id));},
  get(id){return this.tx("readonly",st=>st.get(id));},
  keys(){return this.tx("readonly",st=>st.getAllKeys());},
  del(id){return this.tx("readwrite",st=>st.delete(id));}
};
let storeWarned=false;
function storeFile(id,f){IDB.put(id,f).then(ok=>{if(!ok&&!storeWarned){storeWarned=true;toast("This browser won't let Cuelight keep files, so uploads will need re-adding after a reload.");}updateStorageNote();});}
async function restoreFiles(){
  const need=show.media.filter(m=>(m.kind==="video"||m.kind==="image"||m.kind==="audio")&&!mediaRT[m.id]);
  for(const m of need){const b=await IDB.get(m.id);if(b instanceof Blob)loadFile(m,b);}
  if(need.length){renderBin();renderPanel();}
  return need.filter(m=>!mediaRT[m.id]).length;
}
// Media files are shared by id across projects; only remove files that no project uses.
async function pruneFiles(){const keys=await IDB.keys();if(!Array.isArray(keys))return;const ids=new Set(show.media.map(m=>m.id));
  for(const p of proj.idx.list){const sh=p.id===proj.idx.current?show:readProject(p.id);for(const m of sh?.media||[])ids.add(m.id);}
  for(const k of keys)if(!ids.has(k))IDB.del(k);}
async function updateStorageNote(){
  const el=$("#libStore");if(!el)return;
  try{const e=await navigator.storage?.estimate?.();if(e&&e.usage!=null){el.textContent=`Uploads are kept in this browser · ${(e.usage/1048576).toFixed(e.usage>1e8?0:1)} MB used`;return;}}catch(err){}
  el.textContent="Uploads are kept in this browser";
}
const EXT={video:["mp4","m4v","mov","webm","mkv","avi","ogv","mpg","mpeg","wmv","hevc","mxf"],image:["jpg","jpeg","png","gif","webp","bmp","svg","avif","heic","heif","tif","tiff","ico"],audio:["mp3","wav","aac","m4a","ogg","oga","flac","aif","aiff","opus","wma"]};
const extOf=n=>(String(n).match(/\.([a-z0-9]+)$/i)||[,""])[1].toLowerCase();
function fileKind(f){
  const t=(f.type||"").toLowerCase();
  if(t.startsWith("video/"))return"video";if(t.startsWith("image/"))return"image";if(t.startsWith("audio/"))return"audio";
  const e=extOf(f.name);for(const k in EXT)if(EXT[k].includes(e))return k;return null;
}
function mediaErr(m,f,code){
  const e=extOf(f?.name||m.name),name=`“${m.name}”`;
  if(m.kind==="image"){
    if(["heic","heif","tif","tiff","psd"].includes(e))return`${name} is a .${e} file, which browsers can't display. Export it as JPG or PNG and upload again.`;
    return`${name} couldn't be opened as an image. Try saving it as JPG or PNG.`;
  }
  if(["mov","mkv","avi","wmv","mxf","hevc","mpg","mpeg"].includes(e))return`${name} is a .${e} file this browser can't play (often ProRes or HEVC). Convert it to MP4 (H.264) or WebM and upload again.`;
  return`${name} couldn't be played by this browser${code?` (error ${code})`:""}. MP4 (H.264) or WebM works everywhere. If you're using Cuelight inside Claude, the standalone Cuelight file also avoids browser restrictions.`;
}
function mediaFail(m,msg){const r=mediaRT[m.id];if(!r||r.err)return;r.err=msg;renderBin();toast(msg);}
function renderPanelSoon(){if(!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||""))renderPanel();}
function makeThumb(m,url){
  const v=document.createElement("video");v.muted=true;v.preload="auto";v.playsInline=true;vidPool.appendChild(v);
  v.addEventListener("error",()=>videoFallback(m,v.error?.code),{once:true});
  v.src=url;
  v.addEventListener("loadedmetadata",()=>{setTimeout(()=>tlFixAutoDur(m),0);if(!v.videoWidth){mediaFail(m,`“${m.name}” has sound but no picture this browser can show. Try an MP4 (H.264) or WebM file.`);return;}const r=mediaRT[m.id];if(r){r.dur=v.duration;r.w=v.videoWidth;r.h=v.videoHeight;}try{v.currentTime=Math.min(1,(v.duration||2)*0.1);}catch(e){}},{once:true});
  v.addEventListener("seeked",()=>{try{const c=document.createElement("canvas");c.width=192;c.height=Math.max(1,Math.round(192*(v.videoHeight||9)/(v.videoWidth||16)));
    c.getContext("2d").drawImage(v,0,0,c.width,c.height);const r=mediaRT[m.id];if(r){r.thumb=c.toDataURL("image/jpeg",0.72);renderBin();if(rt.mode==="map"&&!/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName||""))renderPanel();}}catch(e){}
    v.removeAttribute("src");v.load();v.remove();},{once:true});
}
const fmtDur=s=>!isFinite(s)?"":`${Math.floor(s/60)}:${String(Math.floor(s%60)).padStart(2,"0")}`;
function loadFile(m,f){
  const old=mediaRT[m.id];if(old?.url)URL.revokeObjectURL(old.url);
  const r={url:null,el:null,tex:old?.tex||null,up:false,err:null,blob:f};mediaRT[m.id]=r;
  if(m.kind==="image"){
    const done=src=>{if(mediaRT[m.id]!==r)return;r.el=src;r.w=src.width||src.naturalWidth;r.h=src.height||src.naturalHeight;r.up=false;
      try{const c=document.createElement("canvas");c.width=192;c.height=Math.max(1,Math.round(192*r.h/(r.w||1)));c.getContext("2d").drawImage(src,0,0,c.width,c.height);r.thumb=c.toDataURL("image/jpeg",0.78);}catch(e){}
      renderBin();renderPanelSoon();};
    const viaImg=()=>{try{const u=URL.createObjectURL(f);const im=new Image();im.onload=()=>done(im);im.onerror=()=>mediaFail(m,mediaErr(m,f));im.src=u;r.url=u;}catch(e){mediaFail(m,mediaErr(m,f));}};
    if(window.createImageBitmap)createImageBitmap(f).then(done,viaImg);else viaImg();
    return;
  }
  try{r.url=URL.createObjectURL(f);r.via="file link";}catch(e){r.triedData=false;videoFallback(m);return;}
  if(m.kind==="video")makeThumb(m,r.url);
  if(m.kind==="audio"){try{const a=new Audio();a.preload="metadata";a.onloadedmetadata=()=>{r.dur=a.duration;renderBin();tlFixAutoDur(m);};a.src=r.url;}catch(e){}}
}

/* ---------- panel ---------- */
const panel=$("#panel");
function opt(v,label,cur){return`<option value="${esc(v)}"${String(cur)===String(v)?" selected":""}>${esc(label)}</option>`}
function range(id,attr,val,min,max,step,suffix=""){return`<div class="inline"><input id="${id}" type="range" min="${min}" max="${max}" step="${step}" ${attr} value="${val}"><output>${suffix==="%"?Math.round(val*100)+"%":(+val).toFixed(2)+suffix}</output></div>`}
// Timeline mode puts the media library beside the stage and timeline so both are visible.
function sizeStage(){const f=frameEl;if(!f)return;
  if(document.body.classList.contains("tl-mode")){const m=/([\d.]+)\s*\/\s*([\d.]+)/.exec(f.style.aspectRatio||"16 / 9"),ratio=m?(+m[1]/+m[2]):16/9;
    const w=Math.min(f.parentElement.clientWidth,Math.max(280,window.innerHeight*0.34*ratio));f.style.width=w+"px";f.style.marginInline="auto";}
  else{f.style.width="";f.style.marginInline="";}}
window.addEventListener("resize",()=>sizeStage());
function placeBin(){const tlm=rt.mode==="timeline",w=$("#binWrap"),side=$("#sideBin");if(!w||!side)return;document.body.classList.toggle("tl-mode",tlm);if(!tlm)document.body.classList.remove("blade");side.hidden=!tlm;
  if(tlm&&w.parentNode!==side)side.appendChild(w);else if(!tlm&&w.parentNode===side){const k=document.querySelector(".col .keys");k.parentNode.insertBefore(w,k);}sizeStage();}
function syncLockBtn(){const g=$("#guideBtn");if(g){g.hidden=rt.mode!=="map";g.setAttribute("aria-pressed",!!rt.guides);}const b=$("#lockBtn");if(!b)return;b.setAttribute("aria-pressed",!!show.mapLocked);b.textContent=show.mapLocked?"🔒 Unlock mapping":"Lock mapping";b.hidden=rt.mode!=="map";}
// Getting started: five steps from an empty show to a running one, ticked off as you do them.
function tourSteps(){const tr=show.tour||{};
  const proj=DESK?show.outputs.some(o=>displayFor(o)):Object.values(outWins).some(w=>w&&!w.closed);
  return[
    {k:"proj",done:proj,t:"Connect a projector",d:DESK?"Click + Projector and pick it from the list.":"Open each projector's output window and drag it to that screen."},
    {k:"fit",done:!!tr.fit,t:"Fit a surface onto your set",d:"With the test grid on, drag a surface's corners onto a wall, box or prop."},
    {k:"media",done:show.media.some(m=>m.kind==="video"||m.kind==="image"||m.kind==="audio"),t:"Add your videos and images",d:"Upload them, or drop files into the media library."},
    {k:"cue",done:show.cues.some(c=>c.type==="look"&&(c.assign||[]).some(r=>r.mediaId&&media(r.mediaId)?.kind!=="gen"))||T().clips.length>0,t:"Build a cue or a timeline",d:"+ Cue walks you through it, or drag media onto the timeline."},
    {k:"go",done:!!tr.go,t:"Run it",d:"Press GO (or Space) in Cues, or Play in the timeline."}];}
function tourHTML(){try{if(localStorage.getItem("cuelight-tour-hidden")==="1")return"";}catch(e){}
  const st=tourSteps(),n=st.filter(x=>x.done).length;if(n===st.length)return"";const next=st.find(x=>!x.done);
  return`<div class="sec tour"><div class="sec-head"><h3>Get started · ${n} of ${st.length}</h3><button class="btn ghost" data-act="tour-hide" aria-label="Hide the getting-started steps" title="Hide">✕</button></div>
    <ol class="tour-list">${st.map(x=>`<li class="${x.done?"done":x===next?"next":""}"><span class="tk-b" aria-hidden="true">${x.done?"✓":""}</span><div><b>${x.t}</b>${x===next?`<p class="note">${x.d}</p><button class="btn primary" data-act="tour-step" data-v="${x.k}">${{proj:"Connect projector",fit:"Show test grid",media:"Upload media",cue:"Build a cue",go:"Go to cues"}[x.k]}</button>`:""}</div></li>`).join("")}</ol></div>`;}
function tourStep(k){
  if(k==="proj"){if(DESK)openScreenPicker();else{rt.mode="map";renderPanel();openOutput(rt.out);}}
  else if(k==="fit"){rt.mode="map";rt.testPattern=true;syncTP();renderPanel();toast("Test grid on. Drag the white corner handles until the grid sits exactly on your set piece.");}
  else if(k==="media")$("#fileIn").click();
  else if(k==="cue"){rt.mode="cues";renderPanel();wizOpen("new");}
  else if(k==="go"){rt.mode="cues";renderPanel();toast("Press GO or Space to run the cue on standby.");}}
const HELP=[["Running the show",[["Space","GO: fire the cue on standby"],["Esc","Panic: fade everything out (twice: hard stop)"],["↑ ↓","Move the standby cue (Cues)"]]],
  ["Anywhere",[["⌘Z / ⇧⌘Z","Undo / redo"],["⌘S","Save now (it also saves by itself)"],["⌘O","Projects"],["M","Room view: every projector on one stage"],["T","Test grid on and off"],["Speakers (top bar)","Name your speakers and test them"],["?","This list"]]],
  ["Map",[["Drag corners","Fit a surface onto your set"],["Drag a + on an edge","Add a point"],["Double-click a point","Curve or sharpen it"],["Alt-drag / Alt-scroll","Move / size the media inside a surface"],["⌘[ ⌘]","Send back / bring forward"],["= − 0","Zoom the stage in, out, to fit"]]],
  ["Timeline",[["Space · J K L","Play/pause · back, stop, play"],["↑ ↓ · Home End","Previous/next edit point · start, end"],["S · [ ]","Split · trim start/end to playhead"],["⇧-click · ⌘A","Select more clips · select all"],["⌘C ⌘X ⌘V · ⌘D","Copy, cut, paste at playhead · duplicate"],["Delete · ⇧Delete","Delete · delete and close the gap"],["⇧M","Add a marker"],["⌘-scroll","Zoom the timeline"]]]];
function openHelp(){let m=$("#helpModal");if(!m){m=document.createElement("div");m.className="modal-bg";m.id="helpModal";document.body.appendChild(m);}
  m.innerHTML=`<div class="modal helpmodal" role="dialog" aria-modal="true" aria-labelledby="helpTitle"><div class="wz-head"><h2 id="helpTitle">Keyboard shortcuts</h2><button class="btn ghost" data-act="help-close" aria-label="Close">✕</button></div>
    <div class="help-grid">${HELP.map(([g,rows])=>`<section><h3>${g}</h3><dl>${rows.map(([k,v])=>`<dt><kbd>${esc(k)}</kbd></dt><dd>${esc(v)}</dd>`).join("")}</dl></section>`).join("")}</div></div>`;m.hidden=false;}
/* ---------- Speakers (audio setup) ---------- */
let audioDevs=[];
async function listAudioOuts(){try{const d=await navigator.mediaDevices.enumerateDevices();audioDevs=d.filter(x=>x.kind==="audiooutput"&&x.deviceId!=="default"&&x.deviceId!=="communications");}catch(e){audioDevs=[];}return audioDevs;}
async function openAudioSetup(){ac();let m=$("#audModal");if(!m){m=document.createElement("div");m.className="modal-bg";m.id="audModal";m.innerHTML=`<div class="modal audmodal" role="dialog" aria-modal="true" aria-labelledby="audTitle"><div class="wz-head"><h2 id="audTitle">Speakers</h2><button class="btn ghost" data-act="aud-close" aria-label="Close">✕</button></div><div id="audBody"></div></div>`;document.body.appendChild(m);}
  m.hidden=false;await listAudioOuts();renderAudioSetup();}
function closeAudioSetup(){const m=$("#audModal");if(m)m.hidden=true;}
function renderAudioSetup(){const body=$("#audBody");if(!body||$("#audModal").hidden)return;const A=AU();
  const chOpts=cur=>Array.from({length:Math.max(NCH,cur+1)},(_,i)=>opt(String(i),`Output ${i+1}${i>=NCH?" (not on this device)":""}`,String(cur))).join("");
  body.innerHTML=`<p class="note" style="margin-top:0">Pick where sound goes out, then name your speakers. Every sound cue and timeline clip can then be sent to any speakers, at any level. To use several devices at once on a Mac, combine them into one in Audio MIDI Setup (Create Aggregate Device).</p>
    <div class="vt-grid"><label for="aud-dev">Sound output</label><select id="aud-dev">${opt("","System output"+(A.deviceId?"":" (current)"),A.deviceId||"")}${audioDevs.map(d=>opt(d.deviceId,d.label||"Output device",A.deviceId||"")).join("")}</select>
      <span class="lab">Channels</span><span class="note" style="margin:0">${NCH} output${NCH===1?"":"s"} available${NCH<=2?" · an audio interface gives you more":""}</span></div>
    <div class="spk-head"><span>Speaker</span><span>Output</span><span></span></div>
    <div class="spk-list">${A.speakers.map(sp=>`<div class="spk-row"><input type="text" data-spk="${sp.id}" data-f="name" value="${esc(sp.name)}" aria-label="Speaker name"><select data-spk="${sp.id}" data-f="ch" aria-label="Output for ${esc(sp.name)}">${chOpts(sp.ch)}</select><span class="spk-acts"><button class="btn" data-act="spk-test" data-id="${sp.id}" title="Play a short noise burst on this speaker">Test</button><button class="btn ghost danger" data-act="spk-del" data-id="${sp.id}" aria-label="Remove ${esc(sp.name)}" ${A.speakers.length<2?"disabled":""}>✕</button></span></div>`).join("")}</div>
    <div class="btns"><button class="btn" data-act="spk-add">+ Add speaker</button><button class="btn ghost" data-act="spk-all" title="One speaker for every output on this device">One per output (${NCH})</button><button class="btn ghost" data-act="spk-test-all">Test all, in order</button></div>`;}
function routeOf(obj){return obj.route||defaultRoute();}
// The speaker list for one sound: which speakers it plays on, which side of the file feeds each, and how loud.
function routeHTML(obj,scope){const r=routeOf(obj),A=AU();
  return`<div class="route"><div class="route-head"><span class="lab">Speakers</span>${obj.route?`<button class="btn ghost" data-act="route-reset" data-scope="${scope}">Back to ${esc(A.speakers[0]?.name||"")}${A.speakers[1]?" / "+esc(A.speakers[1].name):""}</button>`:`<span class="note" style="margin:0">default</span>`}<button class="btn ghost" data-act="aud-open">Set up speakers…</button></div>
    ${A.speakers.map(sp=>{const x=r[sp.id];const on=!!x&&x.lvl>0;return`<div class="route-row${on?" on":""}"><label class="inline"><input type="checkbox" data-route="${scope}" data-spk="${sp.id}" data-f="on" ${on?"checked":""}> ${esc(sp.name)}${sp.ch>=NCH?` <span class="warn-t" title="This output isn't on the current sound device">· not connected</span>`:""}</label>
      <select data-route="${scope}" data-spk="${sp.id}" data-f="src" aria-label="Which side feeds ${esc(sp.name)}" ${on?"":"disabled"}>${opt("LR","Left + right",x?.src||"LR")}${opt("L","Left only",x?.src||"LR")}${opt("R","Right only",x?.src||"LR")}</select>
      <div class="inline"><input type="range" min="0" max="1" step="0.01" data-route="${scope}" data-spk="${sp.id}" data-f="lvl" value="${x?.lvl??1}" ${on?"":"disabled"} aria-label="${esc(sp.name)} level"><output>${Math.round((x?.lvl??1)*100)}%</output></div></div>`}).join("")}</div>`;}
function routeTarget(scope){if(scope==="cue")return show.cues[rt.playhead];if(scope==="clip")return tlClip(rt.tsel);return null;}
function closeHelp(){const m=$("#helpModal");if(m)m.hidden=true;}
function renderPanel(){placeBin();syncLockBtn();
  if(rt.mode==="cues"){syncPreview();ensureCueEdit();}
  $("#modeMap").setAttribute("aria-pressed",rt.mode==="map");$("#modeCues").setAttribute("aria-pressed",rt.mode==="cues");$("#modeTL").setAttribute("aria-pressed",rt.mode==="timeline");
  $("#stageHint").textContent=rt.room&&rt.roomArrange?"Arrange: drag a projector to where it sits in the room; drag its orange corner to size it. This only changes the room view, never what a projector sends out.":(rt.room?`Room view · editing ${curOut()?.name||""}. Click any surface on any projector to edit it; it stays on its own projector. `:"")+(rt.drawing?"Click around the edge of your set piece to place points. Shift-click for a curved point. Click the first point or press Enter to finish; Esc cancels."
    :rt.mode==="timeline"?`Timeline ${rt.outSrc==="timeline"?"(also on the projectors)":"preview"} on ${curOut()?.name||"this projector"}. Click a surface to select its clip at the playhead, then drag the media box to frame it.`
    :previewActive()?`Previewing cue ${selCue().num} on ${curOut()?.name||"this projector"}. Click a surface this cue changes, then drag its media to move it or drag a white corner to resize. The projectors keep showing the live show.`
    :rt.mode!=="map"?(rt.room?"Space fires the cue on standby.":`Showing ${curOut()?.name||"projector"}. Pick another projector above to watch it. Space fires the cue on standby.`)
    :editingOutline()?"Drag points onto the edge of the piece. Drag a + on an edge to add a point between two others; double-click a point to curve or sharpen it. White boxes resize the whole shape."
    :rt.sel&&rt.sel.kind!=="group"?"White boxes resize without changing the shape (Shift stretches, Alt scales from the center). Drag a + on an edge to add a point there. Drag inside to move."
    :"Click a surface or mask to select it, or add one with the buttons above the stage. Drop video files from your computer, or drag tiles from the media bin, straight onto a surface.");
  ov.style.cursor=rt.mode==="map"?"crosshair":"default";
  if(rt.mode==="cues"){syncPreview();ensureCueEdit();}
  if(rt.mode==="cues"){syncPreview();ensureCueEdit();}
  panel.innerHTML=(rt.mode==="timeline"?"":tourHTML())+(rt.mode==="map"?mapPanel():rt.mode==="timeline"?timelinePanel():cuePanel());
  renderTimeline();
  showStage();syncPvBanner();
  const c=show.cues[rt.playhead];
  $("#standby").innerHTML=c?`<span class="mono">${esc(c.num)}</span>${esc(c.name)}`:`<span class="mono">—</span>End of list`;
  renderMediaInsp();
  const ph=panel.querySelector("tr.ph");if(ph)ph.scrollIntoView({block:"nearest"});
}
function surfaceKind(s){return s.shape?(s.warp==="grid"?"shape · grid":"shape"):s.warp==="grid"?"grid warp":"4-corner"}
function groupsOf(id){return show.groups.filter(g=>g.members.includes(id));}
const MENUS={surf:{label:"+ Surface",opts:[["rect","Rectangle (4 corners)"],["circle","Circle"],["triangle","Triangle"],["arch","Arch"],["draw","Draw a custom shape…"]]},
  cue:{label:"Other",opts:[["look","Look from what's on stage now"],["fade","Fade (brightness)"],["audio","Audio"],["audiofade","Fade audio"],["wait","Wait"],["blackout","Blackout"],["timeline","Timeline (play / stop)"]]},
  mask:{label:"+ Mask",opts:[["rect","Rectangle"],["circle","Circle"],["arch","Arch"],["draw","Draw a custom mask…"]]}};
function menuHTML(k){const m=MENUS[k];return`<div class="mwrap"><button class="btn" data-act="menu" aria-haspopup="true" aria-expanded="false">${m.label} <span aria-hidden="true">▾</span></button><div class="menu" role="menu" hidden>${m.opts.map(([v,l])=>`<button role="menuitem" data-act="new-${k}" data-v="${v}">${l}</button>`).join("")}</div></div>`;}
function closeMenus(except){document.querySelectorAll(".menu").forEach(m=>{if(m!==except){m.hidden=true;m.previousElementSibling?.setAttribute("aria-expanded","false");}});}
function addSurfaceKind(v){
  if(rt.mode!=="map"){rt.mode="map";renderBin();}
  if(v==="draw"){startDrawing("surface");return;}
  const k=show.surfaces.length,off=(k%5)*0.03;
  const s=v==="rect"?newSurface("Surface "+(k+1)):newSurface(v[0].toUpperCase()+v.slice(1)+" "+(k+1),presetShape(v,0.5+off,0.5+off,0.2));
  selectItem("surface",s);rt.edit=s.shape?"shape":"warp";rt.selPt=-1;save();renderTabs();renderPanel();
  toast(`${s.name} added to ${curOut().name}. Drag the white boxes to resize it, or its points to fit the piece.`);
}
function addMaskKind(v){
  if(rt.mode!=="map"){rt.mode="map";renderBin();}
  if(v==="draw"){startDrawing("mask");return;}
  const m={id:uid(),outputId:rt.out,z:topZ(rt.out),name:"Mask "+(show.masks.length+1),pts:presetShape(v,0.5,0.5,0.1)};show.masks.push(m);rt.sel={kind:"mask",id:m.id};rt.selPt=-1;save();renderPanel();
  toast(`${m.name} added. Drag it over the area to black out.`);
}
function scaleSel(f){
  const so=selOnStage();if(!so)return;const[x0,y0,x1,y1]=boundsOf(rt.sel.kind,so),c=[(x0+x1)/2,(y0+y1)/2];
  const b=bodiesOf(rt.sel.kind,so);scaleBodies(b,b.map(a=>a.map(p=>[...p])),c,f,f);save();
}
function mapPanel(){
  const o=curOut();
  if(rt.drawing){
    const n=rt.drawing.pts.length;
    return`<div class="sec drawbar"><div class="sec-head"><h3>Drawing a ${rt.drawing.kind==="mask"?"mask":"surface"} on ${esc(o.name)}</h3></div>
      <p class="note" style="margin-top:0">Click around the outline of the piece on the stage. <b>Shift-click</b> places a curved point. ${n} point${n===1?"":"s"} placed.</p>
      <div class="btns"><button class="btn" data-act="draw-finish" ${n<3?"disabled":""}>Finish shape</button><button class="btn" data-act="draw-undo" ${n?"":"disabled"}>Undo point</button><button class="btn ghost" data-act="draw-cancel">Cancel</button></div></div>`;
  }
  const so=selObj(),surfs=onOut(show.surfaces),masks=onOut(show.masks);
  let h=`<div class="sec"><div class="sec-head"><h3>Projector · ${esc(o.name)}</h3></div>
    <div class="field"><label for="of-name">Name</label><input id="of-name" type="text" data-of="name" value="${esc(o.name)}"></div>
    <div class="field"><label for="res">Resolution</label><select id="res">${(RESOLUTIONS.some(r=>r.join("x")===o.res.join("x"))?RESOLUTIONS:[o.res,...RESOLUTIONS]).map(([w,hh])=>opt(w+"x"+hh,`${w} × ${hh}`,o.res.join("x"))).join("")}</select></div>
    ${DESK?screenField(o):""}
    <div class="btns"><button class="btn" data-act="output">${DESK&&displayFor(o)?"Show on "+esc(displayFor(o).label):"Open output window"}</button><button class="btn ghost danger" data-act="delete" data-kind="output" data-id="${o.id}">Delete projector</button></div>
    <p class="note">${DESK?"Each projector shows up as a screen once it's plugged in and set to Extended in your display settings. Pick it above and Cuelight fills it automatically, every time you open this show.":"Match the projector's native resolution."} Double-click any name to rename it, or use the pencil and trash icons that appear when you point at a row.</p></div>
  <div class="sec"><div class="sec-head"><h3>Surfaces on ${esc(o.name)}</h3><div class="acts">
    ${menuHTML("surf")}</div></div>
  <ul class="list">${surfs.map(s=>{const r=rt.surf[s.id];const top=r?.players[r.players.length-1];
    return`<li class="lrow"><button class="sel${rt.sel?.id===s.id?" on":""}" data-act="sel" data-kind="surface" data-id="${s.id}"><span class="chip" style="background:${s.color}"></span><span class="nm" data-rn="surface:${s.id}">${esc(s.name)}</span><span class="meta">${surfaceKind(s)} · ${top?esc(media(top.mediaId)?.name||""):"black"}</span></button>${rowActs("surface",s.id,s.name)}</li>`}).join("")||`<li class="note">No surfaces on this projector yet. Add one, then fit it onto your set piece.</li>`}</ul></div>`;
  if(so&&rt.sel.kind==="surface")h+=surfaceInsp(so);
  h+=`<div class="sec"><div class="sec-head"><h3>Masks on ${esc(o.name)}</h3><div class="acts">
    ${menuHTML("mask")}</div></div>
  <ul class="list">${masks.map(m=>`<li class="lrow"><button class="sel${rt.sel?.id===m.id?" on":""}" data-act="sel" data-kind="mask" data-id="${m.id}"><span class="chip" style="background:repeating-linear-gradient(45deg,#e5484d 0 2px,transparent 2px 4px)"></span><span class="nm" data-rn="mask:${m.id}">${esc(m.name)}</span><span class="meta">${m.pts.length} points</span></button>${rowActs("mask",m.id,m.name)}</li>`).join("")||`<li class="note">Masks black out areas this projector shouldn't hit, like doors, faces or windows.</li>`}</ul></div>`;
  if(so&&rt.sel.kind==="mask"){
    h+=`<div class="sec"><div class="sec-head"><h3>Mask</h3></div>
    <div class="field"><label for="mf-name">Name</label><input id="mf-name" type="text" data-mf="name" value="${esc(so.name)}"></div>
    <div class="field"><span class="lab">Size</span><div class="inline"><button class="btn" data-act="scale-sel" data-v="0.9">Smaller</button><button class="btn" data-act="scale-sel" data-v="1.1111">Bigger</button><span class="note" style="margin:0">keeps the shape</span></div></div>
    ${outlineTools(so.pts)}
    <div class="btns"><button class="btn ghost danger" data-act="delete" data-kind="mask" data-id="${so.id}">Delete mask</button></div>
    <div class="btns layerbtns"><span class="lab">Layer</span><button class="btn" data-act="layer" data-v="back" title="Send to back (Shift+⌘[)">⇊ To back</button><button class="btn" data-act="layer" data-v="-1" title="Send backward (⌘[)">↓ Back</button><button class="btn" data-act="layer" data-v="1" title="Bring forward (⌘])">↑ Forward</button><button class="btn" data-act="layer" data-v="front" title="Bring to front (Shift+⌘])">⇈ To front</button></div>
    <p class="note">A mask blacks out whatever is behind it. Bring a surface in front of the mask to let it show through.</p></div>`;
  }
  const lay=layersOn(rt.out).reverse();
  if(lay.length>1)h+=`<div class="sec"><div class="sec-head"><h3>Layers on ${esc(o.name)}</h3><span class="note" style="margin:0">Front at the top</span></div>
    <ol class="layers">${lay.map((it,i)=>`<li class="${rt.sel?.id===it.o.id?"on":""}"><button class="ly-sel" data-act="sel" data-kind="${it.kind}" data-id="${it.o.id}"><span class="chip" style="${it.kind==="mask"?"background:repeating-linear-gradient(45deg,#e5484d 0 2px,transparent 2px 4px)":"background:"+it.o.color}"></span><span class="nm">${esc(it.o.name)}</span><span class="meta">${it.kind}</span></button>
      <button class="ib" data-act="layer-row" data-kind="${it.kind}" data-id="${it.o.id}" data-v="1" ${i===0?"disabled":""} aria-label="Move ${esc(it.o.name)} forward" title="Forward">▲</button><button class="ib" data-act="layer-row" data-kind="${it.kind}" data-id="${it.o.id}" data-v="-1" ${i===lay.length-1?"disabled":""} aria-label="Move ${esc(it.o.name)} back" title="Back">▼</button></li>`).join("")}</ol></div>`;
  h+=`<div class="sec"><div class="sec-head"><h3>Groups</h3><div class="acts"><button class="btn" data-act="add-group">+ Group</button></div></div>
  <ul class="list">${show.groups.map(g=>`<li class="lrow"><button class="sel${rt.sel?.id===g.id?" on":""}" data-act="sel" data-kind="group" data-id="${g.id}"><span class="chip" style="background:${g.color};border-radius:50%"></span><span class="nm" data-rn="group:${g.id}">${esc(g.name)}</span><span class="meta">${g.members.length} surface${g.members.length===1?"":"s"}</span></button>${rowActs("group",g.id,g.name)}</li>`).join("")||`<li class="note">Groups let one cue drive several surfaces at once, even across projectors.</li>`}</ul></div>`;
  if(so&&rt.sel.kind==="group")h+=groupInsp(so);
  h+=`<div class="sec"><div class="btns" style="margin-top:0"><button class="btn" data-act="add-look-cue">Record current look as a cue</button></div>
    <p class="note">Turn the test pattern on while aiming and fitting; GO turns it off.</p></div>`;
  return h;
}
function groupInsp(g){
  let h=`<div class="sec"><div class="sec-head"><h3>Group</h3></div>
    <div class="field"><label for="gf-name">Name</label><input id="gf-name" type="text" data-gf="name" value="${esc(g.name)}"></div>
    <div class="field"><label for="gf-color">Color</label><input id="gf-color" type="color" data-gf="color" value="${g.color}"></div>
    <div class="field" style="align-items:start"><span class="lab">Members</span><div class="members">`;
  for(const o of show.outputs){const ss=show.surfaces.filter(s=>s.outputId===o.id);if(!ss.length)continue;
    h+=`<div class="mem-out">${esc(o.name)}</div>`+ss.map(s=>`<label class="inline"><input id="gm-${s.id}" type="checkbox" data-gm="${s.id}" ${g.members.includes(s.id)?"checked":""}><span class="chip" style="background:${s.color}"></span>${esc(s.name)}</label>`).join("");}
  return h+`</div></div><p class="note">Members light up on the stage. Click a media tile to put it on the whole group. In cues, pick “${esc(g.name)}” under Groups as a target.</p>
    <div class="btns"><button class="btn ghost danger" data-act="delete" data-kind="group" data-id="${g.id}">Delete group</button></div></div>`;
}
function outlineTools(arr){
  const sp=rt.selPt>=0&&arr[rt.selPt];
  return`<div class="btns">
    <button class="btn" data-act="add-point">+ Point${sp?" after selected":""}</button>
    <button class="btn" data-act="del-point" ${arr.length<=3?"disabled":""}>Remove ${sp?"selected":"last"} point</button>
    <button class="btn" data-act="curve-point" ${sp?"":"disabled"}>${sp&&sp[2]?"Make corner":"Make curve"}</button>
    <button class="btn ghost" data-act="curve-all" data-v="1">Round all</button><button class="btn ghost" data-act="curve-all" data-v="0">Sharpen all</button></div>
    <p class="note">To add a point between two others, drag the <b>+</b> in the middle of that edge on the stage, or select a point and press <b>+ Point</b> to add one right after it. Double-click a point to switch it between a corner (square) and a curve (circle).</p>`;
}
function topImagery(s){const r=rt.surf[s.id];const p=r&&[...r.players].reverse().find(x=>{const k=media(x.mediaId)?.kind;return k==="video"||k==="image";});return p?{p,m:media(p.mediaId)}:null;}
function frameHTML(s){
  const t=topImagery(s);if(!t)return"";const f=frameOf(s.id,t.m.id);
  return`<div class="vtrim"><div class="vt-head"><span class="lab">Framing for “${esc(t.m.name)}” on this surface</span></div>
    <div class="seg fitseg" role="group" aria-label="How the media fills the surface">${Object.entries(FIT).map(([k,l])=>`<button data-act="fr-fit" data-v="${k}" aria-pressed="${f.fit===k}" title="${FIT_TIP[k]}">${l}</button>`).join("")}</div>
    <div class="vt-grid">
      <label for="fr-zoom">Size</label><div class="inline"><input id="fr-zoom" type="range" min="0.05" max="10" step="0.01" data-fr="zoom" value="${f.zoom}"><input type="number" class="frn" data-frk="zoom" step="1" min="1" value="${Math.round(f.zoom*100)}" aria-label="Size percent"><span class="fru">%</span></div>
      <label for="fr-x">Left ↔ right</label><div class="inline"><input id="fr-x" type="range" min="-3" max="3" step="0.005" data-fr="x" value="${f.x}"><input type="number" class="frn" data-frk="x" step="1" value="${Math.round(f.x*100)}" aria-label="Offset"><span class="fru"></span></div>
      <label for="fr-y">Up ↕ down</label><div class="inline"><input id="fr-y" type="range" min="-3" max="3" step="0.005" data-fr="y" value="${f.y}"><input type="number" class="frn" data-frk="y" step="1" value="${Math.round(f.y*100)}" aria-label="Offset"><span class="fru"></span></div>
    </div>
    <div class="btns" style="margin-top:0"><button class="btn" data-act="fr-rot" data-v="-1" title="Rotate left">⟲ 90°</button><button class="btn" data-act="fr-rot" data-v="1" title="Rotate right">⟳ 90°</button>
      <button class="btn" data-act="fr-flip" data-v="fh" aria-pressed="${f.fh}">Flip ↔</button><button class="btn" data-act="fr-flip" data-v="fv" aria-pressed="${f.fv}">Flip ↕</button><button class="btn ghost" data-act="fr-reset">Reset</button></div>
    <p class="note">On the stage: hold <b>Alt</b> (Option) and drag inside the surface to move the media, or Alt-scroll to resize it. Framing is saved per surface, for each piece of media.</p></div>`;
}
function videoTrimHTML(s){
  const r=rt.surf[s.id];const p=r&&[...r.players].reverse().find(x=>media(x.mediaId)?.kind==="video");if(!p)return"";
  const m=media(p.mediaId),info=mediaRT[m.id],dur=info?.dur||0,tr=trimOf(s.id,m.id);
  if(!info)return`<p class="note">“${esc(m.name)}” needs its file re-added from the media bin.</p>`;
  return`<div class="vtrim"><div class="vt-head"><span class="lab">Video on this surface</span><span class="mono" id="vPos">0:00.0 / ${fmtDur(dur)}</span></div>
    <input id="vScrub" type="range" min="0" max="${dur.toFixed(2)}" step="0.01" value="0" aria-label="Scrub ${esc(m.name)}" data-vt="seek">
    <div class="vt-grid">
      <label for="vt-in">In (s)</label><div class="inline"><input id="vt-in" type="number" min="0" step="0.1" data-vt="in" value="${tr.in}"><button class="btn" data-act="vset" data-v="in" title="Set the in point to the current frame">Set</button></div>
      <label for="vt-out">Out (s)</label><div class="inline"><input id="vt-out" type="number" min="0" step="0.1" data-vt="out" value="${tr.out||""}" placeholder="${dur.toFixed(1)} (end)"><button class="btn" data-act="vset" data-v="out" title="Set the out point to the current frame">Set</button></div>
      <label for="vt-rate">Speed</label><select id="vt-rate" data-vt="rate">${[0.25,0.5,0.75,1,1.25,1.5,2].map(v=>opt(v,v+"×",tr.rate)).join("")}</select>
      <span class="lab">At the out point</span><select id="vt-loop" data-vt="loop">${opt("1","Loop back to the in point",tr.loop?"1":"0")}${opt("0","Hold the last frame",tr.loop?"1":"0")}</select>
    </div>
    <div class="btns"><button class="btn" data-act="vrestart">Restart from in point</button><button class="btn ghost" data-act="vreset">Reset trim</button></div>
    <p class="note">Trim is saved per surface, so the same clip can play different sections on different surfaces. A Look cue with “Restart videos” starts it from the in point.</p></div>`;
}
function surfaceInsp(s){
  const r=rt.surf[s.id];const top=r?.players[r.players.length-1];
  const outline=rt.edit==="shape"&&s.shape;
  let h=`<div class="sec"><div class="sec-head"><h3>Surface</h3></div>
    <div class="field"><label for="sf-name">Name</label><input id="sf-name" type="text" data-sf="name" value="${esc(s.name)}"></div>
    <div class="field"><label for="sf-out">Projector</label><select id="sf-out" data-sf="outputId">${show.outputs.map(o=>opt(o.id,o.name,s.outputId)).join("")}</select></div>
    <div class="field" style="align-items:start"><span class="lab">Groups</span><div class="gchips">${show.groups.map(g=>`<label class="gchip"><input id="sg-${g.id}" type="checkbox" data-sg="${g.id}" ${g.members.includes(s.id)?"checked":""}><span class="dot" style="background:${g.color}"></span>${esc(g.name)}</label>`).join("")}<button class="btn ghost" data-act="add-group" data-with="${s.id}">+ New group</button></div></div>
    <div class="field"><label for="sf-look">Content</label><select id="sf-look" data-sf="look">${opt("","Black",top?.mediaId||"")}${show.media.filter(isVisual).map(m=>opt(m.id,m.name,top?.mediaId||"")).join("")}</select></div>
    <div class="field"><span class="lab"></span><div class="inline"><label class="btn" for="surfFileIn">Upload video or image for this surface…</label><input id="surfFileIn" type="file" class="sr" accept="video/*,image/*,.mov,.m4v,.mkv,.heic"></div></div>
    ${frameHTML(s)}
    ${videoTrimHTML(s)}
    <div class="field"><label for="sf-level">Level</label>${range("sf-level",'data-sf="level"',r?r.level:1,0,1,0.01,"%")}</div>
    <div class="field"><label for="sf-feather">Soft edge</label>${range("sf-feather",'data-sf="feather"',s.feather||0,0,0.25,0.005)}</div>
    <div class="field"><span class="lab">Size</span><div class="inline"><button class="btn" data-act="scale-sel" data-v="0.9">Smaller</button><button class="btn" data-act="scale-sel" data-v="1.1111">Bigger</button><span class="note" style="margin:0">keeps the shape</span></div></div>
    <div class="field"><label for="sf-color">Guide color</label><input id="sf-color" type="color" data-sf="color" value="${s.color}"></div>
    <div class="field"><span class="lab">Edit</span><div class="seg" role="group" aria-label="What to edit">
      <button data-act="edit" data-v="shape" aria-pressed="${!!outline}" ${s.shape?"":"disabled"}>Outline</button>
      <button data-act="edit" data-v="warp" aria-pressed="${!outline}">Content warp</button></div></div>`;
  if(outline){
    h+=outlineTools(s.shape)+`<div class="btns"><button class="btn" data-act="fit-content">Fit content to outline</button><button class="btn ghost danger" data-act="remove-shape">Remove outline</button></div>`;
  }else{
    h+=`<div class="field"><label for="sf-warp">Warp</label><select id="sf-warp" data-sf="warp">${opt("corner","4 corners (flat pieces)",s.warp)}${opt("grid","Grid (curved pieces)",s.warp)}</select></div>`;
    if(s.warp==="grid"&&s.grid){
      h+=`<div class="field"><span class="lab">Grid size</span><div class="inline">
        <input id="sf-gc" type="number" min="1" max="8" step="1" data-sf="gc" value="${s.grid.c}" aria-label="Columns" style="width:64px"> <span class="note" style="margin:0">across</span>
        <input id="sf-gr" type="number" min="1" max="8" step="1" data-sf="gr" value="${s.grid.r}" aria-label="Rows" style="width:64px"> <span class="note" style="margin:0">down</span></div></div>
        <p class="note">Drag grid points to bend the image around columns, curved walls or rounded props.</p>
        <div class="btns"><button class="btn" data-act="flatten-grid">Flatten grid</button>`;
    }else h+=`<div class="btns"><button class="btn" data-act="reset-corners">Square up</button>`;
    h+=`${s.shape?`<button class="btn" data-act="fit-content">Fit content to outline</button>`:`<button class="btn" data-act="add-shape">Cut to a custom outline</button>`}</div>`;
  }
  h+=`<div class="btns layerbtns"><span class="lab">Layer</span><button class="btn" data-act="layer" data-v="back" title="Send to back (Shift+⌘[)">⇊ To back</button><button class="btn" data-act="layer" data-v="-1" title="Send backward (⌘[)">↓ Back</button><button class="btn" data-act="layer" data-v="1" title="Bring forward (⌘])">↑ Forward</button><button class="btn" data-act="layer" data-v="front" title="Bring to front (Shift+⌘])">⇈ To front</button></div><div class="btns"><button class="btn" data-act="dup-surface">Duplicate</button><button class="btn ghost danger" data-act="delete" data-kind="surface" data-id="${s.id}">Delete surface</button></div>`;
  return h+`</div>`;
}
function cueTargetSummary(c){
  const short=t=>targetLabel(t).replace(/^(Group|Projector): /,"");
  if(c.type==="look"){const rows=c.assign||[];if(!rows.length)return"";const t=[...new Set(rows.map(r=>short(r.target)))];const tr=TRANS[c.trans]&&c.trans!=="xfade"?" · "+TRANS[c.trans]:"";return(t.length>2?`${t.length} targets`:t.join(", "))+tr;}
  if(c.type==="fade")return short(c.target);
  if(c.type==="timeline")return c.action==="stop"?"Stop timeline":c.action==="pause"?"Pause timeline":`Play from ${fmtTC(+c.from||0)}`;
  return"";
}
function cueNum(id){const c=show.cues.find(x=>x.id===id);return c?c.num:"?";}
function trigText(c){const t=trig(c);if(t.type==="go")return"Starts on GO";const n=cueNum(t.cue);
  if(t.type==="with")return`Starts with cue ${n}`;if(t.type==="after")return`Starts when cue ${n} ends`;
  return`Starts ${(+t.secs||0).toFixed(1)}s after cue ${n} ${t.from==="end"?"ends":"starts"}`;}
function trigChip(c){const t=trig(c);if(t.type==="go")return"";const n=cueNum(t.cue),bad=n==="?";
  const txt=t.type==="with"?`⇉ with ${n}`:t.type==="after"?`↳ after ${n}`:`⏱ ${(+t.secs||0).toFixed(1)}s after ${n}${t.from==="end"?" ends":""}`;
  return`<span class="cont${bad?" bad":""}" title="${esc(trigText(c))}">${bad?"⚠ linked cue missing":txt}</span>`;}
function cueRow(c,i){
  const d=+c.duration||0,sum=cueTargetSummary(c);
  return`<tr data-cue="${c.id}" data-act="ph" data-i="${i}" class="${i===rt.playhead?"ph":""}${trig(c).type!=="go"?" linked":""}">
    <td class="ph-mark">${i===rt.playhead?"▶":""}</td><td class="num">${esc(c.num)}</td>
    <td class="nm"><span class="cn" data-rn="cue:${c.id}" title="Double-click to rename">${esc(c.name)}</span> ${trigChip(c)}${sum?`<span class="tgt">${esc(sum)}</span>`:""}</td>
    <td><span class="type">${CUE_TYPES[c.type]}</span></td>
    <td class="tm">${c.preWait?fmt(+c.preWait):"—"}</td><td class="tm">${c.type==="audio"&&!d?"—":fmt(d)}</td><td class="acts">${rowActs("cue",c.id,c.name)}</td></tr>`;
}
function trigHTML(c){
  const t=trig(c),others=show.cues.filter(x=>x.id!==c.id);
  let h=`<div class="trig"><div class="vt-head"><span class="lab">Starts</span><span class="mono trig-sum" id="trigSum">${esc(trigText(c))}</span></div>
    <div class="seg trigseg" role="group" aria-label="When this cue starts">${Object.entries(TRIG).map(([k,l])=>`<button data-act="tg-type" data-v="${k}" aria-pressed="${t.type===k}">${l}</button>`).join("")}</div>`;
  if(t.type!=="go"){
    h+=`<div class="vt-grid">`;
    if(t.type==="delay")h+=`<label for="tg-secs">Seconds</label><div class="inline"><input id="tg-secs" type="number" min="0" step="0.1" inputmode="decimal" data-tg="secs" value="${+t.secs||0}" style="width:90px"><span class="note" style="margin:0">s after</span></div>`;
    h+=`<label for="tg-cue">Cue</label><select id="tg-cue" data-tg="cue">${others.length?others.map(x=>opt(x.id,`${x.num} · ${x.name}`,t.cue)).join(""):`<option value="">No other cues yet</option>`}</select>`;
    if(t.type==="delay")h+=`<label for="tg-from">Counting from</label><select id="tg-from" data-tg="from">${opt("start","when that cue starts",t.from||"start")}${opt("end","when that cue ends",t.from||"start")}</select>`;
    h+=`</div>`;
    if(!show.cues.some(x=>x.id===t.cue))h+=`<p class="note media-err">Pick which cue this one follows.</p>`;
  }
  return h+`<p class="note">${t.type==="go"?"The operator fires this cue with GO. After GO, the standby moves to the next cue that starts on GO.":"This cue fires automatically, so GO skips over it. Linked cues can point at any cue in the list, not only the one above."}</p></div>`;
}
function cueFrameHTML(c){
  const sids=cueEditSurfaces(c);if(!sids.length)return`<p class="note">This cue has no videos or images to frame. Effects shape themselves to each surface.</p>`;
  const cf=cueFrame(false);if(!cf)return"";const f=normFrame(cf.f),m=media(cf.row.mediaId),s=surf(rt.cedit.sid);
  return`<div class="vtrim cue-frame"><div class="vt-head"><span class="lab">Framing in this cue</span>${cf.span?`<span class="tag">across ${spanSids(cf.row).length} surfaces</span>`:cf.own?`<span class="tag">custom</span>`:`<span class="tag dim">surface default</span>`}</div>
    <div class="vt-grid"><label for="ce-sid">Surface</label><select id="ce-sid">${sids.map(x=>opt(x.id,`${x.name} · ${output(x.outputId)?.name} — ${media(cueRowFor(c,x.id).mediaId).name}`,rt.cedit.sid)).join("")}</select></div>
    <div class="seg fitseg" role="group" aria-label="How the media fills the surface">${Object.entries(FIT).map(([k,l])=>`<button data-act="cfr-fit" data-v="${k}" aria-pressed="${f.fit===k}" title="${FIT_TIP[k]}">${l}</button>`).join("")}</div>
    <div class="vt-grid">
      <label for="cfr-zoom">Size</label><div class="inline"><input id="cfr-zoom" type="range" min="0.05" max="10" step="0.01" data-cfr="zoom" value="${f.zoom}"><input type="number" class="frn" data-frk="zoom" step="1" min="1" value="${Math.round(f.zoom*100)}" aria-label="Size percent"><span class="fru">%</span></div>
      <label for="cfr-x">Left ↔ right</label><div class="inline"><input id="cfr-x" type="range" min="-3" max="3" step="0.005" data-cfr="x" value="${f.x}"><input type="number" class="frn" data-frk="x" step="1" value="${Math.round(f.x*100)}" aria-label="Offset"><span class="fru"></span></div>
      <label for="cfr-y">Up ↕ down</label><div class="inline"><input id="cfr-y" type="range" min="-3" max="3" step="0.005" data-cfr="y" value="${f.y}"><input type="number" class="frn" data-frk="y" step="1" value="${Math.round(f.y*100)}" aria-label="Offset"><span class="fru"></span></div></div>
    <div class="btns" style="margin-top:0"><button class="btn" data-act="cfr-rot" data-v="-1">⟲ 90°</button><button class="btn" data-act="cfr-rot" data-v="1">⟳ 90°</button>
      <button class="btn" data-act="cfr-flip" data-v="fh" aria-pressed="${f.fh}">Flip ↔</button><button class="btn" data-act="cfr-flip" data-v="fv" aria-pressed="${f.fv}">Flip ↕</button>${cf.own?`<button class="btn ghost" data-act="cfr-reset">Use surface default</button>`:""}</div>
    <p class="note">${cf.span?`One picture across ${spanSids(cf.row).length} surfaces (outlined in orange). Drag inside the dashed box to move it over the set, or a white corner to size it.`:s.outputId!==rt.out?`${esc(s.name)} is on ${esc(output(s.outputId).name)}. Pick that projector above the stage to drag it there.`:`On the stage, drag inside the dashed box to move “${esc(m.name)}”, or drag a white corner to resize it.`}</p></div>`;
}
function syncLiveBtn(){const b=$("#liveBtn");if(!b)return;b.setAttribute("aria-pressed",rt.liveEdit);b.innerHTML=rt.liveEdit?`<span class="lv-dot"></span>Live edits`:"Blind edits";
  b.title=rt.liveEdit?"Projectors show what you're editing. Click for Blind: edit without changing the projectors.":"Projectors hold the show while you edit. Click to show edits on the projectors.";}
function syncPvBanner(){
  const bn=$("#pvBanner");if(!bn)return;const c=selCue();
  if(!c||c.type!=="look"){bn.hidden=true;return;}bn.hidden=false;
  bn.innerHTML=previewActive()?(rt.liveEdit?`<span class="pv-dot edit"></span>Editing cue ${esc(c.num)} · projectors show it too · GO returns them to the show <button class="btn" data-act="pv-off">Back to the live show</button>`:`<span class="pv-dot"></span>Previewing cue ${esc(c.num)} · projectors unchanged (Blind) <button class="btn" data-act="pv-off">Show live</button>`):`<span class="pv-dot live"></span>Live output <button class="btn" data-act="pv-on">Preview cue ${esc(c.num)}</button>`;
}
function cuePanel(){
  let h=`<div class="sec"><div class="sec-head"><h3>Cue list</h3><div class="acts">
    <button class="btn primary" data-act="wz-new">+ Add cue</button>${menuHTML("cue")}
    <button class="btn" data-act="move-cue" data-d="-1" aria-label="Move cue up">↑</button><button class="btn" data-act="move-cue" data-d="1" aria-label="Move cue down">↓</button>
    <button class="btn ghost danger" data-act="delete" data-kind="cue" data-id="${show.cues[rt.playhead]?.id||""}" ${show.cues[rt.playhead]?"":"disabled"}>Delete</button></div></div>
    <div class="cue-scroll"><table class="cues"><thead><tr><th></th><th>#</th><th>Name</th><th>Type</th><th style="text-align:right">Pre</th><th style="text-align:right">Time</th><th><span class="sr">Actions</span></th></tr></thead>
    <tbody>${show.cues.map(cueRow).join("")}<tr class="${rt.playhead>=show.cues.length?"ph ":""}endrow" data-act="ph" data-i="${show.cues.length}"><td colspan="7">${show.cues.length?"End of list":"No cues yet. Set up a look in Map mode, then add a Look cue."}</td></tr></tbody></table></div></div>`;
  const c=show.cues[rt.playhead];
  if(c)h+=cueInsp(c);
  return h;
}
function cueInsp(c){
  let h=`<div class="sec"><div class="sec-head"><h3>${CUE_TYPES[c.type]} cue</h3>${c.type==="look"?`<div class="acts">${(c.assign||[]).length===1?`<button class="btn primary" data-act="wz-edit" data-i="0">Edit cue…</button>`:""}<button class="btn" data-act="look-preview">Show now</button><button class="btn ghost" data-act="look-capture" title="Replace this cue's rows with whatever is on stage now">Update from stage</button></div>`:""}</div>
  <div class="field"><label for="cf-num">Number</label><input id="cf-num" type="text" data-cf="num" value="${esc(c.num)}"></div>
  <div class="field"><label for="cf-name">Name</label><input id="cf-name" type="text" data-cf="name" value="${esc(c.name)}"></div>
  <div class="field"><label for="cf-pre">Pre-wait (s)</label><input id="cf-pre" type="number" min="0" step="0.1" data-cf="preWait" value="${c.preWait||0}"></div>
  <div class="field"><label for="cf-dur">${c.type==="wait"?"Wait (s)":c.type==="audio"?"Fade in (s)":c.type==="look"?"Transition (s)":"Fade time (s)"}</label><input id="cf-dur" type="number" min="0" step="0.1" data-cf="duration" value="${c.duration||0}"></div>
  ${trigHTML(c)}`;
  const vis=show.media.filter(isVisual),aud=show.media.filter(isAudio);
  if(c.type==="look"){
    const rows=c.assign||[];
    const ct=TRANS[c.trans]?c.trans:"xfade";
    h+=cueFrameHTML(c);
    h+=`<div class="field"><label for="cf-trans">Transition</label><select id="cf-trans" data-cf="trans">${Object.entries(TRANS).map(([k,v])=>opt(k,v,ct)).join("")}</select></div>
      <div class="look-head"><span class="lab">What changes</span><span class="note" style="margin:0">Surfaces not covered stay as they are. Drag library tiles onto a row to swap its content.</span></div>
      <div class="look-grid">${rows.map((a,i)=>{const n=resolveTarget(a.target).length,m=a.mediaId?media(a.mediaId):null;
      return`<div class="look-row" data-droprow="${i}"><span class="chip" style="background:${targetColor(a.target)}"></span><div class="stack">
        <div class="row-top"><select id="lt-${i}" data-lt="${i}" aria-label="Target">${targetOptions(a.target)}</select><button class="btn" data-act="wz-edit" data-i="${i}" title="Change projector, surfaces, media, effect or transition">Edit…</button><button class="btn ghost" data-act="row-del" data-i="${i}" aria-label="Remove row">×</button></div>
        <button class="pickbtn" data-act="pick-open" data-i="${i}" aria-haspopup="dialog"><span class="pk-sw" style="${m?swatchCSS(m):"background:#000"}"></span><span class="pk-nm">${m?esc(m.name):"Fade to black"}</span><span class="pk-k">${m?esc(m.kind==="gen"?"effect":m.kind):""}</span><span aria-hidden="true">▾</span></button>
        <select id="lx-${i}" data-lx="${i}" aria-label="Transition for this row">${opt("",`Transition: cue default (${TRANS[ct]})`,TRANS[a.trans]?a.trans:"")}${Object.entries(TRANS).map(([k,v])=>opt(k,"Transition: "+v,a.trans)).join("")}</select>
        ${a.mediaId?range("lv-"+i,`data-lv="${i}"`,a.level??1,0,1,0.01,"%"):""}
        ${n>1&&m&&m.kind!=="audio"?`<label class="inline span-ck"><input type="checkbox" data-lspan="${i}" ${a.span?"checked":""}> One picture across all ${n} surfaces</label>`:""}
        ${n===0?`<span class="note" style="margin:0;color:#f08a8d">This target has no surfaces.</span>`:a.target.includes(":")||a.target==="all"?`<span class="note" style="margin:0">${n} surface${n===1?"":"s"}</span>`:""}
      </div></div>`}).join("")||`<p class="note">No changes yet. Add a target below.</p>`}</div>
      <div class="btns"><button class="btn" data-act="wz-addrow">+ Add more surfaces to this cue</button></div>
      <p class="note">Rows apply top to bottom, so a later row can override one surface inside a group or projector.</p>
      <div class="field"><span class="lab">Video</span><label class="inline"><input id="cf-restart" type="checkbox" data-cf="restart" ${c.restart?"checked":""}> Restart videos from the top</label></div>`;
  }else if(c.type==="fade"){
    h+=`<div class="field"><label for="cf-target">Target</label><select id="cf-target" data-cf="target">${targetOptions(c.target)}</select></div>
      <div class="field"><label for="cf-level">Fade to</label>${range("cf-level",'data-cf="level"',c.level??0,0,1,0.01,"%")}</div>`;
  }else if(c.type==="audio"){
    h+=`<div class="field"><label for="cf-media">Sound</label><select id="cf-media" data-cf="mediaId">${aud.map(m=>opt(m.id,(missing(m)?"Missing: ":"")+m.name,c.mediaId)).join("")}</select></div>
      <div class="field"><label for="cf-level">Level</label>${range("cf-level",'data-cf="level"',c.level??0.8,0,1,0.01,"%")}</div>
      <div class="field"><span class="lab">Loop</span><label class="inline"><input id="cf-loop" type="checkbox" data-cf="loop" ${c.loop?"checked":""}> Loop until faded</label></div>
      ${routeHTML(c,"cue")}
      <p class="note">With Auto-follow, a non-looping sound file triggers the next cue when it finishes playing.</p>`;
  }else if(c.type==="audiofade"){
    h+=`<div class="field"><label for="cf-level">Fade to</label>${range("cf-level",'data-cf="level"',c.level??0,0,1,0.01,"%")}</div><p class="note">Fading to 0% stops every playing sound.</p>`;
  }else if(c.type==="timeline"){
    h+=`<div class="field"><label for="cf-action">Action</label><select id="cf-action" data-cf="action">${opt("play","Play the timeline",c.action)}${opt("pause","Pause the timeline",c.action)}${opt("stop","Stop and return projectors to cues",c.action)}</select></div>
      ${c.action==="play"||!c.action?`<div class="field"><label for="cf-from">From (s)</label><input id="cf-from" type="number" min="0" step="0.1" data-cf="from" value="${+c.from||0}"></div>`:""}
      <p class="note">Playing sends the timeline (${fmtTC(T().duration)} long) to the projectors. A Look, Fade or Blackout cue afterwards hands the projectors back to the cue show.</p>`;
  }else if(c.type==="blackout"){
    h+=`<div class="field"><span class="lab">Sound</span><label class="inline"><input id="cf-wa" type="checkbox" data-cf="withAudio" ${c.withAudio?"checked":""}> Fade out sound too</label></div><p class="note">Blacks out every surface on every projector. For one group or projector, use a Fade cue to 0%.</p>`;
  }
  return h+`</div>`;
}

/* ---------- events ---------- */
function numAt(i){
  const pv=parseFloat(show.cues[i-1]?.num),nx=parseFloat(show.cues[i]?.num);
  if(isNaN(pv))return isNaN(nx)?"1":String(+(nx/2).toFixed(2));
  if(isNaN(nx)||Math.floor(pv)+1<nx)return String(Math.floor(pv)+1);
  return String(+((pv+nx)/2).toFixed(2));
}
function addCue(type){
  const at=Math.min(rt.playhead+1,show.cues.length);const idx=show.cues.length?at:0;
  const base={id:uid(),num:numAt(idx),type,preWait:0,cont:"none",trigger:{type:"go"}};
  const firstAudio=show.media.find(isAudio);
  const o={look:{name:"New look",duration:2,assign:captureLook(),restart:false},
    fade:{name:"Fade",duration:2,target:"all",level:0.5},
    audio:{name:firstAudio?firstAudio.name:"Sound",duration:0,mediaId:firstAudio?.id,level:0.8,loop:false},
    audiofade:{name:"Fade out sound",duration:3,level:0},
    wait:{name:"Wait",duration:5},
    blackout:{name:"Blackout",duration:3,withAudio:true},
    timeline:{name:"Play timeline",duration:0,action:"play",from:0}}[type];
  show.cues.splice(idx,0,Object.assign(base,o));rt.playhead=idx;save();renderPanel();
}
function putOn(sids,mid){
  sids.forEach(id=>{const s=surf(id);if(s)s.look=mid;});
  applyLook(sids.map(id=>({surfaceId:id,mediaId:mid,level:1})),0.4);
  if(rt.testPattern&&mid){rt.testPattern=false;syncTP();}
}
function removeSurfaceRefs(id){
  if(show.timeline)show.timeline.clips=show.timeline.clips.filter(c=>c.lane!==id);
  show.groups.forEach(g=>g.members=g.members.filter(m=>m!==id));
  show.cues.forEach(c=>{if(!c.assign)return;
    c.assign.forEach(x=>{if(x.target?.startsWith("m:")){const ids=x.target.slice(2).split(",").filter(y=>y!==id);x.target=ids.length===1?ids[0]:ids.length?"m:"+ids.join(","):"";}});
    c.assign=c.assign.filter(x=>x.target&&x.target!==id);});
}
document.addEventListener("click",e=>{
  if(!e.target.closest(".mwrap"))closeMenus();
  if(!$("#picker").hidden&&!e.target.closest("#picker")&&!e.target.closest("[data-act=pick-open]"))closePicker();
  if(e.detail===2){const rn=e.target.closest("[data-rn]");if(rn){const[k,id]=rn.dataset.rn.split(":");startRename(k,id);return;}}
  const b=e.target.closest("[data-act]");if(!b||b.disabled)return;const a=b.dataset.act;
  switch(a){
    case"rename":startRename(b.dataset.kind,b.dataset.id);break;
    case"delete":deleteItem(b.dataset.kind,b.dataset.id);break;
    case"toast-act":{const f=toastFn;toastFn=null;$("#toast").hidden=true;f&&f();break;}
    case"confirm-yes":{const f=confirmFn;closeConfirm();f&&f();break;}
    case"confirm-no":closeConfirm();break;
    case"menu":{const m=b.nextElementSibling;const open=m.hidden;closeMenus(m);m.hidden=!open;b.setAttribute("aria-expanded",String(open));break;}
    case"new-surf":closeMenus();addSurfaceKind(b.dataset.v);break;
    case"new-mask":closeMenus();addMaskKind(b.dataset.v);break;
    case"new-cue":closeMenus();addCue(b.dataset.v);break;
    case"scale-sel":scaleSel(+b.dataset.v);break;
    case"zoom":{const v=b.dataset.v;if(v==="in")zoomCenter(1.25);else if(v==="out")zoomCenter(0.8);else zoomFit();break;}
    case"tg-type":{const c=show.cues[rt.playhead];if(!c)break;const v=b.dataset.v,old=trig(c);
      if(v==="go")c.trigger={type:"go"};
      else{const prev=show.cues[rt.playhead-1]||show.cues.find(x=>x.id!==c.id);c.trigger={type:v,cue:show.cues.some(x=>x.id===old.cue)?old.cue:prev?.id,secs:+old.secs||(v==="delay"?1:0),from:old.from||"start"};}
      save();renderPanel();break;}
    case"pv-on":rt.previewOn=true;renderPanel();break;
    case"pv-off":rt.previewOn=false;renderPanel();break;
    case"cfr-fit":case"cfr-rot":case"cfr-flip":{const pv=frameProv();if(!pv)break;const f=pv.get(true);
      if(a==="cfr-fit")f.fit=b.dataset.v;else if(a==="cfr-rot")f.rot=(((+f.rot||0)+ +b.dataset.v)%4+4)%4;else f[b.dataset.v]=!f[b.dataset.v];save();renderPanel();break;}
    case"cfr-reset":{const pv=frameProv();if(pv?.own){pv.reset();save();renderPanel();}break;}
    case"fr-fit":case"fr-rot":case"fr-flip":case"fr-reset":{const s=selObj(),t=s&&topImagery(s);if(!t)break;const f=frameEdit(s,t.m.id);
      if(a==="fr-fit")f.fit=b.dataset.v;else if(a==="fr-rot")f.rot=(((+f.rot||0)+ +b.dataset.v)%4+4)%4;else if(a==="fr-flip")f[b.dataset.v]=!f[b.dataset.v];else delete s.frames[t.m.id];
      save();renderPanel();break;}
    case"vset":{const s=selObj(),v=surfVideo(s.id);if(!v)break;s.trims=s.trims||{};const tr=s.trims[v._mid]=s.trims[v._mid]||{};tr[b.dataset.v]=+v.currentTime.toFixed(2);save();renderPanel();toast(`${b.dataset.v==="in"?"In":"Out"} point set to ${tr[b.dataset.v].toFixed(2)}s.`);break;}
    case"vrestart":{const s=selObj(),v=surfVideo(s.id);if(!v)break;try{v.currentTime=trimOf(s.id,v._mid).in;}catch(err){}v._done=false;v.play().catch(()=>{});break;}
    case"vreset":{const s=selObj(),v=surfVideo(s.id);if(!v||!s.trims)break;delete s.trims[v._mid];v._done=false;save();renderPanel();break;}
    case"wz-new":wizOpen("new");break;
    case"tl-play":tlToggle();break;
    case"tl-home":tlSeek(0);break;
    case"tl-split":tlSplit();break;
    case"tl-dup":tlDup();break;
    case"tl-del":tlDel();break;
    case"tl-goto":{const c=tlClip(rt.tsel);if(c)tlSeek(c.start);break;}
    case"tl-prev":tlJump(-1);break;
    case"tl-tool":tl.tool=b.dataset.v;renderTimeline();break;
    case"tl-linked":tl.linked=!tl.linked;try{localStorage.setItem("cuelight-linked",tl.linked?"1":"0");}catch(e){}renderTimeline();break;
    case"tl-fit":tlZoomFit();break;
    case"tl-trans":tlAddTransition();break;
    case"tl-place":tlPlace(b.dataset.v);break;
    case"tl-off":tlToggleOff();break;
    case"tl-rg-clear":tlClearRange();break;
    case"tl-lane-add":{const TT=T();TT.audioLanes=audioLanes().length+1;save();renderTimeline();break;}
    case"tl-lane-del":{const TT=T(),n=audioLanes().length,id="a"+n;if(n<=1)break;if(TT.clips.some(c=>c.lane===id)){toast(`Audio ${n} still has clips. Move or delete them first.`);break;}TT.audioLanes=n-1;save();renderTimeline();break;}
    case"tl-tc":{const el=b,inp=document.createElement("input");inp.className="tl-tc-in mono";inp.value=fmtTC(tl.t);el.replaceWith(inp);inp.focus();inp.select();
      const done=ok=>{if(ok){const v=inp.value.trim(),m2=/^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(v);if(m2)tlSeek((+(m2[1]||0))*60+(+m2[2]));}renderTimeline();};
      inp.addEventListener("keydown",e=>{e.stopPropagation();if(e.key==="Enter")done(true);else if(e.key==="Escape")done(false);});inp.addEventListener("blur",()=>done(true),{once:true});break;}
    case"tl-next":tlJump(1);break;
    case"tl-trim-s":tlTrimTo("start");break;
    case"tl-trim-e":tlTrimTo("end");break;
    case"tl-ripple":tlDel(true);break;
    case"tl-marker":tlMarker();break;
    case"tl-sep":tlSeparate();break;
    case"tl-rejoin":tlRejoin();break;
    case"tl-sel-none":tlClearSel();renderTimeline();renderPanel();break;
    case"mk-go":{const mk=(T().markers||[]).find(x=>x.id===b.dataset.id);if(mk)tlSeek(mk.t);break;}
    case"mk-del":{const TT=T();TT.markers=(TT.markers||[]).filter(x=>x.id!==b.dataset.id);save();renderTimeline();renderPanel();break;}
    case"ln-mute":case"ln-lock":{const TT=T();TT.lanes=TT.lanes||{};const k=a==="ln-mute"?"mute":"lock",ls=TT.lanes[b.dataset.id]=TT.lanes[b.dataset.id]||{};ls[k]=!ls[k];save();renderTimeline();break;}
    case"tl-send":rt.outSrc=rt.outSrc==="timeline"?"cues":"timeline";tl.previewOnly=rt.outSrc!=="timeline";renderTLTransport();showStage();renderPanel();toast(rt.outSrc==="timeline"?"Projectors now show the timeline.":"Projectors now show the cue show.");break;
    case"tl-pick":rt.pick={tl:true};{const p=$("#picker");renderPicker();p.hidden=false;const r=b.getBoundingClientRect(),W=Math.min(420,window.innerWidth-24),H=p.offsetHeight;let x=r.left;if(x+W>window.innerWidth-12)x=window.innerWidth-12-W;let y=r.bottom+6;if(y+H>window.innerHeight-12)y=Math.max(12,r.top-6-H);p.style.left=Math.max(12,x)+"px";p.style.top=y+"px";p.style.width=W+"px";}break;
    case"wz-edit":{const c=show.cues[rt.playhead];if(c)wizOpen("edit",c,+b.dataset.i);break;}
    case"wz-addrow":{const c=show.cues[rt.playhead];if(c)wizOpen("addrow",c);break;}
    case"wz-close":wizClose();break;
    case"wz-step":if(rt.wiz){rt.wiz.step=+b.dataset.v;renderWiz();}break;
    case"wz-out":if(rt.wiz){if(rt.wiz.out!==b.dataset.id){rt.wiz.out=b.dataset.id;rt.wiz.sel=new Set();rt.wiz.whole=false;rt.wiz.keep=null;}renderWiz();if(e.detail===2){rt.wiz.step=2;renderWiz();}}break;
    case"wz-next":if(rt.wiz){rt.wiz.step=Math.min(3,rt.wiz.step+1);renderWiz();}break;
    case"wz-back":if(rt.wiz){rt.wiz.step=Math.max(1,rt.wiz.step-1);renderWiz();}break;
    case"wz-all":if(rt.wiz){rt.wiz.keep=null;show.surfaces.filter(s=>s.outputId===rt.wiz.out).forEach(s=>rt.wiz.sel.add(s.id));renderWiz();}break;
    case"wz-none":if(rt.wiz){rt.wiz.keep=null;rt.wiz.sel.clear();rt.wiz.whole=false;renderWiz();}break;
    case"wz-group":if(rt.wiz){const g=group(b.dataset.id),w=rt.wiz;w.keep=null;const ids=g.members.filter(id=>surf(id)?.outputId===w.out);const allOn=ids.every(id=>w.sel.has(id));ids.forEach(id=>allOn?w.sel.delete(id):w.sel.add(id));renderWiz();}break;
    case"wz-tab":if(rt.wiz){rt.wiz.tab=b.dataset.v;rt.wiz.step=3;renderWiz();}break;
    case"wz-media":if(rt.wiz){rt.wiz.mediaId=b.dataset.id;renderWiz();}break;
    case"wz-trans":if(rt.wiz){rt.wiz.trans=b.dataset.v;renderWiz();}break;
    case"wz-commit":wizCommit();break;
    case"wz-span":if(rt.wiz){rt.wiz.span=b.dataset.v==="1";renderWiz();}break;
    case"lib-filter":rt.libFilter=b.dataset.v;renderBin();break;
    case"uc-new":{const m=media(rt.selMedia);if(!m)break;const uc=rt.uc;const at=show.cues.length?Math.min(rt.playhead+1,show.cues.length):0;
      const c={id:uid(),num:numAt(at),type:"look",name:`${m.name} → ${targetLabel(uc.target).replace(/^(Group|Projector): /,"")}`,preWait:0,duration:2,cont:"none",trans:uc.trans,restart:true,assign:[{target:uc.target,mediaId:m.id,level:1}]};
      show.cues.splice(at,0,c);rt.playhead=at;rt.mode="cues";save();renderBin();renderPanel();toast(`Cue ${c.num} added. Press GO to run it, or keep adding to it.`);break;}
    case"uc-add":{const m=media(rt.selMedia),c=show.cues[rt.playhead];if(!m||c?.type!=="look")break;c.assign=c.assign||[];
      const row={target:rt.uc.target,mediaId:m.id,level:1};if(rt.uc.trans!==(c.trans||"xfade"))row.trans=rt.uc.trans;c.assign.push(row);save();renderBin();renderPanel();toast(`Added to cue ${c.num}.`);break;}
    case"pick-open":openPicker(+b.dataset.i,b);break;
    case"pick":{if(rt.pick?.tl){const cl=tlClip(rt.tsel);closePicker();if(cl&&b.dataset.id!=="__none"){cl.mediaId=b.dataset.id;delete cl.frame;save();renderTimeline();renderPanel();}break;}
      const c=show.cues[rt.playhead],i=rt.pick?.i;closePicker();if(!c||i==null||!c.assign[i])break;c.assign[i].mediaId=b.dataset.id==="__none"?null:b.dataset.id;save();renderBin();renderPanel();break;}
    case"pick-filter":rt.pickFilter=b.dataset.v;renderPicker();break;
    case"pick-close":closePicker();break;
    case"undo":undo();break;
    case"redo":redo();break;
    case"live-edit":rt.liveEdit=!rt.liveEdit;try{localStorage.setItem("cuelight-live-edit",rt.liveEdit?"1":"0");}catch(e){}syncLiveBtn();syncPvBanner();
      renderTLTransport();toast(rt.liveEdit?"Live edits: projectors show the cue or timeline you're working on. GO returns them to the show.":"Blind: projectors only change when you press GO or play a timeline cue. Edits show on this screen only.");break;
    case"mode":rt.mode=b.dataset.v;rt.selPt=-1;rt.drawing=null;renderPanel();renderBin();break;
    case"go":go();break;
    case"panic":panic();break;
    case"guides":rt.guides=!rt.guides;try{localStorage.setItem("cuelight-guides",rt.guides?"1":"0");}catch(e){}syncLockBtn();toast(rt.guides?"While mapping, the projectors show your crosshair and the points you're placing.":"Projector guides off: the projectors show only the content while you map.");break;
    case"map-lock":show.mapLocked=!show.mapLocked;save();syncLockBtn();toast(show.mapLocked?"Mapping locked: surfaces and masks can't be dragged by accident. Cues and the timeline still work.":"Mapping unlocked.");break;
    case"help":openHelp();break;
    case"aud-open":openAudioSetup();break;
    case"aud-close":closeAudioSetup();break;
    case"spk-test":{const sp=AU().speakers.find(x=>x.id===b.dataset.id);if(sp)testSpeaker(sp);break;}
    case"spk-test-all":{AU().speakers.forEach((sp,i)=>setTimeout(()=>testSpeaker(sp),i*1100));break;}
    case"spk-add":{const A=AU(),used=new Set(A.speakers.map(x=>x.ch));let ch=0;while(used.has(ch))ch++;A.speakers.push({id:uid(),name:"Speaker "+(A.speakers.length+1),ch});save();rebuildRouters();renderAudioSetup();break;}
    case"spk-del":{const A=AU();A.speakers=A.speakers.filter(x=>x.id!==b.dataset.id);save();rebuildRouters();renderAudioSetup();renderPanel();break;}
    case"spk-all":{const A=AU();A.speakers=Array.from({length:NCH},(_,i)=>A.speakers.find(x=>x.ch===i)||{id:uid(),name:"Output "+(i+1),ch:i});save();rebuildRouters();renderAudioSetup();renderPanel();break;}
    case"route-reset":{const o=routeTarget(b.dataset.scope);if(o){delete o.route;save();rebuildRouters();renderPanel();}break;}
    case"help-close":closeHelp();break;
    case"tour-hide":try{localStorage.setItem("cuelight-tour-hidden","1");}catch(e){}renderPanel();break;
    case"tour-step":tourStep(b.dataset.v);break;
    case"testpattern":rt.testPattern=!rt.testPattern;syncTP();break;
    case"fullscreen":fullscreen();break;
    case"output":openOutput(rt.out);break;
    case"scr-pick":{const d=displays.find(x=>String(x.id)===b.dataset.id);if(d)addProjectorOn(d);break;}
    case"scr-plain":closeScreenPicker();{const o={id:uid(),name:"Projector "+(show.outputs.length+1),res:[1920,1080]};show.outputs.push(o);ensureOutputs();rt.mode="map";setOut(o.id);save();toast(`${o.name} added without a screen. Pick its screen in the panel on the right when it's connected.`);}break;
    case"scr-close":closeScreenPicker();break;
    case"scr-fix":fixMirroring();break;
    case"scr-settings":DESK.openDisplaySettings();break;
    case"scr-id":if(DESK)DESK.identify(+b.dataset.id);break;
    case"out":setOut(b.dataset.id);break;
    case"room":setRoom(!rt.room);break;
    case"room-arrange":rt.roomArrange=!rt.roomArrange;syncRoomTools();renderPanel();break;
    case"room-layout":roomLayout(b.dataset.v);break;
    case"add-out":if(DESK){openScreenPicker();break;}{const o={id:uid(),name:"Projector "+(show.outputs.length+1),res:[1920,1080]};show.outputs.push(o);ensureOutputs();rt.mode="map";setOut(o.id);save();toast(`${o.name} added. Add surfaces to it, then open its output window.`);break;}
    case"show-file":$("#showJson").value=JSON.stringify(show,null,1);$("#modalTitle").textContent="Show text";$("#modal").hidden=false;break;
    case"projects":openProjects();break;
    case"pj-close":closeProjects();break;
    case"pj-open":openProject(b.dataset.id);break;
    case"pj-new":createProject(Object.assign(emptyShow(),{name:uniqueName("Untitled show")}),"New project. Add a projector's surfaces to start.");break;
    case"pj-demo":createProject(Object.assign(demoShow(),{name:uniqueName("Demo — Black Box")}),"Demo project created.");break;
    case"pj-dup":{const src=b.dataset.id===proj.idx.current?JSON.parse(JSON.stringify(show)):readProject(b.dataset.id);if(!src)break;src.name=uniqueName((src.name||"Show")+" copy");
      if(hist.pending)commit();const e=newProjectRecord(src);e.thumb=projEntry(b.dataset.id)?.thumb||null;saveIdx();renderProjects();toast(`Duplicated as “${e.name}”.`);break;}
    case"pj-export":exportProject(b.dataset.id);break;
    case"pj-paste":$("#showJson").value="";$("#modalTitle").textContent="Import show text";$("#modal").hidden=false;$("#showJson").focus();break;
    case"pj-rename":{const id=b.dataset.id,e=projEntry(id),el=document.querySelector(`[data-pjname="${id}"]`);if(!e||!el)break;
      const r=el.getBoundingClientRect(),inp=document.createElement("input");inp.type="text";inp.className="rn-input";inp.value=e.name;inp.setAttribute("aria-label","Rename project");
      inp.style.left=Math.max(4,r.left-6)+"px";inp.style.top=(r.top+r.height/2)+"px";inp.style.width=Math.max(r.width+60,220)+"px";document.body.appendChild(inp);inp.focus();inp.select();
      let done=false;const fin=ok=>{if(done)return;done=true;const v=inp.value.trim();inp.remove();
        if(ok&&v&&v!==e.name){if(id===proj.idx.current){show.name=v;$("#showName").value=v;save();commit();}else{const sh=readProject(id);if(sh){sh.name=v;writeProject(id,JSON.stringify(sh));}e.name=v;saveIdx();}}renderProjects();};
      inp.addEventListener("keydown",ev=>{ev.stopPropagation();if(ev.key==="Enter"){ev.preventDefault();fin(true);}else if(ev.key==="Escape"){ev.preventDefault();fin(false);}});inp.addEventListener("blur",()=>fin(true));break;}
    case"pj-del":{const id=b.dataset.id,e=projEntry(id);if(!e)break;
      askConfirm(`Delete project “${e.name}”?`,"Its projectors, mapping and cues are removed from this browser. Media files only this project uses are removed too. You can undo right after from the message that appears.","Delete project",()=>{
        const data=id===proj.idx.current?JSON.stringify(show):lsGet(PKEY(id)),entry={...e};
        proj.idx.list=proj.idx.list.filter(p=>p.id!==id);lsDel(PKEY(id));saveIdx();
        if(id===proj.idx.current){const next=[...proj.idx.list].sort((a,b)=>b.updated-a.updated)[0];
          if(next)openProject(next.id,`Deleted “${entry.name}”. Opened “${next.name}”.`);else createProject(Object.assign(emptyShow(),{name:"Untitled show"}),`Deleted “${entry.name}”. Started a new project.`);}
        else{renderProjects();}
        setTimeout(()=>toast(`Deleted project “${entry.name}”.`,{label:"Undo",fn:()=>{writeProject(entry.id,data);proj.idx.list.push(entry);saveIdx();renderProjects();toast(`Restored “${entry.name}”.`);}}),50);
        setTimeout(()=>pruneFiles(),8000);});break;}
    case"close-modal":$("#modal").hidden=true;break;
    case"copy-json":{const ta=$("#showJson");navigator.clipboard?.writeText(ta.value).then(()=>toast("Show copied."),()=>{ta.select();toast("Text selected. Press Ctrl+C or Cmd+C to copy.")})??(ta.select());break;}
    case"load-json":if(importText($("#showJson").value))$("#modal").hidden=true;break;
    case"media":{const m=media(b.dataset.id);rt.selMedia=m.id;
      if(rt.mode==="map"&&isVisual(m)){
        if(e.shiftKey)putOn(onOut(show.surfaces).map(s=>s.id),m.id);
        else if(rt.sel?.kind==="group"){const g=group(rt.sel.id);if(g.members.length)putOn(g.members,m.id);else toast("This group has no surfaces yet. Tick some members first.");}
        else{if(!rt.sel||rt.sel.kind!=="surface"){const f=onOut(show.surfaces)[0];if(f)rt.sel={kind:"surface",id:f.id};}
          const s=rt.sel?.kind==="surface"?surf(rt.sel.id):null;
          if(s)putOn([s.id],m.id);else toast("Select a surface or group first.");}
        save();renderPanel();}
      renderBin();break;}
    case"dup-media":{const m=media(rt.selMedia);const c={...m,id:uid(),name:m.name+" copy"};show.media.splice(show.media.indexOf(m)+1,0,c);rt.selMedia=c.id;save();renderBin();break;}
    case"sel":{if(rt.sel?.id===b.dataset.id)break;const k=b.dataset.kind,o=k==="surface"?surf(b.dataset.id):k==="group"?group(b.dataset.id):show.masks.find(m=>m.id===b.dataset.id);selectItem(k,o);rt.selPt=-1;renderPanel();break;}
    case"edit":rt.edit=b.dataset.v;rt.selPt=-1;renderPanel();break;
    case"draw-finish":finishDrawing();break;
    case"draw-undo":rt.drawing?.pts.pop();renderPanel();break;
    case"draw-cancel":cancelDrawing();break;
    case"add-group":{const g={id:uid(),name:"Group "+(show.groups.length+1),color:GROUP_COLORS[show.groups.length%GROUP_COLORS.length],members:b.dataset.with?[b.dataset.with]:[]};
      show.groups.push(g);if(!b.dataset.with)rt.sel={kind:"group",id:g.id};save();renderPanel();toast(b.dataset.with?`Added to ${g.name}. Rename it from the Groups list.`:"Group added. Tick its members below.");break;}
    case"reset-corners":{const s=selObj();s.pts=bbox(s.pts);save();break;}
    case"flatten-grid":{const s=selObj();s.pts=cornersOf(s).map(p=>[p[0],p[1],0]);s.grid=gridFromCorners(s.pts,s.grid.c,s.grid.r);save();break;}
    case"fit-content":{const s=selObj();s.pts=bbox(s.shape);if(s.warp==="grid")s.grid=gridFromCorners(s.pts,s.grid?.c||3,s.grid?.r||3);save();toast("Content now fills the outline's bounding box.");break;}
    case"add-shape":{const s=selObj();s.shape=s.warp==="grid"&&s.grid?meshFor(s).border.filter((_,i)=>i%4===0).map(p=>[p[0],p[1],1]):s.pts.map(p=>[p[0],p[1],0]);rt.edit="shape";rt.selPt=-1;save();renderPanel();toast("Outline added. Drag its points onto the edge of the piece.");break;}
    case"remove-shape":{const s=selObj();s.shape=null;rt.edit="warp";rt.selPt=-1;save();renderPanel();break;}
    case"dup-surface":{const s=selObj();const c=JSON.parse(JSON.stringify(s));c.id=uid();c.name=s.name+" copy";
      const off=p=>{p[0]+=0.02;p[1]+=0.02;};c.pts.forEach(off);c.grid?.pts.forEach(off);c.shape?.forEach(off);
      c.z=(+s.z||0)+0.5;show.surfaces.splice(show.surfaces.indexOf(s)+1,0,c);renumberLayers(c.outputId);groupsOf(s.id).forEach(g=>g.members.push(c.id));ensureRT();selectItem("surface",c);save();renderTabs();renderPanel();break;}
    case"add-point":{const arr=editArr();let best=rt.selPt>=0?rt.selPt:0,bl=-1;
      if(rt.selPt<0)arr.forEach((p,i)=>{const q=arr[(i+1)%arr.length];const l=Math.hypot(p[0]-q[0],p[1]-q[1]);if(l>bl){bl=l;best=i}});
      const p=arr[best],q=arr[(best+1)%arr.length];arr.splice(best+1,0,[(p[0]+q[0])/2,(p[1]+q[1])/2,0]);rt.selPt=best+1;save();renderPanel();break;}
    case"del-point":{const arr=editArr();if(arr.length>3){arr.splice(rt.selPt>=0?rt.selPt:arr.length-1,1);rt.selPt=-1;save();renderPanel();}break;}
    case"curve-point":{const arr=editArr();if(rt.selPt>=0){arr[rt.selPt][2]=arr[rt.selPt][2]?0:1;save();renderPanel();}break;}
    case"curve-all":{editArr().forEach(p=>p[2]=+b.dataset.v);save();renderPanel();break;}
    case"layer":{const o=selObj();if(o&&rt.sel.kind!=="group")layerMove(o,b.dataset.v);break;}
    case"layer-row":{const it=b.dataset.kind==="mask"?show.masks.find(m=>m.id===b.dataset.id):surf(b.dataset.id);if(it)layerMove(it,b.dataset.v);break;}
    case"add-look-cue":rt.mode="cues";rt.playhead=show.cues.length-1;addCue("look");renderBin();toast("Look recorded as a new cue.");break;
    case"ph":if(!rt.previewOn){rt.previewOn=true;}if(rt.playhead===+b.dataset.i){renderPanel();break;}rt.playhead=+b.dataset.i;renderPanel();break;
    case"move-cue":{const i=rt.playhead,j=i+ +b.dataset.d;if(i<show.cues.length&&j>=0&&j<show.cues.length){const[c]=show.cues.splice(i,1);show.cues.splice(j,0,c);rt.playhead=j;save();renderPanel();}break;}
    case"look-capture":{const c=show.cues[rt.playhead];c.assign=captureLook();save();renderPanel();toast("Cue updated from what's on stage, one row per surface.");break;}
    case"look-preview":{const c=show.cues[rt.playhead];if(rt.testPattern){rt.testPattern=false;syncTP();}applyLookRows(c.assign,Math.min(+c.duration||0,1.5),c.restart,c.trans);break;}
    case"row-add":{const c=show.cues[rt.playhead];const vis=show.media.find(isVisual);c.assign=c.assign||[];
      c.assign.push({target:show.groups[0]?"g:"+show.groups[0].id:"all",mediaId:vis?.id||null,level:1});save();renderPanel();break;}
    case"row-del":{const c=show.cues[rt.playhead];c.assign.splice(+b.dataset.i,1);save();renderPanel();break;}
  }
});
document.addEventListener("input",e=>{
  const t=e.target,ds=t.dataset;const out=t.parentElement?.querySelector("output");
  const val=t.type==="checkbox"?t.checked:(t.type==="range"||t.type==="number")?parseFloat(t.value)||0:t.value;
  if(t.id==="showName"){show.name=t.value;save();return;}
  if(ds.wzs&&rt.wiz){rt.wiz.keep=null;val?rt.wiz.sel.add(ds.wzs):rt.wiz.sel.delete(ds.wzs);renderWiz();return;}
  if(t.id==="wzWhole"&&rt.wiz){rt.wiz.whole=val;rt.wiz.keep=null;renderWiz();return;}
  if(t.id==="wzDur"&&rt.wiz){rt.wiz.dur=val;if(out)out.textContent=(+val).toFixed(1)+"s";const sb=$(".wz-sum button:last-child");if(sb)sb.lastChild.textContent=`${TRANS[rt.wiz.trans]} · ${(+val).toFixed(1)}s`;return;}
  if(t.id==="wzLevel"&&rt.wiz){rt.wiz.level=val;if(out)out.textContent=Math.round(val*100)+"%";return;}
  if(t.id==="wzRestart"&&rt.wiz){rt.wiz.restart=val;return;}
  if(t.id==="wzName"&&rt.wiz){rt.wiz.name=t.value;return;}
  if(t.id==="libQ"){rt.libQuery=t.value;const pos=t.selectionStart;renderBin();const q=$("#libQ");q.focus();try{q.setSelectionRange(pos,pos);}catch(err){}return;}
  if(t.id==="pkQ"){rt.pickQuery=t.value;renderPicker();const q=$("#pkQ");q.focus();return;}
  if(t.id==="uc-target"){(rt.uc||(rt.uc={})).target=t.value;return;}
  if(t.id==="uc-trans"){(rt.uc||(rt.uc={})).trans=t.value;return;}
  if(ds.md){const m=media(rt.selMedia);if(!m)return;m[ds.md]=val;
    if(ds.md==="speed"&&out)out.textContent=(+val).toFixed(2)+"×";
    if(ds.md==="sound")vidSet.forEach(v=>{if(v._mid===m.id)v.muted=!val;});
    save();const tile=$(`.tile[data-id="${m.id}"]`);if(tile){tile.querySelector(".sw").style.cssText=swatchCSS(m);tile.querySelector(".nm").textContent=m.name;}return;}
  if(ds.tc){const c=tlClip(rt.tsel);if(!c)return;const k=ds.tc;
    if(k==="speed"){const ns=clamp((parseFloat(t.value)||100)/100,0.1,8),os=spd(c);c.dur=Math.max(0.1,c.dur*os/ns);if(ns===1)delete c.speed;else c.speed=ns;growTo(c);save();renderTimeline();renderPanel();return;}
    if(k==="ttype")c.ttype=val;else if(k==="mute"){c.mute=!val;}else{let v=Math.max(0,parseFloat(t.value)||0);if(k==="dur")v=Math.max(0.1,v);if(k==="level"||k==="vol")v=clamp(val,0,1);c[k]=v;}
    if((k==="level"||k==="vol")&&out)out.textContent=Math.round(c[k]*100)+"%";
    if((k==="start"||k==="dur")&&c.start+c.dur>T().duration)T().duration=Math.ceil(c.start+c.dur+5);
    save();refreshClip(c);if(k==="mute")renderPanel();return;}
  if(t.id==="aud-dev"){const A=AU();A.deviceId=t.value;A.deviceLabel=t.selectedOptions[0]?.textContent||"";save();applyAudioDevice();return;}
  if(ds.spk&&!ds.route){const sp=AU().speakers.find(x=>x.id===ds.spk);if(!sp)return;if(ds.f==="name")sp.name=t.value||sp.name;else if(ds.f==="ch")sp.ch=+t.value;save();rebuildRouters();if(ds.f==="ch")renderAudioSetup();return;}
  if(ds.route){const o=routeTarget(ds.route);if(!o)return;const r=o.route||(o.route=JSON.parse(JSON.stringify(defaultRoute())));const x=r[ds.spk]||(r[ds.spk]={src:"LR",lvl:1});
    if(ds.f==="on"){if(val){x.lvl=x.lvl>0?x.lvl:1;}else delete r[ds.spk];}else if(ds.f==="src")x.src=t.value;else if(ds.f==="lvl"){x.lvl=+t.value;if(out)out.textContent=Math.round(x.lvl*100)+"%";}
    save();rebuildRouters();if(ds.f!=="lvl")renderPanel();return;}
  if(ds.tspan){const c=tlClip(rt.tsel);if(!c)return;const set=new Set(c.span||[]);if(val)set.add(ds.tspan);else set.delete(ds.tspan);c.span=[...set];if(!c.span.length)delete c.span;
    if(c.frame&&!c.span)delete c.frame;save();refreshClip(c);renderPanel();return;}
  if(ds.mk){const mk=(T().markers||[]).find(x=>x.id===ds.mk);if(!mk)return;if(t.dataset.f==="t"){mk.t=clamp(parseFloat(t.value)||0,0,T().duration);T().markers.sort((a,b)=>a.t-b.t);}else mk.name=t.value||mk.name;save();renderTimeline();return;}
  if(t.id==="tl-dur"){T().duration=Math.max(1,parseFloat(t.value)||1);if(tl.t>T().duration)tl.t=T().duration;save();renderTimeline();return;}
  if(t.id==="tl-loop"){T().loop=t.value==="1";save();return;}
  if(t.id==="tc-lane"){const c=tlClip(rt.tsel);if(c){c.lane=t.value;save();renderTimeline();renderPanel();}return;}
  if(t.id==="tlSnap"){tl.snap=val;return;}
  if(t.id==="tlLoopR"){tl.loopRange=val;return;}
  if(t.id==="tlOutl"){tl.outlines=val;return;}
  if(t.id==="tlZoom"){tl.pps=+t.value;const sc=$("#tlScroll"),mid=(sc.scrollLeft+sc.clientWidth/2-170)/((+sc.dataset.pps)||tl.pps);renderTimeline();return;}
  if(ds.tg){const c=show.cues[rt.playhead];if(!c)return;const tg={...trig(c)};tg[ds.tg]=ds.tg==="secs"?Math.max(0,parseFloat(t.value)||0):t.value;c.trigger=tg;save();
    const tr=panel.querySelector(`tr[data-cue="${c.id}"]`);if(tr)tr.outerHTML=cueRow(c,rt.playhead);const sm=$("#trigSum");if(sm)sm.textContent=trigText(c);
    if(ds.tg!=="secs")renderPanel();return;}
  if(ds.frk){const sl=t.parentElement.querySelector("input[type=range]");if(!sl)return;let v=parseFloat(t.value);if(!isFinite(v))return;v/=100;if(ds.frk==="zoom")v=Math.max(0.01,v);
    let f=null;if(sl.dataset.cfr){const pv=frameProv();if(!pv)return;f=pv.get(true);}else{const s=selObj(),tt=s&&topImagery(s);if(!tt)return;f=frameEdit(s,tt.m.id);}
    f[ds.frk]=v;sl.value=v;save();return;}
  if(ds.cfr){const pv=frameProv();if(!pv)return;const f=pv.get(true);f[ds.cfr]=val;syncCueFrameUI(f);save();return;}
  if(t.id==="ce-sid"){const sx=surf(t.value);rt.cedit={cue:selCue().id,sid:t.value};if(sx&&sx.outputId!==rt.out){rt.out=null;const keep=rt.cedit;setOut(sx.outputId);rt.cedit=keep;}renderPanel();return;}
  if(ds.fr){const s=selObj(),tt=s&&topImagery(s);if(!tt)return;const f=frameEdit(s,tt.m.id);f[ds.fr]=val;syncFrameUI(f);save();return;}
  if(ds.vt){const s=selObj();if(!s||rt.sel?.kind!=="surface")return;const v=surfVideo(s.id);const mid=v?._mid;if(!mid)return;
    if(ds.vt==="seek"){try{v.currentTime=val;v._done=false;}catch(err){}scrubbing=true;clearTimeout(scrubT);scrubT=setTimeout(()=>scrubbing=false,400);return;}
    s.trims=s.trims||{};const tr=s.trims[mid]=s.trims[mid]||{};
    if(ds.vt==="loop")tr.loop=val==="1";else if(ds.vt==="rate")tr.rate=+val;else tr[ds.vt]=Math.max(0,+val||0);
    if(ds.vt==="in"){try{v.currentTime=tr.in;}catch(err){}}
    v._done=false;save();return;}
  if(ds.of){const o=curOut();o.name=val;save();const tn=$(`.otab[data-id="${o.id}"] .ot-name`);if(tn)tn.textContent=val;return;}
  if(ds.gf){const g=selObj();g[ds.gf]=val;save();const li=panel.querySelector(`[data-id="${g.id}"] .nm`);if(ds.gf==="name"&&li)li.textContent=val;
    if(ds.gf==="color"){const ch=panel.querySelector(`[data-id="${g.id}"] .chip`);if(ch)ch.style.background=val;}return;}
  if(ds.gm){const g=selObj();g.members=g.members.filter(x=>x!==ds.gm);if(val)g.members.push(ds.gm);save();
    const li=panel.querySelector(`[data-id="${g.id}"] .meta`);if(li)li.textContent=`${g.members.length} surface${g.members.length===1?"":"s"}`;return;}
  if(ds.sg){const s=selObj(),g=group(ds.sg);g.members=g.members.filter(x=>x!==s.id);if(val)g.members.push(s.id);save();return;}
  if(ds.sf){const s=selObj();if(!s)return;
    if(ds.sf==="level"){rt.surf[s.id].level=val;if(out)out.textContent=Math.round(val*100)+"%";return;}
    if(ds.sf==="look"){putOn([s.id],val||null);save();renderPanel();return;}
    if(ds.sf==="outputId"){s.z=topZ(val);s.outputId=val;save();setOut(val);selectItem("surface",s);renderPanel();renderTabs();toast(`${s.name} moved to ${output(val).name}.`);return;}
    if(ds.sf==="warp"){
      if(val==="grid"){const g=s.grid||{c:3,r:3};s.warp="corner";regrid(s,g.c,g.r);s.warp="grid";}
      else{s.pts=cornersOf(s).map(p=>[p[0],p[1],0]);s.warp="corner";}
      rt.selPt=-1;save();renderPanel();return;}
    if(ds.sf==="gc"||ds.sf==="gr"){const c=clamp(Math.round(ds.sf==="gc"?val:s.grid.c),1,8),r=clamp(Math.round(ds.sf==="gr"?val:s.grid.r),1,8);
      if(c!==s.grid.c||r!==s.grid.r){regrid(s,c,r);rt.selPt=-1;save();}return;}
    s[ds.sf]=val;if(ds.sf==="feather"&&out)out.textContent=(+val).toFixed(2);save();
    if(ds.sf==="name"){const li=panel.querySelector(`[data-id="${s.id}"] .nm`);if(li)li.textContent=val;}return;}
  if(ds.mf){const m=selObj();m.name=val;save();const li=panel.querySelector(`[data-id="${m.id}"] .nm`);if(li)li.textContent=val;return;}
  const c=show.cues[rt.playhead];
  if(ds.cf&&c){c[ds.cf]=val;if(ds.cf==="level"&&out)out.textContent=Math.round(val*100)+"%";save();
    const tr=panel.querySelector(`tr[data-cue="${c.id}"]`);if(tr&&t.type!=="range"){tr.outerHTML=cueRow(c,rt.playhead);}
    if(ds.cf==="num"||ds.cf==="name")$("#standby").innerHTML=`<span class="mono">${esc(c.num)}</span>${esc(c.name)}`;
    if(ds.cf==="mediaId"){const m=media(val);if(m&&(/^New|^Sound$/.test(c.name)||show.media.some(x=>x.name===c.name))){c.name=m.name;renderPanel();}}
    return;}
  if(ds.lt!==undefined&&c){c.assign[+ds.lt].target=val;save();renderPanel();return;}
  if(ds.lspan!==undefined&&c){const row=c.assign[+ds.lspan];if(val)row.span=true;else delete row.span;rt.cedit=null;save();syncPreview();renderPanel();
    toast(val?"One picture across all of them. Drag the dashed box on the stage to size and place it over the set.":"Each surface shows the whole picture again.");return;}
  if(ds.lm!==undefined&&c){const r=c.assign[+ds.lm];r.mediaId=val==="__black"?null:val;save();renderPanel();return;}
  if(ds.lx!==undefined&&c){const r=c.assign[+ds.lx];if(val)r.trans=val;else delete r.trans;save();return;}
  if(ds.lv!==undefined&&c){c.assign[+ds.lv].level=val;if(out)out.textContent=Math.round(val*100)+"%";save();return;}
});
document.addEventListener("change",e=>{
  const t=e.target;
  if(t.id==="scr-sel"){setScreen(curOut(),t.value?displays.find(d=>String(d.id)===t.value):null);return;}
  if(t.id==="res"){curOut().res=t.value.split("x").map(Number);ensureOutputs();showStage();renderTabs();save();}
  if(t.id==="addCue"&&t.value){addCue(t.value);}
  if(t.id==="addSurf"&&t.value){const v=t.value;t.value="";
    if(v==="draw"){startDrawing("surface");return;}
    const k=show.surfaces.length,off=(k%5)*0.03;
    const s=v==="rect"?newSurface("Surface "+(k+1)):newSurface(v[0].toUpperCase()+v.slice(1)+" "+(k+1),presetShape(v,0.5+off,0.5+off,0.2));
    selectItem("surface",s);rt.edit=s.shape?"shape":"warp";rt.selPt=-1;save();renderTabs();renderPanel();}
  if(t.id==="addMask"&&t.value){const v=t.value;t.value="";
    if(v==="draw"){startDrawing("mask");return;}
    const m={id:uid(),outputId:rt.out,z:topZ(rt.out),name:"Mask "+(show.masks.length+1),pts:presetShape(v,0.5,0.5,0.1)};show.masks.push(m);rt.sel={kind:"mask",id:m.id};rt.selPt=-1;save();renderPanel();}
  if(t.id==="newGen"&&t.value){const g=t.value;const m={id:uid(),kind:"gen",gen:g,name:GENS[g]?GENS[g].label:SYNTHS[g],c1:"#f2a93b",c2:"#1d3f99",speed:1};
    if(SYNTHS[g]){m.kind="synth";delete m.c1;delete m.c2;}show.media.push(m);rt.selMedia=m.id;t.value="";save();renderBin();}
  if(t.id==="fileIn"){addFiles([...t.files]);t.value="";}
  if(t.id==="pjFile"&&t.files[0]){const f=t.files[0];f.text().then(txt=>importText(txt,f.name.replace(/\.[^.]+$/,"")));t.value="";}
  if(t.id==="wzFile"&&t.files.length&&rt.wiz){const made=addFiles([...t.files],true);t.value="";const m=made.find(isVisual);if(m)rt.wiz.mediaId=m.id;renderWiz();}
  if(t.id==="surfFileIn"&&t.files.length){const s=selObj();const made=addFiles([...t.files],true);t.value="";const m=made.find(isVisual);if(s&&m)assignToSurface(s,m);}
  if(t.id==="relinkIn"&&t.files[0]){const m=media(rt.selMedia);loadFile(m,t.files[0]);storeFile(m.id,t.files[0]);renderBin();renderPanel();toast(`“${m.name}” re-added.`);}
});
$("#newGen").innerHTML+=Object.entries(GENS).map(([k,v])=>`<option value="${k}">${v.label}</option>`).join("")+Object.entries(SYNTHS).map(([k,v])=>`<option value="${k}">♪ ${v}</option>`).join("");
const binWrap=$("#binWrap");
["dragenter","dragover"].forEach(ev=>document.addEventListener(ev,e=>{if(e.dataTransfer?.types?.includes("Files")){e.preventDefault();binWrap.classList.add("drop");}}));
["dragleave","drop"].forEach(ev=>document.addEventListener(ev,e=>{if(ev==="dragleave"&&e.relatedTarget)return;binWrap.classList.remove("drop");}));
/* ---------- cue builder: projector → surfaces → media / effect / transition ---------- */
function wizOpen(mode,cue,rowIdx){
  const w={mode,cueId:cue?.id||null,row:rowIdx??null,step:1,out:rt.out||show.outputs[0].id,sel:new Set(),whole:false,keep:null,
    tab:"media",mediaId:undefined,trans:"xfade",dur:2,level:1,restart:true,name:"",span:false};
  if(mode==="new"||mode==="addrow"){if(rt.sel?.kind==="surface"){const s=surf(rt.sel.id);if(s){w.out=s.outputId;w.sel.add(s.id);}}}
  if(mode==="addrow"){w.trans=cue.trans||"xfade";w.dur=+cue.duration||2;w.restart=!!cue.restart;}
  if(mode==="edit"){
    const r=cue.assign[rowIdx],ids=resolveTarget(r.target),outs=new Set(ids.map(id=>surf(id).outputId));w.span=!!r.span;
    if(outs.size===1&&!r.target.startsWith("g:")&&r.target!=="all"){w.out=[...outs][0];ids.forEach(id=>w.sel.add(id));w.whole=r.target.startsWith("o:");}
    else{w.keep=r.target;if(outs.size===1){w.out=[...outs][0];ids.forEach(id=>w.sel.add(id));}}
    w.mediaId=r.mediaId??"__none";w.level=r.level??1;w.trans=TRANS[r.trans]?r.trans:(cue.trans||"xfade");w.dur=+cue.duration||0;w.restart=!!cue.restart;w.name=cue.name;
    w.tab=w.mediaId!=="__none"&&media(w.mediaId)?.kind==="gen"?"effect":"media";w.step=3;
  }
  rt.wiz=w;closePicker();$("#wiz").hidden=false;renderWiz();
}
function wizClose(){rt.wiz=null;$("#wiz").hidden=true;}
function wizTarget(w){
  if(w.keep)return w.keep;
  if(w.whole)return"o:"+w.out;
  const ids=show.surfaces.filter(s=>s.outputId===w.out&&w.sel.has(s.id)).map(s=>s.id);
  const g=show.groups.find(g=>g.members.length===ids.length&&g.members.every(m=>ids.includes(m)));
  if(g&&ids.length>1)return"g:"+g.id;
  return ids.length===1?ids[0]:"m:"+ids.join(",");
}
function wizSelCount(w){return w.keep?resolveTarget(w.keep).length:w.whole?show.surfaces.filter(s=>s.outputId===w.out).length:[...w.sel].filter(id=>surf(id)?.outputId===w.out).length;}
function wizContentName(w){if(w.mediaId===undefined)return"Nothing chosen yet";if(w.mediaId==="__none")return"Black (clear the surface)";return media(w.mediaId)?.name||"Missing media";}
function renderWiz(){
  const w=rt.wiz;if(!w)return;const o=output(w.out)||show.outputs[0];const cue=w.cueId?show.cues.find(c=>c.id===w.cueId):null;
  const n=wizSelCount(w),canStep2=!!o,canStep3=n>0;
  const steps=[["1","Projector",true],["2","Surfaces",canStep2],["3","Media · Effect · Transition",canStep3]];
  let h=`<div class="wz-head"><h2 id="wzTitle">${w.mode==="new"?"New cue":w.mode==="addrow"?`Add surfaces to cue ${esc(cue.num)}`:`Edit cue ${esc(cue.num)} · ${esc(cue.name)}`}</h2><button class="btn ghost" data-act="wz-close" aria-label="Close">✕</button></div>
    <ol class="wz-steps">${steps.map(([k,l,ok],i)=>`<li><button data-act="wz-step" data-v="${k}" ${ok?"":"disabled"} aria-current="${w.step===+k?"step":"false"}"><span class="wz-n">${k}</span>${l}</button></li>`).join("")}</ol>`;
  if(w.step===1){
    h+=`<p class="wz-q">Which projector?</p><div class="wz-cards">${show.outputs.map(p=>{const c=show.surfaces.filter(s=>s.outputId===p.id).length,tw=200,th=Math.round(tw*p.res[1]/p.res[0]);
      return`<button class="wz-card" data-act="wz-out" data-id="${p.id}" aria-pressed="${p.id===w.out}"><canvas class="thumb" data-id="${p.id}" width="${tw}" height="${th}"></canvas><b>${esc(p.name)}</b><span>${p.res[0]}×${p.res[1]} · ${c} surface${c===1?"":"s"}</span></button>`}).join("")}</div>
      <div class="wz-foot"><span></span><button class="btn primary" data-act="wz-next">Next: choose surfaces →</button></div>`;
  }else if(w.step===2){
    const ss=show.surfaces.filter(s=>s.outputId===o.id),pw=520,ph=Math.round(pw*o.res[1]/o.res[0]);
    const gs=show.groups.filter(g=>g.members.some(id=>surf(id)?.outputId===o.id));
    h+=`<p class="wz-q">Which surfaces on ${esc(o.name)}? <span>Click them on the picture or in the list. Pick one or several.</span></p>
      ${w.keep?`<p class="note wz-keep">This cue currently targets <b>${esc(targetLabel(w.keep))}</b>. Choosing surfaces here will replace that.</p>`:""}
      <div class="wz-split"><div class="wz-prev"><canvas class="thumb" data-id="${o.id}" width="${pw}" height="${ph}"></canvas><canvas id="wzOv" aria-label="Click surfaces to select them"></canvas></div>
      <div class="wz-list">${ss.length?ss.map(s=>`<label class="wz-surf"><input type="checkbox" id="wzs-${s.id}" data-wzs="${s.id}" ${(w.whole||w.sel.has(s.id))&&!w.keep?"checked":""} ${w.whole?"disabled":""}><span class="chip" style="background:${s.color}"></span>${esc(s.name)}</label>`).join(""):`<p class="note">This projector has no surfaces yet. Add some in Map mode first.</p>`}
        ${ss.length?`<div class="btns"><button class="btn" data-act="wz-all">Select all</button><button class="btn ghost" data-act="wz-none">Clear</button></div>`:""}
        ${gs.length?`<div class="wz-sub">Groups</div><div class="chips">${gs.map(g=>`<button class="chipbtn" data-act="wz-group" data-id="${g.id}"><span class="dot" style="background:${g.color}"></span>${esc(g.name)}</button>`).join("")}</div>`:""}
        ${ss.length?`<label class="wz-surf wz-whole"><input type="checkbox" id="wzWhole" ${w.whole?"checked":""}> Whole projector <span class="note" style="margin:0">(includes surfaces you add later)</span></label>`:""}
      </div></div>
      <div class="wz-foot"><button class="btn" data-act="wz-back">← Projector</button><span class="wz-count">${n} surface${n===1?"":"s"} selected</span><button class="btn primary" data-act="wz-next" ${n?"":"disabled"}>Next: what plays →</button></div>`;
  }else{
    const tgt=wizTarget(w);const vids=show.media.filter(m=>m.kind==="video"||m.kind==="image"),effs=show.media.filter(m=>m.kind==="gen");
    const tile=m=>`<button class="pk-item${w.mediaId===m.id?" on":""}" data-act="wz-media" data-id="${m.id}" ${missing(m)?"disabled":""}><span class="pk-th" style="${swatchCSS(m)}"></span><span>${esc(m.name)}</span></button>`;
    h+=`<div class="wz-sum">
        <button data-act="wz-step" data-v="2"><span>On</span>${esc(targetLabel(tgt))}</button>
        <button data-act="wz-tab" data-v="${w.mediaId&&media(w.mediaId)?.kind==="gen"?"effect":"media"}"><span>Plays</span>${esc(wizContentName(w))}</button>
        <button data-act="wz-tab" data-v="transition"><span>Transition</span>${TRANS[w.trans]}${w.trans==="cut"?"":` · ${(+w.dur).toFixed(1)}s`}</button></div>
      <div class="wz-tabs" role="tablist">${[["media","Media"],["effect","Effect"],["transition","Transition"]].map(([k,l])=>`<button role="tab" data-act="wz-tab" data-v="${k}" aria-selected="${w.tab===k}">${l}</button>`).join("")}</div>
      <div class="wz-pane">`;
    const nT=resolveTarget(tgt).length;
    if(nT>1&&w.tab!=="transition")h+=`<div class="wz-span" role="radiogroup" aria-label="How it plays on ${nT} surfaces">
        <button role="radio" data-act="wz-span" data-v="0" aria-checked="${!w.span}"><b>Same picture on each</b><span>Every surface shows the whole video</span></button>
        <button role="radio" data-act="wz-span" data-v="1" aria-checked="${!!w.span}"><b>One picture across all ${nT}</b><span>One video, each surface shows its part</span></button></div>`;
    if(w.tab==="media")h+=`<div class="wz-toolbar"><span class="note" style="margin:0">Videos and images from your library.</span><label class="btn" for="wzFile">Upload…</label><input id="wzFile" type="file" class="sr" multiple accept="video/*,image/*,.mov,.m4v,.mkv,.heic"></div>
      <div class="pk-grid wz-grid">${vids.map(tile).join("")||`<p class="note">No videos or images yet. Upload some to use them here.</p>`}</div>`;
    else if(w.tab==="effect")h+=`<div class="wz-toolbar"><span class="note" style="margin:0">Built-in animated effects. Change their colors in the media library.</span></div>
      <div class="pk-grid wz-grid"><button class="pk-item${w.mediaId==="__none"?" on":""}" data-act="wz-media" data-id="__none"><span class="pk-th" style="background:#000"></span><span>Black (clear)</span></button>${effs.map(tile).join("")}</div>`;
    else h+=`<div class="wz-trans">${Object.entries(TRANS).map(([k,l])=>`<button class="wz-tr${w.trans===k?" on":""}" data-act="wz-trans" data-v="${k}"><span class="tr-ic tr-${k}" aria-hidden="true"><i></i></span>${l}</button>`).join("")}</div>
      <div class="vt-grid" style="margin-top:12px">
        <label for="wzDur">Time (s)</label><div class="inline"><input id="wzDur" type="range" min="0" max="10" step="0.1" value="${w.dur}" ${w.trans==="cut"?"disabled":""}><output>${(+w.dur).toFixed(1)}s</output></div>
        <label for="wzLevel">Brightness</label><div class="inline"><input id="wzLevel" type="range" min="0" max="1" step="0.01" value="${w.level}"><output>${Math.round(w.level*100)}%</output></div>
        <span class="lab">Video</span><label class="inline"><input id="wzRestart" type="checkbox" ${w.restart?"checked":""}> Start videos from their in point</label>
      </div>${w.mode!=="new"&&cue&&cue.assign.length>1?`<p class="note">Time applies to the whole cue. The transition applies to these surfaces only.</p>`:""}`;
    h+=`</div><div class="wz-foot"><button class="btn" data-act="wz-back">← Surfaces</button>
      ${w.mode==="new"?`<input id="wzName" type="text" placeholder="Cue name (optional)" value="${esc(w.name)}" aria-label="Cue name">`:"<span></span>"}
      <button class="btn primary" data-act="wz-commit" ${w.mediaId===undefined?"disabled":""}>${w.mode==="new"?"Create cue":w.mode==="addrow"?"Add to cue":"Save changes"}</button></div>`;
  }
  $("#wzBody").innerHTML=h;
  if(w.step===2)drawWizOverlay();
}
function drawWizOverlay(){
  const w=rt.wiz,c=$("#wzOv");if(!c||!w)return;const r=c.getBoundingClientRect(),d=window.devicePixelRatio||1;
  c.width=Math.max(1,r.width*d);c.height=Math.max(1,r.height*d);const x=c.getContext("2d");x.clearRect(0,0,c.width,c.height);
  for(const s of show.surfaces.filter(s=>s.outputId===w.out)){
    const on=!w.keep&&(w.whole||w.sel.has(s.id)),poly=surfOutline(s);
    x.beginPath();poly.forEach(([px,py],i)=>i?x.lineTo(px*c.width,py*c.height):x.moveTo(px*c.width,py*c.height));x.closePath();
    x.fillStyle=on?"rgba(242,169,59,.35)":"rgba(0,0,0,.25)";x.fill();x.lineWidth=(on?2.5:1.2)*d;x.strokeStyle=on?"#f2a93b":"rgba(230,232,237,.7)";x.stroke();
    const cx=poly.reduce((a,p)=>a+p[0],0)/poly.length*c.width,cy=poly.reduce((a,p)=>a+p[1],0)/poly.length*c.height;
    x.font=`600 ${12*d}px "Barlow Condensed","Arial Narrow",sans-serif`;x.textAlign="center";x.textBaseline="middle";x.lineWidth=3*d;x.strokeStyle="rgba(0,0,0,.8)";x.strokeText(s.name.toUpperCase(),cx,cy);x.fillStyle=on?"#f2a93b":"#e6e8ed";x.fillText(s.name.toUpperCase(),cx,cy);
  }
  c.onclick=e=>{const rr=c.getBoundingClientRect(),p=[(e.clientX-rr.left)/rr.width,(e.clientY-rr.top)/rr.height];
    const s=[...show.surfaces.filter(s=>s.outputId===w.out)].reverse().find(s=>inPoly(p,surfOutline(s)));if(!s||w.whole)return;
    w.keep=null;w.sel.has(s.id)?w.sel.delete(s.id):w.sel.add(s.id);renderWiz();};
}
function wizCommit(){
  const w=rt.wiz;if(!w||w.mediaId===undefined)return;
  const target=wizTarget(w),mid=w.mediaId==="__none"?null:w.mediaId;
  const short=targetLabel(target).replace(/^(Group|Projector): /,"");
  let c;
  if(w.mode==="new"){
    const at=show.cues.length?Math.min(rt.playhead+1,show.cues.length):0;
    c={id:uid(),num:numAt(at),type:"look",name:(w.name||"").trim()||`${mid?media(mid).name:"Black"} on ${short}`,preWait:0,duration:w.trans==="cut"?0:+w.dur,cont:"none",trans:w.trans,restart:w.restart,assign:[{target,mediaId:mid,level:w.level,...(w.span&&resolveTarget(target).length>1?{span:true}:{})}]};
    show.cues.splice(at,0,c);rt.playhead=at;
  }else{
    c=show.cues.find(x=>x.id===w.cueId);if(!c){wizClose();return;}
    const row=w.mode==="addrow"?{}:c.assign[w.row];
    Object.assign(row,{target,mediaId:mid,level:w.level});if(w.span&&resolveTarget(target).length>1)row.span=true;else delete row.span;
    if(w.mode==="addrow")c.assign.push(row);
    if(c.assign.length===1){c.trans=w.trans;delete row.trans;}else if(w.trans!==(c.trans||"xfade"))row.trans=w.trans;else delete row.trans;
    c.duration=w.trans==="cut"&&c.assign.length===1?0:+w.dur;c.restart=w.restart;rt.playhead=show.cues.indexOf(c);
  }
  wizClose();rt.mode="cues";save();renderBin();renderPanel();
  toast(w.mode==="new"?`Cue ${c.num} created: ${c.name}. Press GO to run it.`:`Cue ${c.num} updated.`);
}
/* ---------- library picker (used by Look cue rows) ---------- */
function renderPicker(){
  const f=rt.pickFilter||"all",q=(rt.pickQuery||"").toLowerCase(),c=show.cues[rt.playhead],tlc=rt.pick?.tl?tlClip(rt.tsel):null;
  const cur=tlc?tlc.mediaId:c?.assign?.[rt.pick?.i]?.mediaId||"__none",audOnly=tlc&&isAudioLane(tlc.lane);
  const list=show.media.filter(m=>audOnly?m.kind==="audio":isVisual(m)).filter(m=>(f==="all"||libKind(m)===f)&&(!q||m.name.toLowerCase().includes(q)));
  $("#picker").innerHTML=`<div class="pk-head"><input id="pkQ" type="search" placeholder="Search library" value="${esc(rt.pickQuery||"")}" aria-label="Search library"><button class="btn ghost" data-act="pick-close">Close</button></div>
    <div class="chips">${[["all","All"],["video","Videos"],["image","Images"],["gen","Effects"]].map(([k,l])=>`<button class="chipbtn" data-act="pick-filter" data-v="${k}" aria-pressed="${f===k}">${l}</button>`).join("")}</div>
    <div class="pk-grid">${tlc?"":`<button class="pk-item${cur==="__none"?" on":""}" data-act="pick" data-id="__none"><span class="pk-th" style="background:#000"></span><span>Fade to black</span></button>`}
    ${list.map(m=>`<button class="pk-item${cur===m.id?" on":""}" data-act="pick" data-id="${m.id}" ${missing(m)?"disabled":""}><span class="pk-th" style="${swatchCSS(m)}"></span><span>${esc(m.name)}</span></button>`).join("")}</div>
    ${list.length?"":`<p class="note">Nothing matches.</p>`}`;
}
function openPicker(i,btn){
  rt.pick={i};const p=$("#picker");renderPicker();p.hidden=false;
  const r=btn.getBoundingClientRect(),W=Math.min(420,window.innerWidth-24),H=p.offsetHeight;
  let x=r.left;if(x+W>window.innerWidth-12)x=window.innerWidth-12-W;let y=r.bottom+6;if(y+H>window.innerHeight-12)y=Math.max(12,r.top-6-H);
  p.style.left=Math.max(12,x)+"px";p.style.top=y+"px";p.style.width=W+"px";
}
function closePicker(){$("#picker").hidden=true;rt.pick=null;}
/* drag library tiles onto Look cue rows or the cue list */
const isTileDrag=e=>[...(e.dataTransfer?.types||[])].includes("application/x-cuelight-media");
let dropEl=null;
function setDropEl(el){if(dropEl===el)return;dropEl?.classList.remove("dropping");dropEl=el;el?.classList.add("dropping");}
document.addEventListener("dragover",e=>{if(!isTileDrag(e)&&!(e.target.closest?.(".tl-track[data-lane]")&&[...(e.dataTransfer?.types||[])].includes("Files")))return;const t=e.target.closest?.("[data-droprow],tr[data-cue],tr.endrow,.tl-track[data-lane]");if(!t){setDropEl(null);return;}e.preventDefault();e.dataTransfer.dropEffect="copy";setDropEl(t);});
document.addEventListener("dragend",()=>setDropEl(null));
document.addEventListener("drop",e=>{
  const lane=e.target.closest?.(".tl-track[data-lane]");
  if(lane){setDropEl(null);const at=(e.clientX-lane.getBoundingClientRect().left)/tl.pps;
    if(isTileDrag(e)){e.preventDefault();e.stopPropagation();tlAddClip(media(e.dataTransfer.getData("application/x-cuelight-media")),lane.dataset.lane,at);return;}
    if(e.dataTransfer?.files?.length){e.preventDefault();e.stopPropagation();binWrap.classList.remove("drop");const made=addFiles([...e.dataTransfer.files],true);const m=made.find(x=>isAudioLane(lane.dataset.lane)?x.kind==="audio":isVisual(x));if(m)tlAddClip(m,lane.dataset.lane,at);return;}}
  if(!isTileDrag(e))return;const t=e.target.closest?.("[data-droprow],tr[data-cue],tr.endrow");setDropEl(null);if(!t)return;e.preventDefault();
  const m=media(e.dataTransfer.getData("application/x-cuelight-media"));if(!m||!isVisual(m))return;
  const defTarget=rt.sel?.kind==="surface"?rt.sel.id:rt.sel?.kind==="group"?"g:"+rt.sel.id:"all";
  if(t.dataset.droprow!==undefined){const c=show.cues[rt.playhead];c.assign[+t.dataset.droprow].mediaId=m.id;save();renderBin();renderPanel();toast(`Row now shows “${m.name}”.`);return;}
  if(t.classList.contains("endrow")){const at=show.cues.length;const c={id:uid(),num:numAt(at),type:"look",name:`${m.name} → ${targetLabel(defTarget).replace(/^(Group|Projector): /,"")}`,preWait:0,duration:2,cont:"none",trans:"xfade",restart:true,assign:[{target:defTarget,mediaId:m.id,level:1}]};
    show.cues.push(c);rt.playhead=at;save();renderBin();renderPanel();toast(`New cue ${c.num} with “${m.name}”. Pick where it goes in the rows below.`);return;}
  const i=show.cues.findIndex(c=>c.id===t.dataset.cue),c=show.cues[i];
  if(c.type!=="look"){toast("Drop media onto a Look cue, or onto “End of list” to make a new one.");return;}
  c.assign=c.assign||[];c.assign.push({target:defTarget,mediaId:m.id,level:1});rt.playhead=i;save();renderBin();renderPanel();
  toast(`Added “${m.name}” to cue ${c.num}. Set where it goes in the new row.`);
});
function surfaceAt(e){const[x,y]=toN(e);return[...onOut(show.surfaces)].reverse().find(s=>inPoly([x,y],surfOutline(s)))||null;}
function assignToSurface(s,m){
  putOn([s.id],m.id);selectItem("surface",s);rt.selMedia=m.id;
  if(rt.mode!=="map"){rt.mode="map";}
  save();renderBin();renderPanel();
  toast(`“${m.name}” is on ${s.name}. Record a Look cue to keep it in the show.`);
}
const isMediaDrag=e=>{const ty=[...(e.dataTransfer?.types||[])];return ty.includes("Files")||ty.includes("application/x-cuelight-media");};
ov.addEventListener("dragover",e=>{if(!isMediaDrag(e))return;e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect="copy";if(rt.room){const h=roomFind(e,false);if(h&&h.o.id!==rt.out)roomSwitch(h.o.id);}const s=surfaceAt(e);rt.dropHover=s?s.id:"none";});
ov.addEventListener("dragleave",()=>{rt.dropHover=null;});
ov.addEventListener("drop",e=>{
  if(!isMediaDrag(e))return;e.preventDefault();e.stopPropagation();binWrap.classList.remove("drop");rt.dropHover=null;
  const s=surfaceAt(e)||(rt.sel?.kind==="surface"&&selObj()?.outputId===rt.out?selObj():null);
  let m=null;const mid=e.dataTransfer.getData("application/x-cuelight-media");
  if(mid){m=media(mid);if(m&&!isVisual(m)){toast("Sounds play from Audio cues or the timeline's audio lanes.");return;}}
  else if(e.dataTransfer.files?.length){const made=addFiles([...e.dataTransfer.files],true);m=made.find(isVisual);
    if(!m&&made.length){toast("Added to the media bin. Sound files play from Audio cues.");renderPanel();return;}}
  if(!m)return;
  if(!s){toast(`“${m.name}” is in the media bin. Drop it onto a surface to put it there.`);renderPanel();return;}
  assignToSurface(s,m);
});
document.addEventListener("dragstart",e=>{const t=e.target.closest?.(".tile[draggable=true]");if(!t)return;e.dataTransfer.setData("application/x-cuelight-media",t.dataset.id);e.dataTransfer.effectAllowed="copy";});
document.addEventListener("dragend",()=>{rt.dropHover=null;});
document.addEventListener("drop",e=>{if(e.dataTransfer?.files?.length){e.preventDefault();addFiles([...e.dataTransfer.files]);}});

function onKey(e){
  const t=e.target||{};const typing=/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName||"")&&!["range","checkbox","color"].includes(t.type);
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&(e.key==="s"||e.key==="S")){e.preventDefault();commit();toast(`Saved “${show.name||"Untitled show"}”. Changes also save automatically.`);return;}
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&(e.key==="o"||e.key==="O")){e.preventDefault();openProjects();return;}
  if((e.metaKey||e.ctrlKey)&&(e.key==="["||e.key==="]"||e.code==="BracketLeft"||e.code==="BracketRight")&&rt.mode==="map"&&rt.sel&&rt.sel.kind!=="group"&&!/^(INPUT|TEXTAREA)$/.test(t.tagName||"")){
    e.preventDefault();const fwd=e.key==="]"||e.code==="BracketRight";layerMove(selObj(),e.shiftKey?(fwd?"front":"back"):(fwd?1:-1));return;}
  if((e.metaKey||e.ctrlKey)&&!e.altKey&&(e.key==="z"||e.key==="Z"||e.key==="y"||e.key==="Y")){
    const textField=(t.tagName==="TEXTAREA")||(t.tagName==="INPUT"&&["text","number","search",""].includes(t.type));
    if(textField)return; // let the field undo its own typing
    e.preventDefault();
    const isRedo=e.shiftKey||e.key==="y"||e.key==="Y";
    if(rt.drawing&&!isRedo){rt.drawing.pts.pop();renderPanel();return;}
    isRedo?redo():undo();return;
  }
  if(rt.drawing&&!typing){
    if(e.key==="Escape"){e.preventDefault();cancelDrawing();return;}
    if(e.key==="Enter"){e.preventDefault();finishDrawing();return;}
    if(e.key==="Backspace"){e.preventDefault();rt.drawing.pts.pop();renderPanel();return;}
  }
  if(e.key==="Escape"){e.preventDefault();if($("#helpModal")&&!$("#helpModal").hidden){closeHelp();return;}if($("#audModal")&&!$("#audModal").hidden){closeAudioSetup();return;}if(rt.wiz){wizClose();return;}if($("#scrModal")&&!$("#scrModal").hidden){closeScreenPicker();return;}if(!$("#projModal").hidden&&$("#confirm").hidden){closeProjects();return;}if(!$("#picker").hidden){closePicker();return;}if(!$("#confirm").hidden){closeConfirm();return;}if(!$("#modal").hidden){$("#modal").hidden=true;return;}if([...document.querySelectorAll(".menu")].some(m=>!m.hidden)){closeMenus();return;}panic();return;}
  if(rt.wiz){if(e.key==="Enter"&&!typing){e.preventDefault();if(rt.wiz.step<3){if(rt.wiz.step===1||wizSelCount(rt.wiz))rt.wiz.step++;renderWiz();}else wizCommit();}return;}
  if(typing)return;
  if(e.key==="?"){e.preventDefault();openHelp();return;}
  if(rt.mode==="timeline"&&!e.metaKey&&!e.ctrlKey){
    if(e.code==="Space"){e.preventDefault();tlToggle();return;}
    if(e.key==="Delete"||e.key==="Backspace"){if(tlSelIds().length){e.preventDefault();tlDel(e.shiftKey);}return;}
    if(e.key==="["){e.preventDefault();tlTrimTo("start");return;}
    if(e.key==="]"){e.preventDefault();tlTrimTo("end");return;}
    if(e.key==="k"||e.key==="K"){e.preventDefault();tlPause();return;}
    if(e.key==="l"||e.key==="L"){e.preventDefault();if(!tl.playing)tlToggle();return;}
    if(e.key==="j"||e.key==="J"){e.preventDefault();tlSeek(tl.t-5);return;}
    if(e.key==="ArrowUp"){e.preventDefault();tlJump(-1);return;}
    if(e.key==="ArrowDown"){e.preventDefault();tlJump(1);return;}
    if(e.shiftKey&&(e.key==="m"||e.key==="M")){e.preventDefault();tlMarker();return;}
    if(e.shiftKey&&(e.key==="z"||e.key==="Z")){e.preventDefault();tlZoomFit();return;}
    if(!e.shiftKey&&(e.key==="a"||e.key==="A")){e.preventDefault();tl.tool="select";renderTimeline();return;}
    if(!e.shiftKey&&(e.key==="b"||e.key==="B")){e.preventDefault();tl.tool="blade";renderTimeline();return;}
    if(!e.shiftKey&&(e.key==="i"||e.key==="I")){e.preventDefault();tlSetRange("in");return;}
    if(!e.shiftKey&&(e.key==="o"||e.key==="O")){e.preventDefault();tlSetRange("out");return;}
    if(e.altKey&&(e.code==="KeyX")){e.preventDefault();tlClearRange();return;}
    if(!e.shiftKey&&(e.key==="d"||e.key==="D")){e.preventDefault();tlToggleOff();return;}
    if(e.key===","||e.key==="<"){e.preventDefault();tlNudge(-(e.shiftKey?1:1/FPS));return;}
    if(e.key==="."||e.key===">"){e.preventDefault();tlNudge(e.shiftKey?1:1/FPS);return;}
    if(e.key==="F9"){e.preventDefault();tlPlace("insert");return;}
    if(e.key==="F10"){e.preventDefault();tlPlace("overwrite");return;}
    if(e.key==="F12"&&e.shiftKey){e.preventDefault();tlPlace("append");return;}
    if(e.key==="s"||e.key==="S"){e.preventDefault();tlSplit();return;}
    if(e.key==="Home"){e.preventDefault();tlSeek(0);return;}
    if(e.key==="End"){e.preventDefault();tlSeek(T().duration);return;}
    if(e.key==="ArrowLeft"||e.key==="ArrowRight"){e.preventDefault();tlSeek(tl.t+(e.key==="ArrowRight"?1:-1)*(e.shiftKey?1:1/30));return;}
  }
  if(rt.mode==="timeline"&&(e.metaKey||e.ctrlKey)&&(e.key==="d"||e.key==="D")){e.preventDefault();tlDup();return;}
  if(rt.mode==="timeline"&&(e.metaKey||e.ctrlKey)&&!e.shiftKey){const k=e.key.toLowerCase();
    if(k==="c"&&tlSelIds().length){e.preventDefault();tlCopy(false);return;}
    if(k==="x"&&tlSelIds().length){e.preventDefault();tlCopy(true);return;}
    if(k==="v"&&tlClipboard){e.preventDefault();tlPaste();return;}
    if(k==="t"){e.preventDefault();tlAddTransition();return;}
    if(k==="b"){e.preventDefault();tlSplit();return;}
    if(k==="a"){e.preventDefault();rt.tmulti=new Set(T().clips.filter(c=>!laneSt(c.lane).lock).map(c=>c.id));rt.tsel=[...rt.tmulti][0]||null;renderTimeline();renderPanel();return;}}
  if(e.code==="Space"){e.preventDefault();go();return;}
  if(e.key==="t"||e.key==="T"){rt.testPattern=!rt.testPattern;syncTP();return;}
  if((e.key==="m"||e.key==="M")&&!e.metaKey&&!e.ctrlKey&&!e.altKey){setRoom(!rt.room);return;}
  if(!e.metaKey&&!e.ctrlKey&&!e.altKey){
    if(e.key==="="||e.key==="+"){e.preventDefault();zoomCenter(1.25);return;}
    if(e.key==="-"||e.key==="_"){e.preventDefault();zoomCenter(0.8);return;}
    if(e.key==="0"){e.preventDefault();zoomFit();return;}
  }
  if((e.key==="Delete"||e.key==="Backspace")&&rt.mode==="map"&&editingOutline()&&rt.selPt>=0){
    const arr=editArr();if(arr&&arr.length>3){arr.splice(rt.selPt,1);rt.selPt=-1;save();renderPanel();}e.preventDefault();return;}
  if(e.key==="Delete"||e.key==="Backspace"){
    if(rt.mode==="cues"&&show.cues[rt.playhead]){e.preventDefault();deleteItem("cue",show.cues[rt.playhead].id);return;}
    if(rt.mode==="map"&&rt.sel&&rt.selPt<0){e.preventDefault();deleteItem(rt.sel.kind,rt.sel.id);return;}
  }
  if(e.key==="F2"||(e.key==="Enter"&&rt.mode==="map"&&rt.sel)){
    if(rt.mode==="cues"&&show.cues[rt.playhead]){e.preventDefault();startRename("cue",show.cues[rt.playhead].id);return;}
    if(rt.sel){e.preventDefault();startRename(rt.sel.kind,rt.sel.id);return;}
  }
  const arrows={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]};
  if(!arrows[e.key])return;e.preventDefault();
  if(rt.mode==="cues"){if(e.key==="ArrowUp")rt.playhead=Math.max(0,rt.playhead-1);if(e.key==="ArrowDown")rt.playhead=Math.min(show.cues.length,rt.playhead+1);renderPanel();return;}
  if(!rt.sel||rt.sel.kind==="group")return;
  const o=selObj();if(!o||o.outputId!==rt.out)return;const[dx,dy]=arrows[e.key],k=e.shiftKey?10:1,res=curRes();
  const arr=editArr();const sets=rt.selPt>=0&&arr?[[arr[rt.selPt]]]:bodiesOf(rt.sel.kind,o);
  sets.forEach(a=>a.forEach(p=>{p[0]+=dx*k/res[0];p[1]+=dy*k/res[1];}));save();
}
document.addEventListener("keydown",onKey);

/* ---------- output ---------- */
function syncTP(){$("#tpBtn").setAttribute("aria-pressed",rt.testPattern);}
function fullscreen(){
  const el=frameEl;const fn=el.requestFullscreen||el.webkitRequestFullscreen;
  if(!fn){toast("Fullscreen isn't available in this view. Try the standalone file in Chrome.");return;}
  try{const p=fn.call(el);p&&p.catch&&p.catch(()=>toast("Fullscreen was blocked here. Try the standalone file."));}catch(e){toast("Fullscreen was blocked here.");}
}
const outWins={};
function openOutput(id,opts={}){
  const o=output(id);if(!o)return;
  if(outWins[id]&&!outWins[id].closed){outWins[id].focus();return;}
  let w=null;try{w=window.open("","cuelight_out_"+id,"popup,width=960,height=540");}catch(e){}
  const cv=oc[id]?.cv;
  if(!w||!cv?.captureStream){toast("This view can't open a second window. Use Fullscreen output, or run the standalone Cuelight file for separate projector windows.");return;}
  const d=w.document;d.title="Cuelight — "+o.name;
  d.body.style.cssText="margin:0;background:#000;overflow:hidden;cursor:none";d.body.innerHTML="";
  const v=d.createElement("video");v.autoplay=true;v.muted=true;v.playsInline=true;v.style.cssText="position:fixed;inset:0;width:100vw;height:100vh;object-fit:contain;background:#000";
  v.srcObject=cv.captureStream(60);d.body.appendChild(v);v.play().catch(()=>{});
  const placed=!!(DESK&&displayFor(o));
  const tip=d.createElement("div");tip.textContent=`${o.name}: drag this window to that projector, then click here to go fullscreen.`;
  tip.style.cssText="position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);font:600 18px system-ui,sans-serif;color:#f2a93b;background:rgba(0,0,0,.75);padding:14px 18px;border:1px solid #f2a93b;border-radius:6px;cursor:pointer;max-width:80vw;text-align:center";
  if(!placed)d.body.appendChild(tip);
  if(!placed)d.addEventListener("click",()=>{tip.remove();const r=d.documentElement;(r.requestFullscreen||r.webkitRequestFullscreen)?.call(r);});
  d.addEventListener("keydown",onKey);
  outWins[id]=w;if(!opts.quiet)toast(placed?`${o.name} is showing on ${displayFor(o).label}.`:`${o.name} output window open. Keep this control window visible while running the show.`);
}

/* ---------- desktop app: projectors are screens ---------- */
const DESK=window.cuelightDesktop||null;let displays=[];
async function refreshDisplays(){if(!DESK)return displays;try{displays=await DESK.displays();}catch(e){displays=[];}return displays;}
function displayFor(o){const s=o&&o.screen;if(!s)return null;return displays.find(d=>d.id===s.id)||displays.find(d=>d.label===s.label&&d.width===s.w&&d.height===s.h)||null;}
function usedBy(d){return show.outputs.find(o=>displayFor(o)===d)||null;}
function screenField(o){const cur=displayFor(o);
  const opts=displays.filter(d=>!d.control||d===cur).map(d=>{const u=usedBy(d);return`<option value="${d.id}" ${d===cur?"selected":""}>${esc(d.label)} · ${d.width}×${d.height}${u&&u!==o?` (used by ${esc(u.name)})`:""}</option>`}).join("");
  const missing=o.screen&&!cur?`<option value="" selected>${esc(o.screen.label)} (not connected)</option>`:"";
  return`<div class="field"><label for="scr-sel">Screen</label><div class="inline"><select id="scr-sel">${missing}<option value="" ${!o.screen?"selected":""}>None — open as a window</option>${opts}</select>${cur?`<button class="btn ghost" data-act="scr-id" data-id="${cur.id}" title="Flash this projector's name on its screen">Identify</button>`:""}</div></div>`;}
async function setScreen(o,d){
  try{outWins[o.id]?.close();}catch(e){}delete outWins[o.id];
  if(!d){delete o.screen;await DESK.assign(o.id,null);save();renderPanel();toast(`${o.name} no longer has a screen. Use Open output window to show it anywhere.`);return;}
  const other=usedBy(d);if(other&&other!==o){delete other.screen;try{outWins[other.id]?.close();}catch(e){}delete outWins[other.id];await DESK.assign(other.id,null);}
  o.screen={id:d.id,label:d.label,w:d.width,h:d.height};const resChanged=o.res[0]!==d.width||o.res[1]!==d.height;o.res=[d.width,d.height];
  ensureOutputs();showStage();renderTabs();save();await DESK.assign(o.id,d.id);openOutput(o.id,{quiet:true});renderPanel();
  toast(`${o.name} is showing on ${d.label}${resChanged?` and now matches its ${d.width}×${d.height} resolution`:""}.${other&&other!==o?` ${other.name} was moved off that screen.`:""}`);}
function uniqueName(n){let k=n,i=2;while(show.outputs.some(o=>o.name===k))k=`${n} ${i++}`;return k;}
async function addProjectorOn(d){closeScreenPicker();
  const o={id:uid(),name:uniqueName(d.label),res:[d.width,d.height],screen:{id:d.id,label:d.label,w:d.width,h:d.height}};
  show.outputs.push(o);ensureOutputs();rt.mode="map";setOut(o.id);
  // Start with one surface covering the whole picture, so the projector lights up straight away and you only drag its corners onto the set.
  const sf=newSurface(o.name+" surface");sf.pts=[[0.04,0.04,0],[0.96,0.04,0],[0.96,0.96,0],[0.04,0.96,0]];selectItem("surface",sf);geomV++;
  rt.testPattern=true;syncTP();renderTabs();renderPanel();save();
  await DESK.assign(o.id,d.id);openOutput(o.id,{quiet:true});
  toast(`${o.name} is set up at ${d.width}×${d.height} and filling that projector with a test grid. Drag the surface's corners until the grid sits on your set piece.`);}
let scrPoll=0,scrState={canFix:false,mirrored:null},scrFixing=false,scrHadNone=false;
async function openScreenPicker(){let m=$("#scrModal");
  if(!m){m=document.createElement("div");m.className="modal-bg";m.id="scrModal";m.innerHTML=`<div class="modal scrmodal" role="dialog" aria-modal="true" aria-labelledby="scrTitle"><div class="wz-head"><h2 id="scrTitle">Connect a projector</h2><button class="btn ghost" data-act="scr-close" aria-label="Close">✕</button></div><div id="scrBody" aria-live="polite"></div></div>`;document.body.appendChild(m);}
  m.hidden=false;scrHadNone=false;scrFixing=false;$("#scrBody").__h=null;await renderScreenPicker();
  clearInterval(scrPoll);scrPoll=setInterval(()=>{if($("#scrModal").hidden){clearInterval(scrPoll);return;}renderScreenPicker();},2000);}
function closeScreenPicker(){const m=$("#scrModal");if(m)m.hidden=true;clearInterval(scrPoll);}
async function fixMirroring(){if(scrFixing)return;scrFixing=true;renderScreenPicker(true);
  const r=await DESK.extend().catch(()=>({ok:false}));
  setTimeout(()=>{scrFixing=false;renderScreenPicker();if(!r.ok)toast("Cuelight couldn't change the screen setup by itself. Use Open display settings and choose Extend.");},2500);}
async function renderScreenPicker(quick){const m=$("#scrModal");if(!m||m.hidden)return;
  if(!quick){await refreshDisplays();try{scrState=await DESK.screenState();}catch(e){scrState={canFix:false,mirrored:null};}}
  const free=displays.filter(d=>!d.control&&!usedBy(d)),taken=displays.filter(d=>!d.control&&usedBy(d)),me=displays.find(d=>d.control);
  const mac=navigator.platform.startsWith("Mac"),port=mac?"Mac":"computer";
  const card=d=>`<div class="scr-card"><button class="scr-main" data-act="scr-pick" data-id="${d.id}"><b>${esc(d.label)}</b><span>${d.width} × ${d.height}${d.internal?" · built-in":""}</span><em>Use this one →</em></button><button class="btn ghost" data-act="scr-id" data-id="${d.id}" title="Flash its name on that screen">Identify</button></div>`;
  const fixBtn=(label,primary)=>scrState.canFix?`<button class="btn ${primary?"primary":""}" data-act="scr-fix" ${scrFixing?"disabled":""}>${scrFixing?"Switching…":label}</button>`:`<button class="btn ${primary?"primary":""}" data-act="scr-settings">Open display settings</button>`;
  let h="";
  if(free.length){
    h+=`<div class="scr-found"><span class="scr-dot ok"></span><b>${scrHadNone?"Found it!":free.length===1?"Projector found":"Projectors found"}</b></div>
      <p class="note" style="margin-top:0">Pick the one to add. Cuelight names it, matches its resolution and fills it with a test grid, ready for you to fit onto your set.</p>
      <div class="scr-list">${free.map(card).join("")}</div>`;
  }else{
    scrHadNone=true;
    if(scrState.mirrored){
      h+=`<div class="scr-callout"><b>Your projector is showing a copy of this screen.</b><p class="note">It needs to be its own screen so Cuelight can send it a different picture.</p>${fixBtn("Make it a separate screen",true)}</div>`;
    }else{
      h+=`<div class="scr-found"><span class="scr-dot"></span><b>Looking for your projector…</b></div>
      <ol class="scr-steps">
        <li><b>Plug it in.</b> Connect the projector to this ${port} with an HDMI cable${mac?" (use a USB-C to HDMI adapter if your Mac has no HDMI port)":""}.</li>
        <li><b>Turn it on</b> and set the projector's input or source to that HDMI port.</li>
        <li><b>That's it.</b> This window updates by itself the moment the projector appears.</li>
      </ol>
      <p class="note scr-mirror">Projector showing a copy of your screen instead? ${fixBtn("Make it a separate screen",false)}</p>
      <details class="scr-help"><summary>Still not showing up?</summary><ul>
        <li>Wake the projector: some go to standby and stop sending a signal.</li>
        <li>Try another cable, adapter or port. Cheap adapters are the most common problem.</li>
        <li>Turn the projector on <i>before</i> plugging it in, then unplug and plug it back in.</li>
        ${me&&!me.internal&&displays.length===1?`<li>Cuelight is running on the only screen it can see. ${mac?"Open your MacBook's lid":"Connect your laptop's screen"} so the projector is a second screen.</li>`:""}
      </ul></details>`;
    }
  }
  if(taken.length)h+=`<p class="note">Already in use: ${taken.map(d=>`${esc(d.label)} (${esc(usedBy(d).name)})`).join(", ")}.</p>`;
  h+=`<div class="btns" style="justify-content:space-between"><button class="btn ghost" data-act="scr-plain">Add without a screen</button><button class="btn" data-act="scr-close">Cancel</button></div>`;
  const body=$("#scrBody");if(body.__h!==h){body.__h=h;const det=body.querySelector("details")?.open;body.innerHTML=h;if(det){const d=body.querySelector("details");if(d)d.open=true;}}}
// Reopen outputs whose projector is connected; close ones whose screen went away so they never land on the control screen.
async function syncScreens(auto){if(!DESK)return;await refreshDisplays();const opened=[],lost=[];
  for(const o of show.outputs){const d=displayFor(o),open=outWins[o.id]&&!outWins[o.id].closed;
    if(d){if(o.screen.id!==d.id)o.screen.id=d.id;await DESK.assign(o.id,d.id);if(!open&&auto){openOutput(o.id,{quiet:true});opened.push(o.name===d.label?o.name:`${o.name} → ${d.label}`);}}
    else{await DESK.assign(o.id,null);if(o.screen&&open){try{outWins[o.id].close();}catch(e){}delete outWins[o.id];lost.push(o.name);}}}
  if(lost.length)toast(`${lost.join(", ")} lost ${lost.length===1?"its":"their"} screen, so ${lost.length===1?"its output is":"their outputs are"} closed. ${lost.length===1?"It reopens":"They reopen"} when the projector is back.`);
  else if(opened.length)toast(`Projectors on: ${opened.join(", ")}.`);
  renderScreenPicker();if(rt.mode==="map")renderPanel();}
if(DESK)window.addEventListener("beforeunload",()=>closeAllOutputs());
if(DESK)DESK.onDisplaysChanged(()=>{clearTimeout(window.__scrT);window.__scrT=setTimeout(()=>syncScreens(true),600);});

/* ---------- toast + boot ---------- */
let toastT=0,toastFn=null;
function toast(msg,action){
  const t=$("#toast");toastFn=action?action.fn:null;
  t.innerHTML=esc(msg)+(action?` <button class="toast-btn" data-act="toast-act">${esc(action.label)}</button>`:"");
  t.hidden=false;clearTimeout(toastT);toastT=setTimeout(()=>{t.hidden=true;toastFn=null;},action?7000:4200);
}
/* ---------- rename + delete ---------- */
function objOf(kind,id){return kind==="media"?show.media.find(m=>m.id===id):kind==="output"?output(id):kind==="surface"?surf(id):kind==="mask"?show.masks.find(m=>m.id===id):kind==="group"?group(id):kind==="cue"?show.cues.find(c=>c.id===id):null;}
function startRename(kind,id){
  const o=objOf(kind,id);if(!o)return;
  let anchor=document.querySelector(`[data-rn="${kind}:${id}"]`);
  if(!anchor){if(kind==="cue"&&rt.mode!=="cues"){rt.mode="cues";renderBin();}
    else if((kind==="surface"||kind==="mask")&&rt.mode!=="map"){rt.mode="map";renderBin();}
    if((kind==="surface"||kind==="mask")&&o.outputId!==rt.out)setOut(o.outputId);
    renderPanel();anchor=document.querySelector(`[data-rn="${kind}:${id}"]`);}
  if(!anchor)return;
  anchor.scrollIntoView({block:"nearest"});
  const r=anchor.getBoundingClientRect();
  const inp=document.createElement("input");inp.type="text";inp.className="rn-input";inp.value=o.name;inp.setAttribute("aria-label",`Rename ${KIND_LABEL[kind]}`);
  inp.style.left=Math.max(4,r.left-6)+"px";inp.style.top=(r.top+r.height/2)+"px";inp.style.width=Math.max(r.width+40,180)+"px";
  document.body.appendChild(inp);inp.focus();inp.select();
  let done=false;
  const fin=ok=>{if(done)return;done=true;const v=inp.value.trim();inp.remove();
    if(ok&&v&&v!==o.name){o.name=v;save();toast(`Renamed to “${v}”.`);}
    renderTabs();renderPanel();if(kind==="media")renderBin();};
  inp.addEventListener("keydown",e=>{e.stopPropagation();if(e.key==="Enter"){e.preventDefault();fin(true);}else if(e.key==="Escape"){e.preventDefault();fin(false);}});
  inp.addEventListener("blur",()=>fin(true));
}
let confirmFn=null;
function askConfirm(title,text,yesLabel,fn){
  confirmFn=fn;$("#cfTitle").textContent=title;$("#cfText").textContent=text;$("#cfYes").textContent=yesLabel;$("#confirm").hidden=false;$("#cfNo").focus();
}
function closeConfirm(){$("#confirm").hidden=true;confirmFn=null;}
function deleteItem(kind,id){
  const o=objOf(kind,id);if(!o)return;const name=o.name;
  const done=()=>{save();renderTabs();renderPanel();toast(`Deleted ${KIND_LABEL[kind]} “${name}”.`,{label:"Undo",fn:undo});};
  if(kind==="output"){
    if(show.outputs.length<2){toast("A show needs at least one projector. Add another before deleting this one.");return;}
    const ss=show.surfaces.filter(s=>s.outputId===id),ms=show.masks.filter(m=>m.outputId===id);
    const go=()=>{
      ss.forEach(s=>removeSurfaceRefs(s.id));
      show.surfaces=show.surfaces.filter(s=>s.outputId!==id);show.masks=show.masks.filter(m=>m.outputId!==id);
      show.outputs=show.outputs.filter(x=>x.id!==id);
      show.cues.forEach(c=>{if(c.assign)c.assign=c.assign.filter(r=>r.target!=="o:"+id);});
      try{outWins[id]?.close()}catch(err){}delete outWins[id];
      ensureRT();ensureOutputs();if(rt.out===id){rt.out=null;setOut(show.outputs[0].id);}done();
    };
    if(ss.length||ms.length){
      const parts=[ss.length?`${ss.length} surface${ss.length===1?"":"s"}`:"",ms.length?`${ms.length} mask${ms.length===1?"":"s"}`:""].filter(Boolean).join(" and ");
      askConfirm(`Delete projector “${name}”?`,`Its ${parts} will be deleted too, and cue rows that point at them will be removed. You can undo this with ⌘Z / Ctrl+Z.`,"Delete projector",go);
    }else go();
    return;
  }
  if(kind==="media"){show.media=show.media.filter(x=>x.id!==id);
    for(const sid in rt.surf)rt.surf[sid].players=rt.surf[sid].players.filter(p=>p.mediaId!==id);
    show.surfaces.forEach(s=>{if(s.look===id)s.look=null;});
    show.cues.forEach(c=>{if(c.assign)c.assign=c.assign.filter(r=>r.mediaId!==id);});
    if(show.timeline)show.timeline.clips=show.timeline.clips.filter(c=>c.mediaId!==id);
    if(rt.selMedia===id)rt.selMedia=null;
    save();renderBin();renderTabs();renderPanel();toast(`Deleted “${name}” from the library and any cues that used it.`,{label:"Undo",fn:undo});return;}
  if(kind==="surface"){show.surfaces=show.surfaces.filter(s=>s.id!==id);removeSurfaceRefs(id);ensureRT();}
  else if(kind==="mask")show.masks=show.masks.filter(m=>m.id!==id);
  else if(kind==="group"){show.groups=show.groups.filter(g=>g.id!==id);show.cues.forEach(c=>{if(c.assign)c.assign=c.assign.filter(r=>r.target!=="g:"+id);});}
  else if(kind==="cue"){const i=show.cues.findIndex(c=>c.id===id);show.cues.splice(i,1);show.cues.forEach(d=>{if(d.trigger?.cue===id)d.trigger={type:"go"};});if(i<rt.playhead)rt.playhead--;rt.playhead=Math.min(rt.playhead,show.cues.length);}
  if(rt.sel?.id===id){rt.sel=null;rt.selPt=-1;}
  done();
}
function migrate(s){
  s.masks=s.masks||[];s.media=s.media||[];s.groups=s.groups||[];
  if(!Array.isArray(s.outputs)||!s.outputs.length)s.outputs=[{id:uid(),name:"Projector 1",res:s.res||[1920,1080]}];
  const o0=s.outputs[0].id,has=id=>s.outputs.some(o=>o.id===id);
  for(const x of s.surfaces){if(!has(x.outputId))x.outputId=o0;x.warp=x.warp||"corner";if(x.shape===undefined)x.shape=null;if(x.grid===undefined)x.grid=null;x.pts=x.pts.map(p=>[p[0],p[1],p[2]||0]);}
  for(const m of s.masks){if(!has(m.outputId))m.outputId=o0;m.pts=m.pts.map(p=>[p[0],p[1],p[2]||0]);}
  s.cues.forEach((c,i)=>{if(c.cont&&c.cont!=="none"){const nx=s.cues[i+1];if(nx&&!nx.trigger)nx.trigger={type:c.cont==="ac"?"with":"after",cue:c.id};}c.cont="none";if(!c.trigger)c.trigger={type:"go"};});
  for(const c of s.cues){if(c.assign)c.assign=c.assign.map(a=>a.target?a:{target:a.surfaceId,mediaId:a.mediaId??null,level:a.level??1});}
  const outs=new Set(s.outputs.map(o=>o.id));
  for(const oid of outs){const ss=s.surfaces.filter(x=>x.outputId===oid),ms=s.masks.filter(x=>x.outputId===oid);
    if([...ss,...ms].some(x=>x.z===undefined)){ss.forEach((x,i)=>x.z=i);ms.forEach((x,i)=>x.z=ss.length+i);}}
  delete s.res;s.v=3;return s;
}
function relTime(t){const d=(Date.now()-t)/1000;if(d<45)return"just now";if(d<3600)return Math.round(d/60)+" min ago";if(d<86400)return Math.round(d/3600)+" h ago";if(d<86400*7)return Math.round(d/86400)+" days ago";return new Date(t).toLocaleDateString();}
function closeAllOutputs(){let n=0;for(const id in outWins){try{if(!outWins[id].closed){outWins[id].close();n++;}}catch(e){}delete outWins[id];}return n;}
function openProject(id,msg){
  if(hist.pending)commit();
  const sh=readProject(id);if(!sh){toast("That project couldn't be read from this browser.");return;}
  const n=closeAllOutputs();
  proj.idx.current=id;saveIdx();hist.undo=[];hist.redo=[];hist.last=null;rt.views={};rt.preview=null;rt.cedit=null;tl.playing=false;tl.t=0;tl.previewOnly=false;rt.tsel=null;rt.outSrc="cues";
  loadShow(sh);proj.thumbAt=0;closeProjects();renderProjects();
  toast((msg||`Opened “${sh.name||"Untitled show"}”.`)+(n?" Reopen the output windows for this project's projectors.":""));
}
function createProject(sh,msg){if(hist.pending)commit();const e=newProjectRecord(sh);openProject(e.id,msg||`Created “${e.name}”.`);}
function uniqueName(base){const names=new Set(proj.idx.list.map(p=>p.name));if(!names.has(base))return base;let i=2;while(names.has(`${base} ${i}`))i++;return`${base} ${i}`;}
function renderProjects(){
  const box=$("#projList");if(!box)return;
  const list=[...proj.idx.list].sort((a,b)=>b.updated-a.updated);
  box.innerHTML=list.map(p=>{const cur=p.id===proj.idx.current,st=p.stats||{};
    return`<li class="pj${cur?" cur":""}"><div class="pj-th" style="${p.thumb?`background-image:url(${p.thumb})`:""}"></div>
      <div class="pj-info"><b data-pjname="${p.id}">${esc(p.name)}</b>${cur?`<span class="tag">open</span>`:""}
        <span class="pj-meta">Edited ${relTime(p.updated)} · ${st.outs||1} projector${st.outs===1?"":"s"} · ${st.surfs||0} surface${st.surfs===1?"":"s"} · ${st.cues||0} cue${st.cues===1?"":"s"}${st.media?` · ${st.media} media file${st.media===1?"":"s"}`:""}</span></div>
      <div class="pj-acts">${cur?`<button class="btn" data-act="pj-close">Keep working</button>`:`<button class="btn primary" data-act="pj-open" data-id="${p.id}">Open</button>`}
        <button class="ib" data-act="pj-rename" data-id="${p.id}" title="Rename" aria-label="Rename ${esc(p.name)}">${ICON_EDIT}</button>
        <button class="ib" data-act="pj-dup" data-id="${p.id}" title="Duplicate" aria-label="Duplicate ${esc(p.name)}">⧉</button>
        <button class="ib" data-act="pj-export" data-id="${p.id}" title="Export" aria-label="Export ${esc(p.name)}">⤓</button>
        <button class="ib danger" data-act="pj-del" data-id="${p.id}" title="Delete" aria-label="Delete ${esc(p.name)}">${ICON_DEL}</button></div></li>`;}).join("");
  const n=$("#projName");if(n)n.textContent=show?.name||"Untitled show";
}
function openProjects(){if(hist.pending)commit();renderProjects();$("#projModal").hidden=false;}
function closeProjects(){$("#projModal").hidden=true;}
function exportProject(id){
  const json=id===proj.idx.current?JSON.stringify(show,null,1):JSON.stringify(readProject(id),null,1);const e=projEntry(id);
  const fname=(e?.name||"show").replace(/[\\/:*?"<>|]+/g,"-")+".cuelight.json",done=`Exported “${e?.name}”. Media files aren't inside it; bring them separately.`;
  const asText=msg=>{$("#showJson").value=json;$("#modalTitle").textContent=`Export “${e?.name||"show"}”`;$("#modal").hidden=false;if(msg)toast(msg);};
  if(window.top===window){try{const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([json],{type:"application/json"}));a.download=fname;document.body.appendChild(a);a.click();a.remove();toast(done);return;}catch(err){}asText();return;}
  const cl=window.claude;if(!cl?.use){asText("Copy this text to move the project, or use the standalone file to export a file.");return;}
  cl.use("downloads").then(dl=>{if(!dl){asText("Saving files isn't available here. Copy this text instead.");return;}
    dl.save({filename:fname,data:new Blob([json],{type:"application/json"})}).then(()=>toast(done),err=>{if(err?.code==="declined")return;if(err?.code==="rate_limited"){toast("A save is already waiting for your answer.");return;}asText("Saving files isn't available here. Copy this text instead.");});
  },()=>asText());
}
function importText(txt,fallbackName){
  let sh;try{sh=JSON.parse(txt);}catch(e){sh=null;}
  if(!sh||!Array.isArray(sh.surfaces)||!Array.isArray(sh.cues)){toast("That isn't a Cuelight project. Choose a .cuelight file or paste the whole show text, starting with {.");return false;}
  sh.name=uniqueName(sh.name||fallbackName||"Imported show");createProject(sh,`Imported “${sh.name}”. Re-add its videos and images from the media library if they show as missing.`);return true;
}
function loadShow(s){
  rt.active=[];[...rt.audio].forEach(killAudio);rt.tweens=[];rt.surf={};rt.drawing=null;
  show=migrate(s);geomV++;
  ensureRT();ensureOutputs();rt.out=show.outputs[0].id;rt.playhead=0;rt.sel=null;rt.selPt=-1;rt.selMedia=null;rt.testPattern=true;
  const first=onOut(show.surfaces)[0];if(first)selectItem("surface",first);
  $("#showName").value=show.name||"";showStage();renderTabs();syncTP();save();renderBin();renderPanel();
  if(typeof restoreFiles==="function"&&IDB_READY)restoreFiles().then(()=>updateStorageNote());
  if(DESK&&IDB_READY){closeAllOutputs();syncScreens(true);}
}
let IDB_READY=false;
let lastUI=0,scrubbing=false,scrubT=0;
function updateScrub(){
  const sc=$("#vScrub");if(!sc||rt.sel?.kind!=="surface")return;const v=surfVideo(rt.sel.id);if(!v)return;
  if(!scrubbing&&document.activeElement!==sc)sc.value=v.currentTime;
  const pos=$("#vPos");if(pos){const d=mediaRT[v._mid]?.dur||v.duration||0;pos.textContent=`${Math.floor(v.currentTime/60)}:${(v.currentTime%60).toFixed(1).padStart(4,"0")} / ${fmtDur(d)}`;}
}
function frame(){
  const n=now();rt.frame++;stepTweens(n);stepCues(n);applyAudioLevels();draw(n);composeRoom(n);manageVideos();drawOverlay();
  if(rt.frame%2===0)drawThumbs();
  updateTL();
  if(n-lastUI>90){lastUI=n;updateRunning(n);updateScrub();}
  requestAnimationFrame(frame);
}
$("#addTools").innerHTML=menuHTML("surf")+menuHTML("mask");
loadShow(loadStored());hist.undo=[];hist.redo=[];
if(!gl)toast("This browser couldn't start WebGL, so the stage can't render.");
syncLiveBtn();IDB_READY=true;if(DESK)syncScreens(true);restoreFiles().then(left=>{if(left)toast(`${left} file${left===1?"":"s"} couldn't be found in this browser. They're marked “Missing” in the library; re-add them from there.`);pruneFiles();updateStorageNote();});
requestAnimationFrame(frame);
})();
