// Port of desktop_app/core/ninjasaga/special_events.py
import config from '../config.js';
import * as amfReq from './amfReq.js';
import * as rateControl from './rateControl.js';

export const MOTHERDAY_BOSS_ID = 'enemy531';
export const SAKURA_ENEMIES = {
  enemy289: 'Origami Deer',
  enemy290: 'Origami Crane',
  enemy291: 'Origami Dragon',
  enemy292: 'Origami Bear',
  enemy393: 'Origami Devil Spider',
};
export const SAKURA_PETAL_COST = 10;
export const PUMPKIN_ENEMIES = {
  enemy534: 'Furious Zombie',
  enemy535: 'White Werewolf',
  enemy536: 'Captain Skeleton',
  enemy537: 'Golden Joker',
  enemy538: 'Geisha Ghost',
};
export const PUMPKIN_DEFAULT_ENEMY = 'enemy536';

function waitWithStop(seconds) {
  return rateControl.waitWithStop(rateControl.jitteredWaitSeconds(seconds, 0));
}

function isSuccess(response) {
  return !!response && typeof response === 'object' && String(response.status) === '1';
}

function safeInt(value, defaultValue = 0) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? Number(defaultValue) : parsed;
}

function responseMessage(response) {
  if (response && typeof response === 'object' && !Array.isArray(response)) {
    return String(response.result ?? response.message ?? response.error ?? JSON.stringify(response));
  }
  return String(response);
}

function eventPolicy() {
  return config.getNinjasagaEventResourcePolicy(config.ninjasagaState || {});
}

function eventTiming() {
  return config.getNinjasagaEventTiming(config.ninjasagaState || {});
}

async function waitForEventResource(label) {
  const waitMinutes = Math.max(0, Number.parseInt(eventPolicy().wait_minutes ?? 30, 10));
  if (waitMinutes <= 0) { console.log(`${label}: wait policy is 0 minutes, stopping.`); return false; }
  console.log(`${label}: waiting ${waitMinutes} minute(s) for resource to recover...`);
  return waitWithStop(waitMinutes * 60);
}

async function claimEventBossReward(bossId, eventMode, sealFlag = 0) {
  const eventPayload = [eventMode, Number(sealFlag)];
  const result = await amfReq.getBossRewardEvent(bossId, 0, eventPayload);
  if (isSuccess(result)) return result;
  return amfReq.getBossRewardEvent(bossId, 1, eventPayload);
}

function motherdayAttemptsRemaining(payload) {
  const result = payload && typeof payload === 'object' && payload.result && typeof payload.result === 'object' ? payload.result : {};
  const daily = result.daily_battle_data;
  if (typeof daily === 'boolean') return daily ? 1 : 0;
  const parsed = Number.parseInt(daily, 10);
  return Number.isNaN(parsed) ? (daily ? 1 : 0) : Math.max(0, parsed);
}

export async function motherdayEvent() {
  console.log('Loading Mother Day special battle status...');
  while (!rateControl.stopRequested()) {
    const status = await amfReq.motherdayGetSpecialBattleStatus();
    if (!isSuccess(status)) { console.log(`Mother Day status failed: ${responseMessage(status)}`); return; }
    const attempts = motherdayAttemptsRemaining(status);
    if (attempts <= 0) { console.log('Mother Day daily limit reached.'); return; }
    console.log(`Mother Day attempts remaining: ${attempts}`);
    if (!(await waitWithStop(20))) return;
    const result = await claimEventBossReward(MOTHERDAY_BOSS_ID, 'token');
    if (!isSuccess(result)) { console.log(`Mother Day reward failed: ${responseMessage(result)}`); return; }
    console.log('Mother Day battle finished successfully.');
    if (attempts <= 1) return;
    if (!(await waitWithStop(5))) return;
  }
}

async function ensureSakuraResources(status, selectedEnemyId) {
  const mode = String(eventPolicy().mode || 'wait').trim().toLowerCase();
  const enemyCost = SAKURA_PETAL_COST;
  let petals = safeInt(status.petal_count, 0);

  while (petals < enemyCost) {
    if (mode === 'stop') { console.log(`Sakura Festival stopped: petals=${petals}/${enemyCost}.`); return [false, status]; }
    if (mode === 'wait') {
      if (!(await waitForEventResource('Sakura Festival'))) return [false, status];
      const refreshed = await amfReq.sakuraGetChallengeStatus();
      if (!isSuccess(refreshed)) { console.log(`Sakura Festival refresh failed: ${responseMessage(refreshed)}`); return [false, status]; }
      status = refreshed;
      petals = safeInt(status.petal_count, 0);
      continue;
    }

    const buyAmount = Math.max(1, enemyCost - petals);
    console.log(`Sakura Festival: buying ${buyAmount} petal(s) for ${SAKURA_ENEMIES[selectedEnemyId] || selectedEnemyId}...`);
    const buyRes = await amfReq.sakuraBuyPetal(buyAmount);
    if (!isSuccess(buyRes)) { console.log(`Sakura Festival buyPetal failed: ${responseMessage(buyRes)}`); return [false, status]; }

    const refreshed = await amfReq.sakuraGetChallengeStatus();
    if (!isSuccess(refreshed)) { console.log(`Sakura Festival refresh failed: ${responseMessage(refreshed)}`); return [false, status]; }
    status = refreshed;
    petals = safeInt(status.petal_count, 0);
  }
  return [true, status];
}

