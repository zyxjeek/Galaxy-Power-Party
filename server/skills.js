const { AURORA_DICE } = require('./characters');
const { getPlayerById, pushEffectEvent } = require('./rooms');
const {
  countSelectedValue,
  areAllValues,
  areAllEven,
  hasDuplicates,
  countDistinctPairedValues,
  countUniqueValues,
  countOddValues,
  upgradeSide,
} = require('./dice');

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

function applyAscension(room, game, player, selectedDice) {
  let shouldAscend = false;
  if (player.characterId === 'daheita' && (game.auroraAEffectCount[player.id] || 0) >= 4) {
    shouldAscend = true;
  }
  if (player.characterId === 'xilian' && game.xilianAscensionActive[player.id]) {
    shouldAscend = true;
  }
  if (!shouldAscend || !selectedDice.length) return;

  let minDie = selectedDice[0];
  for (const d of selectedDice) {
    if (d.value < minDie.value) minDie = d;
  }

  minDie.value = minDie.maxValue;
  minDie.label = minDie.hasA ? `${minDie.value}A` : `${minDie.value}`;
  game.log.push(`${player.name}触发【跃升】，将最小点骰子提升到最大值${minDie.maxValue}。`);
}

function applyHackEffects(game, attacker, defender) {
  if (game.hackActive[attacker.id] && game.defenseSelection) {
    let maxDie = null;
    for (const idx of game.defenseSelection) {
      const d = game.defenseDice[idx];
      if (!d.isAurora && (!maxDie || d.value > maxDie.value)) maxDie = d;
    }
    if (maxDie && maxDie.value > 2) {
      const diff = maxDie.value - 2;
      maxDie.value = 2;
      maxDie.label = '2';
      game.defenseValue -= diff;
      game.log.push(`${attacker.name}的【骇入】生效，${defender.name}防守值-${diff}（变为${game.defenseValue}）。`);
    }
  }
  if (game.hackActive[defender.id] && game.attackSelection) {
    let maxDie = null;
    for (const idx of game.attackSelection) {
      const d = game.attackDice[idx];
      if (!d.isAurora && (!maxDie || d.value > maxDie.value)) maxDie = d;
    }
    if (maxDie && maxDie.value > 2) {
      const diff = maxDie.value - 2;
      maxDie.value = 2;
      maxDie.label = '2';
      game.attackValue -= diff;
      game.log.push(`${defender.name}的【骇入】生效，${attacker.name}攻击值-${diff}（变为${game.attackValue}）。`);
    }
  }
}

function applyThornsDamage(game, room) {
  for (const p of room.players) {
    if (game.thorns[p.id] > 0) {
      const before = game.hp[p.id];
      game.hp[p.id] -= game.thorns[p.id];
      pushEffectEvent(game, {
        type: 'instant_damage',
        sourcePlayerId: p.id,
        targetPlayerId: p.id,
        amount: game.thorns[p.id],
        hpBefore: before,
        hpAfter: game.hp[p.id],
      });
      game.log.push(`${p.name}受到${game.thorns[p.id]}层荆棘伤害。`);
      game.thorns[p.id] = 0;
    }
  }
}

function checkGameOver(room, game) {
  const p1 = room.players[0];
  const p2 = room.players[1];
  if (game.hp[p1.id] <= 0 || game.hp[p2.id] <= 0) {
    room.status = 'ended';
    game.status = 'ended';
    game.phase = 'ended';
    if (game.hp[p1.id] <= 0 && game.hp[p2.id] <= 0) {
      game.winnerId = game.attackerId;
      game.log.push('双方同时归零，判定当前攻击方获胜。');
    } else if (game.hp[p1.id] <= 0) {
      game.winnerId = p2.id;
      game.log.push(`${p1.name}生命值归零，${p2.name}获胜！`);
    } else {
      game.winnerId = p1.id;
      game.log.push(`${p2.name}生命值归零，${p1.name}获胜！`);
    }
    return true;
  }
  return false;
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

  if (attacker.characterId === 'liuying') {
    if (countDistinctPairedValues(selectedDice) >= 2) {
      game.extraAttackQueued = true;
      game.log.push(`${attacker.name}触发【连击】！本轮将进行两次攻击。`);
    }
  }

  if (attacker.characterId === 'kafuka') {
    const defender = getPlayerById(room, game.defenderId);
    const uniq = countUniqueValues(selectedDice);
    if (uniq > 0) {
      game.poison[defender.id] += uniq;
      game.log.push(`${attacker.name}触发【中毒】，使${defender.name}陷入${uniq}层中毒（当前${game.poison[defender.id]}层）。`);
    }
  }

  if (attacker.characterId === 'shajin') {
    const odds = countOddValues(selectedDice);
    if (odds > 0) {
      game.resilience[attacker.id] += odds;
      game.log.push(`${attacker.name}获得${odds}层韧性（当前${game.resilience[attacker.id]}层）。`);
    }
    while (game.resilience[attacker.id] >= 7) {
      game.resilience[attacker.id] -= 7;
      const target = getPlayerById(room, game.defenderId);
      const before = game.hp[target.id];
      game.hp[target.id] -= 7;
      pushEffectEvent(game, {
        type: 'instant_damage',
        sourcePlayerId: attacker.id,
        targetPlayerId: target.id,
        amount: 7,
        hpBefore: before,
        hpAfter: game.hp[target.id],
      });
      game.log.push(`${attacker.name}韧性满7层，对${target.name}造成7点瞬伤！（剩余${game.resilience[attacker.id]}层）`);
    }
  }

  if (attacker.characterId === 'huohua') {
    if (hasDuplicates(selectedDice)) {
      game.hackActive[attacker.id] = true;
      game.log.push(`${attacker.name}触发【骇入】！`);
    }
  }
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

function calcHits(game) {
  let base = game.attackValue;
  if (!game.attackPierce) {
    base = Math.max(0, game.attackValue - game.defenseValue);
  }
  const hits = [base];
  if (game.extraAttackQueued) hits.push(base);
  return hits;
}

module.exports = {
  canUseAurora,
  triggerAuroraA,
  applyAuroraAEffectOnAttack,
  applyAuroraAEffectOnDefense,
  applyAscension,
  applyHackEffects,
  applyThornsDamage,
  checkGameOver,
  applyCharacterAttackSkill,
  applyXiadieDefendPassives,
  calcHits,
};
