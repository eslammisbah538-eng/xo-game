// ================================================
// game.js — X O Arcade Edition (v2)
// NEW: Emoji reactions, Rematch system, Player state indicators
// ================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, update, onValue, remove, get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyDgDA_ib-YE70Ae7vUTpEkAgsAQABu6F8g",
  authDomain: "xo-game-28745.firebaseapp.com",
  databaseURL: "https://xo-game-28745-default-rtdb.firebaseio.com",
  projectId: "xo-game-28745",
  storageBucket: "xo-game-28745.firebasestorage.app",
  messagingSenderId: "619566815698",
  appId: "1:619566815698:web:f9434cbc6058d97d51d00b"
};

const firebaseApp = initializeApp(FIREBASE_CONFIG);
const db = getDatabase(firebaseApp);

// ================================================
// AUDIO ENGINE
// ================================================
let audioCtx = null;

function getAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  return audioCtx;
}

function playTone(freq, type, duration, vol = 0.3) {
  try {
    const ctx = getAudio();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    gain.gain.setValueAtTime(vol, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch { }
}

function sfxClick()  { playTone(440,'square',0.08,0.2); setTimeout(()=>playTone(660,'square',0.08,0.15),40); }
function sfxEnemy()  { playTone(330,'square',0.08,0.2); setTimeout(()=>playTone(220,'square',0.1,0.15),40); }
function sfxWin()    { [523,659,784,1047].forEach((n,i)=>setTimeout(()=>playTone(n,'square',0.15,0.25),i*100)); }
function sfxLose()   { [400,300,200,150].forEach((n,i)=>setTimeout(()=>playTone(n,'sawtooth',0.15,0.2),i*100)); }
function sfxDraw()   { playTone(330,'triangle',0.3,0.25); setTimeout(()=>playTone(330,'triangle',0.3,0.25),320); }
function sfxJoin()   { [262,330,392,523].forEach((n,i)=>setTimeout(()=>playTone(n,'square',0.12,0.2),i*80)); }
function sfxEmoji()  { playTone(800,'sine',0.05,0.15); setTimeout(()=>playTone(1000,'sine',0.04,0.1),60); }
function sfxTheirEmoji() { playTone(500,'sine',0.05,0.12); setTimeout(()=>playTone(700,'sine',0.04,0.1),50); }

document.addEventListener('click', () => { try { getAudio().resume(); } catch { } }, { once: true });

// ================================================
// GAME STATE
// ================================================
let roomId    = null;
let mySymbol  = null;
let gameBoard = Array(9).fill("");
let currentTurn = "X";
let gameOver  = false;
let scores    = { X:0, O:0, D:0 };
let roomRef   = null;
let unsubscribes = [];
let emojiCooldown = false;
let myRematchVote = null;   // null | "accept" | "decline"
let lastEmojiSeq  = 0;     // track emoji events from firebase

const WINS = [
  [0,1,2],[3,4,5],[6,7,8],
  [0,3,6],[1,4,7],[2,5,8],
  [0,4,8],[2,4,6]
];

// ================================================
// UTILS
// ================================================
function genCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({length:6},()=>chars[Math.floor(Math.random()*chars.length)]).join("");
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s=>s.classList.remove("active"));
  document.getElementById("screen-"+id).classList.add("active");
}

function checkWinner(board) {
  for (const [a,b,c] of WINS) {
    if (board[a] && board[a]===board[b] && board[a]===board[c])
      return { winner:board[a], line:[a,b,c] };
  }
  return null;
}

function clearListeners() {
  unsubscribes.forEach(fn => typeof fn==="function" && fn());
  unsubscribes = [];
}

function normalizeBoard(board) {
  const result = Array(9).fill("");
  if (!board) return result;
  if (Array.isArray(board)) {
    board.forEach((v,i) => { if (i<9) result[i] = v || ""; });
  } else if (typeof board === "object") {
    Object.keys(board).forEach(k => {
      const i = parseInt(k,10);
      if (!isNaN(i) && i>=0 && i<9) result[i] = board[k] || "";
    });
  }
  return result;
}

// ================================================
// PLAYER STATE INDICATOR
// ================================================
function setPlayerStates() {
  const meSlot  = document.getElementById("slot-me");
  const oppSlot = document.getElementById("slot-opp");

  if (gameOver) {
    meSlot.classList.remove("state-thinking","state-waiting","active-turn");
    oppSlot.classList.remove("state-thinking","state-waiting","active-turn");
    document.getElementById("state-me").textContent  = "STANDBY";
    document.getElementById("state-opp").textContent = "STANDBY";
    return;
  }

  const myTurn  = currentTurn === mySymbol;
  const oppSymbol = mySymbol === "X" ? "O" : "X";

  // me
  meSlot.classList.toggle("state-thinking", myTurn);
  meSlot.classList.toggle("state-waiting",  !myTurn);
  meSlot.classList.toggle("active-turn",    myTurn);
  meSlot.classList.remove("o-side"); // me is always X-side color
  document.getElementById("state-me").textContent = myTurn ? "THINKING" : "WAITING";

  // opponent
  oppSlot.classList.toggle("state-thinking", !myTurn);
  oppSlot.classList.toggle("state-waiting",   myTurn);
  oppSlot.classList.toggle("active-turn",    !myTurn);
  oppSlot.classList.toggle("o-side",         !myTurn);
  document.getElementById("state-opp").textContent = !myTurn ? "THINKING" : "WAITING";
}

