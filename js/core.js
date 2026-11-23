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
function slug(s){ return String(s||"").normalize("NFKD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+/,"").slice(0,40).replace(/-+$/,"") || "set"; }
function stamp(now){ const d=new Date(now), p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`; }

/* ============ questions ============ */
const TL_LABELS=["Consent","Zorg","Bezwaar"], TL_COLORS=["#2E9E5B","#F2B705","#D64541"];
const TL_Q_YELLOW="Welke zorg heb je en wat stel je voor om te doen?", TL_Q_RED="Welk bezwaar heb je en wat is je voorstel om dat bezwaar te adresseren?";
function normOptions(x){ if(!x) return []; if(typeof x==="string") x=x.split(/\r?\n/); if(!Array.isArray(x)) x=Object.values(x); return x.map(o=>String((o&&typeof o==="object")?(o.label??o.text??""):o??"").trim()).filter(Boolean).slice(0,11); }
const newQid = () => "q"+Math.random().toString(36).slice(2,8);
const isTraffic = qu => !!qu && qu.kind==="traffic";
const isOpen = qu => !!qu && qu.kind==="open";
const isDilemma = qu => !!qu && qu.kind==="dilemma";
/* questions answered by picking one labelled option (a dilemma adds a confidence rating on top) */
const isOpt = qu => !!qu && (qu.kind==="options"||qu.kind==="traffic"||qu.kind==="dilemma") && Array.isArray(qu.options) && qu.options.length>=2;
const kindOf = qu => isTraffic(qu) ? "traffic" : isDilemma(qu) ? "dilemma" : isOpen(qu) ? "open" : (qu && qu.kind==="options") ? "options" : "scale";
const KIND_LABEL={scale:"Scale (Likert)", options:"Multiple choice", open:"Open question", traffic:"Traffic light", dilemma:"Dilemma (two options + confidence)"};
const KIND_NAME={scale:"scale", options:"multiple choice", open:"open", traffic:"traffic light", dilemma:"dilemma"};
const OPEN_MAX=500;
const DEFAULT_CONF={text:"How confident are you in your choice?", min:1, max:5, lo:"Not at all", hi:"Very"};
function normConf(c){ if(!c || typeof c!=="object") return {...DEFAULT_CONF};
  const min=clamp(Math.round(num(c.min,1)),0,10), max=clamp(Math.round(num(c.max,5)),min+1,11);
  return {text:String(c.text||"").trim()||DEFAULT_CONF.text, min, max, lo:c.lo==null?DEFAULT_CONF.lo:String(c.lo), hi:c.hi==null?DEFAULT_CONF.hi:String(c.hi)}; }
const optLabel = (qu,v) => isOpt(qu) ? tx(qu.options[v-1] ?? String(v)) : String(v);
function q(text,min,max,lo,hi,options,traffic){ const id=newQid(); const o=normOptions(options);
  if(traffic) return {id, text, kind:"traffic", options:(o.length===3?o:TL_LABELS.slice()), min:1, max:3, lo:"", hi:""};
  if(o.length>=2) return {id, text, kind:"options", options:o, min:1, max:o.length, lo:"", hi:""};
  return {id, text, min, max, lo, hi}; }
function qOpen(text,maxLen){ return {id:newQid(), text, kind:"open", maxLen:clamp(Math.round(num(maxLen,OPEN_MAX)),20,2000), min:1, max:1, lo:"", hi:""}; }
function qDilemma(text,options,conf){ const o=normOptions(options); return {id:newQid(), text, kind:"dilemma", options:o, conf:normConf(conf), min:1, max:Math.max(1,o.length), lo:"", hi:""}; }
/* an empty question of a kind, for "+ Add question" in the editor */
function qNew(kind){ return kind==="traffic" ? q("",1,3,"","",null,true) : kind==="open" ? qOpen("") : kind==="dilemma" ? qDilemma("",[])
  : kind==="options" ? {id:newQid(), text:"", kind:"options", options:[], min:1, max:1, lo:"", hi:""} : q("",1,5,"Strongly disagree","Strongly agree"); }
/* a question from a file (questions JSON, results JSON); gets a new id */
function qFromObj(x){ x=(x && typeof x==="object")?x:{}; const text=String(x.text||""), traffic=x.kind==="traffic"||x.traffic===true;
  if(x.kind==="open") return qOpen(text,x.maxLen);
  if(x.kind==="dilemma"){ const o=normOptions(x.options); return qDilemma(text, o.length>=2?o:["Option A","Option B"], x.conf); }
  const min=clamp(Math.round(num(x.min,1)),0,10), max=clamp(Math.round(num(x.max,5)),min+1,11);
  return q(text,min,max,x.lo||"",x.hi||"",x.options,traffic); }
/* the editor's draft of a question, shaped for the chosen kind; keeps what carries over */
function shapeQuestion(qu, kind){ const base={id:qu.id||newQid(), text:String(qu.text||"").trim()||"Untitled question"}, o=normOptions(qu.options);
  if(kind==="traffic") return {...base, kind, options:(o.length===3?o:TL_LABELS.slice()), min:1, max:3, lo:"", hi:"", ...(qu.rev>1?{rev:qu.rev, history:qu.history||[]}:{})}; // an edited proposal keeps its versions
  if(kind==="options") return {...base, kind, options:o, min:1, max:Math.max(1,o.length), lo:"", hi:""};
  if(kind==="open") return {...base, kind, maxLen:clamp(Math.round(num(qu.maxLen,OPEN_MAX)),20,2000), min:1, max:1, lo:"", hi:""};
  if(kind==="dilemma") return {...base, kind, options:o, conf:normConf(qu.conf), min:1, max:Math.max(1,o.length), lo:"", hi:""};
  const was=kindOf(qu)==="scale", min=clamp(Math.round(num(was?qu.min:1,1)),0,10), max=clamp(Math.round(num(was?qu.max:5,5)),min+1,11);
  return {...base, min, max, lo:was?String(qu.lo||""):"Strongly disagree", hi:was?String(qu.hi||""):"Strongly agree"}; }
/* what stops a list of questions from being saved; [] when fine */
function questionProblems(questions){ const out=[]; (questions||[]).forEach((qu,i)=>{ const k=kindOf(qu);
  const n=normOptions(qu.options).length;
  if(k==="options" && n<2) out.push(`Question ${i+1}: add at least two options.`);
  if(k==="dilemma" && n!==2) out.push(`Question ${i+1}: a dilemma has exactly two options${n>2?` (this one has ${n})`:""}.`); }); return out; } // a choice between more than two is multiple choice

/* ============ categories: which question types a set offers (backlog B1) ============ */
const BASE_KINDS=["scale","options","open"];
const CATEGORY_RULES={ generic:{kinds:BASE_KINDS, add:"scale"}, consent:{kinds:[...BASE_KINDS,"traffic"], add:"traffic"}, dilemma:{kinds:[...BASE_KINDS,"dilemma"], add:"dilemma"} };
const catRules = cat => CATEGORY_RULES[cat] || CATEGORY_RULES.generic;
const catName = cat => { const c=CATEGORY_RULES[cat]?cat:"generic"; return c.charAt(0).toUpperCase()+c.slice(1); };
function kindAllowed(cat, qu){ return catRules(cat).kinds.includes(kindOf(qu)); }
function filterForCategory(cat, questions){ const kept=[], skipped={}; (questions||[]).forEach(qu=>{ if(kindAllowed(cat,qu)) kept.push(qu); else { const k=kindOf(qu); skipped[k]=(skipped[k]||0)+1; } }); return {kept, skipped}; }
function skippedMessage(cat, skipped){ const parts=Object.entries(skipped||{}).map(([k,n])=>`${n} ${KIND_NAME[k]} ${n===1?"question":"questions"}`);
  return parts.length ? `${parts.join(" and ")} skipped: that type is not available in a ${catName(cat)} set.` : ""; }
/* questions that stop a set from changing to category `cat`: [{n, kind}] */
function categoryBlockers(cat, questions){ return (questions||[]).map((qu,i)=>({n:i+1, kind:kindOf(qu)})).filter(x=>!catRules(cat).kinds.includes(x.kind)); }
function blockerMessage(cat, blockers){ if(!blockers.length) return ""; const by={}; blockers.forEach(b=>{ (by[b.kind]=by[b.kind]||[]).push(b.n); });
  return `This set cannot become ${catName(cat)}: `+Object.entries(by).map(([k,ns])=>`question ${ns.join(", ")} ${ns.length===1?"is a":"are"} ${KIND_NAME[k]} ${ns.length===1?"question":"questions"}`).join("; ")+`. Change or remove ${blockers.length===1?"it":"them"} first.`; }

function exportQ(qu){ if(isOpen(qu)) return {text:qu.text, kind:"open", maxLen:qu.maxLen||OPEN_MAX};
  if(isDilemma(qu)) return {text:qu.text, kind:"dilemma", options:[...qu.options], conf:normConf(qu.conf)};
  if(isTraffic(qu)) return {text:qu.text, kind:"traffic", options:[...qu.options]}; return isOpt(qu) ? {text:qu.text, options:[...qu.options]} : {text:qu.text,min:qu.min,max:qu.max,lo:qu.lo,hi:qu.hi}; }
const followUp = (cfg,v) => v===2 ? ((cfg&&cfg.tlYellow)||TL_Q_YELLOW) : v===3 ? ((cfg&&cfg.tlRed)||TL_Q_RED) : "";

const DEFAULT_SESSION = { phase:"lobby", current:0, revealed:[], round:1, showLive:false, resetAt:0 };
function emptyConfig(){ return { mode:"batch", tlYellow:"", tlRed:"", questions:[] }; } // "live" = one question at a time, "batch" = answer all first
/* Firebase turns arrays into objects when they have gaps and drops empty ones, so always normalise what comes back */
/* A question from the database or from a file, made safe to draw: its numbers are numbers within the limits of the
     editor and its id is a string. The screens put these straight into the page (backlog G7). */
function tidyQuestion(qu){ if(!qu || typeof qu!=="object") return qu;
  if(qu.id!=null) qu.id=String(qu.id);
  if(qu.min!=null || qu.max!=null){ qu.min=clamp(Math.round(num(qu.min,1)),0,10); qu.max=clamp(Math.round(num(qu.max,5)),qu.min,11); }
  if(qu.maxLen!=null) qu.maxLen=clamp(Math.round(num(qu.maxLen,OPEN_MAX)),20,2000);
  if(qu.rev!=null) qu.rev=Math.max(1,Math.round(num(qu.rev,1)));
  if(qu.conf && typeof qu.conf==="object"){ const mn=clamp(Math.round(num(qu.conf.min,DEFAULT_CONF.min)),0,10); qu.conf={...qu.conf, min:mn, max:clamp(Math.round(num(qu.conf.max,DEFAULT_CONF.max)),mn+1,11)}; }
  if(qu.history){ const n=x=>Math.max(0,Math.round(num(x,0))), hs=Array.isArray(qu.history)?qu.history:Object.values(qu.history);
    qu.history=hs.filter(h=>h && typeof h==="object").map(h=>{ const c=h.counts||{}, cs=h.comments?(Array.isArray(h.comments)?h.comments:Object.values(h.comments)):[];
      return {...h, rev:Math.max(1,n(h.rev)), text:String(h.text==null?"":h.text), counts:{g:n(c.g), y:n(c.y), r:n(c.r)},
        comments:cs.filter(x=>x && typeof x==="object").map(x=>({...x, v:n(x.v), text:String(x.text==null?"":x.text), ...(x.name!=null?{name:String(x.name)}:{})}))}; }); }
  return qu; }
function normConfig(v){ if(!v || typeof v!=="object") return emptyConfig();
  let qs=v.questions; if(qs && !Array.isArray(qs)) qs=Object.values(qs); if(!Array.isArray(qs)) qs=[];
  qs=qs.filter(Boolean); qs.forEach(qu=>{ if(qu.options && !Array.isArray(qu.options)) qu.options=Object.values(qu.options);
    tidyQuestion(qu); });
  return {...v, mode:v.mode==="live"?"live":"batch", tlYellow:v.tlYellow||"", tlRed:v.tlRed||"", questions:qs}; }
function normSession(v){ if(v && v.revealed && !Array.isArray(v.revealed)) v.revealed=Object.values(v.revealed); if(v && !v.revealed) v.revealed=[]; return v; }

/* ============ named respondents (backlog D) ============ */
const isNamed = named => named==="yes" || named==="random";
function cleanName(x){ return String(x||"").replace(/\s+/g," ").trim().slice(0,30); }
/* why a typed name cannot be used; "" when it can. `taken` = names of the other devices in the set */
function nameProblem(name, taken){ const n=cleanName(name); if(n.length<2) return "Type a name of at least 2 characters.";
  const low=n.toLowerCase(); return (taken||[]).some(t=>String(t||"").toLowerCase()===low) ? "This name is already in use. Choose another." : ""; }
function otherNames(votes, myPid){ return Object.entries(votes||{}).filter(([pid,v])=>pid!==myPid && v && v.name).map(([,v])=>String(v.name)); }
/* two devices claimed the same name at the same moment: the one that claimed it last gives way (device id breaks a tie) */
function mustYieldName(votes, myPid, myName, myNameAt){ const low=String(myName||"").toLowerCase(), at=myNameAt||0; if(!low) return false;
  return Object.entries(votes||{}).some(([pid,v])=>pid!==myPid && v && String(v.name||"").toLowerCase()===low && ((v.nameAt||0)<at || ((v.nameAt||0)===at && pid<myPid))); }
/* one lowercase letter plus one digit (k1, b5), not yet in `taken` (a Set or array); null when all 260 are in use */
function randomName(taken, rnd){ rnd=rnd||Math.random; const has=n=>taken instanceof Set ? taken.has(n) : (taken||[]).includes(n);
  const make=(l,n)=>String.fromCharCode(97+l)+String(n);
  for(let i=0;i<200;i++){ const n=make(Math.min(25,Math.floor(rnd()*26)), Math.min(9,Math.floor(rnd()*10))); if(!has(n)) return n; }
  for(let l=0;l<26;l++) for(let n=0;n<10;n++){ const x=make(l,n); if(!has(x)) return x; }
  return null; }

/* ============ consent workflow (backlog C): versions of a proposal and its final light ============ */
/* an answer only counts for the version of the proposal it was given on (version 1 when nothing is recorded) */
/* the ids of the questions as a map, written next to them in the config: the database rules accept answers only for these (backlog G) */
function qidMap(cfg){ const m={}; ((cfg&&cfg.questions)||[]).forEach(qu=>{ const id=qu&&qu.id!=null?String(qu.id):""; if(/^[A-Za-z0-9_-]{1,40}$/.test(id)) m[id]=true; }); return m; }
function withQids(cfg){ return cfg && typeof cfg==="object" ? {...cfg, qids:qidMap(cfg)} : cfg; }
function answerIsCurrent(vote, qid, rev){ const r=vote&&vote.revs?vote.revs[qid]:undefined; return (Number.isFinite(r)?r:1)===(Number.isFinite(rev)?rev:1); }
function trafficCounts(votes, qu, rev){ const c={g:0,y:0,r:0}, q2={...qu, rev};
  Object.values(votes||{}).forEach(v=>{ const a=validAns(v,q2); if(a===1) c.g++; else if(a===2) c.y++; else if(a===3) c.r++; }); return c; }
/* the light of a proposal: any red = red, else any yellow = yellow, all green = green, no votes = none */
function trafficStatus(counts){ const c=counts||{}; return (c.r>0) ? "red" : (c.y>0) ? "yellow" : (c.g>0) ? "green" : "none"; }
/* yellow and red comments on the current version, oldest first; with the respondent's name in a named set */
function trafficComments(votes, qu, named, now){ return Object.values(votes||{}).filter(v=>{ const a=validAns(v,qu); return a===2||a===3; }).sort((a,b)=>(a.t||0)-(b.t||0))
  .map(v=>{ const c={v:v.answers[qu.id], text:String(v.texts[qu.id]).trim()}; if(isNamed(named)) c.name=String(v.name||"unnamed"); if(Number.isFinite(now) && isWriting(v,qu.id,now)) c.writing=true; return c; }); }
/* ---- "still writing" ----
   While a participant types a comment the page holds the text back and sends typing/{qid} = the time of typing instead,
   refreshed every few seconds. The presenter shows a placeholder until the text arrives, so no half sentences on screen.
   A flag that is not refreshed (the phone went to sleep) stops counting after TYPING_MS. */
const TYPING_MS=20000; // longer than FU_IDLE + FU_PING in app.js, so the flag outlives the pause before sending
function isWriting(v, qid, now){ const t=v&&v.typing?v.typing[qid]:undefined; return Number.isFinite(t) && now-t<TYPING_MS; }
function withoutTyping(doc, qid){ if(!doc || !doc.typing) return doc; const ty={...doc.typing}; delete ty[qid]; const out={...doc}; if(Object.keys(ty).length) out.typing=ty; else delete out.typing; return out; }
/* how many chose yellow or red on this version and have no finished comment: nothing sent yet, or typing again */
function trafficWriting(votes, qu, now){ return Object.values(votes||{}).filter(v=>{ const a=v&&v.answers?v.answers[qu.id]:undefined;
  if((a!==2 && a!==3) || !answerIsCurrent(v,qu.id,qu.rev)) return false; return !String(v.texts?.[qu.id]||"").trim() || isWriting(v,qu.id,now); }).length; }
/* milliseconds until the first typing flag runs out (0 = nobody is typing): the presenter screen redraws then */
function typingExpiry(votes, now){ let m=0; Object.values(votes||{}).forEach(v=>Object.values((v&&v.typing)||{}).forEach(t=>{ if(Number.isFinite(t) && now-t<TYPING_MS){ const left=Math.max(1,t+TYPING_MS-now); m=m?Math.min(m,left):left; } })); return m; }
/* presenter rewrote a proposal: the old text, votes and comments go to its history, the new text is the next version */
function editQuestion(qu, text, votes, named, now){ const rev=qu.rev||1;
  const entry={rev, text:qu.text, counts:trafficCounts(votes,qu,rev), comments:trafficComments(votes,qu,named), t:now};
  return {...qu, text:String(text||"").trim()||qu.text, rev:rev+1, history:[...(qu.history||[]), entry]}; }
/* clearing the answers also clears the versions: the last text stays, as version 1 */
function clearHistory(cfg){ return {...cfg, questions:(cfg.questions||[]).map(qu=>{ if(!qu.history && !qu.rev) return qu; const c={...qu}; delete c.history; delete c.rev; return c; })}; }
/* session.outcome[qid] = the light as it stood when the presenter left the proposal */
function fixOutcome(outcome, qu, votes, now){ const rev=qu.rev||1, counts=trafficCounts(votes,qu,rev);
  return {...(outcome||{}), [qu.id]:{status:trafficStatus(counts), rev, counts, t:now}}; }
/* the stored light when there is one for the current version, otherwise the light as the votes stand now */
function questionOutcome(qu, ses, votes){ const rev=qu.rev||1, o=ses&&ses.outcome?ses.outcome[qu.id]:null;
  if(o && (o.rev||1)===rev && o.status) return {status:o.status, counts:{g:0,y:0,r:0,...(o.counts||{})}, fixed:true};
  const counts=trafficCounts(votes,qu,rev); return {status:trafficStatus(counts), counts, fixed:false}; }
/* one row per question for the closing overview and the exports */
function consentRows(cfg, ses, votes, named){ return (cfg.questions||[]).map((qu,i)=>{ const base={n:i+1, id:qu.id, text:qu.text, kind:kindOf(qu)};
  if(!isTraffic(qu)) return base; const rev=qu.rev||1, o=questionOutcome(qu,ses,votes);
  return {...base, rev, edited:rev>1, status:o.status, counts:o.counts, fixed:o.fixed, comments:trafficComments(votes,qu,named), history:qu.history||[]}; }); }
function consentTotals(rows){ const t={green:0,yellow:0,red:0,none:0}; (rows||[]).forEach(r=>{ if(r.kind==="traffic") t[r.status||"none"]++; }); return t; }
/* Markdown of the outcome, from a results payload (so it also works for a saved results file). Fixed English headings, content as typed. */
/* a text never becomes raw HTML in the Markdown: "<" is written as "\<", which Markdown shows as a plain "<" */
const mdText = x => String(x==null?"":x).replace(/</g,"\\<");
function mdLine(x){ return mdText(x).replace(/\s*\r?\n\s*/g," ").trim(); }
function mdCell(x,max){ let t=mdLine(x); if(max && t.length>max) t=t.slice(0,max).trimEnd()+"…"; return t.replace(/\|/g,"\\|"); }
function mdQuote(x){ return mdText(x).split(/\r?\n/).map(l=>("> "+l).trimEnd()).join("\n"); }
function consentMarkdown(p){ const T=(p.questions||[]).filter(q=>q.kind==="traffic"), tot=consentTotals(T), d=new Date(p.exportedAt), z=n=>String(n).padStart(2,"0");
  const bullet=c=>`- ${c.name?`(${mdLine(c.name)}) `:""}${mdLine(c.text)}`, L=q=>q.lights||{g:0,y:0,r:0};
  const out=[`# ${mdLine(p.title)}`,"",`- Date: ${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`,`- Question set: ${mdLine(p.set&&p.set.name)}`,`- Respondents: ${p.respondents}`,
    `- Result: ${tot.green} green · ${tot.yellow} yellow · ${tot.red} red${tot.none?` · ${tot.none} without votes`:""}`,"","## Overview","",
    "| # | Proposal | Status | Green | Yellow | Red | Edited |","|---|----------|--------|-------|--------|-----|--------|"];
  T.forEach(q=>out.push(`| ${q.n} | ${mdCell(q.text,80)} | ${q.status} | ${L(q).g} | ${L(q).y} | ${L(q).r} | ${q.rev>1?`yes (v${q.rev})`:"no"} |`));
  out.push("","## Details","");
  const open=[...T.filter(q=>q.status==="red"), ...T.filter(q=>q.status==="yellow")];
  if(!open.length) out.push("No concerns or objections left.","");
  open.forEach(q=>{ const red=(q.comments||[]).filter(c=>c.v===3), yel=(q.comments||[]).filter(c=>c.v===2);
    out.push(`### ${q.n}. ${q.status==="red"?"Red":"Yellow"}`,"",`**Proposal${q.rev>1?` (version ${q.rev})`:""}**`,"",mdQuote(q.text),"");
    if(red.length) out.push(`**Objections (${red.length})**`,"",...red.map(bullet),"");
    if(yel.length) out.push(`**Concerns (${yel.length})**`,"",...yel.map(bullet),"");
    if((q.history||[]).length){ out.push("**Earlier versions**","");
      q.history.forEach(h=>{ out.push(`Version ${h.rev}:`,"",mdQuote(h.text),"");
        const cs=(h.comments||[]); if(cs.length) out.push(...cs.map(c=>`- ${c.v===3?"Objection":"Concern"}${c.name?` (${mdLine(c.name)})`:""}: ${mdLine(c.text)}`),""); }); } });
  out.push("## All proposals","");
  T.forEach(q=>out.push(`${q.n}. ${mdText(q.text||"").split(/\r?\n/).join("\n   ")}`));
  if(actionTotals(p.actionGroups).action) out.push("","## Actions","", ...mdDeadlineTable(p.actionGroups));
  return out.join("\n")+"\n"; }

/* ============ follow-up actions for concerns and objections (backlog F) ============ */
/* one action per remark: the same key as long as the remark stands, and never shared with another version of the proposal */
const actionKey = (qid,pid,rev) => `${qid}_${pid}_v${rev||1}`;
function cleanAction(a){ a=a||{}; const due=String(a.due||"");
  return { action:String(a.action||"").trim().slice(0,300), owner:String(a.owner||"").replace(/\s+/g," ").trim().slice(0,60), due:/^\d{4}-\d{2}-\d{2}$/.test(due)?due:"", none:!!a.none, t:Number.isFinite(a.t)?a.t:0 }; }
/* "none" = marked as no action needed, "action" = has an action text, "open" = still to do */
function actionState(a){ return (a && a.none) ? "none" : (a && String(a.action||"").trim()) ? "action" : "open"; }
/* the yellow and red remarks on the final version of each proposal, per proposal: red first, then oldest first */
function actionGroups(cfg, ses, votes, named, actions){ const out=[];
  (cfg.questions||[]).forEach((qu,i)=>{ if(!isTraffic(qu)) return; const rev=qu.rev||1;
    const rows=Object.entries(votes||{}).filter(([,v])=>{ const a=validAns(v,qu); return a===2||a===3; })
      .sort((a,b)=>(b[1].answers[qu.id]-a[1].answers[qu.id]) || ((a[1].t||0)-(b[1].t||0)))
      .map(([pid,v])=>{ const key=actionKey(qu.id,pid,rev), a=cleanAction((actions||{})[key]);
        const r={key, v:v.answers[qu.id], text:String(v.texts[qu.id]).trim(), action:a.action, owner:a.owner, due:a.due, none:a.none, state:actionState(a)};
        if(isNamed(named)) r.name=String(v.name||"unnamed"); return r; });
    if(rows.length) out.push({n:i+1, id:qu.id, text:qu.text, rev, status:rows.some(r=>r.v===3)?"red":"yellow", rows}); });
  return out; }
function actionTotals(groups){ const t={total:0, objections:0, concerns:0, action:0, none:0, open:0};
  (groups||[]).forEach(g=>g.rows.forEach(r=>{ t.total++; if(r.v===3) t.objections++; else t.concerns++; t[r.state]++; })); t.done=t.action+t.none; return t; }
/* every row with an action text, soonest deadline first (no deadline last), then by owner */
function actionsByDeadline(groups){ const rows=[]; (groups||[]).forEach(g=>g.rows.forEach(r=>{ if(r.state==="action") rows.push({due:r.due, owner:r.owner, action:r.action, n:g.n}); }));
  return rows.sort((a,b)=>((a.due||"9999").localeCompare(b.due||"9999")) || a.owner.localeCompare(b.owner) || (a.n-b.n)); }
function mdDeadlineTable(groups){ return ["| Deadline | Owner | Action | Proposal |","|----------|-------|--------|----------|",
  ...actionsByDeadline(groups).map(r=>`| ${r.due} | ${mdCell(r.owner)} | ${mdCell(r.action)} | ${r.n} |`)]; }
/* Markdown of the action list, from a results payload */
function actionsMarkdown(p){ const G=p.actionGroups||[], t=actionTotals(G), d=new Date(p.exportedAt), z=n=>String(n).padStart(2,"0"), named=isNamed(p.named);
  const s=(n,one,many)=>`${n} ${n===1?one:many}`;
  const out=[`# ${mdLine(p.title)}: follow-up actions`,"",`- Date: ${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())} ${z(d.getHours())}:${z(d.getMinutes())}`,`- Question set: ${mdLine(p.set&&p.set.name)}`,
    `- Remarks: ${t.total} (${s(t.objections,"objection","objections")}, ${s(t.concerns,"concern","concerns")})`,`- Handled: ${t.action} with an action, ${t.none} no action needed, ${t.open} open`,"","## Actions by proposal",""];
  if(!G.length) out.push("No concerns or objections to follow up.","");
  G.forEach(g=>{ out.push(`### ${g.n}. ${g.status==="red"?"Red":"Yellow"}`,"",mdQuote(g.text),"",
      `| Type | Remark |${named?" By |":""} Action | Owner | Deadline |`,`|------|--------|${named?"----|":""}--------|-------|----------|`);
    g.rows.forEach(r=>out.push(`| ${r.v===3?"Objection":"Concern"} | ${mdCell(r.text)} |${named?` ${mdCell(r.name)} |`:""} ${r.state==="none"?"No action needed":r.state==="open"?"(open)":mdCell(r.action)} | ${r.state==="action"?mdCell(r.owner):""} | ${r.state==="action"?r.due:""} |`));
    out.push(""); });
  out.push("## Actions by deadline","", ...(t.action ? mdDeadlineTable(G) : ["No actions recorded."]));
  return out.join("\n")+"\n"; }
/* the actions stored in a saved results file, back under the keys review mode uses (respondent label as device id) */
function reviveActions(p, questions){ const out={}, rev={}; (questions||[]).forEach(qu=>{ rev[qu.id]=qu.rev||1; });
  ((p&&p.answers)||[]).forEach((r,i)=>{ const pid=String((r&&r.respondent)||("R"+(i+1))); Object.entries((r&&r.actions)||{}).forEach(([qid,a])=>{ if(rev[qid]) out[actionKey(qid,pid,rev[qid])]=cleanAction(a); }); });
  return out; }

/* ============ votes and statistics ============ */
const PRESENCE_MS = 150000; // a participant without answers counts as present for 2.5 min after their last heartbeat
function hasAnswers(v){ return !!(v && v.answers && Object.keys(v.answers).length); }
/* the doc a device sends to say it is still here. Once it holds answers, t stays the moment of answering:
   presence only looks at t of docs without answers, and comments, open answers and exports are ordered by it */
function presenceDoc(cur, round, now){ if(!cur || cur.round!==round) return {round, answers:{}, t:now};
  return (hasAnswers(cur) && Number.isFinite(cur.t)) ? {...cur} : {...cur, t:now}; }
function validAns(v,qu){
  if(isOpen(qu)) return String((v&&v.texts&&v.texts[qu.id])||"").trim() ? 1 : null; // an open answer is its text
  const a=v&&v.answers?v.answers[qu.id]:undefined; if(!Number.isFinite(a)) return null;
  if(!Number.isInteger(a) || a<qu.min || a>qu.max) return null; // outside the scale or the list of options: a forged or stale vote
  if(isTraffic(qu) && !answerIsCurrent(v,qu.id,qu.rev)) return null; // given on an earlier version of the proposal (backlog C1)
  if(isDilemma(qu)){ const c=v.conf?v.conf[qu.id]:undefined, cf=qu.conf||DEFAULT_CONF; if(!Number.isFinite(c) || c<cf.min || c>cf.max) return null; } // choice and confidence, or nothing
  if(isTraffic(qu) && a!==1 && !String(v.texts?.[qu.id]||"").trim()) return null; return a; } // yellow/red only count once the follow-up is filled in
function roundVotes(votes, round, now, skipPid, named){ const out={};
  for(const [pid,v] of Object.entries(votes||{})){ if(!v || v.round!==round) continue;
    if(!hasAnswers(v)){ if(pid===skipPid) continue; if(!v.t || now-v.t>PRESENCE_MS) continue; if(isNamed(named) && !v.name) continue; } // in a named set you have joined once you have a name
    out[pid]=v; }
  return out; }
/* ---- what the room may see (backlog G8) ----
   Participants cannot read the answers of others (database rules). The presenter's screen publishes, under polls/{id}/shown,
   the answers of the questions the room is shown: revealed ones, the one on screen in the results phase, all in the summary.
   Each answer is its own record, keyed by question and a position that follows from a hash, with the order of answering as
   its only time, so records cannot be linked to each other or to a device. In a named set the name goes along, as on screen. */
function visibleQids(cfg, ses){ const Q=(cfg&&cfg.questions)||[]; if(!ses || !Q.length || ses.phase==="lobby") return [];
  if(ses.phase==="summary") return Q.map(qu=>qu.id);
  const s=new Set(ses.revealed||[]); if(ses.phase==="results" && Q[ses.current]) s.add(Q[ses.current].id);
  return Q.map(qu=>qu.id).filter(id=>s.has(id)); }
function hashStr(s){ let h=2166136261; s=String(s); for(let i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
function shownVotes(cfg, ses, votes, named){ const out={}, round=(ses&&ses.round)||1, ids=new Set(visibleQids(cfg,ses));
  for(const qu of ((cfg&&cfg.questions)||[])){ if(!ids.has(qu.id)) continue; const rows=[];
    for(const [pid,v] of Object.entries(votes||{})){ if(!v || v.round!==round) continue; const a=validAns(v,qu); if(a==null) continue;
      const d={round, answers:{[qu.id]:a}}; const t=v.texts && v.texts[qu.id];
      if(typeof t==="string" && t.trim()) d.texts={[qu.id]:t};
      if(isDilemma(qu)) d.conf={[qu.id]:v.conf[qu.id]};
      if(isTraffic(qu) && (qu.rev||1)>1) d.revs={[qu.id]:qu.rev};
      if(isNamed(named) && v.name) d.name=String(v.name);
      rows.push({d, at:Number.isFinite(v.t)?v.t:0, h:hashStr(pid+"|"+qu.id)}); }
    rows.sort((x,y)=>x.at-y.at || x.h-y.h).forEach((r,i)=>{ r.d.t=i+1; }); // the order of answering, not the time
    rows.sort((x,y)=>x.h-y.h).forEach((r,i)=>{ out[qu.id+"_"+i]=r.d; }); }
  return out; }
/* names in a named set (polls/{id}/names/{uid} = {n, at}) as the vote docs the name checks expect */
function namesAsVotes(names){ const out={}; Object.entries(names||{}).forEach(([pid,x])=>{ if(x && typeof x.n==="string" && x.n) out[pid]={name:x.n, nameAt:Number(x.at)||0}; }); return out; }
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

/* dilemma: per option how many chose it, their mean confidence and its distribution; plus the overall mean */
function dilemmaStats(votes, qu){ const cf=qu.conf||DEFAULT_CONF, by={};
  for(let v=qu.min;v<=qu.max;v++){ by[v]={n:0,sum:0,mean:null,dist:{}}; for(let c=cf.min;c<=cf.max;c++) by[v].dist[c]=0; }
  let n=0, sum=0;
  Object.values(votes||{}).forEach(vt=>{ const a=validAns(vt,qu); if(a==null || !by[a]) return; const c=vt.conf[qu.id];
    by[a].n++; by[a].sum+=c; if(by[a].dist[c]!=null) by[a].dist[c]++; n++; sum+=c; });
  let mode=qu.min; for(let v=qu.min;v<=qu.max;v++){ by[v].mean=by[v].n?by[v].sum/by[v].n:null; if(by[v].n>by[mode].n) mode=v; }
  return {n, mean:n?sum/n:null, by, mode}; }

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
    if(type==="open") return qOpen(text);
    if(type==="dilemma") return qFromObj({text, kind:"dilemma", options:opts});
    if(type==="options"||(type===""&&get(r,"options"))) return q(text,1,5,"","",opts);
    return q(text,clamp(Math.round(num(get(r,"min"),1)),0,10),clamp(Math.round(num(get(r,"max"),5)),2,11),get(r,"lo")||"Strongly disagree",get(r,"hi")||"Strongly agree"); }).filter(Boolean);
}

