// NSO Chunin exam driver: getData -> per-stage start/wait/finish -> promote.
// Mirrors the cc runRankExam structure (leveling.js) for the NSO stage system.
import { nsoCall, nsoLogin } from "./nso.js";

const QUIZ_QUESTIONS = [
  { q: "What was the first weapon that Shin gave you?", a: 2, c: ["Axe", "Claw", "Kunai", "Sword", "I cannot remember"], id: 1 },
  { q: "Which action allows you to gain Chakra in battle?", a: 3, c: ["Dance", "Run", "Eat", "Charge", "Sleep"], id: 2 },
  { q: "Which technique is specialized in illusions and transformations?", a: 1, c: ["Taijutsu (Body Techniques)", "Genjutsu (Illusionary Techniques)", "Kenjutsu (Sword Technique)", "Kinjutsu (Forbidden Techniques)", "Fuinjutsu (Sealing Techniques)"], id: 3 },
  { q: "How many friends can you recruit to join your party for missions?", a: 1, c: ["1", "2", "3", "4", "I cannot recruit friends to do missions"], id: 4 },
  { q: "Which item allows the character to recover HP?", a: 1, c: ["Chakra Scroll", "HP Healing Scroll", "Smoke Bomb", "Rations Pills", "Magic Potion"], id: 5 },
];
const QUIZ_ANSWERS = [2, 3, 1, 1, 1];

// Per-stage minimum realistic durations (ms). finishStage rejects with
// "completed too quickly" below the server minimum, so we wait first,
// then retry with backoff if still too quick.
const STAGE_WAIT_MS = { 1: 90_000, 2: 8 * 60_000, 3: 8 * 60_000, 4: 8 * 60_000, 5: 8 * 60_000 };
const RETRY_WAIT_MS = 5 * 60_000;
const MAX_ATTEMPTS = 4;

function stageArgs(stage, sessionkey, charId) {
  switch (stage) {
    case 1:
      return [sessionkey, charId, 1, true, QUIZ_QUESTIONS, QUIZ_ANSWERS];
    case 2:
      return [sessionkey, charId, 2, true, true, 2];
    case 3:
      return [sessionkey, charId, 3, 3, ["ene_65", "ene_63", "ene_64"]];
    case 4:
      return [sessionkey, charId, 4, ["ene_68", "ene_67", "ene_66"]];
    case 5:
      return [sessionkey, charId, 5, ["ene_45", "ene_59"]];
    default:
      throw new Error(`Unknown Chunin stage ${stage}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function runChuninExam(session, charId, log, isStopped) {
  const http = session.nso_http;
  const skey = () => session.nso_login.sessionkey;
  const call = async (method, args) => {
    // NOTE: must call nsoCall (not call) here to avoid infinite recursion.
    const res = await nsoCall(http, method, args);
    if (res && res.status === 0 && /invalid session key/i.test(String(res.error || ""))) {
      const creds = session.nso_creds;
      if (!creds?.username || !creds?.password) throw new Error("NSO session expired.");
      log("🔄 Session expired, relogin...", "warning");
      const fresh = await nsoLogin(http, creds.username, creds.password);
      session.nso_login = { uid: fresh.uid, sessionkey: fresh.sessionkey };
      return nsoCall(http, method, args);
    }
    return res;
  };
  const data = await call("ChuninExam.getData", [skey(), charId]);
  if (!data || data.status !== 1) throw new Error("ChuninExam.getData gagal.");
  log(`Ujian Chunin: status stage [${data.data.map((s) => s.status).join(",")}]`);

  for (let stage = 1; stage <= 5; stage++) {
    const cur = await call("ChuninExam.getData", [skey(), charId]);
    const st = cur?.data?.[stage - 1]?.status;
    if (st === "2") {
      log(`Stage ${stage} sudah selesai, lanjut.`);
      continue;
    }
    if (st !== "1") throw new Error(`Stage ${stage} belum kebuka (status ${st}).`);

    const st0 = await call("ChuninExam.startStage", [skey(), charId, stage]);
    if (!st0 || st0.status !== 1) throw new Error(`startStage ${stage} gagal: ${JSON.stringify(st0).slice(0, 200)}`);
    log(`Stage ${stage} dimulai, tunggu wajar ${Math.round(STAGE_WAIT_MS[stage] / 60000)} mnt...`);

    let done = false;
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      if (isStopped()) return false;
      await sleep(attempt === 1 ? STAGE_WAIT_MS[stage] : RETRY_WAIT_MS);
      if (isStopped()) return false;
      const fin = await call("ChuninExam.finishStage", stageArgs(stage, skey(), charId));
      if (fin && fin.status === 1) {
        log(`✅ Stage ${stage} lolos.`, "success");
        done = true;
        break;
      }
      const msg = JSON.stringify(fin).slice(0, 160);
      log(`Stage ${stage} attempt ${attempt} ditolak: ${msg}`, "warning");
      if (!/too quickly/i.test(msg)) throw new Error(`Stage ${stage} gagal permanen: ${msg}`);
    }
    if (!done) throw new Error(`Stage ${stage} gagal setelah ${MAX_ATTEMPTS} percobaan.`);
  }

  const pro = await call("ChuninExam.promoteToChunin", [skey(), charId]);
  if (!pro || !(pro.status > 0)) throw new Error(`promoteToChunin gagal: ${JSON.stringify(pro).slice(0, 200)}`);
  log(`🎓 PROMOSI CHUNIN! rewards: ${JSON.stringify(pro.rewards ?? pro.result ?? "").slice(0, 200)}`, "success");
  return true;
}
