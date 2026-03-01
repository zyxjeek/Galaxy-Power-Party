const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const PORT = process.env.PORT || 3000;

const app = express();
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();
let nextPlayerId = 1;

const CHARACTERS = {
  xiadie: {
    id: 'xiadie',
    name: '遐蝶',
    hp: 27,
    diceSides: [8, 8, 6, 4, 4],
    auroraUses: 2,
    attackLevel: 3,
    defenseLevel: 2,
    skillText: '防御时：单次受伤>=8则攻防+1；受伤且<=5时立即对对手造成3点瞬伤',
  },
  huangquan: {
    id: 'huangquan',
    name: '黄泉',
    hp: 33,
    diceSides: [8, 6, 4, 4, 4],
    auroraUses: 2,
    attackLevel: 2,
    defenseLevel: 3,
    skillText: '攻击时：若所选点数全为4则洞穿（无视防御与力场），且每次洞穿攻等+1',
  },
  zhigengniao: {
    id: 'zhigengniao',
    name: '知更鸟',
    hp: 30,
    diceSides: [6, 6, 4, 4, 4],
    auroraUses: 0,
    attackLevel: 4,
    defenseLevel: 3,
    skillText: '攻击时：若所选骰子全为偶数，则这些骰子升级（4->6->8->12）',
  },
  daheita: {
    id: 'daheita',
    name: '大黑塔',
    hp: 42,
    diceSides: [8, 8, 6, 6, 6],
    auroraUses: 2,
    attackLevel: 3,
    defenseLevel: 2,
    skillText: '回合结束+1曜彩次数；A效果触发>=4后，每回合选择骰子后触发跃升（最小点变最大）',
  },
  baie: {
    id: 'baie',
    name: '白厄',
    hp: 20,
    diceSides: [8, 8, 6, 6, 6],
    auroraUses: 2,
    attackLevel: 4,
    defenseLevel: 2,
    skillText: '攻击后回复造成伤害50%（下取整）；防御全同点时本回合最低降到1（每局1次）',
  },
};

const AURORA_DICE = {
  starshield: {
    id: 'starshield',
    name: '星盾',
    faces: [
      { value: 7, hasA: false },
      { value: 7, hasA: false },
      { value: 7, hasA: false },
      { value: 1, hasA: true },
      { value: 1, hasA: true },
      { value: 1, hasA: true },
    ],
    effectText: 'A：若被选中，本轮次获得力场（不会受到常规攻击伤害）',
    conditionText: '只能在防守时使用',
  },
  legacy: {
    id: 'legacy',
    name: '遗语',
    faces: [
      { value: 4, hasA: false },
      { value: 5, hasA: false },
      { value: 5, hasA: false },
      { value: 1, hasA: true },
      { value: 2, hasA: true },
      { value: 4, hasA: true },
    ],
    effectText: 'A：若被选中，让攻击值/防守值翻倍',
    conditionText: '生命值 <= 8 时可用',
  },
  repeater: {
    id: 'repeater',
    name: '复读',
    faces: [
      { value: 1, hasA: false },
      { value: 1, hasA: false },
      { value: 4, hasA: false },
      { value: 4, hasA: false },
      { value: 4, hasA: true },
      { value: 4, hasA: true },
    ],
    effectText: 'A：若被选中，本轮次额外进行一次攻击（基于当前攻击值）',
    conditionText: '累计选择两次骰面4后，可在攻击时使用',
  },
  medic: {
    id: 'medic',
    name: '医嘱',
    faces: [
      { value: 1, hasA: true },
      { value: 2, hasA: true },
      { value: 3, hasA: true },
      { value: 4, hasA: true },
      { value: 6, hasA: true },
      { value: 6, hasA: true },
    ],
    effectText: 'A：若被选中，为自己回复与骰面点数相同的生命值（不超过角色初始生命值）',
    conditionText: '随时可用',
  },
};

