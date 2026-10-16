// Port of desktop_app/core/ninjasaga/amf_req.py
import crypto from 'node:crypto';

import config from '../config.js';
import { HttpSession } from '../shared/amf.js';
import { encodeRequest, decodeRemoting } from '../shared/amf.js';
import { aesEcbDecryptRaw, sha1Hex } from '../shared/crypto.js';
import { sendAmfRequest } from '../shared/utils.js';
import * as clientCrypto from './clientCrypto.js';
import * as missionPolicy from './missionPolicy.js';

const logger = console;

export const CHECK_VERSION_METHODS = ['SystemService.checkVersion', 'SystemLogin.checkVersion'];
export const LOGIN_METHOD = 'SystemService.login';
export const REQUIRE_LOGIN_METHOD = 'SystemService.requireLogin';
export const SNS_LOGIN_METHOD = 'SystemService.snsLogin';
export const GET_CHARACTERS_METHOD = 'CharacterDAO.getCharactersList';
export const GET_CHARACTER_METHOD = 'CharacterDAO.getCharacterById';
export const GET_EXTRA_DATA_METHOD = 'CharacterDAO.getExtraData';
export const GET_SYSTEM_DATA_METHOD = 'SystemData.get';
export const CHECK_AMF_METHOD = 'SystemService.checkAmf';
export const START_MISSION_METHOD = 'CharacterService.startMission';
export const WATCH_SJE_NOTICE_METHOD = 'CharacterDAO.watchSJENotice';
export const START_SJ_EXAM_METHOD = 'CharacterService.startSJExam';
export const NT_EXAM_NOTICE_METHOD = 'CharacterDAO.NTExamNotice';
export const START_NT_EXAM_METHOD = 'CharacterService.startNTExam';
export const UPDATE_CHARACTER_METHOD = 'CharacterService.updateCharacter';
export const GET_HUNTING_STATUS_METHOD = 'EudemonGarden.getHuntingStatus';
export const START_HUNTING_METHOD = 'EudemonGarden.startHunting';
export const FINISH_HUNTING_METHOD = 'EudemonGarden.finishHunting';
export const BUY_HUNTING_TIME_METHOD = 'EudemonGarden.buyHuntingTime';
export const EASTER_GET_BATTLE_STATUS_METHOD = 'EasterFestival2015.getBattleStatus';
export const EASTER_START_BATTLE_METHOD = 'EasterFestival2015.startBattle';
export const EASTER_OPEN_TREASURE_METHOD = 'EasterFestival2015.openTreasure';
export const EASTER_GENERATE_NEW_MAP_METHOD = 'EasterFestival2015.generateNewMap';
export const EASTER_BUY_BATTLE_HEART_METHOD = 'EasterFestival2015.buyBattleHeart';
export const EASTER_RECORD_POSITION_METHOD = 'EasterFestival2015.recordNowPostion';
export const ITEM_GET_BOSS_REWARD_METHOD = 'ItemDAO.getBossReward';
export const CHARACTER_BUY_ITEM_METHOD = 'CharacterDAO.buyItem';
export const MOTHERDAY_GET_SPECIAL_BATTLE_STATUS_METHOD = 'MothersDay2016.getSpecialBattleStatus';
export const SAKURA_GET_STATUS_METHOD = 'SakuraEvent.getAnniChallengeStatus';
export const SAKURA_BUY_PETAL_METHOD = 'SakuraEvent.buyPetal';
export const SAKURA_REFILL_ENERGY_METHOD = 'SakuraEvent.refillChallengeEnergy';
export const HALLOWEEN_GET_BATTLE_STATUS_METHOD = 'HalloweenEvent2016.getBattleStatus';
export const HALLOWEEN_START_BATTLE_METHOD = 'HalloweenEvent2016.startBattle';
export const HALLOWEEN_EVENT_MODE = 'token';
export const SJ_CLASS_SELECT_METHOD = 'CharacterDAO.SJClassSelect';
export const NT_CLASS_SELECT_METHOD = 'CharacterDAO.NTClassSelect';

export const NINJASAGA_CODEC = '85224034668';
export const CLIENT_LIBRARY_SALT = 'Vmn34aAciYK00Hen26nT01';
export const NINJASAGA_DEFAULT_CLS = '434106';
export const WEB_ORIGIN = 'https://ninjasaga.cc';
export const WEB_API_ORIGIN = 'https://api.ninjasaga.cc';
export const WEB_LOGIN_ENDPOINT = `${WEB_API_ORIGIN}/login`;
export const WEB_REFERER = 'https://ninjasaga.cc/emulator.html';
export const WEB_HOME = 'https://ninjasaga.cc/';
export const WEB_AIR_SHELL_URL = 'https://ninjasaga.cc/?minimal&air&noreauth=1';
export const WEB_CUSTOM_CAPTCHA_GENERATE_ENDPOINT = `${WEB_API_ORIGIN}/custom-captcha/generate`;
export const WEB_CUSTOM_CAPTCHA_VERIFY_ENDPOINT = `${WEB_API_ORIGIN}/verify-captcha`;
export const WEB_LOGIN_ENDPOINTS = [
  WEB_LOGIN_ENDPOINT,
  'https://ninjasaga.cc/api.php/login',
  'https://ninjasaga.cc/api.php?action=login',
  'https://ninjasaga.cc/api.php?route=login',
  'https://ninjasaga.cc/api.php',
];

const _PRIMARY_CONFIG = [75, 126, 53, 58, 71, 116, 50, 91, 46, 44, 115, 36];
const _STREAM_IDENTIFIER = [61, 64, 56, 54, 87, 117, 116];
const _ASSET_LOADER_DATA = [73, 110, 61, 90, 98, 68, 93, 79, 125, 89, 70, 104, 38, 103, 94, 89, 107, 118];

const _HEX_RE = /^[0-9a-fA-F]+$/;
const _CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]+/g;
const _SESSION_TOKEN_RE = /sid_ns_[A-Za-z0-9_]+/g;

