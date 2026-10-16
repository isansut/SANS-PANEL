// Port of desktop_app/core/ninjasaga/eudemon.py
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../config.js';
import * as amfReq from './amfReq.js';
import * as recovery from './recovery.js';
import * as rateControl from './rateControl.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const NINJASAGA_ENEMY_DATA_FILE = path.join(HERE, '..', '..', 'data', 'ninjasaga-enemy-data.json');

export const EUD_START_FINISH_DELAY_SECONDS = 25;
export const EUD_CYCLE_COOLDOWN_SECONDS = 5;

export const EUD_ROOM_BOSS_NAMES = {
  1: 'Kamaitachi', 2: 'Hell Horse', 3: 'Kabutomushi Musha', 4: 'Kinkaku + Ginkaku', 5: 'Thunder Eagle',
  6: 'Mammoth King', 7: 'Oceans Queen', 8: 'Ghost Soldier', 9: 'Battle Angel', 10: 'Infernal Chimera',
};

let _ENEMY_META_CACHE = null;

const stopRequested = () => rateControl.stopRequested();
const waitWithStop = (seconds) => rateControl.waitWithStop(rateControl.jitteredWaitSeconds(seconds, 0), 0.2);
const isDebugEnabled = () => !!config.ninjasagaDebug;

function isSuccessResponse(response) {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const status = response.status;
    if (status !== null && status !== undefined) return String(status) === '1';
    const error = response.error;
    if (error !== null && error !== undefined) return ['0', 'None', ''].includes(String(error));
  }
  return false;
}

function safeInt(value, defaultValue = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? Number(defaultValue) : parsed;
}

function normalizeEnemyId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return text || null;
}

function loadEnemyMeta() {
  if (_ENEMY_META_CACHE && typeof _ENEMY_META_CACHE === 'object') return _ENEMY_META_CACHE;
  try {
    const payload = JSON.parse(fs.readFileSync(NINJASAGA_ENEMY_DATA_FILE, 'utf-8'));
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const normalized = {};
      for (const [enemyId, value] of Object.entries(payload)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) normalized[String(enemyId).trim().toLowerCase()] = value;
      }
      _ENEMY_META_CACHE = normalized;
      return normalized;
    }
  } catch { /* ignore */ }
  _ENEMY_META_CACHE = {};
  return _ENEMY_META_CACHE;
}

function extractEnemyIds(room) {
  const rawBoss = room.boss || room.enemyId || room.enemy_id || [];
  const ids = [];
  if (Array.isArray(rawBoss)) {
    for (const item of rawBoss) { const enemyId = normalizeEnemyId(item); if (enemyId) ids.push(enemyId); }
    return ids;
  }
  if (typeof rawBoss === 'string') {
    for (const part of rawBoss.split(',')) { const enemyId = normalizeEnemyId(part); if (enemyId) ids.push(enemyId); }
    return ids;
  }
  const enemyId = normalizeEnemyId(rawBoss);
  return enemyId ? [enemyId] : [];
}

function looksLikeRoom(node) {
  if (!node || typeof node !== 'object' || Array.isArray(node)) return false;
  if ('room' in node && Array.isArray(node.room)) return false;
  // A room always carries its enemy list. A status/result wrapper often has a generic
  // `status` key, so requiring `status` here would wrongly treat the wrapper as a room.
  return 'boss' in node || 'enemyId' in node || 'enemy_id' in node;
}

function collectRoomCandidates(node, out) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    if (Array.isArray(node.room)) { for (const item of node.room) { if (item && typeof item === 'object') out.push(item); } return; }
    if (looksLikeRoom(node)) out.push(node);
    for (const value of Object.values(node)) collectRoomCandidates(value, out);
    return;
  }
  if (Array.isArray(node)) { for (const item of node) collectRoomCandidates(item, out); }
}

function extractRooms(payload) {
  const candidates = [];
  collectRoomCandidates(payload, candidates);
  if (!candidates.length) return [];
  const deduped = [];
  const seen = new Set();
  for (const item of candidates) {
    const marker = JSON.stringify(item, Object.keys(item).sort());
    if (seen.has(marker)) continue;
    seen.add(marker);
    deduped.push(item);
  }
  return deduped;
}

function extractCharLevel() {
  const charData = config.charData;
  if (charData && typeof charData === 'object' && !Array.isArray(charData)) {
    for (const key of ['character_level', 'level']) if (charData[key] !== null && charData[key] !== undefined) return safeInt(charData[key], 1);
    for (const containerKey of ['character_data', 'data', 'character', 'result']) {
      const nested = charData[containerKey];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        for (const key of ['character_level', 'level']) if (nested[key] !== null && nested[key] !== undefined) return safeInt(nested[key], 1);
      }
    }
  }
  return 1;
}

function extractCharId() {
  const charData = config.charData;
  if (charData && typeof charData === 'object' && !Array.isArray(charData)) {
    for (const key of ['character_id', 'char_id', 'id']) if (charData[key] !== null && charData[key] !== undefined) return charData[key];
    for (const containerKey of ['character_data', 'data', 'character']) {
      const nested = charData[containerKey];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
        for (const key of ['character_id', 'char_id', 'id']) if (nested[key] !== null && nested[key] !== undefined) return nested[key];
      }
    }
  }
  return null;
}