function send(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function getAuroraDiceSummary() {
  return Object.keys(AURORA_DICE).map((id) => {
    const d = AURORA_DICE[id];
    return {
      id: d.id,
      name: d.name,
      facesText: d.faces.map((f) => (f.hasA ? `${f.value}A` : `${f.value}`)).join(' '),
      effectText: d.effectText,
      conditionText: d.conditionText,
    };
  });
}

function getCharacterSummary() {
  return Object.keys(CHARACTERS).map((id) => {
    const c = CHARACTERS[id];
    return {
      id: c.id,
      name: c.name,
      hp: c.hp,
      diceSides: c.diceSides,
      auroraUses: c.auroraUses,
      attackLevel: c.attackLevel,
      defenseLevel: c.defenseLevel,
      shortSpec: `${countSides(c.diceSides)} ${c.auroraUses}A ${c.attackLevel}+${c.defenseLevel}`,
      skillText: c.skillText,
    };
  });
}

function countSides(sides) {
  const map = {};
  for (const s of sides) {
    map[s] = (map[s] || 0) + 1;
  }
  const keys = Object.keys(map).map((k) => Number(k)).sort((a, b) => b - a);
  return keys.map((k) => `${map[k]}x${k}`).join(' ');
}

function sanitizeRoom(room, viewerPlayerId) {
  const game = room.game
    ? {
        status: room.game.status,
        round: room.game.round,
        attackerId: room.game.attackerId,
        defenderId: room.game.defenderId,
        phase: room.game.phase,
        rerollsLeft: room.game.rerollsLeft,
        attackDice: room.game.attackDice,
        defenseDice: room.game.defenseDice,
        attackSelection: room.game.attackSelection,
        defenseSelection: room.game.defenseSelection,
        attackPreviewSelection: room.game.attackPreviewSelection,
        defensePreviewSelection: room.game.defensePreviewSelection,
        attackValue: room.game.attackValue,
        defenseValue: room.game.defenseValue,
        attackPierce: room.game.attackPierce,
        lastDamage: room.game.lastDamage,
        winnerId: room.game.winnerId,
        log: room.game.log,
        hp: room.game.hp,
        maxHp: room.game.maxHp,
        attackLevel: room.game.attackLevel,
        defenseLevel: room.game.defenseLevel,
        auroraUsesRemaining: room.game.auroraUsesRemaining,
        selectedFourCount: room.game.selectedFourCount,
        auroraAEffectCount: room.game.auroraAEffectCount,
        roundAuroraUsed: room.game.roundAuroraUsed,
        forceField: room.game.forceField,
        effectEvents: room.game.effectEvents,
      }
    : null;

  return {
    code: room.code,
    status: room.status,
    waitingReason: room.waitingReason,
    players: room.players.map((p) => {
      const hideLoadout = room.status === 'lobby' && p.id !== viewerPlayerId;
      return {
        id: p.id,
        name: p.name,
        characterId: hideLoadout ? null : p.characterId,
        characterName: hideLoadout
          ? '未公开'
          : (CHARACTERS[p.characterId] && CHARACTERS[p.characterId].name) || p.characterId,
        auroraDiceId: hideLoadout ? null : p.auroraDiceId,
        auroraDiceName: hideLoadout
          ? null
          : (AURORA_DICE[p.auroraDiceId] && AURORA_DICE[p.auroraDiceId].name) || null,
      };
    }),
    game,
  };
}

function broadcastRoom(room) {
  for (const p of room.players) {
    send(p.ws, {
      type: 'room_state',
      room: sanitizeRoom(room, p.id),
    });
  }
}

function newRoomCode() {
  let code;
  do {
    code = String(Math.floor(1000 + Math.random() * 9000));
  } while (rooms.has(code));
  return code;
}

function newNormalDie(value, sides, slotId) {
  return {
    value,
    label: `${value}`,
    hasA: false,
    isAurora: false,
    sides,
    maxValue: sides,
    slotId,
    auroraId: null,
    auroraName: null,
    effectText: null,
    conditionText: null,
  };
}

function makeNormalDiceFromPool(diceSides) {
  return diceSides.map((sides, slotId) => {
    const value = Math.floor(Math.random() * sides) + 1;
    return newNormalDie(value, sides, slotId);
  });
}

function rollAuroraFace(auroraId) {
  const aurora = AURORA_DICE[auroraId];
  const face = aurora.faces[Math.floor(Math.random() * aurora.faces.length)];
  const maxValue = aurora.faces.reduce((acc, f) => (f.value > acc ? f.value : acc), 0);
  return {
    value: face.value,
    label: face.hasA ? `${face.value}A` : `${face.value}`,
    hasA: face.hasA,
    isAurora: true,
    sides: null,
    maxValue,
    slotId: null,
    auroraId,
    auroraName: aurora.name,
    effectText: aurora.effectText,
    conditionText: aurora.conditionText,
  };
}

function sortDice(dice) {
  dice.sort((a, b) => {
    if (a.value !== b.value) return a.value - b.value;
    if (a.isAurora !== b.isAurora) return a.isAurora ? 1 : -1;
    if (a.sides !== b.sides) return (a.sides || 0) - (b.sides || 0);
    return 0;
  });
}

function diceToText(dice) {
  return dice.map((d) => d.label).join(', ');
}

function sumByIndices(dice, indices) {
  return indices.reduce((acc, idx) => acc + dice[idx].value, 0);
}

function pushEffectEvent(game, event) {
  game.effectEventSeq += 1;
  const wrapped = Object.assign({ id: game.effectEventSeq }, event);
  game.effectEvents.push(wrapped);
  if (game.effectEvents.length > 50) {
    game.effectEvents.shift();
  }
}

function getPlayerRoom(ws) {
  if (!ws.playerRoomCode) return null;
  return rooms.get(ws.playerRoomCode) || null;
}

function getPlayerById(room, playerId) {
  return room.players.find((p) => p.id === playerId) || null;
}

function isAuroraEquipRequired(player) {
  const ch = CHARACTERS[player.characterId];
  return !!(ch && ch.auroraUses > 0);
}

function readyToStart(room) {
  if (room.players.length !== 2) return { ok: false, reason: '等待另一位玩家加入。' };

  for (const player of room.players) {
    if (!player.characterId) return { ok: false, reason: `${player.name}尚未选择角色。` };
    const ch = CHARACTERS[player.characterId];
    if (!ch) return { ok: false, reason: `${player.name}角色无效。` };
    if (ch.auroraUses > 0 && !player.auroraDiceId) {
      return { ok: false, reason: `${player.name}尚未装备曜彩骰。` };
    }
    if (ch.auroraUses === 0 && player.auroraDiceId) {
      return { ok: false, reason: `${player.name}当前角色不能装备曜彩骰。` };
    }
  }

  return { ok: true, reason: '' };
}

function startGameIfReady(room) {
  if (room.status === 'in_game') return;

  const readiness = readyToStart(room);
  room.waitingReason = readiness.reason;
  if (!readiness.ok) return;

  const p1 = room.players[0];
  const p2 = room.players[1];
  const first = Math.random() < 0.5 ? p1 : p2;
  const second = first.id === p1.id ? p2 : p1;

  const c1 = CHARACTERS[p1.characterId];
  const c2 = CHARACTERS[p2.characterId];

  room.status = 'in_game';
  room.waitingReason = '';
  room.game = {
    status: 'in_game',
    round: 1,
    attackerId: first.id,
    defenderId: second.id,
    phase: 'attack_roll',
    rerollsLeft: 2,
    attackDice: null,
    defenseDice: null,
    attackSelection: null,
    defenseSelection: null,
    attackPreviewSelection: [],
    defensePreviewSelection: [],
    attackValue: null,
    defenseValue: null,
    attackPierce: false,
    lastDamage: null,
    winnerId: null,
    hp: {
      [p1.id]: c1.hp,
      [p2.id]: c2.hp,
    },
    maxHp: {
      [p1.id]: c1.hp,
      [p2.id]: c2.hp,
    },
    attackLevel: {
      [p1.id]: c1.attackLevel,
      [p2.id]: c2.attackLevel,
    },
    defenseLevel: {
      [p1.id]: c1.defenseLevel,
      [p2.id]: c2.defenseLevel,
    },
    diceSidesByPlayer: {
      [p1.id]: c1.diceSides.slice(),
      [p2.id]: c2.diceSides.slice(),
    },
    auroraUsesRemaining: {
      [p1.id]: c1.auroraUses,
      [p2.id]: c2.auroraUses,
    },
    selectedFourCount: {
      [p1.id]: 0,
      [p2.id]: 0,
    },
    auroraAEffectCount: {
      [p1.id]: 0,
      [p2.id]: 0,
    },
    whiteeGuardUsed: {
      [p1.id]: false,
      [p2.id]: false,
    },
    whiteeGuardActive: {
      [p1.id]: false,
      [p2.id]: false,
    },
    roundAuroraUsed: {
      [p1.id]: false,
      [p2.id]: false,
    },
    forceField: {
      [p1.id]: false,
      [p2.id]: false,
    },
    extraAttackQueued: false,
    effectEventSeq: 0,
    effectEvents: [],
    log: [`游戏开始。先手攻击方：${first.name}。`],
  };
}

function leaveRoom(ws) {
  const room = getPlayerRoom(ws);
  if (!room) return;

  const idx = room.players.findIndex((p) => p.id === ws.playerId);
  if (idx !== -1) {
    const left = room.players.splice(idx, 1)[0];
    if (room.game && room.status === 'in_game' && room.players.length === 1) {
      const remaining = room.players[0];
      remaining.ws.playerRoomCode = null;
      send(remaining.ws, { type: 'left_room', reason: '对手已离开房间，房间已关闭。' });
      rooms.delete(room.code);
      ws.playerRoomCode = null;
      return;
    }
  }

  ws.playerRoomCode = null;

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  if (room.status === 'lobby') {
    startGameIfReady(room);
  }

  broadcastRoom(room);
}

function isValidDistinctIndices(indices, needCount, diceCount) {
  if (!Array.isArray(indices)) return false;
  if (indices.length !== needCount) return false;
  const set = new Set(indices);
  if (set.size !== needCount) return false;
  for (const idx of indices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= diceCount) return false;
  }
  return true;
}

