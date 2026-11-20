(function(){
"use strict";
const C=window.TRCore, B=window.TRBackend;
const { clamp, fmt, tx, normOptions, isTraffic, isOpen, isDilemma, kindOf, isOpt, optLabel, q, exportQ, stats, hasAnswers, validAns, normSession, csvToQuestions, TL_LABELS, TL_COLORS, TL_Q_YELLOW, TL_Q_RED, DEFAULT_SESSION } = C;
const tlPrompt = v => C.followUp(S.cfg, v);
const qColor = (qu,i,n) => (isTraffic(qu) && TL_COLORS[i]) ? TL_COLORS[i] : rampColor(i,n);
const qInk = (qu,i,n) => isTraffic(qu) ? (i===1?"#1E1838":"#FFFFFF") : selInk(i,n);

/* ============ address: which set, and links to other screens ============ */
const params=new URLSearchParams(location.search);
const PAGE=location.href.split("#")[0].split("?")[0];
const RAW_SET=params.get("set"), SET_ID=(RAW_SET && C.SET_ID_RE.test(RAW_SET)) ? RAW_SET : null;
/* no arguments = the overview of all sets; host = the presenter sign-in screen (it comes back here without it) */
const SIGNIN = params.has("host") && params.get("host")!=="off";
function urlFor(o){ o=o||{}; const p=new URLSearchParams(); if(o.set) p.set("set",o.set); if(o.edit) p.set("edit","1"); if(o.host) p.set("host","1"); if(params.has("demo")) p.set("demo",params.get("demo")||"1"); const s=p.toString(); return PAGE+(s?"?"+s:""); }
function joinUrl(id, meta){ return (meta && meta.joinUrl) || urlFor({set:id}); }

/* ============ state ============ */
/* meta: undefined = not loaded yet, null = this set does not exist */
const S = { route:(RAW_SET!=null?"set":"home"), setId:SET_ID, booted:false, meta:undefined, metaErr:null, sets:null, setsErr:null, polls:{}, cfg:null, ses:null, votes:{}, actions:{}, auth:{ready:false,uid:null,isHost:false,anon:false,email:"",error:null}, me:{id:null,isHost:false,canWrite:true,ackReset:null}, ui:{view:null,configOpen:false,draft:null,readonly:false,qs:.75,dlg:null}, backend:null, be:null };
const app = document.getElementById("app");
const QS_STEPS=[.5,.6,.7,.75,.8,.9,1,1.15,1.3,1.5,1.75,2];
function getQS(){ try{ const v=parseFloat(localStorage.getItem("tr_qs")); if(QS_STEPS.includes(v)) return v; }catch(e){} return .75; }
function applyQS(){ document.documentElement.style.setProperty("--qs", String(S.ui.qs)); }
function fontCtl(){ return `<span class="fsz" title="Text size of the questions (remembered on this device)"><button class="btn sm ghost" data-act="fontDown" aria-label="Smaller text">A−</button><span>${Math.round(S.ui.qs*100)}%</span><button class="btn sm ghost" data-act="fontUp" aria-label="Larger text">A+</button></span>`; }
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

/* ============ helpers ============ */
const esc = s => String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
function rampColor(idx,n){ // idx 0..n-1 -> --r1..--r10 spread evenly
  if(n<=1) return "var(--r6)";
  const step = 1 + Math.round(idx*(9/(n-1)));
  return `var(--r${clamp(step,1,10)})`;
}
function selInk(idx,n){ const step=1+Math.round(idx*(9/(n-1||1))); return step>=5 ? "var(--surface)" : "var(--ink)"; }
function isKicked(){ return S.me.ackReset!=null && !!S.ses && (S.ses.resetAt||0) > S.me.ackReset; }
function noteReset(s){ if(S.me.ackReset==null && s && s.phase) S.me.ackReset = s.resetAt||0; }
function currentRoundVotes(){ return C.roundVotes(S.votes, S.ses?.round??1, Date.now(), S.me.isHost?S.me.id:null, namedMode()); }
/* in review mode the saved file decides, otherwise the set */
function namedMode(){ return S.review ? (S.review.info.named||"no") : ((S.meta && S.meta.named)||"no"); }
function catNow(){ return S.review ? (S.review.info.category||"generic") : ((S.meta && S.meta.category)||"generic"); }
const nameLabel = v => v.name ? String(v.name) : "unnamed";
function header(){ return S.review ? S.review.info.title : ((S.meta && (tx(S.meta.header)||tx(S.meta.name))) || "Tally Room"); }
/* the server's clock decides (the database rules refuse answers after expiry), not the clock of the phone */
function nowS(){ return S.be && S.be.now ? S.be.now() : Date.now(); }
function expired(){ return !S.review && C.isExpired(S.meta, nowS()); }
function metaOf(id){ if(S.route==="set") return id===S.setId ? S.meta : null; return (S.sets && S.sets[id]) ? C.normMeta(S.sets[id]) : null; }
function fmtDate(ts){ try{ return new Date(ts).toLocaleString("en-GB",{day:"numeric",month:"short",year:"numeric",hour:"2-digit",minute:"2-digit"}); }catch(e){ return new Date(ts).toISOString().slice(0,16).replace("T"," "); } }
let themeFor=null;
function applyTheme(accent){ const css=C.themeCSS(accent); if(css===themeFor) return; themeFor=css;
  let el=document.getElementById("tr-theme"); if(!el){ el=document.createElement("style"); el.id="tr-theme"; document.head.appendChild(el); } el.textContent=css; }
function answersFor(qid){ const qu=S.cfg.questions.find(x=>x.id===qid)||{id:qid}; return Object.values(currentRoundVotes()).map(v=>validAns(v,qu)).filter(x=>Number.isFinite(x)); }
function joinedCount(){ return Object.keys(currentRoundVotes()).length; }

/* ============ chart ============ */
function chartHTML(qu, vals, opts={}){
  const n=vals.length, pts=qu.max-qu.min+1, st=stats(vals,qu.min,qu.max);
  const useBars = n>40;
  const maxCount = n? Math.max(...Object.values(st.counts)) : 0;
  const cols = []; const ticks=[]; const strip=[]; const legend=[];
  for(let v=qu.min, i=0; v<=qu.max; v++, i++){
    const c = st.counts?.[v]||0; const color=qColor(qu,i,pts);
    let marks="";
    if(useBars){ const h=maxCount? Math.round(140*c/maxCount) : 0; marks=`<div class="bar-v" style="--c:${color};height:${h}px"></div>`; }
    else { const d = pts>7 ? 16 : (n>16 ? 16 : 22); for(let k=0;k<c;k++) marks+=`<span class="dot-v" style="--c:${color};--d:${d}px;--i:${k}"></span>`; marks=`<div class="dots">${marks}</div>`; }
    const pct = n? Math.round(100*c/n) : 0;
    cols.push(`<div class="col">${c?`<div class="count">${c}<small> · ${pct}%</small></div>`:`<div class="count"></div>`}${marks}</div>`);
    ticks.push(isOpt(qu) ? `<div class="tick lab ${c?"hot":""}"><b>${v}</b>${esc(tx(qu.options[i]))}</div>` : `<div class="tick ${c?"hot":""}">${v}</div>`);
    if(c) strip.push(`<i style="--c:${color};flex-grow:${c}" title="${esc(optLabel(qu,v))}: ${c}"></i>`);
    legend.push(`<span><i style="--c:${color}"></i>${esc(optLabel(qu,v))}</span>`);
  }
  const meanPos = n ? ((st.mean-qu.min)/(qu.max-qu.min))*100 : 0;
  const cell = `calc((100% - ${(pts-1)*8}px)/${pts})`;
  const meanLeft = n? `calc(${cell} * (${(st.mean-qu.min)} + 0.5) + ${8*(st.mean-qu.min)}px)` : "50%";
  if(isOpt(qu)){
    const distinct = n? Object.values(st.counts).filter(c=>c>0).length : 0;
    const top = n? st.counts[st.mode] : 0;
    const modes = n? Object.keys(st.counts).filter(k=>st.counts[k]===top).map(k=>optLabel(qu,+k)) : [];
    const modeTxt = modes.length>1 ? "Tie: "+modes.join(" · ") : (modes[0]||"–");
    return `
  <div class="chart-head">
    <div class="hero"><span class="num">${n?top:"–"}</span><span class="den">/ ${n||"–"} ${n?"chose":""}</span></div>
    <div class="stat"><span class="v" style="font-size:17px;max-width:360px">${n?esc(modeTxt):"–"}</span><span class="l">most chosen</span></div>
    <div class="stat"><span class="v">${n?distinct:"–"}<small style="font-size:13px;color:var(--muted)"> / ${pts}</small></span><span class="l">options chosen</span></div>
  </div>
  ${n? `<div class="cols" style="grid-template-columns:repeat(${pts},minmax(0,1fr))">${cols.join("")}</div>
  <div class="axis" style="grid-template-columns:repeat(${pts},minmax(0,1fr))">${ticks.join("")}</div>`
      : `<div class="empty">No answers yet.</div><div class="axis" style="grid-template-columns:repeat(${pts},minmax(0,1fr))">${ticks.join("")}</div>`}
  <div class="strip">${strip.join("")}</div>`;
  }
  return `
  <div class="chart-head">
    <div class="hero"><span class="num">${n?fmt(st.mean):"–"}</span><span class="den">/ ${qu.max}</span></div>
    <div class="stat"><span class="v">${n}</span><span class="l">${n===1?"answer":"answers"}</span></div>
    <div class="stat"><span class="v">${n?fmt(st.median):"–"}</span><span class="l">median</span></div>
    <div class="stat"><span class="v">${n?"±"+fmt(st.sd):"–"}</span><span class="l">spread</span></div>
  </div>
  ${n? `<div class="cols" style="grid-template-columns:repeat(${pts},minmax(0,1fr))">${cols.join("")}</div>
  <div class="axis" style="grid-template-columns:repeat(${pts},minmax(0,1fr))">${ticks.join("")}</div>
  <div class="ends"><span>${esc(tx(qu.lo))}</span><span>${esc(tx(qu.hi))}</span></div>
  <div class="rail"><div data-label="mean ${fmt(st.mean)}" class="mean-mark ${(st.mean-qu.min)/(qu.max-qu.min)>0.78?"flip":""}" style="left:${meanLeft}"></div></div>`
      : `<div class="empty">No answers yet.</div><div class="ends"><span>${esc(tx(qu.lo))}</span><span>${esc(tx(qu.hi))}</span></div>`}
  <div class="strip">${strip.join("")}</div>`;
}
/* the result of one question, whatever its kind */
function resultHTML(qu){ return isOpen(qu) ? openAnswersHTML(qu) : isDilemma(qu) ? dilemmaChartHTML(qu) : chartHTML(qu, answersFor(qu.id)); }
function openAnswersHTML(qu){
  const list=Object.values(currentRoundVotes()).filter(v=>validAns(v,qu)!=null).sort((a,b)=>(a.t||0)-(b.t||0)).map(v=>({text:String(v.texts[qu.id]).trim(), ...(C.isNamed(namedMode())?{name:nameLabel(v)}:{})}));
  return `<div class="chart-head"><div class="hero"><span class="num">${list.length}</span><span class="den">${list.length===1?"answer":"answers"}</span></div></div>
  ${list.length ? `<ul class="open-list">${list.map(cmLi).join("")}</ul>` : `<div class="empty">No answers yet.</div>`}`;
}
function dilemmaChartHTML(qu){
  const ds=C.dilemmaStats(currentRoundVotes(),qu), cf=qu.conf||C.DEFAULT_CONF, n=ds.n, cpts=cf.max-cf.min+1;
  const most=Math.max(1,...Object.values(ds.by).map(o=>o.n)), top=n?ds.by[ds.mode].n:0;
  const modes=n?Object.keys(ds.by).filter(k=>ds.by[k].n===top).map(k=>optLabel(qu,+k)):[];
  const rows=qu.options.map((o,i)=>{ const b=ds.by[i+1]; let seg="";
    for(let c=cf.min,j=0;c<=cf.max;c++,j++){ if(b.dist[c]) seg+=`<i style="--c:${rampColor(j,cpts)};flex-grow:${b.dist[c]}" title="Confidence ${c}: ${b.dist[c]}"></i>`; }
    return `<div class="dl-row"><div class="dl-lab"><b>${i+1}</b>${esc(tx(o))}</div><div class="dl-track"><div class="dl-bar" style="width:${Math.round(100*b.n/most)}%">${seg}</div></div>
      <div class="dl-num">${b.n}<small> · ${n?Math.round(100*b.n/n):0}%</small><span>${b.n?`confidence ${fmt(b.mean)}`:"–"}</span></div></div>`; }).join("");
  let legend=""; for(let c=cf.min,j=0;c<=cf.max;c++,j++) legend+=`<span><i style="--c:${rampColor(j,cpts)}"></i>${c}${c===cf.min&&tx(cf.lo)?` ${esc(tx(cf.lo))}`:""}${c===cf.max&&tx(cf.hi)?` ${esc(tx(cf.hi))}`:""}</span>`;
  return `<div class="chart-head">
    <div class="hero"><span class="num">${n?top:"–"}</span><span class="den">/ ${n||"–"} ${n?"chose":""}</span></div>
    <div class="stat"><span class="v" style="font-size:17px;max-width:360px">${n?esc(modes.length>1?"Tie: "+modes.join(" · "):modes[0]):"–"}</span><span class="l">most chosen</span></div>
    <div class="stat"><span class="v">${n?fmt(ds.mean):"–"}<small style="font-size:13px;color:var(--muted)"> / ${cf.max}</small></span><span class="l">mean confidence</span></div>
  </div>
  ${n?"":`<div class="empty">No answers yet.</div>`}<div class="dl">${rows}</div>
  <div class="legend"><span>${esc(tx(cf.text))}</span>${legend}</div>`;
}
function sumNote(r){ const qu=r.qu;
  if(isOpen(qu)) return "open question";
  if(isDilemma(qu)){ const ds=C.dilemmaStats(currentRoundVotes(),qu); return `dilemma, ${qu.options.length} options${r.st.n?` · most chosen: ${esc(optLabel(qu,r.st.mode))} · mean confidence ${fmt(ds.mean)}`:""}`; }
  return isOpt(qu) ? `${qu.options.length} options${r.st.n?` · most chosen: ${esc(optLabel(qu,r.st.mode))}`:""}` : `scale ${qu.min}–${qu.max}`; }
function sumScore(r){ if(!r.st.n || isOpen(r.qu)) return -1; return isOpt(r.qu) ? r.st.counts[r.st.mode]/r.st.n : r.st.mean/r.qu.max; }
function sumMetric(r){ if(!r.st.n) return "–"; if(isOpen(r.qu)) return `${r.st.n}<small> ${r.st.n===1?"answer":"answers"}</small>`; return isOpt(r.qu) ? `${r.st.counts[r.st.mode]}<small> /${r.st.n}</small>` : `${fmt(r.st.mean)}<small> /${r.qu.max}</small>`; }
function trafficTable(Q, curId, allShown, pick){
  const ses=S.ses, rows=Q.map((qu,i)=>({qu,i})).filter(r=>isTraffic(r.qu));
  if(!rows.length) return "";
  const body=rows.map(({qu,i})=>{
    const vals=answersFor(qu.id), n=vals.length, st=stats(vals,1,3); st.counts=st.counts||{1:0,2:0,3:0}; // no votes yet: stats() returns no counts
    const shown = allShown || ses.revealed.includes(qu.id) || ses.showLive;
    let cell;
    if(!shown) cell=`<span class="tl-hid">${qu.id===curId?`${n} answered, hidden until you reveal`:"not shown yet"}</span>`;
    else cell=`<div class="tl-bar">${[1,2,3].map(v=>st.counts[v]?`<i style="--c:${TL_COLORS[v-1]};flex-grow:${st.counts[v]}"></i>`:"").join("")}</div>
      <div class="tl-cnt">${[1,2,3].map(v=>`<span style="--c:${TL_COLORS[v-1]}" title="${esc(tx(qu.options[v-1]))}">${st.counts[v]||0}</span>`).join("")}${n?`<small class="meta">${n} answers</small>`:""}</div>`;
    return `<tr class="${qu.id===curId?"cur":""}${pick?" pick":""}"${pick?` data-act="tlSel" data-q="${esc(qu.id)}" title="Show details"`:""}><td class="n">${i+1}</td><td>${esc(tx(qu.text))}</td><td class="r">${cell}</td></tr>`; }).join("");
  return `<div class="card" style="padding:18px 20px"><table class="tl-table"><thead><tr><th>#</th><th>Statement</th><th>${esc(((Q.find(isTraffic)||{}).options||TL_LABELS).join(" / "))}</th></tr></thead><tbody>${body}</tbody></table><div class="tl-pager" hidden></div></div>`;
}
function miniStrip(qu, vals){ if(isOpen(qu)) return `<div class="mini" style="visibility:hidden"></div>`;
  const pts=qu.max-qu.min+1, st=stats(vals,qu.min,qu.max); let s="";
  for(let v=qu.min,i=0;v<=qu.max;v++,i++){ const c=st.counts?.[v]||0; if(c) s+=`<i style="--c:${qColor(qu,i,pts)};flex:${c}"></i>`; }
  return `<div class="mini">${s}</div>`;
}

/* ============ export ============ */
function download(name, data, type){ try{
  const url=URL.createObjectURL(new Blob([data],{type})); const a=document.createElement("a");
  a.href=url; a.download=name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 4000);
}catch(e){ alert("Saving failed: "+e.message); } }
function fileBase(meta){ return "tallyroom-"+C.slug(meta?tx(meta.name):"results"); }
function saveResults(payload, meta, kind){ const base=`${fileBase(meta)}-${C.stamp(Date.now())}`;
  if(kind==="csv") download(base+".csv", C.resultsCSV(payload), "text/csv;charset=utf-8");
  else download(base+".json", JSON.stringify(payload,null,2), "application/json"); }
function currentPayload(){ return C.resultsPayload({setId:S.setId, meta:S.meta, title:header(), named:namedMode(), category:catNow(), cfg:S.cfg, ses:S.ses, votes:S.votes, actions:shownActions(), now:Date.now()}); }
function exportActionsMD(){ download(`${fileBase(S.meta)}-actions-${C.stamp(Date.now())}.md`, C.actionsMarkdown(currentPayload()), "text/markdown;charset=utf-8"); }
function exportMD(){ download(`${fileBase(S.meta)}-${C.stamp(Date.now())}.md`, C.consentMarkdown(currentPayload()), "text/markdown;charset=utf-8"); }
function mdBtn(){ return (catNow()==="consent" && S.ses.outcome && Object.keys(S.ses.outcome).length) ? `<button class="btn ghost" data-act="expMD">Export as Markdown</button>` : ""; }
function exportJSON(){ saveResults(currentPayload(), S.meta, "json"); }
function exportCSV(){ saveResults(currentPayload(), S.meta, "csv"); }
function exportBtns(){ return Object.values(currentRoundVotes()).some(hasAnswers)
  ? `<button class="btn ghost" data-act="expJSON">Save results (JSON)</button><button class="btn ghost" data-act="expCSV">CSV</button>` : ""; }
/* exports for any set, straight from the database: the set does not have to be open anywhere */
async function exportSet(id, kind){ const meta=metaOf(id); if(!meta) return;
  try{ const poll=await S.be.readPoll(id);
    if(kind==="questions"){ download(`${fileBase(meta)}-questions.json`, JSON.stringify(C.questionsExport(meta, poll.config),null,1), "application/json"); return; }
    const payload=C.resultsPayload({setId:id, meta, cfg:poll.config, ses:normSession(poll.session)||{}, votes:poll.votes||{}, actions:poll.actions||{}, now:Date.now()});
    if(!payload.respondents && !confirm("This set has no answers in its current round. Export anyway?")) return;
    saveResults(payload, meta, kind);
  }catch(e){ alert("Export failed: "+(e&&e.message||e)); } }

function importResults(text, fname){
  let p=null; try{ p=JSON.parse(text); }catch(e){ alert("That file is not valid JSON."); return; }
  if(!p || !Array.isArray(p.questions) || !p.questions.length){ alert("No questions found in that file. Load a JSON saved by Tally Room."); return; }
  const qs=p.questions.map(C.reviveQuestion);
  const votes={};
  (Array.isArray(p.answers)?p.answers:[]).forEach((r,i)=>{ const a={};
    qs.forEach(qu=>{ const v=r && r.answers ? r.answers[qu.id] : null; if(Number.isFinite(v)) a[qu.id]=v; });
    const tx={}; qs.forEach(qu=>{ const t=r&&r.texts?r.texts[qu.id]:null; if(typeof t==="string"&&t.trim()) tx[qu.id]=t; });
    const cf={}; qs.forEach(qu=>{ const c=r&&r.confidence?r.confidence[qu.id]:null; if(Number.isFinite(c)) cf[qu.id]=c; });
    if(Object.keys(a).length) votes[String((r&&r.respondent)||("R"+(i+1)))]={round:1, answers:a, texts:tx, conf:cf, revs:Object.fromEntries(qs.filter(qu=>isTraffic(qu)&&qu.rev>1&&a[qu.id]!=null).map(qu=>[qu.id,qu.rev])), ...(C.isNamed(p.named)&&r&&r.respondent?{name:String(r.respondent)}:{}), t:Date.parse((r&&r.at)||"")||Date.now()}; });
  if(!Object.keys(votes).length && !confirm("That file has questions but no answers. Open it anyway?")) return;
  S.review={ live:{cfg:S.cfg, ses:S.ses, votes:S.votes, actions:S.actions},
    info:{ title:String(p.title||"Saved results"), n:Object.keys(votes).length, file:String(fname||""), named:C.isNamed(p.named)?p.named:"no", category:(p.set&&p.set.category)||"generic",
           exportedAt:String(p.exportedAt||"").slice(0,16).replace("T"," ") } };
  S.cfg={ tlYellow:p.followUps&&p.followUps.yellow||"", tlRed:p.followUps&&p.followUps.red||"", mode:p.mode==="batch"?"batch":"live", questions:qs };
  S.ses={ phase:"summary", current:0, revealed:qs.map(q=>q.id), round:1, showLive:true, outcome:C.reviveOutcome({...p, questions:p.questions.map((q,i)=>({...q, id:qs[i].id}))}), resetAt:(S.review.live.ses&&S.review.live.ses.resetAt)||0 };
  S.votes=votes; S.actions=C.reviveActions(p,qs); S.ui.act={}; S.ui.view=null; S.ui.configOpen=false; render();
}
function reviewBanner(){ if(!S.review) return "";
  const i=S.review.info;
  return `<div class="banner" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">
    <span style="flex:1;min-width:220px">Reviewing saved results: ${esc(i.title)} · ${i.n} ${i.n===1?"respondent":"respondents"}${i.exportedAt?` · saved ${esc(i.exportedAt)}`:""}. The live poll is untouched.</span>
    <button class="btn sm" data-act="reviewPublish">Publish to the room</button><button class="btn sm ghost" data-act="reviewExit">Exit review</button></div>`;
}

/* ============ live data helpers ============ */
function connPill(){ return S.ui.offline ? `<span class="pill warn" title="Trying to reconnect"><span class="dot"></span>Reconnecting…</span>` : ""; }

/* ============ rendering ============ */
const RULES_MSG="The database does not allow reading question sets yet. Add the <b>sets</b> block to the database rules (tallyroom-setup.md, step 1.3) and reload this page.";
function brand(text){ return `<div class="brand"><span class="mark"><i></i></span>${esc(text==null?header():text)}</div>`; }
function notice(title, html, pulse){ return `<div class="p-wrap"><div class="topbar">${brand("Tally Room")}</div><div class="card big-wait">${pulse?`<div class="pulse"></div>`:""}${title?`<h2 style="font-size:24px">${esc(title)}</h2>`:""}<p class="meta">${html}</p></div></div>`; }
let lastHTML=null, typT=null;
function render(bg){
  let html, host=false;
  if(!S.booted){ html=notice("", "Connecting…", true); }
  else if(S.route==="signin"){ applyTheme(null); document.title="Tally Room"; html=signInHTML(); }
  else if(S.route==="set" && S.auth.error){ html=notice("Could not connect", "Check your connection and reload."); }
  else if(S.route==="home"){ applyTheme(null); document.title="Tally Room"; html=homeHTML(); }
  else if(S.metaErr){ html=notice("Cannot open this question set", RULES_MSG); }
  else if(!S.setId || S.meta===null){ applyTheme(null); document.title="Tally Room";
    html=notice("This question set does not exist (any more)", "Ask the presenter for a new link or QR code."+(S.me.isHost?` <a href="${esc(urlFor())}">All question sets</a>`:"")); }
  else if(S.meta===undefined || !S.cfg || !S.ses){ html=notice("", "Connecting…", true); }
  else { applyTheme(S.meta.accent); document.title=header(); host = S.me.isHost && S.ui.view!=="participant"; }
  const ae=document.activeElement, keep = (ae && ae.classList && (ae.classList.contains("tl-fu-in")||ae.classList.contains("open-in")||ae.classList.contains("act-in")||ae.id==="nameIn"||ae.id==="siEmail"||ae.id==="siPass")) ? {id:ae.id, a:ae.selectionStart, b:ae.selectionEnd} : null;
  const mc=document.querySelector("#modal .card"), mTop=mc?mc.scrollTop:0, wTop=window.scrollY;
  if(html==null) html = host ? hostHTML() : (expired() ? expiredHTML() : participantHTML());
  /* a background update that changes nothing on screen (a heartbeat, the clock) leaves the page alone: rebuilding it replays the chart animations, which shows as a flash */
  const same = bg===true && html===lastHTML && app.firstChild;
  lastHTML=html;
  if(same) app.querySelectorAll(":scope > #modal, :scope > #dlg, :scope > .save-err").forEach(n=>n.remove());
  else { S.rendering=true; try{ app.innerHTML = html; } finally { S.rendering=false; } }
  if(keep && !same){ const el=document.getElementById(keep.id); if(el){ el.focus(); try{ el.setSelectionRange(keep.a,keep.b); }catch(e){} } }
  if(host){ if(!same) afterHost(); paginateTL(); }
  clearTimeout(typT); if(host && !S.review){ const left=C.typingExpiry(S.votes, nowS()); if(left) typT=setTimeout(renderBg, left+300); }
  if(S.ui.configOpen) app.insertAdjacentHTML("beforeend", configHTML());
  if(S.ui.configOpen && mTop){ const nc=document.querySelector("#modal .card"); if(nc) nc.scrollTop=mTop; } // keep the form where it was
  if(S.ui.dlg){ app.insertAdjacentHTML("beforeend", dlgHTML()); afterDlg(); }
  if(S.ui.saveErr) app.insertAdjacentHTML("beforeend", `<div class="save-err" role="alert"><span>${esc(S.ui.saveErr)}</span><button class="btn sm" data-act="reload">Reload</button></div>`);
  if(wTop && Math.abs(window.scrollY-wTop)>2) window.scrollTo(0,wTop);
  if(S.ui.configOpen) app.querySelector("#modal")?.addEventListener("input", ()=>{ try{ readDraftFromDOM(); }catch(e){} }, {passive:true});
}
/* background updates (votes, session, reconnects, resize) must not rebuild a form or an open menu */
function renderBg(){
  if(S.ui.configOpen && document.getElementById("modal")) return;
  if(S.ui.dlg && document.getElementById("dlg")) return;
  if(document.querySelector("details.menu[open]")) return;
  render(true); }
function topbar(rightHTML){
  const ph=S.ses.phase; const live = ph!=="lobby";
  return `<div class="topbar">${brand()}
    <div class="controls">${rightHTML||""}${connPill()}<span class="pill ${live?"live":""}"><span class="dot"></span>${S.cfg.mode==="live"?"One at a time":"All first, then reveal"}</span></div></div>`;
}
function expiredBanner(){ if(!expired()) return "";
  return `<div class="banner" style="margin-bottom:12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap"><span style="flex:1;min-width:220px">Expired on ${esc(fmtDate(S.meta.expiresAt))}. Participants can no longer answer and this screen is read-only; results and exports still work.</span><button class="btn sm" data-act="setExtend" data-id="${esc(S.setId)}">Extend 3 days</button></div>`; }
function expiredHTML(){ const back = S.me.isHost ? `<button class="btn sm ghost" data-act="asHost">Back to presenter view</button>` : "";
  return `<div class="p-wrap"><div class="topbar">${brand()}${back}</div><div class="card big-wait"><h2 style="font-size:24px">This question set has expired</h2><p class="meta">Answers can no longer be given. If the presenter extends it, this page continues by itself.</p></div></div>`; }

/* ---- host ---- */
function hostHTML(){
  const ses=S.ses, cfg=S.cfg, Q=cfg.questions, ph=Q.length?ses.phase:"lobby"; const joined=joinedCount();
  const controls = `<a class="btn sm ghost" href="${esc(urlFor())}">All question sets</a>${fontCtl()}${ph!=="lobby"?`<button class="btn sm ghost" data-act="lobby">Back to lobby</button>`:""}<button class="btn sm ghost" data-act="config">Edit questions</button><button class="btn sm ghost" data-act="setSettings" data-id="${esc(S.setId)}">Settings</button><button class="btn sm ghost" data-act="asParticipant">View as participant</button>${signOutBtn()}`;
  let main="", side=sideHTML();
  if(ph==="lobby"){
    main=`<div class="card" style="padding:28px"><div class="eyebrow">${Q.length?"Ready to start":"No questions yet"} · ${esc(cap(S.meta.category))}</div><h1 style="font-size:clamp(26px,4vw,40px);margin-top:8px">${esc(header())}</h1>
      <p class="meta" style="margin:10px 0 22px">${Q.length} ${Q.length===1?"question":"questions"} · ${joined} ${joined===1?"person has":"people have"} joined. ${Q.length?"Share the QR code or link on the right.":"Add questions before you start."}</p>
      <div class="controls"><div class="seg" role="group" aria-label="Mode"><button data-act="mode" data-v="live" class="${cfg.mode==="live"?"on":""}">One question at a time</button><button data-act="mode" data-v="batch" class="${cfg.mode==="batch"?"on":""}">Answer all first, then reveal</button></div></div>
      <div class="controls" style="margin-top:22px">${Q.length?`<button class="btn primary" data-act="start">${cfg.mode==="live"?"Start with question 1":"Open all questions"}</button>`:`<button class="btn primary" data-act="config">Add questions</button>`}${Object.keys(S.votes).length&&!expired()?`<button class="btn ghost" data-act="reset">Clear previous answers</button>`:""}${exportBtns()}${mdBtn()}<button class="btn ghost" data-act="impPick">Open saved results</button><input type="file" id="impFile" accept=".json,application/json" style="display:none"><span class="spacer"></span>${expired()?"":`<button class="btn danger" data-act="hardReset">Reset session</button>`}</div></div>`;
  } else if(ph==="voting" && (cfg.mode==="live" || ses.revote)){
    const qu=Q[ses.current]; const vals=answersFor(qu.id); const revealed=ses.revealed.includes(qu.id), revoteOnly=!!ses.revote && cfg.mode==="batch";
    main=`<div class="card" style="padding:26px 26px 20px">${qnumHTML(ses.current,qu)}<div class="qtext">${esc(tx(qu.text))}</div>
      <div class="progress" style="margin:20px 0 6px"><div class="bar"><i style="width:${joined?Math.round(100*vals.length/joined):0}%"></i></div><b>${vals.length} / ${joined} answered</b></div>${waitingHTML([qu])}</div>
      <div class="card chart">${revealed||ses.showLive ? resultHTML(qu) : `<div class="hidden-note"><div class="pulse"></div><div>Answers are hidden until you reveal them. <span class="meta">${vals.length} in so far.</span></div></div>`}</div>
      ${isTraffic(qu)?trafficTable(Q,qu.id,false):""}${isTraffic(qu)&&(revealed||ses.showLive)?commentsHTML(qu):""}
      <div class="controls">${revoteOnly?"":`<button class="btn" data-act="prev" ${ses.current===0?"disabled":""}>← Previous</button>`}
        ${revealed?"":`<button class="btn primary" data-act="reveal">Reveal results</button>`}${editBtn(qu,revealed)}
        ${revoteOnly?`<span class="meta">Everyone is voting again on this proposal. Reveal to return to the results.</span>`:(ses.current<Q.length-1?`<button class="btn ${revealed?"primary":""}" data-act="next">Next question →</button>`:`<button class="btn ${revealed?"primary":""}" data-act="summary">${catNow()==="consent"?"Finish":"Show summary"}</button>`)}
        <span class="spacer"></span><label class="meta" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="showLive" data-act="showLive" ${ses.showLive?"checked":""}> show answers as they come in</label></div>`;
  } else if(ph==="voting" && cfg.mode==="batch"){
    const done = Object.values(currentRoundVotes()).filter(v=>Q.every(qu=>validAns(v,qu)!=null)).length;
    const total=Q.reduce((n,qu)=>n+answersFor(qu.id).length,0), expected=joined*Q.length;
    main=`<div class="card" style="padding:28px"><div class="eyebrow">Collecting answers</div><h2 style="font-size:28px;margin-top:8px">Everyone answers all ${Q.length} questions on their own device</h2>
      <div class="progress" style="margin:22px 0 8px"><div class="bar"><i style="width:${expected?Math.min(100,Math.round(100*total/expected)):0}%"></i></div><b>${total} / ${expected} answers</b></div>
      <div class="progress" style="margin:8px 0 8px"><div class="bar"><i style="width:${joined?Math.round(100*done/joined):0}%"></i></div><b>${done} / ${joined} people finished</b></div>${waitingHTML(Q)}
      <p class="meta" style="margin:4px 0 0">${Q.length} questions × ${joined} ${joined===1?"person":"people"} = ${expected} answers expected.</p>
      <p class="meta">Results stay hidden until you start revealing them, one question at a time.</p>
      <div class="controls" style="margin-top:18px"><button class="btn primary" data-act="startReveal">Start revealing results</button><button class="btn ghost" data-act="lobby">Back to lobby</button></div></div>`;
  } else if(ph==="results"){
    const qu=Q[ses.current]; const vals=answersFor(qu.id);
    main=`<div class="card" style="padding:26px 26px 20px">${qnumHTML(ses.current,qu)}<div class="qtext">${esc(tx(qu.text))}</div></div>
      <div class="card chart">${resultHTML(qu)}</div>
      ${isTraffic(qu)?trafficTable(Q,qu.id,true)+commentsHTML(qu):""}
      <div class="controls"><button class="btn" data-act="prev" ${ses.current===0?"disabled":""}>← Previous</button>
        ${editBtn(qu,true)}${ses.current<Q.length-1?`<button class="btn primary" data-act="next">Next question →</button>`:`<button class="btn primary" data-act="summary">${catNow()==="consent"?"Finish":"Show summary"}</button>`}</div>`;
  } else if(ph==="summary" && catNow()==="consent"){
    main=closingHTML();
  } else if(ph==="summary"){
    const rows = Q.map((qu,i)=>({qu,i,st:stats(answersFor(qu.id),qu.min,qu.max)}));
    const sorted=[...rows].filter(r=>!isTraffic(r.qu)).sort((a,b)=>sumScore(b)-sumScore(a));
    const selQ=Q.find(x=>x.id===S.ui.sumSel && isTraffic(x));
    const tlT=trafficTable(Q,selQ?selQ.id:null,true,true);
    const detail=selQ?`<div class="card" id="tl-detail" style="padding:26px 26px 20px"><div class="qnum">Question ${Q.indexOf(selQ)+1} of ${Q.length}</div><div class="qtext">${esc(tx(selQ.text))}</div></div><div class="card chart">${chartHTML(selQ,answersFor(selQ.id))}</div>${commentsHTML(selQ,true)}`:"";
    main=`${detail}${tlT}${tlT&&!selQ?`<div class="meta" style="margin:-6px 4px 0">Click a row for the detailed view.</div>`:""}<div class="card" style="padding:26px"><div class="eyebrow">Summary</div>${sorted.length?`<h2 style="font-size:28px;margin-top:6px">${tlT?"Other questions":`All ${Q.length} questions`}, highest average or agreement first</h2>`:""}
      <div style="margin-top:14px">${sorted.map(r=>`<div class="sum-row"><div class="t">${esc(tx(r.qu.text))}<small>Q${r.i+1} · ${r.st.n} answers · ${sumNote(r)}</small></div>${miniStrip(r.qu,answersFor(r.qu.id))}<div class="m">${sumMetric(r)}</div></div>`).join("")}</div>
      <div class="controls" style="margin-top:18px"><button class="btn" data-act="gotoResults" data-v="0">Back to question 1</button><button class="btn ghost" data-act="lobby">Back to lobby</button>${exportBtns()}<span class="spacer"></span>${expired()?"":`<button class="btn danger" data-act="reset">Clear all answers</button>`}</div></div>`;
  }
  return `<div class="wrap">${topbar(controls)}${reviewBanner()}${expiredBanner()}${S.ui.readonly?`<div class="banner" style="margin-bottom:12px">You can see this session but this account is not allowed to change it.</div>`:""}<div class="stage two"><div class="stage">${main}</div>${side}</div></div>`;
}
function qnumHTML(i, qu){ return `<div class="qnum">Question ${i+1} of ${S.cfg.questions.length}${(qu.rev||1)>1?` · version ${esc(qu.rev)}`:""}</div>`; }
/* named sets: who still has to answer, behind a click so it is not on the projector by default */
function waitingHTML(qs){ if(!C.isNamed(namedMode())) return "";
  const w=Object.values(currentRoundVotes()).filter(v=>!qs.every(qu=>validAns(v,qu)!=null)).map(nameLabel); if(!w.length) return "";
  return `<details class="waiting" id="waitBox" ${S.ui.waitOpen?"open":""}><summary>Waiting for ${w.length}</summary><div class="people">${w.map(n=>`<span class="chip">${esc(n)}</span>`).join("")}</div></details>`; }
/* consent sets: a revealed proposal with at least one yellow or red vote can be rewritten and voted on again */
function editBtn(qu, revealed){ if(!revealed || !isTraffic(qu) || catNow()!=="consent" || S.review || expired()) return "";
  const c=C.trafficCounts(currentRoundVotes(),qu,qu.rev||1);
  return (c.r>0 || c.y>0) ? `<button class="btn" data-act="qEdit" data-q="${esc(qu.id)}">Edit</button>` : ""; }
const cmLi = c => `<li${c.writing?` class="wr"`:""}>${c.name?`<b>${esc(c.name)}</b> · `:""}${c.writing?"✎ writing…":esc(c.text)}</li>`; // a comment that is being changed shows when it is finished
const LIGHTS={green:[TL_COLORS[0],"Green"], yellow:[TL_COLORS[1],"Yellow"], red:[TL_COLORS[2],"Red"], none:["var(--line-2)","No votes"]};
function lightHTML(status){ const m=LIGHTS[status]||LIGHTS.none; return `<span class="light" style="--c:${m[0]}">${m[1]}</span>`; }
function countsHTML(c){ return `<div class="tl-cnt">${["g","y","r"].map((k,i)=>`<span style="--c:${TL_COLORS[i]}">${esc(c[k]||0)}</span>`).join("")}</div>`; }
/* ---- follow-up actions (backlog F): one row per yellow or red remark, with action, owner and deadline ---- */
/* what is stored, with what is being typed on this screen laid over it */
function shownActions(){ const out={...S.actions}; Object.entries(S.ui.act||{}).forEach(([k,d])=>{ out[k]={...(out[k]||{}),...d}; }); return out; }
function actionGroupsNow(){ return C.actionGroups(S.cfg, S.ses, currentRoundVotes(), namedMode(), shownActions()); }
function actionsHTML(){
  const ro=!!S.review || expired(), groups=actionGroupsNow(), tot=C.actionTotals(groups), openOnly=S.ui.actFilter==="open";
  if(!tot.total) return `<div class="card big-wait"><h2 style="font-size:24px">No concerns or objections to follow up.</h2></div>`;
  const names=C.isNamed(namedMode()) ? [...new Set(Object.values(currentRoundVotes()).map(v=>v.name).filter(Boolean))] : [];
  const raw=(r,f)=>{ const d=(S.ui.act||{})[r.key]; return d && d[f]!=null ? d[f] : r[f]; }; // while typing, show exactly what was typed
  const bar=`<div class="card" style="padding:16px 20px"><div class="controls"><b>${tot.done} of ${tot.total} ${tot.total===1?"remark":"remarks"} handled</b>
      <div class="seg" role="group" aria-label="Show"><button data-act="actFilter" data-v="all" class="${openOnly?"":"on"}">All</button><button data-act="actFilter" data-v="open" class="${openOnly?"on":""}">Open only (${tot.open})</button></div>
      <span class="spacer"></span><button class="btn" data-act="expActMD">Export actions as Markdown</button></div>
    ${ro?`<p class="meta" style="margin:10px 0 0">${S.review?"Saved results: the actions can be read and exported, not changed.":"This set has expired: extend it to change the actions."}</p>`:`<p class="meta" style="margin:10px 0 0">Type a follow-up action, an owner and a deadline per remark. Everything is saved as you type.</p>`}</div>
    ${names.length?`<datalist id="actOwners">${names.map(n=>`<option value="${esc(n)}"></option>`).join("")}</datalist>`:""}`;
  const cards=groups.map(g=>{ const rows=g.rows.filter(r=>!openOnly || r.state==="open" || (S.ui.act||{})[r.key]); if(!rows.length) return "";
    return `<div class="card act-card"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div class="qnum" style="flex:1">Proposal ${g.n}${g.rev>1?` · version ${esc(g.rev)}`:""}</div>${lightHTML(g.status)}</div>
      <div class="qtext">${esc(tx(g.text))}</div>
      ${rows.map(r=>{ const k=esc(r.key), off=ro||r.none?"disabled":"", lab=`${r.v===3?"objection":"concern"}${r.name?" of "+esc(r.name):""}`;
        return `<div class="act-row ${r.state}"><div class="act-remark"><span class="light sm" style="--c:${TL_COLORS[r.v-1]}"></span>${r.name?`<b>${esc(r.name)}</b> · `:""}${esc(r.text)}</div>
          <div class="act-fields"><textarea class="act-in" id="af_action_${k}" data-key="${k}" data-f="action" maxlength="300" rows="2" placeholder="Follow-up action" aria-label="Follow-up action for the ${lab}" ${off}>${esc(raw(r,"action"))}</textarea>
            <input class="act-in" type="text" id="af_owner_${k}" data-key="${k}" data-f="owner" maxlength="60" placeholder="Owner" aria-label="Owner of the action for the ${lab}" value="${esc(raw(r,"owner"))}" ${names.length?`list="actOwners"`:""} ${off}>
            <input class="act-in" type="date" id="af_due_${k}" data-key="${k}" data-f="due" aria-label="Deadline of the action for the ${lab}" value="${esc(r.due)}" ${off}></div>
          <div class="act-foot"><label><input type="checkbox" class="act-in" id="af_none_${k}" data-key="${k}" data-f="none" ${r.none?"checked":""} ${ro?"disabled":""}> No action needed</label><small id="as_${k}">${(S.ui.actSaved||{})[r.key]>Date.now()-4000?"Saved":""}</small></div></div>`; }).join("")}</div>`; }).join("");
  return `${bar}${cards||`<div class="card big-wait"><p class="meta">Every remark is handled.</p></div>`}`;
}
const actTimers={};
function actSet(key, f, val){ S.ui.act=S.ui.act||{}; S.ui.act[key]={...(S.ui.act[key]||{}), [f]:val}; }
/* keepDraft: the field still has the cursor, so what is on screen stays exactly as typed */
function actSave(key, keepDraft){ clearTimeout(actTimers[key]); const d=(S.ui.act||{})[key]; if(!d || S.review || expired()) return;
  const obj=C.cleanAction({...(S.actions[key]||{}), ...d, t:Date.now()}); S.actions={...S.actions, [key]:obj}; if(!keepDraft) delete S.ui.act[key];
  S.ui.actSaved=S.ui.actSaved||{}; S.ui.actSaved[key]=Date.now(); const m=document.getElementById("as_"+key); if(m) m.textContent="Saved";
  write(()=>S.backend.setAction(key,obj)); }
function actionNote(){ const n=Object.values(S.actions||{}).filter(a=>C.actionState(a)!=="open").length; return n ? ` ${n} recorded ${n===1?"action is":"actions are"} removed as well.` : ""; }
/* consent sets: the closing overview replaces the summary (backlog C3) */
function closingHTML(){
  const rows=C.consentRows(S.cfg,S.ses,currentRoundVotes(),namedMode()), tot=C.consentTotals(rows);
  const open=[...rows.filter(r=>r.status==="red"), ...rows.filter(r=>r.status==="yellow")], tab=["details","actions"].includes(S.ui.closeTab)?S.ui.closeTab:"overview", at=C.actionTotals(actionGroupsNow());
  const head=`<div class="card" style="padding:22px 26px"><div class="eyebrow">Outcome</div><h2 style="font-size:28px;margin-top:6px">${tot.green} green · ${tot.yellow} yellow · ${tot.red} red${tot.none?` · ${tot.none} without votes`:""}</h2>
    <div class="controls" style="margin-top:14px"><div class="seg" role="group" aria-label="View"><button data-act="closeTab" data-v="overview" class="${tab==="overview"?"on":""}">Overview</button><button data-act="closeTab" data-v="details" class="${tab==="details"?"on":""}">Details (${open.length})</button><button data-act="closeTab" data-v="actions" class="${tab==="actions"?"on":""}">Actions (${at.done} / ${at.total})</button></div>
      <span class="spacer"></span><button class="btn" data-act="expMD">Export as Markdown</button>${exportBtns()}</div></div>`;
  let body;
  if(tab==="actions"){ body=actionsHTML(); }
  else if(tab==="overview"){
    body=`<div class="card" style="padding:18px 20px"><table class="tl-table"><thead><tr><th>#</th><th>Proposal</th><th>Status</th></tr></thead><tbody>${rows.map(r=>{ const qu=S.cfg.questions[r.n-1];
      const cell = r.kind==="traffic" ? `${lightHTML(r.status)}${countsHTML(r.counts)}` : `<span class="meta">${(()=>{ const st=stats(answersFor(qu.id),qu.min,qu.max); return `${st.n} ${st.n===1?"answer":"answers"} · ${sumNote({qu,st})}`; })()}</span>`;
      return `<tr class="pick" data-act="gotoResults" data-v="${r.n-1}" title="Open this question"><td class="n">${r.n}</td><td>${esc(tx(r.text))}${r.edited?` <span class="edited">edited · version ${esc(r.rev)}</span>`:""}</td><td class="r">${cell}</td></tr>`; }).join("")}</tbody></table><div class="tl-pager" hidden></div></div>
      <div class="meta" style="margin:-6px 4px 0">Click a row to open that question.</div>`;
  } else if(!open.length){
    body=`<div class="card big-wait"><h2 style="font-size:24px">No concerns or objections left.</h2></div>`;
  } else {
    body=open.map(r=>{ const red=r.comments.filter(c=>c.v===3), yel=r.comments.filter(c=>c.v===2);
      const blk=(v,list)=>list.length?`<div><h3 style="--c:${TL_COLORS[v-1]}">${esc(tlPrompt(v))} (${list.length})</h3><ul>${list.map(cmLi).join("")}</ul></div>`:"";
      const hist=r.history.length?`<details class="hist"><summary>Earlier versions (${r.history.length})</summary>${r.history.map(h=>`<div class="hist-v"><div class="meta">Version ${esc(h.rev)} · ${esc(h.counts.g)} green, ${esc(h.counts.y)} yellow, ${esc(h.counts.r)} red</div><div class="hist-t">${esc(tx(h.text))}</div>${h.comments.length?`<ul>${h.comments.map(c=>`<li><span class="light sm" style="--c:${TL_COLORS[c.v-1]}"></span>${c.name?`<b>${esc(c.name)}</b> · `:""}${esc(c.text)}</li>`).join("")}</ul>`:""}</div>`).join("")}</details>`:"";
      return `<div class="card" style="padding:22px 26px"><div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div class="qnum" style="flex:1">Proposal ${r.n}${r.edited?` · version ${esc(r.rev)}`:""}</div>${lightHTML(r.status)}${countsHTML(r.counts)}</div>
        <div class="qtext">${esc(tx(r.text))}</div><div class="tl-cm" style="padding:14px 0 0">${blk(3,red)}${blk(2,yel)}${red.length||yel.length?"":`<p class="meta">No comments on this version.</p>`}</div>${hist}</div>`; }).join("");
  }
  return `${head}${body}<div class="controls"><button class="btn" data-act="gotoResults" data-v="0">Back to question 1</button><button class="btn ghost" data-act="lobby">Back to lobby</button><span class="spacer"></span>${expired()||S.review?"":`<button class="btn danger" data-act="reset">Clear all answers</button>`}</div>`;
}
function sideHTML(){
  const url = joinUrl(S.setId, S.meta);
  const rv=currentRoundVotes(); const Q=S.cfg.questions;
  const dots = Object.values(rv).map(v=>{ const k=Q.filter(q=>validAns(v,q)!=null).length; return C.isNamed(namedMode()) ? `<span class="chip ${k===Q.length&&Q.length?"done":""}" title="${k}/${Q.length} answered">${esc(nameLabel(v))}</span>` : `<i class="${k===Q.length?"done":(k?"on":"on")}" title="${k}/${Q.length}"></i>`; }).join("");
  return `<aside class="card side"><div><div class="eyebrow">Join</div><p class="meta" style="margin:4px 0 10px">Scan or open the link. No login needed.</p><div class="qr" id="qr"></div><div class="link" style="margin-top:8px">${esc(url)}</div></div>
    <div><div class="eyebrow">In the room</div><p class="meta" style="margin:4px 0 8px">${Object.keys(rv).length} joined · round ${esc(S.ses.round)}</p><div class="people">${dots||'<span class="meta">Nobody yet</span>'}</div></div></aside>`;
}
function paginateTL(){
  const tb=document.querySelector(".tl-table"); if(!tb || !tb.tBodies[0]) return;
  const rows=[...tb.tBodies[0].rows]; rows.forEach(r=>{ r.style.display=""; });
  const vh=window.innerHeight||document.documentElement.clientHeight||0;
  if(!vh || !tb.offsetHeight){ const pg0=tb.closest(".card").querySelector(".tl-pager"); if(pg0) pg0.hidden=true; return; } // not laid out (hidden tab): show everything
  const card=tb.closest(".card"), pager=card.querySelector(".tl-pager"), head=tb.tHead.offsetHeight;
  const top=card.getBoundingClientRect().top+window.scrollY, summary=S.ses.phase==="summary";
  const avail = summary ? Math.max(300,vh-230) : Math.max(300, vh-top-110);
  const pages=[]; let cur=[], h=head;
  rows.forEach((r,i)=>{ const rh=r.offsetHeight; if(cur.length && h+rh>avail){ pages.push(cur); cur=[]; h=head; } cur.push(i); h+=rh; });
  pages.push(cur);
  const ci=rows.findIndex(r=>r.classList.contains("cur")), cid=ci>=0?rows[ci].querySelector("[data-q]")?.dataset.q||ci:null;
  if(ci>=0 && S.ui.tlFollow!==cid){ S.ui.tlFollow=cid; S.ui.tlPage=pages.findIndex(pg=>pg.includes(ci)); }
  if(ci<0) S.ui.tlFollow=null;
  const pg=clamp(S.ui.tlPage||0,0,pages.length-1); S.ui.tlPage=pg;
  rows.forEach((r,i)=>{ if(!pages[pg].includes(i)) r.style.display="none"; });
  if(pages.length>1){ pager.hidden=false;
    pager.innerHTML=`<button class="btn sm" data-act="tlPrev" ${pg===0?"disabled":""}>← Previous</button><span>Rows ${pages[pg][0]+1}–${pages[pg][pages[pg].length-1]+1} of ${rows.length} · page ${pg+1} / ${pages.length}</span><button class="btn sm" data-act="tlNext" ${pg===pages.length-1?"disabled":""}>Next →</button>`; }
  else pager.hidden=true;
}
let rzT=null; window.addEventListener("resize",()=>{ clearTimeout(rzT); rzT=setTimeout(()=>{ if(S.route==="set"&&S.cfg&&S.ses&&S.me.isHost) renderBg(); },250); });
let qrCache={};
function afterHost(){
  const el=document.getElementById("qr"); if(!el) return;
  const url = joinUrl(S.setId, S.meta);
  try{ if(qrCache[url]){ el.innerHTML=`<img src="${qrCache[url]}" width="180" height="180" alt="QR code">`; return; } if(window.QRCode){ el.innerHTML=""; new QRCode(el,{text:url,width:180,height:180,colorDark:"#1E1838",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M}); const cv=el.querySelector("canvas"); try{ if(cv) qrCache[url]=cv.toDataURL("image/png"); }catch(e){} } else el.innerHTML=`<div class="meta">QR unavailable</div>`; }catch(e){ el.innerHTML=`<div class="meta">QR unavailable</div>`; }
}

/* ---- participant ---- */
function myVotes(){ const v=S.votes[S.me.id]; /* Firebase drops empty objects, so a vote doc from the lobby comes back without answers/texts */
  if(!(v && v.round===S.ses.round)) return {round:S.ses.round, answers:{}, texts:{}};
  const m={...v, answers:{...(v.answers||{})}, texts:{...(v.texts||{})}};
  /* an answer on an earlier version of a proposal is gone: the choice and the follow-up start empty */
  S.cfg.questions.forEach(qu=>{ if(isTraffic(qu) && !C.answerIsCurrent(v,qu.id,qu.rev)){ delete m.answers[qu.id]; delete m.texts[qu.id]; } });
  return m; }
function openDraft(qu){ const k=txKey(qu.id); return S.ui.tx && S.ui.tx[k]!=null ? S.ui.tx[k] : String(myVotes().texts?.[qu.id]||""); }
function openInputHTML(qu){ const val=openDraft(qu), saved=String(myVotes().texts?.[qu.id]||"").trim(), max=qu.maxLen||C.OPEN_MAX;
  return `<div class="tl-fu"><label for="op_${esc(qu.id)}">Your answer</label><textarea class="open-in" id="op_${esc(qu.id)}" data-q="${esc(qu.id)}" data-saved="${esc(saved)}" maxlength="${max}" rows="4" placeholder="Type your answer here">${esc(val)}</textarea>
    <div class="controls"><button class="btn primary" data-act="openSubmit" data-q="${esc(qu.id)}" id="ops_${esc(qu.id)}" ${val.trim()&&val.trim()!==saved?"":"disabled"}>${saved?"Update answer":"Submit"}</button><small id="opn_${esc(qu.id)}">${val.length} / ${max}</small></div></div>`; }
/* dilemma: the choice and the confidence are picked first and sent together with Submit */
function dlDraft(qu){ const d=(S.ui.dl||{})[txKey(qu.id)]||{}, m=myVotes(); return { a:d.a!=null?d.a:m.answers[qu.id], c:d.c!=null?d.c:(m.conf||{})[qu.id] }; }
function dilemmaInputHTML(qu){ const d=dlDraft(qu), m=myVotes(), cf=qu.conf||C.DEFAULT_CONF, cpts=cf.max-cf.min+1;
  const saved=validAns(m,qu)!=null, dirty=d.a!==m.answers[qu.id] || d.c!==(m.conf||{})[qu.id], ready=Number.isFinite(d.a)&&Number.isFinite(d.c);
  let ob="", cb="";
  qu.options.forEach((o,i)=>{ const v=i+1; ob+=`<button data-act="dlPick" data-q="${esc(qu.id)}" data-v="${v}" class="${d.a===v?"on":""}" style="--c:var(--accent);--sel-ink:var(--accent-ink)" aria-pressed="${d.a===v}"><b>${v}</b><span>${esc(tx(o))}</span></button>`; });
  for(let c=cf.min,j=0;c<=cf.max;c++,j++) cb+=`<button data-act="dlConf" data-q="${esc(qu.id)}" data-v="${c}" class="${d.c===c?"on":""}" style="--c:${rampColor(j,cpts)};--sel-ink:${selInk(j,cpts)}" aria-pressed="${d.c===c}">${c}</button>`;
  return `<div class="scale opts" style="grid-template-columns:1fr">${ob}</div>
    <div class="dl-conf">${esc(tx(cf.text))}</div>
    <div class="scale" style="margin-top:8px;grid-template-columns:repeat(${cpts>6?Math.ceil(cpts/2):cpts},minmax(0,1fr))">${cb}</div><div class="scale-ends"><span>${esc(tx(cf.lo))}</span><span>${esc(tx(cf.hi))}</span></div>
    <div class="controls" style="margin-top:16px"><button class="btn primary" data-act="dlSubmit" data-q="${esc(qu.id)}" ${ready&&(dirty||!saved)?"":"disabled"}>${saved?"Update answer":"Submit"}</button>${saved&&dirty?`<small style="color:var(--warn);font-weight:700">Changed, not sent yet.</small>`:""}</div>`; }
function answerHint(qu){ return isOpen(qu) ? "Type your answer and tap Submit." : isDilemma(qu) ? "Choose an option and your confidence, then tap Submit." : isOpt(qu) ? "Tap an option to answer." : "Tap a number to answer."; }
function scaleHTML(qu, chosen){
  if(isOpen(qu)) return openInputHTML(qu);
  if(isDilemma(qu)) return dilemmaInputHTML(qu);
  const pts=qu.max-qu.min+1; let b="";
  if(isOpt(qu)){
    for(let v=qu.min,i=0;v<=qu.max;v++,i++){ b+=`<button data-act="vote" data-q="${esc(qu.id)}" data-v="${v}" class="${chosen===v?"on":""}" style="--c:${qColor(qu,i,pts)};--sel-ink:${qInk(qu,i,pts)}" aria-pressed="${chosen===v}"><b>${v}</b><span>${esc(tx(qu.options[i]))}</span></button>`; }
    const again = (isTraffic(qu) && (qu.rev||1)>1 && !Number.isFinite(chosen)) ? `<div class="banner" style="margin-top:14px">The proposal was changed. Please vote again.</div>` : "";
    return `${again}<div class="scale opts" style="grid-template-columns:1fr">${b}</div>${isTraffic(qu)?followUpHTML(qu,chosen):""}`;
  }
  for(let v=qu.min,i=0;v<=qu.max;v++,i++){ b+=`<button data-act="vote" data-q="${esc(qu.id)}" data-v="${v}" class="${chosen===v?"on":""}" style="--c:${rampColor(i,pts)};--sel-ink:${selInk(i,pts)}" aria-pressed="${chosen===v}">${v}</button>`; }
  const cols = pts>6 ? Math.ceil(pts/2) : pts;
  return `<div class="scale" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${b}</div><div class="scale-ends"><span>${esc(tx(qu.lo))}</span><span>${esc(tx(qu.hi))}</span></div>`;
}
function txKey(qid){ const qu=S.cfg && S.cfg.questions.find(x=>x.id===qid); return (S.ses.round||1)+":"+qid+(qu && qu.rev>1 ? ":"+qu.rev : ""); } // drafts belong to one round and one version
function myText(qu){ const k=txKey(qu.id); return String(S.ui.tx && S.ui.tx[k]!=null ? S.ui.tx[k] : (myVotes().texts?.[qu.id]||"")).trim(); }
function needsText(qu,chosen){ return isTraffic(qu) && (chosen===2||chosen===3) && !myText(qu); }
/* the follow-up text of a yellow or red vote. It is sent when the participant stops typing for FU_IDLE, leaves the box
   or taps Done; until then the presenter only hears that someone is writing (see TYPING_MS in core.js) */
const FU_IDLE=4000, FU_PING=5000;
let typingOff=false, lastPing={};
function fuState(qid){ const k=txKey(qid), saved=String(myVotes().texts?.[qid]||""), draft = S.ui.tx && S.ui.tx[k]!=null ? S.ui.tx[k] : saved;
  return !draft.trim() ? "req" : (draft===saved ? "sent" : "draft"); }
function fuNoteText(st){ return st==="req" ? "Required: fill this in to continue to the next question."
  : st==="draft" ? "Not sent yet. It goes to the presenter when you pause or tap Done."
  : `Sent to the presenter${C.isNamed(namedMode())?"":", anonymous"}. You can still change it.`; }
function fuNote(qid){ const st=fuState(qid), m=document.getElementById("fus_"+qid), d=document.getElementById("fud_"+qid);
  if(m){ m.textContent=fuNoteText(st); m.classList.toggle("req", st==="req"); } if(d) d.disabled = st!=="draft"; }
function followUpHTML(qu, chosen){
  if(chosen!==2 && chosen!==3) return "";
  const k=txKey(qu.id), val = S.ui.tx && S.ui.tx[k]!=null ? S.ui.tx[k] : (myVotes().texts?.[qu.id]||""), st=fuState(qu.id);
  return `<div class="tl-fu"><label for="fu_${esc(qu.id)}">${esc(tlPrompt(chosen))}</label><textarea class="tl-fu-in" id="fu_${esc(qu.id)}" data-q="${esc(qu.id)}" maxlength="600" rows="3" placeholder="Type your answer here">${esc(val)}</textarea>
    <div class="fu-foot"><small id="fus_${esc(qu.id)}" class="${st==="req"?"req":""}" role="status">${esc(fuNoteText(st))}</small><button class="btn sm" id="fud_${esc(qu.id)}" data-act="fuDone" data-q="${esc(qu.id)}" ${st==="draft"?"":"disabled"}>Done</button></div></div>`;
}
/* tell the room that this device is typing, at most once per FU_PING. Under database rules from before this field the
   write is refused: the page then stops sending it and only holds the text back */
function typingPing(qid){ if(typingOff || S.review || !S.backend) return; const now=nowS(); if(now-(lastPing[qid]||0)<FU_PING) return;
  const mine=myVotes(); if(!Number.isFinite(mine.answers[qid]) || !Number.isFinite(mine.t)) return;
  lastPing[qid]=now; const doc={...mine, typing:{...(mine.typing||{}), [qid]:Math.round(now)}};
  writeChain=writeChain.then(()=>S.backend.setVotes(S.me.id,doc)).catch(e=>{ if(isDenied(e)) typingOff=true; else console.warn("typing flag not sent",e); }); }
function saveText(qid){ const val=(S.ui.tx||{})[txKey(qid)]; if(val==null || S.review) return; const mine=myVotes();
  if(!Number.isFinite(mine.answers[qid])) return;
  const same=(mine.texts&&mine.texts[qid])===val, flagged=lastPing[qid]!=null || (mine.typing && mine.typing[qid]!=null);
  if(same && !flagged) return;
  delete lastPing[qid];
  const next=C.withoutTyping({...mine, round:S.ses.round, answers:{...mine.answers}, texts:{...(mine.texts||{}),[qid]:val}, t:(same && Number.isFinite(mine.t))?mine.t:Date.now()}, qid);
  S.votes[S.me.id]=next; write(()=>S.backend.setVotes(S.me.id,next)); fuNote(qid); }
function flushFu(){ clearTimeout(fuTimer); document.querySelectorAll(".tl-fu-in").forEach(t=>saveText(t.dataset.q)); }
function commentsHTML(qu, always){
  if(!isTraffic(qu)) return "";
  const live=!S.review && !expired(), now=nowS(), rv=currentRoundVotes();
  const cm=C.trafficComments(rv,qu,namedMode(),live?now:NaN), y=cm.filter(c=>c.v===2), r=cm.filter(c=>c.v===3), w=live?C.trafficWriting(rv,qu,now):0;
  if(!always && !cm.length && !w) return "";
  const blk=(v,list,title)=>list.length?`<div><h3 style="--c:${TL_COLORS[v-1]}">${esc(title)} (${list.length})</h3><ul>${list.map(cmLi).join("")}</ul></div>`:(always?`<div><h3 style="--c:${TL_COLORS[v-1]}">${esc(title)} (0)</h3><p class="meta">No answers.</p></div>`:"");
  return `<div class="card tl-cm">${blk(2,y,tlPrompt(2))}${blk(3,r,tlPrompt(3))}${w?`<p class="tl-wr" role="status">✎ ${w} ${w===1?"person is":"people are"} still writing</p>`:""}</div>`;
}
/* named sets: "yes" asks for a name before anything else, "random" hands one out (see ensureName in bootSet) */
function needName(){ const nm=namedMode(); if(S.review || !C.isNamed(nm)) return false; return !S.me.name || (nm==="yes" && S.ui.nameEdit); }
function nameFormHTML(){ const nm=namedMode();
  if(nm==="random") return `<div class="card big-wait"><div class="pulse"></div><p class="meta">Getting your name…</p></div>`;
  const val = S.ui.nameDraft!=null ? S.ui.nameDraft : (S.me.name||"");
  return `<div class="card p-q"><h2 style="font-size:22px">${S.me.name?"Change your name":"What is your name?"}</h2>
    <div class="field" style="margin-top:14px"><label for="nameIn">Your name</label><input type="text" id="nameIn" maxlength="30" autocomplete="name" value="${esc(val)}">
      ${S.ui.nameErr?`<small style="color:var(--warn);font-weight:700" role="alert">${esc(S.ui.nameErr)}</small>`:""}<small class="meta">Your name is shown to the presenter with your answers.</small></div>
    <div class="controls" style="margin-top:14px"><button class="btn primary" data-act="nameSave">${S.me.name?"Save":"Join"}</button>${S.me.name?`<button class="btn ghost" data-act="nameCancel">Cancel</button>`:""}</div></div>`; }
function nameTag(){ const nm=namedMode(); if(S.review || !C.isNamed(nm) || !S.me.name) return "";
  return `<span class="pill" title="This name is shown with your answers">You are <b>${esc(S.me.name)}</b></span>${nm==="yes"&&!S.ui.nameEdit?`<button class="btn sm ghost" data-act="nameEdit">Change name</button>`:""}`; }
function setName(n){ S.me.name=n; S.me.nameAt=Date.now(); S.ui.nameEdit=false; S.ui.nameDraft=null; S.ui.nameErr="";
  try{ if(n) localStorage.setItem("tr_name_"+S.setId, JSON.stringify({n, at:S.me.nameAt})); else localStorage.removeItem("tr_name_"+S.setId); }catch(e){} }
/* every vote doc this device writes carries its name in a named set, and never in an anonymous one */
function stampDoc(doc){ if(C.isNamed(S.meta && S.meta.named) && S.me.name){ doc.name=S.me.name; doc.nameAt=S.me.nameAt||0; } else { delete doc.name; delete doc.nameAt; } return doc; }
function participantHTML(){
  const ses=S.ses, cfg=S.cfg, Q=cfg.questions, ph=Q.length?ses.phase:"lobby", mine=myVotes();
  if(ph!=="voting") S.ui.pq=null;
  const back = S.me.isHost ? `<button class="btn sm ghost" data-act="asHost">Back to presenter view</button>` : "";
  let body="";
  const ro = S.ui.readonly ? `<div class="banner">This account can watch but not vote (view-only access).</div>` : "";
  if(isKicked()){
    body=`<div class="card big-wait"><div class="pulse"></div><h2 style="font-size:24px">Session was reset</h2><p class="meta">The presenter cleared the room and started over. Tap to join again.</p>
      <div class="controls" style="margin-top:16px;justify-content:center"><button class="btn primary" data-act="rejoin">Join again</button></div></div>`;
  } else if(needName()){
    body=nameFormHTML();
  } else if(ph==="lobby"){
    body=`<div class="card big-wait"><div class="pulse"></div><h2 style="font-size:24px">You're in</h2>${C.isNamed(namedMode())&&S.me.name?`<p style="margin:0">You are <b>${esc(S.me.name)}</b>.${namedMode()==="random"?` <span class="meta">This name is shown with your answers instead of your own.</span>`:""}</p>`:""}<p class="meta">Waiting for the presenter to start.${Q.length?` ${Q.length} ${Q.length===1?"question":"questions"} coming up.`:""}</p></div>`;
  } else if(ph==="voting" && (cfg.mode==="live" || ses.revote)){
    const qu=Q[ses.current]; const chosen=mine.answers[qu.id]; const revealed=ses.revealed.includes(qu.id);
    body=`<div class="card p-q">${qnumHTML(ses.current,qu)}<div class="qtext">${esc(tx(qu.text))}</div>${revealed?"":scaleHTML(qu,chosen)}</div>
      ${revealed ? `<div class="card chart">${resultHTML(qu)}</div>` : (needsText(qu,chosen)?`<div class="toast wait">Required: answer the follow-up question above. Your vote counts once you have.</div>`:validAns(mine,qu)!=null?`<div class="toast">✓ Answer recorded${isOpen(qu)?"":`: ${esc(optLabel(qu,chosen))}`}. You can change it until results are revealed.</div>`:`<div class="toast wait">${answerHint(qu)}</div>`)}`;
  } else if(ph==="voting" && cfg.mode==="batch"){
    /* small phones: one question per screen, at the participant's own pace */
    const ok=Q.map(qu=>validAns(mine,qu)!=null), done=ok.filter(Boolean).length;
    let idx=S.ui.pq; if(idx==null){ idx=ok.indexOf(false); if(idx<0) idx=0; } idx=clamp(idx,0,Q.length-1); S.ui.pq=idx;
    const qu=Q[idx], last=idx===Q.length-1;
    body=`<div class="progress card" style="padding:14px 18px"><div class="bar"><i style="width:${Math.round(100*done/Q.length)}%"></i></div><b>${done} / ${Q.length}</b></div>
      <div class="card p-q"><div class="qnum">Question ${idx+1} of ${Q.length}</div><div class="qtext">${esc(tx(qu.text))}</div>${scaleHTML(qu,mine.answers[qu.id])}</div>
      <div class="controls" style="justify-content:space-between"><button class="btn" data-act="pqPrev" ${idx===0?"disabled":""}>← Previous</button>${last?"":`<button class="btn ${ok[idx]?"primary":""}" data-act="pqNext" ${ok[idx]?"":"disabled"}>Next →</button>`}</div>
      ${done===Q.length?`<div class="toast">✓ All ${Q.length} answered. Your answers are saved; you can still go back and change them until the reveal starts.</div>`:(needsText(qu,mine.answers[qu.id])?`<div class="toast wait">Required: answer the follow-up question above. Your vote counts once you have.</div>`:`<div class="toast wait">${Q.length-done} to go. Answers save automatically.</div>`)}`;
  } else if(ph==="results"){
    const qu=Q[ses.current];
    body=`<div class="card p-q">${qnumHTML(ses.current,qu)}<div class="qtext">${esc(tx(qu.text))}</div></div><div class="card chart">${resultHTML(qu)}</div>${!isOpen(qu)&&validAns(mine,qu)!=null?`<div class="toast wait">You answered ${esc(optLabel(qu,mine.answers[qu.id]))}${isDilemma(qu)?`, confidence ${esc(mine.conf[qu.id])}`:""}.</div>`:""}`;
  } else if(ph==="summary"){
    const rows=Q.map((qu,i)=>({qu,i,st:stats(answersFor(qu.id),qu.min,qu.max)})).sort((a,b)=>sumScore(b)-sumScore(a));
    body=`<div class="card" style="padding:20px"><div class="eyebrow">Summary</div>${rows.map(r=>`<div class="sum-row"><div class="t">${esc(tx(r.qu.text))}<small>Q${r.i+1} · ${r.st.n} answers${isOpt(r.qu)&&r.st.n?` · most chosen: ${esc(optLabel(r.qu,r.st.mode))}`:""}</small></div>${miniStrip(r.qu,answersFor(r.qu.id))}<div class="m">${sumMetric(r)}</div></div>`).join("")}</div>`;
  }
  return `<div class="p-wrap"><div class="topbar">${brand()}${connPill()}${nameTag()}${fontCtl()}${back}</div>${ro}${body}</div>`;
}

/* ---- config ---- */
function qFieldsHTML(qu,i,cat){ const k=kindOf(qu), kinds=[...C.catRules(cat).kinds]; if(!kinds.includes(k)) kinds.push(k); // a type from before the category applied stays selectable
  const opts=(label,ph)=>`<div class="field"><label for="qopt${i}">${label}</label><textarea data-q="${i}" data-k="options" id="qopt${i}" rows="${Math.min(((qu.options||[]).length||2)+1,8)}" placeholder="${ph}">${esc((qu.options||[]).map(tx).join("\n"))}</textarea></div>`;
  const scale=(o,p,lab)=>`<div class="row"><div class="field"><label for="q${p}min${i}">${lab} from</label><input type="number" id="q${p}min${i}" data-q="${i}" data-k="${p}min" value="${o.min}" min="0" max="10"></div><div class="field"><label for="q${p}max${i}">to</label><input type="number" id="q${p}max${i}" data-q="${i}" data-k="${p}max" value="${o.max}" min="2" max="11"></div>
      <div class="field"><label for="q${p}lo${i}">Low end label</label><input type="text" id="q${p}lo${i}" data-q="${i}" data-k="${p}lo" value="${esc(tx(o.lo))}"></div><div class="field"><label for="q${p}hi${i}">High end label</label><input type="text" id="q${p}hi${i}" data-q="${i}" data-k="${p}hi" value="${esc(tx(o.hi))}"></div></div>`;
  let body="";
  if(k==="scale") body=scale(qu,"","Scale");
  else if(k==="options") body=opts("Options, one per line (2 to 11)","Option A&#10;Option B&#10;Option C");
  else if(k==="traffic") body=opts("Button labels for green, yellow, red (3 lines, optional)",esc(TL_LABELS.join("\n")).replace(/\n/g,"&#10;"));
  else if(k==="open") body=`<div class="row"><div class="field"><label for="qml${i}">Longest answer allowed (characters)</label><input type="number" id="qml${i}" data-q="${i}" data-k="maxLen" value="${qu.maxLen||C.OPEN_MAX}" min="20" max="2000"></div></div>`;
  else if(k==="dilemma"){ const cf=qu.conf||C.DEFAULT_CONF; body=opts("Options to choose from, one per line (2 to 11)","Option A&#10;Option B")
    +`<div class="field"><label for="qct${i}">Confidence question (answered together with the choice)</label><input type="text" id="qct${i}" data-q="${i}" data-k="ctext" value="${esc(tx(cf.text))}"></div>`+scale(cf,"c","Confidence scale"); }
  return `<div class="field"><label for="qk${i}">Type</label><select id="qk${i}" data-q="${i}" data-k="kind">${kinds.map(x=>`<option value="${x}" ${x===k?"selected":""}>${C.KIND_LABEL[x]}</option>`).join("")}</select></div>${body}`; }
function configHTML(){
  const d=S.ui.draft, cat=S.meta?S.meta.category:"generic";
  return `<div class="modal" id="modal"><div class="card" role="dialog" aria-label="Edit questions">
    <div style="display:flex;align-items:center;gap:10px"><h2 style="font-size:22px;flex:1">Questions</h2><button class="btn sm ghost" data-act="cfgClose">Close</button></div>
    <div class="field"><label>Mode</label><div class="seg"><button data-act="cfgMode" data-v="live" class="${d.mode==="live"?"on":""}">One question at a time</button><button data-act="cfgMode" data-v="batch" class="${d.mode==="batch"?"on":""}">Answer all first, then reveal</button></div></div>
    ${cat==="consent"||d.questions.some(isTraffic)?`<div class="field"><label for="cfgTlY">Traffic light: follow-up question when someone answers yellow</label><input type="text" id="cfgTlY" value="${esc(d.tlYellow||TL_Q_YELLOW)}"></div>
    <div class="field"><label for="cfgTlR">Traffic light: follow-up question when someone answers red</label><input type="text" id="cfgTlR" value="${esc(d.tlRed||TL_Q_RED)}"></div>`:""}
    <div style="display:grid;gap:12px">${d.questions.map((qu,i)=>`<div class="qcard" data-i="${i}">
      <div class="head"><span class="qnum">Question ${i+1}</span><button class="btn sm ghost" data-act="qUp" data-i="${i}" ${i===0?"disabled":""} title="Move up">↑</button><button class="btn sm ghost" data-act="qDown" data-i="${i}" ${i===d.questions.length-1?"disabled":""} title="Move down">↓</button><button class="btn sm danger" data-act="qDel" data-i="${i}">Remove</button></div>
      <textarea data-q="${i}" data-k="text" id="qt${i}" placeholder="Statement or question">${esc(tx(qu.text))}</textarea>
      ${qFieldsHTML(qu,i,cat)}</div>`).join("")}</div>
    <div class="controls"><button class="btn" data-act="qAdd">+ Add question</button><span class="meta">${esc(C.catName(cat))} set: new questions start as ${C.KIND_NAME[C.catRules(cat).add]}.</span><button class="btn ghost" data-act="qAdd5">+ Add five (1–5, agree scale)</button><button class="btn ghost" data-act="csvPick">Import questions from CSV</button><input type="file" id="cfgCsv" accept=".csv,.txt,text/csv,text/plain" style="display:none"></div><div class="meta">CSV: one question per row, appended to the list. First column is the statement; with no other columns every row becomes a 1–5 scale question. Optional header columns: <b>text, type</b> (scale (default), options, open, traffic or dilemma; types this set does not offer are skipped), <b>options</b> (separated by |), <b>min, max, lo, hi</b>. Comma or semicolon both work.</div>
    <details id="cfgJsonBox" ${S.ui.jsonOpen?"open":""}><summary>Import / export as JSON</summary><div class="field" style="margin-top:10px"><textarea id="cfgJson" rows="8" style="font-family:ui-monospace,monospace;font-size:13px">${esc(S.ui.jsonText ?? questionsJSON(d))}</textarea><div class="meta">Numeric: {"text","min","max","lo","hi"}. Named options: {"text","options":["…","…"]}. Open: {"text","kind":"open"}. Traffic light: {"text","kind":"traffic"}. Dilemma: {"text","kind":"dilemma","options":[…],"conf":{"text","min","max","lo","hi"}}. Types this set does not offer are skipped. With traffic-light questions the JSON is {"followUps":{"yellow":"…","red":"…"},"questions":[…]}; a plain list also works.</div><div class="controls"><button class="btn sm" data-act="cfgImport">Replace questions with this JSON</button></div></div></details>
    <div class="meta">Header, colour and expiry date are under Settings in the top bar. Changing a question's scale after people answered keeps their answers; removing a question drops its answers.</div>
    <div class="controls"><button class="btn primary" data-act="cfgSave">Save</button><button class="btn ghost" data-act="cfgClose">Cancel</button></div>
  </div></div>`;
}
function questionsJSON(d){ const qs=d.questions.map(exportQ);
  return JSON.stringify(d.questions.some(isTraffic) ? {followUps:{yellow:d.tlYellow||TL_Q_YELLOW, red:d.tlRed||TL_Q_RED}, questions:qs} : qs, null, 1); }
function readDraftFromDOM(){
  const d=S.ui.draft; const jb=document.getElementById("cfgJsonBox"); if(jb) S.ui.jsonOpen=jb.open; const jt=document.getElementById("cfgJson"); if(jt && jb && jb.open) S.ui.jsonText=jt.value;
  const ty=document.getElementById("cfgTlY"), tr=document.getElementById("cfgTlR"); if(ty) d.tlYellow=ty.value.trim(); if(tr) d.tlRed=tr.value.trim();
  const CK={ctext:"text",cmin:"min",cmax:"max",clo:"lo",chi:"hi"}, picked={};
  document.querySelectorAll("#modal [data-q][data-k]").forEach(el=>{ const i=+el.dataset.q, qu=d.questions[i]; if(!qu) return; const k=el.dataset.k;
    if(k==="options"){ qu.options=normOptions(el.value); return; }
    if(k==="kind"){ picked[i]=el.value; return; }
    if(CK[k]){ qu.conf={...(qu.conf||C.DEFAULT_CONF), [CK[k]]:(k==="cmin"||k==="cmax")?+el.value:el.value}; return; }
    qu[k] = (k==="min"||k==="max"||k==="maxLen") ? +el.value : el.value; });
  d.questions=d.questions.map((qu,i)=>C.shapeQuestion(qu, picked[i]||kindOf(qu)));
}

/* ============ presenter sign-in (backlog G1) ============ */
const signOutBtn = () => (S.be && !S.be.demo && S.auth.uid && !S.auth.anon) ? `<button class="btn sm ghost" data-act="signOut" title="Signed in as ${esc(S.auth.email)}">Sign out</button>` : "";
function notPresenterHTML(){ return `<div class="p-wrap"><div class="topbar">${brand("Tally Room")}</div><div class="card big-wait"><h2 style="font-size:24px">This account is not a presenter</h2>
  <p class="meta">${esc(S.auth.email)} is signed in, but it is not on the list of presenters. Ask the owner of this Tally Room to add it.</p><div class="controls"><button class="btn primary" data-act="signOut">Sign out</button></div></div></div>`; }
function signInHTML(){
  if(S.auth.uid && !S.auth.anon) return notPresenterHTML();
  const busy=!!S.ui.siBusy;
  return `<div class="p-wrap"><div class="topbar">${brand("Tally Room")}</div><div class="card p-q"><div class="eyebrow">Presenter</div><h2 style="font-size:22px;margin-top:6px">Sign in</h2>
    <div class="field" style="margin-top:14px"><label for="siEmail">Email</label><input type="email" id="siEmail" autocomplete="username" autocapitalize="none" spellcheck="false" value="${esc(S.ui.siEmail||"")}"></div>
    <div class="field" style="margin-top:12px"><label for="siPass">Password</label><input type="password" id="siPass" autocomplete="current-password">
      ${S.ui.siErr?`<small style="color:var(--warn);font-weight:700" role="alert">${esc(S.ui.siErr)}</small>`:""}${S.ui.siNote?`<small class="meta" role="status">${esc(S.ui.siNote)}</small>`:""}</div>
    <div class="controls" style="margin-top:14px"><button class="btn primary" data-act="signIn" ${busy?"disabled":""}>${busy?"Signing in…":"Sign in"}</button><button class="btn ghost" data-act="forgot" ${busy?"disabled":""}>Forgot password</button></div>
    <p class="meta" style="margin-top:14px">Participants do not sign in: they scan the QR code or open the link of a question set. <a href="${esc(urlFor({set:SET_ID}))}">Back</a></p></div></div>`; }
function signInError(e){ const c=String(e&&e.code||"");
  if(/network/.test(c)) return "Could not connect. Check your connection and try again.";
  if(/too-many-requests/.test(c)) return "Too many attempts. Wait a few minutes and try again.";
  if(/operation-not-allowed/.test(c)) return "Email and password sign-in is switched off in the Firebase project (tallyroom-setup.md, step 1).";
  return "Email or password is not right"; } // one message, without saying which of the two
async function doSignIn(){ const em=document.getElementById("siEmail"), pw=document.getElementById("siPass"), email=em?em.value.trim():"", pass=pw?pw.value:"";
  S.ui.siEmail=email; S.ui.siNote=""; if(!email || !pass){ S.ui.siErr="Email or password is not right"; render(); return; }
  S.ui.siErr=""; S.ui.siBusy=true; render();
  try{ await S.be.signIn(email, pass); }catch(e){ console.warn("sign-in failed", e&&e.code); S.ui.siErr=signInError(e); }
  S.ui.siBusy=false; if(S.route==="signin") render(); }
async function doForgot(){ const em=document.getElementById("siEmail"), email=em?em.value.trim():""; S.ui.siEmail=email; S.ui.siErr=""; S.ui.siNote="";
  if(!email){ S.ui.siErr="Type your email address first."; render(); document.getElementById("siEmail")?.focus(); return; }
  try{ await S.be.resetPassword(email); }catch(e){ console.warn("reset mail", e&&e.code); } // the answer never tells whether the address has an account
  S.ui.siNote="If this address has an account, a mail is on its way"; render(); }
/* the sign-in changed: who this device is, and whether it is the presenter (backlog G1, G2) */
function applyAuth(a){ const wasHost=S.me.isHost, wasId=S.me.id; S.auth=a; S.me.id=S.be.id; S.me.isHost=S.be.isHost;
  if(!S.booted) return;
  if(S.route==="signin"){ if(S.me.isHost){ try{ location.replace(urlFor({set:SET_ID})); }catch(e){} return; } render(); return; }
  if(wasHost===S.me.isHost && wasId===S.me.id) return;
  /* a presenter who signs out on a set page is a participant of that set from here on, without reload */
  S.ui.view=null; S.ui.dlg=null; S.ui.configOpen=false; S.ui.draft=null; if(!S.me.isHost){ S.actions={}; S.ui.act={}; S.review=null; }
  render(); if(S.heartbeat) setTimeout(S.heartbeat, 300); }

/* ============ overview of all question sets (presenter home) ============ */
const PHASE_LABEL={lobby:"In lobby", running:"Running", finished:"Finished"};
const cap = s => String(s||"").charAt(0).toUpperCase()+String(s||"").slice(1);
function homeHTML(){
  if(!S.me.isHost && S.auth.uid && !S.auth.anon) return notPresenterHTML();
  if(!S.me.isHost) return notice("Scan the QR code or open the link you received", "Each question set has its own link. Ask the presenter for the QR code."+(S.be&&S.be.demo?"":`<br><br><a href="${esc(urlFor({host:true}))}" style="font-size:13px">Presenter sign-in</a>`));
  const top=`<div class="topbar">${brand("Tally Room")}<div class="controls">${connPill()}${S.be&&S.be.demo?`<span class="pill warn">Demo data, this browser only</span>`:""}${signOutBtn()}</div></div>`;
  if(S.setsErr) return `<div class="wrap">${top}<div class="banner">${RULES_MSG}</div></div>`;
  if(!S.sets) return `<div class="wrap">${top}<div class="card big-wait"><div class="pulse"></div><p class="meta">Loading question sets…</p></div></div>`;
  const now=Date.now(), list=C.sortSets(S.sets, now);
  return `<div class="wrap">${top}<div class="card" style="padding:26px">
    <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap"><div style="flex:1;min-width:200px"><div class="eyebrow">Presenter</div><h1 style="font-size:clamp(24px,3.4vw,34px);margin-top:6px">Question sets</h1></div><button class="btn primary" data-act="setNew">New question set</button></div>
    <p class="meta" style="margin:8px 0 6px">${list.length} ${list.length===1?"set":"sets"}. Each set has its own link, QR code, header, colour and expiry date.</p>
    <div class="sets">${list.map(x=>setRowHTML(x.id,x.meta,now)).join("")||`<div class="empty">No question sets yet. Create the first one.</div>`}</div></div></div>`;
}
function setRowHTML(id, meta, now){
  const ex=C.expiryInfo(meta, now), st=S.polls[id], open=esc(urlFor({set:id})), eid=esc(id), isExp=ex.state==="expired";
  const exp = isExp ? `<span class="pill warn"><span class="dot"></span>Expired</span>`
    : ex.state==="soon" ? `<span class="pill warn">Expires in ${ex.hours} h</span>`
    : ex.state==="ok" ? `<span class="pill">Until ${esc(fmtDate(ex.at))}</span>` : `<span class="pill">No expiry date</span>`;
  const facts = st ? `${st.questions} ${st.questions===1?"question":"questions"} · ${st.respondents} ${st.respondents===1?"respondent":"respondents"} · ${PHASE_LABEL[st.phase]}` : "counting…";
  const name=tx(meta.name), head=tx(meta.header);
  return `<div class="set-row${isExp?" is-expired":""}">
    <span class="swatch" style="background:${esc(meta.accent)}" title="Accent colour ${esc(meta.accent)}"></span>
    <div class="set-main"><a class="set-name" href="${open}">${esc(name)}</a>
      <div class="meta">${head&&head!==name?`Header: ${esc(head)} · `:""}${esc(cap(meta.category))} · ${facts}${isExp?` · expired ${esc(fmtDate(ex.at))}`:""}</div></div>
    ${exp}
    <div class="controls">${isExp||ex.state==="soon"?`<button class="btn sm${isExp?" primary":""}" data-act="setExtend" data-id="${eid}" title="New expiry date: 3 days from now">Extend</button>`:""}
      <a class="btn sm${isExp?"":" primary"}" href="${open}">Open</a><button class="btn sm" data-act="setQR" data-id="${eid}">Show QR</button>
      <details class="menu"><summary class="btn sm" aria-label="More actions for ${esc(name)}">More</summary><div class="menu-list">
        <button data-act="setSettings" data-id="${eid}">Settings</button>
        <button data-act="setSettings" data-id="${eid}" data-focus="dlgExp">Other expiry date…</button>${isExp?"":`
        <button data-act="setExpire" data-id="${eid}">Expire now</button>`}
        <button data-act="setLink" data-id="${eid}">Change link…</button>
        <button data-act="setDup" data-id="${eid}">Duplicate</button>
        <button data-act="setExpQ" data-id="${eid}">Export questions</button>
        <button data-act="setExpJSON" data-id="${eid}">Export responses (JSON)</button>
        <button data-act="setExpCSV" data-id="${eid}">Export responses (CSV)</button>
        <button class="del" data-act="setDel" data-id="${eid}">Delete…</button></div></details></div></div>`;
}
let statsBusy=false;
async function loadStats(){ if(S.route!=="home" || !S.sets || statsBusy || document.visibilityState==="hidden") return; statsBusy=true;
  try{ await Promise.all(Object.keys(S.sets).map(async id=>{ try{ S.polls[id]=C.pollStats(await S.be.readPoll(id)); }catch(e){} })); } finally { statsBusy=false; }
  renderBg(); }
/* read fresh, so a set made on another device in the meantime is not overwritten */
function rnd(){ try{ const a=new Uint32Array(1); crypto.getRandomValues(a); return a[0]/4294967296; }catch(e){ return Math.random(); } }
const LINK_NOTE="Anyone who knows or guesses this link can join and see the results shown to the room.";
async function freshSetId(name){ const sets=await S.be.getSets(); return C.newSetId(name, id=>!!sets[id], rnd); }

/* ============ dialogs: set settings, QR code, delete ============ */
function toLocalInput(ts){ const d=new Date(ts), p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function closeDlg(){ S.ui.dlg=null; render(); }
function openSetDlg(id, focus){ const m=id?metaOf(id):null; if(id && !m) return;
  S.ui.dlg={ type:"set", id:id||null, focus:focus||(id?null:"dlgName"), title:id?"Settings of this question set":"New question set", imported:null,
    f: m ? {...m} : {name:"", header:"", accent:C.DEFAULT_ACCENT, category:"generic", named:"no", expiresAt:C.extendedExpiry(Date.now()), joinUrl:""} };
  render(); }
function dlgHTML(){ const d=S.ui.dlg; if(!d) return "";
  const body = d.type==="set" ? setDlgHTML(d) : d.type==="qr" ? qrDlgHTML(d) : d.type==="del" ? delDlgHTML(d) : d.type==="link" ? linkDlgHTML(d) : d.type==="edit" ? editDlgHTML(d) : "";
  return `<div class="modal" id="dlg"><div class="card dlg${d.type==="edit"?" wide":""}" role="dialog" aria-modal="true" aria-label="${esc(d.title)}">
    <div style="display:flex;align-items:center;gap:10px"><h2 style="font-size:22px;flex:1">${esc(d.title)}</h2><button class="btn sm ghost" data-act="dlgClose">Close</button></div>${body}</div></div>`; }
function setDlgHTML(d){ const f=d.f, isNew=!d.id, acc=C.normHex(f.accent)||C.DEFAULT_ACCENT;
  return `<div class="field"><label for="dlgName">Name (only you see this, in the overview)</label><input type="text" id="dlgName" maxlength="60" value="${esc(tx(f.name))}" placeholder="MT offsite, team B">
      ${isNew?`<div class="meta">The link of the set is this name plus four random characters (mt-offsite-team-b-x7k2). ${LINK_NOTE}</div>`:""}</div>
    <div class="field"><label for="dlgHeader">Header shown to the audience (leave empty to use the name)</label><input type="text" id="dlgHeader" maxlength="80" value="${esc(tx(f.header)===tx(f.name)?"":tx(f.header))}"></div>
    <div class="field"><label>Accent colour</label><div class="swatches">${C.ACCENT_PRESETS.map(([n,hex])=>`<button type="button" class="sw${hex===acc?" on":""}" data-act="dlgAccent" data-v="${hex}" style="background:${hex}" title="${n}" aria-label="${n}"></button>`).join("")}
      <label class="sw-custom">Other <input type="color" id="dlgColor" value="${acc.toLowerCase()}" aria-label="Pick another accent colour"></label></div></div>
    <div class="field"><label for="dlgCat">Category</label><select id="dlgCat">${C.CATEGORIES.map(c=>`<option value="${c}" ${f.category===c?"selected":""}>${cap(c)}</option>`).join("")}</select>
      <div class="meta">Decides which question types the set offers. Generic: scale, multiple choice, open. Consent adds the traffic light, Dilemma adds the dilemma question (choice plus confidence).</div></div>
    <div class="field"><label for="dlgNamed">Named respondents</label><select id="dlgNamed">${[["no","No: participants answer anonymously"],["yes","Yes: participants type their name"],["random","Random: each participant gets a name such as k1"]].map(([val,l])=>`<option value="${val}" ${(f.named||"no")===val?"selected":""}>${l}</option>`).join("")}</select>
      <div class="meta">With Yes or Random the presenter sees the name with comments and open answers, and in the exports.</div></div>
    <div class="field"><label for="dlgExp">Expires on</label><input type="datetime-local" id="dlgExp" value="${Number.isFinite(f.expiresAt)?toLocalInput(f.expiresAt):toLocalInput(C.extendedExpiry(Date.now()))}">
      <div class="controls"><span class="meta">From now:</span>${[[1,"1 day"],[3,"3 days"],[7,"1 week"],[30,"1 month"]].map(([n,l])=>`<button type="button" class="btn sm" data-act="dlgExpQuick" data-v="${n}">${l}</button>`).join("")}</div>
      <div class="meta">After this moment participants can no longer answer. Nothing is deleted and you can extend at any time.</div></div>
    ${isNew ? `<div class="field"><label>Start from a questions file (optional)</label><div class="controls"><button type="button" class="btn sm" data-act="dlgFilePick">Create from file…</button><input type="file" id="dlgFile" accept=".json,application/json" style="display:none"><span class="meta" id="dlgFileNote">A questions file exported from Tally Room. Without it the set starts empty.</span></div></div>`
            : `<div class="field"><label for="dlgJoin">Join link shown to participants (leave empty to use this set's own link)</label><input type="url" id="dlgJoin" value="${esc(f.joinUrl||"")}" placeholder="${esc(urlFor({set:d.id}))}"></div>`}
    <div class="controls"><button class="btn primary" data-act="dlgSave">${isNew?"Create and add questions":"Save"}</button><button class="btn ghost" data-act="dlgClose">Cancel</button></div>`; }
async function saveSetDlg(){ const d=S.ui.dlg, g=id=>document.getElementById(id), now=Date.now();
  const name=g("dlgName").value.trim(); if(!name){ alert("Give the set a name."); g("dlgName").focus(); return; }
  const exp=g("dlgExp").value ? new Date(g("dlgExp").value).getTime() : NaN; if(!Number.isFinite(exp)){ alert("Choose a valid expiry date and time."); g("dlgExp").focus(); return; }
  const fields={ name, header:g("dlgHeader").value.trim().slice(0,80), accent:C.normHex(g("dlgColor").value)||C.DEFAULT_ACCENT, category:g("dlgCat").value, named:g("dlgNamed").value, expiresAt:exp };
  try{
    if(d.id && fields.category!==d.f.category){ // a set can only move to a category that offers all its question types
      const qs=(S.route==="set" && S.cfg && !S.review) ? S.cfg.questions : C.normConfig((await S.be.readPoll(d.id)).config).questions;
      const bl=C.categoryBlockers(fields.category, qs); if(bl.length){ alert(C.blockerMessage(fields.category, bl)); return; } }
    if(d.id && fields.named!==(d.f.named||"no")){ // changing who is named while people are in the set
      const poll=await S.be.readPoll(d.id), votes=poll.votes||{}, n=Object.values(votes).filter(C.hasAnswers).length;
      if(n && !confirm(fields.named==="no" ? `${n} ${n===1?"person has":"people have"} answered. Their names are removed and no longer shown or exported. Continue?`
                                           : `${n} ${n===1?"person has":"people have"} answered already. They get a name (or are asked for one) the next time their screen changes; until then they show as "unnamed". Continue?`)) return;
      if(fields.named==="no" && Object.values(votes).some(v=>v && v.name)){ const clean={}; Object.entries(votes).forEach(([pid,v])=>{ if(!v) return; const c={...v}; delete c.name; delete c.nameAt; clean[pid]=c; }); await S.be.poll(d.id).setAllVotes(clean); } }
    if(d.id){ await S.be.patchMeta(d.id, {...fields, joinUrl:g("dlgJoin")?g("dlgJoin").value.trim():"", updatedAt:now}); closeDlg(); return; }
    const id=await freshSetId(name), imp=d.imported, cfg=C.emptyConfig();
    if(imp){ const f=C.filterForCategory(fields.category, imp.questions), msg=C.skippedMessage(fields.category, f.skipped);
      if(msg && !confirm(msg+"\n\nCreate the set without them?")) return;
      cfg.questions=f.kept; cfg.tlYellow=imp.tlYellow; cfg.tlRed=imp.tlRed; if(imp.set && imp.set.mode) cfg.mode=imp.set.mode; }
    await S.be.writePoll(id, {config:cfg, session:{...DEFAULT_SESSION}});
    await S.be.setMeta(id, C.newMeta(fields, now));
    location.href=urlFor({set:id, edit:true});
  }catch(e){ alert("Saving failed: "+(e&&e.message||e)); } }
function readSetFile(file){ const r=new FileReader(); r.onerror=()=>alert("Could not read that file.");
  r.onload=()=>{ const d=S.ui.dlg; if(!d || d.type!=="set") return; let imp=null;
    try{ imp=C.parseQuestionsFile(JSON.parse(String(r.result||""))); }catch(e){ alert("No questions found in that file. Use a questions file or results file saved by Tally Room."); return; }
    d.imported=imp; const s=imp.set||{}, g=id=>document.getElementById(id);
    if(s.name && !g("dlgName").value.trim()) g("dlgName").value=String(s.name).slice(0,60);
    if(s.header && s.header!==s.name) g("dlgHeader").value=String(s.header).slice(0,80);
    if(C.normHex(s.accent)){ g("dlgColor").value=C.normHex(s.accent).toLowerCase(); markSwatch(); }
    if(C.CATEGORIES.includes(s.category)) g("dlgCat").value=s.category;
    if(C.NAMED.includes(s.named)) g("dlgNamed").value=s.named;
    const note=g("dlgFileNote"); if(note) note.textContent=`${imp.questions.length} ${imp.questions.length===1?"question":"questions"} from ${file.name} will be added.`; };
  r.readAsText(file); }
function markSwatch(){ const c=document.getElementById("dlgColor"), v=c?C.normHex(c.value):null; document.querySelectorAll("#dlg .sw").forEach(b=>b.classList.toggle("on", b.dataset.v===v)); }

/* QR code as a PNG with a white margin; the on-screen code and the download use the same drawing */
function qrPng(url, size, margin, dark){ if(!window.QRCode) return null;
  try{ const box=document.createElement("div"); new QRCode(box,{text:url,width:size,height:size,colorDark:dark||"#1E1838",colorLight:"#ffffff",correctLevel:QRCode.CorrectLevel.M});
    const cv=box.querySelector("canvas"); if(!cv) return null; const out=document.createElement("canvas"); out.width=out.height=size+2*margin;
    const g=out.getContext("2d"); g.fillStyle="#ffffff"; g.fillRect(0,0,out.width,out.height); g.drawImage(cv,margin,margin); return out.toDataURL("image/png"); }catch(e){ return null; } }
function qrDlgHTML(d){ const m=metaOf(d.id), url=joinUrl(d.id,m);
  return `<p class="meta" style="margin:0">Participants scan this code or open the link. It always opens this set.</p>
    <div class="qr" id="dlgQr" style="justify-self:center"></div><div class="link">${esc(url)}</div>
    <div class="controls"><button class="btn primary" data-act="qrCopy">Copy link</button><button class="btn" data-act="qrPng">Download PNG</button><span class="meta" id="qrNote" role="status"></span></div>`; }
function afterDlg(){ const d=S.ui.dlg; if(!d) return;
  if(d.type==="qr"){ const el=document.getElementById("dlgQr"), src=qrPng(joinUrl(d.id,metaOf(d.id)),320,0); if(el) el.innerHTML = src ? `<img src="${src}" width="320" height="320" alt="QR code for ${esc(tx((metaOf(d.id)||{}).name))}">` : `<div class="meta">QR unavailable</div>`; }
  if(d.focus){ const el=document.getElementById(d.focus); d.focus=null; if(el) setTimeout(()=>{ try{ el.focus(); }catch(e){} },0); } }
async function openDelDlg(id){ if(!metaOf(id)) return; const st=S.polls[id];
  S.ui.dlg={type:"del", id, title:"Delete this question set?", st:st||null}; render();
  if(!st){ try{ const s=C.pollStats(await S.be.readPoll(id)); if(S.ui.dlg && S.ui.dlg.type==="del" && S.ui.dlg.id===id){ S.ui.dlg.st=s; render(); } }catch(e){} } }
function delDlgHTML(d){ const m=metaOf(d.id)||{}, st=d.st;
  return `<p style="margin:0"><b>${esc(tx(m.name))}</b> is removed from the database, with ${st?`its ${st.questions} ${st.questions===1?"question":"questions"} and the answers of ${st.respondents} ${st.respondents===1?"respondent":"respondents"}`:"its questions and all answers"}. Its link and QR code stop working. This cannot be undone.</p>
    <div class="controls"><button class="btn" data-act="setExpJSON" data-id="${esc(d.id)}">Export responses first</button><span class="spacer"></span><button class="btn ghost" data-act="dlgClose">Cancel</button><button class="btn danger-solid" data-act="delConfirm">Delete permanently</button></div>`; }
/* a set under another id, so under another link: for sets from before links followed the name, or after a rename */
function openLinkDlg(id){ const m=metaOf(id); if(!m) return; const sets=S.sets||{};
  S.ui.dlg={type:"link", id, title:"Change the link of this question set", focus:"dlgLink", v:C.newSetId(tx(m.name), x=>!!sets[x], rnd)}; render(); }
function linkDlgHTML(d){ const m=metaOf(d.id)||{}, st=S.polls[d.id], live=st && st.phase && st.phase!=="lobby";
  return `<p class="meta" style="margin:0">Now: <span style="word-break:break-all">${esc(urlFor({set:d.id}))}</span></p>
    <div class="field"><label for="dlgLink">New last part of the link</label><input type="text" id="dlgLink" maxlength="40" value="${esc(d.v)}" autocapitalize="none" spellcheck="false">
      <div class="meta">Lowercase letters, digits and dashes. Anything else is converted, so you can also type a title. The four characters at the end make the link hard to guess; keep them or type your own. ${LINK_NOTE}</div></div>
    <div class="banner"><b>${esc(tx(m.name))}</b> keeps its questions and answers, but the old link and QR code stop working. Anyone who has the set open has to join again through the new link.${live?" A session is running in this set right now.":""}${m.joinUrl?" This set shows its own join link to participants; check that it still points to the right place.":""}</div>
    <div class="controls"><button class="btn primary" data-act="dlgSave">Change link</button><button class="btn ghost" data-act="dlgClose">Cancel</button></div>`; }
async function saveLinkDlg(){ const d=S.ui.dlg, el=document.getElementById("dlgLink"), raw=el?el.value.trim():"";
  if(!raw || !/[a-z0-9]/i.test(raw.normalize("NFKD"))){ alert("Type the new last part of the link."); if(el) el.focus(); return; }
  const nid=C.slug(raw); if(nid===d.id){ closeDlg(); return; }
  try{ await S.be.moveSet(d.id, nid); if(S.polls[d.id]){ S.polls[nid]=S.polls[d.id]; delete S.polls[d.id]; }
    if(S.route==="set") location.href=urlFor({set:nid}); else closeDlg();
  }catch(e){ alert("Changing the link failed: "+(e&&e.message||e)); } }
async function duplicateSet(id){ const meta=metaOf(id); if(!meta) return;
  try{ const poll=await S.be.readPoll(id), d=C.duplicateSet(meta, poll.config, Date.now()), nid=await freshSetId(d.meta.name);
    await S.be.writePoll(nid, {config:d.config, session:{...DEFAULT_SESSION}}); await S.be.setMeta(nid, d.meta); loadStats();
  }catch(e){ alert("Duplicating failed: "+(e&&e.message||e)); } }
function extendSet(id){ const now=Date.now(); return S.be.patchMeta(id, {expiresAt:C.extendedExpiry(now), updatedAt:now}).catch(e=>alert("Extending failed: "+(e&&e.message||e))); }
/* ============ actions ============ */
/* consent sets: fix the light of the given proposals as the votes stand now (backlog C2).
   onlyMissing = leave lights that are already fixed for the current version; `always` = one proposal to fix anyway */
function outcomePatch(qs, onlyMissing, always){ if(catNow()!=="consent" || S.review) return {};
  let o={...(S.ses.outcome||{})}; const rv=currentRoundVotes(), now=Date.now();
  qs.forEach(qu=>{ if(!isTraffic(qu)) return; const cur=o[qu.id];
    if(onlyMissing && qu!==always && cur && (cur.rev||1)===(qu.rev||1)) return; o=C.fixOutcome(o,qu,rv,now); });
  return {outcome:o}; }
/* clearing the answers also clears the earlier versions of edited proposals; the last text stays */
function dropHistory(){ if(S.review) return;
  if(Object.keys(S.actions||{}).length){ S.actions={}; S.ui.act={}; write(()=>S.backend.clearActions()); } // the remarks go, so their actions go too
  if(S.cfg.questions.some(qu=>qu.history||qu.rev)) setConfig(C.clearHistory(S.cfg)); }
function editDlgHTML(d){ const i=S.cfg.questions.findIndex(x=>x.id===d.qid), qu=S.cfg.questions[i]; if(!qu) return "";
  const cm=C.trafficComments(currentRoundVotes(),qu,namedMode()), red=cm.filter(c=>c.v===3), yel=cm.filter(c=>c.v===2), rev=qu.rev||1;
  const blk=(v,list)=>list.length?`<div><h3 style="--c:${TL_COLORS[v-1]}">${esc(tlPrompt(v))} (${list.length})</h3><ul>${list.map(cmLi).join("")}</ul></div>`:"";
  return `<div class="field"><label for="dlgText">Proposal text${rev>1?` (now version ${rev})`:""}</label><textarea id="dlgText" rows="7" style="font-size:17px">${esc(tx(qu.text))}</textarea></div>
    <div class="tl-cm" style="padding:0">${blk(3,red)}${blk(2,yel)}</div>
    <div class="meta">Saving starts a new vote on this proposal: every participant gets the new text and votes again. The current text, votes and comments are kept as version ${rev}.</div>
    <div class="controls"><button class="btn primary" data-act="dlgSave">Save and re-vote</button><button class="btn ghost" data-act="dlgClose">Cancel</button></div>`; }
function saveEditDlg(){ const d=S.ui.dlg, i=S.cfg.questions.findIndex(x=>x.id===d.qid); if(i<0){ closeDlg(); return; }
  const qu=S.cfg.questions[i], el=document.getElementById("dlgText"), text=el?el.value.trim():""; if(!text){ alert("The proposal needs a text."); return; }
  const nq=C.editQuestion(qu, text, currentRoundVotes(), namedMode(), Date.now()), qs=S.cfg.questions.slice(); qs[i]=nq;
  const outcome={...(S.ses.outcome||{})}; delete outcome[qu.id]; // the light of the old version no longer stands
  S.ui.dlg=null; if(S.ui.tx) Object.keys(S.ui.tx).forEach(k=>{ if(k.indexOf(":"+qu.id)>0) delete S.ui.tx[k]; });
  setConfig({...S.cfg, questions:qs});
  setSession({phase:"voting", current:i, revealed:S.ses.revealed.filter(x=>x!==qu.id), revote:{qid:qu.id, rev:nq.rev}, outcome, showLive:false}); }
let writeChain=Promise.resolve();
function write(fn){ writeChain = writeChain.then(fn).catch(e=>{ console.warn("write failed",e); if(e&&e.code==="invalid_argument"){ S.ui.readonly=true; render(); } else if(isDenied(e)) onRefused(); }); return writeChain; }
/* the database rules refused a write (backlog G3). At the expiry moment that is expected: the expired screen follows.
   Anything else must not pass in silence. */
function isDenied(e){ return !!e && /permission.denied/i.test(String(e.code||"")+" "+String(e.message||"")); }
function onRefused(){ const m=S.meta, now=nowS();
  if(S.route==="set" && !S.me.isHost && m && Number.isFinite(m.expiresAt) && m.expiresAt<=now+15000){ setTimeout(render, Math.max(0, m.expiresAt-now)+300); return; }
  S.ui.saveErr = (S.me.isHost && S.ui.view!=="participant") ? "The database refused this change. Reload the page" : "Your answer could not be saved. Reload the page"; render(); }
function setSession(patch){ const next={...S.ses,...patch}; if(!("revote" in patch) && ("current" in patch || "phase" in patch)) next.revote=null; // moving on ends a re-vote
  S.ses=next; render(); if(S.review || expired()) return Promise.resolve(); return write(()=>S.backend.setSession(next)); }
function setConfig(next){ S.cfg=next; render(); if(S.review || expired()) return Promise.resolve(); return write(()=>S.backend.setConfig(next)); }

app.addEventListener("click", e=>{
  const b=e.target.closest("[data-act]"); if(!b) return;
  const act=b.dataset.act, v=b.dataset.v, id=b.dataset.id, ses=S.ses, Q=S.cfg?S.cfg.questions:[];
  const menu=b.closest("details.menu"); if(menu) menu.removeAttribute("open");
  /* an expired set is read-only: paging through results stays local, nothing that changes the room is allowed */
  if(S.route==="set" && expired() && ["start","reset","hardReset","config","mode","reviewPublish","vote","openSubmit","dlSubmit","rejoin","qEdit","nameSave"].includes(act)){ alert("This question set has expired. Extend it first."); return; }
  if(S.review && ["reset","hardReset","vote","openSubmit","dlSubmit"].includes(act)){ alert("Not while you are reviewing saved results. Exit review first."); return; }
  switch(act){
    case "mode": setConfig({...S.cfg, mode:v}); break;
    case "start": setSession({phase:"voting", current:0, revealed:[], showLive:false}); break;
    case "startReveal": S.ui.tlPage=0; S.ui.sumSel=null; if(Q.every(isTraffic)) setSession({phase:"summary", current:0, revealed:Q.map(q=>q.id), ...outcomePatch(Q,true)}); else setSession({phase:"results", current:0, revealed:Q.map(q=>q.id)}); break;
    case "reveal": setSession({revealed:[...new Set([...ses.revealed, Q[ses.current].id])], revote:null, ...(ses.revote && S.cfg.mode==="batch" ? {phase:"results"} : {})}); break; // a re-vote in "answer all first" mode returns to the results
    case "next": { const c=Math.min(Q.length-1, ses.current+1); setSession({current:c, phase: ses.phase==="results"?"results":"voting", ...outcomePatch([Q[ses.current]])}); break; }
    case "prev": { const c=Math.max(0, ses.current-1); setSession({current:c}); break; }
    case "gotoResults": S.ui.tlPage=0; setSession({phase:"results", current:+v||0}); break;
    case "summary": S.ui.sumSel=null; S.ui.tlPage=0; S.ui.closeTab="overview"; setSession({phase:"summary", ...outcomePatch(Q,true,Q[ses.current])}); break;
    case "tlSel": S.ui.sumSel = (S.ui.sumSel===b.dataset.q) ? null : b.dataset.q; render(); document.getElementById("tl-detail")?.scrollIntoView({behavior:reduced?"auto":"smooth", block:"start"}); break;
    case "lobby": setSession({phase:"lobby", current:0}); break;
    case "showLive": setSession({showLive: b.checked}); break;
    case "impPick": document.getElementById("impFile")?.click(); break;
    case "reviewExit": if(S.review){ const l=S.review.live; S.review=null; S.cfg=l.cfg; S.ses=l.ses; S.votes=l.votes; S.actions=l.actions||{}; S.ui.act={}; render(); } break;
    case "reviewPublish": { if(!S.review) break;
      if(!confirm("Publish these results to the live poll? The questions and answers everyone sees are replaced.")) break;
      const cfg=S.cfg, next={...S.ses}, votes=S.votes; S.review=null;
      write(()=>S.backend.setConfig(cfg));
      if(S.backend.setAllVotes) write(()=>S.backend.setAllVotes(votes));
      write(()=>S.backend.setSession(next));
      render(); break; }
    case "expJSON": exportJSON(); break;
    case "expCSV": exportCSV(); break;
    case "hardReset": if(confirm("Reset the session? All answers are cleared, the round counter goes back to 1 and every device has to tap to rejoin."+actionNote())){
      S.votes={};
      setSession({phase:"lobby", current:0, revealed:[], showLive:false, round:1, resetAt:Date.now(), outcome:null}); dropHistory();
      write(()=>S.backend.clearVotes());
      setTimeout(()=>write(()=>S.backend.clearVotes()), 2500); // sweep answers that were already in flight
    } break;
    case "rejoin": S.me.ackReset=(S.ses.resetAt||0); render(); if(S.heartbeat) S.heartbeat(); break;
    case "reset": if(confirm("Clear all answers and start a new round?"+actionNote())){ const r=(ses.round||1)+1; setSession({phase:"lobby", current:0, revealed:[], round:r, outcome:null}); dropHistory(); write(()=>S.backend.clearVotes()); } break;
    case "signIn": doSignIn(); break;
    case "forgot": doForgot(); break;
    case "signOut": S.be.signOut().catch(e=>alert("Signing out failed: "+(e&&e.message||e))); break;
    case "reload": location.reload(); break;
    case "asParticipant": S.ui.view="participant"; render(); if(S.heartbeat) S.heartbeat(); break;
    case "asHost": S.ui.view=null; render(); break;
    case "vote": {
      const qid=b.dataset.q, val=+b.dataset.v; const mine=myVotes(); const texts={...(mine.texts||{})}; if(mine.answers[qid]!==val){ delete texts[qid]; if(S.ui.tx) delete S.ui.tx[txKey(qid)]; }
      let next={...mine, round:S.ses.round, answers:{...mine.answers,[qid]:val}, texts, t:Date.now()};
      if(mine.answers[qid]!==val){ next=C.withoutTyping(next,qid); delete lastPing[qid]; }
      const vq=Q.find(x=>x.id===qid); if(isTraffic(vq) && (vq.rev||1)>1) next.revs={...(mine.revs||{}),[qid]:vq.rev}; // which version this answer is for
      S.votes[S.me.id]=next; render(); write(()=>S.backend.setVotes(S.me.id,next));
      if(mine.answers[qid]!==val && isTraffic(Q.find(x=>x.id===qid)) && val!==1){ const box=document.getElementById("fu_"+qid); if(box){ box.scrollIntoView({block:"center",behavior:reduced?"auto":"smooth"}); try{ box.focus({preventScroll:true}); }catch(e){} } }
      break; }
    case "fuDone": clearTimeout(fuTimer); saveText(b.dataset.q); render(); break;
    case "openSubmit": { const qid=b.dataset.q, val=String((S.ui.tx||{})[txKey(qid)] ?? "").trim(); if(!val) break; const mine=myVotes();
      const next={...mine, round:S.ses.round, answers:{...mine.answers,[qid]:1}, texts:{...(mine.texts||{}),[qid]:val}, t:Date.now()};
      S.votes[S.me.id]=next; render(); write(()=>S.backend.setVotes(S.me.id,next)); break; }
    case "dlPick": case "dlConf": { const qu=Q.find(x=>x.id===b.dataset.q); if(!qu) break; S.ui.dl=S.ui.dl||{};
      S.ui.dl[txKey(qu.id)]={...dlDraft(qu), [act==="dlPick"?"a":"c"]:+v}; render(); break; }
    case "dlSubmit": { const qu=Q.find(x=>x.id===b.dataset.q); if(!qu) break; const d=dlDraft(qu), mine=myVotes(); if(!Number.isFinite(d.a) || !Number.isFinite(d.c)) break;
      const next={...mine, round:S.ses.round, answers:{...mine.answers,[qu.id]:d.a}, conf:{...(mine.conf||{}),[qu.id]:d.c}, t:Date.now()}; // both parts in one write
      if(S.ui.dl) delete S.ui.dl[txKey(qu.id)];
      S.votes[S.me.id]=next; render(); write(()=>S.backend.setVotes(S.me.id,next)); break; }
    case "config": S.ui.draft=JSON.parse(JSON.stringify(S.cfg)); S.ui.configOpen=true; render(); break;
    case "cfgClose": S.ui.configOpen=false; S.ui.draft=null; S.ui.jsonText=null; S.ui.jsonOpen=false; render(); break;
    case "cfgMode": readDraftFromDOM(); S.ui.draft.mode=v; render(); break;
    case "qUp": case "qDown": { readDraftFromDOM(); const i=+b.dataset.i, j=act==="qUp"?i-1:i+1; const a=S.ui.draft.questions; [a[i],a[j]]=[a[j],a[i]]; render(); break; }
    case "qDel": readDraftFromDOM(); S.ui.draft.questions.splice(+b.dataset.i,1); render(); break;
    case "qAdd": readDraftFromDOM(); S.ui.draft.questions.push(C.qNew(C.catRules(S.meta.category).add)); render(); setTimeout(()=>{ if(S.ui.draft) document.getElementById("qt"+(S.ui.draft.questions.length-1))?.focus(); },0); break;
    case "fontUp": case "fontDown": { const i=QS_STEPS.indexOf(S.ui.qs), j=clamp(i+(act==="fontUp"?1:-1),0,QS_STEPS.length-1); S.ui.qs=QS_STEPS[j]; try{ localStorage.setItem("tr_qs",String(S.ui.qs)); }catch(e){} applyQS(); render(); break; }
    case "pqPrev": case "pqNext": S.ui.pq=Math.max(0,(S.ui.pq||0)+(act==="pqNext"?1:-1)); render(); window.scrollTo(0,0); break;
    case "tlPrev": case "tlNext": { const y=scrollY; S.ui.tlPage=(S.ui.tlPage||0)+(act==="tlNext"?1:-1); render(); scrollTo(0,y); break; }
    case "csvPick": document.getElementById("cfgCsv")?.click(); break;
    case "qAdd5": readDraftFromDOM(); for(let k=0;k<5;k++) S.ui.draft.questions.push(q("",1,5,"Strongly disagree","Strongly agree")); render(); break;
    case "cfgImport": { readDraftFromDOM(); try{ let arr=JSON.parse(document.getElementById("cfgJson").value); if(arr && !Array.isArray(arr) && Array.isArray(arr.questions)){ const f=arr.followUps||{}; if(typeof f.yellow==="string"&&f.yellow.trim()) S.ui.draft.tlYellow=f.yellow.trim(); if(typeof f.red==="string"&&f.red.trim()) S.ui.draft.tlRed=f.red.trim(); arr=arr.questions; } if(!Array.isArray(arr)) throw 0; const f=C.filterForCategory(S.meta.category, arr.map(C.qFromObj)); S.ui.draft.questions=f.kept; S.ui.jsonText=null; render(); const msg=C.skippedMessage(S.meta.category, f.skipped); if(msg) alert(msg); }catch(err){ alert("That JSON could not be read. Expected a list like [{\"text\":\"…\",\"min\":1,\"max\":5,\"lo\":\"…\",\"hi\":\"…\"}] or [{\"text\":\"…\",\"options\":[\"…\",\"…\"]}]"); } break; }
    case "cfgSave": { readDraftFromDOM(); const d=S.ui.draft; if(!d.questions.length){ alert("Add at least one question."); break; }
      const probs=C.questionProblems(d.questions); if(probs.length){ alert(probs.join("\n")); break; } S.ui.configOpen=false; S.ui.draft=null; S.ui.jsonText=null; S.ui.jsonOpen=false; const cur=Math.min(S.ses.current, d.questions.length-1); setConfig(d); if(cur!==S.ses.current) setSession({current:cur}); if(!S.review) S.be.patchMeta(S.setId,{updatedAt:Date.now()}).catch(()=>{}); break; }
    /* ---- question sets ---- */
    case "setNew": openSetDlg(null); break;
    case "setSettings": openSetDlg(id, b.dataset.focus); break;
    case "setExtend": extendSet(id); break;
    case "setExpire": { const now=Date.now(); S.be.patchMeta(id, {expiresAt:now-1000, updatedAt:now}).catch(e=>alert("Expiring failed: "+(e&&e.message||e))); break; } // undone with Extend
    case "setQR": S.ui.dlg={type:"qr", id, title:"QR code: "+tx((metaOf(id)||{}).name)}; render(); break;
    case "setLink": openLinkDlg(id); break;
    case "setDup": duplicateSet(id); break;
    case "setExpQ": exportSet(id,"questions"); break;
    case "setExpJSON": exportSet(id,"json"); break;
    case "setExpCSV": exportSet(id,"csv"); break;
    case "setDel": openDelDlg(id); break;
    case "delConfirm": { const d=S.ui.dlg; if(!d || d.type!=="del") break;
      S.be.removeSet(d.id).then(()=>{ delete S.polls[d.id]; if(S.route==="set") location.href=urlFor(); else closeDlg(); }).catch(e=>alert("Deleting failed: "+(e&&e.message||e))); break; }
    case "dlgClose": closeDlg(); break;
    case "dlgSave": if(S.ui.dlg && S.ui.dlg.type==="edit") saveEditDlg(); else if(S.ui.dlg && S.ui.dlg.type==="link") saveLinkDlg(); else saveSetDlg(); break;
    /* ---- consent workflow ---- */
    case "qEdit": { const i=Q.findIndex(x=>x.id===b.dataset.q); if(i<0) break; S.ui.dlg={type:"edit", qid:Q[i].id, title:`Edit proposal ${i+1}`, focus:"dlgText"}; render(); break; }
    case "closeTab": S.ui.closeTab=v; S.ui.tlPage=0; render(); break;
    case "expMD": exportMD(); break;
    case "expActMD": Object.keys(S.ui.act||{}).forEach(k=>actSave(k,true)); exportActionsMD(); break;
    case "actFilter": S.ui.actFilter=v; render(); break;
    /* ---- named respondents ---- */
    case "nameEdit": S.ui.nameEdit=true; S.ui.nameDraft=null; S.ui.nameErr=""; render(); document.getElementById("nameIn")?.focus(); break;
    case "nameCancel": S.ui.nameEdit=false; S.ui.nameDraft=null; S.ui.nameErr=""; render(); break;
    case "nameSave": { const el=document.getElementById("nameIn"), n=C.cleanName(el?el.value:""), prob=C.nameProblem(n, C.otherNames(S.votes,S.me.id));
      if(prob){ S.ui.nameErr=prob; S.ui.nameDraft=el?el.value:""; render(); document.getElementById("nameIn")?.focus(); break; }
      setName(n); render(); const cur=S.votes[S.me.id];
      if(cur && cur.round===S.ses.round){ const next=C.presenceDoc(cur, S.ses.round, Date.now()); S.votes[S.me.id]=next; write(()=>S.backend.setVotes(S.me.id,next)); } else if(S.heartbeat) S.heartbeat(); // tell the room right away
      break; }
    case "dlgAccent": { const c=document.getElementById("dlgColor"); if(c){ c.value=String(v).toLowerCase(); markSwatch(); } break; }
    case "dlgExpQuick": { const x=document.getElementById("dlgExp"); if(x) x.value=toLocalInput(C.extendedExpiry(Date.now(), +v)); break; }
    case "dlgFilePick": document.getElementById("dlgFile")?.click(); break;
    case "qrCopy": { const d=S.ui.dlg, note=document.getElementById("qrNote"), url=d?joinUrl(d.id,metaOf(d.id)):"";
      const done=ok=>{ if(note) note.textContent=ok?"Link copied.":"Copying is blocked here; select the link above instead."; };
      try{ navigator.clipboard.writeText(url).then(()=>done(true),()=>done(false)); }catch(e){ done(false); } break; }
    case "qrPng": { const d=S.ui.dlg; if(!d) break; const m=metaOf(d.id), src=qrPng(joinUrl(d.id,m),1024,64,"#000000"); if(!src){ alert("QR unavailable."); break; }
      const a=document.createElement("a"); a.href=src; a.download=`${fileBase(m)}-qr.png`; document.body.appendChild(a); a.click(); a.remove(); break; }
  }
});
app.addEventListener("change", e=>{ const inp=e.target;
  if(inp && inp.classList && inp.classList.contains("act-in")){ const key=inp.dataset.key;
    if(inp.dataset.f==="none"){ actSet(key,"none",inp.checked); actSave(key); render(); } else { actSet(key,inp.dataset.f,inp.value); actSave(key,true); }
    return; }
  if(inp && inp.dataset && inp.dataset.k==="kind" && S.ui.configOpen){ readDraftFromDOM(); render(); return; } // another type: other fields
  if(inp && inp.id==="dlgFile"){ const f=inp.files&&inp.files[0]; inp.value=""; if(f) readSetFile(f); return; }
  if(inp && inp.id==="dlgColor"){ markSwatch(); return; }
  if(inp && inp.id==="cfgCsv"){ const f=inp.files&&inp.files[0]; inp.value=""; if(!f) return; const r=new FileReader(); r.onerror=()=>alert("Could not read that file.");
    r.onload=()=>{ const qs=csvToQuestions(String(r.result||"")); if(!qs.length){ alert("No questions found in that CSV."); return; }
      const f=C.filterForCategory(S.meta.category, qs), msg=C.skippedMessage(S.meta.category, f.skipped);
      readDraftFromDOM(); S.ui.draft.questions.push(...f.kept); render(); if(msg) alert(msg); }; r.readAsText(f); return; }
  if(!inp || inp.id!=="impFile") return;
  const f=inp.files && inp.files[0]; inp.value="";
  if(!f) return; const r=new FileReader(); r.onerror=()=>alert("Could not read that file.");
  r.onload=()=>importResults(String(r.result||""), f.name); r.readAsText(f); });
/* leaving an action field saves it; the list is redrawn once the cursor has landed in the next field */
app.addEventListener("focusout", e=>{ const t=e.target; if(S.rendering || !t || !t.isConnected || !t.classList || !t.classList.contains("act-in") || t.dataset.f==="none") return;
  const key=t.dataset.key; if(!(S.ui.act||{})[key]) return; actSave(key); setTimeout(renderBg,0); });
let fuTimer=null;
app.addEventListener("input", e=>{ const t=e.target; if(t && t.id==="dlgColor"){ markSwatch(); return; }
  if(t && t.id==="nameIn"){ S.ui.nameDraft=t.value; return; }
  if(t && t.classList && t.classList.contains("act-in")){ const key=t.dataset.key, f=t.dataset.f; if(f==="none") return;
    actSet(key,f,t.value); const m=document.getElementById("as_"+key); if(m) m.textContent="";
    clearTimeout(actTimers[key]); actTimers[key]=setTimeout(()=>{ actSave(key,true); renderBg(); }, 2000); return; }
  if(t && t.classList && t.classList.contains("open-in")){ S.ui.tx=S.ui.tx||{}; S.ui.tx[txKey(t.dataset.q)]=t.value; const v=t.value.trim(), btn=document.getElementById("ops_"+t.dataset.q), n=document.getElementById("opn_"+t.dataset.q);
    if(btn) btn.disabled=!v || v===t.dataset.saved; if(n) n.textContent=`${t.value.length} / ${t.maxLength}`; return; }
  if(!t || !t.classList || !t.classList.contains("tl-fu-in")) return;
  S.ui.tx=S.ui.tx||{}; S.ui.tx[txKey(t.dataset.q)]=t.value; clearTimeout(fuTimer); const qid=t.dataset.q; typingPing(qid); fuNote(qid); fuTimer=setTimeout(()=>saveText(qid), FU_IDLE); });
document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="hidden") flushFu(); }); // a phone that is put away sends what was typed
window.addEventListener("pagehide", flushFu);
app.addEventListener("focusout", e=>{ const t=e.target; if(S.rendering || !t || !t.isConnected) return; if(t.classList && t.classList.contains("tl-fu-in")){ clearTimeout(fuTimer); saveText(t.dataset.q); } });
app.addEventListener("keydown", e=>{ if(e.key==="Enter" && e.target && e.target.id==="nameIn"){ e.preventDefault(); document.querySelector('[data-act="nameSave"]')?.click(); return; }
  if(e.key==="Enter" && e.target && (e.target.id==="siEmail" || e.target.id==="siPass")){ e.preventDefault(); doSignIn(); return; }
  if(e.key!=="Escape") return; if(S.ui.dlg){ closeDlg(); return; } if(S.ui.configOpen){ S.ui.configOpen=false; S.ui.jsonText=null; render(); } });
app.addEventListener("toggle", e=>{ if(e.target && e.target.id==="cfgJsonBox") S.ui.jsonOpen=e.target.open; if(e.target && e.target.id==="waitBox" && !S.rendering) S.ui.waitOpen=e.target.open; }, true);
document.addEventListener("keydown", e=>{ if(!S.me.isHost||S.route!=="set"||S.ui.configOpen||S.ui.dlg||S.ui.view==="participant") return; if(e.target.matches("input,textarea")) return;
  if(e.key==="ArrowRight"){ document.querySelector('[data-act="next"]:not([disabled])')?.click(); }
  if(e.key==="ArrowLeft"){ document.querySelector('[data-act="prev"]:not([disabled])')?.click(); }
  if(e.key===" " ){ const r=document.querySelector('[data-act="reveal"]'); if(r){ e.preventDefault(); r.click(); } } });

/* ============ boot ============ */
/* ============ boot ============ */
function withTimeout(p, ms){ return Promise.race([p, new Promise((_,rej)=>setTimeout(()=>rej(new Error("timeout")), ms))]); }
/* one-off: the poll from before sets existed (MIGRATE_POLL_ID in config.js) gets its record in sets/ */
async function migrate(be){ const id=(typeof MIGRATE_POLL_ID!=="undefined" && MIGRATE_POLL_ID) || ""; if(!id || !C.SET_ID_RE.test(id)) return;
  try{ const sets=await withTimeout(be.getSets(), 6000); if(Object.keys(sets).length) return;
    const poll=await withTimeout(be.readPoll(id), 6000); if(poll && poll.config) await be.setMeta(id, C.migrationMeta(id, poll.config, Date.now()));
  }catch(e){ console.warn("migration skipped", e); } }
async function boot(){
  S.ui.qs=getQS(); applyQS();
  render();
  /* a set page signs in anonymously by itself; the overview and the sign-in screen do not need an identity for that */
  const be = B.make({ firebaseConfig:(typeof FIREBASE_CONFIG!=="undefined" ? FIREBASE_CONFIG : {}), params, anon: !!SET_ID && !SIGNIN, appCheckKey:(typeof APPCHECK_SITE_KEY!=="undefined" ? APPCHECK_SITE_KEY : "") });
  S.be=be; S.ui.readonly = be.canWrite===false;
  let offTimer=null;
  function setOffline(off){ if(off===!!S.ui.offline) return; S.ui.offline=off; if(S.booted) renderBg(); }
  if(be.onConn) be.onConn(ok=>{ clearTimeout(offTimer); if(ok) setOffline(false); else offTimer=setTimeout(()=>setOffline(true), 6000); });
  /* wait for the first sign-in state before deciding between presenter and participant */
  await new Promise(done=>be.onAuth(a=>{ applyAuth(a); done(); }));
  if(SIGNIN && !be.demo){ if(be.isHost){ location.replace(urlFor({set:SET_ID})); return; } S.route="signin"; S.booted=true; render(); return; }
  if(be.isHost && !be.demo) await migrate(be);
  S.booted=true;
  if(S.route==="home") bootHome(be); else if(S.setId) bootSet(be); else render();
}
function bootHome(be){
  render(); if(!be.isHost) return; // a participant without a set link only gets the "scan the QR code" page
  be.onSets((sets,err)=>{ S.setsErr=err||null; if(!err) S.sets=sets||{}; renderBg(); loadStats(); });
  setInterval(loadStats, 30000);
  setInterval(renderBg, 60000); // expiry labels move with the clock
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") loadStats(); });
}
function bootSet(be){
  const p=be.poll(S.setId); S.backend=p;
  const raw={cfg:undefined, ses:undefined}; let editDone=!params.has("edit"), votesIn=false;
  function settle(){ if(S.review) return;
    if(raw.cfg!==undefined) S.cfg=C.normConfig(raw.cfg);
    if(raw.ses!==undefined) S.ses={...DEFAULT_SESSION,...(raw.ses||{})};
    /* a set that was just created opens straight in the question editor */
    if(!editDone && S.me.isHost && S.meta && S.cfg && S.ses){ editDone=true; try{ history.replaceState(null,"",urlFor({set:S.setId})); }catch(e){}
      S.ui.draft=JSON.parse(JSON.stringify(S.cfg)); S.ui.configOpen=true; } }
  p.onMeta((m,err)=>{ const was=expired(); S.metaErr=err||null; S.meta=err?undefined:C.normMeta(m); settle(); ensureName(); renderBg(); if(was && !expired()) heartbeat(); });
  p.onConfig(c=>{ raw.cfg=c||null; if(S.review){ S.review.live.cfg=C.normConfig(c); return; } settle(); renderBg(); });
  p.onSession(s=>{ s=normSession(s); noteReset(s); raw.ses=s||null; if(S.review){ S.review.live.ses={...DEFAULT_SESSION,...(s||{})}; return; } settle(); renderBg(); });
  p.onVotes(v=>{ if(S.review){ S.review.live.votes=v||{}; return; } S.votes=v||{}; votesIn=true; ensureName(); renderBg(); });
  p.onActions(a=>{ if(!be.isHost) a={}; if(S.review){ S.review.live.actions=a||{}; return; } S.actions=a||{}; renderBg(); }); // follow-up actions are for the presenter only
  try{ const o=JSON.parse(localStorage.getItem("tr_name_"+S.setId)||"null"); if(o && o.n){ S.me.name=String(o.n); S.me.nameAt=o.at||0; } }catch(e){}
  { const send=p.setVotes; p.setVotes=(pid,v)=>{ if(typingOff && v && v.typing){ v={...v}; delete v.typing; } return send(pid, pid===be.id ? stampDoc(v) : v); }; } // this device's doc always carries (or drops) its name
  /* random names are handed out here; when two devices hold the same name the later one gives way */
  function ensureName(){ if(!be.id || !S.meta || !S.ses || !votesIn || S.review || expired()) return; const nm=S.meta.named; if(!C.isNamed(nm)) return;
    const isP = !be.isHost || S.ui.view==="participant"; if(!isP) return;
    const clash = S.me.name && C.mustYieldName(S.votes, be.id, S.me.name, S.me.nameAt);
    if(nm==="random" && (!S.me.name || clash)){ const n=C.randomName(new Set(C.otherNames(S.votes,be.id).map(x=>x.toLowerCase()))); if(!n) return;
      setName(n); const cur=S.votes[be.id], doc=C.presenceDoc(cur, S.ses.round, Date.now());
      S.votes[be.id]=doc; write(()=>p.setVotes(be.id,doc)); renderBg(); }
    else if(nm==="yes" && clash){ setName(null); S.ui.nameErr="This name is already in use. Choose another."; renderBg(); } }
  // announce presence so the host sees who joined (a vote doc with no answers)
  function heartbeat(){ if(!be.id || !S.ses || !S.meta || expired() || be.canWrite===false || isKicked() || S.review) return; const isP = !be.isHost || S.ui.view==="participant"; if(!isP) return;
    ensureName(); if(C.isNamed(S.meta.named) && !S.me.name) return; // in a named set you join once you have a name
    const cur=S.votes[be.id]; const doc = C.presenceDoc(cur, S.ses.round, Date.now());
    S.votes[be.id]=doc; write(()=>p.setVotes(be.id,doc)); }
  S.heartbeat=heartbeat;
  setTimeout(heartbeat, 800);
  setInterval(heartbeat, 60000);
  setInterval(renderBg, 30000); // presence fades and sets expire with the clock, on every device

  /* ---- staying in sync after the screen has been off ---- */
  function applyPull(d){ if(!d || S.review) return;
    if(d.config) raw.cfg=d.config;
    const ss=normSession(d.session); noteReset(ss); if(ss && ss.phase) raw.ses=ss;
    settle(); if(!S.ses) return;
    const mine=S.votes[S.me.id]; S.votes=d.votes||{}; if(mine && mine.round===S.ses.round) S.votes[S.me.id]=mine;
    if(be.isHost) S.actions=d.actions||{};
    renderBg(); }
  let pulling=false, lastPull=0;
  async function pullNow(){ if(!p.pull || pulling) return; pulling=true; lastPull=Date.now();
    try{ applyPull(await p.pull()); }catch(e){} finally{ pulling=false; } }
  async function watchdog(){
    if(document.visibilityState!=="visible") return;
    const down = !!(be.isConnected && !be.isConnected());
    if(down && be.nudge) be.nudge();
    // while waiting in the lobby the socket may sit idle for a long time, so read over plain
    // HTTPS now and then as well: that is the window in which the start would be missed
    const waiting = S.ses && S.ses.phase==="lobby" && !(S.me.isHost && S.ui.view!=="participant");
    const stale = down ? ((be.downFor?be.downFor():9e9)>=6000 && Date.now()-lastPull>4000)
                       : (waiting && Date.now()-lastPull>20000);
    if(stale) pullNow();
  }
  function wake(){ heartbeat(); watchdog(); }
  setInterval(watchdog, 5000);
  document.addEventListener("visibilitychange", ()=>{ if(document.visibilityState==="visible") wake(); });
  window.addEventListener("pageshow", wake);
  window.addEventListener("focus", wake);
  window.addEventListener("online", wake);
}


boot();
})();
