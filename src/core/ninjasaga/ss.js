// Port of desktop_app/core/ninjasaga/ss.py
import config from '../config.js';
import * as amfReq from './amfReq.js';
import * as antiDetection from './antiDetection.js';
import * as rateControl from './rateControl.js';
import * as progressParser from './progressParser.js';
import * as missionPolicy from './missionPolicy.js';
import { RANK_TUTOR, RANK_NAME_BY_ID } from './leveling.js';

export const SS_MISSION_IDS = ['msn279', 'msn280', 'msn281', 'msn282', 'msn283'];

function stopRequested() {
  const stopEvent = config.stopEvent;
  return !!(stopEvent && stopEvent.isSet && stopEvent.isSet());
}

function waitWithStop(seconds) {
  return rateControl.waitWithStop(seconds);
}

function jitteredWaitSeconds(base, jitter) {
  return rateControl.jitteredWaitSeconds(base, jitter);
}

function waitMinCallInterval(last, minDelay, jitter) {
  return rateControl.waitMinCallInterval(last, minDelay, jitter);
}

function rankName(rankValue) {
  if (rankValue === null || rankValue === undefined) return 'Unknown';
  return RANK_NAME_BY_ID[rankValue] ?? `Rank ${rankValue}`;
}

function isSuccessResponse(response) {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    const status = response.status;
    if (status !== null && status !== undefined) return ['1', 'true', 'True'].includes(String(status));
    const error = response.error;
    if (error !== null && error !== undefined) return ['0', 'None', ''].includes(String(error));
  }
  return false;
}