function isValidDistinctIndicesAnyCount(indices, diceCount) {
  if (!Array.isArray(indices)) return false;
  const set = new Set(indices);
  if (set.size !== indices.length) return false;
  for (const idx of indices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= diceCount) return false;
  }
  return true;
}

function canUseAurora(player, game, role) {
  const auroraId = player.auroraDiceId;
  if (!auroraId || !AURORA_DICE[auroraId]) return { ok: false, reason: '你尚未装备曜彩骰。' };

  if ((game.auroraUsesRemaining[player.id] || 0) <= 0) return { ok: false, reason: '曜彩骰使用次数已耗尽。' };
  if (game.roundAuroraUsed[player.id]) return { ok: false, reason: '本轮你已使用过曜彩骰。' };

  if (auroraId === 'starshield' && role !== 'defense') return { ok: false, reason: '星盾只能在防守时使用。' };
  if (auroraId === 'legacy' && game.hp[player.id] > 8) return { ok: false, reason: '遗语仅在生命值<=8时可用。' };

  if (auroraId === 'repeater') {
    if (role !== 'attack') return { ok: false, reason: '复读只能在攻击时使用。' };
    if ((game.selectedFourCount[player.id] || 0) < 2) return { ok: false, reason: '复读需要累计选择两次点数4。' };
  }

  return { ok: true, reason: '' };
}

