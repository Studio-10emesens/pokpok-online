'use strict';
const {spawn}=require('child_process');
const fs=require('fs');
const path=require('path');
const os=require('os');
const dataDir=fs.mkdtempSync(path.join(os.tmpdir(),'pokpok-v033-'));
const server=spawn(process.execPath,['server.js'],{cwd:__dirname,env:{...process.env,PORT:'18082',POKPOK_DATA_DIR:dataDir}});
server.stdout.on('data',d=>process.stdout.write(String(d)));server.stderr.on('data',d=>process.stderr.write(String(d)));
function wait(ms){return new Promise(r=>setTimeout(r,ms))}
function open(){return new Promise((resolve,reject)=>{const w=new WebSocket('ws://127.0.0.1:18082');w.addEventListener('open',()=>resolve(w),{once:true});w.addEventListener('error',reject,{once:true})})}
function next(w,pred,timeout=5000){return new Promise((resolve,reject)=>{const t=setTimeout(()=>{w.removeEventListener('message',on);reject(new Error('timeout'))},timeout);function on(ev){let m;try{m=JSON.parse(ev.data)}catch{return}if(pred(m)){clearTimeout(t);w.removeEventListener('message',on);resolve(m)}}w.addEventListener('message',on)})}
async function reg(w,name){w.send(JSON.stringify({type:'register',username:name,secret:'1234',avatar:'duck'}));const a=await next(w,m=>m.type==='account');if(a.profile.rubies!==50)throw new Error('Un nouveau compte doit commencer à 50 rubis');return a}
(async()=>{const sockets=[];try{
  await wait(350);const a=await open(),b=await open(),c=await open(),d=await open();sockets.push(a,b,c,d);await Promise.all([reg(a,'Alice32'),reg(b,'Bob32'),reg(c,'Chloe32'),reg(d,'Dany32')]);
  d.send(JSON.stringify({type:'quick_match',tier:'legende',capacity:2,target:500}));const insufficient=await next(d,m=>m.type==='error');if(!/100/.test(insufficient.message))throw new Error('Le salon Légende doit demander 100 rubis');
  d.send(JSON.stringify({type:'spin_wheel'}));const wheel=await next(d,m=>m.type==='wheel_result');if(![10,20,40,50,80,100].includes(wheel.reward))throw new Error('Récompense roulette invalide');d.send(JSON.stringify({type:'spin_wheel'}));const wheelAgain=await next(d,m=>m.type==='error');if(!/déjà|jour/i.test(wheelAgain.message))throw new Error('La roulette doit être limitée à une fois par jour');
  [a,b,c].forEach(w=>w.send(JSON.stringify({type:'quick_match',tier:'debutant',capacity:3,target:500})));
  const [sa,sb,sc]=await Promise.all([a,b,c].map(w=>next(w,m=>m.type==='snapshot'&&m.state.started&&m.state.capacity===3)));
  for(const s of [sa,sb,sc]){
    if(s.state.pot!==30)throw new Error('Pot 3 joueurs Débutant incorrect');
    if(s.state.walletRubies!==40)throw new Error('La mise de 10 rubis doit être débitée');
    if(s.state.turnDeadline-s.state.turnClockStart!==45000)throw new Error('Le chrono de tour doit durer 45 secondes');
    const me=s.state.meIndex;if(s.state.players[me].hand.length!==5)throw new Error('Distribution 5 cartes incorrecte');
    s.state.players.forEach((p,i)=>{if(i!==me&&p.hand!==undefined)throw new Error('Fuite de main adverse')});
  }
  const states=[sa.state,sb.state,sc.state],current=states[0].currentIndex;let cw=null;for(let i=0;i<3;i++)if(states[i].meIndex===current)cw=[a,b,c][i];if(!cw)throw new Error('Joueur courant introuvable');cw.send(JSON.stringify({type:'draw'}));const sd=await next(cw,m=>m.type==='snapshot'&&m.state.phase==='normal_discard');if(sd.state.players[sd.state.meIndex].hand.length!==6)throw new Error('La pioche doit donner 6 cartes');
  const six=[d];for(let n=0;n<5;n++){const w=await open();sockets.push(w);await reg(w,`Six32_${n}`);six.push(w)}
  six.forEach(w=>w.send(JSON.stringify({type:'quick_match',tier:'debutant',capacity:6,target:500})));
  const sixStates=await Promise.all(six.map(w=>next(w,m=>m.type==='snapshot'&&m.state.started&&m.state.capacity===6)));
  if(sixStates.some(s=>s.state.pot!==60))throw new Error('Pot 6 joueurs incorrect');
  console.log("OK V0.33 : 50 rubis à l'inscription, roulette 10-100 (moyenne 50), mises, matchmaking 3/6, pot, confidentialité, chrono 45 s et pioche synchronisée.");
  process.exitCode=0;
}catch(e){console.error('ECHEC:',e);process.exitCode=1}finally{sockets.forEach(w=>{try{w.close()}catch{}});server.kill();setTimeout(()=>{try{fs.rmSync(dataDir,{recursive:true,force:true})}catch{}},150)}})();
