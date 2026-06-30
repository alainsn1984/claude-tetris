'use strict';

const COLS = 10;
const ROWS = 20;
const BLOCK = 30;

const COLORS = [
  null,
  '#4dd0e1', // I - cyan
  '#ffd54f', // O - yellow
  '#ba68c8', // T - purple
  '#81c784', // S - green
  '#e57373', // Z - red
  '#7986cb', // J - indigo
  '#ffb74d', // L - orange
];

const PIECES = [
  null,
  [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], // I
  [[2,2],[2,2]],                               // O
  [[0,3,0],[3,3,3],[0,0,0]],                  // T
  [[0,4,4],[4,4,0],[0,0,0]],                  // S
  [[5,5,0],[0,5,5],[0,0,0]],                  // Z
  [[6,0,0],[6,6,6],[0,0,0]],                  // J
  [[0,0,7],[7,7,7],[0,0,0]],                  // L
];

const LINE_SCORES = [0, 100, 300, 500, 800];

const canvas = document.getElementById('board');
const ctx = canvas.getContext('2d');
const nextCanvas = document.getElementById('next-canvas');
const nextCtx = nextCanvas.getContext('2d');
const scoreEl = document.getElementById('score');
const linesEl = document.getElementById('lines');
const levelEl = document.getElementById('level');
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayScore = document.getElementById('overlay-score');
const restartBtn = document.getElementById('restart-btn');
const startOverlay = document.getElementById('start-overlay');
const playBtn = document.getElementById('play-btn');
const startTable = document.getElementById('start-scores');
const startReset = document.getElementById('start-reset');
const overlayTable = document.getElementById('overlay-scores');
const overlayReset = document.getElementById('overlay-reset');
const nameForm = document.getElementById('name-form');
const nameInput = document.getElementById('name-input');
const overlayStats = document.getElementById('overlay-stats');
const startStats = document.getElementById('start-stats');

const SCORES_KEY = 'tetris.highscores';
const COMBO_KEY = 'tetris.bestCombo';
const MAXLINES_KEY = 'tetris.maxLines';
const MAX_SCORES = 5;

let board, current, next, score, lines, level, paused, gameOver, lastTime, dropAccum, dropInterval, animId, bestCombo;

function loadScores() {
  try {
    const raw = localStorage.getItem(SCORES_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(e => e && typeof e.name === 'string' && typeof e.score === 'number')
      .slice(0, MAX_SCORES);
  } catch (e) {
    return [];
  }
}

function saveScores(scores) {
  try {
    localStorage.setItem(SCORES_KEY, JSON.stringify(scores.slice(0, MAX_SCORES)));
  } catch (e) {}
}

function loadStat(key) {
  try {
    const n = parseInt(localStorage.getItem(key), 10);
    return Number.isFinite(n) ? n : 0;
  } catch (e) {
    return 0;
  }
}

function saveStat(key, value) {
  try {
    localStorage.setItem(key, String(value));
  } catch (e) {}
}

function qualifies(s) {
  if (s <= 0) return false;
  const scores = loadScores();
  if (scores.length < MAX_SCORES) return true;
  return s > scores[scores.length - 1].score;
}

function renderScoreTable(highlightIndex) {
  const scores = loadScores();
  let html = '<table class="score-table"><thead><tr><th>#</th><th>Nombre</th><th>Score</th></tr></thead><tbody>';
  if (scores.length === 0) {
    html += '<tr><td colspan="3" class="empty">Sin records</td></tr>';
  } else {
    scores.forEach((e, i) => {
      const cls = i === highlightIndex ? ' class="highlight"' : '';
      const name = String(e.name).replace(/[<>&]/g, '');
      html += `<tr${cls}><td>${i + 1}</td><td>${name}</td><td>${e.score.toLocaleString()}</td></tr>`;
    });
  }
  html += '</tbody></table>';
  const statsHtml = `Mejor combo: ${loadStat(COMBO_KEY)} · Líneas máx: ${loadStat(MAXLINES_KEY)}`;
  if (startTable) startTable.innerHTML = html;
  if (overlayTable) overlayTable.innerHTML = html;
  if (startStats) startStats.textContent = statsHtml;
  if (overlayStats) overlayStats.textContent = statsHtml;
}

function resetScores() {
  try {
    localStorage.removeItem(SCORES_KEY);
    localStorage.removeItem(COMBO_KEY);
    localStorage.removeItem(MAXLINES_KEY);
  } catch (e) {}
  renderScoreTable(-1);
}

function createBoard() {
  return Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
}

function randomPiece() {
  const type = Math.floor(Math.random() * 7) + 1;
  const shape = PIECES[type].map(row => [...row]);
  return { type, shape, x: Math.floor(COLS / 2) - Math.floor(shape[0].length / 2), y: 0 };
}

function collide(shape, ox, oy) {
  for (let r = 0; r < shape.length; r++) {
    for (let c = 0; c < shape[r].length; c++) {
      if (!shape[r][c]) continue;
      const nx = ox + c;
      const ny = oy + r;
      if (nx < 0 || nx >= COLS || ny >= ROWS) return true;
      if (ny >= 0 && board[ny][nx]) return true;
    }
  }
  return false;
}

function rotateCW(shape) {
  const rows = shape.length, cols = shape[0].length;
  const result = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++)
      result[c][rows - 1 - r] = shape[r][c];
  return result;
}