function triggerAuroraA(game, actorId) {
  game.auroraAEffectCount[actorId] += 1;
}

function applyAuroraAEffectOnAttack(room, game, attacker, selectedDice) {
  const auroraDie = selectedDice.find((d) => d.isAurora && d.hasA);
  if (!auroraDie) return;

  triggerAuroraA(game, attacker.id);

  if (auroraDie.auroraId === 'legacy') {
    game.attackValue *= 2;
    game.log.push(`${attacker.name}触发【遗语】A效果，攻击值翻倍为${game.attackValue}。`);
  } else if (auroraDie.auroraId === 'repeater') {
    game.extraAttackQueued = true;
    game.log.push(`${attacker.name}触发【复读】A效果，本轮将额外进行一次攻击。`);
  } else if (auroraDie.auroraId === 'medic') {
    const before = game.hp[attacker.id];
    const healed = Math.min(auroraDie.value, game.maxHp[attacker.id] - before);
    if (healed > 0) {
      game.hp[attacker.id] = before + healed;
      pushEffectEvent(game, {
        type: 'heal',
        playerId: attacker.id,
        amount: healed,
        hpBefore: before,
        hpAfter: game.hp[attacker.id],
      });
      game.log.push(`${attacker.name}触发【医嘱】A效果，回复${healed}点生命值。`);
    } else {
      game.log.push(`${attacker.name}触发【医嘱】A效果，但生命值已满。`);
    }
  } else if (auroraDie.auroraId === 'starshield') {
    game.forceField[attacker.id] = true;
    game.log.push(`${attacker.name}触发【星盾】A效果，本轮获得力场。`);
  }
}

function applyAuroraAEffectOnDefense(room, game, defender, selectedDice) {
  const auroraDie = selectedDice.find((d) => d.isAurora && d.hasA);
  if (!auroraDie) return;

  triggerAuroraA(game, defender.id);

  if (auroraDie.auroraId === 'starshield') {
    game.forceField[defender.id] = true;
    game.log.push(`${defender.name}触发【星盾】A效果，本轮获得力场。`);
  } else if (auroraDie.auroraId === 'legacy') {
    game.defenseValue *= 2;
    game.log.push(`${defender.name}触发【遗语】A效果，防守值翻倍为${game.defenseValue}。`);
  } else if (auroraDie.auroraId === 'medic') {
    const before = game.hp[defender.id];
    const healed = Math.min(auroraDie.value, game.maxHp[defender.id] - before);
    if (healed > 0) {
      game.hp[defender.id] = before + healed;
      pushEffectEvent(game, {
        type: 'heal',
        playerId: defender.id,
        amount: healed,
        hpBefore: before,
        hpAfter: game.hp[defender.id],
      });
      game.log.push(`${defender.name}触发【医嘱】A效果，回复${healed}点生命值。`);
    } else {
      game.log.push(`${defender.name}触发【医嘱】A效果，但生命值已满。`);
    }
  } else if (auroraDie.auroraId === 'repeater') {
    game.extraAttackQueued = true;
    game.log.push(`${defender.name}触发【复读】A效果，本轮将额外进行一次攻击。`);
  }
}

function countSelectedValue(selectedDice, val) {
  return selectedDice.filter((d) => d.value === val).length;
}

function areAllValues(selectedDice, target) {
  return selectedDice.length > 0 && selectedDice.every((d) => d.value === target);
}

function areAllEven(selectedDice) {
  return selectedDice.length > 0 && selectedDice.every((d) => d.value % 2 === 0);
}

function areAllSame(selectedDice) {
  return selectedDice.length > 0 && selectedDice.every((d) => d.value === selectedDice[0].value);
}

function upgradeSide(side) {
  if (side <= 4) return 6;
  if (side <= 6) return 8;
  if (side <= 8) return 12;
  return 12;
}

function applyDaheitaAscendIfReady(room, game, player, selectedDice) {
  if (player.characterId !== 'daheita') return;
  if ((game.auroraAEffectCount[player.id] || 0) < 4) return;
  if (!selectedDice.length) return;

  let minDie = selectedDice[0];
  for (const d of selectedDice) {
    if (d.value < minDie.value) minDie = d;
  }

  minDie.value = minDie.maxValue;
  minDie.label = minDie.hasA ? `${minDie.value}A` : `${minDie.value}`;
  game.log.push(`${player.name}触发【跃升】，将最小点骰子提升到最大值${minDie.maxValue}。`);
}

function createNewRoomPlayer(ws, name) {
  return {
    id: ws.playerId,
    ws,
    name,
    characterId: 'xiadie',
    auroraDiceId: null,
  };
}

