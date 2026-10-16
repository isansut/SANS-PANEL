// Port of desktop_app/core/ninjasaga/clan_war.py
import zlib from 'node:zlib';

import config from '../config.js';
import * as amfReq from './amfReq.js';
import { sleep } from './rateControl.js';

export const CLAN_BATTLE_STAMINA_COST = 10;
export const CLAN_STAMINA_POLL_SECONDS = 5;
export const CLAN_IDLE_SECONDS = 10 * 60;
export const NINJASAGA_CLAN_WAR_DEFAULT_SETTINGS = {
  battle_delay_seconds: 6,
  refresh_delay_seconds: 3,
  buy_stamina_delay_seconds: 3,
  amf_call_delay_seconds: 0,
  post_captcha_resume_delay_seconds: 1,
};

export const CLAN_PANEL_SWF_URL = 'https://cdn.ninjasaga.cc/cdn/swf/latest/swf/panels/clan_panel.swf';
export const DEFAULT_CLAN_BATTLE_KEY = [75, 126, 53, 58, 71, 116, 50, 91, 46, 44, 115, 36, 73, 110, 61, 90];
export const DEFAULT_CLAN_STAMINA_KEY = [116, 46, 75, 91, 61, 53, 73, 126, 36, 90, 50, 58, 44, 71, 110, 115];
export const CLAN_BATTLE_DEFENDER_STRATEGIES = ['as_seqhash', 'as_rawseq', 'legacy_inner_seqhash', 'legacy_inner_rawseq'];

let _clanTokenUniqIdCache = null;
let _clanBattleKeyCache = null;
let _clanStaminaKeyCache = null;

const now = () => Date.now() / 1000;
const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

function inflateSwfBytes(data) {
  if (data.subarray(0, 3).toString('latin1') === 'CWS') {
    return Buffer.concat([Buffer.from('FWS', 'latin1'), data.subarray(3, 8), zlib.inflateSync(data.subarray(8))]);
  }
  if (data.subarray(0, 3).toString('latin1') !== 'FWS') return Buffer.alloc(0);
  return data;
}

function extractClanTokenUniqIdFromSwfBytes(data) {
  data = inflateSwfBytes(data);
  if (!data.length) return '';

  const marker = Buffer.from("parent.postMessage({action: 'show_captcha'}, '*');", 'latin1');
  let idx = data.indexOf(marker);
  if (idx === -1) idx = data.indexOf(Buffer.from('show_captcha', 'latin1'));
  if (idx === -1) return '';

  const windowBuf = data.subarray(Math.max(0, idx - 256), Math.min(data.length, idx + 512));
  const text = windowBuf.toString('latin1');
  const numbers = [];
  for (const m of text.matchAll(/\d{14,20}/g)) {
    if (m[0] !== '123123123123412') numbers.push(m[0]);
  }
  return numbers.length ? numbers[numbers.length - 1] : '';
}