/* ============ question sets ============ */
const DAY=864e5, DEFAULT_EXPIRY_DAYS=3, DEFAULT_ACCENT="#5A3BD6";
const CATEGORIES=["generic","consent","dilemma"], NAMED=["no","yes","random"];
const SET_ID_RE=/^[A-Za-z0-9_-]{1,40}$/;
/* the id is the name as a slug, so the link reads like the set; -2, -3… when that id is taken */
function setIdFor(name, taken){ const base=slug(name); if(!taken || !taken(base)) return base;
  for(let n=2;;n++){ const suf="-"+n, id=base.slice(0,40-suf.length).replace(/-+$/,"")+suf; if(!taken(id)) return id; } }
/* a new set gets four random characters behind its name, so its link cannot be guessed from the name (backlog G4).
   Without 0, o, 1, l and i: the link is also read aloud and typed over. */
const TAIL_CHARS="abcdefghjkmnpqrstuvwxyz23456789";
function randomTail(rnd){ rnd=rnd||Math.random; let t=""; for(let i=0;i<4;i++) t+=TAIL_CHARS[Math.floor(rnd()*TAIL_CHARS.length)%TAIL_CHARS.length]; return t; }
function newSetId(name, taken, rnd){ const base=slug(name).slice(0,35).replace(/-+$/,"")||"set";
  for(;;){ const id=base+"-"+randomTail(rnd); if(!taken || !taken(id)) return id; } }
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
    config:{ mode:c.mode, tlYellow:c.tlYellow, tlRed:c.tlRed, questions:JSON.parse(JSON.stringify(clearHistory(c).questions)).map(qu=>({...qu, id:newQid()})) } }; } // a copy starts without earlier versions
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
  const questions=arr.filter(x=>x && typeof x==="object").map(qFromObj);
  return { set, tlYellow, tlRed, questions }; }

