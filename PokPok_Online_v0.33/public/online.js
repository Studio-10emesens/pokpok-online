'use strict';

const $=id=>document.getElementById(id);
const ANIMAL={duck:['Canard','🦆'],dog:['Chien','🐶'],otter:['Loutre','🦦'],cat:['Chat','🐱'],fox:['Renard','🦊'],panda:['Panda','🐼'],frog:['Grenouille','🐸'],owl:['Hibou','🦉'],raccoon:['Raton laveur','🦝'],rabbit:['Lapin','🐰'],koala:['Koala','🐨'],monkey:['Singe','🐵'],lion:['Lion','🦁'],tiger:['Tigre','🐯'],bear:['Ours','🐻'],pig:['Cochon','🐷'],cow:['Vache','🐮'],penguin:['Pingouin','🐧']};
const BONUS_IMG={chance:'bonus_chance.jpg',blocage:'bonus_blocage.jpg',voleur:'bonus_voleur.jpg',pecheur:'bonus_pecheur.jpg',bombe:'bonus_bombe.jpg'};
const TIER_STAKE={debutant:10,intermediaire:20,expert:50,legende:100};
const SESSION_KEY='pokpok_session_v033',ROOM_KEY='pokpok_room_v033',ROOM_TOKEN_KEY='pokpok_room_token_v033';
let ws=null,snapshot=null,prevSnapshot=null,account=null,selectedCard=null,selectedTier='debutant',lastEventId=null,rulePage=1,ruleZoom=1,musicOn=true,fxOn=true,musicMode='menu',authMode='login',reconnectAttempted=false,eventBusy=false,avatarContext='profile',wheelRotation=0,audioCtx=null,firebaseAuth=null,firebaseConfigState=null,phoneConfirmation=null,pausedByVisibility=false;

