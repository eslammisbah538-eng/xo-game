// ================================================
// game.js — X O Arcade Edition
// ================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getDatabase, ref, set, update, onValue, remove, get
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDgDA_ib-YE70Ae7vUTpEkAgsAQABu6F8g",
  authDomain:        "xo-game-28745.firebaseapp.com",
  databaseURL:       "https://xo-game-28745-default-rtdb.firebaseio.com",
  projectId:         "xo-game-28745",
  storageBucket:     "xo-game-28745.firebasestorage.app",
  messagingSenderId: "619566815698",
  appId:             "1:619566815698:web:f9434cbc6058d97d51d00b"
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
  } catch {}
}

function sfxClick() {
  playTone(440, 'square', 0.08, 0.2);
  setTimeout(() => playTone(660, 'square', 0.08, 0.15), 40);
}

function sfxEnemy() {
  playTone(330, 'square', 0.08, 0.2);
  setTimeout(() => playTone(220, 'square', 0.1, 0.15), 40);
}

function sfxWin() {
  const notes = [523, 659, 784, 1047];
  notes.forEach((n, i) => setTimeout(() => playTone(n, 'square', 0.15, 0.25), i * 100));
}

function sfxLose() {
  const notes = [400, 300, 200, 150];
  notes.forEach((n, i) => setTimeout(() => playTone(n, 'sawtooth', 0.15, 0.2), i * 100));
}

function sfxDraw() {
  playTone(330, 'triangle', 0.3, 0.25);
  setTimeout(() => playTone(330, 'triangle', 0.3, 0.25), 320);
}

function sfxJoin() {
  [262, 330, 392, 523].forEach((n, i) => setTimeout(() => playTone(n, 'square', 0.12, 0.2), i * 80));
}

// unlock audio on first interaction
document.addEventListener('click', () => { try { getAudio().resume(); } catch {} }, { once: true });

// ================================================
// GAME STATE
// ================================================
let roomId      = null;
let mySymbol    = null;
let gameBoard   = Array(9).fill(null);
let currentTurn = "X";
let gameOver    = false;
let scores      = { X: 0, O: 0, D: 0 };
let roomRef     = null;
let unsubscribes = [];

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
  return Array.from({ length: 6 }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

function showScreen(id) {
  document.querySelectorAll(".screen").forEach(s => s.classList.remove("active"));
  document.getElementById("screen-" + id).classList.add("active");
}

function checkWinner(board) {
  for (const [a, b, c] of WINS) {
    if (board[a] && board[a] === board[b] && board[a] === board[c])
      return { winner: board[a], line: [a, b, c] };
  }
  return null;
}

function clearListeners() {
  unsubscribes.forEach(fn => typeof fn === "function" && fn());
  unsubscribes = [];
}

// ================================================
// HOME
// ================================================
document.getElementById("btn-create").addEventListener("click", createRoom);
document.getElementById("btn-join").addEventListener("click", joinRoom);
document.getElementById("join-code").addEventListener("keydown", e => {
  if (e.key === "Enter") joinRoom();
});
document.getElementById("join-code").addEventListener("input", e => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
});