function tryRotate() {
  const rotated = rotateCW(current.shape);
  const kicks = [0, -1, 1, -2, 2];
  for (const kick of kicks) {
    if (!collide(rotated, current.x + kick, current.y)) {
      current.shape = rotated;
      current.x += kick;
      return;
    }
  }
}

function merge() {
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        board[current.y + r][current.x + c] = current.shape[r][c];
}

function clearLines() {
  let cleared = 0;
  for (let r = ROWS - 1; r >= 0; r--) {
    if (board[r].every(v => v !== 0)) {
      board.splice(r, 1);
      board.unshift(new Array(COLS).fill(0));
      cleared++;
      r++;
    }
  }
  if (cleared) {
    if (cleared > bestCombo) bestCombo = cleared;
    lines += cleared;
    score += (LINE_SCORES[cleared] || 0) * level;
    level = Math.floor(lines / 10) + 1;
    dropInterval = Math.max(100, 1000 - (level - 1) * 90);
    updateHUD();
  }
}

function ghostY() {
  let gy = current.y;
  while (!collide(current.shape, current.x, gy + 1)) gy++;
  return gy;
}

function hardDrop() {
  const gy = ghostY();
  score += (gy - current.y) * 2;
  current.y = gy;
  lockPiece();
}

function softDrop() {
  if (!collide(current.shape, current.x, current.y + 1)) {
    current.y++;
    score += 1;
    updateHUD();
  } else {
    lockPiece();
  }
}

function lockPiece() {
  merge();
  clearLines();
  spawn();
}

function spawn() {
  current = next;
  next = randomPiece();
  if (collide(current.shape, current.x, current.y)) {
    endGame();
  }
  drawNext();
}

function updateHUD() {
  scoreEl.textContent = score.toLocaleString();
  linesEl.textContent = lines;
  levelEl.textContent = level;
}

function drawBlock(context, x, y, colorIndex, size, alpha) {
  if (!colorIndex) return;
  const color = COLORS[colorIndex];
  context.globalAlpha = alpha ?? 1;
  context.fillStyle = color;
  context.fillRect(x * size + 1, y * size + 1, size - 2, size - 2);
  // highlight
  context.fillStyle = 'rgba(255,255,255,0.12)';
  context.fillRect(x * size + 1, y * size + 1, size - 2, 4);
  context.globalAlpha = 1;
}

function drawGrid() {
  ctx.strokeStyle = '#22222e';
  ctx.lineWidth = 0.5;
  for (let c = 1; c < COLS; c++) {
    ctx.beginPath();
    ctx.moveTo(c * BLOCK, 0);
    ctx.lineTo(c * BLOCK, ROWS * BLOCK);
    ctx.stroke();
  }
  for (let r = 1; r < ROWS; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * BLOCK);
    ctx.lineTo(COLS * BLOCK, r * BLOCK);
    ctx.stroke();
  }
}

