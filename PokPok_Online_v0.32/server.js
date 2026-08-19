'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { EventEmitter } = require('events');

const WebSocket = { OPEN: 1 };
class RawWS extends EventEmitter {
  constructor(socket){
    super(); this.socket=socket; this.readyState=1; this.buffer=Buffer.alloc(0);
    socket.on('data',d=>this._feed(d));
    socket.on('close',()=>{ if(this.readyState!==3){this.readyState=3;this.emit('close');} });
    socket.on('error',e=>this.emit('error',e));
  }
  _feed(data){
    this.buffer=Buffer.concat([this.buffer,data]);
    while(this.buffer.length>=2){
      const b0=this.buffer[0],b1=this.buffer[1],opcode=b0&0x0f,masked=!!(b1&0x80); let len=b1&0x7f,off=2;
      if(len===126){ if(this.buffer.length<4)return; len=this.buffer.readUInt16BE(2); off=4; }
      else if(len===127){ if(this.buffer.length<10)return; const big=this.buffer.readBigUInt64BE(2); if(big>BigInt(2**31))return this.close(); len=Number(big); off=10; }
      const need=off+(masked?4:0)+len; if(this.buffer.length<need)return;
      let mask; if(masked){mask=this.buffer.subarray(off,off+4);off+=4;}
      let payload=Buffer.from(this.buffer.subarray(off,off+len)); this.buffer=this.buffer.subarray(need);
      if(masked)for(let i=0;i<payload.length;i++)payload[i]^=mask[i%4];
      if(opcode===0x8){this.close();return;} if(opcode===0x9){this._sendFrame(payload,0xA);continue;}
      if(opcode===0x1)this.emit('message',payload.toString('utf8'));
    }
  }
  _sendFrame(payload,opcode=0x1){
    if(this.readyState!==1)return; payload=Buffer.isBuffer(payload)?payload:Buffer.from(String(payload)); const len=payload.length; let head;
    if(len<126)head=Buffer.from([0x80|opcode,len]);
    else if(len<65536){head=Buffer.alloc(4);head[0]=0x80|opcode;head[1]=126;head.writeUInt16BE(len,2);}
    else{head=Buffer.alloc(10);head[0]=0x80|opcode;head[1]=127;head.writeBigUInt64BE(BigInt(len),2);}
    this.socket.write(Buffer.concat([head,payload]));
  }
  send(text){this._sendFrame(Buffer.from(String(text)),0x1)}
  close(){if(this.readyState===3)return;try{this._sendFrame(Buffer.alloc(0),0x8)}catch{}this.readyState=3;try{this.socket.end()}catch{}this.emit('close')}
}