function extractClanBattleKeyFromSwfBytes(data) {
  data = inflateSwfBytes(data);
  if (!data.length) return [];

  const markerPositions = [];
  for (const marker of ['ClanWar.getBattleDefender', 'getBattleDefender']) {
    const idx = data.indexOf(Buffer.from(marker, 'latin1'));
    if (idx !== -1) markerPositions.push(idx);
  }
  if (!markerPositions.length) markerPositions.push(Math.floor(data.length / 2));

  const patterns = [/_k[^[]*\[\s*((?:\d+\s*,\s*){15}\d+)\s*\]/, /\[\s*((?:\d+\s*,\s*){15}\d+)\s*\]/];
  for (const idx of markerPositions) {
    const windowBuf = data.subarray(Math.max(0, idx - 8192), Math.min(data.length, idx + 8192));
    const text = windowBuf.toString('latin1');
    for (const pattern of patterns) {
      for (const match of text.matchAll(new RegExp(pattern.source, 'g'))) {
        const values = match[1].split(',').map((part) => Number.parseInt(part.trim(), 10));
        if (values.length === 16 && values.every((v) => v >= 0 && v <= 255)) return values;
      }
    }
  }

  const abc = extractFirstDoabcBytes(data);
  if (abc.length) {
    const code = findNamedMethodBodyInDoabc(abc, 'ninjasaga.linkage::ClanPanel', 'getDefender');
    const values = code.length ? extractLiteralPushIntArrayFromCode(code, 16) : [];
    if (values.length === 16 && values.every((v) => v >= 0 && v <= 255)) return values;
  }
  return [];
}

function readU30(data, pos) {
  let result = 0;
  let shift = 0;
  while (true) {
    const value = data[pos];
    pos += 1;
    result |= (value & 0x7f) << shift;
    if (!(value & 0x80)) return [result >>> 0, pos];
    shift += 7;
  }
}

function extractFirstDoabcBytes(data) {
  const swf = inflateSwfBytes(data);
  if (!swf.length) return Buffer.alloc(0);
  let pos = 8;
  const nbits = swf[pos] >> 3;
  pos += Math.floor((5 + nbits * 4 + 7) / 8);
  pos += 4;
  while (pos + 2 <= swf.length) {
    const header = swf.readUInt16LE(pos);
    pos += 2;
    const tagCode = header >> 6;
    let length = header & 0x3f;
    if (length === 0x3f) { length = swf.readUInt32LE(pos); pos += 4; }
    const body = swf.subarray(pos, pos + length);
    pos += length;
    if (tagCode === 82) {
      const nameEnd = body.indexOf(0, 4);
      if (nameEnd !== -1) return body.subarray(nameEnd + 1);
    }
  }
  return Buffer.alloc(0);
}

function skipAbcTrait(data, pos) {
  let _;
  [_, pos] = readU30(data, pos);
  const kindAttr = data[pos];
  pos += 1;
  const kind = kindAttr & 0x0f;
  const attrs = kindAttr >> 4;
  if (kind === 0 || kind === 6) {
    [_, pos] = readU30(data, pos);
    [_, pos] = readU30(data, pos);
    let valueIndex;
    [valueIndex, pos] = readU30(data, pos);
    if (valueIndex !== 0) pos += 1;
  } else if (kind >= 1 && kind <= 5) {
    [_, pos] = readU30(data, pos);
    [_, pos] = readU30(data, pos);
  }
  if (attrs & 0x04) {
    let metadataCount;
    [metadataCount, pos] = readU30(data, pos);
    for (let i = 0; i < metadataCount; i++) [_, pos] = readU30(data, pos);
  }
  return pos;
}

function findNamedMethodBodyInDoabc(abc, className, methodName) {
  let pos = 0;
  if (abc.length < 4) return Buffer.alloc(0);
  pos += 4;
  let _;

  for (let r = 0; r < 2; r++) {
    let count;
    [count, pos] = readU30(abc, pos);
    for (let i = 1; i < count; i++) [_, pos] = readU30(abc, pos);
  }

  let count;
  [count, pos] = readU30(abc, pos);
  pos += Math.max(0, count - 1) * 8;

  let stringCount;
  [stringCount, pos] = readU30(abc, pos);
  const strings = [''];
  for (let i = 1; i < stringCount; i++) {
    let length;
    [length, pos] = readU30(abc, pos);
    strings.push(abc.subarray(pos, pos + length).toString('utf8'));
    pos += length;
  }

  let namespaceCount;
  [namespaceCount, pos] = readU30(abc, pos);
  const namespaces = [null];
  for (let i = 1; i < namespaceCount; i++) {
    const kind = abc[pos]; pos += 1;
    let nameIndex; [nameIndex, pos] = readU30(abc, pos);
    namespaces.push([kind, nameIndex]);
  }

  let nsSetCount;
  [nsSetCount, pos] = readU30(abc, pos);
  for (let i = 1; i < nsSetCount; i++) {
    let c; [c, pos] = readU30(abc, pos);
    for (let j = 0; j < c; j++) [_, pos] = readU30(abc, pos);
  }

  let multinameCount;
  [multinameCount, pos] = readU30(abc, pos);
  const multinames = [null];
  for (let i = 1; i < multinameCount; i++) {
    const kind = abc[pos]; pos += 1;
    const item = { kind };
    if (kind === 0x07 || kind === 0x0d) {
      [item.ns, pos] = readU30(abc, pos);
      [item.name, pos] = readU30(abc, pos);
    } else if (kind === 0x0f || kind === 0x10) {
      [item.name, pos] = readU30(abc, pos);
    } else if (kind === 0x11 || kind === 0x12) {
      // no fields
    } else if (kind === 0x09 || kind === 0x0e) {
      [item.name, pos] = readU30(abc, pos);
      [item.ns_set, pos] = readU30(abc, pos);
    } else if (kind === 0x1b || kind === 0x1c) {
      [item.ns_set, pos] = readU30(abc, pos);
    } else if (kind === 0x1d) {
      [item.qname, pos] = readU30(abc, pos);
      let c; [c, pos] = readU30(abc, pos);
      const params = [];
      for (let j = 0; j < c; j++) { let p; [p, pos] = readU30(abc, pos); params.push(p); }
      item.params = params;
    } else {
      return Buffer.alloc(0);
    }
    multinames.push(item);
  }

  const resolveMultiname = (index) => {
    if (!index || index >= multinames.length || !multinames[index]) return '';
    const item = multinames[index] || {};
    const kind = Number(item.kind || 0);
    if (kind === 0x07 || kind === 0x0d) {
      const namespace = Number(item.ns || 0) < namespaces.length ? namespaces[Number(item.ns || 0)] : null;
      const namespaceName = namespace && namespace[1] < strings.length ? strings[namespace[1]] : '';
      const localName = Number(item.name || 0) < strings.length ? strings[Number(item.name || 0)] : '';
      return namespaceName ? `${namespaceName}::${localName}` : localName;
    }
    if (kind === 0x0f || kind === 0x10 || kind === 0x09 || kind === 0x0e) {
      const nameIndex = Number(item.name || 0);
      return nameIndex < strings.length ? strings[nameIndex] : '';
    }
    if (kind === 0x1d) return resolveMultiname(Number(item.qname || 0));
    return '';
  };

  let methodCount;
  [methodCount, pos] = readU30(abc, pos);
  for (let i = 0; i < methodCount; i++) {
    let paramCount; [paramCount, pos] = readU30(abc, pos);
    [_, pos] = readU30(abc, pos);
    for (let j = 0; j < paramCount; j++) [_, pos] = readU30(abc, pos);
    [_, pos] = readU30(abc, pos);
    const flags = abc[pos]; pos += 1;
    if (flags & 0x08) {
      let optionCount; [optionCount, pos] = readU30(abc, pos);
      for (let j = 0; j < optionCount; j++) { [_, pos] = readU30(abc, pos); pos += 1; }
    }
    if (flags & 0x80) {
      for (let j = 0; j < paramCount; j++) [_, pos] = readU30(abc, pos);
    }
  }

  let metadataCount;
  [metadataCount, pos] = readU30(abc, pos);
  for (let i = 0; i < metadataCount; i++) {
    [_, pos] = readU30(abc, pos);
    let itemCount; [itemCount, pos] = readU30(abc, pos);
    for (let j = 0; j < itemCount; j++) [_, pos] = readU30(abc, pos);
    for (let j = 0; j < itemCount; j++) [_, pos] = readU30(abc, pos);
  }

  let targetMethodIndex = null;
  let instanceCount;
  [instanceCount, pos] = readU30(abc, pos);
  for (let i = 0; i < instanceCount; i++) {
    let nameIndex; [nameIndex, pos] = readU30(abc, pos);
    [_, pos] = readU30(abc, pos);
    const flags = abc[pos]; pos += 1;
    if (flags & 0x08) [_, pos] = readU30(abc, pos);
    let interfaceCount; [interfaceCount, pos] = readU30(abc, pos);
    for (let j = 0; j < interfaceCount; j++) [_, pos] = readU30(abc, pos);
    [_, pos] = readU30(abc, pos);
    let traitCount; [traitCount, pos] = readU30(abc, pos);
    const currentClassName = resolveMultiname(nameIndex);
    for (let j = 0; j < traitCount; j++) {
      let traitNameIndex; let nextPos;
      [traitNameIndex, nextPos] = readU30(abc, pos);
      const kindAttr = abc[nextPos];
      const kind = kindAttr & 0x0f;
      const traitName = resolveMultiname(traitNameIndex);
      let workingPos = nextPos + 1;
      if (kind === 0 || kind === 6) {
        [_, workingPos] = readU30(abc, workingPos);
        [_, workingPos] = readU30(abc, workingPos);
        let valueIndex; [valueIndex, workingPos] = readU30(abc, workingPos);
        if (valueIndex !== 0) workingPos += 1;
      } else if (kind === 1 || kind === 2 || kind === 3) {
        [_, workingPos] = readU30(abc, workingPos);
        let methodIndex; [methodIndex, workingPos] = readU30(abc, workingPos);
        if (currentClassName === className && traitName.endsWith(`::${methodName}`)) targetMethodIndex = methodIndex;
      } else if (kind === 4) {
        [_, workingPos] = readU30(abc, workingPos);
        [_, workingPos] = readU30(abc, workingPos);
      } else if (kind === 5) {
        [_, workingPos] = readU30(abc, workingPos);
        [_, workingPos] = readU30(abc, workingPos);
      }
      const attrs = kindAttr >> 4;
      if (attrs & 0x04) {
        let metadataItems; [metadataItems, workingPos] = readU30(abc, workingPos);
        for (let k = 0; k < metadataItems; k++) [_, workingPos] = readU30(abc, workingPos);
      }
      pos = workingPos;
    }
  }

  for (let i = 0; i < instanceCount; i++) {
    [_, pos] = readU30(abc, pos);
    let traitCount; [traitCount, pos] = readU30(abc, pos);
    for (let j = 0; j < traitCount; j++) pos = skipAbcTrait(abc, pos);
  }

  let scriptCount;
  [scriptCount, pos] = readU30(abc, pos);
  for (let i = 0; i < scriptCount; i++) {
    [_, pos] = readU30(abc, pos);
    let traitCount; [traitCount, pos] = readU30(abc, pos);
    for (let j = 0; j < traitCount; j++) pos = skipAbcTrait(abc, pos);
  }

  if (targetMethodIndex === null) return Buffer.alloc(0);

  let bodyCount;
  [bodyCount, pos] = readU30(abc, pos);
  for (let i = 0; i < bodyCount; i++) {
    let methodIndex; [methodIndex, pos] = readU30(abc, pos);
    [_, pos] = readU30(abc, pos);
    [_, pos] = readU30(abc, pos);
    [_, pos] = readU30(abc, pos);
    [_, pos] = readU30(abc, pos);
    let codeLength; [codeLength, pos] = readU30(abc, pos);
    const code = abc.subarray(pos, pos + codeLength);
    pos += codeLength;
    let exceptionCount; [exceptionCount, pos] = readU30(abc, pos);
    for (let j = 0; j < exceptionCount; j++) for (let k = 0; k < 5; k++) [_, pos] = readU30(abc, pos);
    let traitCount; [traitCount, pos] = readU30(abc, pos);
    for (let j = 0; j < traitCount; j++) pos = skipAbcTrait(abc, pos);
    if (methodIndex === targetMethodIndex) return code;
  }
  return Buffer.alloc(0);
}

function extractLiteralPushIntArrayFromCode(code, expectedCount) {
  for (let index = 0; index < code.length; index++) {
    const opcode = code[index];
    if (opcode !== 0x56 || index + 1 >= code.length) continue;
    if (code[index + 1] !== expectedCount) continue;
    const values = [];
    let cursor = index - 1;
    while (cursor >= 1 && values.length < expectedCount) {
      if (code[cursor - 1] === 0x24 || code[cursor - 1] === 0x25) {
        values.push(code[cursor]);
        cursor -= 2;
        continue;
      }
      break;
    }
    if (values.length === expectedCount) { values.reverse(); return values; }
  }
  return [];
}

function extractClanStaminaKeyFromSwfBytes(data) {
  const abc = extractFirstDoabcBytes(data);
  if (!abc.length) return [];
  const code = findNamedMethodBodyInDoabc(abc, 'ninjasaga.linkage::ClanPanel', 'ConfirmRestoreStamina');
  if (!code.length) return [];
  const values = extractLiteralPushIntArrayFromCode(code, 16);
  if (values.length === 16 && values.every((v) => v >= 0 && v <= 255)) return values;
  return [];
}

async function fetchClanPanelSwfBytes() {
  const resp = await fetch(CLAN_PANEL_SWF_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0', 'Cache-Control': 'no-cache' },
    signal: AbortSignal.timeout(12000),
  });
  return Buffer.from(await resp.arrayBuffer());
}

