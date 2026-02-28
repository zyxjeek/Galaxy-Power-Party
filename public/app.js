const wsProtocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
const ws = new WebSocket(`${wsProtocol}//${location.host}`);

const state = {
  me: null,
  room: null,
  selectedDice: new Set(),
  characters: {},
  auroraDice: [],
  lastProcessedEffectId: 0,
  animationChain: Promise.resolve(),
};

const myIdEl = document.getElementById('myId');
const nameInput = document.getElementById('nameInput');
const roomCodeInput = document.getElementById('roomCodeInput');
const createBtn = document.getElementById('createBtn');
const joinBtn = document.getElementById('joinBtn');
const leaveBtn = document.getElementById('leaveBtn');
const messageEl = document.getElementById('message');
const msgPanel = document.getElementById('msgPanel');

const connectionPanel = document.getElementById('connectionPanel');
const roomPanel = document.getElementById('roomPanel');
const roomCodeEl = document.getElementById('roomCode');
const playersList = document.getElementById('playersList');
const lobbyArea = document.getElementById('lobbyArea');
const gameArea = document.getElementById('gameArea');
const roundInfo = document.getElementById('roundInfo');
const turnInfo = document.getElementById('turnInfo');
const enemyZone = document.getElementById('enemyZone');
const selfZone = document.getElementById('selfZone');
const logBox = document.getElementById('logBox');
const characterButtons = document.getElementById('characterButtons');
const characterDesc = document.getElementById('characterDesc');
const auroraButtons = document.getElementById('auroraButtons');
const auroraDesc = document.getElementById('auroraDesc');
const lobbyHint = document.getElementById('lobbyHint');

function send(type, payload = {}) {
  ws.send(JSON.stringify({ type, ...payload }));
}

function setMessage(msg) {
  messageEl.textContent = msg;
}

function getWinnerOverlay() {
  let node = document.getElementById('winnerOverlay');
  if (!node) {
    node = document.createElement('div');
    node.id = 'winnerOverlay';
    node.className = 'winnerOverlay hidden';

    const card = document.createElement('div');
    card.className = 'winnerOverlayCard';

    const text = document.createElement('div');
    text.id = 'winnerOverlayText';
    text.className = 'winnerOverlayText';
    card.appendChild(text);

    const actions = document.createElement('div');
    actions.className = 'winnerOverlayActions';

    const playAgainBtn = document.createElement('button');
    playAgainBtn.id = 'winnerPlayAgainBtn';
    playAgainBtn.textContent = '再来一局';
    playAgainBtn.onclick = () => send('play_again');

    const disbandBtn = document.createElement('button');
    disbandBtn.id = 'winnerDisbandBtn';
    disbandBtn.className = 'danger';
    disbandBtn.textContent = '解散房间';
    disbandBtn.onclick = () => send('disband_room');

    actions.appendChild(playAgainBtn);
    actions.appendChild(disbandBtn);
    card.appendChild(actions);
    node.appendChild(card);
    document.body.appendChild(node);
  }
  return node;
}

function showWinnerOverlay(text) {
  const node = getWinnerOverlay();
  const textNode = document.getElementById('winnerOverlayText');
  if (textNode) textNode.textContent = text;
  node.classList.remove('hidden');
}

function hideWinnerOverlay() {
  const node = document.getElementById('winnerOverlay');
  if (node) node.classList.add('hidden');
}

function getErrorToastContainer() {
  let box = document.getElementById('errorToastContainer');
  if (!box) {
    box = document.createElement('div');
    box.id = 'errorToastContainer';
    box.className = 'errorToastContainer';
    document.body.appendChild(box);
  }
  return box;
}

