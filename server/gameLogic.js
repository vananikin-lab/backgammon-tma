/**
 * Backgammon Game Logic
 * SHORT: standard rules, hitting blots allowed
 * LONG:  all 15 pieces start at opponent's corner, no hitting
 *
 * board[0..23]: positive = WHITE checkers, negative = BLACK checkers
 * WHITE moves 23→0 (bears off at index < 0)
 * BLACK moves  0→23 (bears off at index > 23)
 */

function getInitialBoard(type) {
  const b = new Array(24).fill(0);
  if (type === 'short') {
    b[23]=2; b[12]=5; b[7]=3; b[5]=5;
    b[0]=-2; b[11]=-5; b[16]=-3; b[18]=-5;
  } else {
    // Long: all pieces at starting corners
    b[23]=15; b[0]=-15;
  }
  return b;
}

function rollDie() { return Math.ceil(Math.random() * 6); }

function rollDice() {
  const d1 = rollDie(), d2 = rollDie();
  return d1 === d2 ? [d1,d1,d1,d1] : [d1,d2];
}

function getValidMoves(state, player, from, die) {
  const { board, bar, type } = state;
  const isWhite = player === 'white';
  const moves = [];
  const barCount = isWhite ? bar.white : bar.black;
  if (barCount > 0 && from !== 'bar') return [];

  if (from === 'bar') {
    const to = isWhite ? (24 - die) : (die - 1);
    if (to >= 0 && to <= 23 && canLand(board, to, player, type)) moves.push(to);
    return moves;
  }

  const to = isWhite ? from - die : from + die;
  if (isAllHome(board, bar, player)) {
    if (isWhite && to < 0) {
      if (to === -1 || canBearOffWith(board, bar, player, from, die)) moves.push('bearoff');
      return moves;
    }
    if (!isWhite && to > 23) {
      if (to === 24 || canBearOffWith(board, bar, player, from, die)) moves.push('bearoff');
      return moves;
    }
  }
  if (to >= 0 && to <= 23 && canLand(board, to, player, type)) moves.push(to);
  return moves;
}

function canLand(board, to, player, type) {
  const isWhite = player === 'white';
  const val = board[to];
  if (isWhite) {
    if (val >= 0) return true;
    if (type === 'long') return false;
    return val === -1; // blot
  } else {
    if (val <= 0) return true;
    if (type === 'long') return false;
    return val === 1;
  }
}

function isAllHome(board, bar, player) {
  const isWhite = player === 'white';
  if (isWhite && bar.white > 0) return false;
  if (!isWhite && bar.black > 0) return false;
  if (isWhite) { for (let i=6;i<=23;i++) if (board[i]>0) return false; }
  else         { for (let i=0;i<=17;i++) if (board[i]<0) return false; }
  return true;
}

function canBearOffWith(board, bar, player, from, die) {
  const isWhite = player === 'white';
  const exact = isWhite ? from - die : from + die;
  if (isWhite && exact === -1) return true;
  if (!isWhite && exact === 24) return true;
  if (isWhite) { for (let i=from+1;i<=5;i++) if (board[i]>0) return false; }
  else         { for (let i=from-1;i>=18;i--) if (board[i]<0) return false; }
  return true;
}

function applyMove(state, player, from, to) {
  const { board, bar } = state;
  const isWhite = player === 'white';
  const sign = isWhite ? 1 : -1;
  if (from === 'bar') { if (isWhite) bar.white--; else bar.black--; }
  else board[from] -= sign;
  if (to === 'bearoff') {
    if (isWhite) state.bearOff.white++; else state.bearOff.black++;
    return null;
  }
  let hit = null;
  if (isWhite && board[to]===-1) { board[to]=0; bar.black++; hit='black'; }
  else if (!isWhite && board[to]===1) { board[to]=0; bar.white++; hit='white'; }
  board[to] += sign;
  return hit;
}

function hasAnyMove(state, player, dice) {
  const { board, bar } = state;
  const isWhite = player === 'white';
  const positions = [];
  if ((isWhite && bar.white > 0) || (!isWhite && bar.black > 0)) {
    positions.push('bar');
  } else {
    for (let i=0;i<24;i++) {
      if (isWhite && board[i]>0) positions.push(i);
      if (!isWhite && board[i]<0) positions.push(i);
    }
  }
  const seen = new Set();
  for (const from of positions) {
    for (const die of dice) {
      const key = `${from}-${die}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (getValidMoves(state, player, from, die).length > 0) return true;
    }
  }
  return false;
}

function checkWinner(state) {
  if (state.bearOff.white === 15) return 'white';
  if (state.bearOff.black === 15) return 'black';
  return null;
}

function createGame(id, type, targetScore, players) {
  return {
    id, type, targetScore, players,
    board: getInitialBoard(type),
    bar: { white:0, black:0 },
    bearOff: { white:0, black:0 },
    currentPlayer: null,
    dice: [], diceRolled: false,
    phase: 'opening_roll',
    openingRolls: { white:null, black:null },
    scores: { white:0, black:0 },
    winner: null, roundWinner: null,
    turnHistory: [],
  };
}

function resetRound(state) {
  state.board = getInitialBoard(state.type);
  state.bar = { white:0, black:0 };
  state.bearOff = { white:0, black:0 };
  state.dice = []; state.diceRolled = false;
  state.phase = 'rolling'; state.roundWinner = null;
  state.turnHistory = [];
  state.currentPlayer = Math.random() < 0.5 ? 'white' : 'black';
}

module.exports = {
  createGame, resetRound,
  rollDie, rollDice,
  getValidMoves, applyMove, hasAnyMove, checkWinner, isAllHome,
};
