// Port of desktop_app/core/ninjasaga/tp.py
import { ninjasagaLeveling } from './leveling.js';

export function tpTraining(loopTimes = null) {
  return ninjasagaLeveling(loopTimes, 'tp');
}
