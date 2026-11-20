/* Tally Room backends: where the data lives.
   Both backends offer the same interface:
     global   id, isHost, canWrite, demo, isConnected(), onConn(f), downFor(), nudge()
     sets     onSets(f(map|null, err)), getSets(), setMeta(id, meta), patchMeta(id, patch), removeSet(id)
     polls    readPoll(id), writePoll(id, {config, session}), poll(id) -> live access to one set
   Data layout: sets/{id} = attributes of a set, polls/{id}/config|session|votes = its questions, state and answers. */
(function(root){
"use strict";
const C=root.TRCore;

function localId(){ try{ let id=localStorage.getItem("tr_pid"); if(!id){ id="p_"+Math.random().toString(36).slice(2,12); localStorage.setItem("tr_pid",id);} return id; }catch(e){ return "p_"+Math.random().toString(36).slice(2,12); } }

/* Presenter flag: one per device, valid for all sets. ?host=KEY switches it on, ?host=off switches it off. */
function resolveHost(params, hostKey, demo){
  if(demo) return params.get("host")!=="off"; // demo: presenter unless asked otherwise, nothing is stored
  try{
    const legacy=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k && k.indexOf("tr_host_")===0) legacy.push(k); }
    if(legacy.some(k=>localStorage.getItem(k)==="1")) localStorage.setItem("tr_host","1"); // flag from before sets existed (it was kept per poll)
    legacy.forEach(k=>localStorage.removeItem(k));
    if(hostKey && params.get("host")===hostKey) localStorage.setItem("tr_host","1");
    if(params.get("host")==="off") localStorage.removeItem("tr_host");
    return localStorage.getItem("tr_host")==="1";
  }catch(e){ return !!hostKey && params.get("host")===hostKey; }
}

/* ---- Demo backend: no network. Data sits in this browser (localStorage) and is shared between its tabs.
        Eight simulated participants answer in the tab that presents, to preview the design. ---- */