function errorCode(response) {
  if (!response || typeof response !== 'object' || Array.isArray(response)) return null;
  for (const key of ['error', 'code', 'errno']) {
    const value = response[key];
    if (value !== null && value !== undefined) return value;
  }
  return null;
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

function extractTrainingReward(updateResult, rewardKey) {
  const rewardName = String(rewardKey || '').trim().toLowerCase();
  const directKeyMap = { tp: ['tp_reward'], ss: ['ss_reward'] };
  for (const key of directKeyMap[rewardName] || []) {
    const value = Number.parseInt(updateResult?.[key] || 0, 10) || 0;
    if (value > 0) return value;
  }
  const result = updateResult?.result;
  if (Array.isArray(result) && result.length >= 3 && Array.isArray(result[2])) {
    const prefix = rewardName === 'ss' ? 'ss_' : `${rewardName}_`;
    for (const item of result[2]) {
      const text = String(item || '').trim().toLowerCase();
      if (!text.startsWith(prefix)) continue;
      const parsed = Number.parseInt(text.slice(prefix.length), 10);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return 0;
}

function statusPreview(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const keys = Object.keys(payload);
    const result = payload.result;
    if (Array.isArray(result)) return `dict keys=${keys.slice(0, 6).join(',')} result_len=${result.length}`;
    return `dict keys=${keys.slice(0, 6).join(',')}`;
  }
  if (Array.isArray(payload)) return `list len=${payload.length}`;
  return typeof payload;
}

function acctTypeFromLogin() {
  const loginData = config.loginData;
  if (!loginData || typeof loginData !== 'object') return null;
  const parsed = Number.parseInt(loginData.account_type, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export async function ssTraining(loopTimes = null) {
  if (!config.loginData || typeof config.loginData !== 'object') {
    throw new Error('Login data is not loaded in memory');
  }

  const state = config.ninjasagaState || {};
  const profile = antiDetection.buildAntiDetectionProfile(state);
  const delaySeconds = profile.action_delay_seconds;
  const cycleCooldownSeconds = profile.cycle_cooldown_seconds;
  const actionJitterSeconds = profile.action_jitter_seconds;
  const minCallDelaySeconds = profile.min_call_delay_seconds;
  const startRetryDelaySeconds = profile.start_retry_delay_seconds;
  const startMaxRetries = profile.start_max_retries;

  let snapshot = config.charData;
  let charId = progressParser.extractCharacterId(snapshot);
  let charLevel = progressParser.extractCharacterLevel(snapshot, 1);
  if (charId === null || charId === undefined) {
    const chars = await amfReq.getAllCharacters();
    const rows = (chars && (chars.account_data || chars.characters)) || [];
    if (!rows.length) throw new Error('No Ninja Saga characters available');
    const first = rows[0];
    charId = progressParser.extractCharacterId(first);
    charLevel = progressParser.extractCharacterLevel(first, 1);
  }
  let charRank = null;
  try {
    const refreshed = await amfReq.getCharacterData(charId, false, false);
    if (refreshed && typeof refreshed === 'object' && !Array.isArray(refreshed)) {
      config.charData = refreshed;
      charRank = progressParser.extractProgressSnapshot(refreshed, charLevel, null)[4];
    }
  } catch { /* ignore */ }

  if (charLevel < 80) { console.log(`SS Training requires level 80+. Current level: ${charLevel}.`); return; }
  if ((charRank ?? -1) < RANK_TUTOR) {
    console.log(`SS Training requires rank Tutor. Current rank: ${rankName(charRank)}(${charRank}).`);
    return;
  }

  let configuredLoops = 1;
  const parsedLoops = Number.parseInt(state.ss_training_abuse_loop || 1, 10);
  if (!Number.isNaN(parsedLoops)) configuredLoops = parsedLoops;
  const totalPasses = loopTimes !== null && loopTimes !== undefined ? Number(loopTimes) : Math.max(1, configuredLoops);

  console.log(`Starting SS Training | char_id=${charId} | level=${charLevel} | rank=${rankName(charRank)}(${charRank}) | abuse_loops=${totalPasses}`);

  const accountType = acctTypeFromLogin();
  let lastAmfCallAt = null;
  const now = () => Date.now() / 1000;

  for (let passIndex = 1; passIndex <= totalPasses; passIndex++) {
    if (stopRequested()) { console.log('SS Training stopped by user request'); break; }

    let okToCall;
    [okToCall, lastAmfCallAt] = await waitMinCallInterval(lastAmfCallAt, minCallDelaySeconds, actionJitterSeconds);
    if (!okToCall) { console.log('SS Training stopped by user request'); return; }
    try {
      const statusPayload = await amfReq.getSsTrainingMissionStatus();
      lastAmfCallAt = now();
      console.log(`[SS Pass ${passIndex}] getMissionStatus -> ${statusPreview(statusPayload)}`);
    } catch (exc) {
      console.log(`[SS Pass ${passIndex}] getMissionStatus failed: ${exc.message || exc}`);
    }

    let anyStarted = false;
    for (const missionId of SS_MISSION_IDS) {
      if (stopRequested()) { console.log('SS Training stopped by user request'); return; }

      const missionLabel = missionPolicy.missionDisplayLabel(missionId, accountType);
      console.log(`[SS Pass ${passIndex}] try mission ${missionLabel}`);

      let startResult = null;
      let started = false;
      for (let attempt = 1; attempt <= startMaxRetries; attempt++) {
        let ok;
        [ok, lastAmfCallAt] = await waitMinCallInterval(lastAmfCallAt, minCallDelaySeconds, actionJitterSeconds);
        if (!ok) { console.log('SS Training stopped by user request'); return; }
        try {
          startResult = await amfReq.startMission(missionId);
          lastAmfCallAt = now();
        } catch (exc) {
          console.log(`[SS Pass ${passIndex}] startMission ${missionId} exception: ${exc.message || exc}`);
          startResult = { status: 0, error: String(exc.message || exc) };
          break;
        }
        if (startResult && typeof startResult === 'object' && !Array.isArray(startResult) && String(startResult.status ?? '1') === '1') {
          started = true; anyStarted = true; break;
        }
        if (errorCode(startResult) === 100 && attempt < startMaxRetries) {
          const retryWait = jitteredWaitSeconds(startRetryDelaySeconds, actionJitterSeconds);
          console.log(`[SS Pass ${passIndex}] ${missionId} locked (error 100), retry ${attempt + 1}/${startMaxRetries} in ${retryWait.toFixed(1)}s...`);
          if (!(await waitWithStop(retryWait))) { console.log('SS Training stopped by user request'); return; }
          continue;
        }
        break;
      }

      if (!started) {
        const cooldown = cooldownSeconds(startResult);
        if (cooldown > 0) console.log(`[SS Pass ${passIndex}] ${missionId} cooldown/lock active, skipping.`);
        else console.log(`[SS Pass ${passIndex}] ${missionId} unavailable: ${JSON.stringify(startResult)}`);
        continue;
      }

      if (delaySeconds > 0) {
        const actionWait = jitteredWaitSeconds(delaySeconds, actionJitterSeconds);
        if (!(await waitWithStop(actionWait))) { console.log('SS Training stopped by user request'); return; }
      }

      let ok;
      [ok, lastAmfCallAt] = await waitMinCallInterval(lastAmfCallAt, minCallDelaySeconds, actionJitterSeconds);
      if (!ok) { console.log('SS Training stopped by user request'); return; }

      let updateResult;
      try {
        updateResult = await amfReq.updateCharacterProgress(charId, charLevel, missionId, 0, 0);
        lastAmfCallAt = now();
      } catch (exc) {
        console.log(`[SS Pass ${passIndex}] updateCharacter ${missionId} exception: ${exc.message || exc}`);
        continue;
      }

      if (!isSuccessResponse(updateResult)) {
        console.log(`[SS Pass ${passIndex}] updateCharacter failed for ${missionId}: ${JSON.stringify(updateResult)}`);
        continue;
      }

      const [charName, parsedLevel, charXp, charGold, parsedRank, parsedEnergy] = progressParser.extractProgressSnapshot(updateResult, charLevel, charRank);
      charLevel = parsedLevel;
      if (parsedRank !== null && parsedRank !== undefined) charRank = parsedRank;
      const ssReward = extractTrainingReward(updateResult, 'ss') || missionPolicy.missionRewardValue(missionId, 'sp');
      const rankSuffix = charRank !== null && charRank !== undefined ? ` ${rankName(charRank)}(${charRank})` : '';
      const energySuffix = parsedEnergy !== null && parsedEnergy !== undefined ? ` Energy ${parsedEnergy}` : '';
      const rewardSuffix = ssReward > 0 ? ` SS +${ssReward}` : '';
      console.log(`[SS Pass ${passIndex}] ok -> ${charName} Lv ${charLevel}${rankSuffix} XP ${charXp} Gold ${charGold}${energySuffix}${rewardSuffix}`);

      const callback = config.characterUpdateCallback;
      if (typeof callback === 'function') {
        callback({ level: charLevel, xp: charXp, gold: charGold, tokens: updateResult?.account_tokens });
      }

      const cooldownWait = jitteredWaitSeconds(cycleCooldownSeconds, actionJitterSeconds);
      if (!(await waitWithStop(cooldownWait))) { console.log('SS Training stopped by user request'); return; }
    }

    if (!anyStarted) console.log(`[SS Pass ${passIndex}] No SS mission was available in this pass.`);
  }
}