function handleCreateRoom(ws, msg) {
  if (!msg.name || typeof msg.name !== 'string') return send(ws, { type: 'error', message: '请输入玩家名称。' });
  if (getPlayerRoom(ws)) leaveRoom(ws);

  const code = newRoomCode();
  const room = {
    code,
    status: 'lobby',
    waitingReason: '等待另一位玩家加入。',
    players: [],
    game: null,
  };

  rooms.set(code, room);

  room.players.push(createNewRoomPlayer(ws, msg.name.trim().slice(0, 20) || `玩家${ws.playerId}`));
  ws.playerRoomCode = code;

  startGameIfReady(room);
  broadcastRoom(room);
}

function handleJoinRoom(ws, msg) {
  const name = (msg.name || '').trim();
  const code = String(msg.code || '').trim();

  if (!name) return send(ws, { type: 'error', message: '请输入玩家名称。' });
  if (!/^\d{4}$/.test(code)) return send(ws, { type: 'error', message: '房间号必须是4位数字。' });

  const room = rooms.get(code);
  if (!room) return send(ws, { type: 'error', message: '房间不存在。' });
  if (room.players.length >= 2) return send(ws, { type: 'error', message: '房间已满。' });

  if (getPlayerRoom(ws)) leaveRoom(ws);

  room.players.push(createNewRoomPlayer(ws, name.slice(0, 20)));
  ws.playerRoomCode = code;

  startGameIfReady(room);
  broadcastRoom(room);
}

function handleChooseCharacter(ws, msg) {
  const room = getPlayerRoom(ws);
  if (!room) return send(ws, { type: 'error', message: '你不在房间内。' });
  if (room.status !== 'lobby') return send(ws, { type: 'error', message: '游戏已开始，不能更换角色。' });

  const characterId = msg.characterId;
  if (!CHARACTERS[characterId]) return send(ws, { type: 'error', message: '无效角色。' });

  const me = getPlayerById(room, ws.playerId);
  if (!me) return;

  me.characterId = characterId;
  if (CHARACTERS[characterId].auroraUses === 0) {
    me.auroraDiceId = null;
  }

  startGameIfReady(room);
  broadcastRoom(room);
}

function handleChooseAurora(ws, msg) {
  const room = getPlayerRoom(ws);
  if (!room) return send(ws, { type: 'error', message: '你不在房间内。' });
  if (room.status !== 'lobby') return send(ws, { type: 'error', message: '游戏已开始，不能更换曜彩骰。' });

  const me = getPlayerById(room, ws.playerId);
  if (!me) return;

  const ch = CHARACTERS[me.characterId];
  if (!ch || ch.auroraUses <= 0) {
    return send(ws, { type: 'error', message: '当前角色没有曜彩骰使用次数。' });
  }

  const auroraId = msg.auroraDiceId;
  if (!AURORA_DICE[auroraId]) return send(ws, { type: 'error', message: '无效曜彩骰。' });

  me.auroraDiceId = auroraId;
  startGameIfReady(room);
  broadcastRoom(room);
}

function handleRollAttack(ws) {
  const room = getPlayerRoom(ws);
  if (!room || !room.game) return;
  const game = room.game;

  if (room.status !== 'in_game' || game.phase !== 'attack_roll') return;
  if (game.attackerId !== ws.playerId) return;

  const attacker = getPlayerById(room, game.attackerId);
  const defender = getPlayerById(room, game.defenderId);

  game.attackDice = makeNormalDiceFromPool(game.diceSidesByPlayer[attacker.id]);
  sortDice(game.attackDice);
  game.rerollsLeft = 2;
  game.attackSelection = null;
  game.attackPreviewSelection = [];
  game.attackValue = null;
  game.attackPierce = false;

  game.defenseDice = null;
  game.defenseSelection = null;
  game.defensePreviewSelection = [];
  game.defenseValue = null;

  game.extraAttackQueued = false;
  game.roundAuroraUsed[attacker.id] = false;
  game.roundAuroraUsed[defender.id] = false;
  game.forceField[attacker.id] = false;
  game.forceField[defender.id] = false;
  game.whiteeGuardActive[attacker.id] = false;
  game.whiteeGuardActive[defender.id] = false;

  game.phase = 'attack_reroll_or_select';
  game.log.push(`${attacker.name}投掷攻击骰：${diceToText(game.attackDice)}`);

  broadcastRoom(room);
}

function handleUseAurora(ws) {
  const room = getPlayerRoom(ws);
  if (!room || !room.game) return;
  const game = room.game;

  if (room.status !== 'in_game') return;

  let role;
  if (game.phase === 'attack_reroll_or_select' && game.attackerId === ws.playerId) {
    role = 'attack';
  } else if (game.phase === 'defense_select' && game.defenderId === ws.playerId) {
    role = 'defense';
  } else {
    return;
  }

  const me = getPlayerById(room, ws.playerId);
  if (!me) return;

  const verdict = canUseAurora(me, game, role);
  if (!verdict.ok) return send(ws, { type: 'error', message: verdict.reason });

  const die = rollAuroraFace(me.auroraDiceId);
  if (role === 'attack') {
    game.attackDice.push(die);
    sortDice(game.attackDice);
    game.attackPreviewSelection = [];
  } else {
    game.defenseDice.push(die);
    sortDice(game.defenseDice);
    game.defensePreviewSelection = [];
  }

  game.auroraUsesRemaining[me.id] -= 1;
  game.roundAuroraUsed[me.id] = true;

  game.log.push(`${me.name}使用曜彩骰【${AURORA_DICE[me.auroraDiceId].name}】，投出 ${die.label}。`);
  broadcastRoom(room);
}