function accountTypeName() {
  const loginData = config.loginData;
  if (!loginData || typeof loginData !== 'object') return 'Unknown';
  if (Number.parseInt(loginData.account_type, 10) === 2) return 'Premium';
  return 'Free User';
}

function roomSummary(room, roomIndex, enemyMeta) {
  const enemyIds = extractEnemyIds(room);
  const enemyLabels = [];
  const minReqValues = [];
  const roomLevel = room.minLevel ?? room.min_level;
  if (typeof roomLevel === 'number') minReqValues.push(roomLevel);
  for (const enemyId of enemyIds) {
    const meta = enemyMeta[enemyId];
    if (meta && typeof meta === 'object') {
      const enemyName = String(meta.name || enemyId).trim() || enemyId;
      const minLevel = meta.min_level;
      if (typeof minLevel === 'number') { minReqValues.push(minLevel); enemyLabels.push(`${enemyName}(${enemyId}, minLv=${minLevel})`); }
      else enemyLabels.push(`${enemyName}(${enemyId})`);
    } else enemyLabels.push(enemyId);
  }
  const roomMinReq = minReqValues.length ? Math.max(...minReqValues) : null;
  const bossName = EUD_ROOM_BOSS_NAMES[roomIndex + 1] || '';
  let prefix = `[Room ${roomIndex + 1}]`;
  if (bossName) prefix += ` boss=${bossName}`;
  prefix += ` tries=${room.time} rank=${room.rank} status=${room.status}`;
  if (roomMinReq !== null) prefix += ` minLvReq=${roomMinReq}`;
  if (room.xp !== undefined || room.gold !== undefined) prefix += ` xp=${room.xp} gold=${room.gold}`;
  return [prefix, enemyLabels, roomMinReq];
}

function printStatusOverview(rooms, enemyMeta) {
  rooms.forEach((room, idx) => {
    const [prefix, enemyLabels] = roomSummary(room, idx, enemyMeta);
    const rewards = room.rewards;
    console.log(prefix);
    if (enemyLabels.length) console.log(`  Enemies: ${enemyLabels.join(', ')}`);
    if (rewards) console.log(`  Rewards: ${JSON.stringify(rewards)}`);
  });
}

function extractXpGold(finishResult, selectedRoom) {
  let xpGain = null;
  let goldGain = null;
  if (finishResult && typeof finishResult === 'object' && !Array.isArray(finishResult)) {
    const resultPayload = finishResult.result;
    if (Array.isArray(resultPayload)) {
      if (resultPayload.length > 0) xpGain = resultPayload[0];
      if (resultPayload.length > 1) goldGain = resultPayload[1];
    } else if (resultPayload && typeof resultPayload === 'object') {
      xpGain = resultPayload.xp || resultPayload.character_xp;
      goldGain = resultPayload.gold || resultPayload.character_gold;
    }
    // Some responses return rewards as an array of tokens: ["wpn1142","item905","xp_25000","gold_38000"].
    if (Array.isArray(finishResult.reward)) {
      for (const token of finishResult.reward) {
        const text = String(token);
        const xpMatch = /^xp_?(\d+)$/i.exec(text);
        if (xpMatch) xpGain = Number.parseInt(xpMatch[1], 10);
        const goldMatch = /^gold_?(\d+)$/i.exec(text);
        if (goldMatch) goldGain = Number.parseInt(goldMatch[1], 10);
      }
    }
    if (xpGain === null || xpGain === undefined) xpGain = finishResult.xp || finishResult.character_xp;
    if (goldGain === null || goldGain === undefined) goldGain = finishResult.gold || finishResult.character_gold;
  }
  if (xpGain === null || xpGain === undefined) xpGain = selectedRoom.xp;
  if (goldGain === null || goldGain === undefined) goldGain = selectedRoom.gold;
  return [xpGain, goldGain];
}

