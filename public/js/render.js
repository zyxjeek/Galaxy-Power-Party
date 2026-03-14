(function() {
  const { state, dom, send, sendWithFeedback } = GPP;

  function renderSelfActions(game, wrapper) {
    const me = state.me;
    const { findPlayer, getCharacter, clearSelection, getNeedCountForPhase } = GPP;

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
        btn.textContent = state.pendingAction === 'roll_attack' ? '投掷中...' : '投掷攻击骰';
        btn.disabled = !!state.pendingAction;
        btn.onclick = () => {
          clearSelection();
          sendWithFeedback('roll_attack', 'roll_attack');
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
        auroraBtn.textContent = state.pendingAction === 'use_aurora_atk' ? '使用中...' : `使用曜彩骰（剩余${myUses}）`;
        auroraBtn.disabled = usedThisRound || myUses <= 0 || !!state.pendingAction;
        auroraBtn.onclick = () => {
          clearSelection();
          sendWithFeedback('use_aurora_die', 'use_aurora_atk');
        };
        row.appendChild(auroraBtn);
      }

      const rerollBtn = document.createElement('button');
      rerollBtn.textContent = state.pendingAction === 'reroll_attack' ? '重投中...' : '重投已选骰子';
      rerollBtn.disabled = game.rerollsLeft <= 0 || !!state.pendingAction;
      rerollBtn.onclick = () => {
        const indices = [...state.selectedDice];
        clearSelection();
        sendWithFeedback('reroll_attack', 'reroll_attack', { indices });
      };

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = state.pendingAction === 'confirm_attack' ? '确认中...' : `确认攻击（选${needCount}枚）`;
      confirmBtn.disabled = state.selectedDice.size !== needCount || !!state.pendingAction;
      confirmBtn.onclick = () => {
        const indices = [...state.selectedDice];
        clearSelection();
        sendWithFeedback('confirm_attack_selection', 'confirm_attack', { indices });
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
        btn.textContent = state.pendingAction === 'roll_defense' ? '投掷中...' : '投掷防守骰';
        btn.disabled = !!state.pendingAction;
        btn.onclick = () => {
          clearSelection();
          sendWithFeedback('roll_defense', 'roll_defense');
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
        auroraBtn.textContent = state.pendingAction === 'use_aurora_def' ? '使用中...' : `使用曜彩骰（剩余${myUses}）`;
        auroraBtn.disabled = usedThisRound || myUses <= 0 || !!state.pendingAction;
        auroraBtn.onclick = () => {
          clearSelection();
          sendWithFeedback('use_aurora_die', 'use_aurora_def');
        };
        row.appendChild(auroraBtn);
      }

      const confirmBtn = document.createElement('button');
      confirmBtn.textContent = state.pendingAction === 'confirm_defense' ? '确认中...' : `确认防守（选${needCount}枚）`;
      confirmBtn.disabled = state.selectedDice.size !== needCount || !!state.pendingAction;
      confirmBtn.onclick = () => {
        const indices = [...state.selectedDice];
        clearSelection();
        sendWithFeedback('confirm_defense_selection', 'confirm_defense', { indices });
      };

      row.appendChild(confirmBtn);
      wrapper.appendChild(tip);
      wrapper.appendChild(row);
      return;
    }

    wrapper.textContent = '等待下一步...';
  }

  function renderPlayerZone(game, player, zoneEl, isSelf) {
    const { isMe, getDisplayedDiceForPlayer, getCommittedSumForPlayer, getPreviewSelectionForPlayer,
            getNeedCountForPhase, renderDice, renderAuroraHints, sumSelectedIndices } = GPP;

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
    let metaText = `角色：${player.characterName} | 曜彩骰：${player.auroraDiceName || '无'} | 曜彩剩余：${uses} | 选中4累计：${four} | A触发：${aCount} | 力场：${shield}`;

    const extras = [];
    const poison = game.poison && game.poison[player.id];
    if (poison > 0) extras.push(`中毒${poison}`);
    const resilience = game.resilience && game.resilience[player.id];
    if (resilience > 0) extras.push(`韧性${resilience}`);
    const thorns = game.thorns && game.thorns[player.id];
    if (thorns > 0) extras.push(`荆棘${thorns}`);
    const power = game.power && game.power[player.id];
    if (power > 0) extras.push(`力量${power}`);
    if (game.hackActive && game.hackActive[player.id]) extras.push('骇入');
    if (game.danhengCounterReady && game.danhengCounterReady[player.id]) extras.push('反击准备');
    const xilianCum = game.xilianCumulative && game.xilianCumulative[player.id];
    if (xilianCum > 0) extras.push(`累计${xilianCum}`);
    if (game.xilianAscensionActive && game.xilianAscensionActive[player.id]) extras.push('跃升');
    if (extras.length) metaText += ` | ${extras.join(' ')}`;

    meta.textContent = metaText;
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
    const { isMe, findPlayer, getCharacter } = GPP;

    dom.characterButtons.innerHTML = '';

    const me = findPlayer(state.me);
    if (!me) return;

    const list = Object.keys(state.characters).map((id) => state.characters[id]);
    list.forEach((c) => {
      const wrap = document.createElement('div');
      wrap.className = 'tooltipWrap';

      const btn = document.createElement('button');
      btn.textContent = `${c.name} (${c.shortSpec})`;
      if (me.characterId === c.id) btn.classList.add('selectedAurora');
      btn.onclick = () => send('choose_character', { characterId: c.id });

      const tip = document.createElement('div');
      tip.className = 'tooltip';
      tip.innerHTML = `<b>${c.name}</b><br>HP ${c.hp} | ${c.shortSpec}<br>技能：${c.skillText}`;

      wrap.appendChild(btn);
      wrap.appendChild(tip);
      dom.characterButtons.appendChild(wrap);
    });
  }

  function renderAuroraButtons() {
    const { findPlayer, getCharacter } = GPP;

    dom.auroraButtons.innerHTML = '';

    const me = findPlayer(state.me);
    if (!me) return;

    const myChar = getCharacter(me.characterId);
    if (!myChar || myChar.auroraUses <= 0) {
      const p = document.createElement('p');
      p.textContent = '当前角色无需且不能装备曜彩骰。';
      dom.auroraButtons.appendChild(p);
      return;
    }

    state.auroraDice.forEach((a) => {
      const wrap = document.createElement('div');
      wrap.className = 'tooltipWrap';

      const btn = document.createElement('button');
      btn.textContent = a.name;
      if (me.auroraDiceId === a.id) btn.classList.add('selectedAurora');
      btn.onclick = () => send('choose_aurora_die', { auroraDiceId: a.id });

      const tip = document.createElement('div');
      tip.className = 'tooltip';
      tip.innerHTML = `<b>${a.name}</b><br>骰面：${a.facesText}<br>${a.effectText}<br>条件：${a.conditionText}`;

      wrap.appendChild(btn);
      wrap.appendChild(tip);
      dom.auroraButtons.appendChild(wrap);
    });
  }

  function render() {
    const { hideWinnerOverlay, showWinnerOverlay, isMe, findPlayer } = GPP;

    hideWinnerOverlay();

    if (!state.room) {
      dom.connectionPanel.classList.remove('hidden');
      dom.roomPanel.classList.add('hidden');
      if (dom.msgPanel) dom.msgPanel.classList.remove('hidden');
      return;
    }

    dom.connectionPanel.classList.add('hidden');
    dom.roomPanel.classList.remove('hidden');
    if (dom.msgPanel) dom.msgPanel.classList.remove('hidden');

    dom.roomCodeEl.textContent = state.room.code;

    dom.playersList.innerHTML = '';
    state.room.players.forEach((p) => {
      const li = document.createElement('li');
      const self = isMe(p.id);
      const charText = p.characterName || '未公开';
      const auraText = p.auroraDiceName ? p.auroraDiceName : self ? '无' : '未公开';
      li.textContent = `${p.name}${self ? '（你）' : ''} - 角色：${charText}，曜彩骰：${auraText}`;
      dom.playersList.appendChild(li);
    });

    if (state.room.game) {
      if (state.room.game.status === 'ended') {
        dom.roomPanel.classList.add('hidden');
        if (dom.msgPanel) dom.msgPanel.classList.add('hidden');
        const winner = findPlayer(state.room.game.winnerId);
        showWinnerOverlay(`恭喜${(winner && winner.name) || '未知玩家'}胜利`);
        return;
      }

      dom.lobbyArea.classList.add('hidden');
      dom.gameArea.classList.remove('hidden');

      const game = state.room.game;
      dom.roundInfo.textContent = `第 ${game.round} 回合 | 阶段：${game.phase}`;

      const attacker = findPlayer(game.attackerId);
      const defender = findPlayer(game.defenderId);
      dom.turnInfo.textContent = `攻击方：${(attacker && attacker.name) || '-'} | 防守方：${(defender && defender.name) || '-'}`;

      const me = findPlayer(state.me);
      let enemy = null;
      state.room.players.forEach((p) => {
        if (p.id !== state.me) enemy = p;
      });

      renderPlayerZone(game, enemy, dom.enemyZone, false);
      renderPlayerZone(game, me, dom.selfZone, true);
      dom.logBox.textContent = (game.log || []).slice(-60).join('\n');
    } else {
      dom.lobbyArea.classList.remove('hidden');
      dom.gameArea.classList.add('hidden');

      renderCharacterButtons();
      renderAuroraButtons();

      dom.lobbyHint.textContent = state.room.waitingReason || '房间达到2人后自动开始。';
      dom.logBox.textContent = '等待玩家加入并完成开局配置...';
    }
  }

  GPP.render = render;
})();