// ================================================
// EMOJI REACTIONS
// ================================================
function spawnFloatingEmoji(emoji, isMine) {
  const stage = document.getElementById("emoji-stage");
  const el = document.createElement("div");
  el.className = "float-emoji " + (isMine ? "mine burst" : "theirs");
  el.textContent = emoji;

  // position: scatter horizontally
  const boardRect = document.getElementById("board").getBoundingClientRect();
  const centerX = boardRect.left + boardRect.width / 2;
  const baseX = isMine
    ? centerX - 80 + Math.random() * 60
    : centerX + 20  + Math.random() * 60;
  const baseY = boardRect.bottom - 20;

  el.style.left = baseX + "px";
  el.style.top  = baseY + "px";
  stage.appendChild(el);
  setTimeout(() => el.remove(), 1700);
}

// send emoji via Firebase
async function sendEmoji(emoji) {
  if (emojiCooldown || !roomRef || gameOver) return;
  emojiCooldown = true;

  // local visual immediately
  spawnFloatingEmoji(emoji, true);
  sfxEmoji();

  // write to firebase: { emoji, from, seq }
  const seq = Date.now();
  await update(roomRef, {
    lastEmoji: { emoji, from: mySymbol, seq }
  });

  // cooldown per button
  document.querySelectorAll(".emoji-btn").forEach(b => b.classList.add("cooldown"));
  setTimeout(() => {
    emojiCooldown = false;
    document.querySelectorAll(".emoji-btn").forEach(b => b.classList.remove("cooldown"));
  }, 1500);
}

// setup emoji bar
document.querySelectorAll(".emoji-btn").forEach(btn => {
  btn.addEventListener("click", () => sendEmoji(btn.dataset.emoji));
});

// ================================================
// REMATCH SYSTEM
// ================================================
function showRematchPanel() {
  myRematchVote = null;
  document.getElementById("rematch-panel").style.display = "block";
  document.getElementById("rematch-status").textContent  = "انت اخترت ايه؟";
  document.getElementById("btn-rematch-accept").classList.remove("voted");
  document.getElementById("btn-rematch-decline").classList.remove("voted");
}

function hideRematchPanel() {
  document.getElementById("rematch-panel").style.display = "none";
}

async function voteRematch(vote) {
  if (myRematchVote) return; // already voted
  myRematchVote = vote;
  sfxClick();

  // highlight chosen button
  if (vote === "accept") {
    document.getElementById("btn-rematch-accept").classList.add("voted");
  }

  // write vote to firebase
  const field = "rematch_" + mySymbol;
  await update(roomRef, { [field]: vote });
  document.getElementById("rematch-status").textContent = "في الانتظار...";
}

document.getElementById("btn-rematch-accept").addEventListener("click",  () => voteRematch("accept"));
document.getElementById("btn-rematch-decline").addEventListener("click", () => voteRematch("decline"));

// ================================================
// HOME
// ================================================
document.getElementById("btn-create").addEventListener("click", createRoom);
document.getElementById("btn-join").addEventListener("click", joinRoom);
document.getElementById("join-code").addEventListener("keydown", e => { if(e.key==="Enter") joinRoom(); });
document.getElementById("join-code").addEventListener("input", e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g,"");
});

async function createRoom() {
  sfxClick();
  roomId   = genCode();
  mySymbol = "X";
  roomRef  = ref(db, "rooms/"+roomId);

  await set(roomRef, {
    status: "waiting",
    board:  ["","","","","","","","",""],
    turn:   "X",
    scores: {X:0,O:0,D:0},
    result: "",
    winLine: [],
    restart: 0,
    lastEmoji: null,
    rematch_X: null,
    rematch_O: null
  });

  document.getElementById("room-code-display").textContent = roomId;
  showScreen("waiting");

  const unsub = onValue(roomRef, snap => {
    const data = snap.val();
    if (!data) return;
    if (data.status === "playing") {
      unsub();
      sfxJoin();
      scores = data.scores || {X:0,O:0,D:0};
      launchGame(data);
    }
  });
  unsubscribes.push(unsub);
}

