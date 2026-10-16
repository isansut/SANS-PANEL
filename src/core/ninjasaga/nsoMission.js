// NSO auto-mission loop (leveling) for NinjaSaga.online.
// Strategy: highest mission at/below char level -> start -> finish with
// exact-kill damage + valid battleHash -> repeat until stopped.
import { createHash } from "node:crypto";
import { HttpSession, encodeRequest, decodeRemoting } from "../shared/amf.js";
import config from "../config.js";
import { createNsoSession, nsoLogin } from "./nso.js";
import { runChuninExam } from "./nsoExam.js";

const GW = "https://ninjasaga.online/amf";
const BSECRET = "8cbb9ea506e1e3c75472037ad267b83d0d904c582b6acbdc78a10a8bb1e743d5";
const SWF_BYTES = 50326707;
const bhash = (s) => createHash("sha256").update(s + BSECRET, "utf8").digest("hex");

let missionCache = null;
let enemyCache = null;

async function fetchAsset(name) {
  const r = await fetch(`https://ninjasaga.online/game_data/${name}.bin?v=${Date.now()}`, {
    headers: { "User-Agent": "Mozilla/5.0", Referer: "https://ninjasaga.online/" },
  });
  if (!r.ok) throw new Error(`asset ${name}: HTTP ${r.status}`);
  const { inflateSync } = await import("node:zlib");
  const buf = Buffer.from(await r.arrayBuffer());
  return JSON.parse(inflateSync(buf).toString("utf8"));
}

async function gameAssets() {
  if (!missionCache) {
    const [m, e] = await Promise.all([fetchAsset("mission"), fetchAsset("enemy")]);
    const mlist = Array.isArray(m) ? m : Object.values(m);
    const elist = Array.isArray(e) ? e : Object.values(e);
    missionCache = mlist;
    enemyCache = new Map(elist.map((x) => [x.id, x]));
  }
  return { missions: missionCache, enemies: enemyCache };
}

function pickMission(missions, level) {
  const ok = missions.filter(
    (m) => m && m.id && Array.isArray(m.enemies) && m.enemies.length > 0 &&
      (m.level ?? 999) <= level && !m.premium
  );
  ok.sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  return ok[0] || null;
}