export async function sakuraEvent(selectedEnemyId = null, selectedEnemyName = null) {
  const enemyId = String(selectedEnemyId || 'enemy289').trim().toLowerCase();
  if (!(enemyId in SAKURA_ENEMIES)) throw new Error(`Unsupported Sakura Festival enemy: ${selectedEnemyId}`);
  const enemyName = selectedEnemyName || SAKURA_ENEMIES[enemyId];

  console.log(`Starting Sakura Festival against ${enemyName}...`);
  while (!rateControl.stopRequested()) {
    let status = await amfReq.sakuraGetChallengeStatus();
    if (!isSuccess(status)) { console.log(`Sakura Festival status failed: ${responseMessage(status)}`); return; }
    let ready;
    [ready, status] = await ensureSakuraResources(status, enemyId);
    if (!ready) return;
    console.log(`Sakura Festival ready: petals=${safeInt(status.petal_count, 0)} enemy=${enemyName}`);
    const battleDelaySeconds = Number.parseInt(eventTiming().sakura_battle_delay_seconds ?? 20, 10);
    console.log('Sakura Festival: Will Capture without using Seal!');
    console.log(`Sakura Festival: waiting ${battleDelaySeconds} seconds for battle duration and Capture...`);
    if (!(await waitWithStop(battleDelaySeconds))) return;
    const result = await claimEventBossReward(enemyId, '', 1);
    if (!isSuccess(result)) { console.log(`Sakura Festival reward failed: ${responseMessage(result)}`); return; }
    console.log(`Sakura Festival capture finished: ${enemyName}`);
    if (!(await waitWithStop(5))) return;
  }
}

export async function pumpkinEvent(selectedEnemyId = null, selectedEnemyName = null) {
  const enemyId = String(selectedEnemyId || PUMPKIN_DEFAULT_ENEMY).trim().toLowerCase();
  if (!(enemyId in PUMPKIN_ENEMIES)) throw new Error(`Unsupported Halloween Pumpkin Event enemy: ${selectedEnemyId}`);
  const enemyName = selectedEnemyName || PUMPKIN_ENEMIES[enemyId];

  console.log(`Starting Halloween Pumpkin Event against ${enemyName}...`);
  while (!rateControl.stopRequested()) {
    const status = await amfReq.halloweenGetBattleStatus();
    if (!isSuccess(status)) { console.log(`Halloween Pumpkin Event status failed: ${responseMessage(status)}`); return; }
    const statusResult = status && typeof status === 'object' && status.result && typeof status.result === 'object' ? status.result : {};
    const remainHeart = safeInt(statusResult.remain_heart ?? status.remain_heart, 0);
    if (remainHeart <= 0) { console.log('Halloween Pumpkin Event: no battle hearts left.'); return; }
    console.log(`Halloween Pumpkin Event: hearts remaining ${remainHeart}.`);

    const start = await amfReq.halloweenStartBattle(enemyId);
    if (!isSuccess(start)) { console.log(`Halloween Pumpkin Event battle start failed: ${responseMessage(start)}`); return; }
    const z9f = start && start.z9f;
    console.log(`Halloween Pumpkin Event: battle started against ${enemyName}.`);

    const battleDelaySeconds = Number.parseInt(eventTiming().pumpkin_battle_delay_seconds ?? 20, 10);
    console.log(`Halloween Pumpkin Event: waiting ${battleDelaySeconds} seconds for battle duration...`);
    if (!(await waitWithStop(battleDelaySeconds))) return;

    const reward = await amfReq.halloweenClaimReward(enemyId, z9f);
    if (!isSuccess(reward)) { console.log(`Halloween Pumpkin Event reward failed: ${responseMessage(reward)}`); return; }
    const rewardList = reward && Array.isArray(reward.reward) ? reward.reward.join(', ') : '';
    console.log(`Halloween Pumpkin Event reward claimed: ${rewardList || 'ok'}`);
    if (!(await waitWithStop(5))) return;
  }
}
