// Port of desktop_app/core/ninjasaga/bootstrap.py
import * as amfReq from './amfReq.js';

export async function bootstrapSession() {
  const version = await amfReq.checkVersion();
  if (!version || typeof version !== 'object' || String(version.status) !== '1') {
    console.log('NinjaSaga bootstrap: version check failed');
    return;
  }

  const charsPayload = await amfReq.getAllCharacters();
  let chars = [];
  if (charsPayload && typeof charsPayload === 'object' && !Array.isArray(charsPayload)) {
    chars = charsPayload.account_data || charsPayload.characters || [];
  }

  if (chars.length) {
    const first = chars[0];
    let charId = null;
    if (first && typeof first === 'object' && !Array.isArray(first)) {
      charId = first.character_id ?? first.char_id;
    } else if (Array.isArray(first)) {
      charId = first.length ? first[0] : null;
    } else {
      charId = first;
    }
    if (charId !== null && charId !== undefined) {
      await amfReq.getCharacterData(charId, true, true);
    }
  }

  console.log('NinjaSaga session bootstrap completed');
}
