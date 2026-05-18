const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const {
  createGame, resetRound, rollDice,
  getValidMoves, applyMove, hasAnyMove, checkWinner,
} = require('./gameLogic');

// ─── Express + static ─────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));

// Serve client for any non-API route
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/index.html'));
});

app.get('/health', (_, res) => res.json({ ok: true }));

const server = http.createServer(app);

// ─── WebSocket ────────────────────────────────────────────────────────────────
const wss = new WebSocket.Server({ server });

// Storage
const clients = new Map();     // ws → { playerId, gameId, player }
const games   = new Map();     // gameId → gameState
const queue   = new Map();     // type+score key → { playerId, ws, playerInfo }

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function broadcast(gameId, data) {
  clients.forEach((meta, ws) => {
    if (meta.gameId === gameId) send(ws, data);
  });
}

function gameSnapshot(state) {
  return {
    type:          'game_state',
    id:            state.id,
    gameType:      state.type,
    targetScore:   state.targetScore,
    board:         state.board,
    bar:           state.bar,
    bearOff:       state.bearOff,
    currentPlayer: state.currentPlayer,
    dice:          state.dice,
    diceRolled:    state.diceRolled,
    phase:         state.phase,
    scores:        state.scores,
    players:       state.players,
    winner:        state.winner,
    roundWinner:   state.roundWinner,
  };
}

// ─── Matchmaking ──────────────────────────────────────────────────────────────

function tryMatch(key, ws2, playerInfo2) {
  const waiting = queue.get(key);
  if (waiting && waiting.playerId !== playerInfo2.id) {
    queue.delete(key);
    const [gameType, scoreStr] = key.split(':');
    const gameId = uuidv4();

    // Assign colors randomly
    const coin = Math.random() < 0.5;
    const whiteInfo = coin ? waiting.playerInfo : playerInfo2;
    const blackInfo = coin ? playerInfo2 : waiting.playerInfo;
    const ws1 = waiting.ws;

    const state = createGame(gameId, gameType, parseInt(scoreStr), {
      white: { id: whiteInfo.id, name: whiteInfo.name, avatar: whiteInfo.avatar },
      black: { id: blackInfo.id, name: blackInfo.name, avatar: blackInfo.avatar },
    });
    games.set(gameId, state);

    const color1 = coin ? 'white' : 'black';
    const color2 = coin ? 'black' : 'white';

    clients.set(ws1, { playerId: waiting.playerId, gameId, player: color1 });
    clients.set(ws2, { playerId: playerInfo2.id,   gameId, player: color2 });

    send(ws1, { type: 'game_start', gameId, yourColor: color1, ...gameSnapshot(state) });
    send(ws2, { type: 'game_start', gameId, yourColor: color2, ...gameSnapshot(state) });

    return true;
  }
  return false;
}

// ─── Message handler ──────────────────────────────────────────────────────────