function makeDemoBackend(isHost){
  const KEY="tr_demo_db"; let mem=null;
  const load=()=>{ try{ const v=JSON.parse(localStorage.getItem(KEY)||"null"); if(v && v.sets && v.polls) return v; }catch(e){} return mem||{sets:{},polls:{}}; };
  let db=load();
  const save=()=>{ mem=db; try{ localStorage.setItem(KEY, JSON.stringify(db)); }catch(e){} };
  const L={sets:[], poll:{}}; // listeners
  const pl=id=>(L.poll[id]=L.poll[id]||{meta:[],cfg:[],ses:[],votes:[]});
  const P=id=>(db.polls[id]=db.polls[id]||{});
  const copy=v=>v==null?null:JSON.parse(JSON.stringify(v));
  function emit(id, what){ const l=L.poll[id]; if(!l) return; const p=db.polls[id]||{};
    if(!what||what==="meta") l.meta.forEach(f=>f(copy(db.sets[id])));
    if(!what||what==="cfg") l.cfg.forEach(f=>f(copy(p.config)));
    if(!what||what==="ses") l.ses.forEach(f=>f(copy(p.session)));
    if(!what||what==="votes") l.votes.forEach(f=>f(copy(p.votes)||{})); }
  const emitSets=()=>L.sets.forEach(f=>f(copy(db.sets)||{}));
  const emitAll=()=>{ emitSets(); Object.keys(L.poll).forEach(id=>emit(id)); };
  try{ root.addEventListener("storage", e=>{ if(e.key===KEY){ db=load(); emitAll(); } }); }catch(e){}
  if(!Object.keys(db.sets).length){ const now=Date.now();
    db.sets.demo0001=C.newMeta({name:"Demo set", header:"Tally Room demo", category:"consent"}, now);
    db.polls.demo0001={ session:{...C.DEFAULT_SESSION}, config:{ mode:"live", tlYellow:"What is your concern, and what do you suggest?", tlRed:"What is your objection, and how could it be resolved?", questions:[
      C.q("This workshop is a good use of my time.",1,5,"Strongly disagree","Strongly agree"),
      C.q("Which topic should we start with?",1,3,"","",["Strategy","Ways of working","Customers"]),
      {...C.q("We adopt the proposal as written.",1,3,"","",null,true), options:["Consent","Concern","Objection"]},
      C.q("How confident are you that we will follow through?",1,7,"Not at all","Completely"),
      C.qOpen("What should we do differently next time?") ] } };
    save(); }
  const names=["a","b","c","d","e","f","g","h"];
  function simulate(id){ const p=db.polls[id]; if(!isHost || !p || !p.session || !p.config) return; const ses=p.session, cfg=C.normConfig(p.config); if(!cfg.questions.length) return;
    const put=(n,v)=>{ const pp=P(id); pp.votes=pp.votes||{}; if(C.isNamed((db.sets[id]||{}).named)){ v.name=n+String(11+names.indexOf(n)*7); v.nameAt=1; } else delete v.name; pp.votes["demo_"+n]=v; save(); emit(id,"votes"); };
    const get=n=>((db.polls[id]||{}).votes||{})["demo_"+n];
    if(ses.phase==="lobby"){ names.forEach((n,i)=>setTimeout(()=>{ const v=get(n); if(!v||v.round!==ses.round) put(n,{round:ses.round,answers:{},t:Date.now()}); }, 300*i)); return; }
    if(ses.phase==="voting"){ const qs = (cfg.mode==="live"||ses.revote) ? [cfg.questions[ses.current]].filter(Boolean) : cfg.questions;
      names.forEach((n,i)=>qs.forEach((qu,j)=>setTimeout(()=>{ const cur=get(n), v=(cur && cur.round===ses.round) ? {...cur, answers:{...(cur.answers||{})}} : {round:ses.round,answers:{}}; if(v.answers[qu.id]!=null && C.answerIsCurrent(v,qu.id,qu.rev)) return; // an edited proposal is voted on again
        const bias=(j%3===0?0.75:j%3===1?0.55:0.4); const r=(Math.random()+Math.random()+Math.random())/3; const val=Math.round(qu.min+(qu.max-qu.min)*C.clamp(r*1.1+bias*0.5-0.3,0,1));
        v.answers[qu.id]=val; if(qu.kind==="traffic"){ if(v.texts){ v.texts={...v.texts}; delete v.texts[qu.id]; } if((qu.rev||1)>1) v.revs={...(v.revs||{}),[qu.id]:qu.rev}; }
        if(qu.kind==="traffic" && val!==1){ v.texts={...(v.texts||{})}; v.texts[qu.id]=(val===2?"Demo concern from ":"Demo objection from ")+n; }
        if(qu.kind==="open"){ v.answers[qu.id]=1; v.texts={...(v.texts||{})}; v.texts[qu.id]="Demo answer from "+n+(i%3===0?", with a second line\nto show how longer answers wrap":""); }
        if(qu.kind==="dilemma"){ const cf=qu.conf||C.DEFAULT_CONF; v.conf={...(v.conf||{})}; v.conf[qu.id]=cf.min+Math.round(Math.random()*(cf.max-cf.min)); }
        v.t=Date.now(); put(n,v); }, 500+400*i+150*j))); } }
  return { id:localId(), isHost, canWrite:true, demo:true,
    isConnected:()=>true, onConn:f=>f(true), downFor:()=>0, nudge:()=>{},
    onSets:f=>{ L.sets.push(f); f(copy(db.sets)||{}); },
    getSets:async()=>copy(db.sets)||{},
    setMeta:async(id,m)=>{ db.sets[id]=copy(m); save(); emitSets(); emit(id,"meta"); },
    patchMeta:async(id,p)=>{ db.sets[id]={...(db.sets[id]||{}),...copy(p)}; save(); emitSets(); emit(id,"meta"); },
    removeSet:async id=>{ delete db.sets[id]; delete db.polls[id]; save(); emitSets(); emit(id); },
    readPoll:async id=>copy(db.polls[id])||{},
    writePoll:async(id,p)=>{ db.polls[id]=copy(p)||{}; save(); emit(id); },
    poll:id=>{ const l=pl(id); return { pull:null,
      onMeta:f=>{ l.meta.push(f); f(copy(db.sets[id])); },
      onConfig:f=>{ l.cfg.push(f); f(copy((db.polls[id]||{}).config)); },
      onSession:f=>{ l.ses.push(f); f(copy((db.polls[id]||{}).session)); },
      onVotes:f=>{ l.votes.push(f); f(copy((db.polls[id]||{}).votes)||{}); },
      setConfig:async c=>{ P(id).config=copy(c); save(); emit(id,"cfg"); },
      setSession:async s=>{ P(id).session=copy(s); save(); emit(id,"ses"); simulate(id); },
      setVotes:async(pid,v)=>{ const p=P(id); p.votes=p.votes||{}; p.votes[pid]=copy(v); save(); emit(id,"votes"); },
      setAllVotes:async v=>{ P(id).votes=copy(v)||{}; save(); emit(id,"votes"); },
      clearVotes:async()=>{ P(id).votes={}; save(); emit(id,"votes"); } }; } };
}