function draw() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();

  // board
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      drawBlock(ctx, c, r, board[r][c], BLOCK);

  // ghost
  const gy = ghostY();
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      if (current.shape[r][c])
        drawBlock(ctx, current.x + c, gy + r, current.shape[r][c], BLOCK, 0.2);

  // current piece
  for (let r = 0; r < current.shape.length; r++)
    for (let c = 0; c < current.shape[r].length; c++)
      drawBlock(ctx, current.x + c, current.y + r, current.shape[r][c], BLOCK);
}

function drawNext() {
  const NB = 30;
  nextCtx.clearRect(0, 0, nextCanvas.width, nextCanvas.height);
  const shape = next.shape;
  const offX = Math.floor((4 - shape[0].length) / 2);
  const offY = Math.floor((4 - shape.length) / 2);
  for (let r = 0; r < shape.length; r++)
    for (let c = 0; c < shape[r].length; c++)
      drawBlock(nextCtx, offX + c, offY + r, shape[r][c], NB);
}

function endGame() {
  gameOver = true;
  cancelAnimationFrame(animId);

  if (bestCombo > loadStat(COMBO_KEY)) saveStat(COMBO_KEY, bestCombo);
  if (lines > loadStat(MAXLINES_KEY)) saveStat(MAXLINES_KEY, lines);

  overlayTitle.textContent = 'GAME OVER';
  overlayScore.textContent = `Puntuación: ${score.toLocaleString()}`;

  if (qualifies(score)) {
    nameForm.classList.remove('hidden');
    nameInput.value = '';
    nameInput.focus();
    renderScoreTable(-1);
  } else {
    nameForm.classList.add('hidden');
    renderScoreTable(-1);
  }

  overlay.classList.remove('hidden');
}

function commitScore() {
  const name = (nameInput.value.trim() || 'Anónimo').slice(0, 12);
  const scores = loadScores();
  scores.push({ name, score });
  scores.sort((a, b) => b.score - a.score);
  const trimmed = scores.slice(0, MAX_SCORES);
  saveScores(trimmed);
  const idx = trimmed.findIndex(e => e.name === name && e.score === score);
  nameForm.classList.add('hidden');
  renderScoreTable(idx);
}

function togglePause() {
  if (gameOver) return;
  paused = !paused;
  if (!paused) {
    lastTime = performance.now();
    loop(lastTime);
  } else {
    cancelAnimationFrame(animId);
    overlayTitle.textContent = 'PAUSA';
    overlayScore.textContent = '';
    overlay.classList.remove('hidden');
  }
}

function loop(ts) {
  const dt = ts - lastTime;
  lastTime = ts;
  dropAccum += dt;
  if (dropAccum >= dropInterval) {
    dropAccum = 0;
    if (!collide(current.shape, current.x, current.y + 1)) {
      current.y++;
    } else {
      lockPiece();
    }
  }
  draw();
  animId = requestAnimationFrame(loop);
}

function init() {
  board = createBoard();
  score = 0;
  lines = 0;
  level = 1;
  paused = false;
  gameOver = false;
  bestCombo = 0;
  dropInterval = 1000;
  dropAccum = 0;
  lastTime = performance.now();
  next = randomPiece();
  spawn();
  updateHUD();
  overlay.classList.add('hidden');
  startOverlay.classList.add('hidden');
  nameForm.classList.add('hidden');
  cancelAnimationFrame(animId);
  animId = requestAnimationFrame(loop);
}

document.addEventListener('keydown', e => {
  if (e.code === 'KeyP') { togglePause(); return; }
  if (paused || gameOver) return;
  switch (e.code) {
    case 'ArrowLeft':
      if (!collide(current.shape, current.x - 1, current.y)) current.x--;
      break;
    case 'ArrowRight':
      if (!collide(current.shape, current.x + 1, current.y)) current.x++;
      break;
    case 'ArrowDown':
      softDrop();
      break;
    case 'ArrowUp':
    case 'KeyX':
      tryRotate();
      break;
    case 'Space':
      e.preventDefault();
      hardDrop();
      break;
  }
  updateHUD();
});

restartBtn.addEventListener('click', init);
playBtn.addEventListener('click', init);

nameForm.addEventListener('submit', e => {
  e.preventDefault();
  commitScore();
});

startReset.addEventListener('click', resetScores);
overlayReset.addEventListener('click', resetScores);

renderScoreTable(-1);
startOverlay.classList.remove('hidden');
