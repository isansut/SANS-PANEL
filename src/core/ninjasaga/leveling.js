// Port of desktop_app/core/ninjasaga/leveling.py
import config from '../config.js';
import * as amfReq from './amfReq.js';
import * as missionPolicy from './missionPolicy.js';
import * as progressParser from './progressParser.js';
import * as rateControl from './rateControl.js';
import * as recovery from './recovery.js';
import * as antiDetection from './antiDetection.js';

export const NINJASAGA_DEFAULT_MISSION_ID = 'msn2';
export const NINJASAGA_DEFAULT_XP_GAIN = 0;
export const NINJASAGA_DEFAULT_GOLD_GAIN = 0;
export const NINJASAGA_STOP_POLL_SECONDS = 0.2;

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
export const EXAM_SPECIAL_JOUNIN_ARR = [
  'msn200', 'msn205', 'msn202', 'msn206', 'msn203', 'msn207', 'msn204',
  'msn208', 'msn201', 'msn209', 'msn210', 'msn211', 'msn212',
];
export const EXAM_SPECIAL_JOUNIN_ARR_EASY = [
  'msn226', 'msn227', 'msn228', 'msn229', 'msn230', 'msn231', 'msn232',
  'msn233', 'msn234', 'msn235', 'msn236', 'msn237', 'msn238',
];
export const EXAM_TUTOR_ARR = [
  'msn266', 'msn259', 'msn267', 'msn260', 'msn268', 'msn261', 'msn270',
  'msn262', 'msn269', 'msn263', 'msn264', 'msn265',
];
export const EXAM_TUTOR_ARR_EASY = [
  'msn250', 'msn252', 'msn249', 'msn253', 'msn248', 'msn254', 'msn247',
  'msn255', 'msn251', 'msn256', 'msn257', 'msn258',
];
export const TP_TRAINING_MISSIONS = ['msn170', 'msn171', 'msn172', 'msn173', 'msn174'];
export const EXAM_FIXED_ACTION_DELAY_SECONDS = 30;
export const SPECIAL_JOUNIN_CLASS_SKILL_ARR = ['skill2002', 'skill2004', 'skill2001', 'skill2003', 'skill2000'];

export const MAX_CONSECUTIVE_START_FAILURES = 12;

export const RANK_STUDENT = 0;
export const RANK_GENIN = 1;
export const RANK_CHUNIN = 2;
export const RANK_CHUNIN_TALENTED = 3;
export const RANK_JOUNIN = 4;
export const RANK_JOUNIN_TALENTED = 5;
export const RANK_SPECIAL_JOUNIN = 6;
export const RANK_SPECIAL_JOUNIN_TALENTED = 7;
export const RANK_TUTOR = 8;
export const RANK_TUTOR_SENIOR = 9;

export const GENIN_LEVEL_CAP = 20;
export const CHUNIN_LEVEL_CAP = 40;
export const JOUNIN_LEVEL_CAP = 60;
export const SPECIAL_JOUNIN_LEVEL_CAP = 80;
export const TUTOR_LEVEL_CAP = 100;

export const RANK_NAME_BY_ID = {
  [RANK_STUDENT]: 'Student',
  [RANK_GENIN]: 'Genin',
  [RANK_CHUNIN]: 'Chunin',
  [RANK_CHUNIN_TALENTED]: 'Chunin Talented',
  [RANK_JOUNIN]: 'Jounin',
  [RANK_JOUNIN_TALENTED]: 'Jounin Talented',
  [RANK_SPECIAL_JOUNIN]: 'Special Jounin',
  [RANK_SPECIAL_JOUNIN_TALENTED]: 'Special Jounin Talented',
  [RANK_TUTOR]: 'Tutor',
  [RANK_TUTOR_SENIOR]: 'Tutor Senior',
};

const sleep = rateControl.sleep;
const now = () => Date.now() / 1000;

function runtimeGameLabel() {
  return String(config.getCurrentBaseGame().label || 'NinjaSaga');
}

function stopRequested() {
  const stopEvent = config.stopEvent;
  return !!(stopEvent && stopEvent.isSet && stopEvent.isSet());
}

const extractCharId = (d) => progressParser.extractCharacterId(d);
const extractCharLevel = (d) => progressParser.extractCharacterLevel(d, 1);
const accountTypeFromLogin = () => missionPolicy.accountTypeFromLogin();
const missionDisplayLabel = (id, at) => missionPolicy.missionDisplayLabel(id, at);
const missionNumericId = (id) => missionPolicy.missionNumericId(id);
const missionRequiredLevel = (id) => missionPolicy.missionRequiredLevel(id);
const isMissionAccountEligible = (id, at) => missionPolicy.isMissionAccountEligible(id, at);
const pickAutoMission = (lvl, at) => missionPolicy.pickAutoMission(lvl, at);
const pickTrainingMission = (lvl, key, val, at) => missionPolicy.pickTrainingMission(lvl, key, val, at);
const missionRewardValue = (id, key) => missionPolicy.missionRewardValue(id, key);
const listTrainingMissions = (key, val, at) => missionPolicy.listTrainingMissions(key, val, at);
const normalizeMissionId = (v) => missionPolicy.normalizeMissionId(v);
const waitWithStop = (seconds) => rateControl.waitWithStop(seconds, NINJASAGA_STOP_POLL_SECONDS);
const jitteredWaitSeconds = (base, jitter) => rateControl.jitteredWaitSeconds(base, jitter);
const intOrDefault = (v, d) => rateControl.intOrDefault(v, d);
const buildAntiDetectionProfile = (state) => antiDetection.buildAntiDetectionProfile(state);
const nextCloudflareWait = (profile, idx) => antiDetection.nextCloudflareWait(profile, idx);
const waitMinCallInterval = (last, minDelay, jitter) => rateControl.waitMinCallInterval(last, minDelay, jitter, NINJASAGA_STOP_POLL_SECONDS);
const registerFailureAndMaybeCircuit = (ts, profile, cycle) => antiDetection.registerFailureAndMaybeCircuit(ts, profile, cycle);
const handleRuntimeException = (exc, charId, context, cf) => recovery.handleRuntimeException(exc, charId, context, cf);
const reloginAndReselectCharacter = (charId) => recovery.reloginAndReselectCharacter(charId);
const isGatewayBlockedError = (exc) => recovery.isGatewayBlockedError(exc);

async function resolveCurrentCharacter() {
  const snapshot = config.charData;
  let charId = extractCharId(snapshot);
  let charLevel = extractCharLevel(snapshot);
  if (charId !== null && charId !== undefined) return [charId, charLevel];

  const chars = await amfReq.getAllCharacters();
  let rows = [];
  if (chars && typeof chars === 'object' && !Array.isArray(chars)) {
    rows = chars.account_data || chars.characters || [];
  }
  if (!rows.length) throw new Error(`No ${runtimeGameLabel()} characters available for leveling`);

  const first = rows[0];
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    charId = extractCharId(first);
    charLevel = extractCharLevel(first);
  } else if (Array.isArray(first)) {
    charId = first.length ? first[0] : null;
    charLevel = first.length > 2 && /^\d+$/.test(String(first[2])) ? Number.parseInt(first[2], 10) : 1;
  } else {
    charId = first;
    charLevel = 1;
  }
  if (charId === null || charId === undefined) throw new Error(`Could not resolve ${runtimeGameLabel()} character ID for leveling`);
  return [charId, charLevel];
}

