/* Tally Room backends: where the data lives.
   Both backends offer the same interface:
     global   id, isHost, canWrite, demo, isConnected(), onConn(f), downFor(), nudge(), now()
     sign-in  onAuth(f(state)), signIn(email, password), signOut(), resetPassword(email)
              id and isHost follow the sign-in and can change while the page is open (backlog G1, G2)
     sets     onSets(f(map|null, err)), getSets(), setMeta(id, meta), patchMeta(id, patch), removeSet(id), moveSet(id, newId)
     polls    readPoll(id), writePoll(id, {config, session}), poll(id) -> live access to one set
   Data layout: sets/{id} = attributes of a set, polls/{id}/config|session|votes = its questions, state and answers,
   polls/{id}/actions = follow-up actions the presenter records for concerns and objections. */
(function(root){
"use strict";
const C=root.TRCore;

/* the demo store has no sign-in: its device id is made up here and kept in this browser */
function demoId(){ try{ let id=localStorage.getItem("tr_demo_pid"); if(!id){ id="p_"+Math.random().toString(36).slice(2,12); localStorage.setItem("tr_demo_pid",id);} return id; }catch(e){ return "p_"+Math.random().toString(36).slice(2,12); } }
/* from before sign-in existed: the presenter flag (tr_host, tr_host_{poll}) and the self-made device id (tr_pid) */
function dropLegacyKeys(){ try{ const old=[]; for(let i=0;i<localStorage.length;i++){ const k=localStorage.key(i); if(k && (k==="tr_host" || k==="tr_pid" || k.indexOf("tr_host_")===0)) old.push(k); }
  old.forEach(k=>localStorage.removeItem(k)); }catch(e){} }

/* ---- Demo backend: no network. Data sits in this browser (localStorage) and is shared between its tabs.
        Eight simulated participants answer in the tab that presents, to preview the design. ---- */
function makeDemoBackend(isHost){
  const KEY="tr_demo_db"; let mem=null;
  const load=()=>{ try{ const v=JSON.parse(localStorage.getItem(KEY)||"null"); if(v && v.sets && v.polls) return v; }catch(e){} return mem||{sets:{},polls:{}}; };
  let db=load();
  const save=()=>{ mem=db; try{ localStorage.setItem(KEY, JSON.stringify(db)); }catch(e){} };
  const L={sets:[], poll:{}}; // listeners
  const pl=id=>(L.poll[id]=L.poll[id]||{meta:[],cfg:[],ses:[],votes:[],actions:[]});
  const P=id=>(db.polls[id]=db.polls[id]||{});
  const copy=v=>v==null?null:JSON.parse(JSON.stringify(v));
  function emit(id, what){ const l=L.poll[id]; if(!l) return; const p=db.polls[id]||{};
    if(!what||what==="meta") l.meta.forEach(f=>f(copy(db.sets[id])));
    if(!what||what==="cfg") l.cfg.forEach(f=>f(copy(p.config)));
    if(!what||what==="ses") l.ses.forEach(f=>f(copy(p.session)));
    if(!what||what==="votes") l.votes.forEach(f=>f(copy(p.votes)||{}));
    if(!what||what==="actions") l.actions.forEach(f=>f(copy(p.actions)||{})); }
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
    const put=(n,v)=>{ const pp=P(id); pp.votes=pp.votes||{}; if(C.isNamed((db.sets[id]||{}).named)){ v.name=n+String(names.indexOf(n)+1); v.nameAt=1; } else delete v.name; pp.votes["demo_"+n]=v; save(); emit(id,"votes"); };
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
  return { id:demoId(), isHost, canWrite:true, demo:true,
    isConnected:()=>true, onConn:f=>f(true), downFor:()=>0, nudge:()=>{}, now:()=>Date.now(),
    onAuth:f=>f({ready:true, uid:null, isHost, anon:false, email:"", error:null}), // nothing to sign in to
    signIn:async()=>{}, signOut:async()=>{}, resetPassword:async()=>{},
    onSets:f=>{ L.sets.push(f); f(copy(db.sets)||{}); },
    getSets:async()=>copy(db.sets)||{},
    setMeta:async(id,m)=>{ db.sets[id]=copy(m); save(); emitSets(); emit(id,"meta"); },
    patchMeta:async(id,p)=>{ db.sets[id]={...(db.sets[id]||{}),...copy(p)}; save(); emitSets(); emit(id,"meta"); },
    removeSet:async id=>{ delete db.sets[id]; delete db.polls[id]; save(); emitSets(); emit(id); },
    moveSet:async(id,nid)=>{ if(!db.sets[id]) throw new Error("This set does not exist any more."); if(db.sets[nid] || db.polls[nid]) throw new Error("That link is already in use.");
      db.sets[nid]=db.sets[id]; if(db.polls[id]) db.polls[nid]=db.polls[id]; delete db.sets[id]; delete db.polls[id]; save(); emitSets(); emit(id); emit(nid); },
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
      clearVotes:async()=>{ P(id).votes={}; save(); emit(id,"votes"); },
      onActions:f=>{ l.actions.push(f); f(copy((db.polls[id]||{}).actions)||{}); },
      setAction:async(key,a)=>{ const p=P(id); p.actions=p.actions||{}; p.actions[key]=copy(a); save(); emit(id,"actions"); },
      clearActions:async()=>{ P(id).actions={}; save(); emit(id,"actions"); } }; } };
}

