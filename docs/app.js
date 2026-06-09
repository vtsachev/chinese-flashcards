/* Chinese Flashcards — learning engine (Track L)
   Mechanisms: active recall (both directions), immediate feedback, Leitner SRS
   with localStorage persistence, interleaved review, progress + streak, audio. */

const $ = (s, r = document) => r.querySelector(s);
const app = $('#app');
const DAY = 86400000;
const BOX_DAYS = [0, 1, 3, 7, 16];      // Leitner intervals; box 5 (>=16d) = mastered
const STORE = 'cf_state_v1';

let CARDS = [];
let state = load();

function load(){ try { return JSON.parse(localStorage.getItem(STORE)) || fresh(); } catch { return fresh(); } }
function fresh(){ return { srs:{}, streak:{ day:null, count:0 }, best:0 }; }
function save(){ localStorage.setItem(STORE, JSON.stringify(state)); }
function today(){ const d=new Date(); return `${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}`; }

function srs(id){ return state.srs[id] || (state.srs[id] = { box:0, due:0, seen:0 }); }
function isMastered(id){ return (state.srs[id]?.box || 0) >= 5; }
function dueNow(){ const t=Date.now(); return CARDS.filter(c => { const s=state.srs[c.id]; return !s || s.due <= t; }); }

function grade(id, ok){
  const s = srs(id); s.seen++;
  s.box = ok ? Math.min(5, s.box + 1) : 1;
  s.due = Date.now() + BOX_DAYS[Math.min(s.box, BOX_DAYS.length-1)-1 < 0 ? 0 : s.box-1] * DAY;
  bumpStreak();
  save();
}
function bumpStreak(){
  const t = today();
  if (state.streak.day === t) return;
  const y = new Date(Date.now()-DAY); const yk = `${y.getFullYear()}-${y.getMonth()+1}-${y.getDate()}`;
  state.streak.count = (state.streak.day === yk) ? state.streak.count + 1 : 1;
  state.streak.day = t;
  state.best = Math.max(state.best||0, state.streak.count);
}

/* ---------- audio ---------- */
let current_audio = null;
function play(src){
  try { if(current_audio){current_audio.pause();} current_audio = new Audio(src); current_audio.play().catch(()=>{}); } catch {}
}

/* ---------- toast ---------- */
let toastT;
function toast(msg){
  const el = $('#toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(()=>el.classList.remove('show'), 1200);
}

/* ---------- shuffle / pick ---------- */
const shuffle = a => { a=[...a]; for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];} return a; };

/* ================= PRACTICE ================= */
let queue = [];
function startPractice(){
  queue = shuffle(dueNow());           // interleaved across all weeks
  nextCard();
}
function nextCard(){
  if (!queue.length) return practiceDone();
  const card = queue.shift();
  // alternate direction by seen-count so a child meets both recognize & produce
  const dir = (srs(card.id).seen % 2 === 0) ? 'recognize' : 'produce';
  (dir === 'recognize' ? recognizeView : produceView)(card);
}
function remaining(){ return queue.length; }

function recognizeView(card){
  app.innerHTML = `
    <div class="stage">
      <div class="prompt-label">Do you know this? 🤔</div>
      <div class="bigcard">
        <div class="hanzi zh">${card.term}</div>
        <button class="audio" id="say" aria-label="Listen">🔊</button>
      </div>
      <div class="btnrow"><button class="big reveal" id="reveal">Show answer</button></div>
    </div>`;
  $('#say').onclick = ()=>play(card.audio_term);
  play(card.audio_term);
  $('#reveal').onclick = ()=>{
    app.innerHTML = `
    <div class="stage">
      <div class="bigcard">
        <div class="hanzi zh">${card.term}</div>
        <div class="pinyin">${card.pinyin}</div>
        <div class="english">${card.english}</div>
        <div class="example"><span class="zh">${card.example_zh}</span>
          <span class="pinyin" style="font-size:1rem">${card.example_pinyin}</span>
          <span class="en">${card.example_en}</span></div>
        <button class="audio" id="say2" aria-label="Listen">🔊</button>
      </div>
      <div class="btnrow">
        <button class="big again" id="again">Again</button>
        <button class="big good" id="got">Got it! ✅</button>
      </div>
    </div>`;
    $('#say2').onclick = ()=>play(card.audio_example);
    $('#again').onclick = ()=>{ grade(card.id,false); queue.push(card); toast('We’ll see it again 🔁'); nextCard(); };
    $('#got').onclick  = ()=>{ grade(card.id,true); toast('Nice! 🎉'); nextCard(); };
  };
}

function produceView(card){
  const others = shuffle(CARDS.filter(c=>c.id!==card.id)).slice(0,3);
  const choices = shuffle([card, ...others]);
  app.innerHTML = `
    <div class="stage">
      <div class="prompt-label">Which character means this?</div>
      <div class="bigcard" style="min-height:160px">
        <div class="english">${card.english}</div>
        <button class="audio" id="say" aria-label="Listen">🔊</button>
      </div>
      <div class="choices" id="choices">
        ${choices.map(c=>`<button class="zh" data-id="${c.id}">${c.term}</button>`).join('')}
      </div>
    </div>`;
  $('#say').onclick = ()=>play(card.audio_term);
  play(card.audio_term);
  $('#choices').querySelectorAll('button').forEach(b=>{
    b.onclick = ()=>{
      const ok = b.dataset.id === card.id;
      $('#choices').querySelectorAll('button').forEach(x=>{
        x.disabled = true;
        if (x.dataset.id === card.id) x.classList.add('correct');
        else if (x === b) x.classList.add('wrong');
      });
      grade(card.id, ok);
      if (!ok) queue.push(card);
      toast(ok ? 'Correct! 🌟' : `It’s ${card.term} (${card.pinyin})`);
      setTimeout(nextCard, ok ? 750 : 1500);
    };
  });
}

