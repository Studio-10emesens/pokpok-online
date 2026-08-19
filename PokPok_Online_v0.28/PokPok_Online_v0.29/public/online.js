'use strict';
const $=id=>document.getElementById(id);
const ANIMAL={duck:['Canard','🦆'],dog:['Chien','🐶'],otter:['Loutre','🦦'],cat:['Chat','🐱'],fox:['Renard','🦊'],panda:['Panda','🐼'],frog:['Grenouille','🐸'],owl:['Hibou','🦉'],raccoon:['Raton laveur','🦝'],rabbit:['Lapin','🐰'],koala:['Koala','🐨'],monkey:['Singe','🐵'],lion:['Lion','🦁'],tiger:['Tigre','🐯'],bear:['Ours','🐻'],pig:['Cochon','🐷'],cow:['Vache','🐮'],penguin:['Pingouin','🐧']};
const BONUS_IMG={chance:'bonus_chance.jpg',blocage:'bonus_blocage.jpg',voleur:'bonus_voleur.jpg',pecheur:'bonus_pecheur.jpg',bombe:'bonus_bombe.jpg'};
const TIER_STAKE={debutant:10,intermediaire:20,expert:50,legende:100};
let ws=null,snapshot=null,prevSnapshot=null,account=null,selectedCard=null,selectedTier='debutant',lastEventId=null,rulePage=1,musicOn=true,musicMode='menu',authMode='login',reconnectAttempted=false,eventBusy=false;

function fillAvatars(select){select.innerHTML=Object.entries(ANIMAL).map(([k,v])=>`<option value="${k}">${v[1]} ${v[0]}</option>`).join('')}
fillAvatars($('registerAvatar'));fillAvatars($('avatarInput'));$('registerAvatar').value='duck';$('avatarInput').value='duck';

function toast(msg,ms=2300){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.add('hidden'),ms)}
function socketUrl(){return `${location.protocol==='https:'?'wss':'ws'}://${location.host}`}
function send(o){if(ws?.readyState===1)ws.send(JSON.stringify(o));else toast('Connexion en cours…')}
function connect(){
  if(ws&&ws.readyState<=1)return;reconnectAttempted=false;ws=new WebSocket(socketUrl());
  ws.onopen=()=>{const s=localStorage.getItem('pokpok_session_v029');if(s)send({type:'resume_account',sessionToken:s});};
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handle(m)};
  ws.onclose=()=>{if(snapshot?.started){$('connectionBanner').textContent='Connexion perdue — tentative de reconnexion…';$('connectionBanner').classList.remove('hidden')}setTimeout(connect,1300)};
}
function handle(m){
  if(m.type==='error'){toast(m.message);return}
  if(m.type==='auth_required'){account=null;showAuth();return}
  if(m.type==='logged_out'){account=null;localStorage.removeItem('pokpok_session_v029');showAuth();return}
  if(m.type==='account'){
    account=m.profile;localStorage.setItem('pokpok_session_v029',m.sessionToken);showPlay();updateAccountUI();
    const c=localStorage.getItem('pokpok_room_v029'),t=localStorage.getItem('pokpok_room_token_v029');if(c&&t&&!reconnectAttempted){reconnectAttempted=true;send({type:'reconnect',code:c,token:t})}return;
  }
  if(m.type==='queue'){$('queueText').textContent=`${m.message} — ${m.waiting}/${m.needed}`;$('queueBox').classList.remove('hidden');$('roomBox').classList.add('hidden');return}
  if(m.type==='queue_cancelled'){$('queueBox').classList.add('hidden');return}
  if(m.type==='joined'){localStorage.setItem('pokpok_room_v029',m.code);localStorage.setItem('pokpok_room_token_v029',m.token);$('roomCodeLabel').textContent=m.code;$('queueBox').classList.add('hidden');$('roomBox').classList.remove('hidden');return}
  if(m.type==='snapshot'){
    prevSnapshot=snapshot;snapshot=m.state;$('connectionBanner').classList.add('hidden');if(account&&Number.isFinite(snapshot.walletRubies)){account.rubies=snapshot.walletRubies;updateAccountUI()}
    render();if(snapshot.lastEvent&&snapshot.lastEvent.id!==lastEventId){lastEventId=snapshot.lastEvent.id;playEvent(snapshot.lastEvent,prevSnapshot,snapshot)}return;
  }
}

