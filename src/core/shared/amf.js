import { CookieJar } from 'tough-cookie';
import fetchCookie from 'fetch-cookie';

// ---------------------------------------------------------------------------
// Shared HTTP sessions (mirrors _HTTP_SESSIONS in core/shared/utils.py)
// ---------------------------------------------------------------------------

const _HTTP_SESSIONS = new Map();

export class HttpSession {
  constructor(baseHeaders = {}) {
    this.jar = new CookieJar();
    this.fetch = fetchCookie(globalThis.fetch, this.jar);
    this.headers = { ...baseHeaders };
  }

  async get(url, options = {}) {
    return this.fetch(url, {
      ...options,
      method: 'GET',
      headers: { ...this.headers, ...(options.headers || {}) },
    });
  }

  async post(url, options = {}) {
    return this.fetch(url, {
      ...options,
      method: 'POST',
      headers: { ...this.headers, ...(options.headers || {}) },
    });
  }
}

export function getHttpSession(key, baseHeaders = {}) {
  let session = _HTTP_SESSIONS.get(key);
  if (!session) {
    session = new HttpSession(baseHeaders);
    _HTTP_SESSIONS.set(key, session);
  }
  return session;
}

// ---------------------------------------------------------------------------
// AMF3 writer / reader
// ---------------------------------------------------------------------------

class AMF3Writer {
  constructor() {
    this.chunks = [];
    this.stringRefs = new Map();
    this.objectRefs = [];
    this.traitRefs = [];
  }

  _u8(v) { this.chunks.push(Buffer.from([v & 0xff])); }
  _buf(b) { this.chunks.push(Buffer.from(b)); }

  _u29(n) {
    n = n & 0x1fffffff;
    if (n < 0x80) return this._u8(n);
    if (n < 0x4000) return this._buf([0x80 | (n >> 7), n & 0x7f]);
    if (n < 0x200000) return this._buf([0x80 | (n >> 14), 0x80 | ((n >> 7) & 0x7f), n & 0x7f]);
    return this._buf([0x80 | (n >> 22), 0x80 | ((n >> 15) & 0x7f), 0x80 | ((n >> 8) & 0x7f), n & 0xff]);
  }

  writeElement(data) {
    if (data === undefined) return this._u8(0x00);
    if (data === null) return this._u8(0x01);
    if (data === false) return this._u8(0x02);
    if (data === true) return this._u8(0x03);
    if (typeof data === 'number') {
      if (Number.isInteger(data) && data >= -0x10000000 && data <= 0x0fffffff) {
        this._u8(0x04);
        return this._u29(data);
      }
      this._u8(0x05);
      const b = Buffer.alloc(8);
      b.writeDoubleBE(data);
      return this._buf(b);
    }
    if (typeof data === 'string') { this._u8(0x06); return this._writeString(data); }
    if (Buffer.isBuffer(data)) return this._writeByteArray(data);
    if (Array.isArray(data)) return this._writeArray(data);
    if (typeof data === 'object') return this._writeObject(data);
    throw new Error(`AMF3 cannot encode ${typeof data}`);
  }

  _writeString(s) {
    if (s === '') return this._u29(1);
    if (this.stringRefs.has(s)) {
      return this._u29(this.stringRefs.get(s) << 1);
    }
    this.stringRefs.set(s, this.stringRefs.size);
    const b = Buffer.from(s, 'utf8');
    this._u29((b.length << 1) | 1);
    this._buf(b);
  }

  _writeByteArray(b) {
    this._u8(0x0c);
    this._u29((b.length << 1) | 1);
    this._buf(b);
  }

  _writeArray(a) {
    this._u8(0x09);
    this._u29((a.length << 1) | 1);
    this._writeString(''); // associative terminator (before dense elements)
    for (const v of a) this.writeElement(v);
  }

  _writeObject(o) {
    this._u8(0x0a);
    const keys = Object.keys(o).filter((k) => k !== '__class');
    this._u29((keys.length << 4) | 11); // traits: inline + dynamic, count=keys.length
    this._writeString(''); // anonymous class name
    for (const k of keys) this._writeString(k);
    for (const k of keys) this.writeElement(o[k]);
    this._writeString(''); // dynamic terminator
  }