/* a question from a saved results file, for review mode: same shape as qFromObj but it keeps its id */
function reviveQuestion(x, i){ const qu=qFromObj(x), out={...qu, id:String((x&&x.id)||("q"+i)), text:String((x&&x.text)||("Question "+(i+1)))};
  if(x && x.kind==="traffic" && x.rev>1){ out.rev=x.rev; out.history=Array.isArray(x.history)?x.history:[]; } return tidyQuestion(out); }
/* the lights stored in a saved results file, back as session.outcome */
function reviveOutcome(p){ const o={}; ((p&&p.questions)||[]).forEach(q=>{ if(q && q.kind==="traffic" && q.status) o[q.id]={status:q.status, rev:q.rev||1, counts:{g:num((q.lights||{}).g,0), y:num((q.lights||{}).y,0), r:num((q.lights||{}).r,0)}, t:Date.parse(p.exportedAt||"")||0}; }); return o; }

/* ---- responses export ---- */
function resultsPayload(o){ const cfg=normConfig(o.cfg), ses=o.ses||{}, round=ses.round||1, meta=normMeta(o.meta)||null;
  const named=o.named||(meta?meta.named:"no"), category=o.category||(meta?meta.category:"generic");
  const rv=roundVotes(o.votes, round, o.now, null);
  const ids=Object.keys(rv).filter(k=>hasAnswers(rv[k])).sort((a,b)=>(rv[a].t||0)-(rv[b].t||0));
  const title=o.title || (meta?meta.header:"") || "Tally Room";
  return { pollId:o.setId||"", set:{id:o.setId||"", name:meta?meta.name:title, header:title, category},
    title, named, actionGroups:actionGroups(cfg, ses, Object.fromEntries(ids.map(k=>[k,rv[k]])), named, o.actions), mode:cfg.mode, round, exportedAt:new Date(o.now).toISOString(), respondents:ids.length,
    questions: cfg.questions.map((qu,i)=>{
      const vals=ids.map(k=>validAns(rv[k],qu)).filter(v=>Number.isFinite(v));
      const st=stats(vals,qu.min,qu.max); const num=!isOpt(qu)&&!isOpen(qu)&&st.n;
      const extra = isOpen(qu) ? { maxLen:qu.maxLen||OPEN_MAX, texts:ids.filter(k=>validAns(rv[k],qu)!=null).map(k=>String(rv[k].texts[qu.id]).trim()) }
        : isDilemma(qu) ? (()=>{ const ds=dilemmaStats(ids.map(k=>rv[k]),qu), r2=x=>x==null?null:+x.toFixed(2);
            return { conf:normConf(qu.conf), confidence:{ mean:r2(ds.mean), byOption:qu.options.map((o,j)=>({option:o, count:ds.by[j+1].n, mean:r2(ds.by[j+1].mean)})) } }; })()
        : isTraffic(qu) ? (()=>{ const oc=questionOutcome(qu,ses,rv); // the light as fixed by the presenter, the comments on the final version, and the earlier versions
            return { rev:qu.rev||1, status:oc.status, lights:oc.counts, comments:trafficComments(ids.map(k=>rv[k]),qu,named), history:qu.history||[] }; })() : {};
      return { n:i+1, id:qu.id, text:qu.text, kind:kindOf(qu), ...extra,
        options:isOpt(qu)?[...qu.options]:null, min:qu.min, max:qu.max, lo:qu.lo||"", hi:qu.hi||"",
        answers:st.n||0, counts:isOpen(qu)?{}:(st.counts||{}), mostChosen:(st.n&&!isOpen(qu))?optLabel(qu,st.mode):null,
        mean:num?+st.mean.toFixed(2):null, median:num?st.median:null, sd:num?+st.sd.toFixed(2):null }; }),
    answers: ids.map((k,i)=>({ respondent:(isNamed(named)&&rv[k].name) ? String(rv[k].name) : "R"+String(i+1).padStart(2,"0"), at:new Date(rv[k].t||0).toISOString(),
      answers:Object.fromEntries(cfg.questions.map(qu=>[qu.id, (Number.isFinite(rv[k].answers?.[qu.id]) && !(isTraffic(qu)&&!answerIsCurrent(rv[k],qu.id,qu.rev)))?rv[k].answers[qu.id]:null])),
      actions:Object.fromEntries(cfg.questions.filter(qu=>isTraffic(qu) && (o.actions||{})[actionKey(qu.id,k,qu.rev)] && validAns(rv[k],qu)>1).map(qu=>{ const a=cleanAction(o.actions[actionKey(qu.id,k,qu.rev)]); return [qu.id,{action:a.action, owner:a.owner, due:a.due, none:a.none}]; })),
      confidence:Object.fromEntries(cfg.questions.filter(qu=>isDilemma(qu)&&Number.isFinite(rv[k].conf?.[qu.id])).map(qu=>[qu.id,rv[k].conf[qu.id]])),
      texts:Object.fromEntries(cfg.questions.filter(qu=>((isTraffic(qu)&&answerIsCurrent(rv[k],qu.id,qu.rev)&&[2,3].includes(rv[k].answers[qu.id]))||isOpen(qu))&&String(rv[k].texts?.[qu.id]||"").trim()).map(qu=>[qu.id,String(rv[k].texts[qu.id]).trim()])) })),
    followUps:{yellow:followUp(cfg,2), red:followUp(cfg,3)} };
}
/* a cell that starts with = + - or @ would be run as a formula by a spreadsheet: an apostrophe in front makes it text */
function csvCell(v){ let t=String(v==null?"":v); if(/^[=+\-@\t\r]/.test(t)) t="'"+t; return `"${t.replace(/"/g,'""')}"`; }
function resultsCSV(p){ const qq=csvCell, s=p.set||{};
  const rows=[["respondent","question_nr","question","value","label","comment","confidence","set","header","category","action","owner","deadline"].join(",")];
  p.answers.forEach(r=>p.questions.forEach(qu=>{ const v=r.answers[qu.id], text=(r.texts&&r.texts[qu.id])||"", open=qu.kind==="open", cf=r.confidence?r.confidence[qu.id]:null, ac=r.actions?r.actions[qu.id]:null;
    if(open ? !text : !Number.isFinite(v)) return; // an open answer is one row with its text in the comment column
    rows.push([qq(r.respondent), qu.n, qq(qu.text), open?"":v, open?'""':qq(qu.options?(qu.options[v-1]||v):v), qq(text), Number.isFinite(cf)?cf:"", qq(s.name), qq(s.header), qq(s.category), qq(ac?(ac.none?"No action needed":ac.action):""), qq(ac&&!ac.none?ac.owner:""), (ac&&!ac.none?ac.due:"")].join(",")); }));
  return "﻿"+rows.join("\r\n"); }