function practiceDone(){
  const total = CARDS.length, mastered = CARDS.filter(c=>isMastered(c.id)).length;
  app.innerHTML = `
    <div class="stage">
      <div class="donebanner">🎉 All done for now!<br>You reviewed everything that was due.</div>
      <div class="bigcard" style="min-height:auto">
        <div class="english">Mastered <b>${mastered}</b> of <b>${total}</b> · 🔥 ${state.streak.count}-day streak</div>
        <button class="big" id="again" style="max-width:240px">Practice again</button>
      </div>
    </div>`;
  $('#again').onclick = startPractice;
}

/* ================= BROWSE ================= */
let browseWeek = null;
function browseView(){
  const weeks = [...new Set(CARDS.map(c=>c.week))].sort((a,b)=>a-b);
  if (browseWeek === null) browseWeek = weeks[0];
  const cards = CARDS.filter(c=>c.week===browseWeek);
  app.innerHTML = `
    <div class="weekbar">${weeks.map(w=>`<button class="${w===browseWeek?'active':''}" data-w="${w}">Week ${w}</button>`).join('')}</div>
    <div class="grid">${cards.map(c=>`
      <div class="tile" data-id="${c.id}">
        <div class="hanzi zh">${c.term}</div>
        <div class="pinyin">${c.pinyin}</div>
        <div class="english">${c.english}</div>
      </div>`).join('')}</div>`;
  app.querySelectorAll('.weekbar button').forEach(b=> b.onclick=()=>{browseWeek=+b.dataset.w; browseView();});
  app.querySelectorAll('.tile').forEach(t=> t.onclick=()=>detail(CARDS.find(c=>c.id===t.dataset.id)));
}
function detail(card){
  app.innerHTML = `
    <div class="stage">
      <div class="bigcard">
        <div class="hanzi zh">${card.term}</div>
        <div class="pinyin">${card.pinyin}</div>
        <div class="english">${card.english}</div>
        <div class="example"><span class="zh">${card.example_zh}</span>
          <span class="pinyin" style="font-size:1rem">${card.example_pinyin}</span>
          <span class="en">${card.example_en}</span></div>
        <div class="btnrow">
          <button class="audio" id="t" aria-label="Say word">🔊 词</button>
          <button class="audio" id="e" aria-label="Say sentence">🔊 句</button>
        </div>
      </div>
      <div class="btnrow"><button class="big" id="back" style="max-width:200px">← Back</button></div>
    </div>`;
  $('#t').onclick=()=>play(card.audio_term);
  $('#e').onclick=()=>play(card.audio_example);
  play(card.audio_term);
  $('#back').onclick=browseView;
}

/* ================= PROGRESS ================= */
function progressView(){
  const total = CARDS.length;
  const mastered = CARDS.filter(c=>isMastered(c.id)).length;
  const learning = CARDS.filter(c=>{const s=state.srs[c.id];return s&&s.box>0&&s.box<5;}).length;
  const due = dueNow().length;
  const pct = total? Math.round(mastered/total*100):0;
  app.innerHTML = `
    <div class="stats">
      <div class="stat"><div class="num">${mastered}</div><div class="lbl">Mastered</div></div>
      <div class="stat"><div class="num">${learning}</div><div class="lbl">Learning</div></div>
      <div class="stat"><div class="num">${due}</div><div class="lbl">Due now</div></div>
      <div class="stat"><div class="num">🔥 ${state.streak.count}</div><div class="lbl">Day streak</div></div>
    </div>
    <p class="muted" style="text-align:center;font-weight:700">${mastered} of ${total} mastered</p>
    <div class="bar"><span style="width:${pct}%"></span></div>
    ${due? `<div class="btnrow" style="margin-top:20px"><button class="big good" id="go" style="max-width:300px">Practice ${due} due cards →</button></div>`
         : `<div class="donebanner" style="margin-top:20px">✅ Nothing due right now — great job!</div>`}`;
  const go = $('#go'); if (go) go.onclick = ()=>switchView('practice');
}

/* ================= ROUTER ================= */
function switchView(v){
  document.querySelectorAll('#tabs button').forEach(b=>b.classList.toggle('active', b.dataset.view===v));
  if (v==='practice') startPractice();
  else if (v==='browse') browseView();
  else progressView();
}
document.querySelectorAll('#tabs button').forEach(b=> b.onclick=()=>switchView(b.dataset.view));

/* ================= BOOT ================= */
fetch('data/characters.json').then(r=>r.json()).then(d=>{
  CARDS = d.records;
  switchView('practice');
}).catch(e=>{ app.innerHTML = `<p class="muted">Could not load cards: ${e}</p>`; });
