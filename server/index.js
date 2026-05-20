const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { v4: uuidv4 } = require('uuid');
const cors = require('cors');
const path = require('path');
const {
  createGame, resetRound, rollDie, rollDice,
  getValidMoves, applyMove, hasAnyMove, checkWinner,
} = require('./gameLogic');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../client')));
app.get('/', (req, res) => res.sendFile(path.join(__dirname, '../client/index.html')));
app.get('/health', (_, res) => res.json({ ok: true }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Map();
const games   = new Map();
const queue   = new Map();

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function broadcast(gameId, data) {
  clients.forEach((meta, ws) => { if (meta.gameId === gameId) send(ws, data); });
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
    openingRolls:  state.openingRolls,
    scores:        state.scores,
    players:       state.players,
    winner:        state.winner,
    roundWinner:   state.roundWinner,
    canUndo:       !!(state.turnHistory && state.turnHistory.length > 0),
  };
}

function tryMatch(key, ws2, playerInfo2) {
  const waiting = queue.get(key);
  if (waiting && waiting.playerId !== playerInfo2.id) {
    queue.delete(key);
    const [gameType, scoreStr] = key.split(':');
    const gameId = uuidv4();
    const coin = Math.random() < 0.5;
    const whiteInfo = coin ? waiting.playerInfo : playerInfo2;
    const blackInfo = coin ? playerInfo2 : waiting.playerInfo;
    const ws1 = waiting.ws;
    const state = createGame(gameId, gameType, parseInt(scoreStr), {
      white: { id:whiteInfo.id, name:whiteInfo.name, avatar:whiteInfo.avatar },
      black: { id:blackInfo.id, name:blackInfo.name, avatar:blackInfo.avatar },
    });
    games.set(gameId, state);
    const color1 = coin ? 'white' : 'black';
    const color2 = coin ? 'black' : 'white';
    clients.set(ws1, { playerId:waiting.playerId, gameId, player:color1 });
    clients.set(ws2, { playerId:playerInfo2.id,   gameId, player:color2 });
    send(ws1, { ...gameSnapshot(state), type:'game_start', gameId, yourColor:color1 });
    send(ws2, { ...gameSnapshot(state), type:'game_start', gameId, yourColor:color2 });
    return true;
  }
  return false;
}

function switchTurn(state) {
  state.currentPlayer = state.currentPlayer === 'white' ? 'black' : 'white';
  state.dice = []; state.diceRolled = false;
  state.phase = 'rolling';
  state.turnHistory = [];
}

wss.on('connection', (ws) => {
  clients.set(ws, {});

  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    const meta = clients.get(ws);

    switch (msg.type) {

      case 'find_game': {
        const { gameType, targetScore, playerInfo } = msg;
        const key = `${gameType}:${targetScore}`;
        clients.set(ws, { playerId:playerInfo.id, gameId:null, player:null });
        if (!tryMatch(key, ws, playerInfo)) {
          queue.set(key, { playerId:playerInfo.id, ws, playerInfo });
          send(ws, { type:'waiting' });
        }
        break;
      }

      case 'join_invite': {
        const { gameId, playerInfo } = msg;
        const state = games.get(gameId);
        if (!state) { send(ws, { type:'error', message:'Игра не найдена' }); return; }
        if (state.players.black && state.players.white) { send(ws, { type:'error', message:'Игра заполнена' }); return; }
        const emptyColor = !state.players.white?.id ? 'white' : 'black';
        const existingColor = emptyColor === 'white' ? 'black' : 'white';
        state.players[emptyColor] = { id:playerInfo.id, name:playerInfo.name, avatar:playerInfo.avatar };
        clients.set(ws, { playerId:playerInfo.id, gameId, player:emptyColor });
        clients.forEach((m,w) => {
          if (m.gameId===gameId && m.player===existingColor)
            send(w, { ...gameSnapshot(state), type:'opponent_joined', yourColor:existingColor });
        });
        send(ws, { ...gameSnapshot(state), type:'game_start', gameId, yourColor:emptyColor });
        break;
      }

      case 'create_invite': {
        const { gameType, targetScore, playerInfo } = msg;
        const gameId = uuidv4();
        const coin = Math.random() < 0.5;
        const myColor = coin ? 'white' : 'black';
        const players = { white:null, black:null };
        players[myColor] = { id:playerInfo.id, name:playerInfo.name, avatar:playerInfo.avatar };
        const state = createGame(gameId, gameType, targetScore, players);
        games.set(gameId, state);
        clients.set(ws, { playerId:playerInfo.id, gameId, player:myColor });
        send(ws, { type:'invite_created', gameId, yourColor:myColor, inviteLink:gameId });
        break;
      }

      // ── Opening roll: each player rolls one die, higher goes first ────────────
      case 'opening_roll': {
        const { gameId } = msg;
        const state = games.get(gameId);
        if (!state || state.phase !== 'opening_roll') return;
        if (state.openingRolls[meta.player] !== null) return; // already rolled

        const die = rollDie();
        state.openingRolls[meta.player] = die;

        const { white: wRoll, black: bRoll } = state.openingRolls;
        broadcast(gameId, gameSnapshot(state)); // show die immediately

        if (wRoll !== null && bRoll !== null) {
          if (wRoll === bRoll) {
            // Tie — reset after delay
            setTimeout(() => {
              state.openingRolls = { white:null, black:null };
              broadcast(gameId, gameSnapshot(state));
            }, 1800);
          } else {
            // Winner goes first and uses both dice values
            setTimeout(() => {
              const first = wRoll > bRoll ? 'white' : 'black';
              state.currentPlayer = first;
              state.dice = [wRoll, bRoll];
              state.diceRolled = true;
              state.turnHistory = [];
              state.openingRolls = { white:null, black:null };
              state.phase = 'moving';
              if (!hasAnyMove(state, state.currentPlayer, state.dice)) switchTurn(state);
              broadcast(gameId, gameSnapshot(state));
            }, 1800);
          }
        }
        break;
      }

      // ── Roll dice (subsequent turns) ──────────────────────────────────────────
      case 'roll_dice': {
        const { gameId } = msg;
        const state = games.get(gameId);
        if (!state || state.phase !== 'rolling') return;
        if (meta.player !== state.currentPlayer) return;
        state.dice = rollDice();
        state.diceRolled = true;
        state.phase = 'moving';
        state.turnHistory = [];
        if (!hasAnyMove(state, state.currentPlayer, state.dice)) switchTurn(state);
        broadcast(gameId, gameSnapshot(state));
        break;
      }

      // ── Make move ─────────────────────────────────────────────────────────────
      case 'move': {
        const { gameId, from, to, dieIndex } = msg;
        const state = games.get(gameId);
        if (!state || state.phase !== 'moving') return;
        if (meta.player !== state.currentPlayer) return;
        const die = state.dice[dieIndex];
        if (die === undefined) return;
        const valid = getValidMoves(state, meta.player, from, die);
        if (!valid.includes(to)) { send(ws, { type:'invalid_move' }); return; }

        // Save snapshot for undo
        if (!state.turnHistory) state.turnHistory = [];
        state.turnHistory.push({
          board: [...state.board],
          bar: { ...state.bar },
          bearOff: { ...state.bearOff },
          dice: [...state.dice],
        });

        applyMove(state, meta.player, from, to);
        state.dice.splice(dieIndex, 1);

        const winner = checkWinner(state);
        if (winner) {
          state.scores[winner]++;
          state.roundWinner = winner;
          if (state.scores[winner] >= state.targetScore) {
            state.phase = 'finished'; state.winner = winner;
            broadcast(gameId, gameSnapshot(state));
          } else {
            broadcast(gameId, gameSnapshot(state));
            setTimeout(() => { resetRound(state); broadcast(gameId, gameSnapshot(state)); }, 3000);
          }
          return;
        }

        // Auto-switch only if no moves possible with remaining dice
        if (state.dice.length === 0) {
          // All dice used — player must press Done (or auto-switch)
          // Keep in 'moving' so client shows Done button
          // But if only one player can move, just auto-switch
          switchTurn(state);
        } else if (!hasAnyMove(state, state.currentPlayer, state.dice)) {
          switchTurn(state);
        }

        broadcast(gameId, gameSnapshot(state));
        break;
      }

      // ── Undo last move ────────────────────────────────────────────────────────
      case 'undo_move': {
        const { gameId } = msg;
        const state = games.get(gameId);
        if (!state || state.phase !== 'moving') return;
        if (meta.player !== state.currentPlayer) return;
        if (!state.turnHistory || state.turnHistory.length === 0) return;
        const prev = state.turnHistory.pop();
        state.board = prev.board;
        state.bar = prev.bar;
        state.bearOff = prev.bearOff;
        state.dice = prev.dice;
        broadcast(gameId, gameSnapshot(state));
        break;
      }

      // ── Done turn ─────────────────────────────────────────────────────────────
      case 'done_turn': {
        const { gameId } = msg;
        const state = games.get(gameId);
        if (!state || state.phase !== 'moving') return;
        if (meta.player !== state.currentPlayer) return;
        state.turnHistory = [];
        switchTurn(state);
        broadcast(gameId, gameSnapshot(state));
        break;
      }

      case 'get_hints': {
        const { gameId, from } = msg;
        const state = games.get(gameId);
        if (!state || meta.player !== state.currentPlayer) return;
        const hints = [];
        for (let i=0; i<state.dice.length; i++) {
          const die = state.dice[i];
          if (i > 0 && state.dice[i-1] === die) continue;
          const moves = getValidMoves(state, meta.player, from, die);
          hints.push(...moves.map(to => ({ to, dieIndex:i, die })));
        }
        send(ws, { type:'hints', from, hints });
        break;
      }

      case 'resign': {
        const { gameId } = msg;
        const state = games.get(gameId);
        if (!state) return;
        const winner = meta.player === 'white' ? 'black' : 'white';
        state.phase = 'finished'; state.winner = winner; state.scores[winner]++;
        broadcast(gameId, gameSnapshot(state));
        break;
      }

      case 'ping': send(ws, { type:'pong' }); break;
    }
  });

  ws.on('close', () => {
    const meta = clients.get(ws);
    if (meta?.gameId) {
      const state = games.get(meta.gameId);
      if (state && state.phase !== 'finished') {
        state.phase = 'finished';
        state.winner = meta.player === 'white' ? 'black' : 'white';
        broadcast(meta.gameId, { type:'opponent_left', ...gameSnapshot(state) });
      }
    }
    queue.forEach((val, key) => { if (val.ws === ws) queue.delete(key); });
    clients.delete(ws);
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🎲 Backgammon server on port ${PORT}`));