function rerollOneDie(oldDie, player) {
  if (oldDie.isAurora) return rollAuroraFace(player.auroraDiceId);

  const sides = oldDie.sides;
  const value = Math.floor(Math.random() * sides) + 1;
  return newNormalDie(value, sides, oldDie.slotId);
}

function handleRerollAttack(ws, msg) {
  const room = getPlayerRoom(ws);
  if (!room || !room.game) return;
  const game = room.game;

  if (room.status !== 'in_game' || game.phase !== 'attack_reroll_or_select') return;
  if (game.attackerId !== ws.playerId) return;
  if (game.rerollsLeft <= 0) return send(ws, { type: 'error', message: '没有剩余重投次数。' });

  const attacker = getPlayerById(room, game.attackerId);
  const indices = msg.indices;

  if (!Array.isArray(indices)) return send(ws, { type: 'error', message: '重投参数无效。' });
  for (const idx of indices) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= game.attackDice.length) {
      return send(ws, { type: 'error', message: '重投索引无效。' });
    }
  }

  for (const idx of indices) {
    game.attackDice[idx] = rerollOneDie(game.attackDice[idx], attacker);
  }

  sortDice(game.attackDice);
  game.attackPreviewSelection = [];
  game.rerollsLeft -= 1;

  game.log.push(`${attacker.name}重投${indices.length}枚攻击骰，结果：${diceToText(game.attackDice)}（剩余重投${game.rerollsLeft}次）`);
  broadcastRoom(room);
}

function applyCharacterAttackSkill(room, game, attacker, selectedDice) {
  if (attacker.characterId === 'huangquan') {
    if (areAllValues(selectedDice, 4)) {
      game.attackPierce = true;
      game.attackLevel[attacker.id] += 1;
      game.log.push(`${attacker.name}触发【洞穿】！本次攻击无视防御与力场，并且攻击等级+1。`);
    }
  }

  if (attacker.characterId === 'zhigengniao') {
    if (areAllEven(selectedDice)) {
      let upgraded = 0;
      for (const die of selectedDice) {
        if (die.isAurora || die.slotId === null || die.slotId === undefined) continue;
        const oldSide = game.diceSidesByPlayer[attacker.id][die.slotId];
        const next = upgradeSide(oldSide);
        if (next !== oldSide) {
          game.diceSidesByPlayer[attacker.id][die.slotId] = next;
          upgraded += 1;
        }
      }
      if (upgraded > 0) {
        game.log.push(`${attacker.name}触发【升级】效果，${upgraded}枚骰子面数提升。`);
      }
    }
  }
}

function handleConfirmAttack(ws, msg) {
  const room = getPlayerRoom(ws);
  if (!room || !room.game) return;
  const game = room.game;

  if (room.status !== 'in_game' || game.phase !== 'attack_reroll_or_select') return;
  if (game.attackerId !== ws.playerId) return;

  const attacker = getPlayerById(room, game.attackerId);
  const needCount = game.attackLevel[attacker.id];
  const indices = msg.indices;

  if (!isValidDistinctIndices(indices, needCount, game.attackDice.length)) {
    return send(ws, { type: 'error', message: `必须选择${needCount}枚不同的骰子。` });
  }

  const selectedDice = indices.map((idx) => game.attackDice[idx]);
  game.selectedFourCount[attacker.id] += countSelectedValue(selectedDice, 4);

  applyDaheitaAscendIfReady(room, game, attacker, selectedDice);
  applyCharacterAttackSkill(room, game, attacker, selectedDice);

  game.attackSelection = indices;
  game.attackPreviewSelection = indices.slice();
  game.attackValue = sumByIndices(game.attackDice, indices);

  applyAuroraAEffectOnAttack(room, game, attacker, selectedDice);

  game.phase = 'defense_roll';
  game.defensePreviewSelection = [];
  game.log.push(`${attacker.name}确认攻击值：${game.attackValue}`);

  broadcastRoom(room);
}

function handleRollDefense(ws) {
  const room = getPlayerRoom(ws);
  if (!room || !room.game) return;
  const game = room.game;

  if (room.status !== 'in_game' || game.phase !== 'defense_roll') return;
  if (game.defenderId !== ws.playerId) return;

  const defender = getPlayerById(room, game.defenderId);
  game.defenseDice = makeNormalDiceFromPool(game.diceSidesByPlayer[defender.id]);
  sortDice(game.defenseDice);

  game.defenseSelection = null;
  game.defensePreviewSelection = [];
  game.defenseValue = null;
  game.phase = 'defense_select';
  game.log.push(`${defender.name}投掷防守骰：${diceToText(game.defenseDice)}`);

  broadcastRoom(room);
}

