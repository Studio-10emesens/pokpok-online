'use strict';
const $=id=>document.getElementById(id);
const ANIMALS=[['duck','🦆','Canard'],['dog','🐶','Chien'],['otter','🦦','Loutre'],['cat','🐱','Chat'],['fox','🦊','Renard'],['panda','🐼','Panda'],['frog','🐸','Grenouille'],['owl','🦉','Hibou'],['raccoon','🦝','Raton laveur'],['rabbit','🐰','Lapin'],['koala','🐨','Koala'],['monkey','🐵','Singe'],['lion','🦁','Lion'],['tiger','🐯','Tigre'],['bear','🐻','Ours'],['pig','🐷','Cochon'],['cow','🐮','Vache'],['penguin','🐧','Pingouin']];
const ANIMAL=Object.fromEntries(ANIMALS.map(x=>[x[0],x]));
const BONUS_IMG={chance:'bonus_chance.jpg',blocage:'bonus_blocage.jpg',voleur:'bonus_voleur.jpg',pecheur:'bonus_pecheur.jpg',bombe:'bonus_bombe.jpg'};
let ws=null,snapshot=null,selectedCard=null,rulePage=1,musicMode='menu',musicOn=true,lastBurstId=null;

ANIMALS.forEach(([id,emoji,label])=>{const o=document.createElement('option');o.value=id;o.textContent=`${emoji} ${label}`;$('avatarInput').appendChild(o)});$('avatarInput').value='fox';
const savedName=localStorage.getItem('pokpok_name'); if(savedName)$('nameInput').value=savedName;
const savedAvatar=localStorage.getItem('pokpok_avatar'); if(savedAvatar)$('avatarInput').value=savedAvatar;

function toast(msg){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2200)}
function socketUrl(){return `${location.protocol==='https:'?'wss':'ws'}://${location.host}`}
function connect(){
  if(ws&&ws.readyState<=1)return;
  ws=new WebSocket(socketUrl());
  ws.onopen=()=>{const c=localStorage.getItem('pokpok_room'),t=localStorage.getItem('pokpok_token'); if(c&&t) send({type:'reconnect',code:c,token:t});};
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return} ; handle(m)};
  ws.onclose=()=>{if(snapshot?.started){$('connectionBanner').textContent='Connexion perdue — tentative de reconnexion…';$('connectionBanner').classList.remove('hidden')} setTimeout(connect,1300)};
}
function send(o){if(ws?.readyState===1)ws.send(JSON.stringify(o));else toast('Connexion en cours…')}
function meMeta(){const name=$('nameInput').value.trim()||'Joueur',avatar=$('avatarInput').value,target=Number($('targetInput').value);localStorage.setItem('pokpok_name',name);localStorage.setItem('pokpok_avatar',avatar);return{name,avatar,target}}
function handle(m){
  if(m.type==='error'){toast(m.message);return}
  if(m.type==='queue'){$('queueBox').textContent=m.message;$('queueBox').classList.remove('hidden');return}
  if(m.type==='joined'){localStorage.setItem('pokpok_room',m.code);localStorage.setItem('pokpok_token',m.token);$('roomCodeLabel').textContent=m.code;$('roomBox').classList.remove('hidden');$('queueBox').classList.add('hidden');return}
  if(m.type==='snapshot'){snapshot=m.state;$('connectionBanner').classList.add('hidden');render(); if(snapshot.lastEvent&&snapshot.lastEvent.id!==lastBurstId){lastBurstId=snapshot.lastEvent.id;showBurst(snapshot.lastEvent)}}
}
function switchScreen(game){$('lobby').classList.toggle('active',!game);$('game').classList.toggle('active',game);setMusicMode(game?'game':'menu')}
function setMusicMode(mode){musicMode=mode;syncMusic()}
function syncMusic(){const a=$('menuMusic'),b=$('gameMusic');if(!musicOn){a.pause();b.pause();return}const play=musicMode==='menu'?a:b,stop=musicMode==='menu'?b:a;stop.pause();play.volume=musicMode==='menu'?.24:.34;play.play().catch(()=>{})}
$('musicBtn').onclick=()=>{musicOn=!musicOn;$('musicBtn').textContent=`♫ Musique : ${musicOn?'ON':'OFF'}`;syncMusic()};document.addEventListener('pointerdown',()=>syncMusic(),{once:true});