async function getClanPanelRuntimeConfig(forceRefresh = false) {
  if (forceRefresh) { _clanTokenUniqIdCache = null; _clanBattleKeyCache = null; _clanStaminaKeyCache = null; }
  if (_clanTokenUniqIdCache && _clanBattleKeyCache && _clanStaminaKeyCache) {
    return [_clanTokenUniqIdCache, [..._clanBattleKeyCache], [..._clanStaminaKeyCache]];
  }
  try {
    const raw = await fetchClanPanelSwfBytes();
    const token = extractClanTokenUniqIdFromSwfBytes(raw);
    const battleKey = extractClanBattleKeyFromSwfBytes(raw);
    const staminaKey = extractClanStaminaKeyFromSwfBytes(raw);
    if (token) _clanTokenUniqIdCache = token;
    if (battleKey.length) _clanBattleKeyCache = battleKey;
    if (staminaKey.length) _clanStaminaKeyCache = staminaKey;
  } catch {
    // best effort; fall back to defaults
  }
  return [
    _clanTokenUniqIdCache || '',
    [...(_clanBattleKeyCache || DEFAULT_CLAN_BATTLE_KEY)],
    [...(_clanStaminaKeyCache || DEFAULT_CLAN_STAMINA_KEY)],
  ];
}

async function getClanTokenUniqId(forceRefresh = false) {
  const [token] = await getClanPanelRuntimeConfig(forceRefresh);
  return token;
}