/* ============ colour: one accent in, the whole palette out ============ */
const ACCENT_PRESETS=[["Purple","#5A3BD6"],["Blue","#0860C6"],["Teal","#006E6E"],["Green","#15722E"],["Orange","#F5921E"],["Red","#BC2A22"],["Pink","#B4237F"],["Slate","#475569"]];
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

/* ============ icon: the round table, in the colours of the set ============ */
/* A ring (the room, a result) in two camps (a dilemma) around a check (consent). It is drawn in currentColor, so one drawing
   serves the mark in the header (CSS variables) and the browser tab (fixed colours). */
const ICON_MARK='<g fill="none" stroke="currentColor" stroke-width="8" transform="rotate(-90 32 32)"><circle cx="32" cy="32" r="19" stroke-dasharray="69 50.38"/><circle cx="32" cy="32" r="19" stroke-dasharray="40.38 79" stroke-dashoffset="-74" opacity=".55"/></g><path d="M24.5 32.5l5.5 5.5 10-11" fill="none" stroke="currentColor" stroke-width="4.5" stroke-linecap="round" stroke-linejoin="round"/>';
/* the icon as a file: the tile is the accent as picked, the drawing white, or dark where white would not be readable (yellow, light grey) */
function iconSVG(accent){ const v=themeVars(accent,false);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${v.accent}"/>${ICON_MARK.replace(/currentColor/g,v["accent-ink"])}</svg>`; }

const api={ clamp, num, fmt, tx, slug, stamp,
  TL_LABELS, TL_COLORS, TL_Q_YELLOW, TL_Q_RED, normOptions, newQid, isTraffic, isOpen, isDilemma, isOpt, kindOf, KIND_LABEL, KIND_NAME, OPEN_MAX, DEFAULT_CONF, normConf,
  optLabel, q, qOpen, qDilemma, qNew, qFromObj, shapeQuestion, questionProblems, reviveQuestion, exportQ, followUp,
  CATEGORY_RULES, catRules, catName, kindAllowed, filterForCategory, skippedMessage, categoryBlockers, blockerMessage, dilemmaStats,
  DEFAULT_SESSION, emptyConfig, normConfig, normSession,
  PRESENCE_MS, hasAnswers, presenceDoc, TYPING_MS, isWriting, withoutTyping, trafficWriting, typingExpiry, qidMap, withQids, validAns, roundVotes, visibleQids, shownVotes, namesAsVotes, stats, parseCSV, csvToQuestions,
  DAY, DEFAULT_EXPIRY_DAYS, DEFAULT_ACCENT, CATEGORIES, NAMED, csvCell, tidyQuestion, SET_ID_RE, setIdFor, randomTail, newSetId, normHex, normMeta, newMeta, isExpired, expiryInfo, extendedExpiry,
  sortSets, pollStats, duplicateSet, migrationMeta, questionsExport, parseQuestionsFile, resultsPayload, resultsCSV,
  ACCENT_PRESETS, REF, hexToRgb, rgbToHex, relLum, contrast, hexToOklch, oklchToHex, themeVars, themeCSS, ICON_MARK, iconSVG,
  isNamed, cleanName, nameProblem, otherNames, mustYieldName, randomName,
  answerIsCurrent, trafficCounts, trafficStatus, trafficComments, editQuestion, clearHistory, fixOutcome, questionOutcome, consentRows, consentTotals, consentMarkdown, reviveOutcome,
  actionKey, cleanAction, actionState, actionGroups, actionTotals, actionsByDeadline, actionsMarkdown, reviveActions };
if(typeof module!=="undefined" && module.exports) module.exports=api; else root.TRCore=api;
})(typeof window!=="undefined" ? window : globalThis);