/* ---- Firebase Realtime Database backend (self-hosted version, open to anyone with the link) ---- */
function makeFirebaseBackend(config, isHost){
  root.firebase.initializeApp(config);
  const db=root.firebase.database(), BASE=String(config.databaseURL).replace(/\/+$/,"");
  /* a phone that was locked or backgrounded comes back with a dead socket: watch the link,
     force a reconnect, and fall back to plain HTTPS reads so a stalled socket never strands anyone */
  let connected=false, downSince=Date.now(), lastNudge=0; const connFns=[];
  db.ref(".info/connected").on("value", s=>{ const now=s.val()===true; if(now===connected) return; connected=now; if(!now) downSince=Date.now(); connFns.forEach(f=>f(now)); });
  const rest=async path=>{ const r=await fetch(BASE+"/"+path+".json?_="+Date.now(), {cache:"no-store"}); if(!r.ok) throw new Error("rest "+r.status); return (await r.json())||{}; };
  return { id:localId(), isHost, canWrite:true, demo:false,
    isConnected:()=>connected,
    onConn:f=>{ connFns.push(f); f(connected); },
    downFor:()=>connected ? 0 : Date.now()-downSince,
    nudge:()=>{ const t=Date.now(); if(connected || t-downSince<8000 || t-lastNudge<10000) return; lastNudge=t; try{ db.goOffline(); db.goOnline(); }catch(e){} },
    onSets:f=>db.ref("sets").on("value", s=>f(s.val()||{}), e=>f(null,e)),
    getSets:async()=>(await db.ref("sets").once("value")).val()||{},
    setMeta:(id,m)=>db.ref("sets/"+id).set(m),
    patchMeta:(id,p)=>db.ref("sets/"+id).update(p),
    removeSet:id=>Promise.all([db.ref("sets/"+id).remove(), db.ref("polls/"+id).remove()]),
    readPoll:async id=>{ try{ return await rest("polls/"+id); }catch(e){ return (await db.ref("polls/"+id).once("value")).val()||{}; } },
    writePoll:(id,p)=>db.ref("polls/"+id).set(p),
    poll:id=>{ const node=db.ref("polls/"+id); return {
      pull:()=>rest("polls/"+id),
      onMeta:f=>db.ref("sets/"+id).on("value", s=>f(s.val()), e=>f(null,e)),
      onConfig:f=>node.child("config").on("value", s=>f(s.val())),
      onSession:f=>node.child("session").on("value", s=>f(s.val())),
      onVotes:f=>node.child("votes").on("value", s=>f(s.val()||{})),
      setConfig:c=>node.child("config").set(c),
      setSession:s=>node.child("session").set(s),
      setVotes:(pid,v)=>node.child("votes/"+pid).set(v),
      setAllVotes:v=>node.child("votes").set(v||{}),
      clearVotes:()=>node.child("votes").remove() }; } };
}

/* opts: {firebaseConfig, hostKey, params}. Demo when ?demo is in the address or Firebase is not configured. */
function make(opts){ const fc=opts.firebaseConfig||{}, params=opts.params;
  const demo = params.has("demo") || !(root.firebase && fc.apiKey && fc.databaseURL);
  const isHost = resolveHost(params, opts.hostKey, demo);
  if(demo){ if(!params.has("demo")) console.warn("Firebase not configured: running in single-browser demo mode."); return makeDemoBackend(isHost); }
  return makeFirebaseBackend(fc, isHost);
}
root.TRBackend={ make };
})(window);
