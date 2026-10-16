// Port of desktop_app/core/ninjasaga/recovery.py
import config from '../config.js';
import * as amfReq from './amfReq.js';
import { waitWithStop, jitteredWaitSeconds } from './rateControl.js';

export function isGatewayBlockedError(exc) {
  const text = String(exc?.message ?? exc ?? '').toLowerCase();
  return text.includes('cloudflare') || text.includes('http 403') || text.includes('gateway is blocked');
}

export function isTransientConnectionError(exc) {
  const text = String(exc?.message ?? exc ?? '').toLowerCase();
  const markers = [
    'remotedisconnected',
    'remote end closed connection without response',
    'connection aborted',
    'connection reset by peer',
    'read timed out',
    'connect timeout',
    'temporarily unavailable',
  ];
  return markers.some((marker) => text.includes(marker));
}

export function isRateLimitedError(exc) {
  const text = String(exc?.message ?? exc ?? '').toLowerCase();
  return text.includes('rate_limited') || text.includes('rate limited');
}

function transientRetryWaitSeconds() {
  return 2;
}

function rateLimitedRetryWaitSeconds() {
  return 6;
}

export async function reloginAndReselectCharacter(charId) {
  const profileId = config.getCurrentAmfProfile().id;
  const [credentials] = config.getQuickLoginCredentials(profileId);
  if (!credentials) {
    console.log('Relogin skipped: no quick login credentials available');
    return false;
  }

  const username = credentials.username;
  const password = credentials.password;
  if (!username || !password) {
    console.log('Relogin skipped: invalid quick login credentials');
    return false;
  }

  try {
    const gameData = await amfReq.checkVersion();
    const versionHash = gameData && typeof gameData === 'object' ? gameData.__ || '' : '';
    const rawBuild = gameData && typeof gameData === 'object' ? gameData._ ?? config.BUILD_NUM : config.BUILD_NUM;
    const buildMarker = String(rawBuild);

    console.log('Relogin in progress...');
    const loginResult = await amfReq.login(username, password, versionHash, buildMarker);
    if (!loginResult || typeof loginResult !== 'object' || String(loginResult.status) !== '1') {
      console.log(`Relogin failed: ${JSON.stringify(loginResult)}`);
      return false;
    }
    config.loginData = loginResult;

    if (charId === null || charId === undefined) {
      console.log('Relogin success (no character reselection requested)');
      return true;
    }

    const selected = await amfReq.getCharacterData(charId, false, false);
    if (!selected || typeof selected !== 'object') {
      console.log(`Reselect failed: ${JSON.stringify(selected)}`);
      return false;
    }
    config.charData = selected;
    console.log(`Relogin success and character reselected: ${charId}`);
    return true;
  } catch (exc) {
    console.log(`Relogin/reselect error: ${exc.message || exc}`);
    return false;
  }
}

export async function handleRuntimeException(exc, charId, context, cloudflareRestSeconds) {
  if (isGatewayBlockedError(exc)) {
    console.log(`${context} failed: ${exc.message || exc}`);
    console.log('NinjaSaga official gateway is currently blocked by Cloudflare for direct AMF panel traffic.');
    const restWait = jitteredWaitSeconds(cloudflareRestSeconds, 0);
    console.log(`Let's take rest for a moment (~${restWait.toFixed(0)}s), then retry automatically...`);
    if (!(await waitWithStop(restWait))) return false;
    return true;
  }

  if (isTransientConnectionError(exc)) {
    const retryWait = jitteredWaitSeconds(transientRetryWaitSeconds(), 0);
    console.log(`${context} transient connection error: ${exc.message || exc}`);
    console.log(`Retrying current action in ${retryWait.toFixed(1)}s without relogin...`);
    return waitWithStop(retryWait);
  }

  if (isRateLimitedError(exc)) {
    const retryWait = jitteredWaitSeconds(rateLimitedRetryWaitSeconds(), 0);
    console.log(`${context} rate limited: ${exc.message || exc}`);
    console.log(`Cooling down for ${retryWait.toFixed(1)}s, then retrying without relogin...`);
    return waitWithStop(retryWait);
  }

  console.log(`${context} error: ${exc.message || exc}`);
  console.log('Attempting recovery: relogin + reselect current character...');
  return reloginAndReselectCharacter(charId);
}