async function createRoom() {
  sfxClick();
  roomId   = genCode();
  mySymbol = "X";
  roomRef  = ref(db, "rooms/" + roomId);

  await set(roomRef, {
    status: "waiting",
    board:  Array(9).fill(null),
    turn:   "X",
    scores: { X: 0, O: 0, D: 0 },
    result: null,
    winLine: [],
    restart: 0
  });

  document.getElementById("room-code-display").textContent = roomId;
  showScreen("waiting");

  const unsub = onValue(roomRef, snap => {
    const data = snap.val();
    if (!data) return;
    if (data.status === "playing") {
      unsub();
      sfxJoin();
      scores = data.scores || { X: 0, O: 0, D: 0 };
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

  const rRef = ref(db, "rooms/" + code);
  const snap = await get(rRef);
  const data = snap.val();

  if (!data)                    { errEl.textContent = "► الغرفة مش موجودة"; return; }
  if (data.status !== "waiting"){ errEl.textContent = "► الغرفة مش متاحة"; return; }

  roomId   = code;
  mySymbol = "O";
  roomRef  = rRef;
  scores   = data.scores || { X: 0, O: 0, D: 0 };

  await update(roomRef, { status: "playing", "players/O": true });
  sfxJoin();
  launchGame({ ...data, status: "playing" });
}

// ================================================
// WAITING
// ================================================
document.getElementById("btn-copy").addEventListener("click", () => {
  sfxClick();
  navigator.clipboard.writeText(roomId).then(() => {
    const btn = document.getElementById("btn-copy");
    btn.textContent = "✓ اتنسخ!";
    setTimeout(() => btn.textContent = "► نسخ الكود ◄", 1800);
  });
});

document.getElementById("btn-back-waiting").addEventListener("click", goHome);

// ================================================
// LAUNCH GAME
// ================================================
function launchGame(data) {
  gameBoard    = data.board || Array(9).fill(null);
  currentTurn  = data.turn  || "X";
  gameOver     = false;

  const symEl = document.getElementById("my-symbol-display");
  symEl.textContent = "PLAYER: " + mySymbol;
  symEl.className   = "my-symbol " + mySymbol.toLowerCase();

  document.getElementById("result-msg").textContent = "";
  updateScoreUI();
  renderBoard();
  updateTurnBanner();
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

    const boardChanged = JSON.stringify(data.board) !== JSON.stringify(gameBoard);
    const turnChanged  = data.turn !== currentTurn;

    if (boardChanged || turnChanged) {
      const prevBoard = [...gameBoard];
      gameBoard    = data.board;
      currentTurn  = data.turn;
      scores       = data.scores || scores;

      // play sound for opponent move
      const newMove = gameBoard.findIndex((v, i) => v && !prevBoard[i]);
      if (newMove !== -1 && gameBoard[newMove] !== mySymbol) sfxEnemy();

      renderBoard();
      updateTurnBanner();
      updateScoreUI();
    }

    if (data.result && !gameOver) {
      gameOver = true;
      scores = data.scores || scores;
      updateScoreUI();
      applyResult(data.result, data.winLine || []);
    }

    if (data.restart && gameOver) {
      resetLocalGame(data);
    }
  });
  unsubscribes.push(unsub);
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
      cell.classList.add("taken", val === "X" ? "x-mark" : "o-mark");
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
  const result = checkWinner(gameBoard);
  const isDraw = !result && gameBoard.every(Boolean);
  const nextTurn = mySymbol === "X" ? "O" : "X";

  const updateData = { board: gameBoard, turn: nextTurn };

  if (result) {
    scores[mySymbol] = (scores[mySymbol] || 0) + 1;
    updateData.scores  = scores;
    updateData.result  = mySymbol + "_win";
    updateData.winLine = result.line;
    gameOver = true;
  } else if (isDraw) {
    scores.D = (scores.D || 0) + 1;
    updateData.scores  = scores;
    updateData.result  = "draw";
    updateData.winLine = [];
    gameOver = true;
  }

  await update(roomRef, updateData);
  renderBoard();
  updateTurnBanner();

  if (result)  applyResult(mySymbol + "_win", result.line);
  else if (isDraw) applyResult("draw", []);
}

// ================================================
// RESULT
// ================================================
function applyResult(res, winLine = []) {
  const msgEl = document.getElementById("result-msg");

  if (res === "draw") {
    msgEl.className  = "result-msg draw";
    msgEl.textContent = "★ DRAW! ★";
    sfxDraw();
  } else {
    const winner = res.replace("_win", "");
    if (winner === mySymbol) {
      msgEl.className  = "result-msg win";
      msgEl.textContent = "★ YOU WIN! ★";
      sfxWin();
    } else {
      msgEl.className  = "result-msg lose";
      msgEl.textContent = "✗ GAME OVER ✗";
      sfxLose();
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
}

// ================================================
// TURN BANNER
// ================================================
function updateTurnBanner() {
  const banner = document.getElementById("turn-banner");
  const text   = document.getElementById("turn-text");

  banner.style.opacity = "1";
  banner.className = "turn-banner " + (currentTurn === "X" ? "x-turn" : "o-turn");

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
// RESTART
// ================================================
document.getElementById("btn-restart").addEventListener("click", async () => {
  sfxClick();
  if (!roomRef) return;
  const restartData = {
    board: Array(9).fill(null), turn: "X",
    result: null, winLine: [], restart: Date.now()
  };
  await update(roomRef, restartData);
  resetLocalGame(restartData);
});

function resetLocalGame(data) {
  gameOver    = false;
  gameBoard   = Array(9).fill(null);
  currentTurn = "X";
  document.getElementById("result-msg").textContent = "";
  document.getElementById("result-msg").className   = "result-msg";
  document.getElementById("turn-banner").style.opacity = "1";
  renderBoard();
  updateTurnBanner();
}

// ================================================
// BACK / HOME
// ================================================
document.getElementById("btn-back-game").addEventListener("click", goHome);

async function goHome() {
  sfxClick();
  clearListeners();
  if (roomRef && mySymbol === "X") {
    try { await remove(roomRef); } catch {}
  }
  roomId = roomRef = mySymbol = null;
  gameBoard   = Array(9).fill(null);
  currentTurn = "X";
  gameOver    = false;
  scores      = { X: 0, O: 0, D: 0 };
  document.getElementById("join-code").value = "";
  document.getElementById("join-err").textContent = "";
  showScreen("home");
}