const _SENSITIVE_KEYS = new Set([
  'password', 'token', 'access_token', 'signature', 'fb_sig', 'fb_at', 'sessionkey', 'session_key', 'session',
]);

function deriveZendamfKey() {
  const keySeed =
    String.fromCharCode(..._PRIMARY_CONFIG) +
    String.fromCharCode(..._ASSET_LOADER_DATA) +
    String.fromCharCode(...[..._STREAM_IDENTIFIER].reverse());
  return Buffer.from(keySeed, 'ascii').subarray(0, 16);
}

const _ZENDAMF_AES_KEY = deriveZendamfKey();

export function _ensureNinjasagaState() {
  let state = config.ninjasagaState;
  if (!state || typeof state !== 'object') {
    state = {};
    config.ninjasagaState = state;
  }
  if (!state.codec) state.codec = NINJASAGA_CODEC;
  if (!state.client_uuid) state.client_uuid = crypto.randomUUID();
  if (!state.cls) state.cls = NINJASAGA_DEFAULT_CLS;
  return state;
}

function encryptClientValue(value) {
  return sha1Hex(`${value}${CLIENT_LIBRARY_SALT}`);
}

export function generateHash(seed, payload) {
  return sha1Hex(`${payload}${CLIENT_LIBRARY_SALT}${seed}`);
}

export function getLoginHash(challenge, source) {
  return generateHash(challenge, source);
}

export function getHash(sessionKey, payload) {
  return generateHash(sessionKey || '', payload || '');
}

export function getArrayHash(sessionKey, values) {
  const serialized = values.map((v) => (v === null || v === undefined ? '' : String(v))).join(',');
  return getHash(sessionKey, serialized);
}

function nextSequenceValue() {
  const current = Number.parseInt(config.CLASSIC_REQUEST_SEQ || 0, 10) || 0;
  config.CLASSIC_REQUEST_SEQ = current + 1;
  return String(config.CLASSIC_REQUEST_SEQ);
}

function nextSequenceHash() {
  return getHash(sessionKey(), nextSequenceValue());
}

export function nextSequenceState() {
  const nextValue = nextSequenceValue();
  const seqInt = Number.parseInt(config.CLASSIC_REQUEST_SEQ || 0, 10) || 0;
  return [seqInt, nextValue, getHash(sessionKey(), nextValue)];
}

function isEncryptedHexString(value) {
  if (typeof value !== 'string') return false;
  if (value.length < 32 || value.length % 32 !== 0) return false;
  return _HEX_RE.test(value);
}

function aesDecryptHex(hexCiphertext) {
  try {
    const data = Buffer.from(hexCiphertext, 'hex');
    const decrypted = aesEcbDecryptRaw(_ZENDAMF_AES_KEY, data);
    const nullIndex = decrypted.indexOf(0);
    const trimmed = nullIndex >= 0 ? decrypted.subarray(0, nullIndex) : decrypted;
    return trimmed.toString('latin1');
  } catch {
    return null;
  }
}

function sanitizeText(value) {
  if (typeof value !== 'string') return value;
  return value.replace(_CONTROL_CHARS_RE, '').trim();
}

function sanitizeStructure(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeStructure);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[sanitizeText(key)] = sanitizeStructure(item);
    }
    return out;
  }
  return value;
}

function isDebugEnabled() {
  return !!(config.ninjasagaDebug);
}

function maskSecret(value) {
  const raw = String(value ?? '');
  if (raw.length <= 8) return '***';
  return `${raw.slice(0, 4)}...${raw.slice(-4)}`;
}

function redactString(value) {
  const masked = value.replace(_SESSION_TOKEN_RE, (m) => maskSecret(m));
  if (masked.length > 260) {
    return `${masked.slice(0, 200)}...(truncated ${masked.length - 200} chars)`;
  }
  return masked;
}

function redactForDebug(value, keyHint = null) {
  if (Array.isArray(value)) return value.map((item) => redactForDebug(item, keyHint));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      out[key] = redactForDebug(item, String(key).toLowerCase());
    }
    return out;
  }
  if (typeof value === 'string') {
    if (keyHint && _SENSITIVE_KEYS.has(keyHint)) return maskSecret(value);
    return redactString(value);
  }
  return value;
}

function debugLog(event, payload) {
  if (!isDebugEnabled()) return;
  try {
    const safePayload = redactForDebug(payload);
    const message = `[NinjaSaga debug] ${event} | ${JSON.stringify(safePayload)}`;
    logger.info(message);
    const state = _ensureNinjasagaState();
    if (!Array.isArray(state.debug_events)) state.debug_events = [];
    state.debug_events.push(message);
    if (state.debug_events.length > 200) state.debug_events = state.debug_events.slice(-200);
  } catch {
    const fallback = `[NinjaSaga debug] ${event} | <unserializable>`;
    logger.info(fallback);
  }
}

function decryptValueAndRestoreType(hexCiphertext) {
  let decryptedText = aesDecryptHex(hexCiphertext);
  if (decryptedText === null) return '[DECRYPTION_FAILED]';
  decryptedText = sanitizeText(decryptedText);
  try {
    return sanitizeStructure(JSON.parse(decryptedText));
  } catch {
    return decryptedText;
  }
}

function decryptAmfResponse(value) {
  if (typeof value === 'string') {
    if (isEncryptedHexString(value)) return decryptValueAndRestoreType(value);
    return sanitizeText(value);
  }
  if (Array.isArray(value)) return value.map(decryptAmfResponse);
  if (value && typeof value === 'object') {
    const decrypted = {};
    for (const [key, itemValue] of Object.entries(value)) {
      let keyName = sanitizeText(key);
      if (isEncryptedHexString(key)) {
        const decryptedKey = aesDecryptHex(key);
        if (decryptedKey) keyName = sanitizeText(decryptedKey);
      }
      decrypted[keyName] = decryptAmfResponse(itemValue);
    }
    if (Object.keys(decrypted).length === 0) return [];
    return decrypted;
  }
  return value;
}