function boolToActionscript(value) {
  return value ? 'true' : 'false';
}

export class NinjaSagaClanWarEvent {
  constructor(options = {}) {
    const {
      target_clan_id = null, target_clan_name = '', auto_spend_token = false, bleeding_mode = false,
      manual_recruit = false, manual_member_ids = null, settings = null, force_refresh_token = false,
      state_callback = null, captcha_resume_event = null, start_from_war_list_only = false,
      token = '', battle_key = null, stamina_key = null,
    } = options;

    this.session_key = String(config.loginData?.sessionkey || '');
    this.settings = { ...NINJASAGA_CLAN_WAR_DEFAULT_SETTINGS, ...(settings || {}) };
    this.target_clan_id = String(target_clan_id || '').trim();
    this.target_clan_name = String(target_clan_name || '').trim();
    this.auto_spend_token = !!auto_spend_token;
    this.bleeding_mode = !!bleeding_mode;
    this.manual_recruit = !!manual_recruit;
    this.manual_member_ids = (manual_member_ids || []).map((item) => String(item).trim()).filter((s) => s).slice(0, 2);
    this.selected_recruiters = [];
    this.bleeding_reputation_gained = false;
    this._battle_defender_strategy_index = 0;
    this.state_callback = state_callback;
    this.captcha_resume_event = captcha_resume_event;
    this._awaiting_first_post_captcha_response = false;
    this._resume_from_war_list_only = !!start_from_war_list_only;
    this._cached_snapshot = null;
    this.clan_token_id = String(token || '').trim();
    this.clan_battle_key = [...(battle_key || DEFAULT_CLAN_BATTLE_KEY)];
    this.clan_stamina_key = [...(stamina_key || DEFAULT_CLAN_STAMINA_KEY)];
  }

  static async create(options = {}) {
    if (!config.loginData || typeof config.loginData !== 'object') {
      throw new Error('NinjaSaga login data is missing');
    }
    const sessionKey = String(config.loginData.sessionkey || '');
    if (!sessionKey) throw new Error('NinjaSaga session key is missing');
    const [token, battleKey, staminaKey] = await getClanPanelRuntimeConfig(!!options.force_refresh_token);
    if (!token) throw new Error('clan_token_uniq_id not found');
    return new NinjaSagaClanWarEvent({ ...options, token, battle_key: battleKey, stamina_key: staminaKey });
  }

  _refreshSessionKey() {
    const loginData = config.loginData;
    let latest = '';
    if (loginData && typeof loginData === 'object') {
      latest = String(loginData.sessionkey || loginData.session_key || loginData.session || '');
    }
    if (!latest) return false;
    const changed = latest !== this.session_key;
    this.session_key = latest;
    if (changed) console.log('Clan War session key refreshed after captcha');
    return true;
  }

  _checkStopEvent() {
    const stopEvent = config.stopEvent;
    if (stopEvent && stopEvent.isSet && stopEvent.isSet()) {
      console.log('NinjaSaga Clan War worker loading...');
      return true;
    }
    return false;
  }