const PORT=Number(process.env.PORT||8080);
const PUBLIC_DIR=path.join(__dirname,'public');
const DATA_DIR=process.env.POKPOK_DATA_DIR||path.join(__dirname,'data');
const USERS_FILE=path.join(DATA_DIR,'users.json');
const ROOM_TTL_MS=60*60*1000;
const RECONNECT_GRACE_MS=60*1000;
const SIGNUP_RUBIES=50;
const TURN_MS=45*1000;
const WHEEL_REWARDS=[10,20,40,50,80,100];
const WHEEL_WEIGHTS=[1,1,1,1,1,1]; // moyenne exacte : (10+20+40+50+80+100)/6 = 50 rubis
const TIER_STAKES={debutant:10,intermediaire:20,expert:50,legende:100};
const TIER_LABELS={debutant:'Débutant',intermediaire:'Intermédiaire',expert:'Expert',legende:'Légende'};
const SUITS=['H','D','C','S'];
const RANKS=['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VALUE=Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));
const HAND_NAMES=['Carte haute','Paire','Double Paire','Brelan','Quinte','Couleur','Full','Carré','Quinte Flush','Quinte Flush Royale'];
const SUIT_SORT={C:0,D:1,H:2,S:3};
const AVATARS=['duck','dog','otter','cat','fox','panda','frog','owl','raccoon','rabbit','koala','monkey','lion','tiger','bear','pig','cow','penguin'];

const rooms=new Map();
const quickQueues=new Map();
const sessions=new Map();
let users={};

function ensureData(){
  fs.mkdirSync(DATA_DIR,{recursive:true});
  if(!fs.existsSync(USERS_FILE))fs.writeFileSync(USERS_FILE,JSON.stringify({users:{}},null,2));
  try{const data=JSON.parse(fs.readFileSync(USERS_FILE,'utf8'));users=data.users||{};}catch{users={};}
}
function saveUsers(){
  fs.mkdirSync(DATA_DIR,{recursive:true}); const tmp=USERS_FILE+'.tmp';
  fs.writeFileSync(tmp,JSON.stringify({users},null,2)); fs.renameSync(tmp,USERS_FILE);
}
ensureData();

/* Auth externe optionnelle (Google / Facebook / Téléphone via Firebase Auth).
   Sans variables Render, l'app locale identifiant/PIN continue de fonctionner. */
let firebaseAdminApp=null;
function firebaseClientConfig(){
  const config={apiKey:process.env.FIREBASE_API_KEY||'',authDomain:process.env.FIREBASE_AUTH_DOMAIN||'',projectId:process.env.FIREBASE_PROJECT_ID||'',appId:process.env.FIREBASE_APP_ID||'',messagingSenderId:process.env.FIREBASE_MESSAGING_SENDER_ID||''};
  const configured=!!(config.apiKey&&config.authDomain&&config.projectId&&config.appId);
  return{configured,config:configured?config:null,providers:{google:configured,facebook:configured,phone:configured}};
}
function firebaseAuthAdmin(){
  if(firebaseAdminApp)return firebaseAdminApp.auth();
  const raw=process.env.FIREBASE_SERVICE_ACCOUNT_JSON||'';if(!raw)return null;
  try{const admin=require('firebase-admin'),cred=JSON.parse(raw);firebaseAdminApp=admin.apps?.length?admin.app():admin.initializeApp({credential:admin.credential.cert(cred)});return firebaseAdminApp.auth()}catch(err){console.error('Firebase Admin non initialisé:',err.message);return null}
}
async function firebaseUserKeyFromToken(idToken){
  const auth=firebaseAuthAdmin();if(!auth)throw new Error('Connexion Google/Facebook/Téléphone non configurée sur le serveur.');
  const decoded=await auth.verifyIdToken(String(idToken||''),true);const uid=String(decoded.uid||'');if(!uid)throw new Error('Jeton de connexion externe invalide.');
  const key=`firebase:${uid}`;
  if(!users[key]){
    const sourceName=decoded.name||decoded.email?.split('@')[0]||decoded.phone_number||'Joueur';
    users[key]={id:id(8),username:`ext_${uid.slice(0,12)}`,displayName:cleanName(sourceName),rubies:SIGNUP_RUBIES,lastWheel:'',createdAt:now(),avatar:'duck',authProvider:'firebase',firebaseUid:uid,email:decoded.email||'',phone:decoded.phone_number||''};
    saveUsers();
  }
  return key;
}

function id(n=12){return crypto.randomBytes(n).toString('hex')}
function now(){return Date.now()}
function todayKey(){return new Date().toISOString().slice(0,10)}
function roomCode(){const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';for(let t=0;t<1000;t++){let c='';for(let i=0;i<5;i++)c+=chars[Math.floor(Math.random()*chars.length)];if(!rooms.has(c))return c;}return id(3).toUpperCase()}
function shuffle(a){const arr=[...a];for(let i=arr.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[arr[i],arr[j]]=[arr[j],arr[i]];}return arr}
function cleanName(v){return String(v||'Joueur').trim().slice(0,18)||'Joueur'}
function cleanAvatar(v){return AVATARS.includes(v)?v:'duck'}
function cleanTier(v){return Object.hasOwn(TIER_STAKES,v)?v:'debutant'}
function cleanCapacity(v){const n=Math.round(Number(v)||2);return Math.max(2,Math.min(6,n))}
function cleanTarget(v){return Number(v)===1000?1000:500}
function send(ws,obj){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj))}
function usernameKey(v){return String(v||'').trim().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9_.-]/g,'').slice(0,18)}
function passwordHash(secret,salt){return crypto.scryptSync(String(secret),salt,32).toString('hex')}
function userPublic(u){return u?{username:u.username,displayName:u.displayName,rubies:u.rubies,avatar:u.avatar,wheelAvailable:u.lastWheel!==todayKey(),authProvider:u.authProvider||'local'}:null}
function sendAccount(ws,token=ws.sessionToken){const key=sessions.get(token);if(key&&users[key])send(ws,{type:'account',sessionToken:token,profile:userPublic(users[key])})}
function requireUser(ws){const key=ws.userKey||sessions.get(ws.sessionToken);return key&&users[key]?users[key]:null}
function registerUser(username,secret,avatar){
  const key=usernameKey(username); if(key.length<3)throw new Error('Identifiant : 3 caractères minimum.');
  if(String(secret||'').length<4)throw new Error('Mot de passe / PIN : 4 caractères minimum.');
  if(users[key])throw new Error('Cet identifiant existe déjà.');
  const salt=crypto.randomBytes(16).toString('hex');
  users[key]={id:id(8),username:key,displayName:cleanName(username),salt,hash:passwordHash(secret,salt),rubies:SIGNUP_RUBIES,lastWheel:'',createdAt:now(),avatar:cleanAvatar(avatar),authProvider:'local'};
  saveUsers(); return key;
}
function loginUser(username,secret){const key=usernameKey(username),u=users[key];if(!u||u.hash!==passwordHash(secret||'',u.salt))throw new Error('Identifiant ou mot de passe incorrect.');return key}
function openSession(ws,key){const token=id(18);sessions.set(token,key);ws.sessionToken=token;ws.userKey=key;sendAccount(ws,token);return token}
function resumeSession(ws,token){const key=sessions.get(String(token||''));if(!key||!users[key])return false;ws.sessionToken=String(token);ws.userKey=key;sendAccount(ws,ws.sessionToken);return true}