function extractCharRank(charData) {
  if (!charData || typeof charData !== 'object' || Array.isArray(charData)) return null;
  let value = null;
  for (const key of ['character_rank', 'rank', 'current_rank', 'rank_id']) {
    if (charData[key] !== null && charData[key] !== undefined) { value = charData[key]; break; }
  }
  if (value === null || value === undefined) {
    for (const containerKey of ['character_data', 'data', 'character', 'result']) {
      const nested = charData[containerKey];
      if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
      for (const key of ['character_rank', 'rank', 'current_rank', 'rank_id']) {
        if (nested[key] !== null && nested[key] !== undefined) { value = nested[key]; break; }
      }
      if (value !== null && value !== undefined) break;
    }
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function resolveCharRankWithRefresh(charId, fallbackData) {
  const rankValue = extractCharRank(fallbackData);
  if (rankValue !== null && rankValue !== undefined) return rankValue;
  try {
    const refreshed = await amfReq.getCharacterData(charId, false, false);
    if (refreshed && typeof refreshed === 'object' && !Array.isArray(refreshed)) {
      config.charData = refreshed;
      return extractCharRank(refreshed);
    }
  } catch { /* ignore */ }
  return null;
}

async function refreshCharacterSnapshot(charId) {
  try {
    const refreshed = await amfReq.getCharacterData(charId, false, false);
    if (refreshed && typeof refreshed === 'object' && !Array.isArray(refreshed)) {
      config.charData = refreshed;
      return refreshed;
    }
  } catch { /* ignore */ }
  return null;
}

function extractCharControl(charData) {
  if (!charData || typeof charData !== 'object' || Array.isArray(charData)) return null;
  let value = null;
  for (const key of ['character_control', 'control', 'class_control', 'class_id']) {
    if (charData[key] !== null && charData[key] !== undefined) { value = charData[key]; break; }
  }
  if (value === null || value === undefined) {
    for (const containerKey of ['character_data', 'data', 'character', 'result']) {
      const nested = charData[containerKey];
      if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
      for (const key of ['character_control', 'control', 'class_control', 'class_id']) {
        if (nested[key] !== null && nested[key] !== undefined) { value = nested[key]; break; }
      }
      if (value !== null && value !== undefined) break;
    }
  }
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

async function resolveCharControlWithRefresh(charId, fallbackData) {
  const controlValue = extractCharControl(fallbackData);
  if (controlValue !== null && controlValue !== undefined) return controlValue;
  try {
    const refreshed = await amfReq.getCharacterData(charId, false, false);
    if (refreshed && typeof refreshed === 'object' && !Array.isArray(refreshed)) {
      config.charData = refreshed;
      return extractCharControl(refreshed);
    }
  } catch { /* ignore */ }
  return null;
}

function extractTrainingReward(updateResult, rewardKey) {
  const rewardName = String(rewardKey || '').trim().toLowerCase();
  const directKeyMap = { tp: ['tp_reward'], ss: ['ss_reward'] };
  for (const key of directKeyMap[rewardName] || []) {
    const value = Number.parseInt(updateResult?.[key] || 0, 10) || 0;
    if (value > 0) return value;
  }
  const result = updateResult?.result;
  if (Array.isArray(result) && result.length >= 3) {
    const drops = result[2];
    if (Array.isArray(drops)) {
      const prefix = rewardName === 'ss' ? 'ss_' : `${rewardName}_`;
      for (const item of drops) {
        const text = String(item || '').trim().toLowerCase();
        if (!text.startsWith(prefix)) continue;
        const parsed = Number.parseInt(text.slice(prefix.length), 10);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
  }
  return 0;
}

function rankName(rankValue) {
  if (rankValue === null || rankValue === undefined) return 'Unknown';
  return RANK_NAME_BY_ID[rankValue] ?? `Rank ${rankValue}`;
}

function examMode() { return 'hard'; }

function specialJouninClassChoice() {
  const state = config.ninjasagaState;
  let classIndex = 3;
  if (state && typeof state === 'object') {
    classIndex = Number.parseInt(state.special_jounin_class_index || 3, 10);
    if (Number.isNaN(classIndex)) classIndex = 3;
  }
  classIndex = Math.max(1, Math.min(5, classIndex));
  return [classIndex, SPECIAL_JOUNIN_CLASS_SKILL_ARR[classIndex - 1]];
}

function levelCapGateReason(level, rankValue) {
  if (rankValue === null || rankValue === undefined) return null;
  if (level >= GENIN_LEVEL_CAP && rankValue < RANK_CHUNIN) {
    return `Level ${level} is capped at Genin (${GENIN_LEVEL_CAP}). Current rank is ${rankName(rankValue)}. You must complete Chunin exam first to continue.`;
  }
  if (level >= CHUNIN_LEVEL_CAP && rankValue < RANK_JOUNIN) {
    return `Level ${level} is capped at Chunin/Tensai Chunin (${CHUNIN_LEVEL_CAP}). Current rank is ${rankName(rankValue)}. You must complete Jounin exam first to continue.`;
  }
  if (level >= JOUNIN_LEVEL_CAP && rankValue < RANK_SPECIAL_JOUNIN) {
    return `Level ${level} is capped at Jounin/Tensai Jounin (${JOUNIN_LEVEL_CAP}). Current rank is ${rankName(rankValue)}. You must complete Special Jounin exam first to continue.`;
  }
  if (level >= SPECIAL_JOUNIN_LEVEL_CAP && rankValue < RANK_TUTOR) {
    return `Level ${level} is capped at Special Jounin (${SPECIAL_JOUNIN_LEVEL_CAP}). Current rank is ${rankName(rankValue)}. You must complete Tutor exam first to continue.`;
  }
  return null;
}

function looksLikeInvalidMissionError(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  const text = String(response.error || response.message || response.result || '').toLowerCase();
  return text.includes('invalid mission');
}

function errorCode(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  for (const key of ['error', 'code', 'errno']) {
    const value = response[key];
    if (value !== null && value !== undefined) return value;
  }
  return null;
}

function isSessionInvalidError(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  const text = String(response.error || response.error_message || response.message || response.result || '').toLowerCase();
  const markers = ['not logged in', 'not login', 'session expired', 'session invalid', 'invalid session', 'please login', 'login required'];
  return markers.some((marker) => text.includes(marker));
}

function isLevelTooLowError(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  const status = String(response.status || '');
  if (status === '102') return true;
  const message = String(response.error || response.message || response.result || '').toLowerCase();
  return message.includes('too low') && message.includes('level');
}

function describeStartFailure(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return 'server returned an unrecognized (non-dict) response';
  const text = String(response.error_message || response.message || response.result || response.error || '').trim();
  const code = String(errorCode(response) || '').trim();
  if (isSessionInvalidError(response)) return 'account session is invalid/expired on the server side (relogin needed)';
  if (isLevelTooLowError(response)) return 'character level is too low for this mission';
  if (code === '100') return 'mission is currently locked';
  if (code === '104' || code === '109') return 'mission already used/locked for today';
  if (code === '102') return 'character level is too low for this mission';
  if (text) return `server said: ${text}`;
  return 'server rejected the mission start without a message';
}

function cooldownSeconds(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return 0;
  const text = String(response.error_message || response.message || response.error || '').toLowerCase();
  const statusText = String(response.status || '').trim().toLowerCase();
  const errorText = String(response.error || response.code || response.errno || '').trim().toLowerCase();
  if (['rate_limited'].includes(statusText) || errorText === 'rate_limited' || text.includes('rate limited') || text.includes('rate_limited')) {
    return 8;
  }
  if (['server busy', 'system busy', 'please wait', 'maintenance', 'try again'].some((m) => text.includes(m))) {
    return 8;
  }
  let m = text.match(/(\d+)\s*minute/);
  if (m) return Math.max(1, Number.parseInt(m[1], 10)) * 60;
  m = text.match(/(\d+)\s*second/);
  if (m) return Math.max(1, Number.parseInt(m[1], 10));
  return 0;
}

function isTpDailyMissionConsumed(response) {
  const code = String(errorCode(response) || '').trim();
  return code === '104' || code === '109' || cooldownSeconds(response) > 0;
}

function isTpDailyMissionUpdateConsumed(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  const code = String(response.error || response.status || '').trim();
  const text = String(response.error_message || response.message || response.result || response.error || '').toLowerCase();
  return code === '104' || text.includes('already completed today') || text.includes('already complete today');
}

function isExamAlreadyCompletedError(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return false;
  const code = String(response.error || response.status || '').trim();
  const text = String(response.error_message || response.message || response.result || response.error || '').toLowerCase();
  return code === '104' || text.includes('already complete') || text.includes('already completed');
}

function isSuccessResponse(response) {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const status = response.status;
    if (status !== null && status !== undefined) return ['1', 'true', 'True'].includes(String(status));
    for (const key of ['code', 'errno']) {
      const value = response[key];
      if (value !== null && value !== undefined) return ['0', '200'].includes(String(value));
    }
    const err = response.error;
    if (err !== null && err !== undefined) return ['0', 'None', ''].includes(String(err));
    return 'result' in response && !looksLikeInvalidMissionError(response);
  }
  if (Array.isArray(response) && response.length) return ['1', 'true', 'True'].includes(String(response[0]));
  return false;
}

function isTruthyCompletion(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Math.trunc(value) === 1;
  return ['1', 'true', 'success', 'completed', 'clear', 'done', 'passed'].includes(String(value).trim().toLowerCase());
}

function collectCompletedExamMissions(node, completed, examIds) {
  if (node && typeof node === 'object' && !Array.isArray(node)) {
    for (const [key, value] of Object.entries(node)) {
      const keyId = normalizeMissionId(key);
      if (examIds.has(keyId) && isTruthyCompletion(value)) completed.add(keyId);
    }
    let missionId = null;
    for (const idKey of ['mission_id', 'id', 'msn', 'mission']) {
      const candidate = normalizeMissionId(node[idKey]);
      if (examIds.has(candidate)) { missionId = candidate; break; }
    }
    if (missionId !== null) {
      for (const successKey of ['success', 'completed', 'clear', 'done', 'passed', 'status', 'result']) {
        if (successKey in node && isTruthyCompletion(node[successKey])) { completed.add(missionId); break; }
      }
    }
    for (const value of Object.values(node)) collectCompletedExamMissions(value, completed, examIds);
    return;
  }
  if (Array.isArray(node)) {
    for (const item of node) collectCompletedExamMissions(item, completed, examIds);
    return;
  }
  const candidate = normalizeMissionId(node);
  if (examIds.has(candidate)) completed.add(candidate);
}

async function resolveExamStartIndex(charId, examMissions) {
  const examIds = new Set(examMissions.map((mid) => normalizeMissionId(mid)).filter((v) => v !== null));
  const completed = new Set();
  const sources = [];
  try {
    const refreshed = await amfReq.getCharacterData(charId, false, true);
    if (refreshed && typeof refreshed === 'object' && !Array.isArray(refreshed)) {
      config.charData = refreshed;
      sources.push(refreshed, refreshed.extra_data, refreshed.system_data);
    }
  } catch { /* ignore */ }
  sources.push(config.charData);
  for (const source of sources) collectCompletedExamMissions(source, completed, examIds);
  for (let idx = 0; idx < examMissions.length; idx++) {
    if (!completed.has(normalizeMissionId(examMissions[idx]))) return idx;
  }
  return examMissions.length;
}

async function pushLiveProgressUpdate(level = null, xp = null, gold = null, tokens = null, rank = null) {
  const snapshot = config.charData;
  if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
    const targets = [
      snapshot,
      snapshot.character_data && typeof snapshot.character_data === 'object' && !Array.isArray(snapshot.character_data) ? snapshot.character_data : null,
      snapshot.result && typeof snapshot.result === 'object' && !Array.isArray(snapshot.result) ? snapshot.result : null,
      snapshot.data && typeof snapshot.data === 'object' && !Array.isArray(snapshot.data) ? snapshot.data : null,
      snapshot.character && typeof snapshot.character === 'object' && !Array.isArray(snapshot.character) ? snapshot.character : null,
    ];
    for (const target of targets) {
      if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
      if (level !== null && level !== undefined) { target.character_level = level; target.level = level; }
      if (xp !== null && xp !== undefined) { target.character_xp = xp; target.xp = xp; }
      if (gold !== null && gold !== undefined) { target.character_gold = gold; target.gold = gold; }
      if (rank !== null && rank !== undefined) { target.character_rank = rank; target.rank = rank; }
    }
  }
  const callback = config.characterUpdateCallback;
  if (typeof callback === 'function') callback({ level, xp, gold, tokens, rank });
}

async function applySpecialJouninClassSelection(charId, profile, lastAmfCallAt) {
  const [classIndex, classSkill] = specialJouninClassChoice();
  const currentControl = await resolveCharControlWithRefresh(charId, config.charData);
  if (currentControl !== null && currentControl > 0) {
    console.log(`[Exam] Special Jounin class already selected (class=${currentControl}). Current setting class=${classIndex} (${classSkill})`);
    return lastAmfCallAt;
  }
  console.log(`[Exam] Selecting Special Jounin class ${classIndex} (${classSkill})...`);
  const minCallDelaySeconds = Number.parseInt(profile.min_call_delay_seconds, 10);
  const actionJitterSeconds = Number.parseInt(profile.action_jitter_seconds, 10);
  const startRetryDelaySeconds = Number.parseInt(profile.start_retry_delay_seconds, 10);
  const startMaxRetries = Number.parseInt(profile.start_max_retries, 10);
  let cloudflareBackoffIndex = 0;
  let callAt = lastAmfCallAt;
  for (let attempt = 1; attempt <= startMaxRetries; attempt++) {
    let okToCall;
    [okToCall, callAt] = await waitMinCallInterval(callAt, minCallDelaySeconds, actionJitterSeconds);
    if (!okToCall) return callAt;
    let response;
    try {
      response = await amfReq.selectSpecialJouninClass(classIndex);
      callAt = now();
    } catch (exc) {
      const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
      cloudflareBackoffIndex = nextIdx;
      if (await handleRuntimeException(exc, charId, 'SJClassSelect', cfWait)) continue;
      return callAt;
    }
    if (isSuccessResponse(response)) {
      const refreshedControl = await resolveCharControlWithRefresh(charId, config.charData);
      console.log(`[Exam] Special Jounin class selected -> class=${classIndex} (${classSkill}) control=${refreshedControl}`);
      return callAt;
    }
    if (errorCode(response) === 100 && attempt < startMaxRetries) {
      const retryWait = jitteredWaitSeconds(startRetryDelaySeconds, actionJitterSeconds);
      console.log(`[Exam] SJClassSelect locked (error 100), retry ${attempt + 1}/${startMaxRetries} in ${retryWait.toFixed(1)}s...`);
      if (!(await waitWithStop(retryWait))) return callAt;
      continue;
    }
    console.log(`[Exam] SJClassSelect failed: ${JSON.stringify(response)}`);
    return callAt;
  }
  return callAt;
}

async function applyTutorRewardClaim(charId, profile, lastAmfCallAt) {
  console.log('[Exam] Claiming Tutor reward/class...');
  const minCallDelaySeconds = Number.parseInt(profile.min_call_delay_seconds, 10);
  const actionJitterSeconds = Number.parseInt(profile.action_jitter_seconds, 10);
  const startRetryDelaySeconds = Number.parseInt(profile.start_retry_delay_seconds, 10);
  const startMaxRetries = Number.parseInt(profile.start_max_retries, 10);
  let cloudflareBackoffIndex = 0;
  let callAt = lastAmfCallAt;
  for (let attempt = 1; attempt <= startMaxRetries; attempt++) {
    let okToCall;
    [okToCall, callAt] = await waitMinCallInterval(callAt, minCallDelaySeconds, actionJitterSeconds);
    if (!okToCall) return callAt;
    let response;
    try {
      response = await amfReq.selectTutorClass();
      callAt = now();
    } catch (exc) {
      const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
      cloudflareBackoffIndex = nextIdx;
      if (await handleRuntimeException(exc, charId, 'NTClassSelect', cfWait)) continue;
      return callAt;
    }
    if (isSuccessResponse(response)) {
      console.log('[Exam] Tutor reward claimed');
      return callAt;
    }
    if (errorCode(response) === 100 && attempt < startMaxRetries) {
      const retryWait = jitteredWaitSeconds(startRetryDelaySeconds, actionJitterSeconds);
      console.log(`[Exam] NTClassSelect locked (error 100), retry ${attempt + 1}/${startMaxRetries} in ${retryWait.toFixed(1)}s...`);
      if (!(await waitWithStop(retryWait))) return callAt;
      continue;
    }
    console.log(`[Exam] NTClassSelect failed: ${JSON.stringify(response)}`);
    return callAt;
  }
  return callAt;
}

async function runRankExam(examName, examMissions, targetRank, charId, charLevel, profile, lastAmfCallAt) {
  const accountType = accountTypeFromLogin();
  const startIndex = await resolveExamStartIndex(charId, examMissions);
  if (startIndex >= examMissions.length) {
    console.log(`[Exam] All ${examName} exam stages already completed, checking rank promotion...`);
  } else {
    console.log(`[Exam] Resuming ${examName} exam from stage ${startIndex + 1}/${examMissions.length} (${examMissions[startIndex]})`);
  }
  console.log(`[Exam] Starting ${examName} exam sequence (${examMissions.length} stages): ${examMissions.join(', ')}`);

  const cycleCooldownSeconds = Number.parseInt(profile.cycle_cooldown_seconds, 10);
  const actionJitterSeconds = Number.parseInt(profile.action_jitter_seconds, 10);
  const minCallDelaySeconds = Number.parseInt(profile.min_call_delay_seconds, 10);
  const startRetryDelaySeconds = Number.parseInt(profile.start_retry_delay_seconds, 10);
  const startMaxRetries = Number.parseInt(profile.start_max_retries, 10);
  let cloudflareBackoffIndex = 0;
  let callAt = lastAmfCallAt;

  if (examName.startsWith('Special Jounin') || examName.startsWith('Tutor')) {
    const isSJ = examName.startsWith('Special Jounin');
    console.log(isSJ ? '[Exam] Watching Special Jounin notice...' : '[Exam] Checking Tutor exam notice...');
    let okToCall;
    [okToCall, callAt] = await waitMinCallInterval(callAt, minCallDelaySeconds, actionJitterSeconds);
    if (!okToCall) return [false, callAt, null];
    let noticeResult;
    try {
      noticeResult = isSJ ? await amfReq.watchSpecialJouninNotice() : await amfReq.getTutorExamNotice();
      callAt = now();
    } catch (exc) {
      const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
      cloudflareBackoffIndex = nextIdx;
      await handleRuntimeException(exc, charId, isSJ ? 'watchSJENotice' : 'NTExamNotice', cfWait);
      return [false, callAt, null];
    }
    if (!isSuccessResponse(noticeResult)) {
      console.log(`[Exam] ${isSJ ? 'watchSJENotice' : 'NTExamNotice'} failed: ${JSON.stringify(noticeResult)}`);
      return [false, callAt, null];
    }
    console.log(isSJ ? '[Exam] Starting Special Jounin exam countdown...' : '[Exam] Starting Tutor exam countdown...');
    [okToCall, callAt] = await waitMinCallInterval(callAt, minCallDelaySeconds, actionJitterSeconds);
    if (!okToCall) return [false, callAt, null];
    let startExamResult;
    try {
      startExamResult = isSJ ? await amfReq.startSpecialJouninExam() : await amfReq.startTutorExam();
      callAt = now();
    } catch (exc) {
      const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
      cloudflareBackoffIndex = nextIdx;
      await handleRuntimeException(exc, charId, isSJ ? 'startSJExam' : 'startNTExam', cfWait);
      return [false, callAt, null];
    }
    if (!isSuccessResponse(startExamResult)) {
      console.log(`[Exam] ${isSJ ? 'startSJExam' : 'startNTExam'} failed: ${JSON.stringify(startExamResult)}`);
      return [false, callAt, null];
    }
    console.log(isSJ ? '[Exam] Special Jounin countdown started' : '[Exam] Tutor countdown started');
  }

  for (let index = startIndex + 1; index <= examMissions.length; index++) {
    const missionId = examMissions[index - 1];
    if (stopRequested()) return [false, callAt, null];
    const missionLabel = missionDisplayLabel(missionId, accountType);
    console.log(`[Exam ${index}/${examMissions.length}] start mission ${missionLabel}`);

    let startResult = null;
    let started = false;
    for (let attempt = 1; attempt <= startMaxRetries; attempt++) {
      let okToCall;
      [okToCall, callAt] = await waitMinCallInterval(callAt, minCallDelaySeconds, actionJitterSeconds);
      if (!okToCall) return [false, callAt, null];
      try {
        startResult = await amfReq.startMission(missionId);
        callAt = now();
      } catch (exc) {
        const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
        cloudflareBackoffIndex = nextIdx;
        if (await handleRuntimeException(exc, charId, `Exam startMission ${missionId}`, cfWait)) {
          startResult = { status: 0, error: 'recovered_retry' };
          continue;
        }
        return [false, callAt, null];
      }
      if (isSuccessResponse(startResult)) { started = true; break; }
      if (errorCode(startResult) === 100 && attempt < startMaxRetries) {
        const retryWait = jitteredWaitSeconds(startRetryDelaySeconds, actionJitterSeconds);
        console.log(`[Exam ${index}] startMission locked (error 100), retry ${attempt + 1}/${startMaxRetries} in ${retryWait.toFixed(1)}s...`);
        if (!(await waitWithStop(retryWait))) return [false, callAt, null];
        continue;
      }
      break;
    }

    if (!started && isExamAlreadyCompletedError(startResult)) {
      console.log(`[Exam ${index}] mission ${missionId} is already completed (error 104). Checking current rank and trying the next stage...`);
      const resumeWait = jitteredWaitSeconds(Math.max(Number(minCallDelaySeconds), 2.0), actionJitterSeconds);
      console.log(`[Exam ${index}] waiting ${resumeWait.toFixed(1)}s before checking the next stage...`);
      if (!(await waitWithStop(resumeWait))) return [false, callAt, null];
      const refreshedSnapshot = await refreshCharacterSnapshot(charId);
      const refreshedRank = extractCharRank(refreshedSnapshot || config.charData);
      if (refreshedRank !== null && refreshedRank >= targetRank) {
        console.log(`[Exam] ${examName} rank already promoted after resume check: ${rankName(refreshedRank)}(${refreshedRank})`);
        return [true, callAt, refreshedRank];
      }
      continue;
    }

    if (!started) {
      console.log(`[Exam ${index}] startMission failed: ${JSON.stringify(startResult)}`);
      return [false, callAt, null];
    }

    const actionWait = Number(EXAM_FIXED_ACTION_DELAY_SECONDS);
    console.log(`[Exam ${index}] waiting fixed ${EXAM_FIXED_ACTION_DELAY_SECONDS}s before updateCharacter...`);
    if (!(await waitWithStop(actionWait))) return [false, callAt, null];

    let okToCall;
    [okToCall, callAt] = await waitMinCallInterval(callAt, minCallDelaySeconds, actionJitterSeconds);
    if (!okToCall) return [false, callAt, null];
    let updateResult;
    try {
      updateResult = await amfReq.updateCharacterProgress(charId, charLevel, missionId, 0, 0);
      callAt = now();
    } catch (exc) {
      const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
      cloudflareBackoffIndex = nextIdx;
      if (await handleRuntimeException(exc, charId, `Exam updateCharacter ${missionId}`, cfWait)) {
        return [false, callAt, null];
      }
      return [false, callAt, null];
    }
    if (!isSuccessResponse(updateResult)) {
      console.log(`[Exam ${index}] updateCharacter failed: ${JSON.stringify(updateResult)}`);
      return [false, callAt, null];
    }
    console.log(`[Exam ${index}/${examMissions.length}] completed mission ${missionId}`);
    const cooldownWait = jitteredWaitSeconds(cycleCooldownSeconds, actionJitterSeconds);
    if (!(await waitWithStop(cooldownWait))) return [false, callAt, null];
  }

  const refreshWait = jitteredWaitSeconds(Math.max(Number(minCallDelaySeconds), 2.0), actionJitterSeconds);
  console.log(`[Exam] Waiting ${refreshWait.toFixed(1)}s and refreshing character data after exam...`);
  if (!(await waitWithStop(refreshWait))) return [false, callAt, null];
  let refreshedSnapshot = await refreshCharacterSnapshot(charId);
  let refreshedRank = extractCharRank(refreshedSnapshot || config.charData);
  if (examName.startsWith('Special Jounin') && (refreshedRank ?? -1) < targetRank) {
    callAt = await applySpecialJouninClassSelection(charId, profile, callAt);
    refreshedSnapshot = await refreshCharacterSnapshot(charId);
    refreshedRank = extractCharRank(refreshedSnapshot || config.charData);
    const refreshedControl = extractCharControl(refreshedSnapshot || config.charData);
    if ((refreshedRank ?? -1) < targetRank && (refreshedControl || 0) > 0) {
      console.log(`[Exam] ${examName} class selection completed with control=${refreshedControl}. `);
      refreshedRank = targetRank;
    }
  }
  if (examName.startsWith('Tutor') && (refreshedRank ?? -1) < targetRank) {
    callAt = await applyTutorRewardClaim(charId, profile, callAt);
    refreshedSnapshot = await refreshCharacterSnapshot(charId);
    refreshedRank = extractCharRank(refreshedSnapshot || config.charData);
  }
  const examPassed = refreshedRank !== null && refreshedRank !== undefined && refreshedRank >= targetRank;
  if (examPassed) console.log(`[Exam] ${examName} exam completed. New rank: ${rankName(refreshedRank)}(${refreshedRank})`);
  else console.log(`[Exam] ${examName} exam missions finished, but rank is not promoted yet.`);
  return [examPassed, callAt, refreshedRank];
}

export async function ninjasagaLeveling(loopTimes = null, trainingMode = null) {
  if (!config.loginData || typeof config.loginData !== 'object') {
    throw new Error('Login data is not loaded in memory');
  }

  const state = config.ninjasagaState || {};
  const profile = buildAntiDetectionProfile(state);
  const missionOverride = state.leveling_mission_id;
  const normalizedTrainingMode = String(trainingMode || '').trim().toLowerCase() || null;
  let missionId = String(missionOverride || NINJASAGA_DEFAULT_MISSION_ID);
  let autoMission = !missionOverride;
  if (normalizedTrainingMode) autoMission = true;
  const xpGain = Number.parseInt(state.leveling_xp_gain || NINJASAGA_DEFAULT_XP_GAIN, 10);
  const goldGain = Number.parseInt(state.leveling_gold_gain || NINJASAGA_DEFAULT_GOLD_GAIN, 10);
  const delaySeconds = profile.action_delay_seconds;
  const cycleCooldownSeconds = profile.cycle_cooldown_seconds;
  const restEveryCycles = profile.rest_every_cycles;
  const restDurationSeconds = profile.rest_duration_seconds;
  const actionJitterSeconds = profile.action_jitter_seconds;
  const minCallDelaySeconds = profile.min_call_delay_seconds;
  const startRetryDelaySeconds = profile.start_retry_delay_seconds;
  const startMaxRetries = profile.start_max_retries;

  console.log(
    'Anti-detection profile | ' +
      `call_min=${minCallDelaySeconds}s | action_delay=${delaySeconds}s | ` +
      `cycle_cooldown=${cycleCooldownSeconds}s | rest=${restEveryCycles}/${restDurationSeconds}s`
  );
  const accountType = accountTypeFromLogin();
  let lastAmfCallAt = null;
  const failureTimestamps = [];
  let cloudflareBackoffIndex = 0;
  let successStreak = 0;
  let consecutiveStartFailures = 0;
  const trainingModeCfg = {
    tp: { reward_key: 'tp', reward_value: 10, required_rank: RANK_JOUNIN, required_rank_name: 'Jounin', required_level: 40, daily: true, mission_ids: TP_TRAINING_MISSIONS },
    ss: { reward_key: 'sp', reward_value: 30, required_rank: RANK_TUTOR, required_rank_name: 'Tutor', required_level: 80, daily: false },
  }[normalizedTrainingMode || ''];
  let pendingTrainingMissions = null;

  let charId;
  let charLevel;
  try {
    [charId, charLevel] = await resolveCurrentCharacter();
  } catch (exc) {
    const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
    cloudflareBackoffIndex = nextIdx;
    if (!(await handleRuntimeException(exc, null, 'Resolve current character', cfWait))) return;
    if (isGatewayBlockedError(exc)) {
      if (!(await registerFailureAndMaybeCircuit(failureTimestamps, profile, 0))) return;
    }
    [charId, charLevel] = await resolveCurrentCharacter();
  }
  let charRank = await resolveCharRankWithRefresh(charId, config.charData);
  if (autoMission && charLevel >= GENIN_LEVEL_CAP && charRank === null) {
    console.log(`Cannot resolve character rank at level ${charLevel}. Please refresh/select character again before auto leveling.`);
    return;
  }
  const gameLabel = runtimeGameLabel();
  console.log(
    `Starting ${gameLabel} leveling | char_id=${charId} | level=${charLevel} | mission=${autoMission ? 'auto' : missionId}` +
      (normalizedTrainingMode ? ` | mode=${normalizedTrainingMode}` : '')
  );
  if (trainingModeCfg && charLevel < trainingModeCfg.required_level) {
    console.log(`${normalizedTrainingMode.toUpperCase()} Training requires level ${trainingModeCfg.required_level}+ . Current level: ${charLevel}.`);
    return;
  }
  if (trainingModeCfg && (charRank ?? -1) < trainingModeCfg.required_rank) {
    console.log(`${normalizedTrainingMode.toUpperCase()} Training requires rank ${trainingModeCfg.required_rank_name}. Current rank: ${rankName(charRank)}(${charRank}).`);
    return;
  }
  if (trainingModeCfg && trainingModeCfg.daily) {
    const configuredDailyMissions = [...(trainingModeCfg.mission_ids || [])];
    if (configuredDailyMissions.length) {
      pendingTrainingMissions = configuredDailyMissions.filter((mid) => (missionRequiredLevel(mid) || 0) <= charLevel);
    } else {
      pendingTrainingMissions = listTrainingMissions(String(trainingModeCfg.reward_key), trainingModeCfg.reward_value, accountType)
        .filter((mid) => (missionRequiredLevel(mid) || 0) <= charLevel);
    }
    if (!pendingTrainingMissions.length) {
      console.log(`No ${normalizedTrainingMode.toUpperCase()} daily missions available for level ${charLevel}.`);
      return;
    }
    console.log(`${normalizedTrainingMode.toUpperCase()} Training daily mission queue: ${pendingTrainingMissions.map((mid) => missionDisplayLabel(mid, accountType)).join(', ')}`);
  }

  let cycle = 0;
  let lastSuccessMissionId = missionId;
  let noProgressCycles = 0;
  let lastObservedProgress = [null, null];

  while (true) {
    if (stopRequested()) { console.log(`${gameLabel} leveling stopped by user request`); break; }
    if (loopTimes !== null && loopTimes !== undefined && cycle >= Number(loopTimes)) break;

    cycle += 1;
    if (autoMission) {
      const gateReason = trainingModeCfg ? null : levelCapGateReason(charLevel, charRank);
      if (gateReason) {
        if (charLevel >= GENIN_LEVEL_CAP && (charRank ?? -1) < RANK_CHUNIN) {
          console.log(`[Cycle ${cycle}] ${gateReason}`);
          console.log(`[Cycle ${cycle}] Trying to run Chunin exam automatically...`);
          const [examPassed, newCallAt, refreshedRank] = await runRankExam('Chunin', EXAM_CHUNIN_ARR, RANK_CHUNIN, charId, charLevel, profile, lastAmfCallAt);
          lastAmfCallAt = newCallAt;
          if (refreshedRank !== null) charRank = refreshedRank;
          if (examPassed) { console.log(`[Cycle ${cycle}] Chunin exam success, continuing leveling...`); continue; }
          console.log(`[Cycle ${cycle}] Chunin exam not completed yet. Leveling stopped.`);
          break;
        }
        if (charLevel >= CHUNIN_LEVEL_CAP && (charRank ?? -1) < RANK_JOUNIN) {
          console.log(`[Cycle ${cycle}] ${gateReason}`);
          console.log(`[Cycle ${cycle}] Trying to run Jounin exam automatically...`);
          const [examPassed, newCallAt, refreshedRank] = await runRankExam('Jounin', EXAM_JOUNIN_ARR, RANK_JOUNIN, charId, charLevel, profile, lastAmfCallAt);
          lastAmfCallAt = newCallAt;
          if (refreshedRank !== null) charRank = refreshedRank;
          if (examPassed) { console.log(`[Cycle ${cycle}] Jounin exam success, continuing leveling...`); continue; }
          console.log(`[Cycle ${cycle}] Jounin exam not completed yet. Leveling stopped.`);
          break;
        }
        if (charLevel >= JOUNIN_LEVEL_CAP && (charRank ?? -1) < RANK_SPECIAL_JOUNIN) {
          const mode = examMode();
          console.log(`[Cycle ${cycle}] ${gateReason}`);
          console.log(`[Cycle ${cycle}] Trying to run Special Jounin exam automatically (${mode})...`);
          let [examPassed, newCallAt, refreshedRank] = await runRankExam(`Special Jounin (${mode})`, [...EXAM_SPECIAL_JOUNIN_ARR], RANK_SPECIAL_JOUNIN, charId, charLevel, profile, lastAmfCallAt);
          lastAmfCallAt = newCallAt;
          if (refreshedRank !== null) charRank = refreshedRank;
          if (!examPassed && (charRank ?? -1) < RANK_SPECIAL_JOUNIN) {
            console.log(`[Cycle ${cycle}] Hard Special Jounin path did not finish promotion. Trying easy path resume...`);
            [examPassed, newCallAt, refreshedRank] = await runRankExam('Special Jounin (easy)', [...EXAM_SPECIAL_JOUNIN_ARR_EASY], RANK_SPECIAL_JOUNIN, charId, charLevel, profile, lastAmfCallAt);
            lastAmfCallAt = newCallAt;
            if (refreshedRank !== null) charRank = refreshedRank;
          }
          if (examPassed) {
            lastAmfCallAt = await applySpecialJouninClassSelection(charId, profile, lastAmfCallAt);
            console.log(`[Cycle ${cycle}] Special Jounin exam success, continuing leveling...`);
            continue;
          }
          console.log(`[Cycle ${cycle}] Special Jounin exam not completed yet. Leveling stopped.`);
          break;
        }
        if (charLevel >= SPECIAL_JOUNIN_LEVEL_CAP && (charRank ?? -1) < RANK_TUTOR) {
          const mode = examMode();
          console.log(`[Cycle ${cycle}] ${gateReason}`);
          console.log(`[Cycle ${cycle}] Trying to run Tutor exam automatically (${mode})...`);
          let [examPassed, newCallAt, refreshedRank] = await runRankExam(`Tutor (${mode})`, [...EXAM_TUTOR_ARR], RANK_TUTOR, charId, charLevel, profile, lastAmfCallAt);
          lastAmfCallAt = newCallAt;
          if (refreshedRank !== null) charRank = refreshedRank;
          if (!examPassed && (charRank ?? -1) < RANK_TUTOR) {
            console.log(`[Cycle ${cycle}] Hard Tutor path did not finish promotion. Trying easy path resume...`);
            [examPassed, newCallAt, refreshedRank] = await runRankExam('Tutor (easy)', [...EXAM_TUTOR_ARR_EASY], RANK_TUTOR, charId, charLevel, profile, lastAmfCallAt);
            lastAmfCallAt = newCallAt;
            if (refreshedRank !== null) charRank = refreshedRank;
          }
          if (examPassed) { console.log(`[Cycle ${cycle}] Tutor exam success, continuing leveling...`); continue; }
          console.log(`[Cycle ${cycle}] Tutor exam not completed yet. Leveling stopped.`);
          break;
        }
        console.log(`[Cycle ${cycle}] ${gateReason}`);
        break;
      }
      if (normalizedTrainingMode === 'tp') {
        if (pendingTrainingMissions !== null) {
          if (!pendingTrainingMissions.length) { console.log('[TP Training] All TP daily missions have been used for this run.'); break; }
          missionId = pendingTrainingMissions[0];
        } else {
          missionId = pickTrainingMission(charLevel, 'tp', 10, accountType);
        }
        if (!missionId) { console.log(`[Cycle ${cycle}] No TP training mission found for level ${charLevel}.`); break; }
      } else if (normalizedTrainingMode === 'ss') {
        missionId = pickTrainingMission(charLevel, 'sp', 30, accountType);
        if (!missionId) { console.log(`[Cycle ${cycle}] No SS training mission found for level ${charLevel}.`); break; }
      } else {
        missionId = pickAutoMission(charLevel, accountType);
      }
    }

    let startResult = null;
    let started = false;
    let levelGateFallback = false;
    const missionLabel = missionDisplayLabel(missionId, accountType);
    console.log(`[Cycle ${cycle}] ▶ ${gameLabel} | Lv ${charLevel} | start mission ${missionLabel}`);
    for (let attempt = 1; attempt <= startMaxRetries; attempt++) {
      let okToCall;
      [okToCall, lastAmfCallAt] = await waitMinCallInterval(lastAmfCallAt, minCallDelaySeconds, actionJitterSeconds);
      if (!okToCall) { console.log(`${gameLabel} leveling stopped by user request`); return; }
      try {
        startResult = await amfReq.startMission(missionId);
        lastAmfCallAt = now();
      } catch (exc) {
        const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
        cloudflareBackoffIndex = nextIdx;
        if (await handleRuntimeException(exc, charId, 'startMission', cfWait)) {
          successStreak = 0;
          if (!(await registerFailureAndMaybeCircuit(failureTimestamps, profile, cycle))) return;
          startResult = { status: 0, error: 'recovered_retry' };
          continue;
        }
        return;
      }
      if (looksLikeInvalidMissionError(startResult) && missionId !== 'msn2') {
        console.log(`[Cycle ${cycle}] mission ${missionId} invalid, retrying with msn2`);
        missionId = 'msn2';
        continue;
      }
      if (startResult && typeof startResult === 'object' && !Array.isArray(startResult) && String(startResult.status ?? '1') === '1') {
        started = true;
        break;
      }
      if (attempt < startMaxRetries) {
        const retryWait = jitteredWaitSeconds(startRetryDelaySeconds, actionJitterSeconds);
        console.log(`[Cycle ${cycle}] startMission not accepted (attempt ${attempt}/${startMaxRetries}, error=${JSON.stringify(errorCode(startResult))}), retrying in ${retryWait.toFixed(1)}s...`);
        if (!(await waitWithStop(retryWait))) { console.log(`${gameLabel} leveling stopped by user request`); return; }
        continue;
      }
      break;
    }

    if (!started && isLevelTooLowError(startResult)) {
      successStreak = 0;
      const fallbackId = lastSuccessMissionId || NINJASAGA_DEFAULT_MISSION_ID;
      console.log(`[Cycle ${cycle}] mission ${missionId} level-gated (error 102). Will relogin, reselect character, and fallback to ${fallbackId} on next cycle.`);
      await reloginAndReselectCharacter(charId);
      missionId = fallbackId;
      levelGateFallback = true;
    }

    if (!isSuccessResponse(startResult)) {
      if (normalizedTrainingMode === 'tp' && pendingTrainingMissions !== null && pendingTrainingMissions.includes(missionId)) {
        if (isTpDailyMissionConsumed(startResult)) {
          pendingTrainingMissions = pendingTrainingMissions.filter((mid) => mid !== missionId);
          console.log(`[Cycle ${cycle}] TP mission ${missionId} already consumed/locked today. Trying the next TP daily mission...`);
          continue;
        }
      }
      if (levelGateFallback) {
        if (!(await waitWithStop(jitteredWaitSeconds(cycleCooldownSeconds, actionJitterSeconds)))) { console.log(`${gameLabel} leveling stopped by user request`); break; }
        continue;
      }
      const cooldown = cooldownSeconds(startResult);
      if (cooldown > 0) {
        successStreak = 0;
        if (!(await registerFailureAndMaybeCircuit(failureTimestamps, profile, cycle))) break;
        const waitSec = jitteredWaitSeconds(Math.max(cooldown, startRetryDelaySeconds), actionJitterSeconds);
        const waitMin = Math.round((waitSec / 60) * 10) / 10;
        console.log(`[Cycle ${cycle}] startMission cooldown/lock detected, waiting ${waitMin} minutes before retry...`);
        if (!(await waitWithStop(waitSec))) { console.log(`${gameLabel} leveling stopped by user request`); break; }
        continue;
      }
      if (!(await registerFailureAndMaybeCircuit(failureTimestamps, profile, cycle))) break;
      successStreak = 0;
      consecutiveStartFailures += 1;
      const sessionInvalid = isSessionInvalidError(startResult);
      const failureClass = sessionInvalid ? 'invalid-session' : 'unknown';
      console.log(`[Cycle ${cycle}] startMission failed for mission '${missionId}' [${failureClass}] code=${JSON.stringify(errorCode(startResult))} | reason: ${describeStartFailure(startResult)} | raw: ${JSON.stringify(startResult)}`);
      console.log(`[Cycle ${cycle}] Treating it as a temporary failure and will retry on the next cycle (${consecutiveStartFailures}/${MAX_CONSECUTIVE_START_FAILURES} consecutive failures).`);
      if (sessionInvalid) {
        console.log(`[Cycle ${cycle}] Session looks invalid. Attempting relogin + reselect before continuing...`);
        await reloginAndReselectCharacter(charId);
      }
      if (consecutiveStartFailures >= MAX_CONSECUTIVE_START_FAILURES) {
        console.log(`[Cycle ${cycle}] startMission kept failing (${consecutiveStartFailures} cycles in a row). Leveling stopped to avoid an endless loop.`);
        break;
      }
      if (!(await waitWithStop(jitteredWaitSeconds(cycleCooldownSeconds, actionJitterSeconds)))) { console.log(`${gameLabel} leveling stopped by user request`); break; }
      continue;
    }
    lastSuccessMissionId = missionId;
    consecutiveStartFailures = 0;

    if (delaySeconds > 0) {
      const actionWait = jitteredWaitSeconds(delaySeconds, actionJitterSeconds);
      if (!(await waitWithStop(actionWait))) console.log('Stop requested; finishing current cycle after updateCharacter...');
    }

    let okToCall;
    [okToCall, lastAmfCallAt] = await waitMinCallInterval(lastAmfCallAt, minCallDelaySeconds, actionJitterSeconds);
    if (!okToCall) { console.log(`${gameLabel} leveling stopped by user request`); return; }
    let updateResult;
    try {
      updateResult = await amfReq.updateCharacterProgress(charId, charLevel, missionId, xpGain, goldGain);
      lastAmfCallAt = now();
    } catch (exc) {
      const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
      cloudflareBackoffIndex = nextIdx;
      if (await handleRuntimeException(exc, charId, 'updateCharacter', cfWait)) {
        successStreak = 0;
        if (!(await registerFailureAndMaybeCircuit(failureTimestamps, profile, cycle))) return;
        continue;
      }
      return;
    }
    if (!isSuccessResponse(updateResult)) {
      if (normalizedTrainingMode === 'tp' && isTpDailyMissionUpdateConsumed(updateResult)) {
        if (pendingTrainingMissions !== null && pendingTrainingMissions.includes(missionId)) {
          pendingTrainingMissions = pendingTrainingMissions.filter((mid) => mid !== missionId);
        }
        console.log(`[Cycle ${cycle}] TP mission ${missionId} already completed today during updateCharacter. Trying the next TP daily mission...`);
        continue;
      }
      successStreak = 0;
      if (!(await registerFailureAndMaybeCircuit(failureTimestamps, profile, cycle))) break;
      console.log(`[Cycle ${cycle}] updateCharacter failed: ${JSON.stringify(updateResult)}`);
      break;
    }

    if (normalizedTrainingMode === 'tp' && pendingTrainingMissions !== null && pendingTrainingMissions.includes(missionId)) {
      pendingTrainingMissions = pendingTrainingMissions.filter((mid) => mid !== missionId);
    }

    let parsedEnergy = null;
    if (updateResult && typeof updateResult === 'object' && !Array.isArray(updateResult)) {
      let [charName, parsedLevel, charXp, charGold, parsedRank, energy] = progressParser.extractProgressSnapshot(updateResult, charLevel, charRank);
      parsedEnergy = energy;
      if (parsedLevel === charLevel && charXp === 0 && charGold === 0 && charName === 'Unknown') {
        try {
          let ok;
          [ok, lastAmfCallAt] = await waitMinCallInterval(lastAmfCallAt, minCallDelaySeconds, actionJitterSeconds);
          if (!ok) { console.log(`${gameLabel} leveling stopped by user request`); return; }
          const refreshed = await amfReq.getCharacterData(charId, false, false);
          lastAmfCallAt = now();
          if (refreshed && typeof refreshed === 'object' && !Array.isArray(refreshed)) {
            [charName, parsedLevel, charXp, charGold, parsedRank, parsedEnergy] = progressParser.extractProgressSnapshot(refreshed, charLevel, charRank);
          }
        } catch (exc) {
          const [cfWait, nextIdx] = nextCloudflareWait(profile, cloudflareBackoffIndex);
          cloudflareBackoffIndex = nextIdx;
          if (await handleRuntimeException(exc, charId, 'refresh character data', cfWait)) {
            successStreak = 0;
            if (!(await registerFailureAndMaybeCircuit(failureTimestamps, profile, cycle))) return;
            continue;
          }
          return;
        }
      }

      charLevel = parsedLevel;
      if (parsedRank !== null && parsedRank !== undefined) charRank = parsedRank;
      const rankSuffix = charRank !== null && charRank !== undefined ? ` ${rankName(charRank)}(${charRank})` : '';
      const energySuffix = parsedEnergy !== null && parsedEnergy !== undefined ? ` Energy ${parsedEnergy}` : '';
      let rewardSuffix = '';
      if (normalizedTrainingMode === 'tp') {
        const tpReward = extractTrainingReward(updateResult, 'tp') || missionRewardValue(missionId, 'tp');
        if (tpReward > 0) rewardSuffix = ` TP +${tpReward}`;
      } else if (normalizedTrainingMode === 'ss') {
        let ssReward = extractTrainingReward(updateResult, 'ss');
        if (ssReward <= 0) ssReward = missionRewardValue(missionId, 'sp');
        if (ssReward > 0) rewardSuffix = ` SS +${ssReward}`;
      }
      const prevXp = lastObservedProgress[0];
      const prevGold = lastObservedProgress[1];
      const dXp = typeof prevXp === 'number' && typeof charXp === 'number' ? charXp - prevXp : null;
      const dGold = typeof prevGold === 'number' && typeof charGold === 'number' ? charGold - prevGold : null;
      const xpDelta = dXp ? ` (+${dXp})` : '';
      const goldDelta = dGold ? ` (+${dGold})` : '';
      console.log(`[Cycle ${cycle}] ✅ ${missionLabel} done | ${charName} Lv ${charLevel}${rankSuffix} | XP ${charXp}${xpDelta} | Gold ${charGold}${goldDelta}${energySuffix}${rewardSuffix}`);
      await pushLiveProgressUpdate(charLevel, charXp, charGold, updateResult.account_tokens, charRank);
      const currentProgress = [charXp, charGold];
      if ((lastObservedProgress[0] !== null || lastObservedProgress[1] !== null) && currentProgress[0] === lastObservedProgress[0] && currentProgress[1] === lastObservedProgress[1]) {
        noProgressCycles += 1;
        console.log(`[Cycle ${cycle}] Warning: no XP/Gold change detected (${noProgressCycles} stagnant mission${noProgressCycles !== 1 ? 's' : ''}).`);
        if (noProgressCycles >= 3) {
          console.log(`[Cycle ${cycle}] Error: ${gameLabel} progress is stagnant after multiple successful missions. Stopping so we do not loop forever.`);
          break;
        }
      } else {
        noProgressCycles = 0;
      }
      lastObservedProgress = currentProgress;
    } else {
      console.log(`[Cycle ${cycle}] updateCharacter response: ${JSON.stringify(updateResult)}`);
    }

    successStreak += 1;
    if (successStreak >= 3) {
      cloudflareBackoffIndex = 0;
      if (failureTimestamps.length) failureTimestamps.length = 0;
    } else {
      cloudflareBackoffIndex = Math.min(cloudflareBackoffIndex, 1);
    }

    if (stopRequested()) { console.log(`${gameLabel} leveling stopped after updateCharacter`); break; }

    const cooldownWait = jitteredWaitSeconds(cycleCooldownSeconds, actionJitterSeconds);
    if (!(await waitWithStop(cooldownWait))) { console.log(`${gameLabel} leveling stopped by user request`); break; }

    if (restEveryCycles > 0 && cycle % restEveryCycles === 0) {
      const restWait = jitteredWaitSeconds(restDurationSeconds, actionJitterSeconds);
      console.log(`[Cycle ${cycle}] Anti-detection rest: sleeping ${restWait.toFixed(1)} seconds...`);
      if (!(await waitWithStop(restWait))) { console.log(`${gameLabel} leveling stopped by user request`); break; }
    }
  }
}