export async function eudemonGarden() {
  if (stopRequested()) { console.log('Eudemon Garden stopped by user request'); return; }

  console.log('Loading NinjaSaga Eudemon Garden hunting status...');
  const state = config.ninjasagaState && typeof config.ninjasagaState === 'object' ? config.ninjasagaState : {};
  const antiProfile = config.getNinjasagaAntiDetectionProfile(state);
  const cloudflareRestSeconds = Number.parseInt(antiProfile.cloudflare_rest_seconds || 60, 10);

  let payload;
  try {
    payload = await amfReq.getHuntingStatus();
  } catch (exc) {
    if (await recovery.handleRuntimeException(exc, extractCharId(), 'getHuntingStatus', cloudflareRestSeconds)) {
      try { payload = await amfReq.getHuntingStatus(); }
      catch (exc2) { console.log(`Eudemon Garden stopped: getHuntingStatus retry failed: ${exc2.message || exc2}`); return; }
    } else return;
  }
  if (isDebugEnabled()) {
    let raw;
    try { raw = JSON.stringify(payload); } catch { raw = String(payload); }
    if (raw.length > 2200) raw = `${raw.slice(0, 2200)}...(truncated ${raw.length - 2200} chars)`;
    console.log(`[Eudemon debug] getHuntingStatus raw: ${raw}`);
  }

  let rooms = extractRooms(payload);
  if (!rooms.length) { console.log(`Eudemon Garden status response has no room data: ${JSON.stringify(payload)}`); return; }

  const enemyMeta = loadEnemyMeta();
  console.log(`Eudemon Garden automation started | account=${accountTypeName()} | rooms=${rooms.length} | delay=${EUD_START_FINISH_DELAY_SECONDS}s`);
  printStatusOverview(rooms, enemyMeta);

  let cycle = 0;
  while (true) {
    if (stopRequested()) { console.log('Eudemon Garden stopped by user request'); return; }
    cycle += 1;
    try {
      payload = await amfReq.getHuntingStatus();
    } catch (exc) {
      if (await recovery.handleRuntimeException(exc, extractCharId(), 'getHuntingStatus', cloudflareRestSeconds)) continue;
      return;
    }
    rooms = extractRooms(payload);
    if (!rooms.length) { console.log('Eudemon Garden automation stopped: room data is empty.'); return; }

    const charLevel = extractCharLevel();
    const candidates = [];
    let roomsWithTries = 0;
    let levelBlocked = 0;
    rooms.forEach((room, idx) => {
      const tries = safeInt(room.time, 0);
      if (tries <= 0) return;
      roomsWithTries += 1;
      const enemyIds = extractEnemyIds(room);
      if (!enemyIds.length) return;
      const [, , minReq] = roomSummary(room, idx, enemyMeta);
      const requiredLevel = typeof minReq === 'number' ? minReq : 0;
      if (charLevel < requiredLevel) { levelBlocked += 1; return; }
      candidates.push([requiredLevel, idx, room]);
    });

    if (!candidates.length) {
      const reason = roomsWithTries === 0
        ? 'all room tries are used up for today (wait for refresh)'
        : `character level ${charLevel} is below the required level of the ${levelBlocked} available room(s)`;
      console.log(`[Cycle ${cycle}] No eligible Eudemon room: ${reason}.`);
      return;
    }

    candidates.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
    const [, selectedIdx, selectedRoom] = candidates[0];
    const enemyIds = extractEnemyIds(selectedRoom);
    const [prefix, enemyLabels] = roomSummary(selectedRoom, selectedIdx, enemyMeta);
    console.log(`[Cycle ${cycle}] selected -> ${prefix}`);
    if (enemyLabels.length) console.log(`[Cycle ${cycle}] enemies -> ${enemyLabels.join(', ')}`);

    console.log(`[Cycle ${cycle}] startHunting room=${selectedIdx}`);
    let startResult;
    try {
      startResult = await amfReq.startHunting(selectedIdx, enemyIds);
    } catch (exc) {
      if (await recovery.handleRuntimeException(exc, extractCharId(), 'startHunting', cloudflareRestSeconds)) continue;
      return;
    }
    if (!isSuccessResponse(startResult)) { console.log(`[Cycle ${cycle}] startHunting failed: ${JSON.stringify(startResult)}`); return; }

    console.log(`[Cycle ${cycle}] waiting ~${EUD_START_FINISH_DELAY_SECONDS}s (+ random margin) before finishHunting...`);
    if (!(await waitWithStop(EUD_START_FINISH_DELAY_SECONDS))) { console.log('Eudemon Garden stopped by user request'); return; }

    console.log(`[Cycle ${cycle}] finishHunting room=${selectedIdx}`);
    let finishResult;
    try {
      finishResult = await amfReq.finishHunting(selectedIdx, [], 0, '1', null, enemyIds);
    } catch (exc) {
      if (await recovery.handleRuntimeException(exc, extractCharId(), 'finishHunting', cloudflareRestSeconds)) continue;
      return;
    }
    if (!isSuccessResponse(finishResult)) { console.log(`[Cycle ${cycle}] finishHunting failed: ${JSON.stringify(finishResult)}`); return; }

    const [xpGain, goldGain] = extractXpGold(finishResult, selectedRoom);
    console.log(`[Cycle ${cycle}] ok -> finishHunting success | XP ${xpGain} | Gold ${goldGain}`);

    const charId = extractCharId();
    if (charId !== null && charId !== undefined) {
      try {
        const refreshed = await amfReq.getCharacterData(charId, false, false);
        if (refreshed && typeof refreshed === 'object' && !Array.isArray(refreshed)) config.charData = refreshed;
      } catch (exc) {
        await recovery.handleRuntimeException(exc, charId, 'refresh character data', cloudflareRestSeconds);
      }
    }

    console.log(`[Cycle ${cycle}] cooldown ~${EUD_CYCLE_COOLDOWN_SECONDS}s (+ random margin) before next hunt...`);
    if (!(await waitWithStop(EUD_CYCLE_COOLDOWN_SECONDS))) { console.log('Eudemon Garden stopped by user request'); return; }
  }
}
