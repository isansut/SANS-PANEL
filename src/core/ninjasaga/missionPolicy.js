// Port of desktop_app/core/ninjasaga/mission_policy.py
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import config from '../config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

export const NINJASAGA_DEFAULT_MISSION_ID = 'msn2';

export const GRADE_C_MISSION_ARR = [
  'msn2', 'msn3', 'msn4', 'msn7', 'msn8', 'msn9', 'msn10', 'msn12', 'msn13',
  'msn14', 'msn15', 'msn16', 'msn17', 'msn18', 'msn19', 'msn28', 'msn29',
  'msn30', 'msn31', 'msn32', 'msn33', 'msn34', 'msn39', 'msn40', 'msn41',
  'msn42', 'msn43', 'msn44', 'msn45', 'msn47', 'msn48', 'msn49', 'msn53',
];
export const GRADE_B_MISSION_ARR = [
  'msn60', 'msn61', 'msn62', 'msn63', 'msn65', 'msn67', 'msn68', 'msn69',
  'msn72', 'msn73', 'msn74', 'msn75', 'msn76', 'msn77', 'msn78', 'msn79',
  'msn80', 'msn81', 'msn82', 'msn83',
];
export const GRADE_A_MISSION_ARR = [
  'msn138', 'msn139', 'msn140', 'msn141', 'msn142', 'msn143', 'msn144',
  'msn148', 'msn147', 'msn214', 'msn215', 'msn216', 'msn217', 'msn218',
  'msn219', 'msn220', 'msn221', 'msn222', 'msn223',
];
export const EXAM_CHUNIN_ARR = ['msn55', 'msn56', 'msn57', 'msn58', 'msn59'];
export const EXAM_JOUNIN_ARR = ['msn132', 'msn133', 'msn134', 'msn135', 'msn136'];

export const NINJASAGA_MISSION_DATA_FILE = path.join(HERE, '..', '..', 'data', 'ninjasaga-mission-data.json');
export const NINJASAGA_MISSION_DATA_AS_FILE = path.join(HERE, '..', '..', 'NinjaSaga Game Client', 'Panel', 'missiondata.as');

let _MISSION_METADATA_CACHE = null;

export function normalizeMissionId(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim().toLowerCase();
  return text || null;
}

export function accountTypeFromLogin() {
  const loginData = config.loginData;
  if (!loginData || typeof loginData !== 'object') return null;
  const raw = loginData.account_type;
  const parsed = Number.parseInt(raw, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function loadNinjasagaMissionMetadata() {
  if (_MISSION_METADATA_CACHE && typeof _MISSION_METADATA_CACHE === 'object') return _MISSION_METADATA_CACHE;
  try {
    const payload = JSON.parse(fs.readFileSync(NINJASAGA_MISSION_DATA_FILE, 'utf-8'));
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      const normalized = {};
      for (const [mid, value] of Object.entries(payload)) {
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          normalized[String(mid).trim().toLowerCase()] = value;
        }
      }
      mergeAsMissionRewards(normalized);
      _MISSION_METADATA_CACHE = normalized;
      return normalized;
    }
  } catch {
    // fall through to empty cache
  }
  _MISSION_METADATA_CACHE = {};
  return _MISSION_METADATA_CACHE;
}

function mergeAsMissionRewards(metadata) {
  let source;
  try {
    source = fs.readFileSync(NINJASAGA_MISSION_DATA_AS_FILE, 'utf-8');
  } catch {
    return;
  }
  const entryPattern = /MISSION_DATA\["([^"]+)"\]\s*=\s*\{([\s\S]*?)\};/g;
  let match;
  while ((match = entryPattern.exec(source)) !== null) {
    const missionId = normalizeMissionId(match[1]);
    if (!missionId) continue;
    const body = match[2] || '';
    const target = metadata[missionId] || (metadata[missionId] = { id: missionId });
    const tpMatch = body.match(/"tp"\s*:\s*(\d+)/);
    const spMatch = body.match(/"sp"\s*:\s*(\d+)/);
    if (tpMatch) target.tp = Number.parseInt(tpMatch[1], 10);
    if (spMatch) target.sp = Number.parseInt(spMatch[1], 10);
  }
}

export function missionDisplayLabel(missionId, accountType = null) {
  const missionKey = normalizeMissionId(missionId);
  if (!missionKey) return String(missionId);
  const metadata = loadNinjasagaMissionMetadata()[missionKey];
  if (!metadata || typeof metadata !== 'object') return missionKey;

  const missionName = String(metadata.name || '').trim();
  const missionLevel = metadata.level;
  const premiumOnly = !!metadata.premium;

  const tags = [];
  if (missionLevel !== null && missionLevel !== undefined) tags.push(`LvReq ${missionLevel}`);
  if (premiumOnly) {
    if (accountType !== null && accountType !== undefined && Number(accountType) < 2) tags.push('Premium-Only');
    else tags.push('Premium');
  }

  if (missionName && tags.length) return `${missionKey} (${missionName} | ${tags.join(', ')})`;
  if (missionName) return `${missionKey} (${missionName})`;
  if (tags.length) return `${missionKey} (${tags.join(', ')})`;
  return missionKey;
}

