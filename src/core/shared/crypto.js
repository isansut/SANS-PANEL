import crypto from 'node:crypto';

// ---------------------------------------------------------------------------
// Hashing helpers
// ---------------------------------------------------------------------------

export function sha1Hex(value) {
  return crypto.createHash('sha1').update(String(value), 'utf8').digest('hex');
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

export function hmacSha256Hex(key, message) {
  const keyBuf = Buffer.isBuffer(key) ? key : Buffer.from(String(key), 'utf8');
  return crypto.createHmac('sha256', keyBuf).update(String(message), 'utf8').digest('hex');
}

// ---------------------------------------------------------------------------
// IntUtil / CUCSG  (custom SHA-256 port of core/shared/utils.py)
// ---------------------------------------------------------------------------

export class IntUtil {
  static ror(value, shift) {
    return ((value >>> shift) | (value << (32 - shift))) >>> 0;
  }

  static toHex(value) {
    return (value >>> 0).toString(16).padStart(8, '0');
  }
}

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function ensureLen(arr, len) {
  while (arr.length < len) arr.push(0);
}

export class CUCSG {
  static hash(param1) {
    const blocks = CUCSG.createBlocksFromString(param1);
    return CUCSG._digestFromBlocks(blocks);
  }

  static hashBytes(param1) {
    const blocks = CUCSG.createBlocksFromByteArray(param1);
    return CUCSG._digestFromBlocks(blocks);
  }

  static _digestFromBlocks(blocks) {
    const out = CUCSG.hashBlocks(blocks);
    let result = '';
    for (let i = 0; i < 8; i++) {
      const value = out.readInt32BE(i * 4);
      result += IntUtil.toHex(value);
    }
    return result;
  }

  static hashBlocks(param1) {
    let h0 = 0x6a09e667 >>> 0;
    let h1 = 0xbb67ae85 >>> 0;
    let h2 = 0x3c6ef372 >>> 0;
    let h3 = 0xa54ff53a >>> 0;
    let h4 = 0x510e527f >>> 0;
    let h5 = 0x9b05688c >>> 0;
    let h6 = 0x1f83d9ab >>> 0;
    let h7 = 0x5be0cd19 >>> 0;

    const w = new Array(64).fill(0);
    const len = param1.length;

    for (let off = 0; off < len; off += 16) {
      let a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, h = h7;

      for (let i = 0; i < 64; i++) {
        if (i < 16) {
          const raw = param1[off + i];
          w[i] = (raw === undefined || raw === null ? 0 : raw) >>> 0;
        } else {
          const x = (IntUtil.ror(w[i - 15], 7) ^ IntUtil.ror(w[i - 15], 18) ^ (w[i - 15] >>> 3)) >>> 0;
          const y = (IntUtil.ror(w[i - 2], 17) ^ IntUtil.ror(w[i - 2], 19) ^ (w[i - 2] >>> 10)) >>> 0;
          w[i] = (w[i - 16] + x + w[i - 7] + y) >>> 0;
        }

        const s0 = (IntUtil.ror(a, 2) ^ IntUtil.ror(a, 13) ^ IntUtil.ror(a, 22)) >>> 0;
        const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
        const t2 = (s0 + maj) >>> 0;

        const s1 = (IntUtil.ror(e, 6) ^ IntUtil.ror(e, 11) ^ IntUtil.ror(e, 25)) >>> 0;
        const ch = ((e & f) ^ (~e & g)) >>> 0;
        const t1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;

        h = g; g = f; f = e;
        e = (d + t1) >>> 0;
        d = c; c = b; b = a;
        a = (t1 + t2) >>> 0;
      }

      h0 = (h0 + a) >>> 0;
      h1 = (h1 + b) >>> 0;
      h2 = (h2 + c) >>> 0;
      h3 = (h3 + d) >>> 0;
      h4 = (h4 + e) >>> 0;
      h5 = (h5 + f) >>> 0;
      h6 = (h6 + g) >>> 0;
      h7 = (h7 + h) >>> 0;
    }

    const buf = Buffer.alloc(32);
    buf.writeUInt32BE(h0 >>> 0, 0);
    buf.writeUInt32BE(h1 >>> 0, 4);
    buf.writeUInt32BE(h2 >>> 0, 8);
    buf.writeUInt32BE(h3 >>> 0, 12);
    buf.writeUInt32BE(h4 >>> 0, 16);
    buf.writeUInt32BE(h5 >>> 0, 20);
    buf.writeUInt32BE(h6 >>> 0, 24);
    buf.writeUInt32BE(h7 >>> 0, 28);
    return buf;
  }

  static createBlocksFromString(param1) {
    const words = [];
    const bitLen = param1.length * 8;
    let loc5 = 0;
    while (loc5 < bitLen) {
      const index = loc5 >> 5;
      ensureLen(words, index + 1);
      const charPos = loc5 >> 3;
      const charCode = charPos < param1.length ? param1.charCodeAt(charPos) : 0;
      const shift = 24 - (loc5 % 32);
      words[index] = (words[index] | ((charCode & 0xff) << shift)) >>> 0;
      loc5 += 8;
    }
    CUCSG._pad(words, bitLen);
    return words;
  }

  static createBlocksFromByteArray(param1) {
    const words = [];
    const bitLen = param1.length * 8;
    let loc6 = 0;
    while (loc6 < bitLen) {
      const index = loc6 >> 5;
      ensureLen(words, index + 1);
      const bytePos = loc6 >> 3;
      const byteVal = bytePos < param1.length ? param1[bytePos] : 0;
      const shift = 24 - (loc6 % 32);
      words[index] = (words[index] | ((byteVal & 0xff) << shift)) >>> 0;
      loc6 += 8;
    }
    CUCSG._pad(words, bitLen);
    return words;
  }

  static _pad(words, bitLen) {
    const index = bitLen >> 5;
    ensureLen(words, index + 1);
    words[index] = (words[index] | (0x80 << (24 - (bitLen % 32)))) >>> 0;

    const finalIndex = ((((bitLen + 64) >> 9) << 4) + 15);
    ensureLen(words, finalIndex + 1);
    words[finalIndex] = bitLen;
  }
}

// ---------------------------------------------------------------------------
// PM_PRNG (ActionScript port)
// ---------------------------------------------------------------------------

export class PM_PRNG {
  constructor(seed = null) {
    this._modulus = 2147483647;
    this._multiplier = 16807;
    if (seed === null || seed === undefined) {
      const currentTime = Date.now();
      const randomValue = Math.floor(Math.random() * 0.025 * (2 ** 31 - 1));
      this.seed = Number(BigInt(currentTime) ^ BigInt(randomValue));
    } else {
      this.seed = Math.trunc(seed);
    }
    if (this.seed <= 0 || this.seed >= this._modulus) {
      this.seed = 1;
    }
  }

  gen() {
    this.seed = (this.seed * this._multiplier) % this._modulus;
    return this.seed;
  }

  nextInt() {
    return this.gen();
  }

  nextDouble() {
    return this.gen() / this._modulus;
  }

  nextIntRange(low, high) {
    const lowAdj = low - 0.4999;
    const highAdj = high + 0.4999;
    return Math.round(lowAdj + (highAdj - lowAdj) * this.nextDouble());
  }

  nextDoubleRange(low, high) {
    const val = this.gen() / this._modulus;
    return low + (high - low) * val;
  }
}

export function getRandomNSeed(param1, bytesLoaded) {
  if (!bytesLoaded) return '';
  const seedVal = param1 % bytesLoaded;
  const prng = new PM_PRNG(seedVal);
  let result = '';
  for (let i = 0; i < 4; i++) result += String(prng.nextInt());
  return result;
}

// ---------------------------------------------------------------------------
// AES helpers
// ---------------------------------------------------------------------------

export function aesEcbDecryptRaw(key, dataBuf) {
  const decipher = crypto.createDecipheriv('aes-128-ecb', key, null);
  decipher.setAutoPadding(false);
  return Buffer.concat([decipher.update(dataBuf), decipher.final()]);
}

export function aesEcbEncryptRaw(key, dataBuf) {
  const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(dataBuf), cipher.final()]);
}

function pkcs5Pad(buf, blockSize = 16) {
  const padLen = blockSize - (buf.length % blockSize);
  return Buffer.concat([buf, Buffer.alloc(padLen, padLen)]);
}

export class Crypt {
  static encrypt(password, key1, key2Str) {
    const iv = pkcs5Pad(Buffer.from(key2Str, 'utf8'), 16);
    const key = Buffer.from(key1, 'utf8');
    const cipher = crypto.createCipheriv('aes-128-cbc', key, iv);
    const enc = Buffer.concat([cipher.update(Buffer.from(password, 'utf8')), cipher.final()]);
    return enc.toString('base64');
  }

  static decrypt(encryptedData, key1, key2Str) {
    const iv = pkcs5Pad(Buffer.from(key2Str, 'utf8'), 16);
    const key = Buffer.from(key1, 'utf8');
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    const dec = Buffer.concat([decipher.update(Buffer.from(encryptedData, 'base64')), decipher.final()]);
    return dec.toString('utf8');
  }
}
