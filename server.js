// Port of desktop_app/main.py — Express + ws, NinjaSaga base game only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';

import config from './src/core/config.js';
import amfReq from './src/core/amfReq.js';
import * as ninjasagaAmfReq from './src/core/ninjasaga/amfReq.js';
import * as nso from './src/core/ninjasaga/nso.js';
import { SessionManager, getSessionTokens } from './src/core/sessionManager.js';
import { resolveNinjasagaAction } from './src/core/ninjasaga/actions.js';
import { buildClanWarSnapshot, clanWarEvent } from './src/core/ninjasaga/clanWar.js';
import {
  RANK_NAME_BY_ID,
  RANK_CHUNIN, RANK_JOUNIN, RANK_SPECIAL_JOUNIN, RANK_TUTOR,
  GENIN_LEVEL_CAP, CHUNIN_LEVEL_CAP, JOUNIN_LEVEL_CAP, SPECIAL_JOUNIN_LEVEL_CAP, TUTOR_LEVEL_CAP,
} from './src/core/ninjasaga/leveling.js';
import { writablePath } from './src/core/shared/utils.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATES_DIR = path.join(HERE, 'templates');
const STATIC_DIR = path.join(HERE, 'static');

const BUILD_NUM = config.PANEL_BUILD_NUM;
const sessions = new SessionManager(config);
const manager = sessions.manager;

// ---------------------------------------------------------------------------
// Console bridge: route module logs (console.log/warn/error) of the running
// action to its session so they show up live in the web panel log.
// ---------------------------------------------------------------------------
function installConsoleBridge() {
  const stringify = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return value.message;
    try { return JSON.stringify(value); } catch { return String(value); }
  };
  for (const level of ['log', 'info', 'warn', 'error']) {
    const original = console[level].bind(console);
    console[level] = (...args) => {
      const callback = config.actionLogCallback;
      if (typeof callback === 'function') {
        const type = level === 'error' ? 'error' : (level === 'warn' ? 'warning' : 'info');
        try { callback(args.map(stringify).join(' '), type); } catch { /* ignore */ }
      }
      original(...args);
    };
  }
}
installConsoleBridge();

const app = express();
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
fs.mkdirSync(STATIC_DIR, { recursive: true });
app.use('/static', express.static(STATIC_DIR));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function _asInt(value, defaultValue = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? Number(defaultValue) : parsed;
}

function _coerceInt(value, defaultValue, minimum = null) {
  let resolved = Number.parseInt(value, 10);
  if (Number.isNaN(resolved)) resolved = Number(defaultValue);
  if (minimum !== null) resolved = Math.max(Number(minimum), resolved);
  return resolved;
}

function quickLoginFilename(profileId, baseGameId) {
  const storageKey = config.getQuickLoginStorageKey(profileId, baseGameId);
  return writablePath(`quick_login_${storageKey}.json`);
}

function saveQuickLoginFile(profileId, credentials, baseGameId) {
  fs.writeFileSync(quickLoginFilename(profileId, baseGameId), JSON.stringify(credentials), 'utf-8');
}

function loadQuickLoginFile(profileId, baseGameId) {
  const filename = quickLoginFilename(profileId, baseGameId);
  if (!fs.existsSync(filename)) return null;
  const data = JSON.parse(fs.readFileSync(filename, 'utf-8'));
  if (data && typeof data === 'object' && data.username && data.password) return data;
  return null;
}

function prepareSerializableCharacters(characters) {
  const out = [];
  for (const char of characters || []) {
    if (char && typeof char === 'object' && !Array.isArray(char)) {
      out.push({
        character_name: char.character_name ?? 'Unknown',
        character_level: char.character_level ?? 0,
        character_id: char.character_id ?? char.char_id ?? 0,
      });
    } else {
      out.push({
        character_name: `Character ${out.length + 1}`,
        character_id: typeof char === 'number' || typeof char === 'string' ? char : 0,
      });
    }
  }
  return out;
}

function extractCharacterList(allChar) {
  if (!allChar) return [[], allChar];
  if (Array.isArray(allChar)) return [allChar, allChar];
  if (typeof allChar === 'object') {
    if (Array.isArray(allChar.account_data)) return [allChar.account_data, allChar];
    if (Array.isArray(allChar.characters)) return [allChar.characters, allChar];
  }
  return [[], allChar];
}

function extractCharacterValue(characterData, keys, defaultValue = undefined) {
  for (const key of keys) {
    const value = characterData[key];
    if (value !== null && value !== undefined) return value;
  }
  return defaultValue;
}

// Ninja rank (PlayerStatus): 0 Student, 1 Genin, 2 Chunin, ... 9 Tutor Senior.
const RANK_KEYS = ['character_rank', 'rank', 'current_rank', 'rank_id'];

