// NinjaSaga.online (ninjasaga.online) driver: login + character list.
// Protocol reverse-engineered from the official LiveV9 SWF client
// (SystemLogin service on https://ninjasaga.online/amf).
import { createCipheriv, createHash } from "node:crypto";
import { HttpSession, encodeRequest, decodeRemoting } from "../shared/amf.js";

export const NSO_GATEWAY = "https://ninjasaga.online/amf";
// Decompressed main.swf byte size the official client reports.
export const NSO_SWF_BYTES = 50326707;
// Item levels from public game_data/library.bin (used by the login fingerprint).
const NSO_HAIR_1 = 1;
const NSO_HAIR_0 = 1;
const NSO_ACC_2003 = 40;

const HEADERS = {
  "User-Agent": "Mozilla/5.0",
  Referer: "https://ninjasaga.online/",
  Origin: "https://ninjasaga.online",
};

function pkcs5pad(buf, block = 16) {
  const p = block - (buf.length % block);
  return Buffer.concat([buf, Buffer.alloc(p, p)]);
}

// id.ninjasage.Crypt.encrypt: AES-128-CBC, key=challenge, iv=pkcs5(version)
export function nsoEncryptPassword(password, challenge, version) {
  const cipher = createCipheriv(
    "aes-128-cbc",
    Buffer.from(challenge, "utf8"),
    pkcs5pad(Buffer.from(String(version), "utf8")).subarray(0, 16)
  );
  return Buffer.concat([
    cipher.update(Buffer.from(password, "utf8")),
    cipher.final(),
  ]).toString("base64");
}

// id.ninjasage PM_PRNG (Park-Miller) seeded replica for getRandomNSeed.
export function nsoRandomNSeed(version, bytesLoaded = NSO_SWF_BYTES) {
  let seed = Number(version) % bytesLoaded;
  let out = "";
  for (let i = 0; i < 4; i++) {
    seed = (seed * 16807) % 2147483647;
    out += String(seed);
  }
  return out;
}

// Storage.Library.getSpecificItem("duar") fingerprint replica.
export function nsoFingerprint(version, bytesLoaded = NSO_SWF_BYTES, bytesTotal = NSO_SWF_BYTES) {
  const v = Number(version);
  let head = (bytesTotal ^ bytesLoaded) + 1337;
  head = head ^ v;
  head = head ^ (1337 + 1337);
  head = head ^ v;
  head = head ^ (1337 + 1337);
  head = head ^ (0x0539 & ((bytesLoaded % NSO_HAIR_1) % bytesLoaded) & bytesTotal);
  const tail = ((NSO_HAIR_0 % v) % 1333777) + NSO_ACC_2003;
  const inner = String(head ^ tail);
  const hash = createHash("sha256").update(inner, "utf8").digest("hex");
  return String(v) + hash + String(v).repeat(4);
}

export function createNsoSession() {
  return new HttpSession({ ...HEADERS });
}

async function nsoCall(session, method, args) {
  const resp = await session.post(NSO_GATEWAY, {
    body: encodeRequest(method, args, { objectMode: "ecma" }),
    headers: { "Content-Type": "application/x-amf" },
    timeout: 25000,
  });
  const buf = Buffer.from(await resp.arrayBuffer());
  if (resp.status !== 200 || !buf.length) {
    throw new Error(`NSO ${method}: HTTP ${resp.status} ${buf.toString("utf8").slice(0, 120)}`);
  }
  return decodeRemoting(buf).bodies?.[0]?.data;
}

export { nsoCall };

export async function nsoLogin(session, username, password) {
  const cv = await nsoCall(session, "SystemLogin.checkVersion", []);
  if (!cv || cv.error !== 0) throw new Error("NSO checkVersion failed");
  const ver = cv._;
  const chall = cv.__;
  const enc = nsoEncryptPassword(password, chall, ver);
  const loaded = NSO_SWF_BYTES;
  const args = [
    username,
    enc,
    ver,
    loaded,
    loaded,
    chall,
    nsoFingerprint(ver, loaded, loaded),
    nsoRandomNSeed(ver, loaded),
    password.length,
  ];
  const res = await nsoCall(session, "SystemLogin.loginUser", args);
  if (!res || res.status !== 1) {
    throw new Error(`NSO login failed: ${(res && (res.errorMessage || res.error)) || "unknown"}`);
  }
  return res; // {status, uid, sessionkey, hash, ...}
}

export async function nsoGetAllCharacters(session, uid, sessionkey) {
  const res = await nsoCall(session, "SystemLogin.getAllCharacters", [uid, sessionkey]);
  if (!res || res.status !== 1) {
    throw new Error(`NSO getAllCharacters failed: ${(res && (res.errorMessage || res.error)) || "unknown"}`);
  }
  return res;
}

export async function nsoGetCharacterData(session, charId, sessionkey) {
  const res = await nsoCall(session, "SystemLogin.getCharacterData", [charId, sessionkey]);
  if (!res || res.status !== 1) {
    throw new Error(`NSO getCharacterData failed: ${(res && (res.errorMessage || res.error)) || "unknown"}`);
  }
  return res;
}
