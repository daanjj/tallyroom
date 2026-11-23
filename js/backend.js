/* Tally Room backends: where the data lives.
   Both backends offer the same interface:
     global   id, role, isUser, isAdmin, isHost, canWrite, demo, isConnected(), onConn(f), downFor(), nudge(), now()
     sign-in  onAuth(f(state)), signIn(email, password), signOut(), resetPassword(email)
              id and the role follow the sign-in and can change while the page is open (backlog G1, G2, H2)
              isHost is the same as isUser until rights are decided per set (backlog H5)
     users    onUsers(f(map|null, err)): everyone who may use this Tally Room, for users only
     sets     onSets(f(map|null, err)), getSets(), setExists(id), createSet(id, meta, {config, session}), setMeta(id, meta),
              patchMeta(id, patch), removeSet(id), moveSet(id, newId)
              creating, removing and moving a set are one write each: the rules decide on a poll by the owner of its set,
              so a set and its poll never exist without each other (backlog H4)
     polls    readPoll(id), writePoll(id, {config, session}), poll(id) -> live access to one set
   Data layout: users/{uid} = who may sign in and in which role, sets/{id} = attributes of a set, polls/{id}/config|session|votes = its questions, state and answers,
   polls/{id}/actions = follow-up actions the presenter records for concerns and objections,
   userSets/{uid}/{id} = the sets that are shared with a user, kept next to sets/{id}/shared so they can be listed. */
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
/* demo people (backlog H2): the page is the admin, or with &role=user the user; Sam owns a public set and one shared with the user */
const DEMO_ADMIN="demo-admin", DEMO_USER="demo-user", DEMO_SAM="demo-sam";
function makeDemoBackend(isHost, role){
  const KEY="tr_demo_db"; let mem=null;
  const load=()=>{ try{ const v=JSON.parse(localStorage.getItem(KEY)||"null"); if(v && v.sets && v.polls) return v; }catch(e){} return mem||{sets:{},polls:{}}; };
  let db=load();
  const save=()=>{ mem=db; try{ localStorage.setItem(KEY, JSON.stringify(db)); }catch(e){} };
  const L={sets:[], users:[], poll:{}}; // listeners
  const pl=id=>(L.poll[id]=L.poll[id]||{meta:[],cfg:[],ses:[],votes:[],mine:[],shown:[],names:[],actions:[]});
  /* a presenter is one of the demo people; a participant (?host=off) keeps the id of this browser */
  const uid = isHost ? (role==="user" ? DEMO_USER : DEMO_ADMIN) : null, myId = uid || demoId();
  const P=id=>(db.polls[id]=db.polls[id]||{});
  const copy=v=>v==null?null:JSON.parse(JSON.stringify(v));
  function emit(id, what){ const l=L.poll[id]; if(!l) return; const p=db.polls[id]||{};
    if(!what||what==="meta") l.meta.forEach(f=>f(copy(db.sets[id])));
    if(!what||what==="cfg") l.cfg.forEach(f=>f(copy(p.config)));
    if(!what||what==="ses") l.ses.forEach(f=>f(copy(p.session)));
    if(!what||what==="votes"){ l.votes.forEach(f=>f(isHost ? (copy(p.votes)||{}) : {})); l.mine.forEach(f=>f(copy((p.votes||{})[myId])||null)); } // as the rules: a participant sees its own record only
    if(!what||what==="shown") l.shown.forEach(f=>f(copy(p.shown)||{}));
    if(!what||what==="names") l.names.forEach(f=>f(copy(p.names)||{}));
    if(!what||what==="actions") l.actions.forEach(f=>f(copy(p.actions)||{})); }
  const emitSets=()=>L.sets.forEach(f=>f(copy(db.sets)||{}));
  const emitAll=()=>{ emitSets(); L.users.forEach(f=>f(copy(db.users)||{})); Object.keys(L.poll).forEach(id=>emit(id)); };
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
  /* once per browser, also for a demo store from before users existed: the demo people, an owner on every set, and Sam's two sets */
  if(!db.users){ const now=Date.now(), u=(name,r)=>({email:name.toLowerCase().replace(/\s+/g,".")+"@demo.example", name, role:r, createdAt:now});
    db.users={[DEMO_ADMIN]:u("Demo admin","admin"), [DEMO_USER]:u("Demo user","user"), [DEMO_SAM]:u("Sam Demo","user")};
    Object.keys(db.sets).forEach(id=>{ if(db.sets[id] && !db.sets[id].owner) db.sets[id]={...db.sets[id], owner:DEMO_ADMIN}; });
    const add=(id,fields,questions)=>{ if(db.sets[id] || db.polls[id]) return; db.sets[id]=C.newMeta({...fields, owner:DEMO_SAM}, now); db.polls[id]={session:{...C.DEFAULT_SESSION}, config:{...C.emptyConfig(), questions}}; };
    add("demo0002", {name:"Public demo set", header:"Team check-in", visibility:"public"}, [C.q("How is your week going?",1,5,"Badly","Very well"), C.qOpen("What do you need from the team?")]);
    add("demo0003", {name:"Shared demo set", header:"Retrospective", shared:{[DEMO_USER]:true}}, [C.q("How did this sprint go?",1,5,"Badly","Very well"), C.q("What should we keep?",1,3,"","",["Planning","Pairing","Demos"])]);
    save(); }
  const me=uid ? C.normUser(db.users[uid]) : null;
  const names=["a","b","c","d","e","f","g","h"];
  function simulate(id){ const p=db.polls[id]; if(!isHost || !p || !p.session || !p.config) return; const ses=p.session, cfg=C.normConfig(p.config); if(!cfg.questions.length) return;
    const put=(n,v)=>{ const pp=P(id); pp.votes=pp.votes||{}; if(C.isNamed((db.sets[id]||{}).named)){ v.name=n+String(names.indexOf(n)+1); v.nameAt=1; pp.names=pp.names||{}; pp.names["demo_"+n]={n:v.name, at:1}; } else delete v.name; pp.votes["demo_"+n]=v; save(); emit(id,"votes"); };
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
  return { id:myId, isHost, canWrite:true, demo:true,
    isConnected:()=>true, onConn:f=>f(true), downFor:()=>0, nudge:()=>{}, now:()=>Date.now(),
    role:me?me.role:null, isUser:!!me, isAdmin:!!me && me.role==="admin",
    onAuth:f=>f({ready:true, uid, role:me?me.role:null, name:me?me.name:"", isUser:!!me, isAdmin:!!me && me.role==="admin", isHost, anon:false, email:me?me.email:"", error:null}), // nothing to sign in to
    signIn:async()=>{}, signOut:async()=>{}, resetPassword:async()=>{},
    onUsers:f=>{ if(!me){ f({}); return; } L.users.push(f); f(copy(db.users)||{}); },
    onSets:f=>{ L.sets.push(f); f(copy(db.sets)||{}); },
    getSets:async()=>copy(db.sets)||{},
    setExists:async id=>!!db.sets[id],
    createSet:async(id,m,p)=>{ if(db.sets[id]) throw new Error("That link is already in use."); db.sets[id]=copy(m); db.polls[id]=copy(p)||{}; save(); emitSets(); emit(id); },
    setMeta:async(id,m)=>{ db.sets[id]=copy(m); save(); emitSets(); emit(id,"meta"); },
    patchMeta:async(id,p)=>{ db.sets[id]={...(db.sets[id]||{}),...copy(p)}; save(); emitSets(); emit(id,"meta"); },
    removeSet:async id=>{ delete db.sets[id]; delete db.polls[id]; save(); emitSets(); emit(id); },
    moveSet:async(id,nid)=>{ if(!db.sets[id]) throw new Error("This set does not exist any more."); if(db.sets[nid]) throw new Error("That link is already in use.");
      db.sets[nid]=db.sets[id]; if(db.polls[id]) db.polls[nid]=db.polls[id]; delete db.sets[id]; delete db.polls[id]; save(); emitSets(); emit(id); emit(nid); },
    readPoll:async id=>copy(db.polls[id])||{},
    writePoll:async(id,p)=>{ db.polls[id]=copy(p)||{}; save(); emit(id); },
    poll:id=>{ const l=pl(id); return { pull:null,
      onMeta:f=>{ l.meta.push(f); f(copy(db.sets[id])); },
      onConfig:f=>{ l.cfg.push(f); f(copy((db.polls[id]||{}).config)); },
      onSession:f=>{ l.ses.push(f); f(copy((db.polls[id]||{}).session)); },
      onVotes:f=>{ l.votes.push(f); f(isHost ? (copy((db.polls[id]||{}).votes)||{}) : {}); },
      onMine:f=>{ l.mine.push(f); f(copy(((db.polls[id]||{}).votes||{})[myId])||null); },
      onShown:f=>{ l.shown.push(f); f(copy((db.polls[id]||{}).shown)||{}); },
      onNames:f=>{ l.names.push(f); f(copy((db.polls[id]||{}).names)||{}); },
      setShown:async v=>{ P(id).shown=copy(v)||{}; save(); emit(id,"shown"); },
      setName:async(pid,x)=>{ const p=P(id); p.names=p.names||{}; p.names[pid]=copy(x); save(); emit(id,"names"); },
      setConfig:async c=>{ P(id).config=copy(c); save(); emit(id,"cfg"); },
      setSession:async s=>{ P(id).session=copy(s); save(); emit(id,"ses"); simulate(id); },
      setVotes:async(pid,v)=>{ const p=P(id); p.votes=p.votes||{}; p.votes[pid]=copy(v); save(); emit(id,"votes"); },
      setAllVotes:async v=>{ P(id).votes=copy(v)||{}; save(); emit(id,"votes"); },
      clearVotes:async()=>{ const p=P(id); p.votes={}; p.shown={}; p.names={}; save(); emit(id); },
      dropNames:async()=>{ const p=P(id); p.shown={}; p.names={}; save(); emit(id); },
      onActions:f=>{ l.actions.push(f); f(copy((db.polls[id]||{}).actions)||{}); },
      setAction:async(key,a)=>{ const p=P(id); p.actions=p.actions||{}; p.actions[key]=copy(a); save(); emit(id,"actions"); },
      clearActions:async()=>{ P(id).actions={}; save(); emit(id,"actions"); } }; } };
}

/* ---- Firebase Realtime Database backend ----
   Who you are comes from Firebase Authentication (backlog G1, G2):
     user         signed in with email and password, and with a record users/{uid} that holds the role: admin or user (backlog H2).
                  An account without that record has no rights
     participant  signed in anonymously, without any screen; the uid is the device id and the key of its vote record
   The database rules (database.rules.json) decide what each of them may read and write.
   opts.anon: sign in anonymously when nobody is signed in (a set page); opts.signOut: ?host=off
   opts.appCheckKey: the Fraud Defense (reCAPTCHA Enterprise) site key for App Check (backlog G6); without it the page runs without App Check */
/* App Check proves to Firebase that a request comes from this page. It has to be switched on before the database and
   the sign-in are used; they then send its token by themselves. On localhost a debug token stands in for reCAPTCHA:
   the Firebase script prints it in the console once, and it is registered in the Firebase console (tallyroom-setup.md). */
function startAppCheck(key){ if(!key || !root.firebase.appCheck) return null;
  try{ const h=(root.location && root.location.hostname)||""; if(h==="localhost" || h==="127.0.0.1" || h==="[::1]") root.FIREBASE_APPCHECK_DEBUG_TOKEN=true;
    /* Fraud Defense (reCAPTCHA Enterprise): Firebase no longer takes classic reCAPTCHA v3 keys for App Check */
    const P=root.firebase.appCheck.ReCaptchaEnterpriseProvider; if(!P){ console.warn("App Check: this Firebase script has no Fraud Defense provider"); return null; }
    const ac=root.firebase.appCheck(); ac.activate(new P(key), true); return ac; }
  catch(e){ console.warn("App Check could not be started", e); return null; } }
function makeFirebaseBackend(config, opts){
  root.firebase.initializeApp(config);
  const appCheck=startAppCheck(opts.appCheckKey);
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
    let headers; if(appCheck){ try{ const t=await appCheck.getToken(); if(t && t.token) headers={"X-Firebase-AppCheck":t.token}; }catch(e){} } // the socket sends it by itself, a plain read does not
    const r=await fetch(BASE+"/"+path+".json?auth="+encodeURIComponent(tok)+"&_="+Date.now(), headers ? {cache:"no-store", headers} : {cache:"no-store"}); if(!r.ok) throw new Error("rest "+r.status); return (await r.json())||{}; };

  /* ---- sign-in state ---- */
  const NOBODY={role:null, name:"", isUser:false, isAdmin:false, isHost:false};
  const st={ready:false, uid:null, ...NOBODY, anon:false, email:"", error:null}, authFns=[];
  let wantOut=!!opts.signOut, seq=0;
  /* live listeners are attached again whenever the identity changes: the server drops the ones the new identity may not
     keep, and a presenter-only path (the list of sets, the actions) is only listened to by a presenter */
  const subs=[];
  function attach(sub){ detach(sub); const other=(sub.hostOnly && !st.isHost) || (sub.partOnly && st.isHost);
    if(!st.uid || other){ if(other && st.ready) sub.empty(); return; }
    const ref=db.ref(typeof sub.path==="function" ? sub.path(st.uid) : sub.path), uid=st.uid, cb=ref.on("value", s=>sub.f(s.val()), e=>{ if(sub.live && sub.live.cb===cb){ sub.live=null; if(sub.err && st.uid===uid) sub.err(e); } });
    sub.live={ref, cb}; }
  function detach(sub){ if(sub.live){ const l=sub.live; sub.live=null; try{ l.ref.off("value", l.cb); }catch(e){} } }
  /* path: a string, or a function of the uid (a participant's own record); hostOnly / partOnly: only for a presenter / a participant,
     the other gets empty() instead */
  function listen(path, f, err, hostOnly, empty, partOnly){ const sub={path, f, err, hostOnly:!!hostOnly, partOnly:!!partOnly, empty:empty||(()=>{}), live:null}; subs.push(sub); if(st.ready) attach(sub); }
  function publish(next){ const changed = !st.ready || next.uid!==st.uid || next.isHost!==st.isHost || next.role!==st.role;
    Object.assign(st, next, {ready:true}); if(changed) subs.forEach(attach); authFns.forEach(f=>f({...st})); }
  /* the record of the signed-in account is followed live: a role that is given, changed or taken away works at once */
  let userSub=null;
  function dropUser(){ if(userSub){ const u=userSub; userSub=null; try{ u.ref.off("value", u.cb); }catch(e){} } }
  async function resolve(user){ const my=++seq; dropUser();
    if(user && !user.isAnonymous && wantOut){ wantOut=false; try{ await auth.signOut(); }catch(e){} return; } // ?host=off
    wantOut=false;
    if(!user){
      if(!opts.anon){ publish({uid:null, ...NOBODY, anon:false, email:"", error:null}); return; }
      try{ await auth.signInAnonymously(); }catch(e){ console.warn("anonymous sign-in failed", e); if(my===seq) publish({uid:null, ...NOBODY, anon:false, email:"", error:"anon"}); }
      return; } // the sign-in itself brings the next state
    if(user.isAnonymous){ publish({uid:user.uid, ...NOBODY, anon:true, email:"", error:null}); return; }
    const is=rec=>{ if(my!==seq) return; const u=C.normUser(rec);
      publish({uid:user.uid, role:u?u.role:null, name:u?u.name:"", isUser:!!u, isAdmin:!!u && u.role==="admin", isHost:!!u, anon:false, email:user.email||"", error:null}); };
    const ref=db.ref("users/"+user.uid), cb=ref.on("value", s=>is(s.val()), e=>{ console.warn("user check failed", e); is(null); });
    userSub={ref, cb}; }
  auth.onAuthStateChanged(resolve, e=>{ console.warn("auth", e); publish({uid:null, ...NOBODY, anon:false, email:"", error:"anon"}); });

  const denied=e=>!!e && /permission.denied/i.test(String(e.code||"")+" "+String(e.message||""));
  return { get id(){ return st.uid; }, get role(){ return st.role; }, get isUser(){ return st.isUser; }, get isAdmin(){ return st.isAdmin; }, get isHost(){ return st.isHost; }, canWrite:true, demo:false,
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
    onUsers:f=>listen("users", v=>f(v||{}), e=>f(null,e), true, ()=>f({})),
    onSets:f=>listen("sets", v=>f(v||{}), e=>f(null,e), true),
    getSets:async()=>(await db.ref("sets").once("value")).val()||{},
    /* one set record can be read by every signed-in device; the list as a whole only by an admin */
    setExists:async id=>(await db.ref("sets/"+id).once("value")).val()!=null,
    createSet:(id,m,p)=>db.ref().update({["sets/"+id]:m, ["polls/"+id]:(p && p.config) ? {...p, config:C.withQids(p.config)} : (p||null)}),
    setMeta:(id,m)=>db.ref("sets/"+id).set(m),
    patchMeta:(id,p)=>db.ref("sets/"+id).update(p),
    /* the set, its poll and its entries in the share index go in one write */
    removeSet:async id=>{ const meta=(await db.ref("sets/"+id).once("value")).val(), up={["sets/"+id]:null, ["polls/"+id]:null};
      C.sharedWith(meta).forEach(u=>{ up["userSets/"+u+"/"+id]=null; }); return db.ref().update(up); },
    /* the set under another id: everything is copied and the old id removed in one write, so it is never half moved */
    moveSet:async(id,nid)=>{ const val=async p=>(await db.ref(p).once("value")).val();
      const [meta,poll,m2]=await Promise.all([val("sets/"+id), val("polls/"+id), val("sets/"+nid)]);
      if(!meta) throw new Error("This set does not exist any more."); if(m2) throw new Error("That link is already in use.");
      const up={["sets/"+nid]:meta, ["polls/"+nid]:poll, ["sets/"+id]:null, ["polls/"+id]:null};
      C.sharedWith(meta).forEach(u=>{ up["userSets/"+u+"/"+nid]=true; up["userSets/"+u+"/"+id]=null; });
      try{ await db.ref().update(up); }
      catch(e){ if(denied(e)) throw new Error("This set holds answers in an old format. Clear the answers or export them first"); throw e; } },
    readPoll:async id=>{ try{ return await rest("polls/"+id); }catch(e){ return (await db.ref("polls/"+id).once("value")).val()||{}; } },
    /* the config carries the ids of its questions (qids), which the database rules check every answer against */
    writePoll:(id,p)=>db.ref("polls/"+id).set(p && p.config ? {...p, config:C.withQids(p.config)} : p),
    poll:id=>{ const node=db.ref("polls/"+id), P="polls/"+id; return {
      /* only a presenter may read polls/{id} as a whole; a participant reads the parts it is allowed to:
         its own record, what the room is shown and the names in use (backlog G8) */
      pull:async()=>{ if(st.isHost) return rest(P); const uid=st.uid;
        const [config,session,shown,names,mine]=await Promise.all([rest(P+"/config"), rest(P+"/session"), rest(P+"/shown"), rest(P+"/names"), rest(P+"/votes/"+uid)]);
        return {config, session, shown, names, mine:(mine && Object.keys(mine).length) ? mine : null}; },
      onMeta:f=>listen("sets/"+id, f, e=>f(null,e)),
      onConfig:f=>listen(P+"/config", f),
      onSession:f=>listen(P+"/session", f),
      /* a presenter gets every answer; a participant its own record, what the room is shown, and the names in use */
      onVotes:f=>listen(P+"/votes", v=>f(v||{}), null, true, ()=>f({})),
      onMine:f=>listen(uid=>P+"/votes/"+uid, v=>f(v||null), null, false, ()=>f(null), true),
      onShown:f=>listen(P+"/shown", v=>f(v||{}), null, false, ()=>f({}), true),
      onNames:f=>listen(P+"/names", v=>f(v||{}), null, false, ()=>f({}), true),
      setShown:v=>node.child("shown").set(v||null),
      setName:(pid,x)=>node.child("names/"+pid).set(x),
      setConfig:c=>node.child("config").set(C.withQids(c)),
      setSession:s=>node.child("session").set(s),
      /* the rules refuse a time stamp that is ahead of the server, so a phone with a fast clock is held back to the server's */
      setVotes:(pid,v)=>node.child("votes/"+pid).set(v && Number.isFinite(v.t) && v.t>now()+30000 ? {...v, t:Math.round(now())} : v),
      setAllVotes:v=>node.child("votes").set(v||{}),
      clearVotes:()=>node.update({votes:null, shown:null, names:null}),
      dropNames:()=>node.update({shown:null, names:null}),
      onActions:f=>listen(P+"/actions", v=>f(v||{}), null, true, ()=>f({})),
      setAction:(key,a)=>node.child("actions/"+key).set(a),
      clearActions:()=>node.child("actions").remove() }; } };
}

/* opts: {firebaseConfig, params, anon, appCheckKey}. Demo when ?demo is in the address or Firebase is not configured. */
function make(opts){ const fc=opts.firebaseConfig||{}, params=opts.params;
  const demo = params.has("demo") || !(root.firebase && root.firebase.auth && fc.apiKey && fc.databaseURL);
  if(demo){ if(!params.has("demo")) console.warn("Firebase not configured: running in single-browser demo mode.");
    return makeDemoBackend(params.get("host")!=="off", params.get("role")==="user" ? "user" : "admin"); } // demo: presenter unless asked otherwise, admin unless &role=user
  return makeFirebaseBackend(fc, {anon:!!opts.anon, signOut:params.get("host")==="off", appCheckKey:String(opts.appCheckKey||"").trim()});
}
root.TRBackend={ make };
if(typeof module!=="undefined" && module.exports) module.exports=root.TRBackend;
})(typeof window!=="undefined" ? window : globalThis);