function showAuth(){$('authCard').classList.remove('hidden');$('playCard').classList.add('hidden');$('walletTop').classList.add('hidden');switchScreen(false)}
function showPlay(){$('authCard').classList.add('hidden');$('playCard').classList.remove('hidden');$('walletTop').classList.remove('hidden');switchScreen(false)}
function updateAccountUI(){if(!account)return;$('profileName').textContent=account.displayName;$('rubiesValue').textContent=account.rubies;$('walletTopValue').textContent=account.rubies;$('dailyBtn').disabled=!account.dailyAvailable;$('dailyBtn').textContent=account.dailyAvailable?'🎁 +50 rubis du jour':'✓ Rubis du jour récupérés';$('avatarInput').value=account.avatar||'duck';document.querySelectorAll('.tier').forEach(b=>b.classList.toggle('locked',account.rubies<TIER_STAKE[b.dataset.tier]));updatePotPreview()}
function updatePotPreview(){const n=Number($('playersInput').value)||2,stake=TIER_STAKE[selectedTier];$('stakePreview').textContent=stake;$('potPreview').textContent=stake*n}

$('loginTab').onclick=()=>setAuthMode('login');$('registerTab').onclick=()=>setAuthMode('register');
function setAuthMode(mode){authMode=mode;$('loginTab').classList.toggle('active',mode==='login');$('registerTab').classList.toggle('active',mode==='register');$('registerAvatarLabel').classList.toggle('hidden',mode!=='register');$('authSubmit').textContent=mode==='login'?'Se connecter':'Créer le compte + 50 💎'}
$('authSubmit').onclick=()=>{const username=$('authUser').value.trim(),secret=$('authSecret').value;if(!username||secret.length<4)return toast('Entre un identifiant et un mot de passe / PIN de 4 caractères minimum.');send({type:authMode,username,secret,avatar:$('registerAvatar').value})};
$('logoutBtn').onclick=()=>{localStorage.removeItem('pokpok_room_v029');localStorage.removeItem('pokpok_room_token_v029');snapshot=null;send({type:'logout'})};
$('dailyBtn').onclick=()=>send({type:'claim_daily'});
$('avatarInput').onchange=()=>send({type:'set_avatar',avatar:$('avatarInput').value});
$('playersInput').onchange=updatePotPreview;
document.querySelectorAll('.tier').forEach(b=>b.onclick=()=>{selectedTier=b.dataset.tier;document.querySelectorAll('.tier').forEach(x=>x.classList.toggle('active',x===b));updatePotPreview()});
function matchMeta(){return{tier:selectedTier,capacity:Number($('playersInput').value),target:Number($('targetInput').value)}}
$('quickBtn').onclick=()=>send({type:'quick_match',...matchMeta()});$('createBtn').onclick=()=>send({type:'create_room',...matchMeta()});$('joinBtn').onclick=()=>send({type:'join_room',code:$('roomCodeInput').value.toUpperCase()});$('cancelQueueBtn').onclick=()=>send({type:'cancel_queue'});$('startOnlineBtn').onclick=()=>send({type:'start_game'});

document.querySelectorAll('.reactions button').forEach(b=>b.onclick=()=>send({type:'reaction',emoji:b.dataset.emoji}));