function ninjasagaHttpSession() {
  const state = _ensureNinjasagaState();
  if (state.http_session instanceof HttpSession) return state.http_session;
  const session = new HttpSession({
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    Accept: '*/*',
  });
  state.http_session = session;
  return session;
}

async function postAmfNinjasagaBytes(service, params) {
  const state = _ensureNinjasagaState();
  const session = ninjasagaHttpSession();
  const prepared = Array.isArray(params) ? [...params] : [params];
  const payload = encodeRequest(service, prepared);

  const headers = {
    'Content-Type': 'application/x-amf',
    Origin: WEB_ORIGIN,
    Referer: state.emulator_referer || WEB_REFERER,
  };

  const resp = await session.post(config.GATEWAY, { body: payload, headers, timeout: 25000 });
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  const bodyBuf = Buffer.from(await resp.arrayBuffer());
  const prefixText = bodyBuf.subarray(0, 120).toString('latin1');

  if (resp.status >= 400 || contentType.includes('text/html') || prefixText.trimStart().startsWith('<!DOCTYPE html')) {
    throw new Error(`AMF gateway returned HTTP ${resp.status} with content-type ${contentType || 'unknown'}`);
  }
  return bodyBuf;
}

async function postAmfNinjasaga(service, params) {
  const bodyBuf = await postAmfNinjasagaBytes(service, params);
  try {
    return decodeRemoting(bodyBuf).bodies[0]?.data;
  } catch (exc) {
    throw new Error(`Failed to decode NinjaSaga AMF response: ${exc.message}`);
  }
}

function looksLikeFault(obj) {
  if (obj === null || obj === undefined || typeof obj !== 'object') return false;
  const cls = (obj.__class || '').toLowerCase();
  return cls.includes('fault') || cls.includes('errorfault');
}

function faultToText(faultObj) {
  const parts = [];
  for (const attr of ['level', 'code', 'description', 'faultString', 'details', 'message']) {
    const value = faultObj?.[attr];
    if (value) parts.push(`${attr}=${value}`);
  }
  if (!parts.length) return String(faultObj);
  return parts.join(', ');
}

function webLoginPayload(username, password) {
  const state = _ensureNinjasagaState();
  return {
    username,
    password,
    minimal: '0',
    air: '0',
    w: '1920',
    h: '1080',
    tz: 'Asia/Makassar',
    cpu: '12',
    ram: '8',
    browser_ver: 'Chrome 146',
    uuid: state.client_uuid,
    gpu: 'ANGLE (AMD, AMD Radeon Graphics, D3D11)',
  };
}

async function warmupWebSession(session) {
  const warmupHeaders = {
    Origin: WEB_ORIGIN,
    Referer: WEB_HOME,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  try { await session.get(WEB_HOME, { headers: warmupHeaders, timeout: 25000 }); } catch { /* ignore */ }
  try { await session.get(`${WEB_ORIGIN}/emulator.html`, { headers: warmupHeaders, timeout: 25000 }); } catch { /* ignore */ }
}

export async function syncAirShellAfterCaptcha() {
  const state = _ensureNinjasagaState();
  const session = ninjasagaHttpSession();
  const headers = {
    Origin: WEB_ORIGIN,
    Referer: WEB_HOME,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  };
  const results = [];
  for (let idx = 0; idx < 2; idx++) {
    const resp = await session.get(WEB_AIR_SHELL_URL, { headers, timeout: 25000 });
    results.push({
      step: idx + 1,
      status_code: resp.status,
      url: resp.url,
      content_type: (resp.headers.get('content-type') || '').toLowerCase(),
      body_preview: await safeBodySnippet(resp),
    });
  }
  state.last_air_shell_sync = results;
  debugLog('air_shell.sync', results);
  return { success: true, results };
}

async function safeBodySnippet(resp, limit = 220) {
  let text = '';
  try { text = await resp.text(); } catch { text = ''; }
  return text.split(/\s+/).join(' ').slice(0, limit);
}

async function webLogin(username, password) {
  const state = _ensureNinjasagaState();
  const session = ninjasagaHttpSession();
  await warmupWebSession(session);

  const payload = webLoginPayload(username, password);
  debugLog('web_login.request_payload', payload);

  const attempts = [];
  for (const endpoint of WEB_LOGIN_ENDPOINTS) {
    attempts.push([endpoint, {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      Origin: WEB_ORIGIN,
      Referer: WEB_HOME,
      'X-Requested-With': 'XMLHttpRequest',
    }, 'json']);
    attempts.push([endpoint, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      Accept: 'application/json, text/plain, */*',
      Origin: WEB_ORIGIN,
      Referer: WEB_HOME,
      'X-Requested-With': 'XMLHttpRequest',
    }, 'form']);
  }

  let lastError = null;
  let result = null;
  for (const [endpoint, headers, mode] of attempts) {
    let resp;
    try {
      if (mode === 'json') {
        resp = await session.post(endpoint, { headers, timeout: 25000, body: JSON.stringify(payload) });
      } else {
        const form = new URLSearchParams(payload).toString();
        resp = await session.post(endpoint, { headers, timeout: 25000, body: form });
      }
    } catch (exc) {
      lastError = `NinjaSaga web login request failed on ${endpoint}: ${exc.message}`;
      debugLog('web_login.attempt_error', { endpoint, error: exc.message });
      continue;
    }
    const contentType = (resp.headers.get('content-type') || '').toLowerCase();
    const bodyText = await resp.text().catch(() => '');
    const bodyPreview = bodyText.split(/\s+/).join(' ').slice(0, 220);
    debugLog('web_login.attempt_result', { endpoint, status_code: resp.status, content_type: contentType, body_preview: bodyPreview });

    if (resp.status >= 400) {
      lastError = `NinjaSaga web login failed on ${endpoint} with HTTP ${resp.status} (content-type ${contentType || 'unknown'}) body: ${bodyPreview}`;
      continue;
    }
    if (!contentType.includes('application/json') && !bodyPreview.startsWith('{')) {
      lastError = `NinjaSaga web login returned non-JSON response on ${endpoint} (${contentType || 'unknown'}) body: ${bodyPreview}`;
      continue;
    }
    let parsed;
    try {
      parsed = JSON.parse(bodyText);
    } catch {
      lastError = `NinjaSaga web login JSON parse failed on ${endpoint} (content-type ${contentType || 'unknown'}) body: ${bodyPreview}`;
      continue;
    }
    if (!parsed || typeof parsed !== 'object' || !parsed.success) {
      lastError = `NinjaSaga web login rejected credentials/request on ${endpoint}: ${JSON.stringify(parsed)}`;
      continue;
    }
    state.web_login_endpoint = endpoint;
    result = parsed;
    break;
  }

  if (result === null) {
    throw new Error(lastError || 'NinjaSaga web login failed for unknown reason');
  }

  state.web_login = result;
  state.web_auth_token = String(result.token || '');
  debugLog('web_login.success', result);
  const playerId = String(result.player_id || '');
  const fbAt = String(result.token || '');
  const fbSig = String(result.signature || '');
  const hashTime = String(result.hash_time || '');
  state.emulator_referer =
    `${WEB_REFERER}?fb_uid=${playerId}&fb_name=${result.username || ''}` +
    `&fb_at=${fbAt}&fb_sig=${fbSig}&time=0&hash_time=${hashTime}`;
  return result;
}

