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
      const b0=this.buffer[0], b1=this.buffer[1]; const opcode=b0&0x0f; const masked=!!(b1&0x80); let len=b1&0x7f, off=2;
      if(len===126){ if(this.buffer.length<4)return; len=this.buffer.readUInt16BE(2); off=4; }
      else if(len===127){ if(this.buffer.length<10)return; const big=this.buffer.readBigUInt64BE(2); if(big>BigInt(2**31))return this.close(); len=Number(big); off=10; }
      const need=off+(masked?4:0)+len; if(this.buffer.length<need)return;
      let mask; if(masked){ mask=this.buffer.subarray(off,off+4); off+=4; }
      let payload=Buffer.from(this.buffer.subarray(off,off+len)); this.buffer=this.buffer.subarray(need);
      if(masked) for(let i=0;i<payload.length;i++) payload[i]^=mask[i%4];
      if(opcode===0x8){ this.close(); return; }
      if(opcode===0x9){ this._sendFrame(payload,0xA); continue; }
      if(opcode===0x1) this.emit('message',payload.toString('utf8'));
    }
  }
  _sendFrame(payload,opcode=0x1){
    if(this.readyState!==1)return; payload=Buffer.isBuffer(payload)?payload:Buffer.from(String(payload)); const len=payload.length; let head;
    if(len<126){ head=Buffer.from([0x80|opcode,len]); }
    else if(len<65536){ head=Buffer.alloc(4); head[0]=0x80|opcode; head[1]=126; head.writeUInt16BE(len,2); }
    else { head=Buffer.alloc(10); head[0]=0x80|opcode; head[1]=127; head.writeBigUInt64BE(BigInt(len),2); }
    this.socket.write(Buffer.concat([head,payload]));
  }
  send(text){ this._sendFrame(Buffer.from(String(text)),0x1); }
  close(){ if(this.readyState===3)return; try{this._sendFrame(Buffer.alloc(0),0x8)}catch{} this.readyState=3; try{this.socket.end()}catch{} this.emit('close'); }
}


const PORT = Number(process.env.PORT || 8080);
const PUBLIC_DIR = path.join(__dirname, 'public');
const ROOM_TTL_MS = 60 * 60 * 1000;
const RECONNECT_GRACE_MS = 60 * 1000;

const SUITS = ['H','D','C','S'];
const RANKS = ['2','3','4','5','6','7','8','9','10','J','Q','K','A'];
const RANK_VALUE = Object.fromEntries(RANKS.map((r,i)=>[r,i+2]));
const HAND_NAMES = ['Carte haute','Paire','Double Paire','Brelan','Quinte','Couleur','Full','Carré','Quinte Flush','Quinte Flush Royale'];
const BONUS_LABEL = { chance:'Chance', blocage:'Blocage', voleur:'Voleur', pecheur:'Pêcheur', bombe:'Bombe' };
const SUIT_SORT = {C:0,D:1,H:2,S:3};

const rooms = new Map();
const quickQueues = new Map();