function extractRankValue(characterData) {
  if (!characterData || typeof characterData !== 'object' || Array.isArray(characterData)) return null;
  const pick = (obj) => {
    for (const key of RANK_KEYS) {
      const raw = obj[key];
      if (raw === null || raw === undefined || raw === '') continue;
      const parsed = Number.parseInt(raw, 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
    return null;
  };
  const direct = pick(characterData);
  if (direct !== null) return direct;
  for (const container of ['character_data', 'data', 'character', 'result']) {
    const nested = characterData[container];
    if (!nested || typeof nested !== 'object' || Array.isArray(nested)) continue;
    const found = pick(nested);
    if (found !== null) return found;
  }
  return null;
}

function rankTierInfo(rank) {
  if (rank === null || rank === undefined) return { level_cap: null, next_exam: null };
  if (rank >= RANK_TUTOR) return { level_cap: TUTOR_LEVEL_CAP, next_exam: null };
  if (rank >= RANK_SPECIAL_JOUNIN) return { level_cap: SPECIAL_JOUNIN_LEVEL_CAP, next_exam: 'Tutor exam' };
  if (rank >= RANK_JOUNIN) return { level_cap: JOUNIN_LEVEL_CAP, next_exam: 'Special Jounin exam' };
  if (rank >= RANK_CHUNIN) return { level_cap: CHUNIN_LEVEL_CAP, next_exam: 'Jounin exam' };
  return { level_cap: GENIN_LEVEL_CAP, next_exam: 'Chunin exam' };
}

function buildCharacterInfo(session, characterData) {
  const currentGameId = config.getCurrentBaseGame().id;
  let accountType = null;
  if (!config.getCurrentBaseGame().has_account_stats) {
    if (currentGameId === 'ninjasaga') {
      const rawType = extractCharacterValue(characterData, ['account_type', 'character_account_type']) || (session.login_data || {}).account_type;
      const typeValue = Number.parseInt(rawType, 10);
      accountType = !Number.isNaN(typeValue) && typeValue === 2 ? 'Premium' : 'Free User';
    }
  }
  const rankValue = extractRankValue(characterData);
  const rankName = rankValue === null ? null : (RANK_NAME_BY_ID[rankValue] ?? `Rank ${rankValue}`);
  const rankTier = rankTierInfo(rankValue);
  return {
    name: extractCharacterValue(characterData, ['character_name', 'name'], 'Unknown'),
    level: extractCharacterValue(characterData, ['character_level', 'level'], 0),
    xp: extractCharacterValue(characterData, ['character_xp', 'xp'], 0),
    gold: extractCharacterValue(characterData, ['character_gold', 'gold'], 0),
    credit: null,
    gems: null,
    account_type: accountType,
    rank: rankValue,
    rank_name: rankName,
    rank_level_cap: rankTier.level_cap,
    rank_next_exam: rankTier.next_exam,
    tokens: config.getCurrentBaseGame().has_tokens ? getSessionTokens(config, session) : null,
  };
}

function pushLiveCharacterUpdate(userId, updates) {
  const session = session_get(userId);
  if (!session || !session.current_character) return;
  const current = session.current_character;
  if (updates.level !== null && updates.level !== undefined) { current.character_level = updates.level; current.level = updates.level; }
  if (updates.xp !== null && updates.xp !== undefined) { current.character_xp = updates.xp; current.xp = updates.xp; }
  if (updates.gold !== null && updates.gold !== undefined) { current.character_gold = updates.gold; current.gold = updates.gold; }
  if (updates.rank !== null && updates.rank !== undefined) { current.character_rank = updates.rank; current.rank = updates.rank; }
  if (updates.tokens !== null && updates.tokens !== undefined) {
    if (!session.raw_characters_response || typeof session.raw_characters_response !== 'object') session.raw_characters_response = {};
    session.raw_characters_response.tokens = updates.tokens;
  }
  const payload = buildCharacterInfo(session, current);
  manager.sendCharacterUpdate(userId, payload).catch(() => {});
}

function triggerForceReauth(userId, reason) {
  const session = session_get(userId);
  if (!session) return;
  session.current_character = null;
  session.character_data = null;
  session.action_task = null;
  manager.sendStatus(userId, {
    running: false, action: null, status: 'force_reauth', force_reauth: true, reason,
  }).catch(() => {});
}

function session_get(userId) {
  return sessions.getSession(userId);
}

function sessionContext(session) {
  if (!session.game_context || typeof session.game_context !== 'object') {
    session.game_context = config.createContext(session.base_game_id, session.profile_id);
  }
  const ctx = session.game_context;
  ctx.activeBaseGame = session.base_game_id;
  ctx.activeAmfProfile = session.profile_id;
  try {
    const profile = config._profilesForBaseGame(session.base_game_id)[session.profile_id];
    if (profile) { ctx.gateway = profile.gateway; ctx.buildNum = profile.build_num; }
  } catch { /* unknown base game/profile — keep existing context values */ }
  ctx.loginData = session.login_data || null;
  ctx.gameData = session.game_data === undefined ? null : session.game_data;
  ctx.stopEvent = session.stop_event;
  return ctx;
}

function runInSession(session, fn) {
  return config.runWithContext(sessionContext(session), fn);
}

function sessionProfile(session) {
  try { return config._profilesForBaseGame(session.base_game_id)[session.profile_id] || {}; }
  catch { return {}; }
}

async function pushNinjasagaDebugLogsToSession(userId, limit = 40) {
  const session = session_get(userId);
  if (!session) return;
  await runInSession(session, async () => {
    if (config.getCurrentBaseGame().id !== 'ninjasaga') return;
    const state = config.ninjasagaState;
    if (!state || typeof state !== 'object') return;
    const events = state.debug_events;
    if (!Array.isArray(events) || !events.length) return;
    const tail = events.slice(-Math.max(1, Number(limit)));
    for (const message of tail) {
      session.addLog(String(message), 'info');
      await manager.sendLog(userId, { timestamp: new Date().toTimeString().slice(0, 8), message: String(message), type: 'info' });
    }
  });
}

function refreshCharacterData(userId, announce = true) {
  const session = session_get(userId);
  if (!session || !session.current_character) return Promise.resolve();
  return runInSession(session, () => refreshCharacterDataInner(session, announce));
}

async function refreshCharacterDataInner(session, announce = true) {
  const userId = session.user_id;
  try {
    const currentChar = session.current_character;
    let charId = currentChar.char_id ?? currentChar.character_id;
    if (Array.isArray(charId)) charId = charId.length ? charId[0] : null;
    if (!charId) { session.addLog('❌ No character ID found for refresh', 'error'); return; }

    if (config.getCurrentBaseGame().id === 'ninjasaga' && session.profile_id === 'nso') {
      if (!session.nso_http || !session.nso_login) { session.addLog('❌ NSO session hilang, login ulang dulu', 'error'); return; }
      try {
        const charDataResponse = await nso.nsoGetCharacterData(session.nso_http, charId, session.nso_login.sessionkey);
        const characterData = (charDataResponse && typeof charDataResponse === 'object' && charDataResponse.character_data)
          ? charDataResponse.character_data
          : charDataResponse;
        if (characterData && typeof characterData === 'object') {
          session.current_character = characterData;
          session.character_data = charDataResponse;
          const characterInfo = buildCharacterInfo(session, characterData);
          await manager.sendCharacterUpdate(userId, characterInfo);
          if (!announce) return;
          session.addLog(`✅ Character refreshed - Lv ${characterInfo.level}, EXP: ${characterInfo.xp}, Gold: ${characterInfo.gold}`, 'success');
          await manager.sendLog(userId, { timestamp: new Date().toTimeString().slice(0, 8), message: `✅ Character refreshed - Lv ${characterInfo.level}, EXP: ${characterInfo.xp}, Gold: ${characterInfo.gold}`, type: 'success' });
        } else {
          session.addLog('❌ Failed to parse NSO character data during refresh', 'error');
        }
      } catch (e) {
        session.addLog(`❌ Error refreshing NSO character data: ${e.message || e}`, 'error');
      }
      return;
    }
    if (config.getCurrentBaseGame().id === 'ninjasaga') {
      try {
        const refreshedCharacters = await amfReq.getAllCharacters();
        if (config.allChar && typeof config.allChar === 'object') session.raw_characters_response = config.allChar;
        if (refreshedCharacters) session.characters = refreshedCharacters;
      } catch { /* ignore */ }
    }

    const charDataResponse = await amfReq.getCharacterData(charId);
    if (charDataResponse && typeof charDataResponse === 'object' && charDataResponse.status !== null && charDataResponse.status !== undefined && ![1, '1'].includes(charDataResponse.status)) {
      const errorMessage = charDataResponse.error || 'Character refresh failed';
      session.addLog(`❌ Character refresh failed: ${errorMessage}`, 'error');
      return;
    }
    if (charDataResponse) {
      let characterData = null;
      if (typeof charDataResponse === 'object' && !Array.isArray(charDataResponse)) {
        if ('character_data' in charDataResponse) characterData = charDataResponse.character_data;
        else if (charDataResponse.character_name || charDataResponse.name) characterData = charDataResponse;
        else if (charDataResponse.status === 1) {
          for (const key of ['data', 'result', 'character']) {
            if (charDataResponse[key] && typeof charDataResponse[key] === 'object' && charDataResponse[key].character_name) { characterData = charDataResponse[key]; break; }
          }
        }
      }
      if (characterData) {
        session.current_character = characterData;
        session.character_data = charDataResponse;
        const characterInfo = buildCharacterInfo(session, characterData);
        await manager.sendCharacterUpdate(userId, characterInfo);
        if (!announce) return;
        session.addLog(`✅ Character refreshed - Lv ${characterInfo.level}, EXP: ${characterInfo.xp}, Gold: ${characterInfo.gold}`, 'success');
        await manager.sendLog(userId, { timestamp: new Date().toTimeString().slice(0, 8), message: `✅ Character refreshed - Lv ${characterInfo.level}, EXP: ${characterInfo.xp}, Gold: ${characterInfo.gold}`, type: 'success' });
      } else {
        session.addLog('❌ Failed to parse character data during refresh', 'error');
      }
    } else {
      session.addLog('❌ Empty response from server during refresh', 'error');
    }
  } catch (e) {
    session.addLog(`❌ Error refreshing character data: ${e.message || e}`, 'error');
  }
}

function runAction(userId, actionFunc, actionName) {
  const session = session_get(userId);
  if (!session) return Promise.resolve();
  return runInSession(session, () => runActionInner(session, actionFunc, actionName));
}

async function runActionInner(session, actionFunc, actionName) {
  const userId = session.user_id;
  try {
    session.addLog(`🟡 Starting: ${actionName}...`, 'info');
    await manager.sendStatus(userId, { running: true, action: actionName, status: 'running' });

    config.stopEvent = session.stop_event;
    config.characterUpdateCallback = (updates) => pushLiveCharacterUpdate(userId, updates);
    config.sessionReauthRequiredCallback = (reason) => triggerForceReauth(userId, reason);
    config.actionLogCallback = (message, logType = 'info') => {
      const text = String(message);
      session.addLog(text, logType);
      manager.sendLog(userId, { timestamp: new Date().toTimeString().slice(0, 8), message: text, type: logType }).catch(() => {});
    };
    await actionFunc();
    session.addLog(`✅ Action completed: ${actionName}`, 'success');
  } catch (e) {
    session.addLog(`❌ Action error: ${e.message || e}`, 'error');
  } finally {
    session.action_task = null;
    session.stop_event.clear();
    config.characterUpdateCallback = null;
    config.sessionReauthRequiredCallback = null;
    config.actionLogCallback = null;
    await manager.sendStatus(userId, { running: false, action: null, status: 'ready' });
  }
}

async function finalizeLoginSuccess(requestUsername, requestPassword, loginData, ctx) {
  const userId = crypto.randomUUID();
  const session = sessions.create(userId, requestUsername, ctx.activeBaseGame, ctx.activeAmfProfile);
  session.game_context = ctx;
  session.login_data = loginData;
  session.game_data = config.gameData;
  config.loginData = loginData;

  const currentAmfProfile = config.getCurrentAmfProfile();
  const quickLoginStore = config.setQuickLoginCredentials(currentAmfProfile.id, requestUsername, requestPassword, currentAmfProfile.label);
  session.quick_login_data = quickLoginStore;
  const storageKey = config.getQuickLoginStorageKey(currentAmfProfile.id, session.base_game_id);
  saveQuickLoginFile(currentAmfProfile.id, quickLoginStore.profiles[storageKey], session.base_game_id);

  try {
    const allChar = await amfReq.getAllCharacters();
    [session.characters, session.raw_characters_response] = extractCharacterList(allChar);
    if (session.characters && session.characters.length) config.allChar = allChar;
  } catch {
    session.characters = [];
  }

  session.addLog(`✅ Login successful for ${requestUsername}`, 'success');
  await pushNinjasagaDebugLogsToSession(userId);

  return {
    success: true,
    user_id: userId,
    username: requestUsername,
    characters: prepareSerializableCharacters(session.characters),
    character_count: (session.characters || []).length,
  };
}

// ---------------------------------------------------------------------------
// NinjaSaga settings sanitizers
// ---------------------------------------------------------------------------

function sanitizeAntidetectProfile(raw, store = null) {
  const base = config.getNinjasagaAntiDetectionProfile(store || {});
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw };
  merged.action_delay_seconds = _coerceInt(merged.action_delay_seconds, base.action_delay_seconds, 0);
  merged.cycle_cooldown_seconds = _coerceInt(merged.cycle_cooldown_seconds, base.cycle_cooldown_seconds, 0);
  merged.rest_every_cycles = _coerceInt(merged.rest_every_cycles, base.rest_every_cycles, 0);
  merged.rest_duration_seconds = _coerceInt(merged.rest_duration_seconds, base.rest_duration_seconds, 0);
  merged.action_jitter_seconds = _coerceInt(merged.action_jitter_seconds, base.action_jitter_seconds, 0);
  merged.min_call_delay_seconds = _coerceInt(merged.min_call_delay_seconds, base.min_call_delay_seconds, 0);
  merged.start_retry_delay_seconds = _coerceInt(merged.start_retry_delay_seconds, base.start_retry_delay_seconds, 1);
  merged.start_max_retries = _coerceInt(merged.start_max_retries, base.start_max_retries, 1);
  merged.cloudflare_rest_seconds = _coerceInt(merged.cloudflare_rest_seconds, base.cloudflare_rest_seconds, 1);
  merged.cloudflare_backoff_max_seconds = _coerceInt(merged.cloudflare_backoff_max_seconds, base.cloudflare_backoff_max_seconds, 1);
  merged.failure_window_seconds = _coerceInt(merged.failure_window_seconds, base.failure_window_seconds, 30);
  merged.max_failures_in_window = _coerceInt(merged.max_failures_in_window, base.max_failures_in_window, 1);
  merged.circuit_cooldown_seconds = _coerceInt(merged.circuit_cooldown_seconds, base.circuit_cooldown_seconds, 10);
  const rawSteps = merged.cloudflare_backoff_steps_seconds;
  if (typeof rawSteps === 'string') {
    const parsed = rawSteps.split(',').map((s) => Number.parseInt(s.trim(), 10)).filter((v) => !Number.isNaN(v)).map((v) => Math.max(1, v));
    merged.cloudflare_backoff_steps_seconds = parsed.length ? parsed : [...base.cloudflare_backoff_steps_seconds];
  } else if (Array.isArray(rawSteps)) {
    const parsed = rawSteps.map((v) => Number.parseInt(v, 10)).filter((v) => !Number.isNaN(v)).map((v) => Math.max(1, v));
    merged.cloudflare_backoff_steps_seconds = parsed.length ? parsed : [...base.cloudflare_backoff_steps_seconds];
  } else {
    merged.cloudflare_backoff_steps_seconds = [...base.cloudflare_backoff_steps_seconds];
  }
  return merged;
}

function sanitizeAutospendProfile(raw, store = null) {
  const base = config.getNinjasagaAutoSpendProfile(store || {});
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw };
  merged.enabled = !!merged.enabled;
  merged.target = String(merged.target || base.target);
  merged.trigger_energy = 0;
  merged.max_refills_per_run = _coerceInt(merged.max_refills_per_run, base.max_refills_per_run, 0);
  return merged;
}