function buildDeck(){const deck=[];for(const suit of SUITS)for(const rank of RANKS)deck.push({id:`${rank}${suit}`,type:'normal',rank,suit,value:RANK_VALUE[rank]});const counts={blocage:4,chance:4,voleur:2,pecheur:2,bombe:1};for(const [bonus,n] of Object.entries(counts))for(let i=1;i<=n;i++)deck.push({id:`bonus_${bonus}_${i}`,type:'bonus',bonus});return deck}
function evaluateHand(cards){
  const normals=cards.filter(c=>c.type==='normal'); if(normals.length!==5)return{category:-1,name:'Main avec Bonus',tiebreak:[],points:0};
  const vals=normals.map(c=>c.value).sort((a,b)=>b-a),counts={};for(const v of vals)counts[v]=(counts[v]||0)+1;
  const groups=Object.entries(counts).map(([v,n])=>({v:+v,n})).sort((a,b)=>b.n-a.n||b.v-a.v);const sameSuit=normals.every(c=>c.suit===normals[0].suit),uniq=[...new Set(vals)].sort((a,b)=>a-b);let straightHigh=0;
  if(uniq.length===5){if(uniq.join(',')==='2,3,4,5,14')straightHigh=5;else if(uniq[4]-uniq[0]===4&&uniq.every((v,i)=>i===0||v===uniq[i-1]+1))straightHigh=uniq[4];}
  const royal=sameSuit&&straightHigh===14&&uniq.includes(10);if(royal)return{category:9,name:HAND_NAMES[9],tiebreak:[14],points:0};
  if(sameSuit&&straightHigh)return{category:8,name:HAND_NAMES[8],tiebreak:[straightHigh],points:750};if(groups[0].n===4)return{category:7,name:HAND_NAMES[7],tiebreak:[groups[0].v],points:500};
  if(groups[0].n===3&&groups[1]?.n===2)return{category:6,name:HAND_NAMES[6],tiebreak:[groups[0].v,groups[1].v],points:300};if(sameSuit)return{category:5,name:HAND_NAMES[5],tiebreak:[vals[0]],points:250};if(straightHigh)return{category:4,name:HAND_NAMES[4],tiebreak:[straightHigh],points:200};if(groups[0].n===3)return{category:3,name:HAND_NAMES[3],tiebreak:[groups[0].v],points:150};
  const pairs=groups.filter(g=>g.n===2).sort((a,b)=>b.v-a.v);if(pairs.length>=2){const kicker=groups.find(g=>g.n===1)?.v||0;return{category:2,name:HAND_NAMES[2],tiebreak:[pairs[0].v,pairs[1].v,kicker],points:100}}if(pairs.length===1){const kickers=groups.filter(g=>g.n===1).map(g=>g.v).sort((a,b)=>b-a);return{category:1,name:HAND_NAMES[1],tiebreak:[pairs[0].v,...kickers],points:0}}return{category:0,name:HAND_NAMES[0],tiebreak:vals,points:0};
}
function compareEval(a,b){if(a.category!==b.category)return Math.sign(a.category-b.category);for(let i=0;i<Math.max(a.tiebreak.length,b.tiebreak.length);i++){const d=(a.tiebreak[i]||0)-(b.tiebreak[i]||0);if(d)return Math.sign(d)}return 0}
function sortReveal(hand){const a=[...hand];const aceLow=a.filter(c=>c.type==='normal').length===5&&[2,3,4,5,14].every(v=>a.some(c=>c.value===v));a.sort((x,y)=>{if(x.type!==y.type)return x.type==='normal'?-1:1;if(x.type==='bonus')return String(x.bonus).localeCompare(String(y.bonus));const xv=aceLow&&x.value===14?1:x.value,yv=aceLow&&y.value===14?1:y.value;return xv-yv||SUIT_SORT[x.suit]-SUIT_SORT[y.suit]});return a}

