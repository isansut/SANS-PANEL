// Port of the NinjaSaga client's request-integrity layer, reverse-engineered from
// the decompiled SWFs:
//   - NinjaSaga.as  (main SWF)      -> _msc, _uc, _fc, _sb  (instance transforms)
//   - ninjasaga/Main.as             -> _msa, _msb, _urk, _ub, _ud, _frk, _fb, _fd, gk, getHash, getArrayHash, updateSequence
//   - ninjasaga/Mission.as          -> _msk (=_msd(_msb(mc._msc(_msa(x,key),key),key))), _fa, _frk
//   - ninjasaga/Character.as        -> _ua, _uc (blob with random nonce)
//   - ninjasaga/linkage/ClientLibrary.as -> getHash/getArrayHash (sha1 + salt)
//   - ninjasaga/DataParser.as       -> _dx, _kv (kq / gk values)
import crypto from 'node:crypto';

import config from '../config.js';
import { sha1Hex } from '../shared/crypto.js';

export const CLIENT_SALT = 'Vmn34aAciYK00Hen26nT01';

// ---------------------------------------------------------------------------
// Byte helpers
// ---------------------------------------------------------------------------

function toBytes(str) {
  const out = new Array(str.length);
  for (let i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
  return out;
}

function fromBytes(bytes) {
  let s = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, bytes.slice(i, i + CHUNK));
  }
  return s;
}

function reverse(str) {
  return str.split('').reverse().join('');
}

function hexEncode(str) {
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += (str.charCodeAt(i) & 0xff).toString(16).padStart(2, '0');
  }
  return out;
}

// ---------------------------------------------------------------------------
// ClientLibrary hashes
// ---------------------------------------------------------------------------

export function getHash(sessionKey, payload) {
  return sha1Hex(`${payload}${CLIENT_SALT}${sessionKey}`);
}

export function getArrayHash(sessionKey, values) {
  const serialized = values.map((v) => (v === null || v === undefined ? '' : String(v))).join(',');
  return sha1Hex(`${serialized}${CLIENT_SALT}${sessionKey}`);
}

export function updateSequence() {
  const current = Number.parseInt(config.CLASSIC_REQUEST_SEQ || 0, 10) || 0;
  config.CLASSIC_REQUEST_SEQ = current + 1;
  return getHash(sessionKeyOf(), String(config.CLASSIC_REQUEST_SEQ));
}

function sessionKeyOf() {
  const loginData = config.loginData;
  if (!loginData || typeof loginData !== 'object') return '';
  const value = loginData.sessionkey || loginData.session_key || loginData.session;
  if (value) return String(value);
  const result = loginData.result;
  if (Array.isArray(result) && result.length > 3) return String(result[3] || '');
  return '';
}

// ---------------------------------------------------------------------------
// Main.as static transforms
// ---------------------------------------------------------------------------

export function _msa(str, key) {
  if (key.length === 0) return str;
  const s = toBytes(str);
  const k = toBytes(key);
  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    let v = (s[i] + k[(i + 5) % key.length]) & 0xff;
    v = ((v << 3) | (v >> 5)) & 0xff;
    out[i] = v;
  }
  return fromBytes(out);
}

export function _msb(str, key) {
  if (key.length === 0) return str;
  const s = toBytes(str);
  const k = toBytes(key);
  const out = new Array(s.length);
  let carry = s.length & 0xff;
  for (let i = 0; i < s.length; i++) {
    let v = (s[i] - k[key.length - 1 - (i % key.length)] - carry) & 0xff;
    v = ((v << 4) | (v >> 4)) & 0xff;
    carry = (carry + s[i]) & 0xff;
    out[i] = v;
  }
  return fromBytes(out);
}

export function _mb(s) {
  return hexEncode(s);
}

// ---------------------------------------------------------------------------
// NinjaSaga.as instance transforms (port of movieclip methods)
// ---------------------------------------------------------------------------

export function _msc(str, key) {
  const rev = reverse(str);
  if (key.length === 0) return rev;
  const s = toBytes(rev);
  const k = toBytes(key);
  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = (s[i] ^ k[(3 * i) % key.length] ^ ((5 * i) & 0xff)) & 0xff;
  }
  return fromBytes(out);
}

export function _ucMc(str, key) {
  const rev = reverse(str);
  if (key.length === 0) return rev;
  const s = toBytes(rev);
  const k = toBytes(key);
  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = (s[i] ^ k[(4 * i) % key.length] ^ ((7 * i) & 0xff)) & 0xff;
  }
  return fromBytes(out);
}

