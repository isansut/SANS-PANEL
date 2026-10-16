// Port of desktop_app/core/ninjasaga/actions.py
import { bootstrapSession } from './bootstrap.js';
import { ninjasagaLeveling } from './leveling.js';
import { tpTraining } from './tp.js';
import { ssTraining } from './ss.js';
import { eudemonGarden } from './eudemon.js';
import { motherdayEvent, sakuraEvent, pumpkinEvent } from './specialEvents.js';
import { clanWarEvent } from './clanWar.js';
import { nsoLeveling } from './nsoMission.js';

const NSO_SUPPORTED_ACTIONS = new Set(['leveling', 'refresh', 'bootstrap']);

export function resolveNinjasagaAction(action, params, refreshFactory, currentBaseGame, profileId = null, session = null) {
  if (profileId === 'nso') {
    if (action === 'leveling') return { func: () => nsoLeveling(session), name: 'NSO Start Leveling' };
    if (action === 'refresh' || action === 'bootstrap') return { func: refreshFactory(), name: action === 'refresh' ? 'Refresh Character Info' : 'Bootstrap Session' };
    throw new Error(`Aksi '${action}' belum didukung untuk NinjaSaga.online (baru: leveling).`);
  }
  if (action === 'refresh') return { func: refreshFactory(), name: 'Refresh Character Info' };
  if (action === 'bootstrap') return { func: bootstrapSession, name: 'Bootstrap Session' };
  if (action === 'leveling') return { func: ninjasagaLeveling, name: 'Start Leveling' };
  if (action === 'tp_training') return { func: tpTraining, name: 'TP Training' };
  if (action === 'ss_training') return { func: ssTraining, name: 'SS Training' };
  if (action === 'eudemon_garden') return { func: eudemonGarden, name: 'Eudemon Garden' };
  if (action === 'motherday_event') return { func: motherdayEvent, name: 'Mother Day' };
  if (action === 'sakura_event') {
    const selectedEnemyId = params && typeof params === 'object' ? params.enemy_id : null;
    const selectedEnemyName = params && typeof params === 'object' ? params.enemy_name : null;
    return {
      func: () => sakuraEvent(selectedEnemyId, selectedEnemyName),
      name: `Sakura Festival - ${selectedEnemyName || selectedEnemyId || 'Default'}`,
    };
  }
  if (action === 'pumpkin_event') {
    const selectedEnemyId = params && typeof params === 'object' ? params.enemy_id : null;
    const selectedEnemyName = params && typeof params === 'object' ? params.enemy_name : null;
    return {
      func: () => pumpkinEvent(selectedEnemyId, selectedEnemyName),
      name: `Halloween Pumpkin Event - ${selectedEnemyName || selectedEnemyId || 'Default'}`,
    };
  }
  if (action === 'clan_war') return { func: clanWarEvent, name: 'Clan War' };
  throw new Error(`${currentBaseGame.label} actions are not implemented yet in this panel`);
}