function showErrorToast(text) {
  const container = getErrorToastContainer();
  const toast = document.createElement('div');
  toast.className = 'errorToast';

  const msg = document.createElement('div');
  msg.className = 'errorToastMsg';
  msg.textContent = text || '发生错误';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'errorToastClose';
  closeBtn.type = 'button';
  closeBtn.textContent = 'x';

  let removed = false;
  const removeToast = () => {
    if (removed) return;
    removed = true;
    toast.classList.add('hide');
    setTimeout(() => {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 180);
  };

  closeBtn.onclick = removeToast;
  toast.appendChild(msg);
  toast.appendChild(closeBtn);
  container.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(removeToast, 2600);
}

function getMyName() {
  const name = nameInput.value.trim();
  return name || `玩家${Math.floor(Math.random() * 1000)}`;
}

function isMe(playerId) {
  return state.me === playerId;
}

function findPlayer(id) {
  if (!state.room || !state.room.players) return null;
  return state.room.players.find((p) => p.id === id) || null;
}

function getCharacter(characterId) {
  return state.characters[characterId] || null;
}

function clearSelection() {
  state.selectedDice.clear();
}

function setSelection(indices) {
  state.selectedDice = new Set(indices || []);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getFxLayer() {
  let layer = document.getElementById('fxLayer');
  if (!layer) {
    layer = document.createElement('div');
    layer.id = 'fxLayer';
    layer.className = 'fxLayer';
    document.body.appendChild(layer);
  }
  return layer;
}

function createFxBox(text, className) {
  const node = document.createElement('div');
  node.className = `fxBox ${className || ''}`.trim();
  node.textContent = text;
  return node;
}

function placeNodeAtCenter(node, rect) {
  node.style.left = `${rect.left + rect.width / 2}px`;
  node.style.top = `${rect.top + rect.height / 2}px`;
}

function moveNodeTo(node, rect, duration) {
  return new Promise((resolve) => {
    node.style.transition = `left ${duration}ms ease, top ${duration}ms ease, opacity ${duration}ms ease`;
    requestAnimationFrame(() => {
      placeNodeAtCenter(node, rect);
      node.style.opacity = '1';
    });
    setTimeout(resolve, duration + 40);
  });
}

function getZoneByPlayerId(playerId) {
  return playerId === state.me ? selfZone : enemyZone;
}

function getHpBadgeByPlayerId(playerId) {
  return document.querySelector(`.hpBadge[data-player-id="${playerId}"]`);
}

function setHpBadge(playerId, hp) {
  const badge = getHpBadgeByPlayerId(playerId);
  if (badge) badge.textContent = `HP ${hp}`;
}

async function animateHealEvent(event) {
  const badge = getHpBadgeByPlayerId(event.playerId);
  if (!badge) return;

  const layer = getFxLayer();
  setHpBadge(event.playerId, event.hpBefore);

  const plus = document.createElement('div');
  plus.className = 'healFloat';
  plus.textContent = `+${event.amount}`;
  layer.appendChild(plus);

  const rect = badge.getBoundingClientRect();
  plus.style.left = `${rect.left + rect.width / 2}px`;
  plus.style.top = `${rect.top + rect.height / 2}px`;

  await sleep(80);
  plus.classList.add('show');
  await sleep(700);
  setHpBadge(event.playerId, event.hpAfter);
  plus.remove();
}

async function animateDamageEvent(event) {
  const layer = getFxLayer();
  const attackerZone = getZoneByPlayerId(event.attackerId);
  const defenderZone = getZoneByPlayerId(event.defenderId);
  if (!attackerZone || !defenderZone) return;

  const attackerRect = attackerZone.getBoundingClientRect();
  const defenderRect = defenderZone.getBoundingClientRect();
  const centerRect = {
    left: window.innerWidth / 2 - 50,
    top: window.innerHeight / 2 - 20,
    width: 100,
    height: 40,
  };

  const atkClass = event.pierce ? 'atkBox pierceBox' : 'atkBox';
  const atkBox = createFxBox(`攻击 ${event.attackValue}`, atkClass);
  const defBox = createFxBox(`防守 ${event.defenseValue}`, 'defBox');
  layer.appendChild(atkBox);
  layer.appendChild(defBox);

  placeNodeAtCenter(atkBox, attackerRect);
  placeNodeAtCenter(defBox, defenderRect);

  await Promise.all([moveNodeTo(atkBox, centerRect, 350), moveNodeTo(defBox, centerRect, 350)]);

  atkBox.remove();
  defBox.remove();

  const hpBadge = getHpBadgeByPlayerId(event.defenderId);
  if (!hpBadge) return;
  setHpBadge(event.defenderId, event.hpBefore);

  const hpRect = hpBadge.getBoundingClientRect();
  const damageBox = createFxBox('伤害', 'damageBox');
  layer.appendChild(damageBox);
  placeNodeAtCenter(damageBox, centerRect);

  let hpNow = event.hpBefore;
  const hits = event.hits || [];
  for (let i = 0; i < hits.length; i += 1) {
    const dmg = hits[i];
    damageBox.textContent = `伤害 ${dmg}`;
    await moveNodeTo(damageBox, hpRect, 280);
    hpNow -= dmg;
    if (hpNow < 0) hpNow = 0;
    if (!event.forceField) {
      setHpBadge(event.defenderId, hpNow);
    }
    await sleep(160);
    placeNodeAtCenter(damageBox, centerRect);
    damageBox.style.opacity = '0.92';
    await sleep(90);
  }

  if (event.forceField) {
    setHpBadge(event.defenderId, event.hpBefore);
  } else {
    setHpBadge(event.defenderId, event.hpAfter);
  }
  damageBox.remove();
}

async function animateInstantDamageEvent(event) {
  const layer = getFxLayer();
  const sourceZone = getZoneByPlayerId(event.sourcePlayerId);
  const hpBadge = getHpBadgeByPlayerId(event.targetPlayerId);
  if (!sourceZone || !hpBadge) return;

  const sourceRect = sourceZone.getBoundingClientRect();
  const hpRect = hpBadge.getBoundingClientRect();

  setHpBadge(event.targetPlayerId, event.hpBefore);

  const box = createFxBox(`瞬伤 ${event.amount}`, 'instantBox');
  layer.appendChild(box);
  placeNodeAtCenter(box, sourceRect);

  await moveNodeTo(box, hpRect, 320);
  setHpBadge(event.targetPlayerId, event.hpAfter);
  await sleep(120);
  box.remove();
}

function queueEffectAnimation(event) {
  state.animationChain = state.animationChain.then(async () => {
    if (event.type === 'heal') {
      await animateHealEvent(event);
      return;
    }
    if (event.type === 'damage_resolution') {
      await animateDamageEvent(event);
      return;
    }
    if (event.type === 'instant_damage') {
      await animateInstantDamageEvent(event);
    }
  }).catch(() => {});
}

function processEffectEvents(game, shouldAnimate) {
  const events = game.effectEvents || [];
  if (!events.length) return;

  if (!shouldAnimate) {
    state.lastProcessedEffectId = events[events.length - 1].id;
    return;
  }

  events.forEach((ev) => {
    if (ev.id > state.lastProcessedEffectId) {
      queueEffectAnimation(ev);
      state.lastProcessedEffectId = ev.id;
    }
  });
}

function sumSelectedIndices(dice, indices) {
  let sum = 0;
  indices.forEach((idx) => {
    if (dice[idx]) sum += dice[idx].value;
  });
  return sum;
}

function getNeedCountForPhase(game, phase) {
  if (phase === 'attack') {
    return game.attackLevel && game.attackLevel[game.attackerId] !== undefined ? game.attackLevel[game.attackerId] : 3;
  }
  return game.defenseLevel && game.defenseLevel[game.defenderId] !== undefined ? game.defenseLevel[game.defenderId] : 3;
}

function toggleDie(index, maxSelectable) {
  if (state.selectedDice.has(index)) {
    state.selectedDice.delete(index);
  } else if (maxSelectable === null || maxSelectable === undefined || state.selectedDice.size < maxSelectable) {
    state.selectedDice.add(index);
  }
  send('update_live_selection', { indices: [...state.selectedDice] });
  render();
}

function getDieShapeClass(die) {
  if (die.isAurora) return 'shape-aurora';
  if (die.sides === 4) return 'shape-d4';
  if (die.sides === 6) return 'shape-d6';
  if (die.sides === 8) return 'shape-d8';
  if (die.sides === 12) return 'shape-d12';
  return 'shape-d6';
}

function renderDice(dice, maxSelectable, clickable, selectedSet) {
  const row = document.createElement('div');
  row.className = 'diceRow';

  dice.forEach((die, index) => {
    const node = document.createElement('div');
    node.className = `die ${getDieShapeClass(die)}`;
    if (selectedSet && selectedSet.has(index)) node.classList.add('selected');

    const label = document.createElement('span');
    label.className = 'dieLabel';
    label.textContent = die.label;
    node.appendChild(label);

    if (clickable) {
      node.onclick = () => toggleDie(index, maxSelectable);
    }
    row.appendChild(node);
  });

  return row;
}

function renderAuroraHints(dice) {
  const seen = {};
  const box = document.createElement('div');
  box.className = 'auroraDesc';

  dice.forEach((d) => {
    if (!d.isAurora || !d.auroraId || seen[d.auroraId]) return;
    seen[d.auroraId] = true;

    const p = document.createElement('p');
    p.textContent = `曜彩骰【${d.auroraName}】：${d.effectText}；条件：${d.conditionText}`;
    box.appendChild(p);
  });

  if (!box.childNodes.length) return null;
  return box;
}

function getDisplayedDiceForPlayer(game, playerId) {
  if (game.attackerId === playerId && game.attackDice) {
    if (game.attackSelection && game.attackSelection.length) {
      return {
        dice: game.attackSelection.map((idx) => game.attackDice[idx]).filter(Boolean),
        lane: 'attack_selected',
      };
    }
    return { dice: game.attackDice, lane: 'attack' };
  }

  if (game.defenderId === playerId && game.defenseDice) {
    return { dice: game.defenseDice, lane: 'defense' };
  }

  return null;
}

function getCommittedSumForPlayer(game, playerId) {
  if (game.attackerId === playerId && game.attackSelection && game.attackDice) {
    return {
      sum: game.attackValue,
      count: game.attackSelection.length,
      kind: game.attackPierce ? '攻击(洞穿)' : '攻击',
      pierce: !!game.attackPierce,
    };
  }

  if (game.defenderId === playerId && game.defenseSelection && game.defenseDice) {
    return { sum: game.defenseValue, count: game.defenseSelection.length, kind: '防守', pierce: false };
  }

  return null;
}

function getPreviewSelectionForPlayer(game, playerId) {
  if (game.phase === 'attack_reroll_or_select' && game.attackerId === playerId && game.attackDice) {
    const indices = game.attackPreviewSelection || [];
    return {
      indices,
      sum: sumSelectedIndices(game.attackDice, indices),
      kind: '攻击实时',
    };
  }

  if (game.phase === 'defense_select' && game.defenderId === playerId && game.defenseDice) {
    const indices = game.defensePreviewSelection || [];
    return {
      indices,
      sum: sumSelectedIndices(game.defenseDice, indices),
      kind: '防守实时',
    };
  }

  return null;
}

function renderSelfActions(game, wrapper) {
  const me = state.me;

  if (game.status === 'ended') {
    const winner = findPlayer(game.winnerId);
    const p = document.createElement('p');
    p.textContent = `本局结束，胜者：${(winner && winner.name) || '未知'}`;
    wrapper.appendChild(p);
    return;
  }

  if (game.phase === 'attack_roll') {
    if (game.attackerId === me) {
      const btn = document.createElement('button');
      btn.textContent = '投掷攻击骰';
      btn.onclick = () => {
        clearSelection();
        send('roll_attack');
      };
      wrapper.appendChild(btn);
    } else {
      wrapper.textContent = '等待攻击方投掷...';
    }
    return;
  }

  if (game.phase === 'attack_reroll_or_select') {
    if (game.attackerId !== me) {
      wrapper.textContent = '敌方正在重投或确认攻击值...';
      return;
    }

    const needCount = getNeedCountForPhase(game, 'attack');
    const myUses = game.auroraUsesRemaining && game.auroraUsesRemaining[me] !== undefined ? game.auroraUsesRemaining[me] : 0;
    const usedThisRound = game.roundAuroraUsed && game.roundAuroraUsed[me];
    const mePlayer = findPlayer(me);
    const meChar = mePlayer ? getCharacter(mePlayer.characterId) : null;

    const tip = document.createElement('p');
    tip.className = 'tip';
    tip.textContent = `攻击阶段：可重投任意数量骰子（剩余${game.rerollsLeft}次），确认时必须选${needCount}枚。`;

    const row = document.createElement('div');
    row.className = 'actions';

    if (!meChar || meChar.auroraUses > 0) {
      const auroraBtn = document.createElement('button');
      auroraBtn.textContent = `使用曜彩骰（剩余${myUses}）`;
      auroraBtn.disabled = usedThisRound || myUses <= 0;
      auroraBtn.onclick = () => {
        clearSelection();
        send('use_aurora_die');
      };
      row.appendChild(auroraBtn);
    }

    const rerollBtn = document.createElement('button');
    rerollBtn.textContent = '重投已选骰子';
    rerollBtn.disabled = game.rerollsLeft <= 0;
    rerollBtn.onclick = () => {
      send('reroll_attack', { indices: [...state.selectedDice] });
      clearSelection();
    };

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = `确认攻击（选${needCount}枚）`;
    confirmBtn.disabled = state.selectedDice.size !== needCount;
    confirmBtn.onclick = () => {
      send('confirm_attack_selection', { indices: [...state.selectedDice] });
      clearSelection();
    };

    row.appendChild(rerollBtn);
    row.appendChild(confirmBtn);
    wrapper.appendChild(tip);
    wrapper.appendChild(row);
    return;
  }

  if (game.phase === 'defense_roll') {
    if (game.defenderId === me) {
      const btn = document.createElement('button');
      btn.textContent = '投掷防守骰';
      btn.onclick = () => {
        clearSelection();
        send('roll_defense');
      };
      wrapper.appendChild(btn);
    } else {
      wrapper.textContent = '等待防守方投掷...';
    }
    return;
  }

  if (game.phase === 'defense_select') {
    if (game.defenderId !== me) {
      wrapper.textContent = '敌方正在使用曜彩骰或确认防守值...';
      return;
    }

    const needCount = getNeedCountForPhase(game, 'defense');
    const myUses = game.auroraUsesRemaining && game.auroraUsesRemaining[me] !== undefined ? game.auroraUsesRemaining[me] : 0;
    const usedThisRound = game.roundAuroraUsed && game.roundAuroraUsed[me];
    const mePlayer = findPlayer(me);
    const meChar = mePlayer ? getCharacter(mePlayer.characterId) : null;

    const tip = document.createElement('p');
    tip.className = 'tip';
    tip.textContent = `防守阶段：请选择${needCount}枚骰子确认防守值。`;

    const row = document.createElement('div');
    row.className = 'actions';

    if (!meChar || meChar.auroraUses > 0) {
      const auroraBtn = document.createElement('button');
      auroraBtn.textContent = `使用曜彩骰（剩余${myUses}）`;
      auroraBtn.disabled = usedThisRound || myUses <= 0;
      auroraBtn.onclick = () => {
        clearSelection();
        send('use_aurora_die');
      };
      row.appendChild(auroraBtn);
    }

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = `确认防守（选${needCount}枚）`;
    confirmBtn.disabled = state.selectedDice.size !== needCount;
    confirmBtn.onclick = () => {
      send('confirm_defense_selection', { indices: [...state.selectedDice] });
      clearSelection();
    };

    row.appendChild(confirmBtn);
    wrapper.appendChild(tip);
    wrapper.appendChild(row);
    return;
  }

  wrapper.textContent = '等待下一步...';
}

function renderPlayerZone(game, player, zoneEl, isSelf) {
  zoneEl.innerHTML = '';

  const title = document.createElement('div');
  title.className = 'zoneHeader';

  const name = document.createElement('h3');
  name.textContent = `${isSelf ? '我方' : '敌方'}：${player ? player.name : '-'}`;

  const hp = document.createElement('div');
  hp.className = 'hpBadge';
  if (player) hp.setAttribute('data-player-id', player.id);
  const hpVal = game.hp && player ? game.hp[player.id] : '-';
  hp.textContent = `HP ${hpVal}`;

  title.appendChild(name);
  title.appendChild(hp);
  zoneEl.appendChild(title);

  if (!player) return;

  const atkLevel = game.attackLevel && game.attackLevel[player.id] !== undefined ? game.attackLevel[player.id] : '-';
  const defLevel = game.defenseLevel && game.defenseLevel[player.id] !== undefined ? game.defenseLevel[player.id] : '-';
  const levelBox = document.createElement('div');
  levelBox.className = 'atkDefBox';
  levelBox.textContent = `攻击 ${atkLevel} / 防守 ${defLevel}`;
  zoneEl.appendChild(levelBox);

  const uses = game.auroraUsesRemaining && game.auroraUsesRemaining[player.id] !== undefined ? game.auroraUsesRemaining[player.id] : '-';
  const four = game.selectedFourCount && game.selectedFourCount[player.id] !== undefined ? game.selectedFourCount[player.id] : 0;
  const shield = game.forceField && game.forceField[player.id] ? '开启' : '关闭';
  const aCount = game.auroraAEffectCount && game.auroraAEffectCount[player.id] !== undefined ? game.auroraAEffectCount[player.id] : 0;

  const meta = document.createElement('p');
  meta.className = 'metaLine';
  meta.textContent = `角色：${player.characterName} | 曜彩骰：${player.auroraDiceName || '无'} | 曜彩剩余：${uses} | 选中4累计：${four} | A触发：${aCount} | 力场：${shield}`;
  zoneEl.appendChild(meta);

  const displayed = getDisplayedDiceForPlayer(game, player.id);
  const diceTitle = document.createElement('p');
  diceTitle.className = 'metaLine';

  if (!displayed) {
    diceTitle.textContent = '当前骰子：暂无';
    zoneEl.appendChild(diceTitle);
  } else {
    const laneText = displayed.lane === 'attack' ? '攻击' : displayed.lane === 'attack_selected' ? '攻击(已选)' : '防守';
    diceTitle.textContent = `当前${laneText}骰子：`;
    zoneEl.appendChild(diceTitle);

    const center = document.createElement('div');
    center.className = 'diceCenter';

    let clickable = false;
    let maxSelectable = 0;
    if (isSelf && game.phase === 'attack_reroll_or_select' && game.attackerId === player.id && displayed.lane === 'attack') {
      clickable = true;
      maxSelectable = null;
    }
    if (isSelf && game.phase === 'defense_select' && game.defenderId === player.id && displayed.lane === 'defense') {
      clickable = true;
      maxSelectable = getNeedCountForPhase(game, 'defense');
    }

    const preview = getPreviewSelectionForPlayer(game, player.id);
    let selectedSet = null;
    if (clickable) {
      selectedSet = state.selectedDice;
    } else if (preview) {
      selectedSet = new Set(preview.indices);
    }

    const wrap = document.createElement('div');
    wrap.className = 'diceRowWrap';
    wrap.appendChild(renderDice(displayed.dice, maxSelectable, clickable, selectedSet));

    const committed = getCommittedSumForPlayer(game, player.id);
    const sumBadge = document.createElement('div');
    sumBadge.className = `sumBadge${committed && committed.pierce ? ' pierce' : ''}`;
    if (committed) {
      sumBadge.textContent = `${committed.kind} ${committed.sum}`;
    } else if (clickable) {
      const liveSum = sumSelectedIndices(displayed.dice, [...state.selectedDice]);
      sumBadge.textContent = `实时 ${liveSum}`;
    } else if (preview) {
      sumBadge.textContent = `实时 ${preview.sum}`;
    } else {
      sumBadge.textContent = '--';
    }
    wrap.appendChild(sumBadge);

    center.appendChild(wrap);
    zoneEl.appendChild(center);

    const hints = renderAuroraHints(displayed.dice);
    if (hints) zoneEl.appendChild(hints);

    if (committed) {
      const sumLine = document.createElement('p');
      sumLine.className = 'sumLine';
      sumLine.textContent = `${committed.kind}已确认：${committed.count}枚，总和 ${committed.sum}`;
      zoneEl.appendChild(sumLine);
    }
  }

  if (isSelf) {
    const actionWrap = document.createElement('div');
    actionWrap.className = 'panel subpanel';
    renderSelfActions(game, actionWrap);
    zoneEl.appendChild(actionWrap);
  }
}

function renderCharacterButtons() {
  characterButtons.innerHTML = '';

  const me = findPlayer(state.me);
  if (!me) return;

  const list = Object.keys(state.characters).map((id) => state.characters[id]);
  list.forEach((c) => {
    const btn = document.createElement('button');
    btn.textContent = `${c.name} (${c.shortSpec})`;
    if (me.characterId === c.id) btn.classList.add('selectedAurora');
    btn.onclick = () => send('choose_character', { characterId: c.id });
    characterButtons.appendChild(btn);
  });
}

function renderCharacterDesc() {
  characterDesc.innerHTML = '';
  const list = Object.keys(state.characters).map((id) => state.characters[id]);
  list.forEach((c) => {
    const p = document.createElement('p');
    p.textContent = `【${c.name}】${c.hp}生命 | ${c.shortSpec} | 技能：${c.skillText}`;
    characterDesc.appendChild(p);
  });
}

function renderAuroraButtons() {
  auroraButtons.innerHTML = '';

  const me = findPlayer(state.me);
  if (!me) return;

  const myChar = getCharacter(me.characterId);
  if (!myChar || myChar.auroraUses <= 0) {
    const p = document.createElement('p');
    p.textContent = '当前角色无需且不能装备曜彩骰。';
    auroraButtons.appendChild(p);
    return;
  }

  state.auroraDice.forEach((a) => {
    const btn = document.createElement('button');
    btn.textContent = a.name;
    if (me.auroraDiceId === a.id) btn.classList.add('selectedAurora');
    btn.onclick = () => send('choose_aurora_die', { auroraDiceId: a.id });
    auroraButtons.appendChild(btn);
  });
}

function renderAuroraDesc() {
  auroraDesc.innerHTML = '';
  state.auroraDice.forEach((a) => {
    const p = document.createElement('p');
    p.textContent = `【${a.name}】骰面: ${a.facesText} | ${a.effectText} | 条件: ${a.conditionText}`;
    auroraDesc.appendChild(p);
  });
}

function render() {
  hideWinnerOverlay();

  if (!state.room) {
    connectionPanel.classList.remove('hidden');
    roomPanel.classList.add('hidden');
    if (msgPanel) msgPanel.classList.remove('hidden');
    return;
  }

  connectionPanel.classList.add('hidden');
  roomPanel.classList.remove('hidden');
  if (msgPanel) msgPanel.classList.remove('hidden');

  roomCodeEl.textContent = state.room.code;

  playersList.innerHTML = '';
  state.room.players.forEach((p) => {
    const li = document.createElement('li');
    const self = isMe(p.id);
    const charText = p.characterName || '未公开';
    const auraText = p.auroraDiceName ? p.auroraDiceName : self ? '无' : '未公开';
    li.textContent = `${p.name}${self ? '（你）' : ''} - 角色：${charText}，曜彩骰：${auraText}`;
    playersList.appendChild(li);
  });

  if (state.room.game) {
    if (state.room.game.status === 'ended') {
      roomPanel.classList.add('hidden');
      if (msgPanel) msgPanel.classList.add('hidden');
      const winner = findPlayer(state.room.game.winnerId);
      showWinnerOverlay(`恭喜${(winner && winner.name) || '未知玩家'}胜利`);
      return;
    }

    lobbyArea.classList.add('hidden');
    gameArea.classList.remove('hidden');

    const game = state.room.game;
    roundInfo.textContent = `第 ${game.round} 回合 | 阶段：${game.phase}`;

    const attacker = findPlayer(game.attackerId);
    const defender = findPlayer(game.defenderId);
    turnInfo.textContent = `攻击方：${(attacker && attacker.name) || '-'} | 防守方：${(defender && defender.name) || '-'}`;

    const me = findPlayer(state.me);
    let enemy = null;
    state.room.players.forEach((p) => {
      if (p.id !== state.me) enemy = p;
    });

    renderPlayerZone(game, enemy, enemyZone, false);
    renderPlayerZone(game, me, selfZone, true);
    logBox.textContent = (game.log || []).slice(-60).join('\n');
  } else {
    lobbyArea.classList.remove('hidden');
    gameArea.classList.add('hidden');

    renderCharacterButtons();
    renderCharacterDesc();
    renderAuroraButtons();
    renderAuroraDesc();

    lobbyHint.textContent = state.room.waitingReason || '房间达到2人后自动开始。';
    logBox.textContent = '等待玩家加入并完成开局配置...';
  }
}

createBtn.onclick = () => {
  send('create_room', { name: getMyName() });
};

joinBtn.onclick = () => {
  send('join_room', { name: getMyName(), code: roomCodeInput.value.trim() });
};

leaveBtn.onclick = () => {
  clearSelection();
  send('leave_room');
};

ws.onopen = () => {
  setMessage('已连接服务器。');
};

ws.onclose = () => {
  setMessage('与服务器连接断开。请刷新页面重连。');
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === 'welcome') {
    state.me = msg.playerId;
    (msg.characters || []).forEach((c) => {
      state.characters[c.id] = c;
    });
    state.auroraDice = msg.auroraDice || [];
    myIdEl.textContent = `玩家ID：${msg.playerId}`;
    setMessage('连接成功。你可以创建或加入房间。');
    return;
  }

  if (msg.type === 'room_state') {
    const prevRoomCode = state.room && state.room.code;
    const prevHadGame = !!(state.room && state.room.game);

    state.room = msg.room;
    if (!state.room.game) {
      clearSelection();
      state.lastProcessedEffectId = 0;
    } else if (state.room.game.phase === 'attack_reroll_or_select' && state.room.game.attackerId === state.me) {
      setSelection(state.room.game.attackPreviewSelection || []);
    } else if (state.room.game.phase === 'defense_select' && state.room.game.defenderId === state.me) {
      setSelection(state.room.game.defensePreviewSelection || []);
    } else {
      clearSelection();
    }

    render();
    processEffectEvents(state.room.game || {}, prevRoomCode === state.room.code && prevHadGame);
    return;
  }

  if (msg.type === 'left_room') {
    state.room = null;
    clearSelection();
    state.lastProcessedEffectId = 0;
    render();
    setMessage(msg.reason || '你已退出房间。');
    return;
  }

  if (msg.type === 'error') {
    setMessage(`错误：${msg.message}`);
    showErrorToast(msg.message);
  }
};

render();