  async _waitWithStopCheck(seconds) {
    let remaining = Math.max(0, Math.trunc(seconds));
    while (remaining > 0) {
      if (this._checkStopEvent()) return false;
      await sleep(1000);
      remaining -= 1;
    }
    return true;
  }

  async _waitAmfDelay() {
    const delay = Math.max(0, Number.parseInt(this.settings.amf_call_delay_seconds ?? 1, 10));
    if (delay <= 0) return true;
    return this._waitWithStopCheck(delay);
  }

  _emitState(updates) {
    if (!this.state_callback) return;
    try { this.state_callback(updates); } catch { /* ignore */ }
  }

  _formatDebugPayload(payload, limit = 2500) {
    let text;
    try { text = JSON.stringify(payload, Object.keys(payload || {}).sort()); } catch { text = String(payload); }
    if (text.length > limit) return `${text.slice(0, limit)}... [truncated]`;
    return text;
  }

  async _waitForCaptchaResolution(message) {
    console.log(message);
    this._emitState({ captcha_required: true, captcha_message: message, running: true });
    if (this.captcha_resume_event && this.captcha_resume_event.clear) this.captcha_resume_event.clear();

    while (true) {
      if (this._checkStopEvent()) {
        this._emitState({ captcha_required: false, captcha_message: '', running: false });
        return false;
      }
      if (this.captcha_resume_event && this.captcha_resume_event.isSet && this.captcha_resume_event.isSet()) {
        this.captcha_resume_event.clear();
        this._awaiting_first_post_captcha_response = true;
        this._resume_from_war_list_only = false;
        this.settings.amf_call_delay_seconds = 2;
        this._emitState({ captcha_required: false, captcha_message: '', running: true });
        const postCaptchaDelay = Math.max(0, Number.parseInt(this.settings.post_captcha_resume_delay_seconds ?? this.settings.refresh_delay_seconds ?? 4, 10));
        if (!(await this._waitWithStopCheck(postCaptchaDelay))) return false;
        return true;
      }
      await sleep(1000);
    }
  }

  _safeInt(value, defaultValue = 0) {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? defaultValue : parsed;
  }

  _preferNumericOrText(value, defaultValue = 0) {
    if (value === null || value === undefined || value === '') return defaultValue;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? String(value) : parsed;
  }

  _extractFirst(payload, ...names) {
    const queue = [payload];
    const seen = new WeakSet();
    const lowered = names.map((n) => n.toLowerCase());
    while (queue.length) {
      const current = queue.shift();
      if (current && typeof current === 'object') {
        if (seen.has(current)) continue;
        seen.add(current);
        if (Array.isArray(current)) { queue.push(...current); continue; }
        for (const [key, value] of Object.entries(current)) {
          if (lowered.includes(String(key).toLowerCase())) return value;
        }
        queue.push(...Object.values(current));
      }
    }
    return undefined;
  }

  _extractFirstOr(payload, names, defaultValue) {
    const result = this._extractFirst(payload, ...names);
    return result === undefined ? defaultValue : result;
  }