function stopped() {
  const stopEvent = config.stopEvent;
  return !!(stopEvent && stopEvent.isSet && stopEvent.isSet());
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function nsoLeveling(session) {
  const log = (msg, type = "info") => {
    try {
      config.actionLogCallback?.(msg, type);
    } catch {}
    console.log(msg);
  };
  const profile = config.getNinjasagaAntiDetectionProfile(
    (config._settingsFor && config._settingsFor("ninjasaga")) || {}
  );
  const delayS = Math.max(0, Number(profile.action_delay_seconds) || 0);
  const cdS = Math.max(0, Number(profile.cycle_cooldown_seconds) || 0);

  const http = session.nso_http || createNsoSession();
  session.nso_http = http;
  let uid = session.nso_login?.uid;
  let skey = session.nso_login?.sessionkey;
  if (!uid || !skey) throw new Error("NSO session missing — login ulang dulu.");

  const call = async (method, args, retry = true) => {
    const resp = await http.post(GW, {
      body: encodeRequest(method, args, { objectMode: "ecma" }),
      headers: { "Content-Type": "application/x-amf" },
      timeout: 25000,
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    if (resp.status !== 200 || !buf.length) throw new Error(`NSO ${method}: HTTP ${resp.status}`);
    const data = decodeRemoting(buf).bodies?.[0]?.data;
    // Session key expired mid-run -> silent relogin once, then retry the call.
    if (data && data.status === 0 && /invalid session key/i.test(String(data.error || "")) && retry) {
      const creds = session.nso_creds;
      if (!creds?.username || !creds?.password) throw new Error("NSO session expired, login ulang dulu.");
      log("🔄 Session expired, relogin...", "warning");
      const fresh = await nsoLogin(http, creds.username, creds.password);
      session.nso_login = { uid: fresh.uid, sessionkey: fresh.sessionkey };
      skey = fresh.sessionkey;
      return call(method, args, false);
    }
    return data;
  };

  const { missions, enemies } = await gameAssets();
  log(`NSO leveling: ${missions.length} misi, ${enemies.size} musuh loaded.`);

  let cycle = 0;
  let zeroXpStreak = 0;
  for (;;) {
    if (stopped()) {
      log("⏹ Stopped.");
      return;
    }
    cycle++;
    const ch = await call("SystemLogin.getCharacterData", [
      session.current_character?.character_id ?? session.current_character?.char_id,
      skey,
    ]);
    const cd = ch.character_data ?? ch;
    const lvl = cd.character_level ?? 1;
    const xp0 = cd.character_xp ?? 0;
    const rank = cd.character_rank ?? 1;
    // Level cap Genin 20: misi tidak kasih XP lagi -> jalankan ujian Chunin otomatis.
    if (lvl >= 20 && rank < 2) {
      log(`⛔ Level ${lvl} mentok cap Genin (20). Jalankan ujian Chunin otomatis...`, "warning");
      try {
        const passed = await runChuninExam(session, cd.character_id, log, stopped);
        if (!passed) {
          log("Ujian Chunin berhenti (Stop ditekan).", "warning");
          return;
        }
        log("Lanjut leveling pasca-ujian...", "success");
        continue;
      } catch (e) {
        log(`Ujian Chunin gagal: ${e.message || e}. Bot berhenti biar jatah misi tidak kebuang.`, "error");
        return;
      }
    }
    const mission = pickMission(missions, lvl);
    if (!mission) throw new Error(`Tidak ada misi untuk level ${lvl}.`);

    const eids = mission.enemies;
    const stats = eids.map((id) => {
      const e = enemies.get(id);
      if (!e) throw new Error(`Enemy ${id} tidak ada di asset.`);
      return e;
    });
    const e2 = eids.join(",");
    const e3 = stats.map((e) => `id:${e.id}|hp:${e.hp}|agility:${e.agility}`).join("#");
    const agi = 9 + lvl + 0;
    const bc = await call("BattleSystem.startMission", [
      cd.character_id, mission.id, e2, e3, agi, bhash(e2 + e3 + agi), skey,
    ]);
    if (typeof bc !== "string" || !bc.length) {
      log(`startMission ditolak: ${JSON.stringify(bc).slice(0, 200)} — berhenti (kemungkinan jatah harian habis).`, "warning");
      return;
    }
    if (delayS > 0) await sleep(delayS * 1000);
    if (stopped()) {
      log("⏹ Stopped.");
      return;
    }
    const dmg = stats.reduce((a, e) => a + (Number(e.hp) || 0), 0);
    const tele = {
      status: { wind: 0, fire: 0, lightning: 0, water: 0, earth: 0 },
      items: { weapon: null, set: null, back_item: null, accessory: null },
      ____: [],
      _____: null,
      bytes: { _: SWF_BYTES, __: SWF_BYTES, ___: "", ____: 0, _____: SWF_BYTES, ______: SWF_BYTES },
    };
    const fin = await call("BattleSystem.finishMission", [
      cd.character_id, mission.id, bc,
      bhash(mission.id + cd.character_id + bc + dmg),
      dmg, skey,
      Buffer.from(JSON.stringify(tele)).toString("base64"),
      0,
    ]);
    if (!fin || fin.status !== 1) {
      log(`finishMission gagal: ${JSON.stringify(fin).slice(0, 300)}`, "error");
      return;
    }
    const ch2 = await call("SystemLogin.getCharacterData", [cd.character_id, skey]);
    const cd2 = ch2.character_data ?? ch2;
    const gained = (cd2.character_xp ?? 0) - xp0;
    if (gained <= 0) {
      zeroXpStreak++;
      if (zeroXpStreak >= 2) {
        log(`⛔ 2 cycle beruntun +0 XP (Lv ${cd2.character_level}). Kemungkinan mentok cap / jatah misi habis. Bot berhenti.`, "warning");
        return;
      }
    } else {
      zeroXpStreak = 0;
    }
    log(
      `[Cycle ${cycle}] ${mission.id} (${mission.name || ""}) ✔ +${gained} XP (Lv ${cd2.character_level}, ${cd2.character_xp} XP, ${cd2.character_gold} gold)` +
        (fin.level_up ? " 🎉 LEVEL UP!" : ""),
      "success"
    );
    try {
      config.characterUpdateCallback?.({
        level: cd2.character_level, xp: cd2.character_xp, gold: cd2.character_gold,
      });
    } catch {}
    if (session.current_character && typeof session.current_character === "object") {
      Object.assign(session.current_character, {
        character_level: cd2.character_level, character_xp: cd2.character_xp, character_gold: cd2.character_gold,
      });
    }
    if (cdS > 0) await sleep(cdS * 1000);
  }
}
