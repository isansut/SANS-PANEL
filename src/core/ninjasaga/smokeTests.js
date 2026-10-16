// Port of desktop_app/core/ninjasaga/smoke_tests.py
import * as missionPolicy from './missionPolicy.js';
import * as progressParser from './progressParser.js';
import * as rateControl from './rateControl.js';
import * as recovery from './recovery.js';

function assert(cond, message) {
  if (!cond) throw new Error(`Assertion failed: ${message}`);
}

async function testMissionPickerBasic() {
  const midL1 = missionPolicy.pickAutoMission(1, 1);
  assert(typeof midL1 === 'string' && midL1.startsWith('msn'), 'Level 1 should resolve a mission id');

  const midL20 = missionPolicy.pickAutoMission(20, 1);
  const reqL20 = missionPolicy.missionRequiredLevel(midL20);
  assert(reqL20 === null || reqL20 <= 20, 'Picked mission must not exceed character level');

  assert(!missionPolicy.isMissionAutoEligible('msn125', 1), 'Daily mission should be filtered');
  assert(!missionPolicy.isMissionAutoEligible('msn66', 1), 'No-grade mission should be filtered');
  assert(!missionPolicy.isMissionAutoEligible('msn55', 1), 'Zero-reward mission should be filtered');
}

function testProgressParserBasic() {
  const payload = {
    character_name: 'Smoke', character_level: 7, character_xp: 321, character_gold: 654, character_rank: 2,
  };
  const [name, level, xp, gold, rank, energy] = progressParser.extractProgressSnapshot(payload, 1, null);
  assert(name === 'Smoke', 'name');
  assert(level === 7, 'level');
  assert(xp === 321, 'xp');
  assert(gold === 654, 'gold');
  assert(rank === 2, 'rank');
  assert(energy === null, 'energy');
}

async function testRecoveryAndRateHelpers() {
  assert(recovery.isGatewayBlockedError(new Error('HTTP 403 cloudflare blocked')), 'gateway blocked detection');
  assert(!recovery.isGatewayBlockedError(new Error('timeout')), 'gateway blocked false positive');

  const [ok, ts] = await rateControl.waitMinCallInterval(null, 1, 0);
  assert(ok && typeof ts === 'number', 'wait_min_call_interval basic');
}

export async function runAll() {
  await testMissionPickerBasic();
  testProgressParserBasic();
  await testRecoveryAndRateHelpers();
  console.log('NinjaSaga smoke tests passed');
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('smokeTests.js')) {
  runAll().catch((e) => { console.error(e); process.exit(1); });
}