function switchScreen(game){$('lobby').classList.toggle('active',!game);$('game').classList.toggle('active',game);setMusicMode(game?'game':'menu')}
function setMusicMode(mode){musicMode=mode;syncMusic()}
function syncMusic(){const a=$('menuMusic'),b=$('gameMusic');if(!musicOn){a.pause();b.pause();return}const play=musicMode==='menu'?a:b,stop=musicMode==='menu'?b:a;stop.pause();play.volume=musicMode==='menu'?.16:.32;play.play().catch(()=>{})}
$('musicBtn').onclick=()=>{musicOn=!musicOn;$('musicBtn').textContent=`♫ Musique : ${musicOn?'ON':'OFF'}`;syncMusic()};document.addEventListener('pointerdown',()=>syncMusic(),{once:true});

function render(){
  if(!snapshot)return;
  if(!snapshot.started){switchScreen(false);renderLobbyRoom();return}
  switchScreen(true);const me=snapshot.players[snapshot.meIndex];$('arena').dataset.playerCount=String(snapshot.capacity);$('meName').textContent=me.name;$('meAvatar').textContent=ANIMAL[me.avatar]?.[1]||'🦆';$('meScore').textContent=`${me.score} pts`;$('drawCount').textContent=snapshot.drawCount;$('discardCount').textContent=snapshot.discardCount;$('meDealer').classList.toggle('hidden',snapshot.dealerIndex!==snapshot.meIndex);$('meBlocked').classList.toggle('hidden',!me.blocked);$('potInGame').textContent=`💎 Pot : ${snapshot.pot}`;$('roundInfo').textContent=`Manche ${snapshot.round} • ${snapshot.tierLabel} • objectif ${snapshot.target}`;
  $('humanSeat').classList.toggle('active-turn',snapshot.currentIndex===snapshot.meIndex);renderOpponents();renderHand(me);renderCenter();renderActions(me);renderTargets();renderResult();
}
function renderLobbyRoom(){
  $('roomBox').classList.remove('hidden');$('roomCodeLabel').textContent=snapshot.code;$('roomMeta').textContent=`${snapshot.tierLabel} • ${snapshot.stake} 💎 par joueur • ${snapshot.capacity} joueurs • pot ${snapshot.stake*snapshot.capacity} 💎 • objectif ${snapshot.target}`;
  const wrap=$('roomPlayers');wrap.innerHTML='';snapshot.players.forEach((p,i)=>{const d=document.createElement('div');d.className=`room-player${p&&!p.connected?' off':''}`;d.textContent=p?`${ANIMAL[p.avatar]?.[1]||'🦆'} ${p.name}${i===snapshot.meIndex?' (vous)':''}`:'… place libre';wrap.appendChild(d)});$('startOnlineBtn').classList.toggle('hidden',!snapshot.canStart);$('startOnlineBtn').textContent=`Lancer la partie • pot ${snapshot.stake*snapshot.capacity} 💎`;
}
function opponentIndices(){const out=[];for(let k=1;k<snapshot.players.length;k++){const i=(snapshot.meIndex+k)%snapshot.players.length;if(snapshot.players[i])out.push(i)}return out}
function posClasses(n){if(n===1)return['pos-top'];if(n===2)return['pos-left-top','pos-right-top'];if(n===3)return['pos-top','pos-left-mid','pos-right-mid'];if(n===4)return['pos-left-top','pos-right-top','pos-left-mid','pos-right-mid'];return['pos-top','pos-left-top','pos-right-top','pos-left-mid','pos-right-mid']}
function renderOpponents(){const wrap=$('opponents');wrap.innerHTML='';const idxs=opponentIndices(),pos=posClasses(idxs.length);idxs.forEach((idx,k)=>{const p=snapshot.players[idx],s=document.createElement('section');s.id=`seat-player-${idx}`;s.className=`seat opponent-seat ${pos[k]||'pos-top'}`;if(snapshot.currentIndex===idx)s.classList.add('active-turn');if(snapshot.validTargets?.includes(idx))s.classList.add('targetable');s.innerHTML=`<div class="seat-head"><span class="avatar">${ANIMAL[p.avatar]?.[1]||'🦆'}</span><div><b>${escapeHtml(p.name)}</b><small>${p.connected?'Connecté':'Déconnecté'}</small></div><span class="badge ${p.blocked?'danger':'hidden'}">${p.blocked?'BLOQUÉ':''}</span><span class="badge ${snapshot.dealerIndex===idx?'':'hidden'}">DONNEUR</span></div><div class="mini-hand"></div><div class="score-plate">${p.score} pts</div>`;
    if(snapshot.validTargets?.includes(idx))s.onclick=e=>{if(!e.target.classList.contains('stealable'))send({type:'bonus_target',target:idx})};const h=s.querySelector('.mini-hand');for(let c=0;c<p.handCount;c++){const img=document.createElement('img');img.src='assets/card_back.jpg';img.className='mini-card';img.alt='Carte cachée';if(snapshot.phase==='voleur_pick'&&snapshot.currentIndex===snapshot.meIndex&&snapshot.pendingVoleur?.target===idx){img.classList.add('stealable');img.onclick=e=>{e.stopPropagation();send({type:'voleur_pick',index:c})}}h.appendChild(img)}wrap.appendChild(s)});
}
function escapeHtml(v){return String(v??'').replace(/[&<>"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[ch]))}
function imgFor(c){return c.type==='bonus'?`assets/cards/${BONUS_IMG[c.bonus]}`:`assets/cards/${c.id}.jpg`}
function selectablePhase(){return['normal_discard','chance_discard','pecheur_discard','final_discard','voleur_give'].includes(snapshot.phase)&&snapshot.currentIndex===snapshot.meIndex}
function renderHand(me){const h=$('humanHand');h.innerHTML='';const cards=me.hand||[];h.dataset.count=String(cards.length);fitHand(cards.length);const selectable=selectablePhase();cards.forEach((c,i)=>{const b=document.createElement('button');b.className='hand-card';if(selectable)b.classList.add('selectable');if(selectedCard===c.id)b.classList.add('selected');b.style.transform=`rotate(${(i-(cards.length-1)/2)*1.8}deg)`;const img=document.createElement('img');img.src=imgFor(c);img.alt=c.id;b.appendChild(img);b.onclick=()=>{if(!selectable)return;selectedCard=selectedCard===c.id?null:c.id;renderHand(me);renderActions(me)};h.appendChild(b)});$('handEval').textContent=me.eval?.name||'-'}
function fitHand(count){const h=$('humanHand');if(!h||!count)return;const w=Math.max(250,h.clientWidth-8),vh=window.innerHeight,land=window.innerWidth>window.innerHeight;let cardH=land?Math.min(90,Math.max(68,vh*.22)):Math.min(150,Math.max(112,vh*.175));let cardW=cardH*.708;let overlap=0;if(cardW*count>w)overlap=(w-cardW*count)/(count-1);overlap=Math.min(0,overlap);const minOverlap=-cardW*.72;if(overlap<minOverlap){overlap=minOverlap;const totalFactor=count+(count-1)*(overlap/cardW);cardW=w/Math.max(1,totalFactor);cardH=cardW/.708}h.style.setProperty('--hand-card-h',`${Math.floor(cardH)}px`);h.style.setProperty('--hand-overlap',`${Math.floor(overlap)}px`)}
window.addEventListener('resize',()=>{if(snapshot?.started)fitHand(snapshot.players[snapshot.meIndex]?.handCount||5)});
function renderCenter(){const current=snapshot.players[snapshot.currentIndex];let title=snapshot.currentIndex===snapshot.meIndex?'À vous de jouer':`Tour de ${current?.name||'un joueur'}`,hint='';const ph=snapshot.phase;
  if(ph==='normal_draw')hint=snapshot.currentIndex===snapshot.meIndex?'Piochez une carte.':'Pioche…';else if(ph==='normal_discard')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez une carte à défausser.':'Choisit sa défausse…';else if(ph==='post_discard')hint=snapshot.currentIndex===snapshot.meIndex?'Annoncez POK POK ou terminez votre tour.':'Réfléchit à POK POK…';else if(ph==='chance_discard')hint='Chance : défaussez une carte.';else if(ph==='pecheur_discard')hint=`Pêcheur : encore ${snapshot.pecheurRemaining} carte(s) à défausser.`;else if(ph==='target_blocage')hint=snapshot.currentIndex===snapshot.meIndex?'Cliquez sur le joueur à bloquer.':'Choisit une cible…';else if(ph==='target_voleur')hint=snapshot.currentIndex===snapshot.meIndex?'Cliquez sur le joueur à voler.':'Choisit une cible…';else if(ph==='voleur_pick')hint=snapshot.currentIndex===snapshot.meIndex?'Cliquez sur une carte cachée de la cible.':'Prend une carte…';else if(ph==='voleur_give')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez la carte à rendre.':'Rend une carte…';else if(ph==='bombe_target')hint=snapshot.currentIndex===snapshot.meIndex?'Cliquez sur la cible de la Bombe.':'Choisit la cible de la Bombe…';else if(ph==='final_choice'){title=snapshot.finalCurrent===snapshot.meIndex?'Votre dernier tour':`Dernier tour de ${current?.name||''}`;hint='Conserver la main ou piocher une fois.'}else if(ph==='final_discard')hint='Dernier tour : défaussez une carte.';else if(ph==='pok_transition'){title='POK POK !';hint='Préparation du dernier tour…'}else if(ph==='blocked_pause')hint='Tour passé par Blocage.';$('turnTitle').textContent=title;$('turnHint').textContent=hint;$('eventLine').textContent=snapshot.lastEvent?.text||''}
function actionButton(text,cls,fn){const b=document.createElement('button');b.textContent=text;b.className=cls||'';b.onclick=fn;return b}
function renderActions(me){const a=$('actions');a.innerHTML='';const mine=snapshot.currentIndex===snapshot.meIndex;if(!mine)return;const ph=snapshot.phase;
  if(ph==='normal_draw')a.appendChild(actionButton('Piocher une carte','primary-action',()=>send({type:'draw'})));
  else if(['normal_discard','chance_discard','pecheur_discard','final_discard'].includes(ph)){const b=actionButton('Défausser la carte','primary-action',()=>selectedCard&&send({type:'discard',cardId:selectedCard}));b.disabled=!selectedCard;a.appendChild(b)}
  else if(ph==='post_discard'){a.appendChild(actionButton('POK POK !','pok',()=>send({type:'announce_pok'})));a.appendChild(actionButton('Finir mon tour','',()=>send({type:'end_turn'})))}
  else if(ph==='voleur_give'){const b=actionButton('Rendre cette carte','primary-action',()=>selectedCard&&send({type:'voleur_give',cardId:selectedCard}));b.disabled=!selectedCard;a.appendChild(b)}
  else if(['target_blocage','target_voleur'].includes(ph))a.appendChild(actionButton('Choisissez un joueur','',()=>{})).disabled=true;
  else if(ph==='bombe_target'){if(snapshot.validTargets?.includes(snapshot.meIndex))a.appendChild(actionButton('💣 Bombe sur moi','',()=>send({type:'bonus_target',target:snapshot.meIndex})));a.appendChild(actionButton('Cliquez sur un joueur','',()=>{})).disabled=true}
  else if(ph==='final_choice'){a.appendChild(actionButton('Conserver','',()=>send({type:'final_keep'})));a.appendChild(actionButton('Piocher puis défausser','primary-action',()=>send({type:'final_draw'})))}
}
function renderTargets(){const self=$('humanSeat'),isSelf=snapshot.validTargets?.includes(snapshot.meIndex);self.classList.toggle('targetable',!!isSelf);self.onclick=isSelf?()=>send({type:'bonus_target',target:snapshot.meIndex}):null}
function renderResult(){const m=$('roundModal'),r=snapshot.roundResult;if(!r){m.classList.add('hidden');return}m.classList.remove('hidden');$('resultTitle').textContent=r.title;$('resultNote').textContent=r.note;$('rubiesResult').textContent=r.rubiesNote||'';const wrap=$('resultHands');wrap.innerHTML='';(r.reveal||[]).forEach(x=>{const d=document.createElement('div');d.className='result-player'+(r.winners?.includes(x.index)?' winner':'');d.innerHTML=`<h3>${escapeHtml(x.name)}</h3><div>${escapeHtml(x.eval.name)} • ${x.eval.points} pts</div><div class="cards">${x.hand.map(c=>`<img src="${imgFor(c)}">`).join('')}</div><div>${(r.deltas?.[x.index]||0)>0?'+':''}${r.deltas?.[x.index]||0} pts</div><b>Total : ${x.score}</b>`;wrap.appendChild(d)});const btn=$('nextRoundBtn');if(r.gameOver){btn.classList.remove('hidden');btn.textContent='Retour au menu';btn.onclick=returnToMenu}else{btn.classList.toggle('hidden',snapshot.meIndex!==snapshot.players.findIndex(Boolean));btn.textContent='Manche suivante';btn.onclick=()=>send({type:'next_round'})}}
function returnToMenu(){localStorage.removeItem('pokpok_room_v029');localStorage.removeItem('pokpok_room_token_v029');snapshot=null;prevSnapshot=null;selectedCard=null;$('roundModal').classList.add('hidden');$('roomBox').classList.add('hidden');showPlay()}

function centerOf(el){if(!el)return{x:innerWidth/2,y:innerHeight/2};const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}}
function seatEl(index){return index===snapshot?.meIndex?$('humanSeat'):$(`seat-player-${index}`)}
function cardSourceForActor(actor,prev,next,mode){if(actor!==next.meIndex)return'assets/card_back.jpg';const before=prev?.players?.[prev.meIndex]?.hand||[],after=next.players[next.meIndex]?.hand||[];if(mode==='draw'){const ids=new Set(before.map(c=>c.id));const c=after.find(x=>!ids.has(x.id));return c?imgFor(c):'assets/card_back.jpg'}const ids=new Set(after.map(c=>c.id));const c=before.find(x=>!ids.has(x.id));return c?imgFor(c):'assets/card_back.jpg'}
function flyCard(src,from,to,duration=340,delay=0){return new Promise(resolve=>setTimeout(()=>{const e=document.createElement('div');e.className='flying-card';e.innerHTML=`<img src="${src}">`;e.style.left=`${from.x-29}px`;e.style.top=`${from.y-41}px`;$('fxLayer').appendChild(e);requestAnimationFrame(()=>{e.style.transform=`translate(${to.x-from.x}px,${to.y-from.y}px) scale(.92) rotate(7deg)`});setTimeout(()=>{e.style.opacity='0';setTimeout(()=>{e.remove();resolve()},120)},duration)},delay))}
function handMove(from,to,duration=330,delay=0,emoji='🤚'){return new Promise(resolve=>setTimeout(()=>{const h=document.createElement('div');h.className='fx-hand';h.textContent=emoji;h.style.left=`${from.x-25}px`;h.style.top=`${from.y-25}px`;$('fxLayer').appendChild(h);requestAnimationFrame(()=>h.style.transform=`translate(${to.x-from.x}px,${to.y-from.y}px) rotate(-12deg)`);setTimeout(()=>{h.style.opacity='0';setTimeout(()=>{h.remove();resolve()},100)},duration)},delay))}
async function animateDraw(actor,prev,next,delay=0){const seat=centerOf(seatEl(actor)),pile=centerOf($('drawPile'));await handMove(seat,pile,230,delay,'🫴');await Promise.all([flyCard(cardSourceForActor(actor,prev,next,'draw'),pile,seat,300,0),handMove(pile,seat,300,0,'🤚')])}
async function animateDiscard(actor,prev,next,delay=0,forceBack=false){const seat=centerOf(seatEl(actor)),pile=centerOf($('discardPile'));await Promise.all([flyCard(forceBack?'assets/card_back.jpg':cardSourceForActor(actor,prev,next,'discard'),seat,pile,300,delay),handMove(seat,pile,300,delay,'🤚')])}
function spawnSparkles(point,count=18,kind='gold'){const glyphs=kind==='pok'?['✦','✨','★','✧']:kind==='bomb'?['✦','💥','✹','◆']:['✦','•','◆','✧'];for(let i=0;i<count;i++){const s=document.createElement('div');s.className='spark';s.textContent=glyphs[i%glyphs.length];s.style.left=`${point.x}px`;s.style.top=`${point.y}px`;const a=Math.random()*Math.PI*2,d=35+Math.random()*90;s.style.setProperty('--dx',`${Math.cos(a)*d}px`);s.style.setProperty('--dy',`${Math.sin(a)*d}px`);s.style.color=i%3===0?'#ff4fbd':'#ffe85a';$('fxLayer').appendChild(s);setTimeout(()=>s.remove(),1000)}}
function showBurst(ev,duration=1500){const box=$('eventBurst'),art=$('eventBurstArt');const titles={pokpok:'✨ POK POK ! ✨',chance:'🍀 CHANCE !',blocage:'🚫 BLOCAGE !',voleur:'🦝 VOLEUR !',pecheur:'🐟 PÊCHEUR !',bombe:'💥 BOMBE !',deal:'🃏 DISTRIBUTION',reaction:ev.emoji||'😊',disconnect:'⚠ CONNEXION',blocked:'🚫 TOUR BLOQUÉ'};box.className=`event-burst ${ev.kind==='pokpok'?'pok':ev.kind==='bombe'?'bombe':''}`;$('eventBurstTitle').textContent=titles[ev.kind]||'POK POK';$('eventBurstText').textContent=ev.text;art.innerHTML=BONUS_IMG[ev.kind]?`<img src="assets/cards/${BONUS_IMG[ev.kind]}">`:'';box.classList.remove('hidden');const p=centerOf(box);spawnSparkles(p,ev.kind==='pokpok'?38:ev.kind==='bombe'?26:18,ev.kind==='pokpok'?'pok':ev.kind==='bombe'?'bomb':'gold');clearTimeout(box._timer);box._timer=setTimeout(()=>box.classList.add('hidden'),duration)}
async function animateDeal(ev){const arena=$('arena');arena.classList.add('is-dealing');const banner=document.createElement('div');banner.className='deal-banner';banner.textContent='🃏 Distribution…';document.body.appendChild(banner);const counters={};const order=ev.dealOrder||[];for(let k=0;k<order.length;k++){const idx=order[k],seat=seatEl(idx);if(!seat)continue;const from=centerOf($('drawPile')),to=centerOf(seat);const count=counters[idx]||0;let src='assets/card_back.jpg';if(idx===snapshot.meIndex){const c=snapshot.players[idx].hand?.[count];if(c)src=imgFor(c)}await flyCard(src,from,to,150,0);const cards=idx===snapshot.meIndex?$('humanHand').querySelectorAll('.hand-card'):seat.querySelectorAll('.mini-card');cards[count]?.classList.add('deal-revealed');counters[idx]=count+1;await wait(34)}arena.classList.remove('is-dealing');banner.remove()}
function wait(ms){return new Promise(r=>setTimeout(r,ms))}
function removedBonus(prev,next){if(!prev||!next||next.meIndex!==prev.meIndex)return null;const before=prev.players?.[prev.meIndex]?.hand||[],after=next.players?.[next.meIndex]?.hand||[],ids=new Set(after.map(c=>c.id));return before.find(c=>c.type==='bonus'&&!ids.has(c.id))||null}
async function animateVoleur(ev){const a=centerOf(seatEl(ev.actor)),t=centerOf(seatEl(ev.target));if(ev.transfer==='take'){await handMove(a,t,280,0,'🫴');await Promise.all([flyCard('assets/card_back.jpg',t,a,320),handMove(t,a,320,0,'🤚')])}else if(ev.transfer==='give'){await Promise.all([flyCard('assets/card_back.jpg',a,t,330),handMove(a,t,330,0,'🤚')])}}
async function animateBombe(ev,prev,next){const target=ev.target,seat=centerOf(seatEl(target)),discard=centerOf($('discardPile')),draw=centerOf($('drawPile'));document.body.classList.add('screen-shake');setTimeout(()=>document.body.classList.remove('screen-shake'),480);spawnSparkles(seat,28,'bomb');for(let i=0;i<Math.min(ev.discardSteps||5,5);i++)flyCard('assets/card_back.jpg',{x:seat.x+(i-2)*9,y:seat.y},discard,230,i*45);await wait(280);for(let i=0;i<5;i++){flyCard(target===next.meIndex&&next.players[target].hand?.[i]?imgFor(next.players[target].hand[i]):'assets/card_back.jpg',draw,seat,230,i*70);handMove(draw,seat,220,i*70,'🤚')}await wait(420)}
async function playEvent(ev,prev,next){if(eventBusy&&ev.kind!=='reaction')await wait(120);eventBusy=true;try{
  if(ev.kind==='deal'){showBurst(ev,900);await wait(140);await animateDeal(ev);return}
  if(ev.kind==='draw'){await animateDraw(ev.actor,prev,next);return}
  if(ev.kind==='discard'){await animateDiscard(ev.actor,prev,next);return}
  if(ev.kind==='pokpok'){showBurst(ev,2400);const p=centerOf(seatEl(ev.actor));spawnSparkles(p,32,'pok');return}
  if(ev.kind==='reaction'){showBurst(ev,900);return}
  if(ev.kind==='disconnect'||ev.kind==='blocked'||ev.kind==='shuffle'){showBurst(ev,1300);return}
  if(['chance','blocage','voleur','pecheur','bombe'].includes(ev.kind)){
    const bonus=removedBonus(prev,next);if(bonus&&ev.actor===next.meIndex)await animateDiscard(ev.actor,prev,next,0,false);else if(prev?.phase==='normal_discard'&&ev.actor!==next.meIndex)await animateDiscard(ev.actor,prev,next,0,true);
    if(ev.kind==='voleur'&&ev.transfer){showBurst(ev,1100);await animateVoleur(ev);return}
    showBurst(ev,ev.kind==='bombe'?1750:1450);
    if(ev.kind==='chance'&&ev.drawSteps)await animateDraw(ev.actor,prev,next,120);
    if(ev.kind==='pecheur'&&ev.drawSteps){for(let i=0;i<ev.drawSteps;i++){await animateDraw(ev.actor,null,next,i===0?90:0);await wait(90)}}
    if(ev.kind==='bombe'&&ev.target!==undefined&&ev.drawSteps)await animateBombe(ev,prev,next);
    if(ev.kind==='blocage'&&ev.target!==undefined){const p=centerOf(seatEl(ev.target));spawnSparkles(p,18,'gold')}
    return;
  }
}finally{eventBusy=false}}

$('rulesBtn').onclick=()=>{$('rulesModal').classList.remove('hidden')};$('closeRules').onclick=()=>$('rulesModal').classList.add('hidden');function renderRule(){$('rulePage').src=`assets/rules/page-${String(rulePage).padStart(2,'0')}.jpg`;$('ruleCounter').textContent=`${rulePage} / 16`}$('prevRule').onclick=()=>{rulePage=rulePage<=1?16:rulePage-1;renderRule()};$('nextRule').onclick=()=>{rulePage=rulePage>=16?1:rulePage+1;renderRule()};
setAuthMode('login');connect();syncMusic();
