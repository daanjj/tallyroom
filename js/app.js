(function(){
"use strict";
const C=window.TRCore, B=window.TRBackend;
const { clamp, fmt, tx, normOptions, isTraffic, isOpt, optLabel, q, exportQ, stats, hasAnswers, validAns, normSession, csvToQuestions, TL_LABELS, TL_COLORS, TL_Q_YELLOW, TL_Q_RED, DEFAULT_SESSION } = C;
const tlPrompt = v => C.followUp(S.cfg, v);
const qColor = (qu,i,n) => (isTraffic(qu) && TL_COLORS[i]) ? TL_COLORS[i] : rampColor(i,n);
const qInk = (qu,i,n) => isTraffic(qu) ? (i===1?"#1E1838":"#FFFFFF") : selInk(i,n);

/* ============ address: which set, and links to other screens ============ */
const params=new URLSearchParams(location.search);
const PAGE=location.href.split("#")[0].split("?")[0];
const RAW_SET=params.get("set"), SET_ID=(RAW_SET && C.SET_ID_RE.test(RAW_SET)) ? RAW_SET : null;
/* no arguments = the overview of all sets; the host key is never part of a link */
function urlFor(o){ o=o||{}; const p=new URLSearchParams(); if(o.set) p.set("set",o.set); if(o.edit) p.set("edit","1"); if(params.has("demo")) p.set("demo",params.get("demo")||"1"); const s=p.toString(); return PAGE+(s?"?"+s:""); }
function joinUrl(id, meta){ return (meta && meta.joinUrl) || urlFor({set:id}); }

/* ============ state ============ */
/* meta: undefined = not loaded yet, null = this set does not exist */
const S = { route:(RAW_SET!=null?"set":"home"), setId:SET_ID, booted:false, meta:undefined, metaErr:null, sets:null, setsErr:null, polls:{}, cfg:null, ses:null, votes:{}, me:{id:null,isHost:false,canWrite:true,ackReset:null}, ui:{view:null,configOpen:false,draft:null,readonly:false,qs:.75,dlg:null}, backend:null, be:null };
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
function currentRoundVotes(){ return C.roundVotes(S.votes, S.ses?.round??1, Date.now(), S.me.isHost?S.me.id:null); }
function header(){ return S.review ? S.review.info.title : ((S.meta && (tx(S.meta.header)||tx(S.meta.name))) || "Tally Room"); }
function expired(){ return !S.review && C.isExpired(S.meta, Date.now()); }
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
function sumScore(r){ if(!r.st.n) return -1; return isOpt(r.qu) ? r.st.counts[r.st.mode]/r.st.n : r.st.mean/r.qu.max; }
function sumMetric(r){ if(!r.st.n) return "–"; return isOpt(r.qu) ? `${r.st.counts[r.st.mode]}<small> /${r.st.n}</small>` : `${fmt(r.st.mean)}<small> /${r.qu.max}</small>`; }
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
    return `<tr class="${qu.id===curId?"cur":""}${pick?" pick":""}"${pick?` data-act="tlSel" data-q="${qu.id}" title="Show details"`:""}><td class="n">${i+1}</td><td>${esc(tx(qu.text))}</td><td class="r">${cell}</td></tr>`; }).join("");
  return `<div class="card" style="padding:18px 20px"><table class="tl-table"><thead><tr><th>#</th><th>Statement</th><th>${esc(((Q.find(isTraffic)||{}).options||TL_LABELS).join(" / "))}</th></tr></thead><tbody>${body}</tbody></table><div class="tl-pager" hidden></div></div>`;
}
function miniStrip(qu, vals){
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
function currentPayload(){ return C.resultsPayload({setId:S.setId, meta:S.meta, title:header(), cfg:S.cfg, ses:S.ses, votes:S.votes, now:Date.now()}); }
function exportJSON(){ saveResults(currentPayload(), S.meta, "json"); }
function exportCSV(){ saveResults(currentPayload(), S.meta, "csv"); }
function exportBtns(){ return Object.values(currentRoundVotes()).some(hasAnswers)
  ? `<button class="btn ghost" data-act="expJSON">Save results (JSON)</button><button class="btn ghost" data-act="expCSV">CSV</button>` : ""; }
/* exports for any set, straight from the database: the set does not have to be open anywhere */
async function exportSet(id, kind){ const meta=metaOf(id); if(!meta) return;
  try{ const poll=await S.be.readPoll(id);
    if(kind==="questions"){ download(`${fileBase(meta)}-questions.json`, JSON.stringify(C.questionsExport(meta, poll.config),null,1), "application/json"); return; }
    const payload=C.resultsPayload({setId:id, meta, cfg:poll.config, ses:normSession(poll.session)||{}, votes:poll.votes||{}, now:Date.now()});
    if(!payload.respondents && !confirm("This set has no answers in its current round. Export anyway?")) return;
    saveResults(payload, meta, kind);
  }catch(e){ alert("Export failed: "+(e&&e.message||e)); } }

function importResults(text, fname){
  let p=null; try{ p=JSON.parse(text); }catch(e){ alert("That file is not valid JSON."); return; }
  if(!p || !Array.isArray(p.questions) || !p.questions.length){ alert("No questions found in that file. Load a JSON saved by Tally Room."); return; }
  const qs=p.questions.map((q,i)=>{ const o=normOptions(q.options), id=String(q.id||("q"+i)), text=String(q.text||("Question "+(i+1)));
    if(q.kind==="traffic" || q.traffic) return {id, text, kind:"traffic", options:(o.length===3?o:TL_LABELS.slice()), min:1, max:3, lo:"", hi:""};
    return o.length>=2 ? {id, text, kind:"options", options:o, min:1, max:o.length, lo:"", hi:""}
                       : {id, text, min:clamp(Math.round(C.num(q.min,1)),0,10), max:clamp(Math.round(C.num(q.max,5)),1,11), lo:q.lo||"", hi:q.hi||""}; });
  const votes={};
  (Array.isArray(p.answers)?p.answers:[]).forEach((r,i)=>{ const a={};
    qs.forEach(qu=>{ const v=r && r.answers ? r.answers[qu.id] : null; if(Number.isFinite(v)) a[qu.id]=v; });
    const tx={}; qs.forEach(qu=>{ const t=r&&r.texts?r.texts[qu.id]:null; if(typeof t==="string"&&t.trim()) tx[qu.id]=t; });
    if(Object.keys(a).length) votes[String((r&&r.respondent)||("R"+(i+1)))]={round:1, answers:a, texts:tx, t:Date.parse((r&&r.at)||"")||Date.now()}; });
  if(!Object.keys(votes).length && !confirm("That file has questions but no answers. Open it anyway?")) return;
  S.review={ live:{cfg:S.cfg, ses:S.ses, votes:S.votes},
    info:{ title:String(p.title||"Saved results"), n:Object.keys(votes).length, file:String(fname||""),
           exportedAt:String(p.exportedAt||"").slice(0,16).replace("T"," ") } };
  S.cfg={ tlYellow:p.followUps&&p.followUps.yellow||"", tlRed:p.followUps&&p.followUps.red||"", mode:p.mode==="batch"?"batch":"live", questions:qs };
  S.ses={ phase:"summary", current:0, revealed:qs.map(q=>q.id), round:1, showLive:true, resetAt:(S.review.live.ses&&S.review.live.ses.resetAt)||0 };
  S.votes=votes; S.ui.view=null; S.ui.configOpen=false; render();
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
function render(){
  let html, host=false;
  if(!S.booted){ html=notice("", "Connecting…", true); }
  else if(S.route==="home"){ applyTheme(null); document.title="Tally Room"; html=homeHTML(); }
  else if(S.metaErr){ html=notice("Cannot open this question set", RULES_MSG); }
  else if(!S.setId || S.meta===null){ applyTheme(null); document.title="Tally Room";
    html=notice("This question set does not exist (any more)", "Ask the presenter for a new link or QR code."+(S.me.isHost?` <a href="${esc(urlFor())}">All question sets</a>`:"")); }
  else if(S.meta===undefined || !S.cfg || !S.ses){ html=notice("", "Connecting…", true); }
  else { applyTheme(S.meta.accent); document.title=header(); host = S.me.isHost && S.ui.view!=="participant"; }
  const ae=document.activeElement, keep = (ae && ae.classList && ae.classList.contains("tl-fu-in")) ? {id:ae.id, a:ae.selectionStart, b:ae.selectionEnd} : null;
  const mc=document.querySelector("#modal .card"), mTop=mc?mc.scrollTop:0, wTop=window.scrollY;
  S.rendering=true; try{ app.innerHTML = html!=null ? html : (host ? hostHTML() : (expired() ? expiredHTML() : participantHTML())); } finally { S.rendering=false; }
  if(keep){ const el=document.getElementById(keep.id); if(el){ el.focus(); try{ el.setSelectionRange(keep.a,keep.b); }catch(e){} } }
  if(host){ afterHost(); paginateTL(); }
  if(S.ui.configOpen) app.insertAdjacentHTML("beforeend", configHTML());
  if(S.ui.configOpen && mTop){ const nc=document.querySelector("#modal .card"); if(nc) nc.scrollTop=mTop; } // keep the form where it was
  if(S.ui.dlg){ app.insertAdjacentHTML("beforeend", dlgHTML()); afterDlg(); }
  if(wTop && Math.abs(window.scrollY-wTop)>2) window.scrollTo(0,wTop);
  if(S.ui.configOpen) app.querySelector("#modal")?.addEventListener("input", ()=>{ try{ readDraftFromDOM(); }catch(e){} }, {passive:true});
}
/* background updates (votes, session, reconnects, resize) must not rebuild a form or an open menu */
function renderBg(){
  if(S.ui.configOpen && document.getElementById("modal")) return;
  if(S.ui.dlg && document.getElementById("dlg")) return;
  if(document.querySelector("details.menu[open]")) return;
  render(); }
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
  const controls = `<a class="btn sm ghost" href="${esc(urlFor())}">All question sets</a>${fontCtl()}${ph!=="lobby"?`<button class="btn sm ghost" data-act="lobby">Back to lobby</button>`:""}<button class="btn sm ghost" data-act="config">Edit questions</button><button class="btn sm ghost" data-act="setSettings" data-id="${esc(S.setId)}">Settings</button><button class="btn sm ghost" data-act="asParticipant">View as participant</button>`;
  let main="", side=sideHTML();
  if(ph==="lobby"){
    main=`<div class="card" style="padding:28px"><div class="eyebrow">${Q.length?"Ready to start":"No questions yet"} · ${esc(cap(S.meta.category))}</div><h1 style="font-size:clamp(26px,4vw,40px);margin-top:8px">${esc(header())}</h1>
      <p class="meta" style="margin:10px 0 22px">${Q.length} ${Q.length===1?"question":"questions"} · ${joined} ${joined===1?"person has":"people have"} joined. ${Q.length?"Share the QR code or link on the right.":"Add questions before you start."}</p>
      <div class="controls"><div class="seg" role="group" aria-label="Mode"><button data-act="mode" data-v="live" class="${cfg.mode==="live"?"on":""}">One question at a time</button><button data-act="mode" data-v="batch" class="${cfg.mode==="batch"?"on":""}">Answer all first, then reveal</button></div></div>
      <div class="controls" style="margin-top:22px">${Q.length?`<button class="btn primary" data-act="start">${cfg.mode==="live"?"Start with question 1":"Open all questions"}</button>`:`<button class="btn primary" data-act="config">Add questions</button>`}${Object.keys(S.votes).length?`<button class="btn ghost" data-act="reset">Clear previous answers</button>`:""}${exportBtns()}<button class="btn ghost" data-act="impPick">Open saved results</button><input type="file" id="impFile" accept=".json,application/json" style="display:none"><span class="spacer"></span><button class="btn danger" data-act="hardReset">Reset session</button></div></div>`;
  } else if(ph==="voting" && cfg.mode==="live"){
    const qu=Q[ses.current]; const vals=answersFor(qu.id); const revealed=ses.revealed.includes(qu.id);
    main=`<div class="card" style="padding:26px 26px 20px"><div class="qnum">Question ${ses.current+1} of ${Q.length}</div><div class="qtext">${esc(tx(qu.text))}</div>
      <div class="progress" style="margin:20px 0 6px"><div class="bar"><i style="width:${joined?Math.round(100*vals.length/joined):0}%"></i></div><b>${vals.length} / ${joined} answered</b></div></div>
      <div class="card chart">${revealed||ses.showLive ? chartHTML(qu,vals) : `<div class="hidden-note"><div class="pulse"></div><div>Answers are hidden until you reveal them. <span class="meta">${vals.length} in so far.</span></div></div>`}</div>
      ${isTraffic(qu)?trafficTable(Q,qu.id,false):""}${isTraffic(qu)&&(revealed||ses.showLive)?commentsHTML(qu):""}
      <div class="controls"><button class="btn" data-act="prev" ${ses.current===0?"disabled":""}>← Previous</button>
        ${revealed?"":`<button class="btn primary" data-act="reveal">Reveal results</button>`}
        ${ses.current<Q.length-1?`<button class="btn ${revealed?"primary":""}" data-act="next">Next question →</button>`:`<button class="btn ${revealed?"primary":""}" data-act="summary">Show summary</button>`}
        <span class="spacer"></span><label class="meta" style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="showLive" data-act="showLive" ${ses.showLive?"checked":""}> show answers as they come in</label></div>`;
  } else if(ph==="voting" && cfg.mode==="batch"){
    const done = Object.values(currentRoundVotes()).filter(v=>Q.every(qu=>validAns(v,qu)!=null)).length;
    const total=Q.reduce((n,qu)=>n+answersFor(qu.id).length,0), expected=joined*Q.length;
    main=`<div class="card" style="padding:28px"><div class="eyebrow">Collecting answers</div><h2 style="font-size:28px;margin-top:8px">Everyone answers all ${Q.length} questions on their own device</h2>
      <div class="progress" style="margin:22px 0 8px"><div class="bar"><i style="width:${expected?Math.min(100,Math.round(100*total/expected)):0}%"></i></div><b>${total} / ${expected} answers</b></div>
      <div class="progress" style="margin:8px 0 8px"><div class="bar"><i style="width:${joined?Math.round(100*done/joined):0}%"></i></div><b>${done} / ${joined} people finished</b></div>
      <p class="meta" style="margin:4px 0 0">${Q.length} questions × ${joined} ${joined===1?"person":"people"} = ${expected} answers expected.</p>
      <p class="meta">Results stay hidden until you start revealing them, one question at a time.</p>
      <div class="controls" style="margin-top:18px"><button class="btn primary" data-act="startReveal">Start revealing results</button><button class="btn ghost" data-act="lobby">Back to lobby</button></div></div>`;
  } else if(ph==="results"){
    const qu=Q[ses.current]; const vals=answersFor(qu.id);
    main=`<div class="card" style="padding:26px 26px 20px"><div class="qnum">Question ${ses.current+1} of ${Q.length}</div><div class="qtext">${esc(tx(qu.text))}</div></div>
      <div class="card chart">${chartHTML(qu,vals)}</div>
      ${isTraffic(qu)?trafficTable(Q,qu.id,true)+commentsHTML(qu):""}
      <div class="controls"><button class="btn" data-act="prev" ${ses.current===0?"disabled":""}>← Previous</button>
        ${ses.current<Q.length-1?`<button class="btn primary" data-act="next">Next question →</button>`:`<button class="btn primary" data-act="summary">Show summary</button>`}</div>`;
  } else if(ph==="summary"){
    const rows = Q.map((qu,i)=>({qu,i,st:stats(answersFor(qu.id),qu.min,qu.max)}));
    const sorted=[...rows].filter(r=>!isTraffic(r.qu)).sort((a,b)=>sumScore(b)-sumScore(a));
    const selQ=Q.find(x=>x.id===S.ui.sumSel && isTraffic(x));
    const tlT=trafficTable(Q,selQ?selQ.id:null,true,true);
    const detail=selQ?`<div class="card" id="tl-detail" style="padding:26px 26px 20px"><div class="qnum">Question ${Q.indexOf(selQ)+1} of ${Q.length}</div><div class="qtext">${esc(tx(selQ.text))}</div></div><div class="card chart">${chartHTML(selQ,answersFor(selQ.id))}</div>${commentsHTML(selQ,true)}`:"";
    main=`${detail}${tlT}${tlT&&!selQ?`<div class="meta" style="margin:-6px 4px 0">Click a row for the detailed view.</div>`:""}<div class="card" style="padding:26px"><div class="eyebrow">Summary</div>${sorted.length?`<h2 style="font-size:28px;margin-top:6px">${tlT?"Other questions":`All ${Q.length} questions`}, highest average or agreement first</h2>`:""}
      <div style="margin-top:14px">${sorted.map(r=>`<div class="sum-row"><div class="t">${esc(tx(r.qu.text))}<small>Q${r.i+1} · ${r.st.n} answers · ${isOpt(r.qu)?`${r.qu.options.length} options${r.st.n?` · most chosen: ${esc(optLabel(r.qu,r.st.mode))}`:""}`:`scale ${r.qu.min}–${r.qu.max}`}</small></div>${miniStrip(r.qu,answersFor(r.qu.id))}<div class="m">${sumMetric(r)}</div></div>`).join("")}</div>
      <div class="controls" style="margin-top:18px"><button class="btn" data-act="gotoResults" data-v="0">Back to question 1</button><button class="btn ghost" data-act="lobby">Back to lobby</button>${exportBtns()}<span class="spacer"></span><button class="btn danger" data-act="reset">Clear all answers</button></div></div>`;
  }
  return `<div class="wrap">${topbar(controls)}${reviewBanner()}${expiredBanner()}${S.ui.readonly?`<div class="banner" style="margin-bottom:12px">You can see this session but this account is not allowed to change it.</div>`:""}<div class="stage two"><div class="stage">${main}</div>${side}</div></div>`;
}
function sideHTML(){
  const url = joinUrl(S.setId, S.meta);
  const rv=currentRoundVotes(); const Q=S.cfg.questions;
  const dots = Object.values(rv).map(v=>{ const k=Q.filter(q=>validAns(v,q)!=null).length; return `<i class="${k===Q.length?"done":(k?"on":"on")}" title="${k}/${Q.length}"></i>`; }).join("");
  return `<aside class="card side"><div><div class="eyebrow">Join</div><p class="meta" style="margin:4px 0 10px">Scan or open the link. No login needed.</p><div class="qr" id="qr"></div><div class="link" style="margin-top:8px">${esc(url)}</div></div>
    <div><div class="eyebrow">In the room</div><p class="meta" style="margin:4px 0 8px">${Object.keys(rv).length} joined · round ${S.ses.round}</p><div class="people">${dots||'<span class="meta">Nobody yet</span>'}</div></div></aside>`;
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
  return (v && v.round===S.ses.round) ? {...v, answers:v.answers||{}, texts:v.texts||{}} : {round:S.ses.round, answers:{}, texts:{}}; }
function scaleHTML(qu, chosen){
  const pts=qu.max-qu.min+1; let b="";
  if(isOpt(qu)){
    for(let v=qu.min,i=0;v<=qu.max;v++,i++){ b+=`<button data-act="vote" data-q="${qu.id}" data-v="${v}" class="${chosen===v?"on":""}" style="--c:${qColor(qu,i,pts)};--sel-ink:${qInk(qu,i,pts)}" aria-pressed="${chosen===v}"><b>${v}</b><span>${esc(tx(qu.options[i]))}</span></button>`; }
    return `<div class="scale opts" style="grid-template-columns:1fr">${b}</div>${isTraffic(qu)?followUpHTML(qu,chosen):""}`;
  }
  for(let v=qu.min,i=0;v<=qu.max;v++,i++){ b+=`<button data-act="vote" data-q="${qu.id}" data-v="${v}" class="${chosen===v?"on":""}" style="--c:${rampColor(i,pts)};--sel-ink:${selInk(i,pts)}" aria-pressed="${chosen===v}">${v}</button>`; }
  const cols = pts>6 ? Math.ceil(pts/2) : pts;
  return `<div class="scale" style="grid-template-columns:repeat(${cols},minmax(0,1fr))">${b}</div><div class="scale-ends"><span>${esc(tx(qu.lo))}</span><span>${esc(tx(qu.hi))}</span></div>`;
}
function txKey(qid){ return (S.ses.round||1)+":"+qid; }
function myText(qu){ const k=txKey(qu.id); return String(S.ui.tx && S.ui.tx[k]!=null ? S.ui.tx[k] : (myVotes().texts?.[qu.id]||"")).trim(); }
function needsText(qu,chosen){ return isTraffic(qu) && (chosen===2||chosen===3) && !myText(qu); }
function followUpHTML(qu, chosen){
  if(chosen!==2 && chosen!==3) return "";
  const k=txKey(qu.id), val = S.ui.tx && S.ui.tx[k]!=null ? S.ui.tx[k] : (myVotes().texts?.[qu.id]||"");
  return `<div class="tl-fu"><label for="fu_${qu.id}">${esc(tlPrompt(chosen))}</label><textarea class="tl-fu-in" id="fu_${qu.id}" data-q="${qu.id}" maxlength="600" rows="3" placeholder="Type your answer here">${esc(val)}</textarea>${val.trim()?`<small>Saved automatically, anonymous.</small>`:`<small style="color:var(--warn);font-weight:700">Required: fill this in to continue to the next question.</small>`}</div>`;
}
function saveText(qid){ const val=(S.ui.tx||{})[txKey(qid)]; if(val==null || S.review) return; const mine=myVotes();
  if(!Number.isFinite(mine.answers[qid]) || (mine.texts&&mine.texts[qid])===val) return;
  const next={round:S.ses.round, answers:{...mine.answers}, texts:{...(mine.texts||{}),[qid]:val}, t:Date.now()};
  S.votes[S.me.id]=next; write(()=>S.backend.setVotes(S.me.id,next)); }
function commentsHTML(qu, always){
  if(!isTraffic(qu)) return "";
  const rv=Object.values(currentRoundVotes()).sort((a,b)=>(a.t||0)-(b.t||0));
  const by=v=>rv.filter(x=>x.answers?.[qu.id]===v && String(x.texts?.[qu.id]||"").trim()).map(x=>String(x.texts[qu.id]).trim());
  const y=by(2), r=by(3); if(!always && !y.length && !r.length) return "";
  const blk=(v,list,title)=>list.length?`<div><h3 style="--c:${TL_COLORS[v-1]}">${esc(title)} (${list.length})</h3><ul>${list.map(t=>`<li>${esc(t)}</li>`).join("")}</ul></div>`:(always?`<div><h3 style="--c:${TL_COLORS[v-1]}">${esc(title)} (0)</h3><p class="meta">No answers.</p></div>`:"");
  return `<div class="card tl-cm">${blk(2,y,tlPrompt(2))}${blk(3,r,tlPrompt(3))}</div>`;
}
function participantHTML(){
  const ses=S.ses, cfg=S.cfg, Q=cfg.questions, ph=Q.length?ses.phase:"lobby", mine=myVotes();
  if(ph!=="voting") S.ui.pq=null;
  const back = S.me.isHost ? `<button class="btn sm ghost" data-act="asHost">Back to presenter view</button>` : "";
  let body="";
  const ro = S.ui.readonly ? `<div class="banner">This account can watch but not vote (view-only access).</div>` : "";
  if(isKicked()){
    body=`<div class="card big-wait"><div class="pulse"></div><h2 style="font-size:24px">Session was reset</h2><p class="meta">The presenter cleared the room and started over. Tap to join again.</p>
      <div class="controls" style="margin-top:16px;justify-content:center"><button class="btn primary" data-act="rejoin">Join again</button></div></div>`;
  } else if(ph==="lobby"){
    body=`<div class="card big-wait"><div class="pulse"></div><h2 style="font-size:24px">You're in</h2><p class="meta">Waiting for the presenter to start.${Q.length?` ${Q.length} ${Q.length===1?"question":"questions"} coming up.`:""}</p></div>`;
  } else if(ph==="voting" && cfg.mode==="live"){
    const qu=Q[ses.current]; const chosen=mine.answers[qu.id]; const revealed=ses.revealed.includes(qu.id);
    body=`<div class="card p-q"><div class="qnum">Question ${ses.current+1} of ${Q.length}</div><div class="qtext">${esc(tx(qu.text))}</div>${revealed?"":scaleHTML(qu,chosen)}</div>
      ${revealed ? `<div class="card chart">${chartHTML(qu,answersFor(qu.id))}</div>` : (needsText(qu,chosen)?`<div class="toast wait">Required: answer the follow-up question above. Your vote counts once you have.</div>`:Number.isFinite(chosen)?`<div class="toast">✓ Answer recorded: ${esc(optLabel(qu,chosen))}. You can change it until results are revealed.</div>`:`<div class="toast wait">${isOpt(qu)?"Tap an option to answer.":"Tap a number to answer."}</div>`)}`;
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
    body=`<div class="card p-q"><div class="qnum">Question ${ses.current+1} of ${Q.length}</div><div class="qtext">${esc(tx(qu.text))}</div></div><div class="card chart">${chartHTML(qu,answersFor(qu.id))}</div>${Number.isFinite(mine.answers[qu.id])?`<div class="toast wait">You answered ${esc(optLabel(qu,mine.answers[qu.id]))}.</div>`:""}`;
  } else if(ph==="summary"){
    const rows=Q.map((qu,i)=>({qu,i,st:stats(answersFor(qu.id),qu.min,qu.max)})).sort((a,b)=>sumScore(b)-sumScore(a));
    body=`<div class="card" style="padding:20px"><div class="eyebrow">Summary</div>${rows.map(r=>`<div class="sum-row"><div class="t">${esc(tx(r.qu.text))}<small>Q${r.i+1} · ${r.st.n} answers${isOpt(r.qu)&&r.st.n?` · most chosen: ${esc(optLabel(r.qu,r.st.mode))}`:""}</small></div>${miniStrip(r.qu,answersFor(r.qu.id))}<div class="m">${sumMetric(r)}</div></div>`).join("")}</div>`;
  }
  return `<div class="p-wrap"><div class="topbar">${brand()}${connPill()}${fontCtl()}${back}</div>${ro}${body}</div>`;
}

/* ---- config ---- */
function configHTML(){
  const d=S.ui.draft;
  return `<div class="modal" id="modal"><div class="card" role="dialog" aria-label="Edit questions">
    <div style="display:flex;align-items:center;gap:10px"><h2 style="font-size:22px;flex:1">Questions</h2><button class="btn sm ghost" data-act="cfgClose">Close</button></div>
    <div class="field"><label>Mode</label><div class="seg"><button data-act="cfgMode" data-v="live" class="${d.mode==="live"?"on":""}">One question at a time</button><button data-act="cfgMode" data-v="batch" class="${d.mode==="batch"?"on":""}">Answer all first, then reveal</button></div></div>
    ${d.questions.some(isTraffic)?`<div class="field"><label for="cfgTlY">Traffic light: follow-up question when someone answers yellow</label><input type="text" id="cfgTlY" value="${esc(d.tlYellow||TL_Q_YELLOW)}"></div>
    <div class="field"><label for="cfgTlR">Traffic light: follow-up question when someone answers red</label><input type="text" id="cfgTlR" value="${esc(d.tlRed||TL_Q_RED)}"></div>`:""}
    <div style="display:grid;gap:12px">${d.questions.map((qu,i)=>`<div class="qcard" data-i="${i}">
      <div class="head"><span class="qnum">Question ${i+1}</span><button class="btn sm ghost" data-act="qUp" data-i="${i}" ${i===0?"disabled":""} title="Move up">↑</button><button class="btn sm ghost" data-act="qDown" data-i="${i}" ${i===d.questions.length-1?"disabled":""} title="Move down">↓</button><button class="btn sm danger" data-act="qDel" data-i="${i}">Remove</button></div>
      <textarea data-q="${i}" data-k="text" id="qt${i}" placeholder="Statement or question">${esc(tx(qu.text))}</textarea>
      <label class="meta" style="display:flex;gap:8px;align-items:center;margin:2px 0 8px"><input type="checkbox" data-act="qTL" data-q="${i}" data-k="tl" ${isTraffic(qu)?"checked":""}> Traffic light: ${esc(TL_LABELS.join(" / "))} (green, yellow, red)</label>
      <div class="field"><label for="qopt${i}">${isTraffic(qu)?"Button labels for green, yellow, red (3 lines, optional)":"Named options, one per line (leave empty for a numeric scale)"}</label><textarea data-q="${i}" data-k="options" id="qopt${i}" rows="${isOpt(qu)?Math.min(qu.options.length+1,8):2}" placeholder="Option A&#10;Option B&#10;Option C">${esc(isOpt(qu)?qu.options.join("\n"):"")}</textarea></div>
      <div class="row" style="${isOpt(qu)?"display:none":""}"><div class="field"><label for="qmin${i}">Scale from</label><input type="number" id="qmin${i}" data-q="${i}" data-k="min" value="${qu.min}" min="0" max="10"></div><div class="field"><label for="qmax${i}">to</label><input type="number" id="qmax${i}" data-q="${i}" data-k="max" value="${qu.max}" min="2" max="11"></div>
      <div class="field"><label for="qlo${i}">Low end label</label><input type="text" id="qlo${i}" data-q="${i}" data-k="lo" value="${esc(tx(qu.lo))}"></div><div class="field"><label for="qhi${i}">High end label</label><input type="text" id="qhi${i}" data-q="${i}" data-k="hi" value="${esc(tx(qu.hi))}"></div></div></div>`).join("")}</div>
    <div class="controls"><button class="btn" data-act="qAdd">+ Add question</button><button class="btn ghost" data-act="qAdd5">+ Add five (1–5, agree scale)</button><button class="btn ghost" data-act="qAddTL">+ Add traffic-light row</button><button class="btn ghost" data-act="csvPick">Import questions from CSV</button><input type="file" id="cfgCsv" accept=".csv,.txt,text/csv,text/plain" style="display:none"></div><div class="meta">CSV: one question per row, appended to the list. First column is the statement; with no other columns every row becomes a 1–5 scale question. Optional header columns: <b>text, type</b> (scale (default), traffic or options), <b>options</b> (separated by |), <b>min, max, lo, hi</b>. Comma or semicolon both work.</div>
    <details id="cfgJsonBox" ${S.ui.jsonOpen?"open":""}><summary>Import / export as JSON</summary><div class="field" style="margin-top:10px"><textarea id="cfgJson" rows="8" style="font-family:ui-monospace,monospace;font-size:13px">${esc(S.ui.jsonText ?? questionsJSON(d))}</textarea><div class="meta">Numeric: {"text","min","max","lo","hi"}. Named options: {"text","options":["…","…"]}. Traffic light: {"text","kind":"traffic"}. With traffic-light questions the JSON is {"followUps":{"yellow":"…","red":"…"},"questions":[…]}; a plain list also works.</div><div class="controls"><button class="btn sm" data-act="cfgImport">Replace questions with this JSON</button></div></div></details>
    <div class="meta">Header, colour and expiry date are under Settings in the top bar. Changing a question's scale after people answered keeps their answers; removing a question drops its answers.</div>
    <div class="controls"><button class="btn primary" data-act="cfgSave">Save</button><button class="btn ghost" data-act="cfgClose">Cancel</button></div>
  </div></div>`;
}
function questionsJSON(d){ const qs=d.questions.map(exportQ);
  return JSON.stringify(d.questions.some(isTraffic) ? {followUps:{yellow:d.tlYellow||TL_Q_YELLOW, red:d.tlRed||TL_Q_RED}, questions:qs} : qs, null, 1); }
function readDraftFromDOM(){
  const d=S.ui.draft; const jb=document.getElementById("cfgJsonBox"); if(jb) S.ui.jsonOpen=jb.open; const jt=document.getElementById("cfgJson"); if(jt && jb && jb.open) S.ui.jsonText=jt.value;
  const ty=document.getElementById("cfgTlY"), tr=document.getElementById("cfgTlR"); if(ty) d.tlYellow=ty.value.trim(); if(tr) d.tlRed=tr.value.trim();
  document.querySelectorAll("[data-q][data-k]").forEach(el=>{ const qu=d.questions[+el.dataset.q]; if(!qu) return; const k=el.dataset.k; if(k==="options"){ qu.options=normOptions(el.value); return; } if(k==="tl"){ qu.tl=el.checked; return; } qu[k] = (k==="min"||k==="max") ? +el.value : el.value; });
  d.questions.forEach(qu=>{ qu.text=(qu.text||"").trim()||"Untitled question";
    if(qu.tl){ qu.kind="traffic"; if(!qu.options||qu.options.length!==3) qu.options=TL_LABELS.slice(); qu.min=1; qu.max=3; qu.lo=""; qu.hi=""; }
    else if(qu.options && qu.options.length>=2){ qu.kind="options"; qu.min=1; qu.max=qu.options.length; qu.lo=""; qu.hi=""; }
    else { delete qu.kind; delete qu.options; qu.min=clamp(Math.round(qu.min||1),0,10); qu.max=clamp(Math.round(qu.max||5),qu.min+1,11); }
    delete qu.tl; });
}

/* ============ overview of all question sets (presenter home) ============ */
const PHASE_LABEL={lobby:"In lobby", running:"Running", finished:"Finished"};
const cap = s => String(s||"").charAt(0).toUpperCase()+String(s||"").slice(1);
function homeHTML(){
  if(!S.me.isHost) return notice("Scan the QR code or open the link you received", "Each question set has its own link. Ask the presenter for the QR code.");
  const top=`<div class="topbar">${brand("Tally Room")}<div class="controls">${connPill()}${S.be&&S.be.demo?`<span class="pill warn">Demo data, this browser only</span>`:""}</div></div>`;
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
        <button data-act="setSettings" data-id="${eid}" data-focus="dlgExp">Other expiry date…</button>
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
function freshSetId(){ let id; do{ id=C.newSetId(); }while(S.sets && S.sets[id]); return id; }

/* ============ dialogs: set settings, QR code, delete ============ */
function toLocalInput(ts){ const d=new Date(ts), p=n=>String(n).padStart(2,"0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`; }
function closeDlg(){ S.ui.dlg=null; render(); }
function openSetDlg(id, focus){ const m=id?metaOf(id):null; if(id && !m) return;
  S.ui.dlg={ type:"set", id:id||null, focus:focus||(id?null:"dlgName"), title:id?"Settings of this question set":"New question set", imported:null,
    f: m ? {...m} : {name:"", header:"", accent:C.DEFAULT_ACCENT, category:"generic", expiresAt:C.extendedExpiry(Date.now()), joinUrl:""} };
  render(); }
function dlgHTML(){ const d=S.ui.dlg; if(!d) return "";
  const body = d.type==="set" ? setDlgHTML(d) : d.type==="qr" ? qrDlgHTML(d) : d.type==="del" ? delDlgHTML(d) : "";
  return `<div class="modal" id="dlg"><div class="card dlg" role="dialog" aria-modal="true" aria-label="${esc(d.title)}">
    <div style="display:flex;align-items:center;gap:10px"><h2 style="font-size:22px;flex:1">${esc(d.title)}</h2><button class="btn sm ghost" data-act="dlgClose">Close</button></div>${body}</div></div>`; }
function setDlgHTML(d){ const f=d.f, isNew=!d.id, acc=C.normHex(f.accent)||C.DEFAULT_ACCENT;
  return `<div class="field"><label for="dlgName">Name (only you see this, in the overview)</label><input type="text" id="dlgName" maxlength="60" value="${esc(tx(f.name))}" placeholder="MT offsite, team B"></div>
    <div class="field"><label for="dlgHeader">Header shown to the audience (leave empty to use the name)</label><input type="text" id="dlgHeader" maxlength="80" value="${esc(tx(f.header)===tx(f.name)?"":tx(f.header))}"></div>
    <div class="field"><label>Accent colour</label><div class="swatches">${C.ACCENT_PRESETS.map(([n,hex])=>`<button type="button" class="sw${hex===acc?" on":""}" data-act="dlgAccent" data-v="${hex}" style="background:${hex}" title="${n}" aria-label="${n}"></button>`).join("")}
      <label class="sw-custom">Other <input type="color" id="dlgColor" value="${acc.toLowerCase()}" aria-label="Pick another accent colour"></label></div></div>
    <div class="field"><label for="dlgCat">Category</label><select id="dlgCat">${C.CATEGORIES.map(c=>`<option value="${c}" ${f.category===c?"selected":""}>${cap(c)}</option>`).join("")}</select>
      <div class="meta">For now this is a label in the overview. Later it decides which question types the set offers.</div></div>
    <div class="field"><label for="dlgExp">Expires on</label><input type="datetime-local" id="dlgExp" value="${Number.isFinite(f.expiresAt)?toLocalInput(f.expiresAt):toLocalInput(C.extendedExpiry(Date.now()))}">
      <div class="controls"><span class="meta">From now:</span>${[[1,"1 day"],[3,"3 days"],[7,"1 week"],[30,"1 month"]].map(([n,l])=>`<button type="button" class="btn sm" data-act="dlgExpQuick" data-v="${n}">${l}</button>`).join("")}</div>
      <div class="meta">After this moment participants can no longer answer. Nothing is deleted and you can extend at any time.</div></div>
    ${isNew ? `<div class="field"><label>Start from a questions file (optional)</label><div class="controls"><button type="button" class="btn sm" data-act="dlgFilePick">Create from file…</button><input type="file" id="dlgFile" accept=".json,application/json" style="display:none"><span class="meta" id="dlgFileNote">A questions file exported from Tally Room. Without it the set starts empty.</span></div></div>`
            : `<div class="field"><label for="dlgJoin">Join link shown to participants (leave empty to use this set's own link)</label><input type="url" id="dlgJoin" value="${esc(f.joinUrl||"")}" placeholder="${esc(urlFor({set:d.id}))}"></div>`}
    <div class="controls"><button class="btn primary" data-act="dlgSave">${isNew?"Create and add questions":"Save"}</button><button class="btn ghost" data-act="dlgClose">Cancel</button></div>`; }
async function saveSetDlg(){ const d=S.ui.dlg, g=id=>document.getElementById(id), now=Date.now();
  const name=g("dlgName").value.trim(); if(!name){ alert("Give the set a name."); g("dlgName").focus(); return; }
  const exp=g("dlgExp").value ? new Date(g("dlgExp").value).getTime() : NaN; if(!Number.isFinite(exp)){ alert("Choose a valid expiry date and time."); g("dlgExp").focus(); return; }
  const fields={ name, header:g("dlgHeader").value.trim().slice(0,80), accent:C.normHex(g("dlgColor").value)||C.DEFAULT_ACCENT, category:g("dlgCat").value, expiresAt:exp };
  try{
    if(d.id){ await S.be.patchMeta(d.id, {...fields, joinUrl:g("dlgJoin")?g("dlgJoin").value.trim():"", updatedAt:now}); closeDlg(); return; }
    const id=freshSetId(), imp=d.imported, cfg=C.emptyConfig();
    if(imp){ cfg.questions=imp.questions; cfg.tlYellow=imp.tlYellow; cfg.tlRed=imp.tlRed; if(imp.set && imp.set.mode) cfg.mode=imp.set.mode; }
    await S.be.writePoll(id, {config:cfg, session:{...DEFAULT_SESSION}});
    await S.be.setMeta(id, C.newMeta({...fields, named:imp&&imp.set?imp.set.named:"no"}, now));
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
async function duplicateSet(id){ const meta=metaOf(id); if(!meta) return;
  try{ const poll=await S.be.readPoll(id), d=C.duplicateSet(meta, poll.config, Date.now()), nid=freshSetId();
    await S.be.writePoll(nid, {config:d.config, session:{...DEFAULT_SESSION}}); await S.be.setMeta(nid, d.meta); loadStats();
  }catch(e){ alert("Duplicating failed: "+(e&&e.message||e)); } }
function extendSet(id){ const now=Date.now(); return S.be.patchMeta(id, {expiresAt:C.extendedExpiry(now), updatedAt:now}).catch(e=>alert("Extending failed: "+(e&&e.message||e))); }
/* ============ actions ============ */
let writeChain=Promise.resolve();
function write(fn){ writeChain = writeChain.then(fn).catch(e=>{ console.warn("write failed",e); if(e&&e.code==="invalid_argument"){ S.ui.readonly=true; render(); } }); return writeChain; }
function setSession(patch){ const next={...S.ses,...patch}; S.ses=next; render(); if(S.review || expired()) return Promise.resolve(); return write(()=>S.backend.setSession(next)); }
function setConfig(next){ S.cfg=next; render(); if(S.review || expired()) return Promise.resolve(); return write(()=>S.backend.setConfig(next)); }

app.addEventListener("click", e=>{
  const b=e.target.closest("[data-act]"); if(!b) return;
  const act=b.dataset.act, v=b.dataset.v, id=b.dataset.id, ses=S.ses, Q=S.cfg?S.cfg.questions:[];
  const menu=b.closest("details.menu"); if(menu) menu.removeAttribute("open");
  /* an expired set is read-only: paging through results stays local, nothing that changes the room is allowed */
  if(S.route==="set" && expired() && ["start","reset","hardReset","config","mode","reviewPublish","vote","rejoin"].includes(act)){ alert("This question set has expired. Extend it first."); return; }
  if(S.review && (act==="reset"||act==="hardReset"||act==="vote")){ alert("Not while you are reviewing saved results. Exit review first."); return; }
  switch(act){
    case "mode": setConfig({...S.cfg, mode:v}); break;
    case "start": setSession({phase:"voting", current:0, revealed:[], showLive:false}); break;
    case "startReveal": S.ui.tlPage=0; S.ui.sumSel=null; if(Q.every(isTraffic)) setSession({phase:"summary", current:0, revealed:Q.map(q=>q.id)}); else setSession({phase:"results", current:0, revealed:Q.map(q=>q.id)}); break;
    case "reveal": setSession({revealed:[...new Set([...ses.revealed, Q[ses.current].id])]}); break;
    case "next": { const c=Math.min(Q.length-1, ses.current+1); setSession({current:c, phase: ses.phase==="results"?"results":"voting"}); break; }
    case "prev": { const c=Math.max(0, ses.current-1); setSession({current:c}); break; }
    case "gotoResults": S.ui.tlPage=0; setSession({phase:"results", current:+v||0}); break;
    case "summary": S.ui.sumSel=null; S.ui.tlPage=0; setSession({phase:"summary"}); break;
    case "tlSel": S.ui.sumSel = (S.ui.sumSel===b.dataset.q) ? null : b.dataset.q; render(); document.getElementById("tl-detail")?.scrollIntoView({behavior:reduced?"auto":"smooth", block:"start"}); break;
    case "lobby": setSession({phase:"lobby", current:0}); break;
    case "showLive": setSession({showLive: b.checked}); break;
    case "impPick": document.getElementById("impFile")?.click(); break;
    case "reviewExit": if(S.review){ const l=S.review.live; S.review=null; S.cfg=l.cfg; S.ses=l.ses; S.votes=l.votes; render(); } break;
    case "reviewPublish": { if(!S.review) break;
      if(!confirm("Publish these results to the live poll? The questions and answers everyone sees are replaced.")) break;
      const cfg=S.cfg, next={...S.ses}, votes=S.votes; S.review=null;
      write(()=>S.backend.setConfig(cfg));
      if(S.backend.setAllVotes) write(()=>S.backend.setAllVotes(votes));
      write(()=>S.backend.setSession(next));
      render(); break; }
    case "expJSON": exportJSON(); break;
    case "expCSV": exportCSV(); break;
    case "hardReset": if(confirm("Reset the session? All answers are cleared, the round counter goes back to 1 and every device has to tap to rejoin.")){
      S.votes={};
      setSession({phase:"lobby", current:0, revealed:[], showLive:false, round:1, resetAt:Date.now()});
      write(()=>S.backend.clearVotes());
      setTimeout(()=>write(()=>S.backend.clearVotes()), 2500); // sweep answers that were already in flight
    } break;
    case "rejoin": S.me.ackReset=(S.ses.resetAt||0); render(); if(S.heartbeat) S.heartbeat(); break;
    case "reset": if(confirm("Clear all answers and start a new round?")){ const r=(ses.round||1)+1; setSession({phase:"lobby", current:0, revealed:[], round:r}); write(()=>S.backend.clearVotes()); } break;
    case "asParticipant": S.ui.view="participant"; render(); break;
    case "asHost": S.ui.view=null; render(); break;
    case "vote": {
      const qid=b.dataset.q, val=+b.dataset.v; const mine=myVotes(); const texts={...(mine.texts||{})}; if(mine.answers[qid]!==val){ delete texts[qid]; if(S.ui.tx) delete S.ui.tx[txKey(qid)]; }
      const next={round:S.ses.round, answers:{...mine.answers,[qid]:val}, texts, t:Date.now()};
      S.votes[S.me.id]=next; render(); write(()=>S.backend.setVotes(S.me.id,next));
      if(mine.answers[qid]!==val && isTraffic(Q.find(x=>x.id===qid)) && val!==1){ const box=document.getElementById("fu_"+qid); if(box){ box.scrollIntoView({block:"center",behavior:reduced?"auto":"smooth"}); try{ box.focus({preventScroll:true}); }catch(e){} } }
      break; }
    case "config": S.ui.draft=JSON.parse(JSON.stringify(S.cfg)); S.ui.configOpen=true; render(); break;
    case "cfgClose": S.ui.configOpen=false; S.ui.draft=null; S.ui.jsonText=null; S.ui.jsonOpen=false; render(); break;
    case "cfgMode": readDraftFromDOM(); S.ui.draft.mode=v; render(); break;
    case "qUp": case "qDown": { readDraftFromDOM(); const i=+b.dataset.i, j=act==="qUp"?i-1:i+1; const a=S.ui.draft.questions; [a[i],a[j]]=[a[j],a[i]]; render(); break; }
    case "qDel": readDraftFromDOM(); S.ui.draft.questions.splice(+b.dataset.i,1); render(); break;
    case "qAdd": readDraftFromDOM(); S.ui.draft.questions.push(q("",1,5,"Strongly disagree","Strongly agree")); render(); setTimeout(()=>{ if(S.ui.draft) document.getElementById("qt"+(S.ui.draft.questions.length-1))?.focus(); },0); break;
    case "fontUp": case "fontDown": { const i=QS_STEPS.indexOf(S.ui.qs), j=clamp(i+(act==="fontUp"?1:-1),0,QS_STEPS.length-1); S.ui.qs=QS_STEPS[j]; try{ localStorage.setItem("tr_qs",String(S.ui.qs)); }catch(e){} applyQS(); render(); break; }
    case "pqPrev": case "pqNext": S.ui.pq=Math.max(0,(S.ui.pq||0)+(act==="pqNext"?1:-1)); render(); window.scrollTo(0,0); break;
    case "tlPrev": case "tlNext": { const y=scrollY; S.ui.tlPage=(S.ui.tlPage||0)+(act==="tlNext"?1:-1); render(); scrollTo(0,y); break; }
    case "csvPick": document.getElementById("cfgCsv")?.click(); break;
    case "qTL": readDraftFromDOM(); render(); break;
    case "qAddTL": readDraftFromDOM(); const have=S.ui.draft.questions.filter(isTraffic).length; const add=have===0?2:1; for(let k=0;k<add;k++) S.ui.draft.questions.push(q("",1,3,"","",null,true)); render(); break;
    case "qAdd5": readDraftFromDOM(); for(let k=0;k<5;k++) S.ui.draft.questions.push(q("",1,5,"Strongly disagree","Strongly agree")); render(); break;
    case "cfgImport": { readDraftFromDOM(); try{ let arr=JSON.parse(document.getElementById("cfgJson").value); if(arr && !Array.isArray(arr) && Array.isArray(arr.questions)){ const f=arr.followUps||{}; if(typeof f.yellow==="string"&&f.yellow.trim()) S.ui.draft.tlYellow=f.yellow.trim(); if(typeof f.red==="string"&&f.red.trim()) S.ui.draft.tlRed=f.red.trim(); arr=arr.questions; } if(!Array.isArray(arr)) throw 0; S.ui.draft.questions=arr.map(x=>q(x.text||"",C.num(x.min,1),C.num(x.max,5),x.lo||"",x.hi||"",x.options,x.kind==="traffic"||x.traffic===true)); S.ui.jsonText=null; render(); }catch(err){ alert("That JSON could not be read. Expected a list like [{\"text\":\"…\",\"min\":1,\"max\":5,\"lo\":\"…\",\"hi\":\"…\"}] or [{\"text\":\"…\",\"options\":[\"…\",\"…\"]}]"); } break; }
    case "cfgSave": { readDraftFromDOM(); const d=S.ui.draft; if(!d.questions.length){ alert("Add at least one question."); break; } S.ui.configOpen=false; S.ui.draft=null; S.ui.jsonText=null; S.ui.jsonOpen=false; const cur=Math.min(S.ses.current, d.questions.length-1); setConfig(d); if(cur!==S.ses.current) setSession({current:cur}); if(!S.review) S.be.patchMeta(S.setId,{updatedAt:Date.now()}).catch(()=>{}); break; }
    /* ---- question sets ---- */
    case "setNew": openSetDlg(null); break;
    case "setSettings": openSetDlg(id, b.dataset.focus); break;
    case "setExtend": extendSet(id); break;
    case "setQR": S.ui.dlg={type:"qr", id, title:"QR code: "+tx((metaOf(id)||{}).name)}; render(); break;
    case "setDup": duplicateSet(id); break;
    case "setExpQ": exportSet(id,"questions"); break;
    case "setExpJSON": exportSet(id,"json"); break;
    case "setExpCSV": exportSet(id,"csv"); break;
    case "setDel": openDelDlg(id); break;
    case "delConfirm": { const d=S.ui.dlg; if(!d || d.type!=="del") break;
      S.be.removeSet(d.id).then(()=>{ delete S.polls[d.id]; if(S.route==="set") location.href=urlFor(); else closeDlg(); }).catch(e=>alert("Deleting failed: "+(e&&e.message||e))); break; }
    case "dlgClose": closeDlg(); break;
    case "dlgSave": saveSetDlg(); break;
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
  if(inp && inp.id==="dlgFile"){ const f=inp.files&&inp.files[0]; inp.value=""; if(f) readSetFile(f); return; }
  if(inp && inp.id==="dlgColor"){ markSwatch(); return; }
  if(inp && inp.id==="cfgCsv"){ const f=inp.files&&inp.files[0]; inp.value=""; if(!f) return; const r=new FileReader(); r.onerror=()=>alert("Could not read that file.");
    r.onload=()=>{ const qs=csvToQuestions(String(r.result||"")); if(!qs.length){ alert("No questions found in that CSV."); return; }
      readDraftFromDOM(); S.ui.draft.questions.push(...qs); render(); }; r.readAsText(f); return; }
  if(!inp || inp.id!=="impFile") return;
  const f=inp.files && inp.files[0]; inp.value="";
  if(!f) return; const r=new FileReader(); r.onerror=()=>alert("Could not read that file.");
  r.onload=()=>importResults(String(r.result||""), f.name); r.readAsText(f); });
let fuTimer=null;
app.addEventListener("input", e=>{ const t=e.target; if(t && t.id==="dlgColor"){ markSwatch(); return; } if(!t || !t.classList || !t.classList.contains("tl-fu-in")) return;
  S.ui.tx=S.ui.tx||{}; S.ui.tx[txKey(t.dataset.q)]=t.value; clearTimeout(fuTimer); const qid=t.dataset.q; fuTimer=setTimeout(()=>saveText(qid), 800); });
app.addEventListener("focusout", e=>{ const t=e.target; if(S.rendering || !t || !t.isConnected) return; if(t.classList && t.classList.contains("tl-fu-in")){ clearTimeout(fuTimer); saveText(t.dataset.q); } });
app.addEventListener("keydown", e=>{ if(e.key!=="Escape") return; if(S.ui.dlg){ closeDlg(); return; } if(S.ui.configOpen){ S.ui.configOpen=false; S.ui.jsonText=null; render(); } });
app.addEventListener("toggle", e=>{ if(e.target && e.target.id==="cfgJsonBox") S.ui.jsonOpen=e.target.open; }, true);
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
  const be = B.make({ firebaseConfig:(typeof FIREBASE_CONFIG!=="undefined" ? FIREBASE_CONFIG : {}), hostKey:(typeof HOST_KEY!=="undefined" ? HOST_KEY : ""), params });
  S.be=be; S.me.id=be.id; S.me.isHost=be.isHost; S.ui.readonly = be.canWrite===false;
  let offTimer=null;
  function setOffline(off){ if(off===!!S.ui.offline) return; S.ui.offline=off; if(S.booted) renderBg(); }
  if(be.onConn) be.onConn(ok=>{ clearTimeout(offTimer); if(ok) setOffline(false); else offTimer=setTimeout(()=>setOffline(true), 6000); });
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
  const raw={cfg:undefined, ses:undefined}; let editDone=!params.has("edit");
  function settle(){ if(S.review) return;
    if(raw.cfg!==undefined) S.cfg=C.normConfig(raw.cfg);
    if(raw.ses!==undefined) S.ses={...DEFAULT_SESSION,...(raw.ses||{})};
    /* a set that was just created opens straight in the question editor */
    if(!editDone && S.me.isHost && S.meta && S.cfg && S.ses){ editDone=true; try{ history.replaceState(null,"",urlFor({set:S.setId})); }catch(e){}
      S.ui.draft=JSON.parse(JSON.stringify(S.cfg)); S.ui.configOpen=true; } }
  p.onMeta((m,err)=>{ const was=expired(); S.metaErr=err||null; S.meta=err?undefined:C.normMeta(m); settle(); renderBg(); if(was && !expired()) heartbeat(); });
  p.onConfig(c=>{ raw.cfg=c||null; if(S.review){ S.review.live.cfg=C.normConfig(c); return; } settle(); renderBg(); });
  p.onSession(s=>{ s=normSession(s); noteReset(s); raw.ses=s||null; if(S.review){ S.review.live.ses={...DEFAULT_SESSION,...(s||{})}; return; } settle(); renderBg(); });
  p.onVotes(v=>{ if(S.review){ S.review.live.votes=v||{}; return; } S.votes=v||{}; renderBg(); });
  // announce presence so the host sees who joined (a vote doc with no answers)
  function heartbeat(){ if(!S.ses || !S.meta || expired() || be.canWrite===false || isKicked() || S.review) return; const isP = !be.isHost || S.ui.view==="participant"; if(!isP) return;
    const cur=S.votes[be.id]; const doc = (cur && cur.round===S.ses.round) ? {...cur, t:Date.now()} : {round:S.ses.round, answers:{}, t:Date.now()};
    S.votes[be.id]=doc; write(()=>p.setVotes(be.id,doc)); }
  S.heartbeat=heartbeat;
  setTimeout(heartbeat, 800);
  setInterval(heartbeat, 60000);
  setInterval(renderBg, be.isHost ? 30000 : 60000); // presence fades and sets expire with the clock, on every device

  /* ---- staying in sync after the screen has been off ---- */
  function applyPull(d){ if(!d || S.review) return;
    if(d.config) raw.cfg=d.config;
    const ss=normSession(d.session); noteReset(ss); if(ss && ss.phase) raw.ses=ss;
    settle(); if(!S.ses) return;
    const mine=S.votes[S.me.id]; S.votes=d.votes||{}; if(mine && mine.round===S.ses.round) S.votes[S.me.id]=mine;
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