class Room{
  constructor(code,opts={}){
    this.code=code;this.target=cleanTarget(opts.target);this.capacity=cleanCapacity(opts.capacity);this.tier=cleanTier(opts.tier);this.stake=TIER_STAKES[this.tier];this.players=Array(this.capacity).fill(null);this.createdAt=now();this.updatedAt=now();
    this.started=false;this.round=0;this.dealerIndex=0;this.currentIndex=0;this.drawPile=[];this.discardPile=[];this.reshuffles=0;this.phase='lobby';this.pokAnnouncer=null;this.finalQueue=[];this.finalCurrent=null;this.pendingVoleur=null;this.pecheurRemaining=0;this.lastEvent=null;this.log=[];this.roundResult=null;this.roundTimer=null;this.turnTimer=null;this.turnClockStart=0;this.turnDeadline=0;this.resultDeadline=0;this.pot=0;this.stakesLocked=false;this.prizePaid=false;this.quick=!!opts.quick;
  }
  hostIndex(){return this.players.findIndex(Boolean)}
  nextIndex(i){return(i+1)%this.players.length}
  addPlayer(userKey,ws,token,preferredIndex=null){
    if(this.players.some(p=>p?.userKey===userKey))return-2;let idx=preferredIndex;
    if(idx===null||idx<0||idx>=this.players.length||this.players[idx])idx=this.players.findIndex(p=>!p);if(idx<0)return-1;
    const u=users[userKey];this.players[idx]={userKey,token,name:u.displayName,avatar:u.avatar,score:0,hand:[],blocked:false,lastBlockedRound:-99,connected:true,ws,disconnectAt:0};this.updatedAt=now();return idx;
  }
  playerIndexByToken(token){return this.players.findIndex(p=>p?.token===token)}
  reconnect(token,ws,userKey){const idx=this.playerIndexByToken(token);if(idx<0||this.players[idx].userKey!==userKey)return-1;const p=this.players[idx];p.ws=ws;p.connected=true;p.disconnectAt=0;return idx}
  full(){return this.players.every(Boolean)}
  broadcast(){this.updatedAt=now();this.players.forEach((p,i)=>{if(p?.connected)send(p.ws,{type:'snapshot',state:this.snapshotFor(i)})})}
  broadcastEvent(kind,text,extra={}){this.lastEvent={id:id(4),kind,text,ts:now(),...extra};this.log.push(text);if(this.log.length>35)this.log.shift();this.broadcast()}
  validTargets(viewer){
    if(viewer!==this.currentIndex)return[];
    if(this.phase==='target_blocage')return this.players.map((p,i)=>p&&i!==viewer&&!p.blocked?i:null).filter(i=>i!==null);
    if(this.phase==='target_voleur')return this.players.map((p,i)=>p&&i!==viewer&&p.hand.length?i:null).filter(i=>i!==null);
    if(this.phase==='bombe_target')return this.players.map((p,i)=>p?i:null).filter(i=>i!==null);
    return[];
  }
  snapshotFor(viewer){
    const p=this.players[viewer],u=p?users[p.userKey]:null;
    return{code:this.code,target:this.target,capacity:this.capacity,tier:this.tier,tierLabel:TIER_LABELS[this.tier],stake:this.stake,pot:this.pot,started:this.started,round:this.round,dealerIndex:this.dealerIndex,currentIndex:this.currentIndex,phase:this.phase,pokAnnouncer:this.pokAnnouncer,finalCurrent:this.finalCurrent,drawCount:this.drawPile.length,discardCount:this.discardPile.length,meIndex:viewer,walletRubies:u?.rubies||0,
      players:this.players.map((x,i)=>x?{index:i,name:x.name,avatar:x.avatar,score:x.score,handCount:x.hand.length,blocked:x.blocked,connected:x.connected,hand:i===viewer?x.hand:undefined,eval:i===viewer?evaluateHand(x.hand):undefined}:null),
      pendingVoleur:this.pendingVoleur&&this.pendingVoleur.actor===viewer?{target:this.pendingVoleur.target,stage:this.pendingVoleur.stage}:null,pecheurRemaining:this.currentIndex===viewer?this.pecheurRemaining:0,validTargets:this.validTargets(viewer),lastEvent:this.lastEvent,roundResult:this.roundResult,turnClockStart:this.turnClockStart,turnDeadline:this.turnDeadline,resultDeadline:this.resultDeadline,canStart:viewer===this.hostIndex()&&this.full()&&!this.started,reconnectGrace:RECONNECT_GRACE_MS};
  }
  lockStakes(){
    if(this.stakesLocked)return true;if(!this.full())return false;
    for(const p of this.players){const u=users[p.userKey];if(!u||u.rubies<this.stake)return false;}
    for(const p of this.players)users[p.userKey].rubies-=this.stake;this.pot=this.stake*this.players.length;this.stakesLocked=true;saveUsers();return true;
  }
  start(){
    if(this.started||!this.full())return{ok:false,message:`Il faut ${this.capacity} joueurs.`};
    if(!this.lockStakes())return{ok:false,message:`Un joueur n'a pas assez de rubis pour la mise de ${this.stake}.`};
    this.started=true;this.round=0;this.dealerIndex=Math.floor(Math.random()*this.players.length);this.players.forEach(p=>p.score=0);this.startRound();return{ok:true};
  }
  startRound(){
    clearTimeout(this.roundTimer);clearTimeout(this.turnTimer);this.resultDeadline=0;this.turnClockStart=0;this.turnDeadline=0;this.round++;this.drawPile=shuffle(buildDeck());this.discardPile=[];this.reshuffles=0;this.pokAnnouncer=null;this.finalQueue=[];this.finalCurrent=null;this.pendingVoleur=null;this.pecheurRemaining=0;this.roundResult=null;this.players.forEach(p=>{p.hand=[];p.blocked=false});
    const first=this.nextIndex(this.dealerIndex),dealOrder=[];for(let n=0;n<5;n++)for(let off=0;off<this.players.length;off++){const idx=(first+off)%this.players.length;this.players[idx].hand.push(this.drawPile.pop());dealOrder.push(idx)}
    this.currentIndex=this.dealerIndex;this.phase='normal_draw';this.lastEvent={id:id(4),kind:'deal',text:`Manche ${this.round} : distribution carte par carte.`,ts:now(),dealOrder};const lead=Math.min(5200,this.capacity*5*105+500);this.startTurnClock(this.currentIndex,lead);this.broadcast();
  }
  clearTurnClock(){clearTimeout(this.turnTimer);this.turnTimer=null;this.turnClockStart=0;this.turnDeadline=0}
  startTurnClock(playerIndex,leadMs=0){
    this.clearTurnClock();this.turnClockStart=now()+Math.max(0,leadMs);this.turnDeadline=this.turnClockStart+TURN_MS;
    const expectedRound=this.round;this.turnTimer=setTimeout(()=>{if(this.started&&this.round===expectedRound&&this.currentIndex===playerIndex&&!this.roundResult)this.handleTurnTimeout(playerIndex)},Math.max(100,this.turnDeadline-now()+40));
  }
  autoTrimToFive(i){const p=this.players[i];while(p&&p.hand.length>5){const idx=p.hand.findIndex(c=>c.type==='bonus');const pick=idx>=0?idx:p.hand.length-1;const[c]=p.hand.splice(pick,1);if(c)this.discardPile.push(c)}}
  handleTurnTimeout(i){
    if(i!==this.currentIndex||this.roundResult)return;const p=this.players[i];if(!p)return;this.clearTurnClock();
    if(this.pokAnnouncer!==null){
      if(i!==this.finalCurrent)return;
      if(this.phase==='final_choice'){this.autoCleanupFinal(i);this.broadcastEvent('timeout',`${p.name} a laissé expirer le chrono : sa main est conservée.`,{actor:i});setTimeout(()=>this.beginNextFinal(),250);return}
      if(this.phase==='final_discard'){this.autoTrimToFive(i);this.autoCleanupFinal(i);this.broadcastEvent('timeout',`${p.name} a laissé expirer le chrono : son dernier tour est terminé automatiquement.`,{actor:i});setTimeout(()=>this.beginNextFinal(),250);return}
      this.autoCleanupFinal(i);this.broadcastEvent('timeout',`${p.name} a laissé expirer le chrono.`,{actor:i});setTimeout(()=>this.beginNextFinal(),250);return;
    }
    if(this.phase==='normal_draw')this.rawDraw(i);
    if(this.phase==='target_blocage'){const t=this.validTargets(i)[0];if(t!==undefined)this.players[t].blocked=true}
    if(this.phase==='bombe_target'){const t=this.validTargets(i)[0]??i,tp=this.players[t];this.discardPile.push(...tp.hand.splice(0));for(let n=0;n<5;n++)if(!this.rawDraw(t))break}
    if(this.phase==='target_voleur'||this.phase==='voleur_pick'||this.phase==='voleur_give'){const target=this.pendingVoleur?.target??this.players.findIndex((x,j)=>j!==i&&x?.hand.length);if(target>=0&&this.players[target]?.hand.length){const tp=this.players[target];const stolen=tp.hand.splice(Math.floor(Math.random()*tp.hand.length),1)[0];if(stolen)p.hand.push(stolen);if(p.hand.length>5){const giveIndex=p.hand.findIndex(c=>c.type==='bonus');const safeIndex=giveIndex>=0?giveIndex:p.hand.length-1;const[given]=p.hand.splice(safeIndex,1);if(given)tp.hand.push(given)}}this.pendingVoleur=null}
    this.autoTrimToFive(i);this.phase='post_discard';this.broadcastEvent('timeout',`${p.name} a laissé expirer le chrono : le tour est terminé automatiquement.`,{actor:i});setTimeout(()=>{if(this.currentIndex===i&&this.phase==='post_discard')this.advanceTurn(this.nextIndex(i))},450);
  }
  ensureDraw(){
    if(this.drawPile.length)return true;if(!this.discardPile.length)return false;this.reshuffles++;
    if(this.pokAnnouncer===null&&this.reshuffles>=2){this.endNull('Deuxième épuisement de la pioche avant Pok Pok : manche nulle.');return false;}
    this.drawPile=shuffle(this.discardPile.splice(0));this.broadcastEvent('shuffle','La défausse est remélangée pour reformer la pioche.');return this.drawPile.length>0;
  }
  rawDraw(i){if(!this.ensureDraw())return null;const c=this.drawPile.pop();this.players[i].hand.push(c);return c}
  discard(i,cardId,activate=true){const p=this.players[i],idx=p.hand.findIndex(c=>c.id===cardId);if(idx<0)return null;const[c]=p.hand.splice(idx,1);this.discardPile.push(c);if(activate&&c.type==='bonus')this.activateBonus(i,c.bonus);return c}
  activateBonus(i,bonus){
    const p=this.players[i];
    if(bonus==='chance'){const c=this.rawDraw(i);if(!c)return;this.phase='chance_discard';this.broadcastEvent('chance',`${p.name} joue Chance et repioche une carte.`,{actor:i,drawSteps:1});return}
    if(bonus==='blocage'){const targets=this.players.map((x,j)=>x&&j!==i&&!x.blocked?j:null).filter(j=>j!==null);if(!targets.length){this.phase='post_discard';this.broadcastEvent('blocage','Aucune cible valide pour Blocage.',{actor:i});return}this.phase='target_blocage';this.broadcastEvent('blocage',`${p.name} joue Blocage : choisissez un adversaire.`,{actor:i});return}
    if(bonus==='voleur'){this.phase='target_voleur';this.broadcastEvent('voleur',`${p.name} joue Voleur : choisissez un adversaire.`,{actor:i});return}
    if(bonus==='pecheur'){let n=0;while(n<3){const c=this.rawDraw(i);if(!c)break;n++}this.pecheurRemaining=n;this.phase='pecheur_discard';this.broadcastEvent('pecheur',`${p.name} joue Pêcheur : ${n} cartes sont piochées, puis ${n} seront défaussées face cachée.`,{actor:i,drawSteps:n});return}
    if(bonus==='bombe'){this.phase='bombe_target';this.broadcastEvent('bombe',`${p.name} joue Bombe : choisissez qui refait sa main.`,{actor:i});return}
  }
  applyBonusTarget(i,target){
    target=Number(target);if(!Number.isInteger(target)||!this.players[target])return false;const p=this.players[i];
    if(this.phase==='target_blocage'){if(target===i||this.players[target].blocked)return false;this.players[target].blocked=true;this.players[target].lastBlockedRound=this.round;this.phase='post_discard';this.broadcastEvent('blocage',`${p.name} bloque ${this.players[target].name} : son prochain tour sera passé.`,{actor:i,target});return true}
    if(this.phase==='target_voleur'){if(target===i||!this.players[target].hand.length)return false;this.pendingVoleur={actor:i,target,stage:'pick'};this.phase='voleur_pick';this.broadcastEvent('voleur',`${p.name} vise ${this.players[target].name}. Choisissez une carte face cachée.`,{actor:i,target});return true}
    if(this.phase==='bombe_target'){const tp=this.players[target];const oldCount=tp.hand.length;this.discardPile.push(...tp.hand.splice(0));for(let n=0;n<5;n++){if(!this.rawDraw(target))break}this.phase='post_discard';this.broadcastEvent('bombe',`${p.name} utilise Bombe sur ${tp.name} : nouvelle main de 5 cartes.`,{actor:i,target,discardSteps:oldCount,drawSteps:5});return true}
    return false;
  }
  postDiscard(i){this.phase='post_discard';this.broadcastEvent('discard',`${this.players[i].name} termine sa défausse.`,{actor:i})}
  advanceTurn(idx){
    if(this.pokAnnouncer!==null)return;const p=this.players[idx];
    if(p.blocked){this.clearTurnClock();p.blocked=false;this.currentIndex=idx;this.phase='blocked_pause';this.broadcastEvent('blocked',`${p.name} passe son tour.`,{target:idx});setTimeout(()=>{if(this.phase==='blocked_pause'&&this.currentIndex===idx)this.advanceTurn(this.nextIndex(idx))},850);return}
    this.currentIndex=idx;this.phase='normal_draw';this.startTurnClock(idx);this.broadcast();
  }
  endTurn(i){if(i!==this.currentIndex||this.phase!=='post_discard')return false;this.advanceTurn(this.nextIndex(i));return true}
  announcePok(i){
    if(i!==this.currentIndex||this.phase!=='post_discard')return false;const p=this.players[i];if(p.hand.length!==5||p.hand.some(c=>c.type!=='normal'))return false;const e=evaluateHand(p.hand);
    if(e.category<2){p.score-=200;this.roundResult={title:'Pok Pok invalide',note:`${p.name} n'avait pas au minimum une Double Paire : -200 points.`,gameOver:false,reveal:this.revealHands(),deltas:{[i]:-200}};this.phase='round_over';this.broadcast();this.scheduleNextRound();return true}
    this.clearTurnClock();this.pokAnnouncer=i;this.players.forEach(x=>x.blocked=false);this.finalQueue=[];let j=this.nextIndex(i);while(j!==i){this.finalQueue.push(j);j=this.nextIndex(j)}this.phase='pok_transition';this.broadcastEvent('pokpok',`${p.name} annonce POK POK ! Tous les adversaires jouent un dernier tour.`,{actor:i});setTimeout(()=>this.beginNextFinal(),420);return true;
  }
  beginNextFinal(){if(this.pokAnnouncer===null)return;if(!this.finalQueue.length){this.showdown();return}this.finalCurrent=this.finalQueue.shift();this.currentIndex=this.finalCurrent;this.phase='final_choice';this.startTurnClock(this.finalCurrent);this.broadcast()}
  finalKeep(i){if(this.phase!=='final_choice'||i!==this.finalCurrent)return false;this.autoCleanupFinal(i);this.beginNextFinal();return true}
  finalDraw(i){if(this.phase!=='final_choice'||i!==this.finalCurrent)return false;const c=this.rawDraw(i);if(!c)return false;this.phase='final_discard';this.broadcastEvent('draw',`${this.players[i].name} pioche pour son dernier tour.`,{actor:i});return true}
  finalDiscard(i,cardId){if(this.phase!=='final_discard'||i!==this.finalCurrent)return false;const c=this.discard(i,cardId,false);if(!c)return false;this.autoCleanupFinal(i);this.beginNextFinal();return true}
  autoCleanupFinal(i){const p=this.players[i];let guard=100;while(p.hand.some(c=>c.type==='bonus')&&guard--){const idx=p.hand.findIndex(c=>c.type==='bonus');const[b]=p.hand.splice(idx,1);this.discardPile.push(b);let c=null;do{c=this.rawDraw(i);if(!c)return;if(c.type==='bonus'){const j=p.hand.findIndex(x=>x.id===c.id);if(j>=0)p.hand.splice(j,1);this.discardPile.push(c)}}while(c&&c.type==='bonus')}while(p.hand.length>5)this.discardPile.push(p.hand.pop())}
  revealHands(){return this.players.map((p,i)=>({index:i,name:p.name,avatar:p.avatar,score:p.score,eval:evaluateHand(p.hand),hand:sortReveal(p.hand)}))}
  settleRubies(winners){
    if(this.prizePaid||!this.stakesLocked||!winners.length)return'';this.prizePaid=true;const share=Math.floor(this.pot/winners.length),remainder=this.pot-share*winners.length;
    winners.forEach((idx,k)=>{users[this.players[idx].userKey].rubies+=share+(k===0?remainder:0)});saveUsers();return winners.length===1?`${this.players[winners[0]].name} remporte le pot de ${this.pot} rubis !`:`Pot partagé : ${winners.map(i=>this.players[i].name).join(' et ')} reçoivent ${share} rubis chacun${remainder?' (reste attribué au premier gagnant)':''}.`;
  }
  showdown(){
    const ann=this.pokAnnouncer;if(ann===null)return;const evals=this.players.map(p=>evaluateHand(p.hand)),royals=evals.map((e,i)=>e.category===9?i:null).filter(i=>i!==null);let title='Fin de manche',note='',gameOver=false,deltas={},winners=[];
    if(royals.length>1){title='Égalité de Quinte Flush Royale';note='Manche annulée et personne ne marque de point.'}
    else if(royals.length===1){title='VICTOIRE IMMÉDIATE !';note=`${this.players[royals[0]].name} possède une Quinte Flush Royale.`;gameOver=true;winners=[royals[0]]}
    else{
      const annEval=evals[ann],better=[],ties=[];evals.forEach((e,i)=>{if(i===ann)return;const c=compareEval(e,annEval);if(c>0)better.push(i);else if(c===0)ties.push(i)});
      if(better.length){for(const i of better){const pts=evals[i].points||0;this.players[i].score+=pts;deltas[i]=(deltas[i]||0)+pts}const malus=annEval.points||0;this.players[ann].score-=malus;deltas[ann]=(deltas[ann]||0)-malus;note=`${better.map(i=>this.players[i].name).join(', ')} battent l'annonceur. L'annonceur subit un seul malus de ${malus} points.`}
      else if(ties.length){const pts=annEval.points||0;this.players[ann].score+=pts;deltas[ann]=(deltas[ann]||0)+pts;for(const i of ties){this.players[i].score+=pts;deltas[i]=(deltas[i]||0)+pts}note=`Égalité parfaite avec l'annonceur : ${pts} points pour chaque joueur concerné, sans malus.`}
      else{const pts=annEval.points||0;this.players[ann].score+=pts;deltas[ann]=(deltas[ann]||0)+pts;note=`${this.players[ann].name} possède seul la meilleure main et marque ${pts} points.`}
      const atTarget=this.players.map((p,i)=>p.score>=this.target?i:null).filter(i=>i!==null);if(atTarget.length){const max=Math.max(...atTarget.map(i=>this.players[i].score));winners=atTarget.filter(i=>this.players[i].score===max);title='Partie terminée !';gameOver=true;note+=' '+winners.map(i=>this.players[i].name).join(' et ')+' atteint l’objectif.'}
    }
    let rubiesNote='';if(gameOver)rubiesNote=this.settleRubies(winners);this.clearTurnClock();this.roundResult={title,note,rubiesNote,gameOver,reveal:this.revealHands(),deltas,winners,pot:this.pot};this.phase=gameOver?'game_over':'round_over';this.resultDeadline=gameOver?0:now()+45000;this.broadcast();if(!gameOver)this.scheduleNextRound();
  }
  endNull(reason){this.clearTurnClock();this.roundResult={title:'Manche nulle',note:reason,rubiesNote:'',gameOver:false,reveal:[],deltas:{},winners:[],pot:this.pot};this.phase='round_over';this.resultDeadline=now()+45000;this.broadcast();this.scheduleNextRound()}
  scheduleNextRound(){clearTimeout(this.roundTimer);if(!this.resultDeadline)this.resultDeadline=now()+45000;this.roundTimer=setTimeout(()=>{if(this.phase==='round_over'){this.dealerIndex=this.nextIndex(this.dealerIndex);this.startRound()}},Math.max(100,this.resultDeadline-now()))}
  nextRound(requester){if(this.phase!=='round_over'||requester!==this.hostIndex())return false;clearTimeout(this.roundTimer);this.resultDeadline=0;this.dealerIndex=this.nextIndex(this.dealerIndex);this.startRound();return true}
}