function goNextRound(room, game, newAttacker, newDefender) {
  for (const p of room.players) {
    if (p.characterId === 'daheita') {
      game.auroraUsesRemaining[p.id] += 1;
      game.log.push(`${p.name}触发【大黑塔】回合结束效果，曜彩骰次数+1。`);
    }
  }

  game.round += 1;
  game.attackerId = newAttacker.id;
  game.defenderId = newDefender.id;
  game.phase = 'attack_roll';
  game.attackDice = null;
  game.defenseDice = null;
  game.attackSelection = null;
  game.defenseSelection = null;
  game.attackPreviewSelection = [];
  game.defensePreviewSelection = [];
  game.attackValue = null;
  game.defenseValue = null;
  game.attackPierce = false;
  game.rerollsLeft = 2;
  game.extraAttackQueued = false;
  game.roundAuroraUsed[newAttacker.id] = false;
  game.roundAuroraUsed[newDefender.id] = false;
  game.forceField[newAttacker.id] = false;
  game.forceField[newDefender.id] = false;
  game.whiteeGuardActive[newAttacker.id] = false;
  game.whiteeGuardActive[newDefender.id] = false;
  game.log.push(`第${game.round}回合开始，攻击方：${newAttacker.name}`);
}

function calcHits(game) {
  let base = game.attackValue;
  if (!game.attackPierce) {
    base = Math.max(0, game.attackValue - game.defenseValue);
  }
  const hits = [base];
  if (game.extraAttackQueued) hits.push(base);
  return hits;
}

function applyXiadieDefendPassives(room, game, defender, attacker, appliedHitValues) {
  if (defender.characterId !== 'xiadie') return;

  for (const hit of appliedHitValues) {
    if (hit >= 8) {
      game.attackLevel[defender.id] += 1;
      game.defenseLevel[defender.id] += 1;
      game.log.push(`${defender.name}触发【遐蝶】防御成长：单次伤害>=8，攻防等级+1。`);
    }

    if (hit > 0 && hit <= 5) {
      const before = game.hp[attacker.id];
      const damage = 3;
      game.hp[attacker.id] -= damage;
      const after = game.hp[attacker.id];
      pushEffectEvent(game, {
        type: 'instant_damage',
        sourcePlayerId: defender.id,
        targetPlayerId: attacker.id,
        amount: damage,
        hpBefore: before,
        hpAfter: after,
      });
      game.log.push(`${defender.name}触发【遐蝶】瞬伤，对${attacker.name}造成3点无视轮次伤害。`);
    }
  }
}

function handleConfirmDefense(ws, msg) {
  const room = getPlayerRoom(ws);
  if (!room || !room.game) return;
  const game = room.game;

  if (room.status !== 'in_game' || game.phase !== 'defense_select') return;
  if (game.defenderId !== ws.playerId) return;

  const defender = getPlayerById(room, game.defenderId);
  const attacker = getPlayerById(room, game.attackerId);
  const needCount = game.defenseLevel[defender.id];
  const indices = msg.indices;

  if (!isValidDistinctIndices(indices, needCount, game.defenseDice.length)) {
    return send(ws, { type: 'error', message: `必须选择${needCount}枚不同的骰子。` });
  }

  const selectedDice = indices.map((idx) => game.defenseDice[idx]);
  game.selectedFourCount[defender.id] += countSelectedValue(selectedDice, 4);

  applyDaheitaAscendIfReady(room, game, defender, selectedDice);

  if (defender.characterId === 'baie' && !game.whiteeGuardUsed[defender.id] && areAllSame(selectedDice)) {
    game.whiteeGuardActive[defender.id] = true;
    game.whiteeGuardUsed[defender.id] = true;
    game.log.push(`${defender.name}触发【白厄】守护，本回合生命最低保留至1（本局限1次）。`);
  }

  game.defenseSelection = indices;
  game.defensePreviewSelection = indices.slice();
  game.defenseValue = sumByIndices(game.defenseDice, indices);

  applyAuroraAEffectOnDefense(room, game, defender, selectedDice);

  const rawHits = calcHits(game);
  const hpBeforeDef = game.hp[defender.id];

  const hitsAfterForce = rawHits.map((h) => {
    if (game.attackPierce) return h;
    if (game.forceField[defender.id]) return 0;
    return h;
  });

  let cappedHits = hitsAfterForce.slice();
  if (game.whiteeGuardActive[defender.id]) {
    const total = cappedHits.reduce((a, b) => a + b, 0);
    const maxLoss = Math.max(0, hpBeforeDef - 1);
    if (total > maxLoss) {
      let remain = maxLoss;
      cappedHits = cappedHits.map((h) => {
        const part = h > remain ? remain : h;
        remain -= part;
        return part;
      });
    }
  }

  let totalDamage = 0;
  for (const h of cappedHits) totalDamage += h;

  game.lastDamage = totalDamage;
  game.hp[defender.id] -= totalDamage;
  const hpAfterDef = game.hp[defender.id];

  pushEffectEvent(game, {
    type: 'damage_resolution',
    attackerId: attacker.id,
    defenderId: defender.id,
    attackValue: game.attackValue,
    defenseValue: game.defenseValue,
    hits: cappedHits,
    forceField: !!(game.forceField[defender.id] && !game.attackPierce),
    hpBefore: hpBeforeDef,
    hpAfter: hpAfterDef,
    pierce: !!game.attackPierce,
  });

  if (game.extraAttackQueued) {
    game.log.push(`${attacker.name}发动复读追加攻击，总伤害${totalDamage}。`);
  } else {
    game.log.push(`${attacker.name}攻击${defender.name}，攻击值${game.attackValue}，防守值${game.defenseValue}，造成${totalDamage}点伤害。`);
  }

  applyXiadieDefendPassives(room, game, defender, attacker, cappedHits);

  if (attacker.characterId === 'baie' && totalDamage > 0) {
    const heal = Math.floor(totalDamage * 0.5);
    if (heal > 0) {
      const before = game.hp[attacker.id];
      const realHeal = Math.min(heal, game.maxHp[attacker.id] - before);
      if (realHeal > 0) {
        game.hp[attacker.id] = before + realHeal;
        pushEffectEvent(game, {
          type: 'heal',
          playerId: attacker.id,
          amount: realHeal,
          hpBefore: before,
          hpAfter: game.hp[attacker.id],
        });
        game.log.push(`${attacker.name}触发【白厄】吸收，回复${realHeal}点生命。`);
      }
    }
  }

  if (game.hp[defender.id] <= 0 || game.hp[attacker.id] <= 0) {
    room.status = 'ended';
    game.status = 'ended';
    game.phase = 'ended';

    if (game.hp[defender.id] <= 0 && game.hp[attacker.id] <= 0) {
      game.winnerId = attacker.id;
      game.log.push('双方同时归零，判定当前攻击方获胜。');
    } else if (game.hp[defender.id] <= 0) {
      game.winnerId = attacker.id;
      game.log.push(`${defender.name}生命值归零，${attacker.name}获胜！`);
    } else {
      game.winnerId = defender.id;
      game.log.push(`${attacker.name}生命值归零，${defender.name}获胜！`);
    }

    broadcastRoom(room);
    return;
  }

  goNextRound(room, game, defender, attacker);
  broadcastRoom(room);
}