  _extractListOfDicts(payload, preferredKeys) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      for (const key of preferredKeys) {
        let value = payload[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) value = Object.values(value);
        if (Array.isArray(value) && value.every((item) => item && typeof item === 'object' && !Array.isArray(item))) return value;
      }
      for (const value of Object.values(payload)) {
        const result = this._extractListOfDicts(value, preferredKeys);
        if (result.length) return result;
      }
    } else if (Array.isArray(payload)) {
      if (payload.length && payload.every((item) => item && typeof item === 'object' && !Array.isArray(item))) return payload;
      for (const item of payload) {
        const result = this._extractListOfDicts(item, preferredKeys);
        if (result.length) return result;
      }
    }
    return [];
  }

  _extractCandidateDictLists(payload) {
    const candidates = [];
    const visit = (value) => {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const item of Object.values(value)) visit(item);
        return;
      }
      if (Array.isArray(value)) {
        const dictItems = value.filter((item) => item && typeof item === 'object' && !Array.isArray(item));
        if (dictItems.length) candidates.push(dictItems);
        for (const item of value) visit(item);
      }
    };
    visit(payload);
    return candidates;
  }

  async getClanStatus() {
    if (!(await this._waitAmfDelay())) throw new Error('Clan War stopped before ClanService.getClanStatus');
    return amfReq.internals.callService('ClanService.getClanStatus', [this.session_key]);
  }

  async getClan() {
    if (!(await this._waitAmfDelay())) throw new Error('Clan War stopped before ClanService.getClan');
    return amfReq.internals.callService('ClanService.getClan', [this.session_key]);
  }

  async getWarList() {
    if (!(await this._waitAmfDelay())) throw new Error('Clan War stopped before ClanService.getWarList');
    return amfReq.internals.callService('ClanService.getWarList', [this.session_key]);
  }

  async getMemberListRaw() {
    if (!(await this._waitAmfDelay())) throw new Error('Clan War stopped before ClanWar.getMemberList');
    return amfReq.internals.callService('ClanWar.getMemberList', [this.session_key]);
  }

  _buildBuyStaminaSecurityValues() {
    const timestamp = Math.trunc(Date.now() / 1000);
    const source = `${this.session_key.slice(0, 8)};${timestamp}`;
    const sourceBytes = Buffer.from(source, 'utf8');
    const salt = Buffer.from(Array.from({ length: 11 }, () => randInt(0, 255)));
    const payload = Buffer.concat([salt, sourceBytes]);
    let rolling = 0;
    const key = this.clan_stamina_key.length ? this.clan_stamina_key : DEFAULT_CLAN_STAMINA_KEY;
    for (let idx = 0; idx < payload.length; idx++) {
      rolling = (rolling + payload[idx]) & 0xff;
      payload[idx] ^= key[(idx + rolling) % 16];
    }
    return [payload.toString('hex'), timestamp];
  }

  _buildBattleDefenderSecurityValues(clanId, selectedMemberStr, quickBattle, strategy) {
    const clanIdText = String(clanId || '');
    const memberText = String(selectedMemberStr || '');
    const quickBattleText = boolToActionscript(!!quickBattle);
    const [sequenceCounter, seqValue, seq] = amfReq.nextSequenceState();
    let innerSource;
    if (strategy.startsWith('legacy_inner')) innerSource = `${clanIdText}${memberText}${this.session_key}`;
    else innerSource = `${clanIdText}${memberText}${quickBattleText}`;
    const innerHash = amfReq.getHash(this.session_key, innerSource);
    const requestSuffix = strategy.endsWith('rawseq') ? seqValue : seq;
    const requestHash = amfReq.getHash(this.session_key, `${innerHash}${requestSuffix}`);
    const payload = `${requestHash}|${clanIdText}|${memberText}|${quickBattleText}`;
    const nonce = Array.from({ length: 16 }, () => randInt(0, 255));
    const state = Array.from({ length: 256 }, (_, i) => i);
    const key = this.clan_battle_key.length ? this.clan_battle_key : DEFAULT_CLAN_BATTLE_KEY;
    let j = 0;
    for (let idx = 0; idx < 256; idx++) {
      j = (j + state[idx] + key[idx % 16] + nonce[idx % 16]) % 256;
      [state[idx], state[j]] = [state[j], state[idx]];
    }

    const encryptedBytes = Buffer.from(payload, 'utf8');
    let i = 0; j = 0;
    for (let idx = 0; idx < encryptedBytes.length; idx++) {
      i = (i + 1) % 256;
      j = (j + state[i]) % 256;
      [state[i], state[j]] = [state[j], state[i]];
      encryptedBytes[idx] ^= state[(state[i] + state[j]) % 256];
    }
    const nonceHex = nonce.map((v) => v.toString(16).padStart(2, '0')).join('');
    const encrypted = nonceHex + encryptedBytes.toString('hex');

    const keyStream = Buffer.from(Array.from(key).map((v) => String.fromCharCode(v)).join(''), 'utf8');
    for (let idx = 0; idx < keyStream.length; idx++) {
      i = (i + 1) % 256;
      j = (j + state[i]) % 256;
      [state[i], state[j]] = [state[j], state[i]];
      keyStream[idx] ^= state[(state[i] + state[j]) % 256];
    }
    const fk = keyStream.toString('hex');
    return [sequenceCounter, seq, innerHash, requestHash, encrypted, fk, strategy];
  }

  async buyStamina() {
    if (!(await this._waitAmfDelay())) throw new Error('Clan War stopped before ClanService.buyStamina');
    const [encrypted, timestamp] = this._buildBuyStaminaSecurityValues();
    return amfReq.internals.callService('ClanService.buyStamina', [this.session_key, encrypted, timestamp]);
  }

  async getBattleDefender(clanId, clanName, selectedMemberStr, quickBattle = true, strategy = null) {
    if (!(await this._waitAmfDelay())) throw new Error('Clan War stopped before ClanWar.getBattleDefender');
    const strategyName = String(strategy || CLAN_BATTLE_DEFENDER_STRATEGIES[this._battle_defender_strategy_index]);
    const [, seq, , , encrypted, fk] = this._buildBattleDefenderSecurityValues(clanId, selectedMemberStr, quickBattle, strategyName);
    return amfReq.internals.callService('ClanWar.getBattleDefender', [
      this.session_key, seq, encrypted, Number.parseInt(clanId, 10) || clanId, String(clanName || ''), selectedMemberStr, !!quickBattle, fk,
    ]);
  }

  _sanitizeWarItem(item) {
    const clanId = this._extractFirstOr(item, ['id', 'clan_id'], '');
    return {
      id: String(clanId || '').trim(),
      name: String(this._extractFirstOr(item, ['name', 'clan_name'], 'Unknown Clan') || 'Unknown Clan'),
      reputation: this._preferNumericOrText(this._extractFirstOr(item, ['reputation'], 0), 0),
      master: String(this._extractFirstOr(item, ['master', 'master_name'], '-') || '-'),
      members: this._preferNumericOrText(this._extractFirstOr(item, ['member', 'member_total', 'members'], '?'), '?'),
      raw: item,
    };
  }

  _sanitizeMemberItem(item) {
    const memberId = this._extractFirstOr(item, ['id', 'char_id', 'uid'], '');
    return {
      id: String(memberId || '').trim(),
      name: String(this._extractFirstOr(item, ['name', 'character_name'], 'Unknown') || 'Unknown'),
      level: this._safeInt(this._extractFirstOr(item, ['level', 'character_level'], 0)),
      stamina: this._safeInt(this._extractFirstOr(item, ['stamina'], 0)),
      reputation_gain: this._safeInt(this._extractFirstOr(item, ['reputation_gain'], 0)),
      raw: item,
    };
  }

  parseStatusSnapshot(payload) {
    const clanName = this._extractFirstOr(payload, ['name', 'clan_name'], 'Unknown Clan');
    const clanId = this._extractFirstOr(payload, ['id', 'clan_id'], '');
    const reputation = this._safeInt(this._extractFirstOr(payload, ['reputation'], 0));
    const stamina = this._safeInt(this._extractFirstOr(payload, ['character_stamina', 'stamina'], 0));
    const maxStamina = this._safeInt(this._extractFirstOr(payload, ['character_max_stamina', 'max_stamina'], 0));
    const prestige = this._preferNumericOrText(this._extractFirstOr(payload, ['prestige'], 'n/a'), 'n/a');
    return {
      clan: { id: String(clanId || '').trim(), name: String(clanName || 'Unknown Clan'), reputation },
      char: { stamina, max_stamina: maxStamina, prestige },
    };
  }

  parseWarList(payload) {
    const items = this._extractListOfDicts(payload, ['war_list']);
    if (!items.length) {
      for (const candidate of this._extractCandidateDictLists(payload)) {
        let parsed = candidate.map((item) => this._sanitizeWarItem(item));
        parsed = parsed.filter((item) => item.id || item.name !== 'Unknown Clan');
        if (parsed.length) return parsed;
      }
    }
    return items.map((item) => this._sanitizeWarItem(item));
  }

  parseMemberList(payload) {
    const items = this._extractListOfDicts(payload, ['clan_members', 'member_list']);
    if (!items.length) {
      for (const candidate of this._extractCandidateDictLists(payload)) {
        let parsed = candidate.map((item) => this._sanitizeMemberItem(item));
        parsed = parsed.filter((item) => item.id || item.name !== 'Unknown');
        if (parsed.length) return parsed;
      }
    }
    return items.map((item) => this._sanitizeMemberItem(item));
  }

  chooseRecruiters(members) {
    if (!this.bleeding_mode || this.bleeding_reputation_gained) { this.selected_recruiters = []; return []; }
    let chosen;
    if (this.manual_recruit && this.manual_member_ids.length) {
      chosen = this.manual_member_ids.slice(0, 2);
    } else {
      const sorted = [...members].sort((a, b) =>
        (this._safeInt(b.stamina) - this._safeInt(a.stamina)) ||
        (this._safeInt(b.reputation_gain) - this._safeInt(a.reputation_gain)) ||
        (String(b.name || '') < String(a.name || '') ? -1 : 1));
      chosen = sorted.filter((m) => m.id).slice(0, 2).map((m) => m.id);
    }
    this.selected_recruiters = chosen;
    return chosen;
  }

  async snapshot() {
    const statusPayload = await this.getClanStatus();
    const clanPayload = await this.getClan();
    const status = this.parseStatusSnapshot({ status: statusPayload, clan: clanPayload });
    const warList = this.parseWarList(await this.getWarList());
    const memberList = this.parseMemberList(await this.getMemberListRaw());
    const selected = this.chooseRecruiters(memberList);
    return { ...status, war_list: warList, member_list: memberList, selected_recruiters: selected, bleeding_reputation_gained: this.bleeding_reputation_gained };
  }

  async snapshotAfterCaptcha() {
    const base = { ...(this._cached_snapshot || {}) };
    const warList = this.parseWarList(await this.getWarList());
    const memberList = this.parseMemberList(await this.getMemberListRaw());
    const selected = this.chooseRecruiters(memberList);
    return { ...base, war_list: warList, member_list: memberList, selected_recruiters: selected, bleeding_reputation_gained: this.bleeding_reputation_gained };
  }

  _findTargetClan(warList, ownClanId) {
    if (this.target_clan_id) {
      for (const clan of warList) if (clan.id === this.target_clan_id) return clan;
    }
    for (const clan of warList) if (clan.id && clan.id !== ownClanId) return clan;
    return null;
  }

  _battleReputationGain(response) {
    return this._safeInt(this._extractFirstOr(response, ['rep_gain', 'reputation_gain', 'gain'], 0));
  }

  _extractBattleResponseStamina(response) {
    const value = this._extractFirstOr(response, ['character_stamina', 'stamina'], null);
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  _isRealBattleSuccess(response, staminaBefore, postStatus) {
    const responseStamina = this._extractBattleResponseStamina(response);
    if (responseStamina !== null && responseStamina < staminaBefore) return true;
    if (postStatus && typeof postStatus === 'object') {
      const postStamina = this._safeInt(postStatus.char?.stamina, staminaBefore);
      if (postStamina < staminaBefore) return true;
    }
    if (this._battleReputationGain(response) > 0) return true;
    if (this._safeInt(this._extractFirstOr(response, ['prestige_gain'], 0)) > 0) return true;
    return false;
  }

  _hasCaptcha(payload) {
    const value = this._extractFirstOr(payload, ['show_captcha'], false);
    if (typeof value === 'boolean') return value;
    return ['1', 'true', 'yes'].includes(String(value).trim().toLowerCase());
  }

  async run() {
    let initial;
    if (this._resume_from_war_list_only) {
      initial = await this.snapshotAfterCaptcha();
      this._resume_from_war_list_only = false;
    } else {
      initial = await this.snapshot();
    }
    const clanName = initial.clan?.name || 'Unknown Clan';
    console.log(`NinjaSaga Clan War ready for clan: ${clanName}`);
    this._emitState({ snapshot: initial, running: true });

    while (!this._checkStopEvent()) {
      let snapshot;
      if (this._resume_from_war_list_only) {
        this._resume_from_war_list_only = false;
        snapshot = await this.snapshotAfterCaptcha();
      } else {
        snapshot = await this.snapshot();
      }
      this._cached_snapshot = snapshot;
      this._emitState({ snapshot, running: true });
      const stamina = this._safeInt(snapshot.char?.stamina, 0);
      const ownClanId = String(snapshot.clan?.id || '');
      const warList = snapshot.war_list || [];
      const memberList = snapshot.member_list || [];

      if (stamina < CLAN_BATTLE_STAMINA_COST) {
        if (this.auto_spend_token) {
          console.log('Clan War stamina below 10, trying to buy stamina...');
          await this.buyStamina();
          if (!(await this._waitWithStopCheck(Math.max(1, Number.parseInt(this.settings.buy_stamina_delay_seconds ?? 3, 10))))) return;
          continue;
        }
        console.log('Clan War stamina below 10 and auto spend is disabled. Stopping battle loop.');
        return;
      }

      const target = this._findTargetClan(warList, ownClanId);
      if (!target) {
        console.log('No clan war target available right now, refreshing soon...');
        if (!(await this._waitWithStopCheck(Math.max(1, Number.parseInt(this.settings.refresh_delay_seconds ?? 4, 10))))) return;
        continue;
      }

      const targetId = target.id || '';
      const targetName = target.name || 'Unknown Clan';
      this.target_clan_id = String(targetId);
      this.target_clan_name = String(targetName);

      const recruiters = this.chooseRecruiters(memberList);
      const recruiterStr = recruiters.length ? recruiters.join(',') : '';
      if (recruiters.length) console.log(`Clan War bleeding mode recruiters: ${recruiterStr}`);

      let response = null;
      const strategies = CLAN_BATTLE_DEFENDER_STRATEGIES;
      const startIndex = Math.max(0, this._battle_defender_strategy_index) % strategies.length;
      const orderedStrategies = [...strategies.slice(startIndex), ...strategies.slice(0, startIndex)];
      for (const strategyName of orderedStrategies) {
        response = await this.getBattleDefender(targetId, targetName, recruiterStr, true, strategyName);
        if (this._hasCaptcha(response)) {
          const message = 'Clan War captcha required. Solve it in the panel captcha screen to continue.';
          if (!(await this._waitForCaptchaResolution(message))) return;
          response = null;
          break;
        }
        this._awaiting_first_post_captcha_response = false;
        let postStatus = null;
        try {
          postStatus = this.parseStatusSnapshot({ status: await this.getClanStatus(), clan: await this.getClan() });
        } catch { postStatus = null; }
        if (this._isRealBattleSuccess(response, stamina, postStatus)) {
          this._battle_defender_strategy_index = CLAN_BATTLE_DEFENDER_STRATEGIES.indexOf(strategyName);
          console.log(`Clan War strategy locked: ${strategyName}`);
          break;
        }
        console.log(`Clan War strategy ${strategyName} did not consume stamina or gain rewards, trying next variant...`);
      }
      if (response === null) continue;

      const repGain = this._battleReputationGain(response);
      if (repGain > 0 && this.bleeding_mode && !this.bleeding_reputation_gained) {
        this.bleeding_reputation_gained = true;
        console.log('Bleeding mode: first reputation gain detected, stop using recruiters for next battles');
      }

      if (this._safeInt(this._extractFirstOr(response, ['result'], -1)) === 1) {
        console.log('Clan War quick path fell into manual defender battle; stopping loop here for safety');
        return;
      }

      if (!(await this._waitWithStopCheck(Math.max(1, Number.parseInt(this.settings.battle_delay_seconds ?? 8, 10))))) return;
    }
  }
}