async function joinRoom() {
  sfxClick();
  const code  = document.getElementById("join-code").value.trim().toUpperCase();
  const errEl = document.getElementById("join-err");
  errEl.textContent = "";

  if (code.length !== 6) { errEl.textContent = "► الكود لازم 6 حروف"; return; }

  const rRef = ref(db, "rooms/"+code);
  const snap = await get(rRef);
  const data = snap.val();

  if (!data)                    { errEl.textContent = "► الغرفة مش موجودة"; return; }
  if (data.status !== "waiting"){ errEl.textContent = "► الغرفة مش متاحة";  return; }

  roomId   = code;
  mySymbol = "O";
  roomRef  = rRef;
  scores   = data.scores || {X:0,O:0,D:0};

  await update(roomRef, { status:"playing", "players/O":true });
  sfxJoin();
  launchGame({ ...data, status:"playing" });
}

// ================================================
// WAITING
// ================================================
document.getElementById("btn-copy").addEventListener("click", () => {
  sfxClick();
  navigator.clipboard.writeText(roomId).then(() => {
    const btn = document.getElementById("btn-copy");
    btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg> اتنسخ!`;
    setTimeout(() => {
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg> نسخ الكود`;
    }, 1800);
  });
});

document.getElementById("btn-back-waiting").addEventListener("click", goHome);

// ================================================
// LAUNCH GAME
// ================================================
function launchGame(data) {
  gameBoard   = normalizeBoard(data.board);
  currentTurn = data.turn || "X";
  gameOver    = false;
  myRematchVote = null;
  lastEmojiSeq  = 0;

  // fill player symbols
  const oppSymbol = mySymbol === "X" ? "O" : "X";
  document.getElementById("sym-me").textContent  = mySymbol;
  document.getElementById("sym-opp").textContent = oppSymbol;

  // color opponent slot O-side always
  document.getElementById("slot-opp").classList.add("o-side");

  document.getElementById("result-msg").textContent = "";
  hideRematchPanel();
  updateScoreUI();
  renderBoard();
  updateTurnBanner();
  setPlayerStates();
  showScreen("game");
  listenRoom();
}

// ================================================
// LISTEN ROOM
// ================================================
function listenRoom() {
  if (!roomRef) return;
  const unsub = onValue(roomRef, snap => {
    const data = snap.val();
    if (!data) { goHome(); return; }

    // — emoji incoming —
    if (data.lastEmoji) {
      const { emoji, from, seq } = data.lastEmoji;
      if (seq > lastEmojiSeq && from !== mySymbol) {
        lastEmojiSeq = seq;
        spawnFloatingEmoji(emoji, false);
        sfxTheirEmoji();
      }
    }

    // — rematch votes —
    const xVote = data.rematch_X;
    const oVote = data.rematch_O;
    if (gameOver && (xVote || oVote)) {
      handleRematchVotes(xVote, oVote, data);
    }

    // — board / turn changes —
    const newBoard   = normalizeBoard(data.board);
    const boardChanged = JSON.stringify(newBoard) !== JSON.stringify(gameBoard);
    const turnChanged  = data.turn !== currentTurn;

    if (boardChanged || turnChanged) {
      const prevBoard = [...gameBoard];
      gameBoard   = newBoard;
      currentTurn = data.turn;
      scores      = data.scores || scores;

      const newMove = gameBoard.findIndex((v,i) => v && !prevBoard[i]);
      if (newMove !== -1 && gameBoard[newMove] !== mySymbol) sfxEnemy();

      renderBoard();
      updateTurnBanner();
      setPlayerStates();
      updateScoreUI();
    }

    if (data.result && !gameOver) {
      gameOver = true;
      scores   = data.scores || scores;
      updateScoreUI();
      applyResult(data.result, data.winLine || []);
    }
  });
  unsubscribes.push(unsub);
}

function handleRematchVotes(xVote, oVote, data) {
  const myVote  = mySymbol === "X" ? xVote : oVote;
  const oppVote = mySymbol === "X" ? oVote : xVote;
  const statusEl = document.getElementById("rematch-status");

  if (xVote && oVote) {
    // both voted
    if (xVote === "accept" && oVote === "accept") {
      // both want to play — reset
      statusEl.textContent = "بدأنا!";
      setTimeout(() => {
        hideRematchPanel();
        resetLocalGame(data);
        update(roomRef, {
          board: ["","","","","","","","",""],
          turn: "X",
          result: "",
          winLine: [],
          restart: Date.now(),
          rematch_X: null,
          rematch_O: null,
          lastEmoji: null
        });
      }, 800);
    } else {
      // someone declined — go home
      statusEl.textContent = "اللعبة انتهت";
      setTimeout(() => goHome(), 1200);
    }
  } else if (myVote === "accept" && !oppVote) {
    statusEl.textContent = "في الانتظار... هو بيفكر";
  } else if (myVote === "decline") {
    statusEl.textContent = "رفضت الجولة";
  }
}