function webApiHeaders() {
  const state = _ensureNinjasagaState();
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/plain, */*',
    Origin: WEB_ORIGIN,
    Referer: WEB_HOME,
    'X-Requested-With': 'XMLHttpRequest',
  };
  const authToken = String(state.web_auth_token || '');
  if (authToken) headers.Authorization = `Bearer ${authToken}`;
  return headers;
}

async function webApiCall(endpoint, payload, username = '', password = '') {
  const state = _ensureNinjasagaState();
  const session = ninjasagaHttpSession();

  if (username && password) {
    await webLogin(username, password);
  } else {
    await warmupWebSession(session);
  }

  const requestPayload = { ...(payload || {}) };
  if (requestPayload.uuid === undefined) requestPayload.uuid = state.client_uuid;
  const headers = webApiHeaders();
  debugLog('web_api.request', { endpoint, payload: requestPayload });
  const resp = await session.post(endpoint, { body: JSON.stringify(requestPayload), headers, timeout: 30000 });
  const contentType = (resp.headers.get('content-type') || '').toLowerCase();
  const bodyText = await resp.text().catch(() => '');
  const bodyPreview = bodyText.split(/\s+/).join(' ').slice(0, 220);

  let result;
  try {
    result = JSON.parse(bodyText);
  } catch (exc) {
    throw new Error(
      `NinjaSaga web API JSON parse failed on ${endpoint} (status=${resp.status} content-type=${contentType || 'unknown'}) body: ${bodyPreview}`
    );
  }
  if (resp.status >= 400) {
    throw new Error(`NinjaSaga web API failed on ${endpoint} (status=${resp.status}) message: ${result.message || bodyPreview}`);
  }
  if (!result || typeof result !== 'object') {
    throw new Error(`NinjaSaga web API returned unexpected payload on ${endpoint}: ${JSON.stringify(result)}`);
  }
  return result;
}

export function generateCustomCaptcha(username = '', password = '') {
  return webApiCall(WEB_CUSTOM_CAPTCHA_GENERATE_ENDPOINT, {}, username, password);
}

export function verifyCustomCaptcha(challengeId, answer, hmac, mt = null, username = '', password = '') {
  return webApiCall(
    WEB_CUSTOM_CAPTCHA_VERIFY_ENDPOINT,
    { challenge_id: String(challengeId || ''), answer: String(answer || ''), hmac: String(hmac || ''), mt: Array.isArray(mt) ? mt : [] },
    username,
    password
  );
}

async function callService(method, args) {
  debugLog('amf.request', { method, args });
  let response;
  try {
    response = await postAmfNinjasaga(method, args);
  } catch (exc) {
    response = await sendAmfRequest(config, method, args);
    debugLog('amf.transport_fallback', { method, error: exc.message || String(exc) });
  }
  debugLog('amf.response.raw', { method, response });
  const decrypted = decryptAmfResponse(response);
  debugLog('amf.response.decrypted', { method, response: decrypted });
  return decrypted;
}

export function sessionKey() {
  if (!config.loginData || typeof config.loginData !== 'object') return '';
  const loginData = config.loginData;
  const value = loginData.sessionkey || loginData.session_key || loginData.session;
  if (value) return String(value);
  const result = loginData.result;
  if (Array.isArray(result) && result.length > 3) return String(result[3] || '');
  return '';
}

function normalizeLoginPayload(response) {
  const result = response.result;
  if (Array.isArray(result)) {
    if (result.length > 0 && response.uid === undefined) response.uid = result[0];
    if (result.length > 1 && response.account_type === undefined) response.account_type = result[1];
    if (result.length > 2 && response.account_balance === undefined) response.account_balance = result[2];
    if (result.length > 3 && response.sessionkey === undefined) response.sessionkey = result[3];
  }
  return response;
}

function normalizeCharacterEntry(item, index = 0) {
  if (Array.isArray(item)) {
    const charId = item.length > 0 ? item[0] : null;
    const charName = item.length > 1 && item[1] !== null ? item[1] : `Character ${index + 1}`;
    const charLevel = item.length > 2 && item[2] !== null ? item[2] : 0;
    return {
      character_id: charId, char_id: charId,
      character_name: String(charName), name: String(charName),
      character_level: charLevel, level: charLevel, raw: [...item],
    };
  }
  if (!item || typeof item !== 'object') {
    return {
      character_id: item, char_id: item,
      character_name: `Character ${index + 1}`, name: `Character ${index + 1}`,
      character_level: 0, level: 0,
    };
  }
  let charId = item.character_id ?? item.char_id ?? item.id;
  if (Array.isArray(charId)) charId = charId.length ? charId[0] : null;
  const charName = item.character_name || item.name || `Character ${index + 1}`;
  const charLevel = item.character_level || item.level || 0;
  const normalized = { ...item };
  if (normalized.character_id === undefined) normalized.character_id = charId;
  if (normalized.char_id === undefined) normalized.char_id = charId;
  if (normalized.character_name === undefined) normalized.character_name = charName;
  if (normalized.name === undefined) normalized.name = charName;
  if (normalized.character_level === undefined) normalized.character_level = charLevel;
  if (normalized.level === undefined) normalized.level = charLevel;
  return normalized;
}

function normalizeCharactersPayload(result) {
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    let rows = result.account_data;
    if (!Array.isArray(rows)) rows = result.characters;
    if (!Array.isArray(rows)) rows = Array.isArray(result.result) ? result.result : [];
    const normalized = (rows || []).map((row, idx) => normalizeCharacterEntry(row, idx));
    if (result.account_data === undefined) result.account_data = normalized;
    if (result.characters === undefined) result.characters = normalized;
    return result;
  }
  if (Array.isArray(result)) {
    const normalized = result.map((row, idx) => normalizeCharacterEntry(row, idx));
    return { account_data: normalized, characters: normalized, status: 1 };
  }
  return { account_data: [], characters: [], status: 0, error: result };
}

export async function checkVersion() {
  const state = _ensureNinjasagaState();
  for (const method of CHECK_VERSION_METHODS) {
    let result;
    try {
      result = await callService(method, [config.BUILD_NUM]);
    } catch {
      continue;
    }
    if (result && typeof result === 'object' && !Array.isArray(result)) {
      if (result._ === undefined) result._ = config.BUILD_NUM;
      if (result.__ === undefined) result.__ = '';
      if (result.codec === undefined) result.codec = NINJASAGA_CODEC;
      if (!('status' in result)) result.status = 1;
      config.gameData = result;
      state.build_num = result._ ?? config.BUILD_NUM;
      return result;
    }
  }

  const result = {
    status: 1,
    _: config.BUILD_NUM,
    __: '',
    codec: NINJASAGA_CODEC,
    warning: 'NinjaSaga checkVersion endpoint/codec is not fully mapped yet.',
  };
  config.gameData = result;
  state.build_num = config.BUILD_NUM;
  return result;
}

async function runPostLoginBootstrap(loginData) {
  const state = _ensureNinjasagaState();
  const sk = loginData.sessionkey || loginData.session_key || loginData.session;
  if (sk) state.session_key = String(sk);

  const cls = String(state.cls || NINJASAGA_DEFAULT_CLS);
  const clsHash = getHash(String(sk || ''), cls);
  state.cls_hash = clsHash;
  state.salt = CLIENT_LIBRARY_SALT;

  try {
    const checkAmfResult = await callService(CHECK_AMF_METHOD, [config.BUILD_NUM, cls, clsHash, String(sk || '')]);
    state.check_amf_result = checkAmfResult;
    debugLog('check_amf.completed', { build_no: config.BUILD_NUM, cls, cls_hash: clsHash, result: checkAmfResult });
  } catch (exc) {
    state.check_amf_error = String(exc.message || exc);
    debugLog('check_amf.error', { error: String(exc.message || exc) });
  }
}

export async function login(username, password, charDot__ = '', charDotUnderscore = '') {
  const state = _ensureNinjasagaState();
  const webAuth = await webLogin(username, password);

  const fbUid = String(webAuth.player_id || '');
  const fbAt = String(webAuth.token || '');
  const fbSig = String(webAuth.signature || '');
  const hashTime = String(webAuth.hash_time || '');
  const appType = 'facebook';
  const lang = String((webAuth.session || {}).language || 'en');
  const buildNo = String(config.BUILD_NUM);
  const reqTime = 0;
  const fbUidArg = /^\d+$/.test(fbUid) ? Number.parseInt(fbUid, 10) : fbUid;

  state.access_token = fbAt;
  state.fb_uid = fbUid;
  state.fb_sig = fbSig;
  state.hash_time = hashTime;
  state.app_type = appType;
  state.lang = lang;

  const requireLoginArgs = [reqTime, hashTime, fbUidArg];
  const requireLoginResult = await callService(REQUIRE_LOGIN_METHOD, requireLoginArgs);
  if (looksLikeFault(requireLoginResult)) throw new Error(`NinjaSaga requireLogin fault: ${faultToText(requireLoginResult)}`);
  if (!requireLoginResult || typeof requireLoginResult !== 'object' || String(requireLoginResult.status) !== '1') {
    throw new Error(`NinjaSaga requireLogin failed: ${JSON.stringify(requireLoginResult)}`);
  }

  const challenge = String(requireLoginResult.result || requireLoginResult.challenge || '');
  const loginSource = `${challenge}${fbUid}${appType}${buildNo}${state.codec || NINJASAGA_CODEC}`;
  const loginHash = getLoginHash(challenge, loginSource);
  debugLog('login.require_login', { args: requireLoginArgs, response: requireLoginResult, challenge, login_hash: loginHash });

  let result = await callService(SNS_LOGIN_METHOD, [fbUidArg, appType, buildNo, challenge, loginHash, fbSig, fbAt, lang]);
  debugLog('login.sns_login_result', result);
  if (looksLikeFault(result)) throw new Error(`NinjaSaga snsLogin fault: ${faultToText(result)}`);
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    result = normalizeLoginPayload(result);
    if (!('status' in result)) result.status = 1;
    if (String(result.status) === '1') {
      if (result.uid === undefined) result.uid = fbUid;
      if (result.access_token === undefined) result.access_token = fbAt;
      if (result.fb_sig === undefined) result.fb_sig = fbSig;
      await runPostLoginBootstrap(result);
    }
  }
  return result;
}

export async function getAllCharacters() {
  const sk = sessionKey();
  const result = await callService(GET_CHARACTERS_METHOD, [sk]);
  const normalized = normalizeCharactersPayload(result);
  config.allChar = normalized;
  return normalized;
}

export function getSystemData(testVersion = false) {
  const sk = sessionKey();
  return callService(GET_SYSTEM_DATA_METHOD, [sk, !!testVersion]);
}

export async function getExtraData(charId) {
  const sk = sessionKey();
  const state = _ensureNinjasagaState();
  const accessToken = state.access_token || '';
  const cselKey = state.csel_key || '';
  const xpHash = getHash(sk, String(state.char_xp || 0));
  let result;
  if (cselKey) {
    try {
      result = await callService(GET_EXTRA_DATA_METHOD, [sk, xpHash, accessToken, cselKey]);
    } catch {
      result = await callService(GET_EXTRA_DATA_METHOD, [sk, charId, accessToken]);
    }
  } else {
    try {
      result = await callService(GET_EXTRA_DATA_METHOD, [sk, charId, accessToken]);
    } catch {
      result = await callService(GET_EXTRA_DATA_METHOD, [sk, charId]);
    }
  }
  if (result && typeof result === 'object' && result.result && typeof result.result === 'object') {
    const extra = result.result;
    state.dvx = extra.m7v !== null && extra.m7v !== undefined ? String(extra.m7v) : '';
    state.egv = extra.q7t !== null && extra.q7t !== undefined ? String(extra.q7t) : '';
    state.csv = extra.csx !== null && extra.csx !== undefined ? String(extra.csx) : '';
    state.slv = extra.slx !== null && extra.slx !== undefined ? String(extra.slx) : '';
    state.ivg = extra.z9t !== null && extra.z9t !== undefined ? String(extra.z9t) : '';
    try {
      state.kq = clientCrypto.buildKq(extra);
    } catch {
      state.kq = [];
    }
    state.extra_data = extra;
  }
  return result;
}

export async function getCharacterData(charId, includeSystemData = true, includeExtraData = true) {
  const sk = sessionKey();
  const state = _ensureNinjasagaState();
  let normalizedCharId = charId;
  if (Array.isArray(normalizedCharId)) normalizedCharId = normalizedCharId.length ? normalizedCharId[0] : null;

  let result;
  try {
    result = await callService(GET_CHARACTER_METHOD, [sk, normalizedCharId]);
  } catch {
    result = await callService(GET_CHARACTER_METHOD, [normalizedCharId, sk]);
  }

  let payload;
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    payload = { ...result };
    if (!(payload.character_name || payload.name) && Array.isArray(payload.result)) {
      const merged = normalizeCharacterEntry(payload.result, 0);
      Object.assign(merged, payload);
      payload = merged;
    }
  } else if (Array.isArray(result)) {
    payload = normalizeCharacterEntry(result, 0);
    payload.status = 1;
    payload.result = [...result];
  } else {
    payload = { status: 0, error: result };
  }

  const gp = payload.gk !== undefined && payload.gk !== null ? String(payload.gk) : '';
  if (gp) state.csel_key = gp;
  const xpRaw = payload.result && typeof payload.result === 'object' && payload.result.character_xp != null
    ? payload.result.character_xp
    : (payload.character_xp != null ? payload.character_xp : 0);
  const xpParsed = Number.parseInt(xpRaw, 10);
  state.char_xp = Number.isNaN(xpParsed) ? 0 : xpParsed;

  if (includeSystemData) {
    try { payload.system_data = await getSystemData(false); } catch (exc) { payload.system_data_error = String(exc.message || exc); }
  }
  if (includeExtraData) {
    try { payload.extra_data = await getExtraData(normalizedCharId); } catch (exc) { payload.extra_data_error = String(exc.message || exc); }
  }

  config.charData = payload;
  return payload;
}

export async function startMission(missionId) {
  const sk = sessionKey();
  const state = _ensureNinjasagaState();
  const normalizedMissionId = String(missionId || '').trim().toLowerCase();
  if (!normalizedMissionId) throw new Error('Mission ID is required for CharacterService.startMission');
  const time = Math.floor(Date.now() / 1000);
  clientCrypto.missionSetState(state, normalizedMissionId);
  const missionHash = getHash(sk, normalizedMissionId);
  const blob1 = clientCrypto._msk(`${clientCrypto.gk(state, 0)}|${normalizedMissionId}|${time}`, sk);
  const blob2 = clientCrypto._msk(`${state.dvx || ''}|${normalizedMissionId}|${time}`, sk);
  debugLog('mission.start.request', { session_key: sk, mission_id: normalizedMissionId, mission_hash: missionHash, time });
  const response = await callService(START_MISSION_METHOD, [
    sk, normalizedMissionId, blob1, missionHash, time, blob2,
  ]);
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const startBattleId = response.startBattleId ?? response.start_battle_id;
    if (startBattleId !== undefined && startBattleId !== null) state.start_battle_id = String(startBattleId);
    state.cfn = response.csf !== undefined && response.csf !== null ? String(response.csf) : '';
    state.battle_log = clientCrypto._urk(`${clientCrypto.gk(state, 1)}|${state.cfn}`, sk);
    clientCrypto.missionAdvanceEvent(state);
  }
  return response;
}

export async function startSpecialJouninExam() {
  const response = await callService(START_SJ_EXAM_METHOD, [sessionKey()]);
  return response && typeof response === 'object' && !Array.isArray(response) ? response : { status: 0, result: response };
}

export async function watchSpecialJouninNotice() {
  const response = await callService(WATCH_SJE_NOTICE_METHOD, [sessionKey()]);
  return response && typeof response === 'object' && !Array.isArray(response) ? response : { status: 0, result: response };
}

export async function getTutorExamNotice() {
  const response = await callService(NT_EXAM_NOTICE_METHOD, [sessionKey()]);
  return response && typeof response === 'object' && !Array.isArray(response) ? response : { status: 0, result: response };
}

export async function startTutorExam() {
  const response = await callService(START_NT_EXAM_METHOD, [sessionKey()]);
  return response && typeof response === 'object' && !Array.isArray(response) ? response : { status: 0, result: response };
}

export async function selectTutorClass() {
  const response = await callService(NT_CLASS_SELECT_METHOD, [sessionKey()]);
  return response && typeof response === 'object' && !Array.isArray(response) ? response : { status: 0, result: response };
}

export async function getSsTrainingMissionStatus() {
  const response = await callService('SSTraining.getMissionStatus', [sessionKey()]);
  return response && typeof response === 'object' && !Array.isArray(response) ? response : { status: 0, result: response };
}

export async function updateCharacterProgress(
  charId,
  charLevel,
  missionId,
  xpGain = 0,
  goldGain = 0,
  itemUsed = null,
  petId = 0,
  petLevel = 0,
  datafileHack = ''
) {
  const sk = sessionKey();
  const state = _ensureNinjasagaState();
  const normalizedItems = Array.isArray(itemUsed) ? itemUsed : [];
  let xpValue = Number.parseInt(xpGain || 0, 10) || 0;
  let goldValue = Number.parseInt(goldGain || 0, 10) || 0;
  if (xpValue <= 0) xpValue = missionPolicy.missionRewardValue(missionId, 'xp');
  if (goldValue <= 0) goldValue = missionPolicy.missionRewardValue(missionId, 'gold');
  const sequenceHash = clientCrypto.updateSequence();
  const stateHash = clientCrypto.missionCompleteState(state);

  const arrayHash = clientCrypto.getArrayHash(sk, [
    sk, charId, charLevel, xpValue, goldValue, normalizedItems, petId, petLevel, missionId, 0, stateHash,
  ]);

  const battleFlowLogver = String(state.battle_flow_logver || '1');
  const startBattleId = String(state.start_battle_id || '1');
  const battleLog = state.battle_log || '';
  const battleLogJson = JSON.stringify({ battles: [] });
  const battleLogHash = getHash(sk, `${battleFlowLogver}${startBattleId}${battleLogJson}`);
  const arg18 = clientCrypto.charUc(`${charId}|${xpValue}|${goldValue}|${missionId}|${startBattleId}`);
  const arg19 = clientCrypto._urk(`${state.egv || ''}|${state.cfn || ''}`, sk);

  const args = [
    sk, charId, charLevel, xpValue, goldValue, normalizedItems, petId, petLevel, missionId,
    arrayHash, sequenceHash, 0, stateHash, battleFlowLogver, battleLog, startBattleId, battleLogJson, battleLogHash,
    arg18, arg19,
  ];
  return callService(UPDATE_CHARACTER_METHOD, args);
}

export async function getHuntingStatus() {
  const response = await callService(GET_HUNTING_STATUS_METHOD, [sessionKey()]);
  const state = _ensureNinjasagaState();
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    state.hunt_q7 = response.q7 !== null && response.q7 !== undefined ? String(response.q7) : '';
    state.hunt_q7f = response.q7f !== null && response.q7f !== undefined ? String(response.q7f) : '';
  }
  return response;
}

export async function startHunting(roomIndex, enemyIds = null) {
  const sk = sessionKey();
  const roomValue = Number.parseInt(roomIndex, 10);
  const state = _ensureNinjasagaState();
  const normalizedEnemyIds = [];
  if (Array.isArray(enemyIds)) {
    for (const enemyId of enemyIds) {
      const value = String(enemyId || '').trim();
      if (value) normalizedEnemyIds.push(value);
    }
  }
  const enemyStr = normalizedEnemyIds.join(',');
  const requestHash = getHash(sk, `${roomValue}${enemyStr}`);

  const q7 = String(state.hunt_q7 || '');
  const q7f = String(state.hunt_q7f || '');
  const gk3 = clientCrypto.gk(state, 3);
  const egv = String(state.egv || '');
  const currBoss = q7 ? clientCrypto.huntBossToken(gk3, q7) : '';
  const loc7 = q7 ? clientCrypto.huntBossToken(egv, q7) : '';
  state.battle_log = q7f ? clientCrypto.huntBattleLog(gk3, q7f) : '';

  const result = await callService(START_HUNTING_METHOD, [sk, roomValue, currBoss, requestHash, loc7, enemyStr]);
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const startBattleId = result.startBattleId ?? result.start_battle_id ?? result.code;
    if (startBattleId !== undefined && startBattleId !== null) state.start_battle_id = String(startBattleId);
  }
  return result;
}

export async function finishHunting(
  roomIndex,
  itemUsed = null,
  resultFlag = 0,
  battleFlowLogver = '1',
  startBattleId = null,
  enemyIds = null
) {
  const sk = sessionKey();
  const roomValue = Number.parseInt(roomIndex, 10);
  const normalizedItems = Array.isArray(itemUsed) ? itemUsed : [];
  const resultValue = Number.parseInt(resultFlag, 10) || 0;

  const state = _ensureNinjasagaState();
  const startId = String(startBattleId || state.start_battle_id || '1');
  const flowVer = String(battleFlowLogver || state.battle_flow_logver || '1');
  const battleLog = String(state.battle_log || '');
  const battleLogJson = '{"battles":[]}';

  const huntingHash = getHash(sk, `${roomValue}${resultValue}`);
  const battleLogHash = getHash(sk, `${flowVer}${startId}${battleLogJson}`);
  const eh1 = clientCrypto.eh(`${roomValue}|0|${startId}`);

  const args = [
    sk, roomValue, normalizedItems, resultValue, huntingHash, flowVer,
    battleLog, startId, battleLogJson, battleLogHash, eh1, String(state.egv || ''),
  ];
  return callService(FINISH_HUNTING_METHOD, args);
}

export async function buyHuntingTime(roomIndex) {
  const sk = sessionKey();
  const roomValue = Number.parseInt(roomIndex, 10);
  const requestHash = getHash(sk, String(roomValue));
  return callService(BUY_HUNTING_TIME_METHOD, [sk, roomValue, requestHash]);
}

export function easterGetBattleStatus() {
  return callService(EASTER_GET_BATTLE_STATUS_METHOD, [sessionKey()]);
}

export async function easterRecordPosition(positionIndex) {
  const sk = sessionKey();
  const pos = String(Number.parseInt(positionIndex, 10));
  return callService(EASTER_RECORD_POSITION_METHOD, [sk, pos, getHash(sk, pos)]);
}

export async function easterOpenTreasure(positionIndex) {
  const sk = sessionKey();
  const pos = String(Number.parseInt(positionIndex, 10));
  return callService(EASTER_OPEN_TREASURE_METHOD, [sk, pos, getHash(sk, pos)]);
}

export async function easterStartBattle(enemyId, enemyPositionIndex, currentPositionIndex) {
  const sk = sessionKey();
  const enemy = String(enemyId || '').trim();
  const enemyPos = String(Number.parseInt(enemyPositionIndex, 10));
  const currentPos = String(Number.parseInt(currentPositionIndex, 10));
  const reqHash = getHash(sk, `${enemy}${enemyPos}${currentPos}`);
  const result = await callService(EASTER_START_BATTLE_METHOD, [sk, enemy, enemyPos, currentPos, reqHash]);
  const state = _ensureNinjasagaState();
  if (result && typeof result === 'object' && !Array.isArray(result)) {
    const startBattleId = result.startBattleId ?? result.start_battle_id ?? result.code;
    if (startBattleId !== undefined && startBattleId !== null) state.start_battle_id = String(startBattleId);
  }
  return result;
}

export function easterGenerateNewMap() {
  return callService(EASTER_GENERATE_NEW_MAP_METHOD, [sessionKey()]);
}

export async function easterBuyBattleHeart(amount) {
  const sk = sessionKey();
  const amountValue = Number.parseInt(amount, 10);
  return callService(EASTER_BUY_BATTLE_HEART_METHOD, [sk, amountValue, getHash(sk, String(amountValue))]);
}

export async function buyItem(itemId, amount = 1) {
  const sk = sessionKey();
  return callService(CHARACTER_BUY_ITEM_METHOD, [sk, String(itemId || '').trim(), Math.max(1, Number.parseInt(amount, 10) || 1)]);
}

export function motherdayGetSpecialBattleStatus() {
  return callService(MOTHERDAY_GET_SPECIAL_BATTLE_STATUS_METHOD, [sessionKey()]);
}

export function sakuraGetChallengeStatus() {
  return callService(SAKURA_GET_STATUS_METHOD, [sessionKey()]);
}

export function sakuraBuyPetal(amount) {
  return callService(SAKURA_BUY_PETAL_METHOD, [sessionKey(), Math.max(1, Number.parseInt(amount, 10) || 1)]);
}

export function sakuraRefillChallengeEnergy() {
  return callService(SAKURA_REFILL_ENERGY_METHOD, [sessionKey()]);
}

export async function getBossRewardEvent(
  bossId,
  resultFlag = 1,
  eventArray = null,
  battleFlowLogver = '1',
  startBattleId = null,
  battleLogJson = null
) {
  const sk = sessionKey();
  const state = _ensureNinjasagaState();

  const boss = String(bossId || '').trim();
  const resultValue = Number.parseInt(resultFlag, 10) || 0;
  const flowVer = String(battleFlowLogver || state.battle_flow_logver || '1');
  const startId = String(startBattleId || state.start_battle_id || '1');
  const eventValues = Array.isArray(eventArray) ? eventArray : ['token', 0];
  const eventSignatureData = eventValues.map((v) => String(v)).join(',');
  const signature = getHash(sk, `${boss}|${resultValue}|${eventSignatureData}`);

  const battleLog = battleLogJson || '{"battles":{"prototype":[],"length":1}}';
  const battleLogHash = getHash(sk, `${flowVer}${startId}${battleLog}`);

  const args = [sk, signature, boss, resultValue, eventValues, flowVer, startId, battleLog, battleLogHash];
  return callService(ITEM_GET_BOSS_REWARD_METHOD, args);
}

export function halloweenGetBattleStatus() {
  return callService(HALLOWEEN_GET_BATTLE_STATUS_METHOD, [sessionKey()]);
}

export async function halloweenStartBattle(enemyId) {
  const sk = sessionKey();
  const enemy = String(enemyId || '').trim();
  const response = await callService(HALLOWEEN_START_BATTLE_METHOD, [sk, enemy, getHash(sk, enemy)]);
  const state = _ensureNinjasagaState();
  if (response && typeof response === 'object' && !Array.isArray(response) && response.z9f != null) {
    state.ivn = String(response.z9f);
  }
  return response;
}

export async function halloweenClaimReward(bossId, z9f) {
  const sk = sessionKey();
  const state = _ensureNinjasagaState();
  const boss = String(bossId || '').trim();
  const flowVer = String(state.battle_flow_logver || '1');
  const startId = String(state.start_battle_id || '1');
  const eventValues = [HALLOWEEN_EVENT_MODE, 0];
  const signature = getHash(sk, `${boss}|0|${eventValues.join(',')}`);
  const battleLog = state.battle_log || '';
  const battleLogJson = '{"battles":[]}';
  const hash = getHash(sk, `${flowVer}${startId}${battleLogJson}`);
  const brToken = clientCrypto.br(`${boss}~0~${startId}`);
  const ivn = z9f !== undefined && z9f !== null ? String(z9f) : String(state.ivn || '');
  const k8 = clientCrypto._zrb(String(state.ivg || ''), ivn);
  const args = [
    sk, signature, boss, 0, eventValues, battleLog, flowVer, startId,
    battleLogJson, hash, brToken, k8,
  ];
  const response = await callService(ITEM_GET_BOSS_REWARD_METHOD, args);
  if (response && typeof response === 'object' && !Array.isArray(response) && response.z9f != null) {
    state.ivn = String(response.z9f);
  }
  return response;
}

export async function selectSpecialJouninClass(classIndex) {
  const sk = sessionKey();
  const classValue = Math.max(1, Math.min(5, Number.parseInt(classIndex, 10) || 1));
  return callService(SJ_CLASS_SELECT_METHOD, [sk, classValue]);
}

export const internals = {
  deriveZendamfKey,
  _ZENDAMF_AES_KEY,
  encryptClientValue,
  nextSequenceValue,
  isEncryptedHexString,
  aesDecryptHex,
  sanitizeText,
  sanitizeStructure,
  decryptAmfResponse,
  callService,
  normalizeCharacterEntry,
  normalizeCharactersPayload,
};