function sanitizeEventResourcePolicy(raw, store = null) {
  const base = config.getNinjasagaEventResourcePolicy(store || {});
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw };
  let mode = String(merged.mode || base.mode).trim().toLowerCase();
  if (!['buy', 'wait', 'stop'].includes(mode)) mode = 'wait';
  merged.mode = mode;
  merged.wait_minutes = _coerceInt(merged.wait_minutes, base.wait_minutes, 0);
  return merged;
}

function sanitizeNinjasagaEventTiming(raw, store = null) {
  const base = config.getNinjasagaEventTiming(store || {});
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw };
  merged.sakura_battle_delay_seconds = _coerceInt(merged.sakura_battle_delay_seconds, base.sakura_battle_delay_seconds, 1);
  return merged;
}

const sanitizeSpecialJouninClassIndex = (raw) => {
  let value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) value = 1;
  return Math.max(1, Math.min(5, value));
};

const sanitizeTrainingAbuseLoop = (raw) => {
  let value = Number.parseInt(raw, 10);
  if (Number.isNaN(value)) value = 1;
  return Math.max(1, value);
};

// ---------------------------------------------------------------------------
// Clan War state helpers
// ---------------------------------------------------------------------------

function defaultClanWarSettings() {
  return {
    auto_spend_token: false,
    stamina_refill_source: 'auto',
    bleeding_mode: false,
    manual_recruit: false,
    manual_member_ids: [],
    target_clan_id: '',
    target_clan_name: '',
    settings: { battle_delay_seconds: 8, refresh_delay_seconds: 30, buy_stamina_delay_seconds: 3, amf_call_delay_seconds: 2, post_captcha_resume_delay_seconds: 4 },
  };
}