export function missionPoolForLevel(level) {
  if (level >= 1 && level <= 19) return GRADE_C_MISSION_ARR;
  if (level >= 20 && level <= 41) return GRADE_B_MISSION_ARR;
  if (level >= 42 && level <= 100) return GRADE_A_MISSION_ARR;
  return [];
}

export function missionNumericId(missionId) {
  const text = normalizeMissionId(missionId) || '';
  if (text.startsWith('msn') && /^\d+$/.test(text.slice(3))) return Number.parseInt(text.slice(3), 10);
  const digits = text.replace(/\D/g, '');
  return digits ? Number.parseInt(digits, 10) : 0;
}

export function missionRequiredLevel(missionId) {
  const missionKey = normalizeMissionId(missionId);
  if (!missionKey) return null;
  const metadata = loadNinjasagaMissionMetadata()[missionKey];
  if (!metadata || typeof metadata !== 'object') return null;
  const value = metadata.level;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function missionRewardValue(missionId, rewardKey) {
  const missionKey = normalizeMissionId(missionId);
  if (!missionKey) return 0;
  const metadata = loadNinjasagaMissionMetadata()[missionKey];
  if (!metadata || typeof metadata !== 'object') return 0;
  const parsed = Number.parseInt(metadata[String(rewardKey).trim().toLowerCase()] || 0, 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function isMissionAccountEligible(missionId, accountType) {
  const missionKey = normalizeMissionId(missionId);
  if (!missionKey) return false;
  const metadata = loadNinjasagaMissionMetadata()[missionKey];
  if (!metadata || typeof metadata !== 'object') return true;
  if (!metadata.premium) return true;
  return accountType !== null && accountType !== undefined && Number(accountType) >= 2;
}

export function isMissionAutoEligible(missionId, accountType) {
  const missionKey = normalizeMissionId(missionId);
  if (!missionKey) return false;
  const metadata = loadNinjasagaMissionMetadata()[missionKey];
  if (!metadata || typeof metadata !== 'object') return true;

  const grade = String(metadata.grade || '').trim();
  if (!grade) return false;
  if (metadata.daily) return false;

  const xpValue = Number.parseInt(metadata.xp || 0, 10) || 0;
  const goldValue = Number.parseInt(metadata.gold || 0, 10) || 0;
  if (xpValue <= 0 && goldValue <= 0) return false;

  if (!isMissionAccountEligible(missionKey, accountType)) return false;
  return true;
}

export function pickAutoMission(level, accountType = null) {
  const resolvedLevel = Number.parseInt(level, 10);
  const pool = missionPoolForLevel(resolvedLevel);
  if (!pool.length) return NINJASAGA_DEFAULT_MISSION_ID;

  let eligiblePool = pool.filter((mid) => isMissionAutoEligible(mid, accountType));
  if (!eligiblePool.length) eligiblePool = pool.filter((mid) => isMissionAccountEligible(mid, accountType));
  if (!eligiblePool.length) eligiblePool = [...pool];

  const candidates = [];
  for (const missionId of eligiblePool) {
    let reqLevel = missionRequiredLevel(missionId);
    if (reqLevel === null) reqLevel = 0;
    if (reqLevel <= resolvedLevel) candidates.push([reqLevel, -missionNumericId(missionId), missionId]);
  }
  if (candidates.length) {
    candidates.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]) || (a[2] < b[2] ? 1 : -1));
    candidates.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
    return candidates[0][2];
  }
  eligiblePool.sort((a, b) => missionNumericId(a) - missionNumericId(b));
  return eligiblePool.length ? eligiblePool[0] : NINJASAGA_DEFAULT_MISSION_ID;
}

export function pickTrainingMission(level, rewardKey, rewardValue, accountType = null) {
  const missionIds = listTrainingMissions(rewardKey, rewardValue, accountType);
  const resolvedLevel = Number.parseInt(level, 10);
  const candidates = [];
  const fallback = [];
  for (const missionId of missionIds) {
    let reqLevel = missionRequiredLevel(missionId);
    if (reqLevel === null) reqLevel = 0;
    const row = [reqLevel, -missionNumericId(missionId), missionId];
    fallback.push(row);
    if (reqLevel <= resolvedLevel) candidates.push(row);
  }
  if (candidates.length) {
    candidates.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
    return candidates[0][2];
  }
  if (fallback.length) {
    fallback.sort((a, b) => (b[0] - a[0]) || (b[1] - a[1]));
    return fallback[0][2];
  }
  return null;
}

export function listTrainingMissions(rewardKey, rewardValue, accountType = null) {
  const rewardName = String(rewardKey).trim().toLowerCase();
  const desiredValue = Number.parseInt(rewardValue, 10);
  const matches = [];
  for (const [missionId, metadata] of Object.entries(loadNinjasagaMissionMetadata())) {
    if (!metadata || typeof metadata !== 'object') continue;
    if (missionRewardValue(missionId, rewardName) !== desiredValue) continue;
    if (!isMissionAccountEligible(missionId, accountType)) continue;
    matches.push(missionId);
  }
  matches.sort((a, b) => missionNumericId(a) - missionNumericId(b));
  return matches;
}