wss.on('connection', (ws) => {
  clients.set(ws, {});

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const meta = clients.get(ws);

    switch (msg.type) {

      // ── Join matchmaking queue ─────────────────────────────────────────────
      case 'find_game': {
        const { gameType, targetScore, playerInfo } = msg;
        const key = `${gameType}:${targetScore}`;
        clients.set(ws, { playerId: playerInfo.id, gameId: null, player: null });

        const matched = tryMatch(key, ws, playerInfo);
        if (!matched) {
          queue.set(key, { playerId: playerInfo.id, ws, playerInfo });
          send(ws, { type: 'waiting' });
        }
        break;
      }

      // ── Join via invite link ───────────────────────────────────────────────
      case 'join_invite': {
        const { gameId, playerInfo } = msg;
        const state = games.get(gameId);
        if (!state) { send(ws, { type: 'error', message: 'Игра не найдена' }); return; }
        if (state.players.black && state.players.white) {
          send(ws, { type: 'error', message: 'Игра уже заполнена' }); return;
        }

        // Find which color slot is empty
        const emptyColor = !state.players.white?.id ? 'white' : 'black';
        const existingColor = emptyColor === 'white' ? 'black' : 'white';

        state.players[emptyColor] = { id: playerInfo.id, name: playerInfo.name, avatar: playerInfo.avatar };
        clients.set(ws, { playerId: playerInfo.id, gameId, player: emptyColor });

        // Notify existing player
        clients.forEach((m, w) => {
          if (m.gameId === gameId && m.player === existingColor) {
            send(w, { type: 'opponent_joined', ...gameSnapshot(state), yourColor: existingColor });
          }
        });
        send(ws, { type: 'game_start', gameId, yourColor: emptyColor, ...gameSnapshot(state) });
        break;
      }

      // ── Create invite game (waiting for friend) ────────────────────────────
      case 'create_invite': {
        const { gameType, targetScore, playerInfo } = msg;
        const gameId = uuidv4();
        const coin = Math.random() < 0.5;
        const myColor = coin ? 'white' : 'black';
        const oppColor = coin ? 'black' : 'white';

        const players = { white: null, black: null };
        players[myColor] = { id: playerInfo.id, name: playerInfo.name, avatar: playerInfo.avatar };

        const state = createGame(gameId, gameType, targetScore, players);
        games.set(gameId, state);
        clients.set(ws, { playerId: playerInfo.id, gameId, player: myColor });

        send(ws, { type: 'invite_created', gameId, yourColor: myColor, inviteLink: gameId });
        break;
      }

      // ── Roll dice ──────────────────────────────────────────────────────────
      case 'roll_dice': {
        const { gameId } = msg;
        const state = games.get(gameId);
        if (!state || state.phase !== 'rolling') return;
        if (meta.player !== state.currentPlayer) return;

        state.dice = rollDice();
        state.diceRolled = true;
        state.phase = 'moving';

        // Check if any move possible
        if (!hasAnyMove(state, state.currentPlayer, state.dice)) {
          // No moves — pass turn
          switchTurn(state);
        }

        broadcast(gameId, gameSnapshot(state));
        break;
      }

      // ── Make move ──────────────────────────────────────────────────────────
      case 'move': {
        const { gameId, from, to, dieIndex } = msg;
        const state = games.get(gameId);
        if (!state || state.phase !== 'moving') return;
        if (meta.player !== state.currentPlayer) return;

        const die = state.dice[dieIndex];
        if (die === undefined) return;

        // Validate
        const valid = getValidMoves(state, meta.player, from, die);
        if (!valid.includes(to)) {
          send(ws, { type: 'invalid_move' });
          return;
        }

        applyMove(state, meta.player, from, to);
        state.dice.splice(dieIndex, 1);

        // Check win
        const winner = checkWinner(state);
        if (winner) {
          state.scores[winner]++;
          state.roundWinner = winner;

          if (state.scores[winner] >= state.targetScore) {
            state.phase = 'finished';
            state.winner = winner;
          } else {
            // Brief pause then reset round
            broadcast(gameId, gameSnapshot(state));
            setTimeout(() => {
              resetRound(state);
              broadcast(gameId, gameSnapshot(state));
            }, 3000);
            return;
          }
          broadcast(gameId, gameSnapshot(state));
          return;
        }

        // If no dice left or no moves — switch turn
        if (state.dice.length === 0 || !hasAnyMove(state, state.currentPlayer, state.dice)) {
          switchTurn(state);
        }

        broadcast(gameId, gameSnapshot(state));
        break;
      }

      // ── Get valid moves for a checker ──────────────────────────────────────
      case 'get_hints': {
        const { gameId, from } = msg;
        const state = games.get(gameId);
        if (!state || meta.player !== state.currentPlayer) return;

        const hints = [];
        for (let i = 0; i < state.dice.length; i++) {
          // Deduplicate by die value to avoid double-counting doubles
          const die = state.dice[i];
          if (i > 0 && state.dice[i - 1] === die) continue;
          const moves = getValidMoves(state, meta.player, from, die);
          hints.push(...moves.map(to => ({ to, dieIndex: i, die })));
        }

        send(ws, { type: 'hints', from, hints });
        break;
      }

      // ── Resign ─────────────────────────────────────────────────────────────
      case 'resign': {
        const { gameId } = msg;
        const state = games.get(gameId);
        if (!state) return;
        const winner = meta.player === 'white' ? 'black' : 'white';
        state.phase = 'finished';
        state.winner = winner;
        state.scores[winner]++;
        broadcast(gameId, gameSnapshot(state));
        break;
      }

      // ── Ping ───────────────────────────────────────────────────────────────
      case 'ping':
        send(ws, { type: 'pong' });
        break;
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    if (meta?.gameId) {
      // Notify opponent
      const state = games.get(meta.gameId);
      if (state && state.phase !== 'finished') {
        state.phase = 'finished';
        state.winner = meta.player === 'white' ? 'black' : 'white';
        broadcast(meta.gameId, { type: 'opponent_left', ...gameSnapshot(state) });
      }
    }
    // Remove from queue
    queue.forEach((val, key) => {
      if (val.ws === ws) queue.delete(key);
    });
    clients.delete(ws);
  });
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function switchTurn(state) {
  state.currentPlayer = state.currentPlayer === 'white' ? 'black' : 'white';
  state.dice = [];
  state.diceRolled = false;
  state.phase = 'rolling';
}

// ─── Start ────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🎲 Backgammon server running on port ${PORT}`);
});