// ================================================
// BOARD
// ================================================
function renderBoard() {
  const boardEl = document.getElementById("board");
  boardEl.innerHTML = "";

  gameBoard.forEach((val, i) => {
    const cell = document.createElement("div");
    cell.className = "cell";
    if (val) {
      cell.classList.add("taken", val==="X" ? "x-mark" : "o-mark");
      cell.textContent = val;
    } else if (!gameOver && currentTurn === mySymbol) {
      cell.addEventListener("click", () => makeMove(i));
    }
    boardEl.appendChild(cell);
  });
}

async function makeMove(idx) {
  if (gameBoard[idx] || gameOver || currentTurn !== mySymbol) return;
  sfxClick();

  gameBoard[idx] = mySymbol;
  const result  = checkWinner(gameBoard);
  const isDraw  = !result && gameBoard.every(Boolean);
  const nextTurn = mySymbol === "X" ? "O" : "X";

  const updateData = { board:[...gameBoard], turn:nextTurn };

  if (result) {
    scores[mySymbol] = (scores[mySymbol]||0) + 1;
    updateData.scores  = scores;
    updateData.result  = mySymbol+"_win";
    updateData.winLine = result.line;
    gameOver = true;
  } else if (isDraw) {
    scores.D = (scores.D||0) + 1;
    updateData.scores  = scores;
    updateData.result  = "draw";
    updateData.winLine = [];
    gameOver = true;
  }

  await update(roomRef, updateData);
  renderBoard();
  updateTurnBanner();
  setPlayerStates();

  if (result)   applyResult(mySymbol+"_win", result.line);
  else if (isDraw) applyResult("draw", []);
}

// ================================================
// RESULT
// ================================================
function applyResult(res, winLine=[]) {
  const msgEl = document.getElementById("result-msg");

  if (res === "draw") {
    msgEl.className  = "result-msg draw";
    msgEl.textContent = "DRAW!";
    sfxDraw();
  } else {
    const winner = res.replace("_win","");
    if (winner === mySymbol) {
      msgEl.className  = "result-msg win";
      msgEl.textContent = "YOU WIN!";
      sfxWin();
    } else {
      msgEl.className  = "result-msg lose";
      msgEl.textContent = "GAME OVER";
      sfxLose();
      // shake board
      const boardEl = document.getElementById("board");
      boardEl.classList.add("shake");
      setTimeout(() => boardEl.classList.remove("shake"), 500);
    }

    if (winLine.length) {
      setTimeout(() => {
        const cells = document.querySelectorAll(".cell");
        winLine.forEach(i => cells[i]?.classList.add("win-cell"));
      }, 50);
    }
  }

  document.getElementById("turn-banner").style.opacity = "0.3";
  updateScoreUI();
  setPlayerStates();

  // show rematch panel after short delay
  setTimeout(showRematchPanel, 800);
}

// ================================================
// TURN BANNER
// ================================================
function updateTurnBanner() {
  const banner = document.getElementById("turn-banner");
  const text   = document.getElementById("turn-text");

  banner.style.opacity = "1";
  banner.className = "turn-banner " + (currentTurn==="X" ? "x-turn" : "o-turn");

  if (gameOver) { text.textContent = ""; return; }

  if (currentTurn === mySymbol) text.textContent = "► YOUR TURN ◄";
  else                          text.textContent = "WAITING...";
}

// ================================================
// SCORES
// ================================================
function updateScoreUI() {
  document.getElementById("score-x").textContent = scores.X || 0;
  document.getElementById("score-o").textContent = scores.O || 0;
  document.getElementById("score-d").textContent = scores.D || 0;
}

// ================================================
// RESET LOCAL
// ================================================
function resetLocalGame(data) {
  gameOver      = false;
  gameBoard     = Array(9).fill("");
  currentTurn   = "X";
  myRematchVote = null;
  document.getElementById("result-msg").textContent  = "";
  document.getElementById("result-msg").className    = "result-msg";
  document.getElementById("turn-banner").style.opacity = "1";
  renderBoard();
  updateTurnBanner();
  setPlayerStates();
}

// ================================================
// BACK / HOME
// ================================================
document.getElementById("btn-back-game").addEventListener("click", goHome);

async function goHome() {
  sfxClick();
  clearListeners();
  if (roomRef && mySymbol === "X") {
    try { await remove(roomRef); } catch { }
  }
  roomId = roomRef = mySymbol = null;
  gameBoard   = Array(9).fill("");
  currentTurn = "X";
  gameOver    = false;
  scores      = {X:0,O:0,D:0};
  myRematchVote = null;
  document.getElementById("join-code").value    = "";
  document.getElementById("join-err").textContent = "";
  showScreen("home");
}
