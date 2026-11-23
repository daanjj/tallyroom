/* Tally Room backends: where the data lives.
   Both backends offer the same interface:
     global   id, role, isUser, isAdmin, isHost, canWrite, demo, isConnected(), onConn(f), downFor(), nudge(), now()
     sign-in  onAuth(f(state)), signIn(email, password), signOut(), resetPassword(email)
              passwords (backlog H8): resetPassword sends the mail with a link, which is also the invitation of a new user;
              checkResetCode(code) -> the email address the link is for, setPassword(code, password), changePassword(current, next)
              addUser({name, email, role}), for an admin -> {uid, mailed}: an account with a random password that nobody sees,
              its users record, and the mail. The account is made through a second connection, so the admin stays signed in.
              The demo store sends no mail: resetPassword and addUser give {code}, the last part of the link the mail would hold
              addUser(fields, {mail:false}) sends no mail. Its answer also holds {key}: the random password, for the invitation
              link the admin copies and sends themself (core.inviteLink). It is in memory only, and only at that moment.
              openInvite(email, key) -> the address, when the link still works; finishInvite(password) sets the chosen password.
              Both run on a second connection, so nobody is signed in on this page before a password is chosen
              id and the role follow the sign-in and can change while the page is open (backlog G1, G2, H2)
              isHost is the same as isUser: someone who may have sets. Who is presenter of a set is decided per set, see poll(id)
     users    onUsers(f(map|null, err)): everyone who may use this Tally Room, for users only
              for an admin (backlog H7): setUser(uid, {name, role}), removeUser(uid): the record goes and the user leaves every shared
              list, in one write; refused while the user still owns sets. An admin cannot remove or demote themself
     sets     onSets(f(map|null, err)): the sets this user may see (own, shared with them, public; an admin all of them), getSets(), setExists(id), createSet(id, meta, {config, session}), setMeta(id, meta),
              patchMeta(id, patch), removeSet(id), moveSet(id, newId), shareSet(id, uid, on)
              shareSet gives a user access to a set or takes it away (backlog H6): the shared list of the set and the index
              userSets go in one write. A shared user takes itself off with shareSet(id, own uid, false) (Leave)
              assignSet(id, uid), for an admin (backlog H7): another owner, who leaves the shared list; the previous owner keeps nothing
              creating, removing and moving a set are one write each: the rules decide on a poll by the owner of its set,
              so a set and its poll never exist without each other (backlog H4)
     polls    readPoll(id), readConfig(id), writePoll(id, {config, session}), poll(id) -> live access to one set
              poll(id).onRight(f(manages)): whether this device is presenter of that set (owner, shared with, or admin; backlog H5).
              Answers and actions are only listened to by who manages the set
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
  const pl=id=>(L.poll[id]=L.poll[id]||{meta:[],right:[],cfg:[],ses:[],votes:[],mine:[],shown:[],names:[],actions:[]});
  /* a presenter is one of the demo people; a participant (?host=off) keeps the id of this browser */
  const uid = isHost ? (role==="user" ? DEMO_USER : DEMO_ADMIN) : null, myId = uid || demoId();
  const P=id=>(db.polls[id]=db.polls[id]||{});
  const copy=v=>v==null?null:JSON.parse(JSON.stringify(v));
  function emit(id, what){ const l=L.poll[id]; if(!l) return; const p=db.polls[id]||{};
    if(!what||what==="meta"){ l.right.forEach(f=>f(manages(id))); l.meta.forEach(f=>f(copy(db.sets[id]))); }
    if(!what||what==="cfg") l.cfg.forEach(f=>f(copy(p.config)));
    if(!what||what==="ses") l.ses.forEach(f=>f(copy(p.session)));
    if(!what||what==="votes"){ l.votes.forEach(f=>f(manages(id) ? (copy(p.votes)||{}) : {})); l.mine.forEach(f=>f(copy((p.votes||{})[myId])||null)); } // as the rules: a participant sees its own record only
    if(!what||what==="shown") l.shown.forEach(f=>f(copy(p.shown)||{}));
    if(!what||what==="names") l.names.forEach(f=>f(copy(p.names)||{}));
    if(!what||what==="actions") l.actions.forEach(f=>f(manages(id) ? (copy(p.actions)||{}) : {})); }
  /* the same rights as the database rules give: the sets this user may see, and whether it is presenter of a set */
  const who=()=>({uid, role:me?me.role:null});
  const manages=id=>C.canManage(db.sets[id], who());
  const mySets=()=>{ const out={}; Object.keys(db.sets||{}).forEach(id=>{ if(C.canView(db.sets[id], who())) out[id]=copy(db.sets[id]); }); return out; };
  const emitSets=()=>L.sets.forEach(f=>f(mySets()));
  const emitAll=()=>{ refreshMe(); emitSets(); L.users.forEach(f=>f(copy(db.users)||{})); Object.keys(L.poll).forEach(id=>emit(id)); };
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
  /* the record of the demo person is followed like a real one: changed or removed (in this tab or another), the page follows */
  let me=uid ? C.normUser(db.users[uid]) : null, lastEmail=me?me.email:""; const authFns=[];
  const hostNow=()=>isHost && (!uid || !!me);
  const authState=()=>({ready:true, uid, role:me?me.role:null, name:me?me.name:"", isUser:!!me, isAdmin:!!me && me.role==="admin", isHost:hostNow(), anon:false, email:me?me.email:lastEmail, error:null});
  function refreshMe(){ if(!uid) return; const next=C.normUser((db.users||{})[uid]), same=JSON.stringify(next)===JSON.stringify(me); me=next; if(me) lastEmail=me.email;
    if(!same) authFns.forEach(f=>f(authState())); }
  const demoCode=u=>{ const code="demo"+Math.random().toString(36).slice(2,12); db.codes=db.codes||{}; db.codes[code]={uid:u, used:false}; save(); return code; };
  const adminOnly=()=>{ if(!me || me.role!=="admin") throw new Error("Only an admin can do this."); };
  const emitUsers=()=>{ refreshMe(); L.users.forEach(f=>f(copy(db.users)||{})); };
  const names=["a","b","c","d","e","f","g","h"];
  function simulate(id){ const p=db.polls[id]; if(!manages(id) || !p || !p.session || !p.config) return; const ses=p.session, cfg=C.normConfig(p.config); if(!cfg.questions.length) return;
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
  return { id:myId, get isHost(){ return hostNow(); }, canWrite:true, demo:true,
    isConnected:()=>true, onConn:f=>f(true), downFor:()=>0, nudge:()=>{}, now:()=>Date.now(),
    get role(){ return me?me.role:null; }, get isUser(){ return !!me; }, get isAdmin(){ return !!me && me.role==="admin"; },
    onAuth:f=>{ authFns.push(f); f(authState()); }, // nothing to sign in to
    signIn:async()=>{}, signOut:async()=>{},
    /* no mail in the demo: the code of the link is handed back, and passwords are kept in the store (the first one is "demo") */
    resetPassword:async email=>{ const u=Object.keys(db.users||{}).find(k=>String((db.users[k]||{}).email||"").toLowerCase()===String(email||"").trim().toLowerCase()); return u ? {code:demoCode(u)} : {}; },
    checkResetCode:async code=>{ const c=(db.codes||{})[code], u=c && C.normUser((db.users||{})[c.uid]); if(!u || c.used) throw Object.assign(new Error("This link is no longer valid"), {code:"auth/invalid-action-code"}); return u.email; },
    setPassword:async(code,pw)=>{ const c=(db.codes||{})[code]; if(!c || c.used || !C.normUser((db.users||{})[c.uid])) throw Object.assign(new Error("This link is no longer valid"), {code:"auth/invalid-action-code"});
      c.used=true; db.pw=db.pw||{}; db.pw[c.uid]=String(pw); save(); },
    changePassword:async(cur,next)=>{ if(!me) throw new Error("Not signed in"); if(String(cur)!==((db.pw||{})[uid]||"demo")) throw Object.assign(new Error("wrong password"), {code:"auth/wrong-password"});
      db.pw=db.pw||{}; db.pw[uid]=String(next); save(); },
    addUser:async(fields)=>{ adminOnly(); const r=C.newUser(fields, db.users, Date.now()); if(r.problem) throw new Error(r.problem);
      const nu="demo-"+Math.random().toString(36).slice(2,10); db.users[nu]=r.user; const code=demoCode(nu); emitUsers(); return {uid:nu, mailed:false, code}; },
    onUsers:f=>{ if(!me){ f({}); return; } L.users.push(f); f(copy(db.users)||{}); },
    onSets:f=>{ L.sets.push(f); f(mySets()); },
    getSets:async()=>copy(db.sets)||{},
    setExists:async id=>!!db.sets[id],
    createSet:async(id,m,p)=>{ if(db.sets[id]) throw new Error("That link is already in use."); db.sets[id]=copy(m); db.polls[id]=copy(p)||{}; save(); emitSets(); emit(id); },
    setMeta:async(id,m)=>{ db.sets[id]=copy(m); save(); emitSets(); emit(id,"meta"); },
    patchMeta:async(id,p)=>{ db.sets[id]={...(db.sets[id]||{}),...copy(p)}; save(); emitSets(); emit(id,"meta"); },
    removeSet:async id=>{ delete db.sets[id]; delete db.polls[id]; save(); emitSets(); emit(id); },
    moveSet:async(id,nid)=>{ if(!db.sets[id]) throw new Error("This set does not exist any more."); if(db.sets[nid]) throw new Error("That link is already in use.");
      db.sets[nid]=db.sets[id]; if(db.polls[id]) db.polls[nid]=db.polls[id]; delete db.sets[id]; delete db.polls[id]; save(); emitSets(); emit(id); emit(nid); },
    /* as the rules: who controls the set shares it, with users only; a shared user takes only itself off */
    shareSet:async(id,u,on)=>{ const m=db.sets[id]; if(!m) throw new Error("This set does not exist any more.");
      if(!(C.canControl(m, who()) || (!on && u===uid && C.canManage(m, who())))) throw new Error("You cannot change who this set is shared with.");
      if(on && !C.normUser((db.users||{})[u])) throw new Error("That user does not exist any more.");
      db.sets[id]={...m, shared:C.withShare(m,u,!!on).shared}; save(); emitSets(); emit(id,"meta"); },
    assignSet:async(id,u)=>{ const m=db.sets[id]; if(!m) throw new Error("This set does not exist any more.");
      if(!C.canAssign(m, who())) throw new Error("Only an admin can assign a set."); if(!C.normUser((db.users||{})[u])) throw new Error("That user does not exist any more.");
      const n=C.withOwner(m,u); db.sets[id]={...m, owner:n.owner, shared:n.shared}; save(); emitSets(); emit(id,"meta"); },
    setUser:async(u,patch)=>{ adminOnly(); if(!C.normUser((db.users||{})[u])) throw new Error("That user does not exist any more.");
      const p=C.userPatch(patch), no=C.selfChangeProblem(uid,u,p); if(no) throw new Error(no);
      db.users[u]={...db.users[u], ...p}; save(); emitUsers(); },
    removeUser:async u=>{ adminOnly(); const no=C.selfChangeProblem(uid,u,"remove"); if(no) throw new Error(no);
      const rec=C.normUser((db.users||{})[u]), r=C.userRemoval(u, db.sets, null); if(r.owned.length) throw new Error(C.ownsMessage(rec?rec.name:"This user", r.owned.length));
      delete db.users[u]; Object.keys(db.sets).forEach(id=>{ const m=db.sets[id]; if(m && m.shared && m.shared[u]){ const shared={...m.shared}; delete shared[u]; db.sets[id]={...m, shared}; } });
      save(); emitUsers(); emitSets(); Object.keys(L.poll).forEach(id=>emit(id,"meta")); },
    readPoll:async id=>copy(db.polls[id])||{},
    readConfig:async id=>copy((db.polls[id]||{}).config)||{},
    writePoll:async(id,p)=>{ db.polls[id]=copy(p)||{}; save(); emit(id); },
    poll:id=>{ const l=pl(id); return { pull:null,
      onRight:f=>{ l.right.push(f); f(manages(id)); },
      onMeta:f=>{ l.meta.push(f); f(copy(db.sets[id])); },
      onConfig:f=>{ l.cfg.push(f); f(copy((db.polls[id]||{}).config)); },
      onSession:f=>{ l.ses.push(f); f(copy((db.polls[id]||{}).session)); },
      onVotes:f=>{ l.votes.push(f); f(manages(id) ? (copy((db.polls[id]||{}).votes)||{}) : {}); },
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
      onActions:f=>{ l.actions.push(f); f(manages(id) ? (copy((db.polls[id]||{}).actions)||{}) : {}); },
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
     keep, and a presenter-only path (the answers, the actions) is only listened to by who is presenter of that set.
     polls[id] = {meta, known, manage, fns}: what this device is in that set; known = its set record has arrived */
  const subs=[], polls={};
  const who=()=>({uid:st.uid, role:st.role});
  function attach(sub){ detach(sub); const ps=sub.poll ? polls[sub.poll] : null, role=sub.hostOnly || sub.partOnly;
    if(ps && role && !ps.known) return; // not yet known whether this device presents the set
    const host=ps ? ps.manage : st.isHost, other=(sub.hostOnly && !host) || (sub.partOnly && host);
    if(!st.uid || other){ if(other && st.ready) sub.empty(); return; }
    const ref=db.ref(typeof sub.path==="function" ? sub.path(st.uid) : sub.path), uid=st.uid, cb=ref.on("value", s=>sub.f(s.val()), e=>{ if(sub.live && sub.live.cb===cb){ sub.live=null; if(sub.err && st.uid===uid) sub.err(e); } });
    sub.live={ref, cb}; }
  function detach(sub){ if(sub.live){ const l=sub.live; sub.live=null; try{ l.ref.off("value", l.cb); }catch(e){} } }
  /* path: a string, or a function of the uid (a participant's own record); hostOnly / partOnly: only for a presenter / a participant,
     the other gets empty() instead */
  function listen(path, f, err, hostOnly, empty, partOnly, poll){ const sub={path, f, err, hostOnly:!!hostOnly, partOnly:!!partOnly, empty:empty||(()=>{}), live:null, poll:poll||null}; subs.push(sub); if(st.ready) attach(sub); return sub; }
  /* whether this device presents set id, from its record and the sign-in; the listeners that depend on it follow */
  function setRight(id, quiet){ const ps=polls[id], m=ps.known && C.canManage(ps.meta, who()), was=ps.manage, first=!ps.told && ps.known; ps.manage=m;
    if(m===was && !first) return; ps.told=ps.told||ps.known;
    if(!quiet) subs.forEach(sub=>{ if(sub.poll===id && (sub.hostOnly || sub.partOnly)) attach(sub); });
    ps.fns.forEach(f=>f(m)); }
  function publish(next){ const changed = !st.ready || next.uid!==st.uid || next.isHost!==st.isHost || next.role!==st.role;
    Object.assign(st, next, {ready:true});
    if(changed){ Object.keys(polls).forEach(id=>setRight(id, true)); subs.forEach(attach); startFeed(); }
    authFns.forEach(f=>f({...st})); }

  /* ---- the sets this user may see (backlog H5). The rules do not let a user read the list of all sets, so it is put together
     from three sources: the sets it owns and the public sets (two queries), and the sets shared with it, which are listed
     in userSets/{uid} and read one by one. An admin reads the whole list. Started again whenever the identity changes ---- */
  const setsFns=[]; let feed=null;
  function startFeed(){ if(feed){ feed(); feed=null; } if(!setsFns.length || !st.ready || !st.isUser) return;
    const uid=st.uid, me=who(), offs=[], per={}, got={all:null, own:null, pub:null, idx:null, shared:{}}; let dead=false, failed=false;
    feed=()=>{ dead=true; offs.forEach(f=>f()); Object.values(per).forEach(f=>f()); };
    const fail=e=>{ if(dead || failed) return; failed=true; setsFns.forEach(f=>f(null, e)); };
    const on=(ref, f, err)=>{ const cb=ref.on("value", s=>{ if(!dead) f(s.val()); }, e=>{ if(!dead) (err||fail)(e); }); return ()=>{ try{ ref.off("value", cb); }catch(e){} }; };
    const out=()=>{ if(dead || failed) return;
      if(me.role==="admin"){ if(got.all) setsFns.forEach(f=>f(got.all)); return; }
      if(!got.own || !got.pub || !got.idx || Object.keys(got.idx).some(id=>got.shared[id]===undefined)) return; // wait until every source has answered
      const shared={}; Object.keys(got.idx).forEach(id=>{ const m=got.shared[id]; if(m && C.canManage(m, me)) shared[id]=m; }); // an entry whose set is gone, or no longer shared, is skipped
      const all={...got.pub, ...shared, ...got.own}; setsFns.forEach(f=>f(all)); };
    if(me.role==="admin"){ offs.push(on(db.ref("sets"), v=>{ got.all=v||{}; out(); })); return; }
    offs.push(on(db.ref("sets").orderByChild("owner").equalTo(uid), v=>{ got.own=v||{}; out(); }));
    offs.push(on(db.ref("sets").orderByChild("visibility").equalTo("public"), v=>{ got.pub=v||{}; out(); }));
    offs.push(on(db.ref("userSets/"+uid), v=>{ const idx={}; Object.keys(v||{}).forEach(id=>{ if(v[id]===true) idx[id]=true; }); got.idx=idx;
      Object.keys(per).forEach(id=>{ if(!idx[id]){ per[id](); delete per[id]; delete got.shared[id]; } });
      Object.keys(idx).forEach(id=>{ if(!per[id]) per[id]=on(db.ref("sets/"+id), m=>{ got.shared[id]=m||null; out(); }, ()=>{ got.shared[id]=null; out(); }); });
      out(); })); }
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

  /* the mail with the link to choose a password: an invitation, or Forgot password. It carries the address of the sign-in
     screen, so Firebase's own page (where the link lands when the mail template has no action URL of this page) ends with a
     Continue button back to here. A domain Firebase does not accept for that is left out rather than losing the mail */
  const signInUrl=()=>{ try{ const l=root.location; return l && /^https?:$/.test(l.protocol) ? l.origin+l.pathname+"?host=1" : ""; }catch(e){ return ""; } };
  const sendPwMail=async email=>{ const url=signInUrl(); if(!url) return auth.sendPasswordResetEmail(email);
    try{ return await auth.sendPasswordResetEmail(email, {url}); }
    catch(e){ if(/continue-uri|unauthorized-domain/.test(String((e&&e.code)||""))){ console.warn("password mail without continue address", e.code); return auth.sendPasswordResetEmail(email); } throw e; } };
  /* a second connection to Firebase, with its own sign-in that is not kept on this device and never touches the one of the page */
  const second=async()=>{ const app2=root.firebase.initializeApp(config, "invite-"+Date.now()+"-"+Math.random().toString(36).slice(2,8));
    if(opts.appCheckKey && root.firebase.appCheck){ try{ const P=root.firebase.appCheck.ReCaptchaEnterpriseProvider; if(P) root.firebase.appCheck(app2).activate(new P(opts.appCheckKey), true); }catch(e){ console.warn("App Check for the second connection", e); } }
    const a2=app2.auth(); try{ await a2.setPersistence(root.firebase.auth.Auth.Persistence.NONE); }catch(e){}
    return {auth:a2, close:async()=>{ try{ await a2.signOut(); }catch(e){} try{ await app2.delete(); }catch(e){} }}; };
  let invite=null; const dropInvite=async()=>{ if(invite){ const i=invite; invite=null; await i.s.close(); } };
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
    resetPassword:email=>sendPwMail(email),
    /* the link in the password mail carries a code: who it is for, and choosing the password with it */
    checkResetCode:code=>auth.verifyPasswordResetCode(code),
    setPassword:(code,pw)=>auth.confirmPasswordReset(code,pw),
    /* Firebase wants a recent sign-in before a password changes, so the current password is checked first */
    changePassword:async(cur,next)=>{ const u=auth.currentUser; if(!u || u.isAnonymous || !u.email) throw new Error("Not signed in");
      await u.reauthenticateWithCredential(root.firebase.auth.EmailAuthProvider.credential(u.email, cur)); await u.updatePassword(next); },
    /* a new user (admin only; the rules check the record). The account is made through a second connection to Firebase, which
       signs in as the new account and is thrown away, so this page stays signed in as the admin. Its password is random and
       never shown, stored or sent: the mail holds a link to choose one (open decision 26) */
    addUser:async(fields, o)=>{ const r=C.newUser(fields, null, Math.round(now())); if(r.problem) throw new Error(r.problem);
      const rnd=()=>{ const a=new Uint32Array(1); root.crypto.getRandomValues(a); return a[0]/4294967296; };
      const s=await second(), key=C.randomPassword(rnd); let nu=null;
      try{ nu=(await s.auth.createUserWithEmailAndPassword(r.user.email, key)).user.uid; } finally{ await s.close(); }
      await db.ref("users/"+nu).set(r.user);
      let mailed=false; if(!(o && o.mail===false)){ try{ await sendPwMail(r.user.email); mailed=true; }catch(e){ console.warn("invitation mail", e&&e.code); } }
      return {uid:nu, mailed, key}; },
    /* the invitation link (core.inviteLink): signed in with it on a second connection, only to set the chosen password */
    openInvite:async(email,key)=>{ await dropInvite(); const s=await second();
      try{ const u=(await s.auth.signInWithEmailAndPassword(email, key)).user; invite={s, user:u}; return u.email||email; }catch(e){ await s.close(); throw e; } },
    finishInvite:async pw=>{ if(!invite) throw Object.assign(new Error("This link is no longer valid"), {code:"auth/invalid-credential"}); await invite.user.updatePassword(pw); await dropInvite(); },
    onUsers:f=>listen("users", v=>f(v||{}), e=>f(null,e), true, ()=>f({})),
    onSets:f=>{ setsFns.push(f); if(st.ready) startFeed(); },
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
    /* the shared list of the set and the index that lists it for that user, in one write */
    shareSet:(id,u,on)=>db.ref().update({["sets/"+id+"/shared/"+u]:on?true:null, ["userSets/"+u+"/"+id]:on?true:null}),
    /* another owner (admin only, the rules check it); a new owner who was on the shared list is taken off it */
    assignSet:(id,u)=>db.ref().update({["sets/"+id+"/owner"]:u, ["sets/"+id+"/shared/"+u]:null, ["userSets/"+u+"/"+id]:null}),
    setUser:async(u,patch)=>{ const p=C.userPatch(patch), no=C.selfChangeProblem(st.uid,u,p); if(no) throw new Error(no); if(!Object.keys(p).length) return; return db.ref("users/"+u).update(p); },
    /* the record and every entry on a shared list go in one write; the account itself stays in Firebase Authentication */
    removeUser:async u=>{ const no=C.selfChangeProblem(st.uid,u,"remove"); if(no) throw new Error(no);
      const val=async p=>(await db.ref(p).once("value")).val(), [sets,index,rec]=await Promise.all([val("sets"), val("userSets/"+u), val("users/"+u)]);
      const r=C.userRemoval(u, sets, index), nu=C.normUser(rec); if(r.owned.length) throw new Error(C.ownsMessage(nu?nu.name:"This user", r.owned.length));
      return db.ref().update(r.update); },
    readPoll:async id=>{ try{ return await rest("polls/"+id); }catch(e){ return (await db.ref("polls/"+id).once("value")).val()||{}; } },
    /* the questions only: what a user may read of a public set that is not theirs */
    readConfig:async id=>{ try{ return await rest("polls/"+id+"/config"); }catch(e){ return (await db.ref("polls/"+id+"/config").once("value")).val()||{}; } },
    /* the config carries the ids of its questions (qids), which the database rules check every answer against */
    writePoll:(id,p)=>db.ref("polls/"+id).set(p && p.config ? {...p, config:C.withQids(p.config)} : p),
    poll:id=>{ const node=db.ref("polls/"+id), P="polls/"+id;
      /* the set record says who owns the set and who it is shared with; it is followed here, before anything else of the set */
      if(!polls[id]){ const ps=polls[id]={meta:null, known:false, manage:false, told:false, fns:[]}, got=m=>{ ps.meta=m||null; ps.known=true; setRight(id); };
        listen("sets/"+id, got, ()=>got(null)); }
      const ps=polls[id];
      return {
      onRight:f=>{ ps.fns.push(f); if(ps.told) f(ps.manage); },
      /* only who manages the set may read polls/{id} as a whole; a participant reads the parts it is allowed to:
         its own record, what the room is shown and the names in use (backlog G8) */
      pull:async()=>{ if(ps.manage) return rest(P); const uid=st.uid;
        const [config,session,shown,names,mine]=await Promise.all([rest(P+"/config"), rest(P+"/session"), rest(P+"/shown"), rest(P+"/names"), rest(P+"/votes/"+uid)]);
        return {config, session, shown, names, mine:(mine && Object.keys(mine).length) ? mine : null}; },
      onMeta:f=>listen("sets/"+id, f, e=>f(null,e)),
      onConfig:f=>listen(P+"/config", f),
      onSession:f=>listen(P+"/session", f),
      /* a presenter gets every answer; a participant its own record, what the room is shown, and the names in use */
      onVotes:f=>listen(P+"/votes", v=>f(v||{}), null, true, ()=>f({}), false, id),
      onMine:f=>listen(uid=>P+"/votes/"+uid, v=>f(v||null), null, false, ()=>f(null), true, id),
      onShown:f=>listen(P+"/shown", v=>f(v||{}), null, false, ()=>f({}), true, id),
      onNames:f=>listen(P+"/names", v=>f(v||{}), null, false, ()=>f({}), true, id),
      setShown:v=>node.child("shown").set(v||null),
      setName:(pid,x)=>node.child("names/"+pid).set(x),
      setConfig:c=>node.child("config").set(C.withQids(c)),
      setSession:s=>node.child("session").set(s),
      /* the rules refuse a time stamp that is ahead of the server, so a phone with a fast clock is held back to the server's */
      setVotes:(pid,v)=>node.child("votes/"+pid).set(v && Number.isFinite(v.t) && v.t>now()+30000 ? {...v, t:Math.round(now())} : v),
      setAllVotes:v=>node.child("votes").set(v||{}),
      clearVotes:()=>node.update({votes:null, shown:null, names:null}),
      dropNames:()=>node.update({shown:null, names:null}),
      onActions:f=>listen(P+"/actions", v=>f(v||{}), null, true, ()=>f({}), false, id),
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