export async function buildClanWarSnapshot(params = null, { forceRefreshToken = false } = {}) {
  const options = params && typeof params === 'object' ? params : {};
  const event = await NinjaSagaClanWarEvent.create({
    target_clan_id: options.target_clan_id,
    target_clan_name: options.target_clan_name || '',
    auto_spend_token: !!options.auto_spend_token,
    bleeding_mode: !!options.bleeding_mode,
    manual_recruit: !!options.manual_recruit,
    manual_member_ids: options.manual_member_ids || [],
    settings: options.settings || {},
    force_refresh_token: forceRefreshToken,
  });
  return event.snapshot();
}

export async function clanWarEvent(params = null, stateCallback = null, captchaResumeEvent = null, startFromWarListOnly = false) {
  const options = params && typeof params === 'object' ? params : {};
  const event = await NinjaSagaClanWarEvent.create({
    target_clan_id: options.target_clan_id,
    target_clan_name: options.target_clan_name || '',
    auto_spend_token: !!options.auto_spend_token,
    bleeding_mode: !!options.bleeding_mode,
    manual_recruit: !!options.manual_recruit,
    manual_member_ids: options.manual_member_ids || [],
    settings: options.settings || {},
    state_callback: stateCallback,
    captcha_resume_event: captchaResumeEvent,
    start_from_war_list_only: startFromWarListOnly,
  });
  await event.run();
}

export const internals = { extractClanTokenUniqIdFromSwfBytes, extractClanBattleKeyFromSwfBytes, extractClanStaminaKeyFromSwfBytes };