/* ---- Firebase Realtime Database backend ----
   Who you are comes from Firebase Authentication (backlog G1, G2):
     presenter    signed in with email and password, and listed in presenters/{uid}
     participant  signed in anonymously, without any screen; the uid is the device id and the key of its vote record
   The database rules (database.rules.json) decide what each of them may read and write.
   opts.anon: sign in anonymously when nobody is signed in (a set page); opts.signOut: ?host=off */
function makeFirebaseBackend(config, opts){
  root.firebase.initializeApp(config);
  dropLegacyKeys();
  const db=root.firebase.database();
  /* WebSockets only: the other way the Firebase script connects (long polling) loads scripts from the database host,
     which the Content Security Policy in index.html does not allow (backlog G7) */
  try{ db.INTERNAL.forceWebSockets(); }catch(e){ console.warn("WebSockets could not be forced", e); }
  const auth=root.firebase.auth(), BASE=String(config.databaseURL).replace(/\/+$/,"");
  /* a phone that was locked or backgrounded comes back with a dead socket: watch the link,
     force a reconnect, and fall back to plain HTTPS reads so a stalled socket never strands anyone */
  let connected=false, downSince=Date.now(), lastNudge=0, offset=0; const connFns=[];
  db.ref(".info/connected").on("value", s=>{ const now=s.val()===true; if(now===connected) return; connected=now; if(!now) downSince=Date.now(); connFns.forEach(f=>f(now)); });
  db.ref(".info/serverTimeOffset").on("value", s=>{ offset=Number(s.val())||0; }); // the rules use the server's clock, so expiry does too
  const now=()=>Date.now()+offset;
  /* plain HTTPS reads carry the ID token of the signed-in device; without it the rules refuse them */
  const rest=async path=>{ const u=auth.currentUser; if(!u) throw new Error("rest: not signed in"); const tok=await u.getIdToken();
    const r=await fetch(BASE+"/"+path+".json?auth="+encodeURIComponent(tok)+"&_="+Date.now(), {cache:"no-store"}); if(!r.ok) throw new Error("rest "+r.status); return (await r.json())||{}; };

  /* ---- sign-in state ---- */
  const st={ready:false, uid:null, isHost:false, anon:false, email:"", error:null}, authFns=[];
  let wantOut=!!opts.signOut, seq=0;
  /* live listeners are attached again whenever the identity changes: the server drops the ones the new identity may not
     keep, and a presenter-only path (the list of sets, the actions) is only listened to by a presenter */
  const subs=[];
  function attach(sub){ detach(sub); if(!st.uid || (sub.hostOnly && !st.isHost)){ if(sub.hostOnly && st.ready) sub.empty(); return; }
    const ref=db.ref(sub.path), uid=st.uid, cb=ref.on("value", s=>sub.f(s.val()), e=>{ if(sub.live && sub.live.cb===cb){ sub.live=null; if(sub.err && st.uid===uid) sub.err(e); } });
    sub.live={ref, cb}; }
  function detach(sub){ if(sub.live){ const l=sub.live; sub.live=null; try{ l.ref.off("value", l.cb); }catch(e){} } }
  function listen(path, f, err, hostOnly, empty){ const sub={path, f, err, hostOnly:!!hostOnly, empty:empty||(()=>{}), live:null}; subs.push(sub); if(st.ready) attach(sub); }
  function publish(next){ const changed = !st.ready || next.uid!==st.uid || next.isHost!==st.isHost;
    Object.assign(st, next, {ready:true}); if(changed) subs.forEach(attach); authFns.forEach(f=>f({...st})); }
  async function resolve(user){ const my=++seq;
    if(user && !user.isAnonymous && wantOut){ wantOut=false; try{ await auth.signOut(); }catch(e){} return; } // ?host=off
    wantOut=false;
    if(!user){
      if(!opts.anon){ publish({uid:null, isHost:false, anon:false, email:"", error:null}); return; }
      try{ await auth.signInAnonymously(); }catch(e){ console.warn("anonymous sign-in failed", e); if(my===seq) publish({uid:null, isHost:false, anon:false, email:"", error:"anon"}); }
      return; } // the sign-in itself brings the next state
    if(user.isAnonymous){ publish({uid:user.uid, isHost:false, anon:true, email:"", error:null}); return; }
    let host=false; try{ host=(await db.ref("presenters/"+user.uid).once("value")).val()===true; }catch(e){ console.warn("presenter check failed", e); }
    if(my===seq) publish({uid:user.uid, isHost:host, anon:false, email:user.email||"", error:null}); }
  auth.onAuthStateChanged(resolve, e=>{ console.warn("auth", e); publish({uid:null, isHost:false, anon:false, email:"", error:"anon"}); });

  const denied=e=>!!e && /permission.denied/i.test(String(e.code||"")+" "+String(e.message||""));
  return { get id(){ return st.uid; }, get isHost(){ return st.isHost; }, canWrite:true, demo:false,
    isConnected:()=>connected,
    onConn:f=>{ connFns.push(f); f(connected); },
    downFor:()=>connected ? 0 : Date.now()-downSince,
    nudge:()=>{ const t=Date.now(); if(connected || t-downSince<8000 || t-lastNudge<10000) return; lastNudge=t; try{ db.goOffline(); db.goOnline(); }catch(e){} },
    now,
    onAuth:f=>{ authFns.push(f); if(st.ready) f({...st}); },
    signIn:(email,password)=>auth.signInWithEmailAndPassword(email,password),
    /* on a set page the presenter turns straight into an anonymous participant, without a moment as nobody */
    signOut:()=>opts.anon ? auth.signInAnonymously() : auth.signOut(),
    resetPassword:email=>auth.sendPasswordResetEmail(email),
    onSets:f=>listen("sets", v=>f(v||{}), e=>f(null,e), true),
    getSets:async()=>(await db.ref("sets").once("value")).val()||{},
    setMeta:(id,m)=>db.ref("sets/"+id).set(m),
    patchMeta:(id,p)=>db.ref("sets/"+id).update(p),
    removeSet:id=>Promise.all([db.ref("sets/"+id).remove(), db.ref("polls/"+id).remove()]),
    /* the set under another id: everything is copied and the old id removed in one write, so it is never half moved */
    moveSet:async(id,nid)=>{ const val=async p=>(await db.ref(p).once("value")).val();
      const [meta,poll,m2,p2]=await Promise.all([val("sets/"+id), val("polls/"+id), val("sets/"+nid), val("polls/"+nid)]);
      if(!meta) throw new Error("This set does not exist any more."); if(m2 || p2) throw new Error("That link is already in use.");
      try{ await db.ref().update({["sets/"+nid]:meta, ["polls/"+nid]:poll, ["sets/"+id]:null, ["polls/"+id]:null}); }
      catch(e){ if(denied(e)) throw new Error("This set holds answers in an old format. Clear the answers or export them first"); throw e; } },
    readPoll:async id=>{ try{ return await rest("polls/"+id); }catch(e){ return (await db.ref("polls/"+id).once("value")).val()||{}; } },
    writePoll:(id,p)=>db.ref("polls/"+id).set(p),
    poll:id=>{ const node=db.ref("polls/"+id), P="polls/"+id; return {
      /* only a presenter may read polls/{id} as a whole; a participant reads the parts it is allowed to */
      pull:async()=>{ if(st.isHost) return rest(P); const [config,session,votes]=await Promise.all([rest(P+"/config"), rest(P+"/session"), rest(P+"/votes")]); return {config, session, votes}; },
      onMeta:f=>listen("sets/"+id, f, e=>f(null,e)),
      onConfig:f=>listen(P+"/config", f),
      onSession:f=>listen(P+"/session", f),
      onVotes:f=>listen(P+"/votes", v=>f(v||{})),
      setConfig:c=>node.child("config").set(c),
      setSession:s=>node.child("session").set(s),
      /* the rules refuse a time stamp that is ahead of the server, so a phone with a fast clock is held back to the server's */
      setVotes:(pid,v)=>node.child("votes/"+pid).set(v && Number.isFinite(v.t) && v.t>now()+30000 ? {...v, t:Math.round(now())} : v),
      setAllVotes:v=>node.child("votes").set(v||{}),
      clearVotes:()=>node.child("votes").remove(),
      onActions:f=>listen(P+"/actions", v=>f(v||{}), null, true, ()=>f({})),
      setAction:(key,a)=>node.child("actions/"+key).set(a),
      clearActions:()=>node.child("actions").remove() }; } };
}

/* opts: {firebaseConfig, params, anon}. Demo when ?demo is in the address or Firebase is not configured. */
function make(opts){ const fc=opts.firebaseConfig||{}, params=opts.params;
  const demo = params.has("demo") || !(root.firebase && root.firebase.auth && fc.apiKey && fc.databaseURL);
  if(demo){ if(!params.has("demo")) console.warn("Firebase not configured: running in single-browser demo mode.");
    return makeDemoBackend(params.get("host")!=="off"); } // demo: presenter unless asked otherwise, nothing is stored
  return makeFirebaseBackend(fc, {anon:!!opts.anon, signOut:params.get("host")==="off"});
}
root.TRBackend={ make };
if(typeof module!=="undefined" && module.exports) module.exports=root.TRBackend;
})(typeof window!=="undefined" ? window : globalThis);