function sanitizeClanWarSettings(raw) {
  const base = defaultClanWarSettings();
  if (!raw || typeof raw !== 'object') return base;
  const merged = { ...base, ...raw };
  merged.auto_spend_token = !!merged.auto_spend_token;
  const refillSource = String(merged.stamina_refill_source || 'token').trim().toLowerCase();
  merged.stamina_refill_source = ['auto', 'token', 'roll'].includes(refillSource) ? refillSource : 'auto';
  merged.bleeding_mode = !!merged.bleeding_mode;
  merged.manual_recruit = !!merged.manual_recruit;
  merged.manual_member_ids = Array.isArray(merged.manual_member_ids) ? merged.manual_member_ids.map((s) => String(s).trim()).filter((s) => s).slice(0, 2) : [];
  merged.target_clan_id = String(merged.target_clan_id || '').trim();
  merged.target_clan_name = String(merged.target_clan_name || '').trim();
  const rawSettings = merged.settings && typeof merged.settings === 'object' ? merged.settings : {};
  merged.settings = {
    battle_delay_seconds: _coerceInt(rawSettings.battle_delay_seconds, base.settings.battle_delay_seconds, 1),
    refresh_delay_seconds: _coerceInt(rawSettings.refresh_delay_seconds, base.settings.refresh_delay_seconds, 30),
    buy_stamina_delay_seconds: _coerceInt(rawSettings.buy_stamina_delay_seconds, base.settings.buy_stamina_delay_seconds, 1),
    amf_call_delay_seconds: _coerceInt(rawSettings.amf_call_delay_seconds, base.settings.amf_call_delay_seconds, 0),
    post_captcha_resume_delay_seconds: _coerceInt(rawSettings.post_captcha_resume_delay_seconds, base.settings.post_captcha_resume_delay_seconds, 0),
  };
  return merged;
}

function getClanWarState(session) {
  const state = session.clan_war_state && typeof session.clan_war_state === 'object' ? session.clan_war_state : {};
  if (!state.settings) state.settings = sanitizeClanWarSettings(state.settings);
  if (state.snapshot === undefined) state.snapshot = null;
  if (state.running === undefined) state.running = false;
  if (state.captcha_required === undefined) state.captcha_required = false;
  if (state.captcha_message === undefined) state.captcha_message = '';
  if (state.captcha_window_supported === undefined) state.captcha_window_supported = false;
  if (state.captcha_challenge === undefined) state.captcha_challenge = null;
  if (state.captcha_debug === undefined) state.captcha_debug = null;
  if (!state.current_target) state.current_target = { id: state.settings.target_clan_id || '', name: state.settings.target_clan_name || '' };
  session.clan_war_state = state;
  return state;
}

function summarizeCaptchaDebug(value, depth = 0) {
  if (depth > 4) return '[truncated-depth]';
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const summary = {};
    for (const [key, item] of Object.entries(value)) {
      if (['tiles', 'prompt', 'btn_img', 'background', 'piece', 'arrow_left', 'arrow_right'].includes(String(key))) {
        summary[key] = Array.isArray(item) ? `[${item.length} item(s) omitted]` : '[omitted]';
        continue;
      }
      summary[key] = summarizeCaptchaDebug(item, depth + 1);
    }
    return summary;
  }
  if (Array.isArray(value)) {
    if (value.length > 25) return [...value.slice(0, 25).map((item) => summarizeCaptchaDebug(item, depth + 1)), `... (${value.length - 25} more item(s))`];
    return value.map((item) => summarizeCaptchaDebug(item, depth + 1));
  }
  if (typeof value === 'string' && value.length > 180) return `${value.slice(0, 180)}... [truncated ${value.length - 180} chars]`;
  return value;
}

function resolveSessionQuickLoginCredentials(session) {
  let credentials = null;
  if (session.quick_login_data) {
    [credentials] = config.getQuickLoginCredentials(session.profile_id, session.quick_login_data);
  }
  if (!credentials) {
    try { credentials = loadQuickLoginFile(session.profile_id, session.base_game_id); } catch { credentials = null; }
  }
  const username = String((credentials || {}).username || session.username || '').trim();
  const password = String((credentials || {}).password || '').trim();
  return [username, password];
}

function silentNinjasagaReloginAfterCaptcha(session) {
  return runInSession(session, () => silentNinjasagaReloginAfterCaptchaInner(session));
}