  toBuffer() {
    return Buffer.concat(this.chunks);
  }
}

class AMF3Reader {
  constructor(reader) { this.r = reader; }

  clear() {
    this.r.amf3StringRefs = [];
    this.r.amf3ObjectRefs = [];
    this.r.amf3TraitRefs = [];
  }

  _u29() {
    let n = 0;
    for (let i = 0; i < 3; i++) {
      const b = this.r.u8();
      n = (n << 7) | (b & 0x7f);
      if (!(b & 0x80)) return n;
    }
    const b = this.r.u8();
    return ((n << 8) | b) >>> 0;
  }

  readElement() {
    const marker = this.r.u8();
    switch (marker) {
      case 0x00: return undefined;
      case 0x01: return null;
      case 0x02: return false;
      case 0x03: return true;
      case 0x04: {
        let n = this._u29();
        if (n & 0x10000000) n -= 0x20000000;
        return n;
      }
      case 0x05: return this.r.readDouble();
      case 0x06: return this._readString();
      case 0x07: return this._readXmlDoc();
      case 0x08: return this._readDate();
      case 0x09: return this._readArray();
      case 0x0a: return this._readObject();
      case 0x0b: return this._readXml();
      case 0x0c: return this._readByteArray();
      default:
        throw new Error(`AMF3 unknown marker 0x${marker.toString(16)}`);
    }
  }

  _readString() {
    const u = this._u29();
    if (!(u & 1)) return this.r.amf3StringRefs[u >> 1];
    const len = u >> 1;
    if (len === 0) return '';
    const s = this.r.readBuffer(len).toString('utf8');
    this.r.amf3StringRefs.push(s);
    return s;
  }

  _readByteArray() {
    const u = this._u29();
    if (!(u & 1)) return this.r.amf3ObjectRefs[u >> 1];
    const len = u >> 1;
    const buf = Buffer.from(this.r.readBuffer(len));
    this.r.amf3ObjectRefs.push(buf);
    return buf;
  }

  _readDate() {
    const u = this._u29();
    if (!(u & 1)) return this.r.amf3ObjectRefs[u >> 1];
    const ms = this.r.readDouble();
    const d = new Date(ms);
    this.r.amf3ObjectRefs.push(d);
    return d;
  }

  _readArray() {
    const u = this._u29();
    if (!(u & 1)) return this.r.amf3ObjectRefs[u >> 1];
    const count = u >> 1;
    const arr = [];
    this.r.amf3ObjectRefs.push(arr);
    // Associative (string-keyed) portion comes first, terminated by an empty string.
    while (true) {
      const key = this._readString();
      if (key === '') break;
      arr[key] = this.readElement();
    }
    // Then the dense (integer-indexed) elements.
    for (let i = 0; i < count; i++) arr.push(this.readElement());
    return arr;
  }

  _readObject() {
    const u = this._u29();
    if (!(u & 1)) return this.r.amf3ObjectRefs[u >> 1];

    let traits;
    if (!((u >> 1) & 1)) {
      traits = this.r.amf3TraitRefs[u >> 2];
    } else {
      const encoding = (u >> 2) & 0x03; // 0=static, 1=external, 2=dynamic, 3=proxy
      if (encoding === 1 || encoding === 3) {
        throw new Error('AMF3 externalizable/proxy objects are not supported');
      }
      const externalizable = encoding === 1;
      const dynamic = encoding === 2;
      const count = u >> 4;
      const className = this._readString();
      const members = [];
      for (let i = 0; i < count; i++) members.push(this._readString());
      traits = { className, dynamic, externalizable, members };
      this.r.amf3TraitRefs.push(traits);
    }

    const obj = {};
    if (traits.className) obj.__class = traits.className;
    this.r.amf3ObjectRefs.push(obj);

    for (const m of traits.members) obj[m] = this.readElement();
    if (traits.dynamic) {
      while (true) {
        const k = this._readString();
        if (k === '') break;
        obj[k] = this.readElement();
      }
    }
    return obj;
  }

