const express = require('express');
const compression = require('compression');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const { getCharacterSummary, getAuroraDiceSummary } = require('./server/characters');
const { send } = require('./server/rooms');
const createHandlers = require('./server/handlers');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(compression());
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h', etag: true }));

const server = http.createServer(app);
const wss = new WebSocket.Server({
  server,
  perMessageDeflate: {
    zlibDeflateOptions: { level: 1 },
    threshold: 128,
  },
});

// WebSocket heartbeat to keep connections alive on Render
const HEARTBEAT_INTERVAL = 30000;
const heartbeatTimer = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) return ws.terminate();
    ws.isAlive = false;
    ws.ping();
  });
}, HEARTBEAT_INTERVAL);
wss.on('close', () => clearInterval(heartbeatTimer));

const rooms = new Map();
let nextPlayerId = 1;

const handlers = createHandlers(rooms);

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });

  ws.playerId = `P${nextPlayerId++}`;
  ws.playerRoomCode = null;

  send(ws, {
    type: 'welcome',
    playerId: ws.playerId,
    characters: getCharacterSummary(),
    auroraDice: getAuroraDiceSummary(),
  });

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return send(ws, { type: 'error', message: '消息格式错误。' });
    }

    switch (msg.type) {
      case 'create_room':
        handlers.handleCreateRoom(ws, msg);
        break;
      case 'join_room':
        handlers.handleJoinRoom(ws, msg);
        break;
      case 'choose_character':
        handlers.handleChooseCharacter(ws, msg);
        break;
      case 'choose_aurora_die':
        handlers.handleChooseAurora(ws, msg);
        break;
      case 'leave_room':
        handlers.leaveRoom(ws);
        send(ws, { type: 'left_room' });
        break;
      case 'play_again':
        handlers.handlePlayAgain(ws);
        break;
      case 'disband_room':
        handlers.handleDisbandRoom(ws);
        break;
      case 'roll_attack':
        handlers.handleRollAttack(ws);
        break;
      case 'use_aurora_die':
        handlers.handleUseAurora(ws);
        break;
      case 'reroll_attack':
        handlers.handleRerollAttack(ws, msg);
        break;
      case 'update_live_selection':
        handlers.handleUpdateLiveSelection(ws, msg);
        break;
      case 'confirm_attack_selection':
        handlers.handleConfirmAttack(ws, msg);
        break;
      case 'roll_defense':
        handlers.handleRollDefense(ws);
        break;
      case 'confirm_defense_selection':
        handlers.handleConfirmDefense(ws, msg);
        break;
      default:
        send(ws, { type: 'error', message: `未知消息类型: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    handlers.leaveRoom(ws);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Galaxy Power Party server running at http://localhost:${PORT}`);
});