export function _fcMc(str, key) {
  const rev = reverse(str);
  if (key.length === 0) return rev;
  const s = toBytes(rev);
  const k = toBytes(key);
  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    out[i] = (s[i] ^ k[(6 * i) % key.length] ^ ((11 * i) & 0xff)) & 0xff;
  }
  return fromBytes(out);
}

export function _sbMc(str, key) {
  const rev = reverse(str);
  if (key.length === 0) return rev;
  const s = toBytes(rev);
  const k = toBytes(key);
  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    let v = (s[i] + k[(2 * i + 1) % key.length] + i) & 0xff;
    v = (((v & 0x0f) << 4) | ((v & 0xf0) >> 4)) & 0xff;
    out[i] = v;
  }
  return fromBytes(out);
}

// ---------------------------------------------------------------------------
// Character.as
// ---------------------------------------------------------------------------

export function _ua(str, key) {
  if (key.length === 0) return str;
  const s = toBytes(str);
  const k = toBytes(key);
  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    let v = (s[i] + k[(i + 7) % key.length]) & 0xff;
    v = ((v << 6) | (v >> 2)) & 0xff;
    out[i] = v;
  }
  return fromBytes(out);
}

export function _ub(str, key) {
  if (key.length === 0) return str;
  const s = toBytes(str);
  const k = toBytes(key);
  const out = new Array(s.length);
  let carry = s.length & 0xff;
  for (let i = 0; i < s.length; i++) {
    let v = (s[i] - k[key.length - 1 - (i % key.length)] - carry) & 0xff;
    v = ((v << 7) | (v >> 1)) & 0xff;
    carry = (carry + s[i]) & 0xff;
    out[i] = v;
  }
  return fromBytes(out);
}

const _CHAR_UC_KEY = [58, 126, 44, 73, 50, 36, 46, 110, 75, 53, 91, 116, 61, 115, 90, 71];

// Character._uc(str): nonce(12) + custom XOR + hex  (used for arg18)
export function charUc(str) {
  const data = Buffer.from(str, 'utf8');
  const nonce = crypto.randomBytes(12);
  const out = Buffer.from(data);
  for (let i = 0; i < out.length; i++) {
    let v = ((_CHAR_UC_KEY[i % 16] ^ nonce[i % 12]) + i * 7) & 0xffffffff;
    out[i] ^= v & 0xff;
    out[i] = (out[i] + _CHAR_UC_KEY[(i + 5) % 16]) & 0xff;
  }
  let s = '';
  for (let i = 0; i < 12; i++) s += nonce[i].toString(16).padStart(2, '0');
  for (let i = 0; i < out.length; i++) s += out[i].toString(16).padStart(2, '0');
  return s;
}

// ---------------------------------------------------------------------------
// Composite pipelines
// ---------------------------------------------------------------------------

// Mission._msk(x, sk) = _msd(_msb(mc._msc(_msa(x, sk), sk), sk))
export function _msk(str, key) {
  return hexEncode(_msb(_msc(_msa(str, key), key), key));
}

// Main._urk(x, sk) = _ud(_ub(mc._uc(Character._ua(x, sk), sk), sk))
export function _urk(str, key) {
  return hexEncode(_ub(_ucMc(_ua(str, key), key), key));
}

// Mission._fa / Main._fb / _fd  (used by _frk)
export function _fa(str, key) {
  if (key.length === 0) return str;
  const s = toBytes(str);
  const k = toBytes(key);
  const out = new Array(s.length);
  for (let i = 0; i < s.length; i++) {
    let v = (s[i] + k[(i + 11) % key.length]) & 0xff;
    v = ((v << 1) | (v >> 7)) & 0xff;
    out[i] = v;
  }
  return fromBytes(out);
}

export function _fb(str, key) {
  if (key.length === 0) return str;
  const s = toBytes(str);
  const k = toBytes(key);
  const out = new Array(s.length);
  let carry = s.length & 0xff;
  for (let i = 0; i < s.length; i++) {
    let v = (s[i] - k[key.length - 1 - (i % key.length)] - carry) & 0xff;
    v = ((v << 3) | (v >> 5)) & 0xff;
    carry = (carry + s[i]) & 0xff;
    out[i] = v;
  }
  return fromBytes(out);
}

export function _frk(str, key) {
  return hexEncode(_fb(_fcMc(_fa(str, key), key), key));
}

// ---------------------------------------------------------------------------
// Main._zrb / Battle._br  (event boss-reward integrity tokens)
// ---------------------------------------------------------------------------

export function _za2(str, key) {
  if (key.length === 0) return str;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    let v = (str.charCodeAt(i) + key.charCodeAt(i % key.length)) & 0xff;
    v = ((v >> 3) | (v << 5)) & 0xff;
    out += String.fromCharCode(v);
  }
  return out;
}