  _readXml() {
    const u = this._u29();
    if (!(u & 1)) return this.r.amf3ObjectRefs[u >> 1];
    const len = u >> 1;
    const s = this.r.readBuffer(len).toString('utf8');
    this.r.amf3ObjectRefs.push(s);
    return s;
  }

  _readXmlDoc() {
    return this._readXml();
  }
}

// ---------------------------------------------------------------------------
// AMF0 reader / writer (used for the remoting envelope)
// ---------------------------------------------------------------------------

class Reader {
  constructor(buffer) {
    this.buf = buffer;
    this.pos = 0;
    this.amf0Refs = [];
    this.amf3 = new AMF3Reader(this);
    this.amf3StringRefs = [];
    this.amf3ObjectRefs = [];
    this.amf3TraitRefs = [];
  }

  remaining() { return this.buf.length - this.pos; }

  u8() { return this.buf[this.pos++]; }

  u16() { const v = this.buf.readUInt16BE(this.pos); this.pos += 2; return v; }

  i16() { const v = this.buf.readInt16BE(this.pos); this.pos += 2; return v; }

  u32() { const v = this.buf.readUInt32BE(this.pos); this.pos += 4; return v; }

  readDouble() { const v = this.buf.readDoubleBE(this.pos); this.pos += 8; return v; }

  readBuffer(n) { const b = this.buf.subarray(this.pos, this.pos + n); this.pos += n; return b; }

  readShortString() {
    const len = this.u16();
    return this.readBuffer(len).toString('utf8');
  }

  resetContext() {
    this.amf0Refs = [];
    this.amf3.clear();
  }

  readElement() {
    const marker = this.u8();
    switch (marker) {
      case 0x00: return this.readDouble();
      case 0x01: return this.u8() !== 0;
      case 0x02: return this.readShortString();
      case 0x03: return this.readObject();
      case 0x05: return null;
      case 0x06: return undefined;
      case 0x07: return this.amf0Refs[this.u16()];
      case 0x08: return this.readMixedArray();
      case 0x0a: return this.readList();
      case 0x0b: { const ms = this.readDouble(); this.u16(); return new Date(ms / 1000); }
      case 0x0c: { const len = this.u32(); return this.readBuffer(len).toString('utf8'); }
      case 0x0f: { const len = this.u32(); return this.readBuffer(len).toString('utf8'); }
      case 0x10: return this.readTypedObject();
      case 0x11: return this.amf3.readElement();
      default:
        throw new Error(`AMF0 unknown marker 0x${marker.toString(16)}`);
    }
  }

  readObject() {
    const obj = {};
    this.amf0Refs.push(obj);
    while (true) {
      const key = this.readShortString();
      if (this.buf[this.pos] === 0x09) { this.pos++; break; }
      obj[key] = this.readElement();
    }
    return obj;
  }

  readTypedObject() {
    const className = this.readShortString();
    const obj = { __class: className };
    this.amf0Refs.push(obj);
    while (true) {
      const key = this.readShortString();
      if (this.buf[this.pos] === 0x09) { this.pos++; break; }
      obj[key] = this.readElement();
    }
    return obj;
  }

  readMixedArray() {
    const obj = {};
    this.amf0Refs.push(obj);
    this.u32();
    while (true) {
      const key = this.readShortString();
      if (this.buf[this.pos] === 0x09) { this.pos++; break; }
      obj[key] = this.readElement();
    }
    return obj;
  }

  readList() {
    const arr = [];
    this.amf0Refs.push(arr);
    const len = this.u32();
    for (let i = 0; i < len; i++) arr.push(this.readElement());
    return arr;
  }
}

function amf0WriteShortString(str) {
  const b = Buffer.from(str, 'utf8');
  const header = Buffer.alloc(2);
  header.writeUInt16BE(b.length);
  return Buffer.concat([header, b]);
}