function id(n=12){ return crypto.randomBytes(n).toString('hex'); }
function roomCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for(let tries=0;tries<1000;tries++){
    let c=''; for(let i=0;i<5;i++) c += chars[Math.floor(Math.random()*chars.length)];
    if(!rooms.has(c)) return c;
  }
  return id(3).toUpperCase();
}
function shuffle(a){
  const arr=[...a];
  for(let i=arr.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
  return arr;
}
function cleanName(v){ return String(v||'Joueur').trim().slice(0,18) || 'Joueur'; }
function cleanAvatar(v){
  const ok=['duck','dog','otter','cat','fox','panda','frog','owl','raccoon','rabbit','koala','monkey','lion','tiger','bear','pig','cow','penguin'];
  return ok.includes(v)?v:'duck';
}
function send(ws,obj){ if(ws && ws.readyState===WebSocket.OPEN) ws.send(JSON.stringify(obj)); }
function now(){ return Date.now(); }

function buildDeck(){
  const deck=[];
  for(const suit of SUITS) for(const rank of RANKS) deck.push({id:`${rank}${suit}`,type:'normal',rank,suit,value:RANK_VALUE[rank]});
  const counts={blocage:4,chance:4,voleur:2,pecheur:2,bombe:1};
  for(const [bonus,n] of Object.entries(counts)) for(let i=1;i<=n;i++) deck.push({id:`bonus_${bonus}_${i}`,type:'bonus',bonus});
  return deck;
}
function evaluateHand(cards){
  const normals=cards.filter(c=>c.type==='normal');
  if(normals.length!==5) return {category:-1,name:'Main avec Bonus',tiebreak:[],points:0};
  const vals=normals.map(c=>c.value).sort((a,b)=>b-a);
  const counts={}; for(const v of vals) counts[v]=(counts[v]||0)+1;
  const groups=Object.entries(counts).map(([v,n])=>({v:+v,n})).sort((a,b)=>b.n-a.n||b.v-a.v);
  const sameSuit=normals.every(c=>c.suit===normals[0].suit);
  const uniq=[...new Set(vals)].sort((a,b)=>a-b);
  let straightHigh=0;
  if(uniq.length===5){
    if(uniq.join(',')==='2,3,4,5,14') straightHigh=5;
    else if(uniq[4]-uniq[0]===4 && uniq.every((v,i)=>i===0||v===uniq[i-1]+1)) straightHigh=uniq[4];
  }
  const royal=sameSuit&&straightHigh===14&&uniq.includes(10);
  if(royal) return {category:9,name:HAND_NAMES[9],tiebreak:[14],points:0};
  if(sameSuit&&straightHigh) return {category:8,name:HAND_NAMES[8],tiebreak:[straightHigh],points:750};
  if(groups[0].n===4) return {category:7,name:HAND_NAMES[7],tiebreak:[groups[0].v],points:500};
  if(groups[0].n===3&&groups[1]?.n===2) return {category:6,name:HAND_NAMES[6],tiebreak:[groups[0].v,groups[1].v],points:300};
  if(sameSuit) return {category:5,name:HAND_NAMES[5],tiebreak:[vals[0]],points:250};
  if(straightHigh) return {category:4,name:HAND_NAMES[4],tiebreak:[straightHigh],points:200};
  if(groups[0].n===3) return {category:3,name:HAND_NAMES[3],tiebreak:[groups[0].v],points:150};
  const pairs=groups.filter(g=>g.n===2).sort((a,b)=>b.v-a.v);
  if(pairs.length>=2){ const kicker=groups.find(g=>g.n===1)?.v||0; return {category:2,name:HAND_NAMES[2],tiebreak:[pairs[0].v,pairs[1].v,kicker],points:100}; }
  if(pairs.length===1){ const kickers=groups.filter(g=>g.n===1).map(g=>g.v).sort((a,b)=>b-a); return {category:1,name:HAND_NAMES[1],tiebreak:[pairs[0].v,...kickers],points:0}; }
  return {category:0,name:HAND_NAMES[0],tiebreak:vals,points:0};
}
function compareEval(a,b){
  if(a.category!==b.category) return Math.sign(a.category-b.category);
  for(let i=0;i<Math.max(a.tiebreak.length,b.tiebreak.length);i++){
    const d=(a.tiebreak[i]||0)-(b.tiebreak[i]||0); if(d) return Math.sign(d);
  }
  return 0;
}
function sortReveal(hand){
  const a=[...hand];
  a.sort((x,y)=>{
    if(x.type!==y.type) return x.type==='normal'?-1:1;
    if(x.type==='bonus') return String(x.bonus).localeCompare(String(y.bonus));
    const aceLow = a.filter(c=>c.type==='normal').length===5 && [2,3,4,5,14].every(v=>a.some(c=>c.value===v));
    const xv=aceLow&&x.value===14?1:x.value, yv=aceLow&&y.value===14?1:y.value;
    return xv-yv || SUIT_SORT[x.suit]-SUIT_SORT[y.suit];
  });
  return a;
}

class Room {
  constructor(code,target=500){
    this.code=code; this.target=target===1000?1000:500; this.createdAt=now(); this.updatedAt=now();
    this.players=[null,null]; this.started=false; this.round=0; this.dealerIndex=0; this.currentIndex=0;
    this.drawPile=[]; this.discardPile=[]; this.reshuffles=0; this.phase='lobby'; this.pokAnnouncer=null;
    this.finalQueue=[]; this.finalCurrent=null; this.pendingVoleur=null; this.pecheurRemaining=0;
    this.log=[]; this.lastEvent=null; this.roundResult=null; this.roundTimer=null;
  }
  addPlayer(meta,token,ws,preferredIndex=null){
    let idx=preferredIndex;
    if(idx===null || idx<0 || idx>1 || this.players[idx]) idx=this.players.findIndex(p=>!p);
    if(idx<0) return -1;
    this.players[idx]={token,name:cleanName(meta.name),avatar:cleanAvatar(meta.avatar),score:0,hand:[],blocked:false,connected:true,ws,disconnectAt:0};
    this.updatedAt=now(); return idx;
  }
  playerIndexByToken(token){ return this.players.findIndex(p=>p?.token===token); }
  reconnect(token,ws){
    const idx=this.playerIndexByToken(token); if(idx<0) return -1;
    const p=this.players[idx]; p.ws=ws; p.connected=true; p.disconnectAt=0; this.updatedAt=now(); return idx;
  }
  broadcastEvent(kind,text,extra={}){ this.lastEvent={id:id(4),kind,text,ts:now(),...extra}; this.log.push(text); if(this.log.length>30)this.log.shift(); this.broadcast(); }
  broadcast(){ this.updatedAt=now(); this.players.forEach((p,i)=>{ if(p?.connected) send(p.ws,{type:'snapshot',state:this.snapshotFor(i)}); }); }
  snapshotFor(viewer){
    const me=this.players[viewer], opp=this.players[1-viewer];
    return {
      code:this.code,target:this.target,started:this.started,round:this.round,dealerIndex:this.dealerIndex,currentIndex:this.currentIndex,
      phase:this.phase,pokAnnouncer:this.pokAnnouncer,finalCurrent:this.finalCurrent,drawCount:this.drawPile.length,discardCount:this.discardPile.length,
      meIndex:viewer,
      players:this.players.map((p,i)=>p?{index:i,name:p.name,avatar:p.avatar,score:p.score,handCount:p.hand.length,blocked:p.blocked,connected:p.connected,hand:i===viewer?p.hand:undefined,eval:i===viewer?evaluateHand(p.hand):undefined}:null),
      pendingVoleur:this.pendingVoleur&&this.pendingVoleur.actor===viewer?{target:this.pendingVoleur.target,stage:this.pendingVoleur.stage}:null,
      pecheurRemaining:this.currentIndex===viewer?this.pecheurRemaining:0,
      lastEvent:this.lastEvent,roundResult:this.roundResult,
      canStart:viewer===0&&this.players.every(Boolean)&&!this.started,
      reconnectGrace:RECONNECT_GRACE_MS
    };
  }
  start(){
    if(this.started||!this.players.every(Boolean)) return false;
    this.started=true; this.round=0; this.dealerIndex=Math.floor(Math.random()*2); this.players.forEach(p=>{p.score=0;});
    this.startRound(); return true;
  }
  startRound(){
    clearTimeout(this.roundTimer); this.round++;
    this.drawPile=shuffle(buildDeck()); this.discardPile=[]; this.reshuffles=0; this.pokAnnouncer=null; this.finalQueue=[]; this.finalCurrent=null; this.pendingVoleur=null; this.pecheurRemaining=0; this.roundResult=null;
    this.players.forEach(p=>{p.hand=[];p.blocked=false;});
    // Distribution une par une, à partir du joueur à gauche du donneur.
    const first=1-this.dealerIndex;
    for(let n=0;n<5;n++) for(const idx of [first,1-first]) this.players[idx].hand.push(this.drawPile.pop());
    this.currentIndex=first; this.phase='normal_draw';
    this.lastEvent={id:id(4),kind:'deal',text:`Manche ${this.round} : les cartes sont distribuées.`,ts:now()};
    this.broadcast();
  }
  ensureDraw(){
    if(this.drawPile.length) return true;
    if(!this.discardPile.length) return false;
    this.reshuffles++;
    if(!this.pokAnnouncer && this.reshuffles>=2){ this.endNull('Deuxième épuisement de la pioche avant Pok Pok : manche nulle.'); return false; }
    this.drawPile=shuffle(this.discardPile.splice(0));
    this.broadcastEvent('shuffle','La défausse est remélangée pour reformer la pioche.');
    return this.drawPile.length>0;
  }
  rawDraw(i){ if(!this.ensureDraw()) return null; const c=this.drawPile.pop(); this.players[i].hand.push(c); return c; }
  discard(i,cardId,activate=true){
    const p=this.players[i]; const idx=p.hand.findIndex(c=>c.id===cardId); if(idx<0) return null;
    const [c]=p.hand.splice(idx,1); this.discardPile.push(c);
    if(activate&&c.type==='bonus') this.activateBonus(i,c.bonus);
    return c;
  }
  activateBonus(i,bonus){
    const p=this.players[i]; const opp=1-i;
    if(bonus==='chance'){
      const c=this.rawDraw(i); if(!c)return;
      this.phase='chance_discard'; this.broadcastEvent('chance',`${p.name} joue Chance et repioche une carte.`,{actor:i}); return;
    }
    if(bonus==='blocage'){
      this.players[opp].blocked=true; this.phase='post_discard'; this.broadcastEvent('blocage',`${p.name} bloque ${this.players[opp].name}.`,{actor:i,target:opp}); return;
    }
    if(bonus==='voleur'){
      this.pendingVoleur={actor:i,target:opp,stage:'pick'}; this.phase='voleur_pick'; this.broadcastEvent('voleur',`${p.name} joue Voleur : une carte va être prise face cachée.`,{actor:i,target:opp}); return;
    }
    if(bonus==='pecheur'){
      let n=0; while(n<3){ const c=this.rawDraw(i); if(!c)break; n++; }
      this.pecheurRemaining=3; this.phase='pecheur_discard'; this.broadcastEvent('pecheur',`${p.name} joue Pêcheur : 3 cartes sont piochées, puis 3 seront défaussées face cachée.`,{actor:i}); return;
    }
    if(bonus==='bombe'){
      this.phase='bombe_target'; this.broadcastEvent('bombe',`${p.name} joue Bombe : choisissez qui refait sa main.`,{actor:i}); return;
    }
  }
  postDiscard(i){ this.phase='post_discard'; this.broadcastEvent('discard',`${this.players[i].name} termine sa défausse.`,{actor:i}); }
  endTurn(i){
    if(i!==this.currentIndex||this.phase!=='post_discard') return false;
    let nxt=1-i;
    if(this.players[nxt].blocked){
      this.players[nxt].blocked=false;
      this.currentIndex=i;
      this.phase='blocked_pause';
      this.broadcastEvent('blocked',`${this.players[nxt].name} passe son tour.`,{target:nxt});
      setTimeout(()=>{ if(this.phase!=='blocked_pause')return; this.currentIndex=i; this.phase='normal_draw'; this.broadcast(); },900);
      return true;
    }
    this.currentIndex=nxt; this.phase='normal_draw'; this.broadcast(); return true;
  }
  announcePok(i){
    if(i!==this.currentIndex||this.phase!=='post_discard') return false;
    const p=this.players[i];
    if(p.hand.length!==5 || p.hand.some(c=>c.type!=='normal')) return false;
    const e=evaluateHand(p.hand);
    if(e.category<2){
      p.score-=200;
      this.roundResult={title:'Pok Pok invalide',note:`${p.name} n'avait pas au minimum une Double Paire : -200 points.`,gameOver:false,reveal:this.revealHands(),deltas:{[i]:-200}};
      this.phase='round_over'; this.broadcast(); this.scheduleNextRound(); return true;
    }
    this.pokAnnouncer=i; this.players.forEach(x=>x.blocked=false); this.finalQueue=[1-i]; this.finalCurrent=1-i; this.currentIndex=1-i; this.phase='final_choice';
    this.broadcastEvent('pokpok',`${p.name} annonce POK POK ! ${this.players[1-i].name} joue un dernier tour.`,{actor:i}); return true;
  }
  finalKeep(i){ if(this.phase!=='final_choice'||i!==this.finalCurrent)return false; this.autoCleanupFinal(i); this.showdown(); return true; }
  finalDraw(i){ if(this.phase!=='final_choice'||i!==this.finalCurrent)return false; const c=this.rawDraw(i); if(!c)return false; this.phase='final_discard'; this.broadcastEvent('draw',`${this.players[i].name} pioche pour son dernier tour.`,{actor:i}); return true; }
  finalDiscard(i,cardId){ if(this.phase!=='final_discard'||i!==this.finalCurrent)return false; const c=this.discard(i,cardId,false); if(!c)return false; this.autoCleanupFinal(i); this.showdown(); return true; }
  autoCleanupFinal(i){
    const p=this.players[i]; let guard=100;
    while(p.hand.some(c=>c.type==='bonus')&&guard--){
      const idx=p.hand.findIndex(c=>c.type==='bonus'); const [b]=p.hand.splice(idx,1); this.discardPile.push(b);
      let c=null; do { c=this.rawDraw(i); if(!c) return; if(c.type==='bonus'){ const j=p.hand.findIndex(x=>x.id===c.id); if(j>=0)p.hand.splice(j,1); this.discardPile.push(c); } } while(c&&c.type==='bonus');
    }
    while(p.hand.length>5){ const c=p.hand.pop(); this.discardPile.push(c); }
  }
  revealHands(){ return this.players.map((p,i)=>({index:i,name:p.name,avatar:p.avatar,score:p.score,eval:evaluateHand(p.hand),hand:sortReveal(p.hand)})); }
  showdown(){
    const ann=this.pokAnnouncer; if(ann===null)return;
    const evals=this.players.map(p=>evaluateHand(p.hand)); const royals=evals.map((e,i)=>e.category===9?i:null).filter(i=>i!==null);
    let title='Fin de manche',note='',gameOver=false,deltas={};
    if(royals.length>1){ title='Égalité de Quinte Flush Royale'; note='Manche annulée.'; }
    else if(royals.length===1){ title='VICTOIRE IMMÉDIATE !'; note=`${this.players[royals[0]].name} possède une Quinte Flush Royale.`; gameOver=true; }
    else {
      const other=1-ann, cmp=compareEval(evals[other],evals[ann]);
      if(cmp>0){ const pts=evals[other].points||0; this.players[other].score+=pts; deltas[other]=pts; const malus=evals[ann].points||0; this.players[ann].score-=malus; deltas[ann]=-malus; note=`${this.players[other].name} bat l'annonceur et marque ${pts} points. L'annonceur perd ${malus} points.`; }
      else if(cmp===0){ const pts=evals[ann].points||0; this.players[ann].score+=pts; this.players[other].score+=pts; deltas[ann]=pts; deltas[other]=pts; note=`Égalité parfaite : ${pts} points chacun.`; }
      else { const pts=evals[ann].points||0; this.players[ann].score+=pts; deltas[ann]=pts; note=`${this.players[ann].name} possède la meilleure main et marque ${pts} points.`; }
      const reached=this.players.map((p,i)=>p.score>=this.target?i:null).filter(i=>i!==null);
      if(reached.length){ title='Partie terminée !'; gameOver=true; }
    }
    this.roundResult={title,note,gameOver,reveal:this.revealHands(),deltas}; this.phase=gameOver?'game_over':'round_over'; this.broadcast(); if(!gameOver)this.scheduleNextRound();
  }
  endNull(reason){ this.roundResult={title:'Manche nulle',note:reason,gameOver:false,reveal:[],deltas:{}}; this.phase='round_over'; this.broadcast(); this.scheduleNextRound(); }
  scheduleNextRound(){ clearTimeout(this.roundTimer); this.roundTimer=setTimeout(()=>{ if(this.phase==='round_over'){ this.dealerIndex=1-this.dealerIndex; this.startRound(); } },45000); }
  nextRound(requester){ if(this.phase!=='round_over'||requester!==0)return false; clearTimeout(this.roundTimer); this.dealerIndex=1-this.dealerIndex; this.startRound(); return true; }
}

function contentType(file){
  const ext=path.extname(file).toLowerCase();
  return ({'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.wav':'audio/wav','.svg':'image/svg+xml'})[ext]||'application/octet-stream';
}
const server=http.createServer((req,res)=>{
  let urlPath=decodeURIComponent((req.url||'/').split('?')[0]); if(urlPath==='/')urlPath='/index.html';
  const file=path.normalize(path.join(PUBLIC_DIR,urlPath));
  if(!file.startsWith(PUBLIC_DIR)){res.writeHead(403);return res.end('Forbidden');}
  fs.stat(file,(err,st)=>{
    if(err||!st.isFile()){res.writeHead(404);return res.end('Not found');}
    res.writeHead(200,{'Content-Type':contentType(file),'Cache-Control':'no-store'}); fs.createReadStream(file).pipe(res);
  });
});

function attach(ws,room,idx){ ws.roomCode=room.code; ws.playerIndex=idx; ws.token=room.players[idx].token; room.players[idx].ws=ws; room.players[idx].connected=true; send(ws,{type:'joined',code:room.code,playerIndex:idx,token:ws.token}); room.broadcast(); }
function removeFromQueues(ws){ for(const q of quickQueues.values()){ const i=q.findIndex(x=>x.ws===ws); if(i>=0)q.splice(i,1); } }
function findRoom(code){ return rooms.get(String(code||'').toUpperCase()); }

function onConnection(ws){
  send(ws,{type:'hello',version:'0.28'});
  ws.on('message',raw=>{
    let m; try{m=JSON.parse(raw);}catch{return;}
    try{
      if(m.type==='create_room'){
        const code=roomCode(), room=new Room(code,Number(m.target)||500), token=id(); rooms.set(code,room); const idx=room.addPlayer(m,token,ws,0); attach(ws,room,idx); return;
      }
      if(m.type==='join_room'){
        const room=findRoom(m.code); if(!room)return send(ws,{type:'error',message:'Salon introuvable.'}); if(room.started)return send(ws,{type:'error',message:'La partie a déjà commencé.'}); if(room.players.every(Boolean))return send(ws,{type:'error',message:'Salon complet.'}); const token=id(); const idx=room.addPlayer(m,token,ws,1); attach(ws,room,idx); return;
      }
      if(m.type==='quick_match'){
        const target=Number(m.target)===1000?1000:500, key=String(target); const q=quickQueues.get(key)||[]; quickQueues.set(key,q);
        const waiting=q.shift();
        if(waiting&&waiting.ws.readyState===WebSocket.OPEN){
          const code=roomCode(), room=new Room(code,target); rooms.set(code,room);
          let idx=room.addPlayer(waiting.meta,id(),waiting.ws,0); attach(waiting.ws,room,idx);
          idx=room.addPlayer(m,id(),ws,1); attach(ws,room,idx); room.start();
        } else { q.push({ws,meta:m}); send(ws,{type:'queue',message:'Recherche d’un adversaire…'}); }
        return;
      }
      if(m.type==='reconnect'){
        const room=findRoom(m.code); if(!room)return send(ws,{type:'error',message:'Ancienne partie introuvable.'}); const idx=room.reconnect(String(m.token||''),ws); if(idx<0)return send(ws,{type:'error',message:'Session expirée.'}); attach(ws,room,idx); return;
      }
      const room=findRoom(ws.roomCode); const i=ws.playerIndex;
      if(!room||!Number.isInteger(i)||!room.players[i]||room.players[i].token!==ws.token) return send(ws,{type:'error',message:'Session invalide.'});
      const p=room.players[i];
      if(m.type==='start_game'){ if(i!==0)return; if(!room.start())send(ws,{type:'error',message:'Il faut deux joueurs.'}); return; }
      if(!room.started)return;
      if(m.type==='draw'){
        if(room.currentIndex!==i||room.phase!=='normal_draw')return; const c=room.rawDraw(i); if(!c)return; room.phase='normal_discard'; room.broadcastEvent('draw',`${p.name} pioche une carte.`,{actor:i}); return;
      }
      if(m.type==='discard'){
        if(room.currentIndex!==i)return;
        if(room.phase==='normal_discard'){
          const c=room.discard(i,String(m.cardId),true); if(!c)return;
          if(c.type==='normal')room.postDiscard(i); else if(!['chance','voleur','pecheur','bombe'].includes(c.bonus) && room.phase!=='post_discard')room.postDiscard(i);
          return;
        }
        if(room.phase==='chance_discard'){
          const c=room.discard(i,String(m.cardId),false); if(!c)return; room.postDiscard(i); return;
        }
        if(room.phase==='pecheur_discard'){
          const c=room.discard(i,String(m.cardId),false); if(!c)return; room.pecheurRemaining=Math.max(0,room.pecheurRemaining-1);
          if(room.pecheurRemaining===0)room.postDiscard(i); else room.broadcastEvent('pecheur',`${p.name} défausse une carte face cachée (${3-room.pecheurRemaining}/3).`,{actor:i});
          return;
        }
        if(room.phase==='final_discard'){ room.finalDiscard(i,String(m.cardId)); return; }
      }
      if(m.type==='voleur_pick'){
        if(room.phase!=='voleur_pick'||!room.pendingVoleur||room.pendingVoleur.actor!==i)return; const target=room.pendingVoleur.target, tp=room.players[target]; const idx=Math.max(0,Math.min(tp.hand.length-1,Number(m.index)||0)); if(!tp.hand.length)return;
        const [stolen]=tp.hand.splice(idx,1); p.hand.push(stolen); room.pendingVoleur.stage='give'; room.phase='voleur_give'; room.broadcastEvent('voleur',`${p.name} prend une carte face cachée à ${tp.name}.`,{actor:i,target}); return;
      }
      if(m.type==='voleur_give'){
        if(room.phase!=='voleur_give'||!room.pendingVoleur||room.pendingVoleur.actor!==i)return; const target=room.pendingVoleur.target; const idx=p.hand.findIndex(c=>c.id===String(m.cardId)); if(idx<0)return; const [give]=p.hand.splice(idx,1); room.players[target].hand.push(give); room.pendingVoleur=null; room.phase='post_discard'; room.broadcastEvent('voleur',`${p.name} rend une carte face cachée à ${room.players[target].name}.`,{actor:i,target}); return;
      }
      if(m.type==='bombe_target'){
        if(room.phase!=='bombe_target'||room.currentIndex!==i)return; const target=Number(m.target)===i?i:1-i; const tp=room.players[target]; room.discardPile.push(...tp.hand.splice(0)); for(let n=0;n<5;n++){ if(!room.rawDraw(target))break; } room.phase='post_discard'; room.broadcastEvent('bombe',`${tp.name} refait entièrement sa main.`,{actor:i,target}); return;
      }
      if(m.type==='announce_pok'){ room.announcePok(i); return; }
      if(m.type==='end_turn'){ room.endTurn(i); return; }
      if(m.type==='final_keep'){ room.finalKeep(i); return; }
      if(m.type==='final_draw'){ room.finalDraw(i); return; }
      if(m.type==='next_round'){ room.nextRound(i); return; }
      if(m.type==='reaction'){ room.broadcastEvent('reaction',`${p.name} réagit ${String(m.emoji||'😊').slice(0,4)}`,{actor:i,emoji:String(m.emoji||'😊').slice(0,4)}); return; }
    }catch(err){ console.error(err); send(ws,{type:'error',message:'Erreur serveur : '+err.message}); }
  });
  ws.on('close',()=>{
    removeFromQueues(ws);
    const room=findRoom(ws.roomCode); if(!room)return; const i=ws.playerIndex, p=room.players[i]; if(p&&p.ws===ws){ p.connected=false; p.disconnectAt=now(); room.broadcastEvent('disconnect',`${p.name} est déconnecté. Il a 60 secondes pour revenir.`,{target:i}); setTimeout(()=>{ if(!p.connected&&p.disconnectAt&&now()-p.disconnectAt>=RECONNECT_GRACE_MS){ room.broadcastEvent('disconnect',`${p.name} n'est pas revenu. La partie reste en pause dans ce prototype.`,{target:i}); } },RECONNECT_GRACE_MS+100); }
  });
}

server.on('upgrade',(req,socket,head)=>{
  const key=req.headers['sec-websocket-key'];
  if(!key){ socket.destroy(); return; }
  const accept=crypto.createHash('sha1').update(key+'258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: '+accept+'\r\n\r\n');
  const ws=new RawWS(socket); if(head&&head.length)ws._feed(head); onConnection(ws);
});

setInterval(()=>{
  const cutoff=now()-ROOM_TTL_MS;
  for(const [code,r] of rooms) if(r.updatedAt<cutoff && r.players.every(p=>!p?.connected)){ clearTimeout(r.roundTimer); rooms.delete(code); }
},60000).unref();

server.listen(PORT,()=>console.log(`POK POK Online v0.28 sur http://localhost:${PORT}`));