async function silentNinjasagaReloginAfterCaptchaInner(session) {
  const [username, password] = resolveSessionQuickLoginCredentials(session);
  if (!username || !password) return false;
  const currentChar = session.current_character && typeof session.current_character === 'object' ? session.current_character : {};
  let charId = currentChar.char_id || currentChar.character_id || currentChar.id;
  if (Array.isArray(charId)) charId = charId.length ? charId[0] : null;
  const loginResult = await ninjasagaAmfReq.login(username, password);
  if (!loginResult || String(loginResult.status) !== '1') return false;
  session.login_data = loginResult;
  config.loginData = loginResult;
  if (charId) {
    const charDataResponse = await ninjasagaAmfReq.getCharacterData(charId);
    let characterData = null;
    if (charDataResponse && typeof charDataResponse === 'object') {
      if (charDataResponse.character_data && typeof charDataResponse.character_data === 'object') characterData = charDataResponse.character_data;
      else if (charDataResponse.character_name || charDataResponse.name) characterData = charDataResponse;
      else if (Array.isArray(charDataResponse.result)) {
        const normalized = ninjasagaAmfReq.internals.normalizeCharacterEntry(charDataResponse.result, 0);
        if (normalized) { Object.assign(normalized, charDataResponse); characterData = normalized; }
      }
    }
    if (characterData && typeof characterData === 'object') {
      session.current_character = characterData;
      session.character_data = charDataResponse;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

app.get('/', (req, res) => {
  res.sendFile(path.join(TEMPLATES_DIR, 'index.html'));
});

app.get('/api/base_games', (req, res) => {
  res.json({ success: true, games: config.getBaseGames(), current: config.getCurrentBaseGame() });
});

app.get('/api/debug/ninjasaga', (req, res) => res.json({ success: true, enabled: config.getNinjasagaDebug() }));
app.post('/api/debug/ninjasaga', (req, res) => {
  const enabled = config.setNinjasagaDebug(!!(req.body || {}).enabled);
  res.json({ success: true, enabled });
});

function settingsPayload(store, baseGameId) {
  return {
    success: true,
    base_game_id: baseGameId,
    anti_detection_profile: config.getNinjasagaAntiDetectionProfile(store),
    auto_spend_profile: config.getNinjasagaAutoSpendProfile(store),
    event_resource_policy: config.getNinjasagaEventResourcePolicy(store),
    event_timing: config.getNinjasagaEventTiming(store),
    exam_mode: 'hard',
    special_jounin_class_index: sanitizeSpecialJouninClassIndex(store.special_jounin_class_index == null ? 3 : store.special_jounin_class_index),
    tp_training_abuse_loop: sanitizeTrainingAbuseLoop(store.tp_training_abuse_loop),
    ss_training_abuse_loop: sanitizeTrainingAbuseLoop(store.ss_training_abuse_loop),
  };
}

function applySettingsUpdate(body, store) {
  if (body.reset_defaults) {
    store.anti_detection_profile = { ...config.NINJASAGA_ANTI_DETECTION_PROFILE };
    store.auto_spend_profile = { ...config.NINJASAGA_AUTO_SPEND_PROFILE };
    store.event_resource_policy = { ...config.NINJASAGA_EVENT_RESOURCE_POLICY };
    store.event_timing = { ...config.NINJASAGA_EVENT_TIMING };
    store.special_jounin_class_index = 3;
    store.tp_training_abuse_loop = 1;
    store.ss_training_abuse_loop = 1;
    return;
  }
  if (body.anti_detection_profile != null) store.anti_detection_profile = sanitizeAntidetectProfile(body.anti_detection_profile, store);
  if (body.auto_spend_profile != null) store.auto_spend_profile = sanitizeAutospendProfile(body.auto_spend_profile, store);
  if (body.event_resource_policy != null) store.event_resource_policy = sanitizeEventResourcePolicy(body.event_resource_policy, store);
  if (body.event_timing != null) store.event_timing = sanitizeNinjasagaEventTiming(body.event_timing, store);
  if (body.special_jounin_class_index != null) store.special_jounin_class_index = sanitizeSpecialJouninClassIndex(body.special_jounin_class_index);
  if (body.tp_training_abuse_loop != null) store.tp_training_abuse_loop = sanitizeTrainingAbuseLoop(body.tp_training_abuse_loop);
  if (body.ss_training_abuse_loop != null) store.ss_training_abuse_loop = sanitizeTrainingAbuseLoop(body.ss_training_abuse_loop);
}

// Settings live in a global per-base-game store (not per session) so two browser
// tabs can each edit their own game's profile without clobbering each other.
app.get('/api/settings/ninjasaga', (req, res) => {
  res.json({ ...settingsPayload(config._settingsFor('ninjasaga'), 'ninjasaga'), debug_enabled: config.getNinjasagaDebug() });
});

app.post('/api/settings/ninjasaga', (req, res) => {
  const store = config._settingsFor('ninjasaga');
  applySettingsUpdate(req.body || {}, store);
  res.json(settingsPayload(store, 'ninjasaga'));
});

app.get('/api/amf_profiles', (req, res) => {
  try {
    const baseGameId = String(req.query.base_game_id || '').trim() || config.getCurrentBaseGame().id;
    const ctx = config.createContext(baseGameId);
    const payload = config.runWithContext(ctx, () => ({
      base_game: config.getCurrentBaseGame(),
      profiles: config.getAmfProfiles(),
      current: config.getCurrentAmfProfile(),
    }));
    res.json({ success: true, ...payload });
  } catch (exc) {
    res.json({ success: false, error: exc.message });
  }
});

app.post('/api/select_amf_profile', (req, res) => {
  try {
    const body = req.body || {};
    const baseGameId = body.base_game_id || String(req.query.base_game_id || '').trim() || config.getCurrentBaseGame().id;
    const ctx = config.createContext(baseGameId, body.profile_id);
    const selected = config.runWithContext(ctx, () => config.getCurrentAmfProfile());
    res.json({ success: true, profile: selected, message: `Selected ${selected.label}` });
  } catch (exc) {
    res.json({ success: false, error: exc.message });
  }
});

app.post('/api/check_version', (req, res) => res.json({ success: true, required: false }));

function normalizeNsoCharacters(payload) {
  if (!payload || typeof payload !== 'object') return [];
  const raw = Array.isArray(payload.account_data)
    ? payload.account_data
    : (Array.isArray(payload.characters) ? payload.characters : []);
  return raw.map((c, i) => {
    if (c && typeof c === 'object' && !Array.isArray(c)) {
      return {
        character_name: c.character_name ?? c.name ?? `Character ${i + 1}`,
        character_level: c.character_level ?? c.level ?? 0,
        character_id: c.character_id ?? c.char_id ?? c.id ?? 0,
        _nso_raw: c,
      };
    }
    return { character_name: `Character ${i + 1}`, character_level: 0, character_id: c ?? 0 };
  });
}

async function finalizeNsoLoginSuccess(requestUsername, requestPassword, nsoLoginData, nsoHttp, ctx) {
  const userId = crypto.randomUUID();
  const session = sessions.create(userId, requestUsername, ctx.activeBaseGame, ctx.activeAmfProfile);
  session.game_context = ctx;
  session.nso_http = nsoHttp;
  session.nso_login = { uid: nsoLoginData.uid, sessionkey: nsoLoginData.sessionkey };
  session.nso_creds = { username: requestUsername, password: requestPassword };
  session.login_data = nsoLoginData;
  session.game_data = null;

  const currentAmfProfile = config.getCurrentAmfProfile();
  const quickLoginStore = config.setQuickLoginCredentials(currentAmfProfile.id, requestUsername, requestPassword, currentAmfProfile.label);
  session.quick_login_data = quickLoginStore;
  const storageKey = config.getQuickLoginStorageKey(currentAmfProfile.id, session.base_game_id);
  saveQuickLoginFile(currentAmfProfile.id, quickLoginStore.profiles[storageKey], session.base_game_id);

  let characters = [];
  try {
    const allChar = await nso.nsoGetAllCharacters(nsoHttp, nsoLoginData.uid, nsoLoginData.sessionkey);
    session.raw_characters_response = allChar;
    characters = normalizeNsoCharacters(allChar);
    session.characters = characters;
  } catch {
    session.characters = [];
  }

  session.addLog(`✅ NSO login successful for ${requestUsername} (uid ${nsoLoginData.uid})`, 'success');
  return {
    success: true,
    user_id: userId,
    username: requestUsername,
    characters: prepareSerializableCharacters(session.characters),
    character_count: (session.characters || []).length,
  };
}

async function performLogin(body, res) {
  try {
    const baseGameId = body.base_game_id || config.getCurrentBaseGame().id;
    const profileId = body.profile_id || config.getCurrentAmfProfile().id;
    let ctx;
    try { ctx = config.createContext(baseGameId, profileId); }
    catch (exc) { res.json({ success: false, error: exc.message }); return; }

    await config.runWithContext(ctx, async () => {
      if (profileId === 'nso') {
        try {
          const nsoHttp = nso.createNsoSession();
          const nsoLoginData = await nso.nsoLogin(nsoHttp, body.username, body.password);
          res.json(await finalizeNsoLoginSuccess(body.username, body.password, nsoLoginData, nsoHttp, ctx));
        } catch (e) {
          res.json({ success: false, error: e.message || String(e), message: 'NSO login failed' });
        }
        return;
      }
      let buildMarker = '0';
      if (config.gameData) {
        buildMarker = String(config.gameData._ ?? 0);
      }

      const loginData = await amfReq.login(body.username, body.password, config.gameData ? config.gameData.__ || '' : '', buildMarker);
      if (loginData && _asInt(loginData.status, 0) === 1) {
        res.json(await finalizeLoginSuccess(body.username, body.password, loginData, ctx));
      } else {
        const errorMsg = loginData && loginData.message ? loginData.message : 'Invalid username or password';
        res.json({ success: false, error: errorMsg, message: 'Login failed' });
      }
    });
  } catch (e) {
    const errorText = e.message || String(e);
    if (errorText.includes('Cloudflare') || errorText.includes('HTTP 403')) {
      res.json({ success: false, gateway_blocked: true, error: errorText, message: 'Server blocked by gateway protection' });
      return;
    }
    res.json({ success: false, error: errorText, message: 'An error occurred during login' });
  }
}

app.post('/api/login', (req, res) => performLogin(req.body || {}, res));

app.post('/api/quick_login', async (req, res) => {
  try {
    const data = req.body || {};
    const userId = data.user_id;
    const baseGameId = data.base_game_id || config.getCurrentBaseGame().id;
    const remembered = (userId && sessions.sessions.get(userId)) || null;
    const profileId = data.profile_id
      || (remembered && remembered.profile_id)
      || config.getCurrentAmfProfile().id;
    const checkOnly = !!data.check_only;

    let ctx;
    try { ctx = config.createContext(baseGameId, profileId); }
    catch (exc) { res.json({ success: false, error: exc.message }); return; }

    await config.runWithContext(ctx, async () => {
      let credentials = null;
      if (userId && sessions.sessions.has(userId)) {
        const session = sessions.sessions.get(userId);
        if (session && session.quick_login_data) {
          [credentials] = config.getQuickLoginCredentials(profileId, session.quick_login_data);
        }
      }
      if (!credentials) {
        try {
          credentials = loadQuickLoginFile(profileId, baseGameId);
          if (credentials) config.setQuickLoginCredentials(profileId, credentials.username, credentials.password, credentials.amf_label || config.getCurrentAmfProfile().label);
        } catch { /* ignore */ }
      }

      if (checkOnly) { res.json({ success: !!credentials, available: !!credentials, base_game_id: baseGameId, profile_id: profileId }); return; }
      if (credentials) {
        await performLogin({ username: credentials.username, password: credentials.password, base_game_id: baseGameId, profile_id: profileId }, res);
        return;
      }
      res.json({ success: false, error: `No quick login data available for ${profileId}` });
    });
  } catch (e) {
    res.json({ success: false, error: e.message || String(e) });
  }
});

app.post('/api/select_character', async (req, res) => {
  const body = req.body || {};
  const session = session_get(body.user_id);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  try {
    const index = body.character_index;
    if (!session.characters || index >= session.characters.length) { res.json({ success: false, error: 'Invalid character selection' }); return; }
    const selectedChar = session.characters[index];
    await runInSession(session, async () => {
      let charId = selectedChar && typeof selectedChar === 'object' ? (selectedChar.char_id ?? selectedChar.character_id) : selectedChar;
      if (Array.isArray(charId)) charId = charId.length ? charId[0] : null;
      if (!charId) { res.json({ success: false, error: 'Invalid character data - no ID' }); return; }

      if (session.profile_id === 'nso' && session.nso_http && session.nso_login) {
        try {
          const charDataResponse = await nso.nsoGetCharacterData(session.nso_http, charId, session.nso_login.sessionkey);
          const characterData = (charDataResponse && typeof charDataResponse === 'object' && charDataResponse.character_data && typeof charDataResponse.character_data === 'object')
            ? charDataResponse.character_data
            : charDataResponse;
          session.current_character = characterData;
          session.character_data = charDataResponse;
          const characterInfo = buildCharacterInfo(session, characterData);
          session.addLog(`✅ Selected character: ${characterInfo.name}`, 'success');
          res.json({ success: true, character: characterInfo });
        } catch (e) {
          res.json({ success: false, error: e.message || String(e) });
        }
        return;
      }
      const charDataResponse = await amfReq.getCharacterData(charId);
      let characterData = null;
      if (charDataResponse && typeof charDataResponse === 'object') {
        if ('character_data' in charDataResponse) characterData = charDataResponse.character_data;
        else if (charDataResponse.character_name || charDataResponse.name) characterData = charDataResponse;
        else if (charDataResponse.status === 1) {
          for (const key of ['data', 'result', 'character']) {
            if (charDataResponse[key] && typeof charDataResponse[key] === 'object' && charDataResponse[key].character_name) { characterData = charDataResponse[key]; break; }
          }
        }
      }
      if (characterData) {
        session.current_character = characterData;
        session.character_data = charDataResponse;
        const characterInfo = buildCharacterInfo(session, characterData);
        session.addLog(`✅ Selected character: ${characterInfo.name}`, 'success');
        res.json({ success: true, character: characterInfo });
      } else {
        res.json({ success: false, error: 'Failed to parse character data' });
      }
    });
  } catch (e) {
    res.json({ success: false, error: e.message || String(e) });
  }
});

app.get('/api/user/:userId/status', (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  const characterInfo = session.current_character
    ? runInSession(session, () => buildCharacterInfo(session, session.current_character))
    : null;
  res.json({
    success: true,
    user: session.toDict(),
    character: characterInfo,
    running: session.action_task !== null && !session.action_task.done,
    current_action: session.action_task ? session.action_task.action_name : null,
    stopping: !!(session.stop_event.isSet() && session.action_task && !session.action_task.done),
  });
});

app.get('/api/user/:userId/logs', (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  const battleOnly = req.query.battle_only === 'true';
  res.json({ success: true, logs: battleOnly ? session.battle_logs.slice(-100) : session.logs.slice(-200) });
});

app.post('/api/user/:userId/clear_logs', (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  session.clearLogs();
  res.json({ success: true });
});

app.post('/api/user/:userId/action', async (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  if (session.action_task && !session.action_task.done) { res.json({ success: false, error: 'Another action is already running' }); return; }

  const body = req.body || {};
  let actionSpec;
  try {
    actionSpec = runInSession(session, () => resolveNinjasagaAction(
      body.action,
      body.params,
      () => () => refreshCharacterData(session.user_id),
      config.getCurrentBaseGame(),
      session.profile_id,
      session,
    ));
  } catch (exc) {
    res.json({ success: false, error: exc.message });
    return;
  }

  session.clan_war_state = {};
  session.clan_war_modal_stop_only = false;
  session.stop_event.clear();

  const task = { done: false, action_name: actionSpec.name, action_key: body.action };
  session.action_task = task;
  runAction(session.user_id, actionSpec.func, actionSpec.name).finally(() => { task.done = true; });
  res.json({ success: true, message: `Started: ${actionSpec.name}` });
});

app.post('/api/user/:userId/stop', async (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  if (session.action_task && !session.action_task.done) {
    if (session.action_task.action_key === 'clan_war') {
      session.clan_war_captcha_resume.set();
      const state = getClanWarState(session);
      state.running = false; state.captcha_required = false; state.captcha_message = ''; state.captcha_challenge = null;
    }
    session.stop_event.set();
    const actionName = session.action_task.action_name || 'Current Action';
    session.addLog(`🟠 Stopping ${actionName}... waiting current request/cooldown to finish`, 'warning');
    await manager.sendStatus(session.user_id, { running: true, action: actionName, stopping: true });
    res.json({ success: true, message: `Stopping ${actionName}... please wait` });
  } else {
    res.json({ success: false, error: 'No action running' });
  }
});

app.get('/api/admin/stats', (req, res) => {
  const running = [...sessions.sessions.values()].filter((s) => s.action_task && !s.action_task.done).length;
  res.json({ total_sessions: sessions.sessions.size, active_websockets: manager.active_connections.size, running_actions: running });
});

app.post('/api/user/:userId/logout', (req, res) => {
  const userId = req.params.userId;
  const session = sessions.sessions.get(userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  if (session.action_task && !session.action_task.done) { session.stop_event.set(); }
  sessions.sessions.delete(userId);
  res.json({ success: true });
});

// ---------------------------------------------------------------------------
// Clan War routes
// ---------------------------------------------------------------------------

async function buildCurrentClanWarSnapshot(settings, forceRefreshToken = false) {
  return buildClanWarSnapshot(settings, { forceRefreshToken });
}

function makeClanWarStateCallback(session) {
  return (updates) => {
    const liveState = getClanWarState(session);
    if ('snapshot' in updates) liveState.snapshot = updates.snapshot;
    if ('running' in updates) liveState.running = !!updates.running;
    if ('captcha_required' in updates) { liveState.captcha_required = !!updates.captcha_required; liveState.captcha_challenge = null; }
    if ('captcha_message' in updates) liveState.captcha_message = String(updates.captcha_message || '');
  };
}

async function startClanWarTask(userId, session, settings, startFromWarListOnly = false) {
  const stateCallback = makeClanWarStateCallback(session);
  session.stop_event.clear();
  session.clan_war_captcha_resume.clear();
  const task = { done: false, action_name: 'Clan War', action_key: 'clan_war' };
  session.action_task = task;
  runAction(userId, () => clanWarEvent(settings, stateCallback, session.clan_war_captcha_resume, startFromWarListOnly), 'Clan War').finally(() => { task.done = true; });
}

app.get('/api/user/:userId/clan_war', (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  const state = getClanWarState(session);
  state.captcha_window_supported = false;
  const profile = sessionProfile(session);
  res.json({ success: true, base_game_id: session.base_game_id || config.getCurrentBaseGame().id, clan_url: profile.clan_url, ...state });
});

app.post('/api/user/:userId/clan_war/open', async (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  const state = getClanWarState(session);
  try {
    const snapshot = await runInSession(session, () => buildCurrentClanWarSnapshot(state.settings, true));
    state.snapshot = snapshot;
  } catch (exc) {
    res.json({ success: false, error: exc.message || String(exc) });
    return;
  }
  state.current_target = { id: state.settings.target_clan_id || '', name: state.settings.target_clan_name || '' };
  state.captcha_required = false;
  state.captcha_message = '';
  state.captcha_window_supported = false;
  const profile = sessionProfile(session);
  res.json({ success: true, base_game_id: session.base_game_id || config.getCurrentBaseGame().id, clan_url: profile.clan_url, ...state });
});

app.post('/api/user/:userId/clan_war/config', (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  const state = getClanWarState(session);
  const merged = { ...(state.settings || {}) };
  for (const [k, v] of Object.entries(req.body || {})) if (v !== null && v !== undefined) merged[k] = v;
  state.settings = sanitizeClanWarSettings(merged);
  state.current_target = { id: state.settings.target_clan_id || '', name: state.settings.target_clan_name || '' };
  state.captcha_window_supported = false;
  const profile = sessionProfile(session);
  res.json({ success: true, base_game_id: session.base_game_id || config.getCurrentBaseGame().id, clan_url: profile.clan_url, ...state });
});

app.post('/api/user/:userId/clan_war/start', async (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  if (session.action_task && !session.action_task.done) { res.json({ success: false, error: 'Another action is already running' }); return; }
  const state = getClanWarState(session);
  const settings = sanitizeClanWarSettings(state.settings);
  if (!settings.target_clan_id) { res.json({ success: false, error: 'Please select a target clan first' }); return; }
  session.clan_war_modal_stop_only = false;
  state.running = true; state.captcha_required = false; state.captcha_message = ''; state.captcha_challenge = null; state.captcha_window_supported = false;
  state.current_target = { id: settings.target_clan_id || '', name: settings.target_clan_name || '' };
  startClanWarTask(session.user_id, session, settings, false);
  const profile = sessionProfile(session);
  res.json({ success: true, message: 'Started: Clan War', base_game_id: session.base_game_id || config.getCurrentBaseGame().id, clan_url: profile.clan_url, ...state });
});

app.post('/api/user/:userId/clan_war/stop', async (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  const state = getClanWarState(session);
  if (session.action_task && !session.action_task.done && session.action_task.action_key === 'clan_war') {
    session.stop_event.set();
    session.clan_war_captcha_resume.set();
    state.running = false; state.captcha_required = false; state.captcha_message = ''; state.captcha_challenge = null;
    session.addLog('Stopping Clan War from clan-war modal...', 'warning');
    await manager.sendStatus(session.user_id, { running: true, action: 'Clan War', stopping: true });
    const profile = sessionProfile(session);
    res.json({ success: true, message: 'Stopping Clan War... please wait', base_game_id: session.base_game_id || config.getCurrentBaseGame().id, clan_url: profile.clan_url, ...state });
    return;
  }
  res.json({ success: false, error: 'Clan War is not running' });
});

app.post('/api/user/:userId/clan_war/clear', (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  if (session.action_task && !session.action_task.done && session.action_task.action_key === 'clan_war') { res.json({ success: false, error: 'Stop Clan War from the modal before closing it' }); return; }
  session.clan_war_state = {};
  session.clan_war_modal_stop_only = false;
  const profile = sessionProfile(session);
  res.json({ success: true, base_game_id: session.base_game_id || config.getCurrentBaseGame().id, clan_url: profile.clan_url });
});

app.post('/api/user/:userId/clan_war/captcha_resume', (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  const state = getClanWarState(session);
  if (!state.captcha_required) { res.json({ success: false, error: 'Clan War is not waiting for captcha' }); return; }
  state.captcha_required = false; state.captcha_message = ''; state.captcha_challenge = null; state.running = true;
  session.clan_war_captcha_resume.set();
  session.addLog('Captcha marked solved. Clan War will resume...', 'success');
  const profile = sessionProfile(session);
  res.json({ success: true, message: 'Captcha marked solved. Resuming Clan War...', base_game_id: session.base_game_id || config.getCurrentBaseGame().id, clan_url: profile.clan_url, ...state });
});

app.post('/api/user/:userId/clan_war/captcha_window', (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  res.json({ success: false, error: 'Native captcha window is not available in the browser build' });
});

app.post('/api/user/:userId/clan_war/captcha_challenge', async (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  const state = getClanWarState(session);
  if (!state.captcha_required) { res.json({ success: false, error: 'Clan War is not waiting for captcha' }); return; }
  const [username, password] = resolveSessionQuickLoginCredentials(session);
  try {
    const result = await runInSession(session, () => ninjasagaAmfReq.generateCustomCaptcha(username, password));
    const challenge = result && typeof result === 'object' ? result.challenge : null;
    state.captcha_challenge = challenge && typeof challenge === 'object' ? challenge : null;
    state.captcha_debug = { generate_response: summarizeCaptchaDebug(result) };
    if (!result.success || !challenge || typeof challenge !== 'object') {
      res.json({ success: false, error: result.message || 'Failed to generate captcha challenge', debug: state.captcha_debug });
      return;
    }
    res.json({ success: true, message: result.message || 'Captcha challenge loaded', challenge, debug: state.captcha_debug, base_game_id: session.base_game_id || config.getCurrentBaseGame().id, ...state });
  } catch (exc) {
    res.json({ success: false, error: exc.message || String(exc) });
  }
});

app.post('/api/user/:userId/clan_war/captcha_verify', async (req, res) => {
  const session = session_get(req.params.userId);
  if (!session) { res.json({ success: false, error: 'Session not found' }); return; }
  const state = getClanWarState(session);
  if (!state.captcha_required) { res.json({ success: false, error: 'Clan War is not waiting for captcha' }); return; }
  const payload = req.body || {};
  const challengeId = String(payload.challenge_id || '');
  const answer = String(payload.answer || '');
  const hmac = String(payload.hmac || '');
  const mt = Array.isArray(payload.mt) ? payload.mt : [];
  if (!challengeId || !answer || !hmac) { res.json({ success: false, error: 'Missing captcha verification data' }); return; }
  try {
    const result = await runInSession(session, () => ninjasagaAmfReq.verifyCustomCaptcha(challengeId, answer, hmac, mt));
    state.captcha_debug = { verify_response: summarizeCaptchaDebug(result) };
    if (result.success) {
      try { await silentNinjasagaReloginAfterCaptcha(session); } catch { /* ignore */ }
      state.captcha_required = false; state.captcha_message = 'Waiting for moment...'; state.captcha_challenge = null; state.running = true;
      session.addLog('Waiting for moment...', 'info');
      restartClanWarAfterCaptcha(session.user_id).catch(() => {});
      const profile = sessionProfile(session);
      res.json({ success: true, message: result.message || 'Captcha solved. Waiting for moment...', debug: state.captcha_debug, base_game_id: session.base_game_id || config.getCurrentBaseGame().id, clan_url: profile.clan_url, ...state });
      return;
    }
    state.captcha_challenge = null;
    res.json({ success: false, message: result.message || 'Captcha verification failed', debug: state.captcha_debug, base_game_id: session.base_game_id || config.getCurrentBaseGame().id, ...state });
  } catch (exc) {
    res.json({ success: false, error: exc.message || String(exc) });
  }
});

async function restartClanWarAfterCaptcha(userId) {
  const session = session_get(userId);
  if (!session) return;
  const state = getClanWarState(session);
  const settings = sanitizeClanWarSettings(state.settings);
  state.running = true; state.captcha_required = false; state.captcha_message = ''; state.captcha_challenge = null;
  state.current_target = { id: settings.target_clan_id || '', name: settings.target_clan_name || '' };
  const oldTask = session.action_task;
  if (oldTask && !oldTask.done && oldTask.action_key === 'clan_war') {
    session.stop_event.set();
    session.clan_war_captcha_resume.set();
    while (session.action_task === oldTask && !oldTask.done) await new Promise((r) => setTimeout(r, 200));
  }
  state.running = true;
  startClanWarTask(userId, session, settings, false);
}

// ---------------------------------------------------------------------------
// HTTP + WebSocket server
// ---------------------------------------------------------------------------

const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (request, socket, head) => {
  const match = request.url && request.url.match(/^\/ws\/([^/?]+)/);
  if (!match) { socket.destroy(); return; }
  const userId = decodeURIComponent(match[1]);
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit('connection', ws, request, userId);
  });
});

wss.on('connection', async (ws, request, userId) => {
  manager.connect(userId, ws);
  const session = session_get(userId);
  if (session) {
    await manager.sendLog(userId, { timestamp: new Date().toTimeString().slice(0, 8), message: '🟢 Connected to server', type: 'success' });
    for (const log of session.logs.slice(-50)) await manager.sendLog(userId, log);
  }
  let pingTimer = setInterval(() => {
    try { ws.send(JSON.stringify({ type: 'ping' })); } catch { /* ignore */ }
  }, 30000);
  ws.on('close', () => { clearInterval(pingTimer); manager.disconnect(userId); });
  ws.on('error', () => { clearInterval(pingTimer); manager.disconnect(userId); });
});

sessions.startCleanupLoop();

const PORT = Number.parseInt(process.env.PORT || '8000', 10);
const HOST = process.env.HOST || '127.0.0.1';
server.listen(PORT, HOST, () => {
  console.log(`SANS PANEL listening on http://${HOST}:${PORT}`);
});

export { app, server };