export function _zb2(str, key) {
  if (key.length === 0) return reverse(str);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode((str.charCodeAt(i) ^ key.charCodeAt((3 * i) % key.length) ^ (i & 0xff)) & 0xff);
  }
  return reverse(out);
}

export function _zc2(str, key) {
  if (key.length === 0) return str;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    let v = (str.charCodeAt(i) - key.charCodeAt((i + 2) % key.length)) & 0xff;
    v = (((v & 0x0f) << 4) | ((v & 0xf0) >> 4)) & 0xff;
    out += String.fromCharCode(v);
  }
  return out;
}

// Main._zrb(a, b) = _zd(_zc2(_zb2(_za2(a, b), b), b))
export function _zrb(a, b) {
  if (!a || !b) return '';
  return hexEncode(_zc2(_zb2(_za2(a, b), b), b));
}

const _BR_KEY = [46, 71, 115, 53, 90, 36, 126, 50, 73, 58, 44, 110, 61, 75, 116, 91];

// Battle._br(str): 14-byte nonce + XOR/add keystream, hex encoded
export function br(str) {
  const data = toBytes(str);
  const nonce = crypto.randomBytes(14);
  let k = 0;
  for (let i = 0; i < data.length; i++) {
    const x = (_BR_KEY[(i + k) % 16] ^ nonce[(i + 3) % 14]) & 0xff;
    data[i] = (data[i] ^ x) & 0xff;
    data[i] = (data[i] + _BR_KEY[(i * 5) % 16]) & 0xff;
    k = (k + data[i] + i * 9) & 0xff;
  }
  let out = '';
  for (let i = 0; i < 14; i++) out += nonce[i].toString(16).padStart(2, '0');
  for (let i = 0; i < data.length; i++) out += (data[i] & 0xff).toString(16).padStart(2, '0');
  return out;
}

// ---------------------------------------------------------------------------
// Hunting (Eudemon Garden) transforms — Main._qa/_qb/_qc, panel _qc2, Battle._eh
// ---------------------------------------------------------------------------

export function _qa(str, key) {
  if (key.length === 0) return str;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    let v = str.charCodeAt(i);
    v = (((v << 2) | (v >> 6)) & 0xff) ^ key.charCodeAt(i % key.length);
    out += String.fromCharCode(v & 0xff);
  }
  return out;
}

export function _qb(str, key) {
  const rev = reverse(str);
  if (key.length === 0) return rev;
  let out = '';
  for (let i = 0; i < rev.length; i++) {
    let v = (rev.charCodeAt(i) + key.charCodeAt((i * 3 + 1) % key.length)) & 0xff;
    v = (((v & 0x0f) << 4) | ((v & 0xf0) >> 4)) & 0xff;
    out += String.fromCharCode(v);
  }
  return out;
}

export function _qc(str, key) {
  if (key.length === 0) return str;
  let out = '';
  let carry = key.charCodeAt(0) & 0xff;
  for (let i = 0; i < str.length; i++) {
    let v = str.charCodeAt(i) ^ key.charCodeAt((i + 9) % key.length) ^ (i & 0xff) ^ carry;
    v = ((v >> 3) | (v << 5)) & 0xff;
    out += String.fromCharCode(v);
    carry = v;
  }
  return out;
}

export function _qa2(str, key) {
  if (key.length === 0) return str;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    let v = (str.charCodeAt(i) - key.charCodeAt(i % key.length)) & 0xff;
    v = ((v << 3) | (v >> 5)) & 0xff;
    out += String.fromCharCode(v);
  }
  return out;
}

export function _qb2(str, key) {
  if (key.length === 0) return reverse(str);
  let out = '';
  for (let i = 0; i < str.length; i++) {
    out += String.fromCharCode((str.charCodeAt(i) ^ key.charCodeAt((2 * i) % key.length)) & 0xff);
  }
  return reverse(out);
}

export function _qc2(str, key) {
  if (key.length === 0) return str;
  let out = '';
  for (let i = 0; i < str.length; i++) {
    let v = (str.charCodeAt(i) + key.charCodeAt((i + 5) % key.length) + (i & 0xff)) & 0xff;
    v = (((v & 0x0f) << 4) | ((v & 0xf0) >> 4)) & 0xff;
    out += String.fromCharCode(v);
  }
  return out;
}

// panel.currBoss / _loc7 : hex(_qc(_qb(_qa(value, q7), q7), q7))
export function huntBossToken(value, key) {
  if (!value || !key) return '';
  return hexEncode(_qc(_qb(_qa(value, key), key), key));
}