function handleUpdateLiveSelection(ws, msg) {
  const room = getPlayerRoom(ws);
  if (!room || !room.game) return;

  const game = room.game;
  if (room.status !== 'in_game') return;

  const indices = msg.indices;
  if (!Array.isArray(indices)) return;

  if (game.phase === 'attack_reroll_or_select' && game.attackerId === ws.playerId && game.attackDice) {
    if (!isValidDistinctIndicesAnyCount(indices, game.attackDice.length)) return;
    game.attackPreviewSelection = indices.slice();
    broadcastRoom(room);
    return;
  }

  if (game.phase === 'defense_select' && game.defenderId === ws.playerId && game.defenseDice) {
    if (!isValidDistinctIndicesAnyCount(indices, game.defenseDice.length)) return;
    const need = game.defenseLevel[game.defenderId];
    if (indices.length > need) return;
    game.defensePreviewSelection = indices.slice();
    broadcastRoom(room);
  }
}

function handlePlayAgain(ws) {
  const room = getPlayerRoom(ws);
  if (!room) return;
  if (room.status !== 'ended') return send(ws, { type: 'error', message: '当前不在结算阶段。' });

  room.status = 'lobby';
  room.game = null;
  room.waitingReason = '等待双方确认开局配置。';
  startGameIfReady(room);
  broadcastRoom(room);
}

function handleDisbandRoom(ws) {
  const room = getPlayerRoom(ws);
  if (!room) return;

  const players = room.players.slice();
  rooms.delete(room.code);

  for (const p of players) {
    p.ws.playerRoomCode = null;
    send(p.ws, { type: 'left_room', reason: '房间已解散。' });
  }
}

wss.on('connection', (ws) => {
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
        handleCreateRoom(ws, msg);
        break;
      case 'join_room':
        handleJoinRoom(ws, msg);
        break;
      case 'choose_character':
        handleChooseCharacter(ws, msg);
        break;
      case 'choose_aurora_die':
        handleChooseAurora(ws, msg);
        break;
      case 'leave_room':
        leaveRoom(ws);
        send(ws, { type: 'left_room' });
        break;
      case 'play_again':
        handlePlayAgain(ws);
        break;
      case 'disband_room':
        handleDisbandRoom(ws);
        break;
      case 'roll_attack':
        handleRollAttack(ws);
        break;
      case 'use_aurora_die':
        handleUseAurora(ws);
        break;
      case 'reroll_attack':
        handleRerollAttack(ws, msg);
        break;
      case 'update_live_selection':
        handleUpdateLiveSelection(ws, msg);
        break;
      case 'confirm_attack_selection':
        handleConfirmAttack(ws, msg);
        break;
      case 'roll_defense':
        handleRollDefense(ws);
        break;
      case 'confirm_defense_selection':
        handleConfirmDefense(ws, msg);
        break;
      default:
        send(ws, { type: 'error', message: `未知消息类型: ${msg.type}` });
    }
  });

  ws.on('close', () => {
    leaveRoom(ws);
  });
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Galaxy Power Party server running at http://localhost:${PORT}`);
});