function escapeHtml(v){return String(v??'').replace(/[&<>\"]/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[ch]))}
function imgFor(c){return c.type==='bonus'?`assets/cards/${BONUS_IMG[c.bonus]}`:`assets/cards/${c.id}.jpg`}
function toast(msg,ms=2400){const t=$('toast');t.textContent=msg;t.classList.remove('hidden');clearTimeout(t._timer);t._timer=setTimeout(()=>t.classList.add('hidden'),ms)}
function socketUrl(){return `${location.protocol==='https:'?'wss':'ws'}://${location.host}`}
function send(o){if(ws?.readyState===1)ws.send(JSON.stringify(o));else toast('Connexion en cours…')}
function wait(ms){return new Promise(r=>setTimeout(r,ms))}

/* ---------- Audio / effets (même esprit que V0.27) ---------- */
function ensureAudio(){if(!audioCtx){try{audioCtx=new (window.AudioContext||window.webkitAudioContext)()}catch{}}if(audioCtx?.state==='suspended')audioCtx.resume().catch(()=>{})}
function tone(freq=440,dur=.1,vol=.025,type='triangle',delay=0){if(!fxOn)return;ensureAudio();if(!audioCtx)return;const o=audioCtx.createOscillator(),g=audioCtx.createGain(),t=audioCtx.currentTime+delay;o.type=type;o.frequency.setValueAtTime(freq,t);g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(Math.max(.0002,vol),t+.008);g.gain.exponentialRampToValueAtTime(.0001,t+dur);o.connect(g).connect(audioCtx.destination);o.start(t);o.stop(t+dur+.03)}
function noise(dur=.055,vol=.035,delay=0){if(!fxOn)return;ensureAudio();if(!audioCtx)return;const len=Math.max(1,Math.floor(audioCtx.sampleRate*dur)),b=audioCtx.createBuffer(1,len,audioCtx.sampleRate),d=b.getChannelData(0);for(let i=0;i<len;i++){const e=1-i/len;d[i]=(Math.random()*2-1)*e*e}const s=audioCtx.createBufferSource(),f=audioCtx.createBiquadFilter(),g=audioCtx.createGain(),t=audioCtx.currentTime+delay;f.type='bandpass';f.frequency.value=1250;f.Q.value=.8;g.gain.setValueAtTime(.0001,t);g.gain.exponentialRampToValueAtTime(vol,t+.004);g.gain.exponentialRampToValueAtTime(.0001,t+dur);s.buffer=b;s.connect(f).connect(g).connect(audioCtx.destination);s.start(t)}
function fx(kind){if(!fxOn)return;const map={draw:[520,.09,.025],discard:[210,.08,.025],bonus:[760,.15,.035],pok:[880,.20,.042],click:[430,.06,.018],bell:[980,.16,.03],bomb:[95,.25,.05],deal:[0,0,0]};if(kind==='deal'){noise(.045,.04);return}const x=map[kind]||map.click;tone(x[0],x[1],x[2],kind==='bomb'?'sawtooth':'triangle');if(kind==='pok'){tone(1175,.18,.025,'triangle',.08);tone(1320,.16,.018,'sine',.15)}if(kind==='bonus')tone(980,.12,.02,'sine',.07)}
function stopAllMusic(){const menu=$('menuMusic'),game=$('gameMusic');menu?.pause();game?.pause();try{if('mediaSession'in navigator)navigator.mediaSession.playbackState='none'}catch{}}
function syncMusic(){const menu=$('menuMusic'),game=$('gameMusic');if(!menu||!game)return;if(!musicOn||document.hidden){stopAllMusic();return}const play=musicMode==='menu'?menu:game,stop=musicMode==='menu'?game:menu;stop.pause();play.volume=musicMode==='menu'?.10:.28;if(play.paused)play.play().catch(()=>{});try{if('mediaSession'in navigator)navigator.mediaSession.playbackState='playing'}catch{}}
function setMusicMode(mode){if(musicMode!==mode){musicMode=mode;syncMusic()}}
document.addEventListener('visibilitychange',()=>{if(document.hidden){pausedByVisibility=true;stopAllMusic()}else if(pausedByVisibility){pausedByVisibility=false;syncMusic()}});
window.addEventListener('pagehide',stopAllMusic);window.addEventListener('beforeunload',stopAllMusic);

/* ---------- Connexion ---------- */
function connect(){
  if(ws&&ws.readyState<=1)return;reconnectAttempted=false;ws=new WebSocket(socketUrl());
  ws.onopen=()=>{let s=localStorage.getItem(SESSION_KEY)||localStorage.getItem('pokpok_session_v031')||localStorage.getItem('pokpok_session_v030')||localStorage.getItem('pokpok_session_v029');if(s){localStorage.setItem(SESSION_KEY,s);send({type:'resume_account',sessionToken:s})}};
  ws.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}handle(m)};
  ws.onclose=()=>{if(snapshot?.started){$('connectionBanner').textContent='Connexion perdue — tentative de reconnexion…';$('connectionBanner').classList.remove('hidden')}setTimeout(connect,1300)};
}
function handle(m){
  if(m.type==='error'){toast(m.message);return}
  if(m.type==='auth_required'){account=null;showAuth();return}
  if(m.type==='logged_out'){account=null;localStorage.removeItem(SESSION_KEY);showAuth();return}
  if(m.type==='account'){
    account=m.profile;localStorage.setItem(SESSION_KEY,m.sessionToken);showHome();updateAccountUI();
    const c=localStorage.getItem(ROOM_KEY)||localStorage.getItem('pokpok_room_v031')||localStorage.getItem('pokpok_room_v030')||localStorage.getItem('pokpok_room_v029'),t=localStorage.getItem(ROOM_TOKEN_KEY)||localStorage.getItem('pokpok_room_token_v031')||localStorage.getItem('pokpok_room_token_v030')||localStorage.getItem('pokpok_room_token_v029');
    if(c&&t&&!reconnectAttempted){reconnectAttempted=true;localStorage.setItem(ROOM_KEY,c);localStorage.setItem(ROOM_TOKEN_KEY,t);send({type:'reconnect',code:c,token:t})}return;
  }
  if(m.type==='wheel_result'){animateWheelResult(m.reward);return}
  if(m.type==='queue'){$('queueText').textContent=`${m.message} — ${m.waiting}/${m.needed}`;$('queueBox').classList.remove('hidden');$('roomBox').classList.add('hidden');return}
  if(m.type==='queue_cancelled'){$('queueBox').classList.add('hidden');return}
  if(m.type==='joined'){localStorage.setItem(ROOM_KEY,m.code);localStorage.setItem(ROOM_TOKEN_KEY,m.token);$('queueText').textContent='Table trouvée • démarrage de la partie…';$('queueBox').classList.remove('hidden');$('roomBox').classList.add('hidden');return}
  if(m.type==='left_room'){clearRoomLocal();snapshot=null;prevSnapshot=null;selectedCard=null;$('quitModal').classList.add('hidden');$('roundModal').classList.add('hidden');showHome();toast('Vous avez quitté la table.');return}
  if(m.type==='snapshot'){
    prevSnapshot=snapshot;snapshot=m.state;$('connectionBanner').classList.add('hidden');
    if(account&&Number.isFinite(snapshot.walletRubies)){account.rubies=snapshot.walletRubies;updateAccountUI()}
    render();
    if(snapshot.lastEvent&&snapshot.lastEvent.id!==lastEventId){lastEventId=snapshot.lastEvent.id;playEvent(snapshot.lastEvent,prevSnapshot,snapshot)}
  }
}
function clearRoomLocal(){[ROOM_KEY,ROOM_TOKEN_KEY,'pokpok_room_v031','pokpok_room_token_v031','pokpok_room_v030','pokpok_room_token_v030','pokpok_room_v029','pokpok_room_token_v029'].forEach(k=>localStorage.removeItem(k))}

/* ---------- Écrans / compte ---------- */
function switchScreen(game){$('lobby').classList.toggle('active',!game);$('game').classList.toggle('active',game);$('quitBtn').classList.toggle('hidden',!game);$('roundLabel').textContent=game&&snapshot?`Manche ${snapshot.round} • V0.33 ONLINE`:'V0.33 ONLINE';setMusicMode(game?'game':'menu')}
function showAuth(){$('authCard').classList.remove('hidden');$('homeCard').classList.add('hidden');$('walletTop').classList.add('hidden');switchScreen(false)}
function showHome(){$('authCard').classList.add('hidden');$('homeCard').classList.remove('hidden');$('walletTop').classList.remove('hidden');$('queueBox')?.classList.add('hidden');$('roomBox')?.classList.add('hidden');switchScreen(false)}
function updateAccountUI(){
  if(!account)return;const av=ANIMAL[account.avatar]||ANIMAL.duck;
  $('profileName').textContent=account.displayName;$('profileBigName').textContent=account.displayName;$('rubiesValue').textContent=account.rubies;$('walletTopValue').textContent=account.rubies;$('profileRubies').textContent=account.rubies;$('profileAvatarEmoji').textContent=av[1];$('profileBigAvatar').textContent=av[1];
  $('dailyBtn').textContent='🎁 50 rubis offerts à l’inscription';
  $('wheelStatus').textContent=account.wheelAvailable?'🎡 1 tour disponible':'✓ Roulette déjà jouée';$('spinWheelBtn').disabled=!account.wheelAvailable;
  document.querySelectorAll('.tier').forEach(b=>b.classList.toggle('locked',account.rubies<TIER_STAKE[b.dataset.tier]));updatePotPreview();renderAvatarGrid();
}
function updatePotPreview(){const n=Number($('playersInput').value)||2,stake=TIER_STAKE[selectedTier];$('stakePreview').textContent=stake;$('potPreview').textContent=stake*n}
function setAuthMode(mode){authMode=mode;$('loginTab').classList.toggle('active',mode==='login');$('registerTab').classList.toggle('active',mode==='register');$('registerAvatarBlock').classList.toggle('hidden',mode!=='register');$('authSubmit').textContent=mode==='login'?'Se connecter':'Créer le compte + 50 💎'}

/* ---------- Connexion Google / Facebook / Téléphone via Firebase (optionnelle) ---------- */
function loadScriptOnce(src){return new Promise((resolve,reject)=>{const old=[...document.scripts].find(x=>x.src===src);if(old){if(old.dataset.ready==='1')return resolve();old.addEventListener('load',resolve,{once:true});old.addEventListener('error',reject,{once:true});return}const el=document.createElement('script');el.src=src;el.async=true;el.onload=()=>{el.dataset.ready='1';resolve()};el.onerror=reject;document.head.appendChild(el)})}
async function initFederatedAuth(){
  try{const r=await fetch('/auth-config',{cache:'no-store'}),cfg=await r.json();firebaseConfigState=cfg;if(!cfg.configured){$('socialAuthHint').textContent='Google, Facebook et Téléphone : prêts à être activés dans Render (voir AUTH_FIREBASE.txt).';document.querySelectorAll('.social-auth-btn').forEach(b=>b.classList.add('needs-config'));return}
    await loadScriptOnce('https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js');await loadScriptOnce('https://www.gstatic.com/firebasejs/10.14.1/firebase-auth-compat.js');
    if(!firebase.apps.length)firebase.initializeApp(cfg.config);firebaseAuth=firebase.auth();firebaseAuth.languageCode='fr';$('socialAuthHint').textContent='Connexion rapide sécurisée.';document.querySelectorAll('.social-auth-btn').forEach(b=>b.classList.remove('needs-config'));
    const redirected=await firebaseAuth.getRedirectResult().catch(()=>null);if(redirected?.user)await completeFederatedUser(redirected.user)
  }catch(err){console.warn(err);$('socialAuthHint').textContent='Connexion externe indisponible pour le moment.'}
}
async function completeFederatedUser(user){if(!user)return;const idToken=await user.getIdToken(true);send({type:'federated_login',idToken})}
function authNeedsConfig(){if(firebaseAuth)return false;toast('Google / Facebook / Téléphone doit d’abord être configuré dans Render. Voir AUTH_FIREBASE.txt.',3600);return true}
async function providerLogin(kind){if(authNeedsConfig())return;try{const provider=kind==='google'?new firebase.auth.GoogleAuthProvider():new firebase.auth.FacebookAuthProvider();provider.setCustomParameters?.({prompt:'select_account'});const mobile=matchMedia('(max-width:700px)').matches||/Android|iPhone|iPad/i.test(navigator.userAgent);if(mobile){await firebaseAuth.signInWithRedirect(provider);return}const result=await firebaseAuth.signInWithPopup(provider);await completeFederatedUser(result.user)}catch(err){if(!/popup-closed|cancelled-popup|redirect-cancelled/i.test(err.code||''))toast(err.message||'Connexion impossible.',3300)}}
$('googleLoginBtn').onclick=()=>providerLogin('google');$('facebookLoginBtn').onclick=()=>providerLogin('facebook');
$('phoneLoginBtn').onclick=()=>{if(authNeedsConfig())return;$('phoneAuthModal').classList.remove('hidden');$('phoneCodeStep').classList.add('hidden')};$('closePhoneAuth').onclick=()=>$('phoneAuthModal').classList.add('hidden');
$('sendPhoneCodeBtn').onclick=async()=>{if(authNeedsConfig())return;const phone=$('phoneNumberInput').value.replace(/\s+/g,'');if(!/^\+[1-9]\d{7,14}$/.test(phone))return toast('Entre le numéro au format international, par exemple +33612345678.');try{if(window.pokRecaptcha){try{window.pokRecaptcha.clear()}catch{}}window.pokRecaptcha=new firebase.auth.RecaptchaVerifier('phoneRecaptcha',{size:'invisible'});phoneConfirmation=await firebaseAuth.signInWithPhoneNumber(phone,window.pokRecaptcha);$('phoneCodeStep').classList.remove('hidden');toast('Code SMS envoyé.')}catch(err){toast(err.message||'Impossible d’envoyer le SMS.',3600)}};
$('confirmPhoneCodeBtn').onclick=async()=>{const code=$('phoneCodeInput').value.trim();if(!phoneConfirmation||!/^[0-9]{6}$/.test(code))return toast('Entre le code à 6 chiffres.');try{const result=await phoneConfirmation.confirm(code);$('phoneAuthModal').classList.add('hidden');await completeFederatedUser(result.user)}catch(err){toast('Code incorrect ou expiré.',3300)}};

/* ---------- Sélecteurs intégrés au jeu : aucun menu natif du téléphone ---------- */
const CHOICE_CONFIG={
  players:{title:'Nombre de joueurs',input:'playersInput',text:'playersChoiceText',options:[[2,'2 joueurs'],[3,'3 joueurs'],[4,'4 joueurs'],[5,'5 joueurs'],[6,'6 joueurs']]},
  target:{title:'Objectif de la partie',input:'targetInput',text:'targetChoiceText',options:[[500,'Partie rapide - 500 points'],[1000,'Partie normale - 1000 points']]}
};
let choiceContext=null;
function openGameChoice(kind){
  const cfg=CHOICE_CONFIG[kind];if(!cfg)return;choiceContext=kind;$('choiceModalTitle').textContent=cfg.title;const box=$('choiceOptions');box.innerHTML='';const current=String($(cfg.input).value);
  cfg.options.forEach(([value,label])=>{const b=document.createElement('button');b.type='button';b.className='choice-option'+(String(value)===current?' selected':'');b.innerHTML=`<span>${escapeHtml(label)}</span><b>${String(value)===current?'✓':''}</b>`;b.onclick=()=>{$(cfg.input).value=String(value);$(cfg.text).textContent=label;$('choiceModal').classList.add('hidden');fx('click');updatePotPreview()};box.appendChild(b)});
  $('choiceModal').classList.remove('hidden');fx('click');
}
$('playersChoiceBtn').onclick=()=>openGameChoice('players');
$('targetChoiceBtn').onclick=()=>openGameChoice('target');
$('closeChoiceModal').onclick=()=>$('choiceModal').classList.add('hidden');
$('choiceModal').addEventListener('click',e=>{if(e.target===$('choiceModal'))$('choiceModal').classList.add('hidden')});

$('loginTab').onclick=()=>setAuthMode('login');$('registerTab').onclick=()=>setAuthMode('register');
$('authSubmit').onclick=()=>{fx('click');const username=$('authUser').value.trim(),secret=$('authSecret').value;if(!username||secret.length<4)return toast('Entre un identifiant et un mot de passe / PIN de 4 caractères minimum.');send({type:authMode,username,secret,avatar:$('registerAvatar').value})};
$('logoutBtn').onclick=()=>{clearRoomLocal();snapshot=null;send({type:'logout'})};
document.querySelectorAll('.tier').forEach(b=>b.onclick=()=>{fx('click');selectedTier=b.dataset.tier;document.querySelectorAll('.tier').forEach(x=>x.classList.toggle('active',x===b));updatePotPreview()});
function matchMeta(){return{tier:selectedTier,capacity:Number($('playersInput').value),target:Number($('targetInput').value)}}
$('quickBtn').onclick=()=>{fx('click');send({type:'quick_match',...matchMeta()})};$('cancelQueueBtn').onclick=()=>send({type:'cancel_queue'});

/* ---------- Navigation du menu ---------- */
document.querySelectorAll('.home-tab').forEach(btn=>btn.onclick=()=>{fx('click');document.querySelectorAll('.home-tab').forEach(x=>x.classList.toggle('active',x===btn));document.querySelectorAll('.home-panel').forEach(p=>p.classList.toggle('active',p.dataset.panel===btn.dataset.tab))});

/* ---------- Avatar intégré ---------- */
function renderAvatarGrid(){const g=$('avatarGrid');g.innerHTML='';for(const [key,[name,emoji]] of Object.entries(ANIMAL)){const b=document.createElement('button');b.type='button';b.classList.toggle('selected',(avatarContext==='register'?$('registerAvatar').value:account?.avatar)===key);b.innerHTML=`<span>${emoji}</span><b>${escapeHtml(name)}</b>`;b.onclick=()=>{fx('click');if(avatarContext==='register'){$('registerAvatar').value=key;$('registerAvatarEmoji').textContent=emoji;$('registerAvatarName').textContent=name;$('avatarModal').classList.add('hidden')}else{send({type:'set_avatar',avatar:key});$('avatarModal').classList.add('hidden')}};g.appendChild(b)}}
function openAvatar(context){avatarContext=context;renderAvatarGrid();$('avatarModal').classList.remove('hidden')}
$('registerAvatarButton').onclick=()=>openAvatar('register');$('profileAvatarButton').onclick=()=>openAvatar('profile');$('changeAvatarBtn').onclick=()=>openAvatar('profile');$('closeAvatarModal').onclick=()=>$('avatarModal').classList.add('hidden');

/* ---------- Roulette / boutique ---------- */
$('spinWheelBtn').onclick=()=>{if(!account?.wheelAvailable)return toast('La roulette a déjà été jouée aujourd’hui.');fx('bell');$('spinWheelBtn').disabled=true;$('wheelResult').textContent='La roue tourne…';send({type:'spin_wheel'})};
function animateWheelResult(reward){const values=[10,20,40,50,80,100],idx=Math.max(0,values.indexOf(reward)),segment=60,target=360-(idx*segment+segment/2);wheelRotation+=5*360+target-(wheelRotation%360);$('wheel').style.transform=`rotate(${wheelRotation}deg)`;setTimeout(()=>{fx('pok');$('wheelResult').textContent=`🎉 +${reward} rubis !`;$('wheelStatus').textContent='✓ Roulette déjà jouée';spawnSparkles(centerOf($('wheel')),42,'pok');if(account){account.wheelAvailable=false;updateAccountUI()}},4200)}
document.querySelectorAll('.shop-pack').forEach(b=>b.onclick=()=>{fx('click');toast(`${b.dataset.pack} rubis • ${b.dataset.price} — paiement réel pas encore activé dans ce prototype.`,3300)});

/* ---------- Musique / effets ---------- */
$('musicBtn').onclick=()=>{musicOn=!musicOn;$('musicBtn').textContent=`♫ Musique : ${musicOn?'ON':'OFF'}`;syncMusic()};$('fxBtn').onclick=()=>{fxOn=!fxOn;$('fxBtn').textContent=`🔔 Effets : ${fxOn?'ON':'OFF'}`;if(fxOn)fx('bell')};document.addEventListener('pointerdown',()=>{ensureAudio();syncMusic()},{once:true});

/* ---------- Jeu ---------- */
function render(){
  if(!snapshot)return;
  if(!snapshot.started){switchScreen(false);renderLobbyRoom();return}
  switchScreen(true);const me=snapshot.players[snapshot.meIndex];if(!me)return;
  $('arena').dataset.playerCount=String(snapshot.capacity);$('meName').textContent=me.name;$('meAvatar').textContent=ANIMAL[me.avatar]?.[1]||'🦆';$('meScore').textContent=`${me.score} pts`;$('meDealer').classList.toggle('hidden',snapshot.dealerIndex!==snapshot.meIndex);$('meBlocked').classList.toggle('hidden',!me.blocked);$('mePok').classList.toggle('hidden',snapshot.pokAnnouncer!==snapshot.meIndex);$('potInGame').textContent=`💎 Pot : ${snapshot.pot}`;$('roundInfo').textContent=`MANCHE ${snapshot.round} • ${snapshot.tierLabel} • OBJECTIF ${snapshot.target}`;
  const myTurn=snapshot.currentIndex===snapshot.meIndex;$('humanSeat').classList.toggle('active-turn',myTurn);$('humanSeat').classList.toggle('active',myTurn);syncHumanTurnBadge31(myTurn);renderOpponents();renderHand(me);renderCenter();renderActions(me);renderTargets();renderResult();updateClockDom();requestAnimationFrame(()=>{fitHumanHand32();alignHumanActions32();protectTextLayout32()});
}

function syncHumanTurnBadge31(active){
  const seat=$('humanSeat');if(!seat)return;let b=seat.querySelector('.human-turn-badge');
  if(active&&!b){b=document.createElement('div');b.className='turn-now-badge human-turn-badge';b.innerHTML='<span>▶</span> À VOUS';seat.appendChild(b)}
  if(!active&&b)b.remove();
}
function renderLobbyRoom(){$('roomBox').classList.add('hidden');$('queueBox').classList.remove('hidden');$('queueText').textContent='Table trouvée • préparation de la partie…'}
function opponentIndices(){const out=[];for(let k=1;k<snapshot.players.length;k++){const i=(snapshot.meIndex+k)%snapshot.players.length;if(snapshot.players[i])out.push(i)}return out}
function posClasses(n){if(n===1)return['seat-top'];if(n===2)return['seat-left','seat-right'];if(n===3)return['seat-top','seat-left','seat-right'];if(n===4)return['seat-top-left','seat-top-right','seat-left','seat-right'];return['seat-top-left','seat-top','seat-top-right','seat-mid-left','seat-mid-right']}
function renderOpponents(){
  const wrap=$('opponents');wrap.innerHTML='';const idxs=opponentIndices(),pos=posClasses(idxs.length);
  idxs.forEach((idx,k)=>{const p=snapshot.players[idx],s=document.createElement('section');s.id=`seat-player-${idx}`;s.className=`opponent seat-player ${pos[k]||'seat-top'}`;if(snapshot.currentIndex===idx)s.classList.add('active-turn','active','thinking');if(snapshot.validTargets?.includes(idx))s.classList.add('targetable');
    const badges=`${p.blocked?'<span class="badge hot">BLOQUÉ</span>':''}${snapshot.pokAnnouncer===idx?'<span class="badge hot">POK POK</span>':''}${snapshot.dealerIndex===idx?'<span class="badge gold">DONNEUR</span>':''}`;
    s.innerHTML=`<div class="opponent-top"><div class="opponent-id"><span class="avatar opponent-avatar">${ANIMAL[p.avatar]?.[1]||'🦆'}</span><span><b class="opponent-name">${escapeHtml(p.name)}</b><small>${p.connected?'Connecté':'Déconnecté'}</small></span></div><span>${badges}</span></div><div class="mini-hand"></div><div class="opponent-foot">${p.connected?(snapshot.currentIndex===idx?'Réfléchit…':'Main cachée'):'Hors ligne'}</div><div class="seat-score-plate">${p.score} pts</div>${snapshot.currentIndex===idx?'<div class="turn-now-badge"><span>▶</span> TOUR EN COURS</div>':''}`;
    if(snapshot.validTargets?.includes(idx))s.onclick=e=>{if(!e.target.classList.contains('stealable'))send({type:'bonus_target',target:idx})};
    const h=s.querySelector('.mini-hand');for(let c=0;c<p.handCount;c++){const img=document.createElement('img');img.src='assets/card_back.jpg';img.className='mini-card';img.style.setProperty('--mini',c);img.alt='Carte cachée';if(snapshot.phase==='voleur_pick'&&snapshot.currentIndex===snapshot.meIndex&&snapshot.pendingVoleur?.target===idx){img.classList.add('stealable');img.onclick=e=>{e.stopPropagation();fx('click');send({type:'voleur_pick',index:c})}}h.appendChild(img)}wrap.appendChild(s)
  });
}
function selectablePhase(){return['normal_discard','chance_discard','pecheur_discard','final_discard','voleur_give'].includes(snapshot.phase)&&snapshot.currentIndex===snapshot.meIndex}
function renderHand(me){
  const h=$('humanHand'),cards=me.hand||[];
  if(selectedCard&&!cards.some(c=>c.id===selectedCard))selectedCard=null;
  h.innerHTML='';h.dataset.count=String(cards.length);const selectable=selectablePhase();
  cards.sort((a,b)=>{if(a.type!==b.type)return a.type==='normal'?-1:1;if(a.type==='bonus')return ({blocage:'Blocage',bombe:'Bombe',chance:'Chance',pecheur:'Pêcheur',voleur:'Voleur'}[a.bonus]||'').localeCompare(({blocage:'Blocage',bombe:'Bombe',chance:'Chance',pecheur:'Pêcheur',voleur:'Voleur'}[b.bonus]||''),'fr');return (a.value||0)-(b.value||0)||({C:0,D:1,H:2,S:3}[a.suit]||0)-({C:0,D:1,H:2,S:3}[b.suit]||0)});
  cards.forEach((c,i)=>{
    const b=document.createElement('button');b.className='hand-card';b.type='button';b.dataset.cardId=c.id;
    if(selectable)b.classList.add('selectable');if(selectedCard===c.id)b.classList.add('selected');
    b.style.setProperty('--fan-rot',`${(i-(cards.length-1)/2)*2.15}deg`);
    const img=document.createElement('img');img.src=imgFor(c);img.alt=c.type==='bonus'?c.bonus:c.id;b.appendChild(img);
    b.onclick=e=>{
      if(!selectable)return;
      e.preventDefault();fx('click');selectedCard=selectedCard===c.id?null:c.id;
      [...h.querySelectorAll('.hand-card')].forEach(el=>el.classList.toggle('selected',!!selectedCard&&el.dataset.cardId===selectedCard));
      renderActions(me);
      requestAnimationFrame(()=>{alignHumanActions32();protectTextLayout32()});
    };
    h.appendChild(b)
  });
  $('handEval').textContent=me.eval?`${me.eval.name}${me.eval.points?` • ${me.eval.points} pts`:''}`:'-';
  requestAnimationFrame(()=>{fitHumanHand32();alignHumanActions32();protectTextLayout32()})
}
function renderCenter(){
  const current=snapshot.players[snapshot.currentIndex];let title=snapshot.currentIndex===snapshot.meIndex?'À vous de jouer':`Tour de ${current?.name||'un joueur'}`,hint='';const ph=snapshot.phase;
  if(ph==='normal_draw')hint=snapshot.currentIndex===snapshot.meIndex?'Piochez une carte.':'Pioche…';else if(ph==='normal_discard')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez une carte à défausser.':'Choisit sa défausse…';else if(ph==='post_discard')hint=snapshot.currentIndex===snapshot.meIndex?'Annoncez POK POK maintenant, ou terminez votre tour.':'Réfléchit à une annonce POK POK…';else if(ph==='chance_discard')hint='Bonus Chance : défaussez une carte. Si c’est un Bonus, il s’active normalement.';else if(ph==='pecheur_discard')hint=`Bonus Pêcheur : encore ${snapshot.pecheurRemaining} carte(s) à défausser.`;else if(ph==='target_blocage')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez le joueur qui passera son prochain tour.':'Choisit une cible…';else if(ph==='target_voleur')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez l’adversaire à voler.':'Choisit une cible…';else if(ph==='voleur_pick')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez une carte cachée dans sa main.':'Prend une carte…';else if(ph==='voleur_give')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez la carte à rendre.':'Rend une carte…';else if(ph==='bombe_target')hint=snapshot.currentIndex===snapshot.meIndex?'Choisissez qui doit refaire entièrement sa main.':'Choisit la cible de la Bombe…';else if(ph==='final_choice'){title=snapshot.finalCurrent===snapshot.meIndex?'Votre dernier tour':`Dernier tour de ${current?.name||''}`;hint='Conserver votre main ou piocher une fois.'}else if(ph==='final_discard')hint='Dernier tour : défaussez une carte.';else if(ph==='pok_transition'){title='✨ POK POK ! ✨';hint='Préparation du dernier tour…'}else if(ph==='blocked_pause')hint='Tour passé par Blocage.';
  $('turnTitle').textContent=title;$('turnHint').textContent=hint;$('eventLine').textContent=snapshot.lastEvent?.text||''
}
function actionButton(text,cls,fn){const b=document.createElement('button');b.textContent=text;b.className=`${cls||'secondary'}`;b.onclick=fn;return b}
function renderActions(me){
  const a=$('actions');a.innerHTML='';const mine=snapshot.currentIndex===snapshot.meIndex;if(!mine)return;const ph=snapshot.phase;
  if(ph==='normal_draw')a.appendChild(actionButton('Piocher une carte','primary primary-action',()=>{fx('click');send({type:'draw'})}));
  else if(['normal_discard','chance_discard','pecheur_discard','final_discard'].includes(ph)){const label=ph==='pecheur_discard'?'Défausser la carte':ph==='chance_discard'?'Défausser la carte':'Défausser la carte',b=actionButton(label,'primary primary-action',()=>{if(selectedCard){fx('click');send({type:'discard',cardId:selectedCard})}});b.disabled=!selectedCard;a.appendChild(b)}
  else if(ph==='post_discard'){const canPok=(me.hand||[]).length===5&&(me.hand||[]).every(c=>c.type==='normal'),pok=actionButton('POK POK !','primary gold',()=>{fx('pok');send({type:'announce_pok'})});pok.disabled=!canPok;a.appendChild(pok);a.appendChild(actionButton('Finir mon tour','secondary',()=>{fx('click');send({type:'end_turn'})}))}
  else if(ph==='voleur_give'){const b=actionButton('Donner cette carte','primary primary-action',()=>{if(selectedCard){fx('click');send({type:'voleur_give',cardId:selectedCard})}});b.disabled=!selectedCard;a.appendChild(b)}
  else if(['target_blocage','target_voleur'].includes(ph)){const b=actionButton('Choisissez un joueur','secondary',()=>{});b.disabled=true;a.appendChild(b)}
  else if(ph==='bombe_target'){if(snapshot.validTargets?.includes(snapshot.meIndex))a.appendChild(actionButton('💣 Bombe sur moi','secondary',()=>send({type:'bonus_target',target:snapshot.meIndex})));const b=actionButton('Cliquez sur un joueur','secondary',()=>{});b.disabled=true;a.appendChild(b)}
  else if(ph==='final_choice'){a.appendChild(actionButton('Piocher puis défausser','primary primary-action',()=>send({type:'final_draw'})));a.appendChild(actionButton('Ne rien faire / conserver','secondary',()=>send({type:'final_keep'})))}
}
$('drawPile').onclick=()=>{if(snapshot?.started&&snapshot.currentIndex===snapshot.meIndex&&snapshot.phase==='normal_draw'){fx('click');send({type:'draw'})}};
function renderTargets(){const self=$('humanSeat'),isSelf=snapshot.validTargets?.includes(snapshot.meIndex);self.classList.toggle('targetable',!!isSelf);self.onclick=isSelf?e=>{if(e.target.closest('.hand-card,.actions,.reaction-wrap'))return;send({type:'bonus_target',target:snapshot.meIndex})}:null}


/* ---------- Ajustements V0.33 : aucune collision texte / cartes en portrait ou paysage ---------- */
function fitHumanHand32(){
  const hand=$('humanHand');if(!hand)return;const cards=[...hand.querySelectorAll('.hand-card')];const n=cards.length;if(!n)return;
  const mobile=innerWidth<=760||innerHeight<=600;if(!mobile){cards.forEach(c=>{c.style.removeProperty('height');c.style.removeProperty('margin-left')});return}
  const portrait=innerHeight>=innerWidth,avail=Math.max(220,hand.clientWidth-10),ratio=416/603;
  let h=portrait?Math.min(138,Math.max(106,innerHeight*.168)):Math.min(112,Math.max(74,innerHeight*.245));
  let w=h*ratio,step=n===1?w:(avail-w)/(n-1);step=Math.max(w*.28,Math.min(w*.90,step));let overlap=step-w;
  cards.forEach((c,i)=>{c.style.setProperty('height',`${h.toFixed(1)}px`,'important');c.style.setProperty('margin-left',i===0?'0px':`${overlap.toFixed(1)}px`,'important')});
}
function alignHumanActions32(){
  const actions=$('actions'),hand=$('humanHand'),seat=$('humanSeat'),score=$('meScore');if(!actions||!hand||!seat||!score)return;const cards=[...hand.querySelectorAll('.hand-card')].filter(x=>x.offsetParent!==null);if(!cards.length)return;
  const sr=seat.getBoundingClientRect(),rects=cards.map(c=>c.getBoundingClientRect()),cardsBottom=Math.max(...rects.map(r=>r.bottom)),scoreTop=score.getBoundingClientRect().top,ah=Math.max(26,actions.getBoundingClientRect().height||26);
  const upper=cardsBottom+5,lower=scoreTop-7;let center=(upper+lower)/2-sr.top;if(lower-upper<ah+4)center=(scoreTop-ah-9)-sr.top+ah/2;center=Math.max(ah/2+5,Math.min(sr.height-ah/2-5,center));actions.style.setProperty('--action-center-y32',`${center.toFixed(1)}px`)
}
function fitText32(el,min=9){if(!el||!el.clientWidth||!el.clientHeight)return;el.style.removeProperty('font-size');let size=parseFloat(getComputedStyle(el).fontSize)||14;let guard=20;while(guard--&&size>min&&(el.scrollWidth>el.clientWidth+1||el.scrollHeight>el.clientHeight+2)){size-=.5;el.style.fontSize=`${size}px`}}
function protectTextLayout32(){
  document.querySelectorAll('.actions button,.pile-label-main,.turn-title,.turn-hint,.turn-now-badge,.human-player-line,.hand-eval,.badge,.feature-chip,.shop-badge,.game-choice-button').forEach(el=>fitText32(el,el.classList.contains('turn-hint')?8:9));
  const zone=document.querySelector('.online-game-screen .v05-table-zone');if(zone)zone.style.setProperty('--v033-lift','0px');
  const table=$('centerStatus'),seat=$('humanSeat');if(table&&seat&&zone&&(innerWidth<=760||innerHeight<=600)){const tr=table.getBoundingClientRect(),sr=seat.getBoundingClientRect();if(tr.bottom>sr.top-10){const delta=tr.bottom-(sr.top-10);zone.style.setProperty('--v033-lift',`${Math.ceil(delta)}px`)}}
}
window.addEventListener('resize',()=>requestAnimationFrame(()=>{fitHumanHand32();alignHumanActions32();protectTextLayout32()}));
/* ---------- Chrono 45 s / résultats ---------- */
function updateClockDom(){
  const wrap=$('turnTimer'),value=$('turnTimerValue');if(!snapshot?.started||snapshot.roundResult){if(wrap)wrap.classList.add('hidden');return}wrap.classList.remove('hidden');const now=Date.now();let left=45;if(snapshot.turnClockStart&&now<snapshot.turnClockStart)left=45;else if(snapshot.turnDeadline)left=Math.max(0,Math.ceil((snapshot.turnDeadline-now)/1000));value.textContent=left;wrap.classList.toggle('warning',left<=10&&left>5);wrap.classList.toggle('danger',left<=5);
}
function updateResultCountdown(){const wrap=$('resultCountdown'),val=$('resultCountdownValue');if(!snapshot?.roundResult||snapshot.roundResult.gameOver||!snapshot.resultDeadline){wrap.classList.add('hidden');return}wrap.classList.remove('hidden');val.textContent=Math.max(0,Math.ceil((snapshot.resultDeadline-Date.now())/1000))}
setInterval(()=>{updateClockDom();updateResultCountdown()},200);

/* ---------- Résultats ---------- */
function renderResult(){
  const m=$('roundModal'),r=snapshot.roundResult;if(!r){m.classList.add('hidden');return}m.classList.remove('hidden');$('resultTitle').textContent=r.title;$('resultNote').textContent=r.note;$('rubiesResult').textContent=r.rubiesNote||'';updateResultCountdown();const wrap=$('resultHands');wrap.innerHTML='';wrap.dataset.count=String((r.reveal||[]).length);
  (r.reveal||[]).forEach(x=>{const d=document.createElement('div');d.className='result-player'+(r.winners?.includes(x.index)?' winner':'');d.innerHTML=`<h3>${ANIMAL[x.avatar]?.[1]||'🦆'} ${escapeHtml(x.name)}</h3><div class="result-combo">${escapeHtml(x.eval.name)} • ${x.eval.points} pts</div><div class="cards">${x.hand.map(c=>`<img src="${imgFor(c)}">`).join('')}</div><div class="delta">${(r.deltas?.[x.index]||0)>0?'+':''}${r.deltas?.[x.index]||0} pts</div><b>Total : ${x.score}</b>`;wrap.appendChild(d)});
  const btn=$('nextRoundBtn');if(r.gameOver){btn.classList.remove('hidden');btn.textContent='Retour au menu';btn.onclick=returnToMenu}else{btn.classList.toggle('hidden',snapshot.meIndex!==snapshot.players.findIndex(Boolean));btn.textContent='Manche suivante';btn.onclick=()=>send({type:'next_round'})}
}
function returnToMenu(){clearRoomLocal();snapshot=null;prevSnapshot=null;selectedCard=null;$('roundModal').classList.add('hidden');$('roomBox').classList.add('hidden');showHome()}

/* ---------- Réactions ---------- */
$('reactionToggle').onclick=e=>{e.stopPropagation();$('reactionPalette').classList.toggle('hidden')};document.querySelectorAll('.reaction-emoji').forEach(b=>b.onclick=e=>{e.stopPropagation();$('reactionPalette').classList.add('hidden');send({type:'reaction',emoji:b.dataset.emoji})});
function showReaction(actor,emoji){const seat=seatEl(actor),p=centerOf(seat),d=document.createElement('div');d.className='player-reaction-bubble';d.textContent=emoji;d.style.left=`${p.x}px`;d.style.top=`${p.y-20}px`;$('fxLayer').appendChild(d);spawnSparkles({x:p.x,y:p.y-25},10,'gold');setTimeout(()=>d.remove(),1200)}

/* ---------- Effets visuels de partie ---------- */
function centerOf(el){if(!el)return{x:innerWidth/2,y:innerHeight/2};const r=el.getBoundingClientRect();return{x:r.left+r.width/2,y:r.top+r.height/2}}
function seatEl(index){return index===snapshot?.meIndex?$('humanSeat'):$(`seat-player-${index}`)}
function cardSourceForActor(actor,prev,next,mode){if(!next||actor!==next.meIndex)return'assets/card_back.jpg';const before=prev?.players?.[prev.meIndex]?.hand||[],after=next.players[next.meIndex]?.hand||[];if(mode==='draw'){const ids=new Set(before.map(c=>c.id));const c=after.find(x=>!ids.has(x.id));return c?imgFor(c):'assets/card_back.jpg'}const ids=new Set(after.map(c=>c.id));const c=before.find(x=>!ids.has(x.id));return c?imgFor(c):'assets/card_back.jpg'}
function flyCard(src,from,to,duration=330,delay=0,rotation=7){return new Promise(resolve=>setTimeout(()=>{const e=document.createElement('div');e.className='flying-card';e.innerHTML=`<img src="${src}">`;e.style.left=`${from.x-38}px`;e.style.top=`${from.y-54}px`;$('fxLayer').appendChild(e);requestAnimationFrame(()=>{e.style.transform=`translate(${to.x-from.x}px,${to.y-from.y}px) scale(.94) rotate(${rotation}deg)`});setTimeout(()=>{e.style.opacity='0';setTimeout(()=>{e.remove();resolve()},110)},duration)},delay))}
function handMove(from,to,duration=300,delay=0,emoji='🤚',label=''){return new Promise(resolve=>setTimeout(()=>{const h=document.createElement('div');h.className='fx-hand v031-hand';h.textContent=emoji;h.dataset.label=label;h.style.left=`${from.x-31}px`;h.style.top=`${from.y-31}px`;$('fxLayer').appendChild(h);h.animate([{transform:'translate(0,0) rotate(-18deg) scale(.72)',opacity:0},{offset:.14,transform:'translate(0,0) rotate(-8deg) scale(1.06)',opacity:1},{offset:.72,transform:`translate(${(to.x-from.x)*.78}px,${(to.y-from.y)*.78-12}px) rotate(8deg) scale(1.12)`,opacity:1},{transform:`translate(${to.x-from.x}px,${to.y-from.y}px) rotate(16deg) scale(.82)`,opacity:0}],{duration:duration+110,easing:'cubic-bezier(.16,.78,.18,1)',fill:'forwards'});setTimeout(()=>{h.remove();resolve()},duration+125)},delay))}
async function animateDraw(actor,prev,next,delay=0){const seat=centerOf(seatEl(actor)),pile=centerOf($('drawPile'));fx('draw');await handMove(seat,pile,210,delay,'🫴','PIOCHE');await Promise.all([flyCard(cardSourceForActor(actor,prev,next,'draw'),pile,seat,300,0,-6),handMove(pile,seat,295,0,'🤚','PIOCHE')])}
async function animateDiscard(actor,prev,next,delay=0,forceBack=false){const seat=centerOf(seatEl(actor)),pile=centerOf($('discardPile'));fx('discard');await Promise.all([flyCard(forceBack?'assets/card_back.jpg':cardSourceForActor(actor,prev,next,'discard'),seat,pile,310,delay,8),handMove(seat,pile,300,delay,'🤚','DÉFAUSSE')])}
function spawnSparkles(point,count=18,kind='gold'){const glyphs=kind==='pok'?['✦','✨','★','✧','💫']:kind==='bomb'?['✦','💥','✹','◆','✷']:['✦','•','◆','✧','✨'];for(let i=0;i<count;i++){const s=document.createElement('div');s.className='spark';s.textContent=glyphs[i%glyphs.length];s.style.left=`${point.x}px`;s.style.top=`${point.y}px`;const a=Math.random()*Math.PI*2,d=38+Math.random()*(kind==='pok'?145:100);s.style.setProperty('--dx',`${Math.cos(a)*d}px`);s.style.setProperty('--dy',`${Math.sin(a)*d}px`);s.style.color=i%3===0?'#ff4fbd':i%4===0?'#6deeff':'#ffe85a';$('fxLayer').appendChild(s);setTimeout(()=>s.remove(),1050)}}

function comicPoof31(index,text='POK !',emoji='✨',delay=0,big=false){const el=seatEl(index);if(!el)return;const p=centerOf(el);setTimeout(()=>{const d=document.createElement('div');d.className=`cartoon-poof ${big?'big':''}`;d.innerHTML=`${emoji}<span class="fun-word">${escapeHtml(text)}</span>`;d.style.left=`${p.x}px`;d.style.top=`${p.y}px`;$('fxLayer').appendChild(d);setTimeout(()=>d.remove(),1250)},delay)}
function eventAccent31(kind='bonus',count=10){const p=centerOf($('centerStatus'));const halo=document.createElement('div');halo.className=`v031-event-halo ${kind}`;halo.style.left=`${p.x}px`;halo.style.top=`${p.y}px`;$('fxLayer').appendChild(halo);setTimeout(()=>halo.remove(),850);spawnSparkles(p,count,kind==='pok'?'pok':kind==='bomb'?'bomb':'gold')}
function showBurst(ev,duration=1500){const box=$('eventBurst'),art=$('eventBurstArt'),titles={pokpok:'✨ POK POK ! ✨',chance:'🍀 CHANCE !',blocage:'🚫 BLOCAGE !',voleur:'🦝 VOLEUR !',pecheur:'🐟 PÊCHEUR !',bombe:'💥 BOMBE !',deal:'🃏 DISTRIBUTION',disconnect:'⚠ CONNEXION',blocked:'🚫 TOUR BLOQUÉ',shuffle:'🔀 NOUVELLE PIOCHE'};box.className=`event-burst ${ev.kind==='pokpok'?'pok':ev.kind==='bombe'?'bombe':''}`;$('eventBurstTitle').textContent=titles[ev.kind]||'POK POK';$('eventBurstText').textContent=ev.text||'';art.innerHTML=BONUS_IMG[ev.kind]?`<img src="assets/cards/${BONUS_IMG[ev.kind]}">`:'';box.classList.add('show');const p=centerOf(box);spawnSparkles(p,ev.kind==='pokpok'?58:ev.kind==='bombe'?34:24,ev.kind==='pokpok'?'pok':ev.kind==='bombe'?'bomb':'gold');clearTimeout(box._timer);box._timer=setTimeout(()=>box.classList.remove('show'),duration)}
async function animateDeal(ev){const arena=$('arena');arena.classList.add('is-dealing');const banner=document.createElement('div');banner.className='deal-banner';banner.textContent='🃏 Distribution des cartes…';document.body.appendChild(banner);const counters={},order=ev.dealOrder||[];await wait(120);for(let k=0;k<order.length;k++){const idx=order[k],seat=seatEl(idx);if(!seat)continue;const from=centerOf($('drawPile')),to=centerOf(seat),count=counters[idx]||0;let src='assets/card_back.jpg';if(idx===snapshot.meIndex){const c=snapshot.players[idx].hand?.[count];if(c)src=imgFor(c)}fx('deal');flyCard(src,from,to,145,0,(k%2?6:-6));handMove(from,to,140,0,'🤚','DISTRIBUE');await wait(105);const cards=idx===snapshot.meIndex?$('humanHand').querySelectorAll('.hand-card'):seat.querySelectorAll('.mini-card');cards[count]?.classList.add('deal-revealed');counters[idx]=count+1}await wait(120);arena.classList.remove('is-dealing');arena.querySelectorAll('.hand-card,.mini-card').forEach(x=>x.classList.add('deal-revealed'));banner.remove()}
function removedBonus(prev,next){if(!prev||!next||next.meIndex!==prev.meIndex)return null;const before=prev.players?.[prev.meIndex]?.hand||[],after=next.players[next.meIndex]?.hand||[],ids=new Set(after.map(c=>c.id));return before.find(c=>c.type==='bonus'&&!ids.has(c.id))||null}
async function animateVoleur(ev){const a=centerOf(seatEl(ev.actor)),t=centerOf(seatEl(ev.target));showBurst(ev,1350);if(ev.transfer==='take'){comicPoof31(ev.target,'CHIPÉE !','🦝🐾',180,true);await handMove(a,t,280,0,'🫴','PREND');await Promise.all([flyCard('assets/card_back.jpg',t,a,360,0,-10),handMove(t,a,350,0,'🤚','RÉCUPÈRE')]);comicPoof31(ev.actor,'HÉ HÉ !','🃏',120,false)}else if(ev.transfer==='give'){comicPoof31(ev.actor,'JE RENDS','🃏',120,false);await Promise.all([flyCard('assets/card_back.jpg',a,t,370,0,10),handMove(a,t,360,0,'🤚','REND')]);comicPoof31(ev.target,'REÇUE !','🤲',80,false)}spawnSparkles(ev.transfer==='take'?a:t,24,'gold')}
async function animateBombe(ev,next){const target=ev.target,seat=centerOf(seatEl(target)),discard=centerOf($('discardPile')),draw=centerOf($('drawPile'));fx('bomb');document.body.classList.add('screen-shake');setTimeout(()=>document.body.classList.remove('screen-shake'),480);spawnSparkles(seat,42,'bomb');for(let i=0;i<Math.min(ev.discardSteps||5,7);i++){flyCard('assets/card_back.jpg',{x:seat.x+(i-3)*10,y:seat.y},discard,220,i*38,((i%2)*12)-6);handMove(seat,discard,210,i*38,'🤚','DÉFAUSSE')}await wait(310);for(let i=0;i<5;i++){const src=target===next.meIndex&&next.players[target].hand?.[i]?imgFor(next.players[target].hand[i]):'assets/card_back.jpg';flyCard(src,draw,seat,230,i*58,((i%2)*10)-5);handMove(draw,seat,220,i*58,'🤚','PIOCHE')}await wait(440)}
async function playEvent(ev,prev,next){
  if(eventBusy&&ev.kind!=='reaction')await wait(80);eventBusy=true;try{
    if(ev.kind==='deal'){showBurst(ev,800);await wait(120);await animateDeal(ev);return}
    if(ev.kind==='draw'){await animateDraw(ev.actor,prev,next);return}
    if(ev.kind==='discard'){await animateDiscard(ev.actor,prev,next,0,prev?.phase==='pecheur_discard');return}
    if(ev.kind==='pokpok'){fx('pok');showBurst(ev,2600);eventAccent31('pok',22);const p=centerOf(seatEl(ev.actor));spawnSparkles(p,72,'pok');setTimeout(()=>spawnSparkles(p,42,'pok'),330);setTimeout(()=>spawnSparkles(centerOf($('centerStatus')),34,'pok'),620);comicPoof31(ev.actor,'POK !','🥁',230,true);comicPoof31(ev.actor,'POK !','✨',650,true);return}
    if(ev.kind==='reaction'){showReaction(ev.actor,ev.emoji||'😊');return}
    if(ev.kind==='disconnect'||ev.kind==='blocked'||ev.kind==='shuffle'||ev.kind==='timeout'){showBurst(ev,1350);return}
    if(['chance','blocage','voleur','pecheur','bombe'].includes(ev.kind)){
      fx('bonus');const bonus=removedBonus(prev,next);if(bonus&&ev.actor===next.meIndex)await animateDiscard(ev.actor,prev,next,0,false);else if(prev?.phase==='normal_discard'&&ev.actor!==next.meIndex)await animateDiscard(ev.actor,prev,next,0,true);
      if(ev.kind==='voleur'&&ev.transfer){await animateVoleur(ev);return}
      if(ev.kind==='pecheur'&&ev.discardStep){await animateDiscard(ev.actor,prev,next,0,true);comicPoof31(ev.actor,`${ev.discardStep}/3`,'🐟',180,false);return}
      showBurst(ev,ev.kind==='bombe'?1900:1550);eventAccent31(ev.kind==='bombe'?'bomb':ev.kind,ev.kind==='bombe'?18:11);if(ev.kind==='blocage'&&ev.target!==undefined){comicPoof31(ev.target,'BLOQUÉ !','🦍',430,true);comicPoof31(ev.target,'BONK !','🍌',820,false)}if(ev.kind==='chance'){comicPoof31(ev.actor,'CHANCE !','🍀',430,true)}if(ev.kind==='pecheur'){comicPoof31(ev.actor,'PÊCHE !','🐟',420,true)}if(ev.kind==='bombe'&&ev.target!==undefined){comicPoof31(ev.target,'BOUM !','💥',500,true)}
      if(ev.kind==='chance'&&ev.drawSteps)await animateDraw(ev.actor,prev,next,80);
      if(ev.kind==='pecheur'&&ev.drawSteps){for(let i=0;i<ev.drawSteps;i++){await animateDraw(ev.actor,i===0?prev:null,next,i===0?70:0);await wait(45)}}
      if(ev.kind==='bombe'&&ev.target!==undefined&&ev.drawSteps)await animateBombe(ev,next);
      if(ev.kind==='blocage'&&ev.target!==undefined)spawnSparkles(centerOf(seatEl(ev.target)),25,'gold');return;
    }
  }finally{eventBusy=false}
}

/* ---------- Quitter ---------- */
$('quitBtn').onclick=()=>{$('quitModal').classList.remove('hidden');fx('click')};$('cancelQuitBtn').onclick=()=>$('quitModal').classList.add('hidden');$('confirmQuitBtn').onclick=()=>{fx('click');send({type:'leave_room'})};

/* ---------- Règles ---------- */
$('rulesBtn').onclick=()=>{$('rulesModal').classList.remove('hidden');ruleZoom=1;renderRule();applyRuleZoom();fx('click')};$('closeRules').onclick=()=>{$('rulesModal').classList.add('hidden');ruleZoom=1;applyRuleZoom()};
function renderRule(){$('rulePage').src=`assets/rules/page-${String(rulePage).padStart(2,'0')}.jpg`;$('ruleCounter').textContent=`${rulePage} / 16`;$('rulesPageCounter').textContent=`Page ${rulePage} / 16`;ruleZoom=1;requestAnimationFrame(applyRuleZoom)}
function prevRule(){rulePage=rulePage<=1?16:rulePage-1;renderRule();fx('click')}function nextRule(){rulePage=rulePage>=16?1:rulePage+1;renderRule();fx('click')}
function applyRuleZoom(){const layer=$('bookZoomLayer'),shell=$('bookPageShell'),img=$('rulePage');if(!layer||!shell||!img)return;const z=Math.max(1,Math.min(3,ruleZoom));ruleZoom=z;$('ruleZoomValue').textContent=`${Math.round(z*100)}%`;shell.classList.toggle('zoomed',z>1.001);layer.classList.toggle('zoom-ready',z>1.001);if(z<=1){layer.style.width='';layer.style.height='';shell.scrollLeft=0;shell.scrollTop=0;return}const baseW=Math.min(shell.clientWidth-8,(img.naturalWidth||744));const ratio=(img.naturalHeight||1051)/(img.naturalWidth||744);layer.style.width=`${baseW*z}px`;layer.style.height=`${baseW*ratio*z}px`}
function changeRuleZoom(delta){ruleZoom=Math.max(1,Math.min(3,Math.round((ruleZoom+delta)*10)/10));applyRuleZoom();fx('click')}
$('ruleZoomIn').onclick=()=>changeRuleZoom(.25);$('ruleZoomOut').onclick=()=>changeRuleZoom(-.25);$('ruleZoomValue').onclick=()=>{ruleZoom=1;applyRuleZoom()};$('prevRule').onclick=prevRule;$('nextRule').onclick=nextRule;$('prevRuleText').onclick=prevRule;$('nextRuleText').onclick=nextRule;
let rulePointers=new Map(),rulePinchStart=0,rulePinchZoom=1;const ruleShell=$('bookPageShell');
function pointerDist(){const a=[...rulePointers.values()];return a.length<2?0:Math.hypot(a[0].x-a[1].x,a[0].y-a[1].y)}
ruleShell.addEventListener('pointerdown',e=>{if(e.pointerType==='touch'){rulePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});try{ruleShell.setPointerCapture(e.pointerId)}catch{}if(rulePointers.size===2){rulePinchStart=pointerDist();rulePinchZoom=ruleZoom}}});
ruleShell.addEventListener('pointermove',e=>{if(!rulePointers.has(e.pointerId))return;rulePointers.set(e.pointerId,{x:e.clientX,y:e.clientY});if(rulePointers.size===2&&rulePinchStart>0){ruleZoom=Math.max(1,Math.min(3,rulePinchZoom*pointerDist()/rulePinchStart));applyRuleZoom();e.preventDefault()}});
function endRulePointer(e){rulePointers.delete(e.pointerId);if(rulePointers.size<2)rulePinchStart=0}ruleShell.addEventListener('pointerup',endRulePointer);ruleShell.addEventListener('pointercancel',endRulePointer);
ruleShell.addEventListener('wheel',e=>{if(e.ctrlKey||ruleZoom>1){e.preventDefault();changeRuleZoom(e.deltaY<0?.15:-.15)}},{passive:false});


/* ---------- Démarrage ---------- */
$('playersChoiceText').textContent='2 joueurs';$('targetChoiceText').textContent='Partie rapide - 500 points';setAuthMode('login');renderAvatarGrid();connect();initFederatedAuth();syncMusic();