// char.battleLog : hex(_qc2(_qb2(_qa2(value, q7f), q7f), q7f))
export function huntBattleLog(value, key) {
  if (!value || !key) return '';
  return hexEncode(_qc2(_qb2(_qa2(value, key), key), key));
}

const _EH_KEY = [91, 53, 116, 44, 75, 110, 36, 58, 71, 126, 46, 50, 90, 73, 115, 61];

// Battle._eh(str): 10-byte nonce + keystream, hex encoded
export function eh(str) {
  const data = toBytes(str);
  const nonce = crypto.randomBytes(10);
  let k = 0;
  for (let i = 0; i < data.length; i++) {
    k = (k ^ _EH_KEY[i % 16] ^ nonce[i % 10]) & 0xff;
    data[i] = (data[i] ^ k) & 0xff;
    data[i] = (data[i] + _EH_KEY[(i * 3 + k) % 16]) & 0xff;
    k = (k + data[i] + i * 11) & 0xff;
  }
  let out = '';
  for (let i = 0; i < 10; i++) out += nonce[i].toString(16).padStart(2, '0');
  for (let i = 0; i < data.length; i++) out += (data[i] & 0xff).toString(16).padStart(2, '0');
  return out;
}

// ---------------------------------------------------------------------------
// DataParser _dx / _kv  ->  buildKq / gk
// ---------------------------------------------------------------------------

const _KT = [
  '69612e383d3a0e2e043d3e3636052c3e3138302b',
  '6a61352e192d012a33353e',
  '6f6124303f2c526a6a680e2e3a033b32300f3b2801283f',
  '6b612f293f2b09292f353e013d012e2f3038',
  '6e61313c2e000b3f22',
  '68613d313200052c3e322901330f3d3232023a3e143b',
];

export function _dx(hex) {
  let out = '';
  let j = 0;
  for (let i = 0; i + 1 < hex.length; i += 2) {
    const b = Number.parseInt(hex.substr(i, 2), 16);
    out += String.fromCharCode((b ^ ((90 + (j % 7)) & 0xff)) & 0xff);
    j++;
  }
  return out;
}

export function _kv(str) {
  const alphabet = 'GhKmNpRtVwYzJqSx';
  let out = '';
  for (let i = 0; i < str.length; i++) {
    const idx = alphabet.indexOf(str.charAt(i));
    out += idx < 0 ? str.charAt(i) : '0123456789abcdef'.charAt(idx);
  }
  return out;
}

export function buildKq(extraData) {
  const kq = [];
  for (const hex of _KT) {
    const decoded = _dx(hex);
    const sep = decoded.indexOf(':');
    const index = Number.parseInt(decoded.substring(0, sep), 10);
    const field = decoded.substring(sep + 1);
    kq[index] = extraData && extraData[field] !== null && extraData[field] !== undefined ? _kv(String(extraData[field])) : '';
  }
  return kq;
}

export function gk(state, n) {
  const kq = (state && state.kq) || [];
  const idx = (((n % 6) + 6) % 6);
  return kq[idx] !== null && kq[idx] !== undefined ? String(kq[idx]) : '';
}

// ---------------------------------------------------------------------------
// Mission state-hash chain (setMission -> setEventData -> completeMission)
// ---------------------------------------------------------------------------

function defaultClipString(missionId) {
  const m = /^msn(\d+)$/i.exec(String(missionId || '').trim());
  return m ? `[object Mission_${Number.parseInt(m[1], 10)}]` : '[object MovieClip]';
}

export function missionSetState(state, missionId) {
  const clip = state.mission_clip_string || defaultClipString(missionId);
  const prev = state.mission_state_hash === undefined || state.mission_state_hash === null ? 'null' : state.mission_state_hash;
  state.mission_id = missionId;
  state.mission_state = 1;
  state.mission_clip_string = clip;
  state.mission_state_hash = getHash(sessionKeyOf(), `${state.mission_state}_setMission_${clip}_${prev}`);
  return state.mission_state_hash;
}

export function missionAdvanceEvent(state) {
  const current = String(state.mission_state_hash || '');
  state.mission_state = 2;
  state.mission_state_hash = getHash(sessionKeyOf(), `${state.mission_state}_setEventData_${current}`);
  return state.mission_state_hash;
}

export function missionCompleteState(state) {
  const current = String(state.mission_state_hash || '');
  const missionState = Number.parseInt(state.mission_state || 2, 10) || 2;
  state.mission_state = missionState + 1;
  state.mission_state_hash = getHash(sessionKeyOf(), `${state.mission_state}_completeMission_${current}`);
  return state.mission_state_hash;
}

export const internals = { toBytes, fromBytes, reverse, hexEncode, sessionKeyOf, _zrb, br, huntBossToken, huntBattleLog, eh };
