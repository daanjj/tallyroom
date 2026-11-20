/* Tally Room core: pure functions only. No DOM, no network, no global state.
   Loaded in the page as a classic script (window.TRCore) and by the tests with require(). */
(function(root){
"use strict";

/* ============ small helpers ============ */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
/* a number from a file or form; the fallback only when there is none (0 is a real value) */
function num(v,d){ return (v==null || String(v).trim()==="" || !Number.isFinite(+v)) ? d : +v; }
function fmt(x,d=1){ return Number.isFinite(x)? x.toFixed(d).replace(/\.0$/,"") : "–"; }
/* Every content text (header, question text, option and scale labels, prompts) is read through tx().
   Today it returns the string; multi-language sets (backlog E1) only have to change this helper. */
function tx(v){ if(v==null) return ""; if(typeof v==="object"){ const f=Object.values(v)[0]; return f==null?"":String(f); } return String(v); }
function slug(s){ return String(s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,40) || "set"; }
function stamp(now){ const d=new Date(now), p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }

/* ============ questions ============ */
const TL_LABELS=["Consent","Zorg","Bezwaar"], TL_COLORS=["#2E9E5B","#F2B705","#D64541"];
const TL_Q_YELLOW="Welke zorg heb je en wat stel je voor om te doen?", TL_Q_RED="Welk bezwaar heb je en wat is je voorstel om dat bezwaar te adresseren?";
function normOptions(x){ if(!x) return []; if(typeof x==="string") x=x.split(/\r?\n/); if(!Array.isArray(x)) x=Object.values(x); return x.map(o=>String((o&&typeof o==="object")?(o.label??o.text??""):o??"").trim()).filter(Boolean).slice(0,11); }
const newQid = () => "q"+Math.random().toString(36).slice(2,8);
const isTraffic = qu => !!qu && qu.kind==="traffic";
const isOpt = qu => !!qu && (qu.kind==="options"||qu.kind==="traffic") && Array.isArray(qu.options) && qu.options.length>=2;
const optLabel = (qu,v) => isOpt(qu) ? tx(qu.options[v-1] ?? String(v)) : String(v);
function q(text,min,max,lo,hi,options,traffic){ const id=newQid(); const o=normOptions(options);
  if(traffic) return {id, text, kind:"traffic", options:(o.length===3?o:TL_LABELS.slice()), min:1, max:3, lo:"", hi:""};
  if(o.length>=2) return {id, text, kind:"options", options:o, min:1, max:o.length, lo:"", hi:""};
  return {id, text, min, max, lo, hi}; }
function exportQ(qu){ if(isTraffic(qu)) return {text:qu.text, kind:"traffic", options:[...qu.options]}; return isOpt(qu) ? {text:qu.text, options:[...qu.options]} : {text:qu.text,min:qu.min,max:qu.max,lo:qu.lo,hi:qu.hi}; }
const followUp = (cfg,v) => v===2 ? ((cfg&&cfg.tlYellow)||TL_Q_YELLOW) : v===3 ? ((cfg&&cfg.tlRed)||TL_Q_RED) : "";

const DEFAULT_SESSION = { phase:"lobby", current:0, revealed:[], round:1, showLive:false, resetAt:0 };
function emptyConfig(){ return { mode:"batch", tlYellow:"", tlRed:"", questions:[] }; } // "live" = one question at a time, "batch" = answer all first
/* Firebase turns arrays into objects when they have gaps and drops empty ones, so always normalise what comes back */
function normConfig(v){ if(!v || typeof v!=="object") return emptyConfig();
  let qs=v.questions; if(qs && !Array.isArray(qs)) qs=Object.values(qs); if(!Array.isArray(qs)) qs=[];
  qs=qs.filter(Boolean); qs.forEach(qu=>{ if(qu.options && !Array.isArray(qu.options)) qu.options=Object.values(qu.options); });
  return {...v, mode:v.mode==="live"?"live":"batch", tlYellow:v.tlYellow||"", tlRed:v.tlRed||"", questions:qs}; }
function normSession(v){ if(v && v.revealed && !Array.isArray(v.revealed)) v.revealed=Object.values(v.revealed); if(v && !v.revealed) v.revealed=[]; return v; }

/* ============ votes and statistics ============ */
const PRESENCE_MS = 150000; // a participant without answers counts as present for 2.5 min after their last heartbeat
function hasAnswers(v){ return !!(v && v.answers && Object.keys(v.answers).length); }
function validAns(v,qu){ const a=v&&v.answers?v.answers[qu.id]:undefined; if(!Number.isFinite(a)) return null;
  if(isTraffic(qu) && a!==1 && !String(v.texts?.[qu.id]||"").trim()) return null; return a; } // yellow/red only count once the follow-up is filled in
function roundVotes(votes, round, now, skipPid){ const out={};
  for(const [pid,v] of Object.entries(votes||{})){ if(!v || v.round!==round) continue;
    if(!hasAnswers(v)){ if(pid===skipPid) continue; if(!v.t || now-v.t>PRESENCE_MS) continue; }
    out[pid]=v; }
  return out; }
function stats(vals,min,max){
  const n=vals.length; if(!n) return {n:0};
  const mean=vals.reduce((a,b)=>a+b,0)/n;
  const sorted=[...vals].sort((a,b)=>a-b);
  const median = n%2 ? sorted[(n-1)/2] : (sorted[n/2-1]+sorted[n/2])/2;
  const sd=Math.sqrt(vals.reduce((a,b)=>a+(b-mean)**2,0)/n);
  const counts={}; for(let v=min;v<=max;v++) counts[v]=0; vals.forEach(v=>{ if(counts[v]!=null) counts[v]++; });
  let mode=min, best=-1; for(let v=min;v<=max;v++){ if(counts[v]>best){best=counts[v];mode=v;} }
  return {n,mean,median,sd,counts,mode};
}

/* ============ CSV ============ */
function parseCSV(text){
  text=String(text||"").replace(/^﻿/,""); const first=text.split(/\r?\n/)[0]||"";
  const d=(first.split(";").length>first.split(",").length)?";":(first.split("\t").length>first.split(",").length?"\t":",");
  const rows=[]; let row=[], f="", inq=false;
  for(let i=0;i<text.length;i++){ const c=text[i];
    if(inq){ if(c==='"'){ if(text[i+1]==='"'){ f+='"'; i++; } else inq=false; } else f+=c; }
    else if(c==='"') inq=true; else if(c===d){ row.push(f); f=""; }
    else if(c==="\n"||c==="\r"){ if(c==="\r"&&text[i+1]==="\n") i++; row.push(f); f=""; rows.push(row); row=[]; }
    else f+=c; }
  if(f!==""||row.length){ row.push(f); rows.push(row); }
  return rows.filter(r=>r.some(x=>String(x).trim()));
}
function csvToQuestions(text){
  const rows=parseCSV(text); if(!rows.length) return [];
  const names=["text","type","options","min","max","lo","hi"], h=rows[0].map(x=>String(x).trim().toLowerCase());
  const hasHead=h.includes("text")||h.includes("statement")||h.includes("question");
  const col={}; if(hasHead) h.forEach((n,i)=>{ const k=(n==="statement"||n==="question")?"text":n; if(names.includes(k)&&!(k in col)) col[k]=i; }); else col.text=0;
  const body=hasHead?rows.slice(1):rows, get=(r,k)=>col[k]==null?"":String(r[col[k]]??"").trim();
  return body.map(r=>{ const text=get(r,"text"); if(!text) return null; const type=get(r,"type").toLowerCase(), opts=get(r,"options").split("|");
    if(type==="traffic") return q(text,1,3,"","",null,true);
    if(type==="options"||(type===""&&get(r,"options"))) return q(text,1,5,"","",opts);
    return q(text,clamp(Math.round(num(get(r,"min"),1)),0,10),clamp(Math.round(num(get(r,"max"),5)),2,11),get(r,"lo")||"Strongly disagree",get(r,"hi")||"Strongly agree"); }).filter(Boolean);
}

/* ============ question sets ============ */
const DAY=864e5, DEFAULT_EXPIRY_DAYS=3, DEFAULT_ACCENT="#5A3BD6";
const CATEGORIES=["generic","consent","dilemma"], NAMED=["no","yes","random"];
const SET_ID_RE=/^[A-Za-z0-9_-]{1,40}$/;
function newSetId(rnd){ rnd=rnd||Math.random; const a="abcdefghijklmnopqrstuvwxyz0123456789"; let s=""; for(let i=0;i<8;i++) s+=a[Math.min(35,Math.floor(rnd()*36))]; return s; }
function normHex(v){ let s=String(v||"").trim(); if(/^#?[0-9a-fA-F]{3}$/.test(s)){ s=s.replace("#",""); s="#"+s[0]+s[0]+s[1]+s[1]+s[2]+s[2]; } if(/^[0-9a-fA-F]{6}$/.test(s)) s="#"+s; return /^#[0-9a-fA-F]{6}$/.test(s) ? s.toUpperCase() : null; }
/* the record at sets/{id}: always complete, never undefined (Firebase refuses undefined) */
function normMeta(m){ if(!m || typeof m!=="object") return null;
  const name=String(m.name||"").trim()||"Untitled";
  return { name, header:String(m.header||"").trim().slice(0,80)||name, accent:normHex(m.accent)||DEFAULT_ACCENT,
    category:CATEGORIES.includes(m.category)?m.category:"generic", named:NAMED.includes(m.named)?m.named:"no",
    expiresAt:Number.isFinite(m.expiresAt)?m.expiresAt:null, joinUrl:String(m.joinUrl||"").trim(),
    createdAt:Number.isFinite(m.createdAt)?m.createdAt:0, updatedAt:Number.isFinite(m.updatedAt)?m.updatedAt:(Number.isFinite(m.createdAt)?m.createdAt:0) }; }
function newMeta(fields, now){ const f=fields||{};
  return normMeta({...f, name:f.name, expiresAt:Number.isFinite(f.expiresAt)?f.expiresAt:now+DEFAULT_EXPIRY_DAYS*DAY, createdAt:now, updatedAt:now}); }
function isExpired(meta, now){ return !!(meta && Number.isFinite(meta.expiresAt) && now>meta.expiresAt); }
/* state: "none" (no expiry set), "ok", "soon" (within 24 hours) or "expired"; hours = whole hours left, rounded up */
function expiryInfo(meta, now){ const at=meta&&Number.isFinite(meta.expiresAt)?meta.expiresAt:null;
  if(at==null) return {state:"none", at:null, hours:null};
  if(now>at) return {state:"expired", at, hours:0};
  const hours=Math.max(1,Math.ceil((at-now)/36e5));
  return {state:(at-now)<=DAY?"soon":"ok", at, hours}; }
function extendedExpiry(now, days){ return now+(days==null?DEFAULT_EXPIRY_DAYS:days)*DAY; }
/* overview order: active sets first, most recently updated on top; expired sets below */
function sortSets(sets, now){ return Object.entries(sets||{}).map(([id,m])=>({id, meta:normMeta(m)})).filter(x=>x.meta)
  .sort((a,b)=>(isExpired(a.meta,now)-isExpired(b.meta,now)) || (b.meta.updatedAt-a.meta.updatedAt) || a.meta.name.localeCompare(b.meta.name)); }
function pollStats(poll){ const cfg=normConfig(poll&&poll.config), ses=(poll&&poll.session)||{}, round=ses.round||1;
  const respondents=Object.values((poll&&poll.votes)||{}).filter(v=>v && v.round===round && hasAnswers(v)).length;
  const ph=cfg.questions.length?(ses.phase||"lobby"):"lobby";
  return { questions:cfg.questions.length, respondents, phase: ph==="lobby"?"lobby":(ph==="summary"?"finished":"running") }; }
function duplicateSet(meta, cfg, now){ const m=normMeta(meta), c=normConfig(cfg);
  return { meta:{...m, name:m.name+" (copy)", joinUrl:"", expiresAt:extendedExpiry(now), createdAt:now, updatedAt:now},
    config:{ mode:c.mode, tlYellow:c.tlYellow, tlRed:c.tlRed, questions:JSON.parse(JSON.stringify(c.questions)).map(qu=>({...qu, id:newQid()})) } }; }
/* one-off: the poll that lived at polls/{pollId} before sets existed gets a record in sets/ */
function migrationMeta(pollId, cfg, now){ return newMeta({name:pollId, header:tx(cfg&&cfg.title)||pollId, category:"consent", named:"no"}, now); }

/* ---- questions file (export / "create from file") ---- */
function questionsExport(meta, cfg){ const m=normMeta(meta)||normMeta({}), c=normConfig(cfg);
  return { set:{name:m.name, header:m.header, accent:m.accent, category:m.category, named:m.named},
    followUps:{yellow:followUp(c,2), red:followUp(c,3)}, questions:c.questions.map(exportQ) }; }
function parseQuestionsFile(obj){ let arr=obj, set=null, tlYellow="", tlRed="";
  if(obj && !Array.isArray(obj) && Array.isArray(obj.questions)){ const f=obj.followUps||{};
    if(typeof f.yellow==="string") tlYellow=f.yellow.trim(); if(typeof f.red==="string") tlRed=f.red.trim();
    if(obj.set && typeof obj.set==="object") set=obj.set; else if(obj.title) set={header:String(obj.title)};
    if(obj.mode==="live"||obj.mode==="batch") set={...(set||{}), mode:obj.mode};
    arr=obj.questions; }
  if(!Array.isArray(arr)) throw new Error("No questions found");
  const questions=arr.filter(x=>x && typeof x==="object").map(x=>q(String(x.text||""),num(x.min,1),num(x.max,5),x.lo||"",x.hi||"",x.options,x.kind==="traffic"||x.traffic===true));
  return { set, tlYellow, tlRed, questions }; }

/* ---- responses export ---- */
function resultsPayload(o){ const cfg=normConfig(o.cfg), ses=o.ses||{}, round=ses.round||1, meta=normMeta(o.meta)||null;
  const rv=roundVotes(o.votes, round, o.now, null);
  const ids=Object.keys(rv).filter(k=>hasAnswers(rv[k])).sort((a,b)=>(rv[a].t||0)-(rv[b].t||0));
  const title=o.title || (meta?meta.header:"") || "Tally Room";
  return { pollId:o.setId||"", set:{id:o.setId||"", name:meta?meta.name:title, header:title, category:meta?meta.category:"generic"},
    title, mode:cfg.mode, round, exportedAt:new Date(o.now).toISOString(), respondents:ids.length,
    questions: cfg.questions.map((qu,i)=>{
      const vals=ids.map(k=>validAns(rv[k],qu)).filter(v=>Number.isFinite(v));
      const st=stats(vals,qu.min,qu.max); const num=!isOpt(qu)&&st.n;
      return { n:i+1, id:qu.id, text:qu.text, kind:isTraffic(qu)?"traffic":(isOpt(qu)?"options":"scale"),
        options:isOpt(qu)?[...qu.options]:null, min:qu.min, max:qu.max, lo:qu.lo||"", hi:qu.hi||"",
        answers:st.n||0, counts:st.counts||{}, mostChosen:st.n?optLabel(qu,st.mode):null,
        mean:num?+st.mean.toFixed(2):null, median:num?st.median:null, sd:num?+st.sd.toFixed(2):null }; }),
    answers: ids.map((k,i)=>({ respondent:"R"+String(i+1).padStart(2,"0"), at:new Date(rv[k].t||0).toISOString(),
      answers:Object.fromEntries(cfg.questions.map(qu=>[qu.id, Number.isFinite(rv[k].answers[qu.id])?rv[k].answers[qu.id]:null])),
      texts:Object.fromEntries(cfg.questions.filter(qu=>isTraffic(qu)&&[2,3].includes(rv[k].answers[qu.id])&&String(rv[k].texts?.[qu.id]||"").trim()).map(qu=>[qu.id,String(rv[k].texts[qu.id]).trim()])) })),
    followUps:{yellow:followUp(cfg,2), red:followUp(cfg,3)} };
}
function resultsCSV(p){ const qq=v=>`"${String(v==null?"":v).replace(/"/g,'""')}"`, s=p.set||{};
  const rows=[["respondent","question_nr","question","value","label","comment","set","header","category"].join(",")];
  p.answers.forEach(r=>p.questions.forEach(qu=>{ const v=r.answers[qu.id]; if(!Number.isFinite(v)) return;
    rows.push([qq(r.respondent), qu.n, qq(qu.text), v, qq(qu.options?(qu.options[v-1]||v):v), qq((r.texts&&r.texts[qu.id])||""), qq(s.name), qq(s.header), qq(s.category)].join(",")); }));
  return "﻿"+rows.join("\r\n"); }

/* ============ colour: one accent in, the whole palette out ============ */
const ACCENT_PRESETS=[["Purple","#5A3BD6"],["Blue","#1F6FD6"],["Teal","#0B7F7F"],["Green","#2E8540"],["Orange","#E8710A"],["Red","#C8372D"],["Pink","#C2338B"],["Slate","#475569"]];
/* the hand-tuned purple palette of styles.css; other accents are this palette turned to another hue */
const REF={
  light:{ bg:"#F5F3FA", surface:"#FFFFFF", "surface-2":"#EDE9F6", ink:"#1E1838", "ink-2":"#584F73", muted:"#8B849E", line:"#E2DDEE", "line-2":"#CFC8E2",
    accent:"#5A3BD6", "accent-soft":"#EAE4FB", ramp:["#E6DEFB","#D2C5F7","#BBA9F2","#A28CEB","#8A6FE3","#7256DB","#5C3FD1","#4A30B4","#3B2594","#2C1B72"] },
  dark:{ bg:"#14111F", surface:"#1E192E", "surface-2":"#282240", ink:"#F0ECF9", "ink-2":"#B8B0CF", muted:"#7E7699", line:"#2E2745", "line-2":"#3E3660",
    accent:"#A48EF3", "accent-soft":"#2A2247", ramp:["#3A2F66","#493B80","#59489A","#6A57B3","#7C69C9","#8F7CDB","#A391E8","#B8A8F2","#CCC0F8","#E0D8FC"] } };
const TINTS=["bg","surface","surface-2","ink","ink-2","muted","line","line-2"];
function hexToRgb(h){ h=normHex(h)||"#000000"; return [1,3,5].map(i=>parseInt(h.slice(i,i+2),16)/255); }
function rgbToHex(c){ return "#"+c.map(v=>Math.round(clamp(v,0,1)*255).toString(16).padStart(2,"0")).join("").toUpperCase(); }
const toLin=c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4), toGam=c=>c<=0.0031308?12.92*c:1.055*Math.pow(c,1/2.4)-0.055;
function relLum(hex){ const [r,g,b]=hexToRgb(hex).map(toLin); return 0.2126*r+0.7152*g+0.0722*b; }
function contrast(a,b){ const x=relLum(a), y=relLum(b); return (Math.max(x,y)+0.05)/(Math.min(x,y)+0.05); }
function hexToOklch(hex){ const [r,g,b]=hexToRgb(hex).map(toLin);
  const l=Math.cbrt(0.4122214708*r+0.5363325363*g+0.0514459929*b), m=Math.cbrt(0.2119034982*r+0.6806995451*g+0.1073969566*b), s=Math.cbrt(0.0883024619*r+0.2817188376*g+0.6299787005*b);
  const L=0.2104542553*l+0.7936177850*m-0.0040720468*s, A=1.9779984951*l-2.4285922050*m+0.4505937099*s, B=0.0259040371*l+0.7827717662*m-0.8086757660*s;
  return {L, C:Math.hypot(A,B), h:Math.atan2(B,A)}; }
function oklchToLinear(L,C,h){ const A=C*Math.cos(h), B=C*Math.sin(h);
  const l=Math.pow(L+0.3963377774*A+0.2158037573*B,3), m=Math.pow(L-0.1055613458*A-0.0638541728*B,3), s=Math.pow(L-0.0894841775*A-1.2914855480*B,3);
  return [4.0767416621*l-3.3077115913*m+0.2309699292*s, -1.2684380046*l+2.6097574011*m-0.3413193965*s, -0.0041960863*l-0.7034186147*m+1.7076147010*s]; }
/* colours outside sRGB are brought back by lowering the chroma, so hue and lightness stay as asked */
function oklchToHex(L,C,h){ L=clamp(L,0,1); const ok=c=>c.every(v=>v>=-0.0005&&v<=1.0005);
  let lin=oklchToLinear(L,C,h);
  if(!ok(lin)){ let lo=0, hi=C; for(let i=0;i<24;i++){ const mid=(lo+hi)/2; if(ok(oklchToLinear(L,mid,h))) lo=mid; else hi=mid; } lin=oklchToLinear(L,lo,h); }
  return rgbToHex(lin.map(v=>toGam(clamp(v,0,1)))); }
/* CSS variables (without the leading --) for one accent in light or dark mode */
function themeVars(accent, dark){ const acc=normHex(accent)||DEFAULT_ACCENT, a=hexToOklch(acc), ref=dark?REF.dark:REF.light;
  const refC=hexToOklch(REF.light.accent).C, sA=clamp(a.C/refC,0,1.3), sT=clamp(a.C/0.04,0,1); // a grey accent gives a grey page
  const turn=(hex,scale)=>{ const o=hexToOklch(hex); return oklchToHex(o.L,o.C*scale,a.h); };
  const out={}; TINTS.forEach(k=>{ out[k]=turn(ref[k],sT); });
  out["accent-soft"]=turn(ref["accent-soft"],sA);
  ref.ramp.forEach((hex,i)=>{ out["r"+(i+1)]=turn(hex,sA); });
  if(dark){ const o=hexToOklch(ref.accent); let L=o.L, c=oklchToHex(L,o.C*sA,a.h);
    while(contrast(c,out.surface)<4.5 && L<0.98){ L+=0.02; c=oklchToHex(L,o.C*sA,a.h); }
    out.accent=c; out["accent-text"]=c; }
  else { out.accent=acc; let L=a.L, c=acc;
    while(contrast(c,out.surface)<4.5 && L>0.05){ L-=0.02; c=oklchToHex(L,a.C,a.h); }
    out["accent-text"]=c; } // text in the accent colour stays readable, even for a yellow accent
  const darkInk=turn("#17122A",sT);
  /* text on the accent: white if it is readable, else the dark ink, else plain black (one of the three always reaches 4.5:1) */
  out["accent-ink"]=["#FFFFFF",darkInk,"#000000"].find(c=>contrast(c,out.accent)>=4.5) || "#000000";
  return out; }
/* stylesheet text that overrides the purple defaults; empty for the default accent, so those sets render exactly as before */
function themeCSS(accent){ const acc=normHex(accent); if(!acc || acc===DEFAULT_ACCENT) return "";
  const block=v=>Object.entries(v).map(([k,x])=>`--${k}:${x}`).join(";"), l=block(themeVars(acc,false)), d=block(themeVars(acc,true));
  return `:root{${l}}\n@media (prefers-color-scheme: dark){:root:not([data-theme="light"]){${d}}}\n:root[data-theme="dark"]{${d}}`; }

/* ============ rules for later backlog items (C1, C2, D1), kept here so they are tested from the start ============ */
/* C2: final light of a proposal. counts = {g, y, r} */
function trafficStatus(counts){ const c=counts||{}; return (c.r>0) ? "red" : (c.y>0) ? "yellow" : (c.g>0) ? "green" : "none"; }
/* C1: an answer only counts for the version of the question it was given on (version 1 when nothing is recorded) */
function answerIsCurrent(vote, qid, rev){ const r=vote&&vote.revs?vote.revs[qid]:undefined; return (Number.isFinite(r)?r:1)===(Number.isFinite(rev)?rev:1); }
function trafficCounts(votes, qu, rev){ const c={g:0,y:0,r:0}; Object.values(votes||{}).forEach(v=>{ if(!answerIsCurrent(v,qu.id,rev)) return; const a=validAns(v,qu); if(a===1) c.g++; else if(a===2) c.y++; else if(a===3) c.r++; }); return c; }
/* D1: one lowercase letter plus two digits, not yet in `taken` (a Set or array); null when all 2,600 are in use */
function randomName(taken, rnd){ rnd=rnd||Math.random; const has=n=>taken instanceof Set ? taken.has(n) : (taken||[]).includes(n);
  const make=(l,n)=>String.fromCharCode(97+l)+String(n).padStart(2,"0");
  for(let i=0;i<200;i++){ const n=make(Math.min(25,Math.floor(rnd()*26)), Math.min(99,Math.floor(rnd()*100))); if(!has(n)) return n; }
  for(let l=0;l<26;l++) for(let n=0;n<100;n++){ const x=make(l,n); if(!has(x)) return x; }
  return null; }

const api={ clamp, num, fmt, tx, slug, stamp,
  TL_LABELS, TL_COLORS, TL_Q_YELLOW, TL_Q_RED, normOptions, newQid, isTraffic, isOpt, optLabel, q, exportQ, followUp,
  DEFAULT_SESSION, emptyConfig, normConfig, normSession,
  PRESENCE_MS, hasAnswers, validAns, roundVotes, stats, parseCSV, csvToQuestions,
  DAY, DEFAULT_EXPIRY_DAYS, DEFAULT_ACCENT, CATEGORIES, NAMED, SET_ID_RE, newSetId, normHex, normMeta, newMeta, isExpired, expiryInfo, extendedExpiry,
  sortSets, pollStats, duplicateSet, migrationMeta, questionsExport, parseQuestionsFile, resultsPayload, resultsCSV,
  ACCENT_PRESETS, REF, hexToRgb, rgbToHex, relLum, contrast, hexToOklch, oklchToHex, themeVars, themeCSS,
  trafficStatus, answerIsCurrent, trafficCounts, randomName };
if(typeof module!=="undefined" && module.exports) module.exports=api; else root.TRCore=api;
})(typeof window!=="undefined" ? window : globalThis);