function amf0WriteElement(data) {
  if (data === null || data === undefined) return Buffer.from([0x05]);
  if (typeof data === 'boolean') return Buffer.from([0x01, data ? 1 : 0]);
  if (typeof data === 'number') {
    const b = Buffer.alloc(9);
    b[0] = 0x00;
    b.writeDoubleBE(data, 1);
    return b;
  }
  if (typeof data === 'string') {
    const bytes = Buffer.from(data, 'utf8');
    if (bytes.length > 0xffff) {
      const header = Buffer.alloc(5);
      header[0] = 0x0c;
      header.writeUInt32BE(bytes.length, 1);
      return Buffer.concat([header, bytes]);
    }
    return Buffer.concat([Buffer.from([0x02]), amf0WriteShortString(data)]);
  }
  if (Array.isArray(data)) {
    const parts = [Buffer.from([0x0a])];
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    parts.push(len);
    for (const item of data) parts.push(amf0WriteElement(item));
    return Buffer.concat(parts);
  }
  if (typeof data === 'object') {
    const writer = new AMF3Writer();
    writer.writeElement(data);
    return Buffer.concat([Buffer.from([0x11]), writer.toBuffer()]);
  }
  return Buffer.from([0x05]);
}

// ---------------------------------------------------------------------------
// Remoting encode / decode
// ---------------------------------------------------------------------------

/**
 * Encode a remoting Request.
 * @param {string} method - target service (e.g. "SystemService.login")
 * @param {Array} bodyArray - array of positional args (message.body)
 * @param {{headers?: Array<{name: string, required?: boolean, value: any}>}} [options]
 */
export function encodeRequest(method, bodyArray, options = {}) {
  const headers = Array.isArray(options.headers) ? options.headers : [];
  const parts = [];
  const version = Buffer.alloc(2);
  version.writeUInt16BE(3);
  parts.push(version);

  const headerCount = Buffer.alloc(2);
  headerCount.writeUInt16BE(headers.length);
  parts.push(headerCount);

  for (const header of headers) {
    parts.push(amf0WriteShortString(String(header.name)));
    parts.push(Buffer.from([header.required ? 1 : 0]));
    const value = amf0WriteElement(header.value);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(value.length);
    parts.push(length);
    parts.push(value);
  }

  const bodyCount = Buffer.alloc(2);
  bodyCount.writeUInt16BE(1);
  parts.push(bodyCount);

  parts.push(amf0WriteShortString(method));
  parts.push(amf0WriteShortString('/0'));

  const length = Buffer.alloc(4);
  length.writeUInt32BE(0); // non-strict
  parts.push(length);

  parts.push(Buffer.from([0x0a]));
  const argCount = Buffer.alloc(4);
  argCount.writeUInt32BE(bodyArray.length);
  parts.push(argCount);
  for (const arg of bodyArray) parts.push(amf0WriteElement(arg));

  return Buffer.concat(parts);
}

const STATUS_SUFFIXES = ['/onResult', '/onStatus', '/onDebugEvents'];

export function decodeRemoting(buffer) {
  const r = new Reader(buffer);
  const version = r.u16();
  if (version > 0x09) throw new Error(`Malformed stream (amfVersion=${version})`);

  const headerCount = r.u16();
  const headers = [];
  for (let i = 0; i < headerCount; i++) {
    const name = r.readShortString();
    const required = !!r.u8();
    r.u32();
    const value = r.readElement();
    headers.push({ name, required, value });
  }

  const bodyCount = r.i16();
  const bodies = [];
  for (let i = 0; i < bodyCount; i++) {
    r.resetContext();
    let target = r.readShortString();
    const response = r.readShortString();
    r.u32();

    let status = 0;
    let isRequest = true;
    for (let s = 0; s < STATUS_SUFFIXES.length; s++) {
      if (target.endsWith(STATUS_SUFFIXES[s])) {
        isRequest = false;
        status = s;
        target = target.slice(0, target.length - STATUS_SUFFIXES[s].length);
        break;
      }
    }

    let data;
    if (isRequest) {
      if (r.u8() !== 0x0a) throw new Error('Array type required for request body');
      const count = r.u32();
      data = [];
      for (let j = 0; j < count; j++) data.push(r.readElement());
    } else {
      data = r.readElement();
    }
    bodies.push({ target, response, status, isRequest, data });
  }

  return { version, headers, bodies };
}
