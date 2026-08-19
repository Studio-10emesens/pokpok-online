'use strict';
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pokpok-v029-'));
const server=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:'18081',POKPOK_DATA_DIR:dataDir}});
server.stdout.on('data',d=>process.stdout.write(String(d)));server.stderr.on('data',d=>process.stderr.write(String(d)));
function wait(ms){return new Promise(r=>setTimeout(r,ms))}
function open(){return new Promise((resolve,reject)=>{const w=new WebSocket('ws://127.0.0.1:18081');w.addEventListener('open',()=>resolve(w),{once:true});w.addEventListener('error',reject,{once:true})})}
function next(w,pred,timeout=4000){return new Promise((resolve,reject)=>{const t=setTimeout(()=>{w.removeEventListener('message',on);reject(new Error('timeout'))},timeout);function on(ev){let m;try{m=JSON.parse(ev.data)}catch{return}if(pred(m)){clearTimeout(t);w.removeEventListener('message',on);resolve(m)}}w.addEventListener('message',on)})}
async function reg(w,name){w.send(JSON.stringify({type:'register',username:name,secret:'1234',avatar:'duck'}));const a=await next(w,m=>m.type==='account');if(a.profile.rubies!==50)throw new Error('Un nouveau compte doit commencer à 50 rubis');return a}
(async()=>{try{
  await wait(300);const a=await open(),b=await open(),c=await open(),d=await open();await Promise.all([reg(a,'Alice29'),reg(b,'Bob29'),reg(c,'Chloe29'),reg(d,'Dany29')]);
  d.send(JSON.stringify({type:'quick_match',tier:'legende',capacity:2,target:500}));const insufficient=await next(d,m=>m.type==='error');if(!/100/.test(insufficient.message))throw new Error('Le salon Légende doit demander 100 rubis');
  [a,b,c].forEach(w=>w.send(JSON.stringify({type:'quick_match',tier:'debutant',capacity:3,target:500})));
  const [sa,sb,sc]=await Promise.all([a,b,c].map(w=>next(w,m=>m.type==='snapshot'&&m.state.started&&m.state.capacity===3)));
  for(const s of [sa,sb,sc]){
    if(s.state.pot!==30)throw new Error('Pot 3 joueurs Débutant incorrect');
    if(s.state.walletRubies!==40)throw new Error('La mise de 10 rubis doit être débitée');
    const me=s.state.meIndex;if(s.state.players[me].hand.length!==5)throw new Error('Distribution 5 cartes incorrecte');
    s.state.players.forEach((p,i)=>{if(i!==me&&p.hand!==undefined)throw new Error('Fuite de main adverse')});
  }
  const states=[sa.state,sb.state,sc.state],current=states[0].currentIndex;let cw=null;for(let i=0;i<3;i++)if(states[i].meIndex===current)cw=[a,b,c][i];if(!cw)throw new Error('Joueur courant introuvable');cw.send(JSON.stringify({type:'draw'}));const sd=await next(cw,m=>m.type==='snapshot'&&m.state.phase==='normal_discard');if(sd.state.players[sd.state.meIndex].hand.length!==6)throw new Error('La pioche doit donner 6 cartes');
  console.log('OK V0.29 : comptes, 50 rubis, contrôle des mises, matchmaking 3 joueurs, pot, confidentialité et pioche synchronisée.');
  [a,b,c,d].forEach(w=>w.close());process.exitCode=0;
}catch(e){console.error('ECHEC:',e);process.exitCode=1}finally{server.kill();setTimeout(()=>{try{fs.rmSync(dataDir,{recursive:true,force:true})}catch{}},100)}})();