$('quickBtn').onclick=()=>{connect();send({type:'quick_match',...meMeta()})};
$('createBtn').onclick=()=>{connect();send({type:'create_room',...meMeta()})};
$('joinBtn').onclick=()=>{connect();send({type:'join_room',code:$('roomCodeInput').value.toUpperCase(),...meMeta()})};
$('startOnlineBtn').onclick=()=>send({type:'start_game'});
$('nextRoundBtn').onclick=()=>send({type:'next_round'});

document.querySelectorAll('.reactions button').forEach(b=>b.onclick=()=>send({type:'reaction',emoji:b.dataset.emoji}));

function render(){
  if(!snapshot)return;
  const me=snapshot.players[snapshot.meIndex],opp=snapshot.players[1-snapshot.meIndex];
  if(!snapshot.started){switchScreen(false);$('roomPlayers').textContent=opp?`${me.name} + ${opp.name} — prêts.`:`${me.name} — en attente du deuxième joueur…`;$('startOnlineBtn').classList.toggle('hidden',!snapshot.canStart);return}
  switchScreen(true);
  $('meName').textContent=me.name;$('oppName').textContent=opp?.name||'Adversaire';$('meAvatar').textContent=ANIMAL[me.avatar]?.[1]||'🦆';$('oppAvatar').textContent=ANIMAL[opp?.avatar]?.[1]||'🦆';
  $('meScore').textContent=`${me.score} pts`;$('oppScore').textContent=`${opp?.score||0} pts`;$('drawCount').textContent=snapshot.drawCount;$('discardCount').textContent=snapshot.discardCount;
  $('meDealer').classList.toggle('hidden',snapshot.dealerIndex!==snapshot.meIndex);$('oppDealer').classList.toggle('hidden',snapshot.dealerIndex===snapshot.meIndex);
  $('oppStatus').textContent=opp?.connected?'Connecté':'Déconnecté';$('humanSeat').classList.toggle('active-turn',snapshot.currentIndex===snapshot.meIndex);$('opponentSeat').classList.toggle('active-turn',snapshot.currentIndex!==snapshot.meIndex);
  renderOpponent(opp);renderHand(me);renderCenter(me,opp);renderActions(me,opp);renderResult();
}
function renderOpponent(opp){const h=$('oppHand');h.innerHTML='';for(let i=0;i<(opp?.handCount||0);i++){const img=document.createElement('img');img.src='assets/card_back.jpg';img.alt='Carte cachée';if(snapshot.phase==='voleur_pick'&&snapshot.currentIndex===snapshot.meIndex){img.style.cursor='pointer';img.onclick=()=>send({type:'voleur_pick',index:i})}h.appendChild(img)}}
function imgFor(c){return c.type==='bonus'?`assets/cards/${BONUS_IMG[c.bonus]}`:`assets/cards/${c.id}.jpg`}
function renderHand(me){const h=$('humanHand');h.innerHTML='';const cards=me.hand||[];cards.forEach((c,i)=>{const b=document.createElement('button');b.className='hand-card';if(selectedCard===c.id)b.classList.add('selected');b.style.transform=`rotate(${(i-(cards.length-1)/2)*2.1}deg)`;const img=document.createElement('img');img.src=imgFor(c);img.alt=c.id;b.appendChild(img);b.onclick=()=>{selectedCard=selectedCard===c.id?null:c.id;renderActions(me,snapshot.players[1-snapshot.meIndex]);renderHand(me)};h.appendChild(b)});$('handEval').textContent=me.eval?.name||'-'}
function renderCenter(me,opp){let title=snapshot.currentIndex===snapshot.meIndex?'À vous de jouer':`Tour de ${opp?.name||'adversaire'}`,hint='';const ph=snapshot.phase;if(ph==='normal_draw')hint=snapshot.currentIndex===snapshot.meIndex?'Piochez une carte.':'Pioche…';else if(ph==='normal_discard')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez une carte à défausser.':'Choisit sa défausse…';else if(ph==='post_discard')hint=snapshot.currentIndex===snapshot.meIndex?'Annoncez Pok Pok ou terminez votre tour.':'Réfléchit à Pok Pok…';else if(ph==='chance_discard')hint='Bonus Chance : défaussez une carte.';else if(ph==='pecheur_discard')hint=`Bonus Pêcheur : encore ${snapshot.pecheurRemaining} carte(s) à défausser.`;else if(ph==='voleur_pick')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez une carte cachée chez votre adversaire.':'Vole une carte…';else if(ph==='voleur_give')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez la carte que vous rendez.':'Rend une carte…';else if(ph==='bombe_target')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez qui refait sa main.':'Choisit la cible de la Bombe…';else if(ph==='final_choice'){title=snapshot.finalCurrent===snapshot.meIndex?'Votre dernier tour':'Dernier tour adverse';hint='Conserver la main ou piocher une fois.'}else if(ph==='final_discard')hint='Dernier tour : défaussez une carte.';else if(ph==='blocked_pause')hint='Tour passé.';$('turnTitle').textContent=title;$('turnHint').textContent=hint;$('eventLine').textContent=snapshot.lastEvent?.text||''}
function actionButton(text,cls,fn){const b=document.createElement('button');b.textContent=text;b.className=cls||'';b.onclick=fn;return b}
function renderActions(me){const a=$('actions');a.innerHTML='';const mine=snapshot.currentIndex===snapshot.meIndex;if(!mine)return;const ph=snapshot.phase;
  if(ph==='normal_draw')a.appendChild(actionButton('Piocher une carte','primary-action',()=>send({type:'draw'})));
  else if(['normal_discard','chance_discard','pecheur_discard','final_discard'].includes(ph)){const b=actionButton(ph==='final_discard'?'Défausser la carte':'Défausser la carte','primary-action',()=>selectedCard&&send({type:'discard',cardId:selectedCard}));b.disabled=!selectedCard;a.appendChild(b)}
  else if(ph==='post_discard'){a.appendChild(actionButton('POK POK !','pok',()=>send({type:'announce_pok'})));a.appendChild(actionButton('Finir mon tour','',()=>send({type:'end_turn'})))}
  else if(ph==='voleur_give'){const b=actionButton('Rendre cette carte','primary-action',()=>selectedCard&&send({type:'voleur_give',cardId:selectedCard}));b.disabled=!selectedCard;a.appendChild(b)}
  else if(ph==='bombe_target'){a.appendChild(actionButton('💣 Sur moi','',()=>send({type:'bombe_target',target:snapshot.meIndex})));a.appendChild(actionButton('💣 Sur l’adversaire','primary-action',()=>send({type:'bombe_target',target:1-snapshot.meIndex})))}
  else if(ph==='final_choice'){a.appendChild(actionButton('Conserver','',()=>send({type:'final_keep'})));a.appendChild(actionButton('Piocher puis défausser','primary-action',()=>send({type:'final_draw'})))}
}
function showBurst(ev){if(!ev||['draw','discard'].includes(ev.kind))return;const box=$('eventBurst');const title={pokpok:'✨ POK POK ! ✨',chance:'🍀 CHANCE !',blocage:'🚫 BLOCAGE !',voleur:'🦝 VOLEUR !',pecheur:'🐟 PÊCHEUR !',bombe:'💥 BOMBE !',deal:'🃏 DISTRIBUTION',reaction:ev.emoji||'😊',disconnect:'⚠ CONNEXION'}[ev.kind]||'POK POK';$('eventBurstTitle').textContent=title;$('eventBurstText').textContent=ev.text;box.classList.remove('hidden');setTimeout(()=>box.classList.add('hidden'),ev.kind==='pokpok'?2200:1500)}
function renderResult(){const m=$('roundModal'),r=snapshot.roundResult;if(!r){m.classList.add('hidden');return}m.classList.remove('hidden');$('resultTitle').textContent=r.title;$('resultNote').textContent=r.note;const wrap=$('resultHands');wrap.innerHTML='';(r.reveal||[]).forEach(x=>{const d=document.createElement('div');d.className='result-player';d.innerHTML=`<h3>${x.name}</h3><div>${x.eval.name} • ${x.eval.points} pts</div><div class="cards">${x.hand.map(c=>`<img src="${imgFor(c)}">`).join('')}</div><b>Total : ${x.score}</b>`;wrap.appendChild(d)});$('nextRoundBtn').classList.toggle('hidden',snapshot.meIndex!==0||r.gameOver)}

$('rulesBtn').onclick=()=>{$('rulesModal').classList.remove('hidden')};$('closeRules').onclick=()=>$('rulesModal').classList.add('hidden');function renderRule(){$('rulePage').src=`assets/rules/page-${String(rulePage).padStart(2,'0')}.jpg`;$('ruleCounter').textContent=`${rulePage} / 16`}$('prevRule').onclick=()=>{rulePage=rulePage<=1?16:rulePage-1;renderRule()};$('nextRule').onclick=()=>{rulePage=rulePage>=16?1:rulePage+1;renderRule()};
connect();syncMusic();
