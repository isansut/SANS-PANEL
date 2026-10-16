// AMF request dispatcher. This panel ships a single base game: NinjaSaga.cc
// (the `ninjasaga` base game). Everything routes straight to the NinjaSaga module.
import config from './config.js';
import * as ninjasagaAmfReq from './ninjasaga/amfReq.js';

function assertNinjasaga() {
  const game = config.getCurrentBaseGame();
  if (game.id !== 'ninjasaga') {
    throw new Error(`${game.label} is not wired into this NinjaSaga.cc panel`);
  }
}

export function checkVersion() {
  assertNinjasaga();
  return ninjasagaAmfReq.checkVersion();
}

export function getAllCharacters() {
  assertNinjasaga();
  return ninjasagaAmfReq.getAllCharacters();
}

export function getCharacterData(charId, ...kwargs) {
  assertNinjasaga();
  return ninjasagaAmfReq.getCharacterData(charId, ...kwargs);
}

export function login(username, password, charDot__, charDotUnderscore) {
  assertNinjasaga();
  return ninjasagaAmfReq.login(username, password, charDot__, charDotUnderscore);
}

export default { checkVersion, getAllCharacters, getCharacterData, login };
