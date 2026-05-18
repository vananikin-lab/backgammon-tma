/**
 * Backgammon Game Logic
 * Supports: Short backgammon (короткие нарды) and Long backgammon (длинные нарды)
 *
 * Board representation: array of 24 points (index 0 = point 1, index 23 = point 24)
 * Positive values = WHITE checkers count, Negative = BLACK checkers count
 *
 * WHITE moves: 23 → 0 (point 24 → point 1), bears off at index < 0
 * BLACK moves:  0 → 23 (point 1 → point 24), bears off at index > 23
 */

// ─── Starting positions ───────────────────────────────────────────────────────

function getInitialBoard(type) {
  const board = new Array(24).fill(0);

  if (type === 'short') {
    // Standard backgammon starting position
    board[23] = 2;   // White: 2 on point 24
    board[12] = 5;   // White: 5 on point 13
    board[7]  = 3;   // White: 3 on point 8
    board[5]  = 5;   // White: 5 on point 6
    board[0]  = -2;  // Black: 2 on point 1
    board[11] = -5;  // Black: 5 on point 12
    board[16] = -3;  // Black: 3 on point 17
    board[18] = -5;  // Black: 5 on point 19
  } else {
    // Long backgammon: all pieces on starting point
    board[23] = 15;  // White: 15 on point 24
    board[0]  = -15; // Black: 15 on point 1
  }

  return board;
}

// ─── Dice ─────────────────────────────────────────────────────────────────────

function rollDice() {
  const d1 = Math.ceil(Math.random() * 6);
  const d2 = Math.ceil(Math.random() * 6);
  return d1 === d2 ? [d1, d1, d1, d1] : [d1, d2];
}

// ─── Move validation ──────────────────────────────────────────────────────────

/**
 * Returns list of valid destination points for a checker at `from` using `die`
 */
function getValidMoves(state, player, from, die) {
  const { board, bar, type } = state;
  const isWhite = player === 'white';
  const sign = isWhite ? 1 : -1;

  const moves = [];

  // If player has checkers on bar, must enter first
  const barCount = isWhite ? bar.white : bar.black;
  if (barCount > 0 && from !== 'bar') return [];

  if (from === 'bar') {
    // White enters from point 25 side (index 24 - die) = index 24-die
    // Black enters from point 0 side (index die - 1)
    const to = isWhite ? (24 - die) : (die - 1);
    if (canLand(board, to, player, type)) {
      moves.push(to);
    }
    return moves;
  }

  const to = isWhite ? from - die : from + die;

  // Bear off
  const allHome = isAllHome(board, bar, player);
  if (allHome) {
    if (isWhite && to < 0) {
      // Exact or highest die when no higher checkers
      if (to === -1 || canBearOffWith(board, bar, player, from, die)) {
        moves.push('bearoff');
      }
      return moves;
    }
    if (!isWhite && to > 23) {
      if (to === 24 || canBearOffWith(board, bar, player, from, die)) {
        moves.push('bearoff');
      }
      return moves;
    }
  }

  // Normal move
  if (to >= 0 && to <= 23 && canLand(board, to, player, type)) {
    moves.push(to);
  }

  return moves;
}

function canLand(board, to, player, type) {
  const isWhite = player === 'white';
  const val = board[to];

  if (isWhite) {
    if (val >= 0) return true;           // empty or own
    if (type === 'long') return false;   // long: can't land on any opponent
    if (val === -1) return true;         // short: blot — can hit
    return false;                         // short: >1 opponent = blocked
  } else {
    if (val <= 0) return true;
    if (type === 'long') return false;
    if (val === 1) return true;
    return false;
  }
}

function isAllHome(board, bar, player) {
  const isWhite = player === 'white';
  if (isWhite && bar.white > 0) return false;
  if (!isWhite && bar.black > 0) return false;

  if (isWhite) {
    // All white checkers must be in points 1-6 (indices 0-5)
    for (let i = 6; i <= 23; i++) {
      if (board[i] > 0) return false;
    }
  } else {
    // All black checkers must be in points 19-24 (indices 18-23)
    for (let i = 0; i <= 17; i++) {
      if (board[i] < 0) return false;
    }
  }
  return true;
}