function contentType(file){const ext=path.extname(file).toLowerCase();return({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.wav':'audio/wav','.svg':'image/svg+xml'})[ext]||'application/octet-stream'}
const server=http.createServer((req,res)=>{let urlPath=decodeURIComponent((req.url||'/').split('?')[0]);
  if(urlPath==='/auth-config'){const body=JSON.stringify(firebaseClientConfig());res.writeHead(200,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});return res.end(body)}
  if(urlPath==='/')urlPath='/index.html';const file=path.normalize(path.join(PUBLIC_DIR,urlPath));if(!file.startsWith(PUBLIC_DIR)){res.writeHead(403);return res.end('Forbidden')}fs.stat(file,(err,st)=>{if(err||!st.isFile()){res.writeHead(404);return res.end('Not found')}res.writeHead(200,{'Content-Type':contentType(file),'Cache-Control':'no-store'});fs.createReadStream(file).pipe(res)})});

function attach(ws,room,idx){ws.roomCode=room.code;ws.playerIndex=idx;ws.roomToken=room.players[idx].token;room.players[idx].ws=ws;room.players[idx].connected=true;send(ws,{type:'joined',code:room.code,playerIndex:idx,token:ws.roomToken});room.broadcast()}
function findRoom(code){return rooms.get(String(code||'').toUpperCase())}
function removeFromQueues(ws){for(const q of quickQueues.values()){for(let i=q.length-1;i>=0;i--)if(q[i].ws===ws)q.splice(i,1)}}
function queueKey(tier,capacity,target){return`${tier}|${capacity}|${target}`}
function roomOpts(m,quick=false){const tier=cleanTier(m.tier),capacity=cleanCapacity(m.capacity),target=cleanTarget(m.target);return{tier,capacity,target,quick}}
function enterQuick(ws,m){
  const u=requireUser(ws);if(!u)return send(ws,{type:'error',message:'Connectez-vous d’abord.'});const opts=roomOpts(m,true),stake=TIER_STAKES[opts.tier];if(u.rubies<stake)return send(ws,{type:'error',message:`Il faut ${stake} rubis pour le salon ${TIER_LABELS[opts.tier]}.`});
  removeFromQueues(ws);const key=queueKey(opts.tier,opts.capacity,opts.target),q=quickQueues.get(key)||[];quickQueues.set(key,q);if(q.some(x=>x.userKey===ws.userKey))return;
  q.push({ws,userKey:ws.userKey,opts});send(ws,{type:'queue',message:`Recherche ${opts.capacity} joueurs • ${TIER_LABELS[opts.tier]} • ${stake} rubis`,waiting:q.length,needed:opts.capacity});
  const valid=q.filter(x=>x.ws.readyState===WebSocket.OPEN&&users[x.userKey]?.rubies>=stake);q.splice(0,q.length,...valid);if(q.length<opts.capacity)return;
  const group=q.splice(0,opts.capacity),code=roomCode(),room=new Room(code,opts);rooms.set(code,room);group.forEach((x,n)=>{const idx=room.addPlayer(x.userKey,x.ws,id(),n);attach(x.ws,room,idx)});const started=room.start();if(!started.ok)group.forEach(x=>send(x.ws,{type:'error',message:started.message}));
}

function onConnection(ws){
  send(ws,{type:'hello',version:'0.32',tiers:TIER_STAKES,signupRubies:SIGNUP_RUBIES,wheelAverage:50});
  ws.on('message',async raw=>{let m;try{m=JSON.parse(raw)}catch{return}try{
    if(m.type==='register'){const key=registerUser(m.username,m.secret,m.avatar);openSession(ws,key);return}
    if(m.type==='login'){const key=loginUser(m.username,m.secret);openSession(ws,key);return}
    if(m.type==='federated_login'){const key=await firebaseUserKeyFromToken(m.idToken);openSession(ws,key);return}
    if(m.type==='resume_account'){if(!resumeSession(ws,m.sessionToken))send(ws,{type:'auth_required'});return}
    if(m.type==='logout'){if(ws.sessionToken)sessions.delete(ws.sessionToken);ws.userKey=null;ws.sessionToken=null;send(ws,{type:'logged_out'});return}
    if(m.type==='spin_wheel'){const u=requireUser(ws);if(!u)return send(ws,{type:'error',message:'Connectez-vous.'});if(u.lastWheel===todayKey())return send(ws,{type:'error',message:'La roulette a déjà été jouée aujourd’hui.'});let r=Math.random()*WHEEL_WEIGHTS.reduce((a,b)=>a+b,0),reward=WHEEL_REWARDS[0];for(let i=0;i<WHEEL_REWARDS.length;i++){r-=WHEEL_WEIGHTS[i];if(r<=0){reward=WHEEL_REWARDS[i];break}}u.lastWheel=todayKey();u.rubies+=reward;saveUsers();send(ws,{type:'wheel_result',reward});sendAccount(ws);return}
    if(m.type==='set_avatar'){const u=requireUser(ws);if(!u)return;u.avatar=cleanAvatar(m.avatar);saveUsers();sendAccount(ws);return}
    if(m.type==='quick_match'){enterQuick(ws,m);return}
    if(m.type==='cancel_queue'){removeFromQueues(ws);send(ws,{type:'queue_cancelled'});return}
    if(m.type==='create_room'||m.type==='join_room')return send(ws,{type:'error',message:'Les salons privés sont désactivés : utilisez Trouver une partie.'});
    if(m.type==='reconnect'){
      const u=requireUser(ws);if(!u)return send(ws,{type:'auth_required'});const room=findRoom(m.code);if(!room)return send(ws,{type:'error',message:'Ancienne partie introuvable.'});const idx=room.reconnect(String(m.token||''),ws,ws.userKey);if(idx<0)return send(ws,{type:'error',message:'Session de partie expirée.'});attach(ws,room,idx);return;
    }
    if(m.type==='leave_room'){const room=findRoom(ws.roomCode),i=ws.playerIndex;if(room&&Number.isInteger(i)&&room.players[i]){const p=room.players[i];if(room.started){p.connected=false;p.disconnectAt=now();p.ws=null;room.broadcastEvent('disconnect',`${p.name} a quitté la table. Sa place reste réservée pendant la reconnexion.`,{target:i})}else{room.players[i]=null;room.broadcast()} }ws.roomCode=null;ws.playerIndex=null;ws.roomToken=null;send(ws,{type:'left_room'});return}
    const room=findRoom(ws.roomCode),i=ws.playerIndex;if(!room||!Number.isInteger(i)||!room.players[i]||room.players[i].userKey!==ws.userKey)return send(ws,{type:'error',message:'Session de partie invalide.'});const p=room.players[i];
    if(m.type==='start_game')return;
    if(!room.started)return;
    if(m.type==='draw'){if(room.currentIndex!==i||room.phase!=='normal_draw')return;const c=room.rawDraw(i);if(!c)return;room.phase='normal_discard';room.broadcastEvent('draw',`${p.name} pioche une carte.`,{actor:i});return}
    if(m.type==='discard'){
      if(room.currentIndex!==i)return;
      if(room.phase==='normal_discard'){const c=room.discard(i,String(m.cardId),true);if(!c)return;if(c.type==='normal')room.postDiscard(i);else if(!['chance','blocage','voleur','pecheur','bombe'].includes(c.bonus)&&room.phase!=='post_discard')room.postDiscard(i);return}
      if(room.phase==='chance_discard'){const c=room.discard(i,String(m.cardId),true);if(!c)return;if(c.type==='normal')room.postDiscard(i);return}
      if(room.phase==='pecheur_discard'){const c=room.discard(i,String(m.cardId),false);if(!c)return;room.pecheurRemaining=Math.max(0,room.pecheurRemaining-1);if(room.pecheurRemaining===0)room.postDiscard(i);else room.broadcastEvent('pecheur',`${p.name} défausse une carte face cachée (${3-room.pecheurRemaining}/3).`,{actor:i,discardStep:3-room.pecheurRemaining});return}
      if(room.phase==='final_discard'){room.finalDiscard(i,String(m.cardId));return}
    }
    if(m.type==='bonus_target'){if(room.currentIndex!==i)return;room.applyBonusTarget(i,m.target);return}
    if(m.type==='voleur_pick'){
      if(room.phase!=='voleur_pick'||!room.pendingVoleur||room.pendingVoleur.actor!==i)return;const target=room.pendingVoleur.target,tp=room.players[target],idx=Math.max(0,Math.min(tp.hand.length-1,Number(m.index)||0));if(!tp.hand.length)return;const[stolen]=tp.hand.splice(idx,1);p.hand.push(stolen);room.pendingVoleur.stage='give';room.phase='voleur_give';room.broadcastEvent('voleur',`${p.name} prend une carte face cachée à ${tp.name}.`,{actor:i,target,transfer:'take'});return;
    }
    if(m.type==='voleur_give'){
      if(room.phase!=='voleur_give'||!room.pendingVoleur||room.pendingVoleur.actor!==i)return;const target=room.pendingVoleur.target,idx=p.hand.findIndex(c=>c.id===String(m.cardId));if(idx<0)return;const[give]=p.hand.splice(idx,1);room.players[target].hand.push(give);room.pendingVoleur=null;room.phase='post_discard';room.broadcastEvent('voleur',`${p.name} rend une carte face cachée à ${room.players[target].name}.`,{actor:i,target,transfer:'give'});return;
    }
    if(m.type==='announce_pok'){room.announcePok(i);return}if(m.type==='end_turn'){room.endTurn(i);return}if(m.type==='final_keep'){room.finalKeep(i);return}if(m.type==='final_draw'){room.finalDraw(i);return}if(m.type==='next_round'){room.nextRound(i);return}
    if(m.type==='reaction'){room.broadcastEvent('reaction',`${p.name} réagit ${String(m.emoji||'😊').slice(0,4)}`,{actor:i,emoji:String(m.emoji||'😊').slice(0,4)});return}
  }catch(err){console.error(err);send(ws,{type:'error',message:err.message||'Erreur serveur.'})}});
  ws.on('close',()=>{removeFromQueues(ws);const room=findRoom(ws.roomCode);if(!room)return;const i=ws.playerIndex,p=room.players[i];if(p&&p.ws===ws){p.connected=false;p.disconnectAt=now();room.broadcastEvent('disconnect',`${p.name} est déconnecté. Il a 60 secondes pour revenir.`,{target:i});setTimeout(()=>{if(!p.connected&&p.disconnectAt&&now()-p.disconnectAt>=RECONNECT_GRACE_MS)room.broadcastEvent('disconnect',`${p.name} n'est pas revenu. La partie reste en pause pour protéger la mise dans ce prototype.`,{target:i})},RECONNECT_GRACE_MS+100)}})
}

server.on('upgrade',(req,socket,head)=>{const key=req.headers['sec-websocket-key'];if(!key){socket.destroy();return}const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');const ws=new RawWS(socket);if(head&&head.length)ws._feed(head);onConnection(ws)});
setInterval(()=>{const cutoff=now()-ROOM_TTL_MS;for(const[code,r]of rooms)if(r.updatedAt<cutoff&&r.players.every(p=>!p?.connected)){clearTimeout(r.roundTimer);clearTimeout(r.turnTimer);rooms.delete(code)}},60000).unref();
server.listen(PORT,()=>console.log(`POK POK Online v0.32 sur http://localhost:${PORT}`));