function canBearOffWith(board, bar, player, from, die) {
  // If exact — always ok
  const isWhite = player === 'white';
  const exact = isWhite ? from - die : from + die;
  if (isWhite && exact === -1) return true;
  if (!isWhite && exact === 24) return true;

  // Over-roll: allowed only if no checker on higher point
  if (isWhite) {
    // from is the point index, higher = larger index in home board (5 is highest)
    for (let i = from + 1; i <= 5; i++) {
      if (board[i] > 0) return false;
    }
    return true;
  } else {
    for (let i = from - 1; i >= 18; i--) {
      if (board[i] < 0) return false;
    }
    return true;
  }
}

// ─── Apply move ───────────────────────────────────────────────────────────────

/**
 * Mutates state: applies a single checker move.
 * Returns the hit checker color (if any) or null.
 */
function applyMove(state, player, from, to) {
  const { board, bar } = state;
  const isWhite = player === 'white';
  const sign = isWhite ? 1 : -1;

  // Remove from source
  if (from === 'bar') {
    if (isWhite) bar.white--;
    else bar.black--;
  } else {
    board[from] -= sign;
  }

  // Bear off
  if (to === 'bearoff') {
    if (isWhite) state.bearOff.white++;
    else state.bearOff.black++;
    return null;
  }

  // Hit opponent (short only)
  let hit = null;
  if (isWhite && board[to] === -1) {
    board[to] = 0;
    bar.black++;
    hit = 'black';
  } else if (!isWhite && board[to] === 1) {
    board[to] = 0;
    bar.white++;
    hit = 'white';
  }

  // Place
  board[to] += sign;

  return hit;
}

// ─── Check if any move is possible ────────────────────────────────────────────

function hasAnyMove(state, player, dice) {
  const { board, bar } = state;
  const isWhite = player === 'white';

  // Collect all own checker positions
  const positions = [];
  if ((isWhite && bar.white > 0) || (!isWhite && bar.black > 0)) {
    positions.push('bar');
  } else {
    for (let i = 0; i < 24; i++) {
      if (isWhite && board[i] > 0) positions.push(i);
      if (!isWhite && board[i] < 0) positions.push(i);
    }
  }

  for (const from of positions) {
    for (const die of dice) {
      const moves = getValidMoves(state, player, from, die);
      if (moves.length > 0) return true;
    }
  }
  return false;
}

// ─── Check winner ─────────────────────────────────────────────────────────────

function checkWinner(state) {
  if (state.bearOff.white === 15) return 'white';
  if (state.bearOff.black === 15) return 'black';
  return null;
}

// ─── Game factory ─────────────────────────────────────────────────────────────

function createGame(id, type, targetScore, players) {
  const firstPlayer = Math.random() < 0.5 ? 'white' : 'black';

  return {
    id,
    type,           // 'short' | 'long'
    targetScore,    // 1 | 3 | 5 | 11 | 15
    players,        // { white: {id, name, avatar}, black: {id, name, avatar} }
    board: getInitialBoard(type),
    bar: { white: 0, black: 0 },
    bearOff: { white: 0, black: 0 },
    currentPlayer: firstPlayer,
    dice: [],
    diceRolled: false,
    phase: 'rolling',  // 'rolling' | 'moving' | 'finished'
    scores: { white: 0, black: 0 },
    winner: null,
    roundWinner: null,
    moveHistory: [],
  };
}

function resetRound(state) {
  state.board = getInitialBoard(state.type);
  state.bar = { white: 0, black: 0 };
  state.bearOff = { white: 0, black: 0 };
  state.dice = [];
  state.diceRolled = false;
  state.phase = 'rolling';
  state.roundWinner = null;
  // Alternate who goes first next round (loser starts, or winner — по-разному, но пусть случайно)
  state.currentPlayer = Math.random() < 0.5 ? 'white' : 'black';
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  createGame,
  resetRound,
  rollDice,
  getValidMoves,
  applyMove,
  hasAnyMove,
  checkWinner,
  isAllHome,
};
