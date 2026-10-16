// Port of desktop_app/core/config.py — scoped to the NinjaSaga base game.
import { AsyncLocalStorage } from 'node:async_hooks';

export const PANEL_BUILD_NUM = 'V420.69';

export const BASE_GAMES = {
  ninjasaga: {
    label: 'Ninja Saga',
    panel_title: 'Ninja Saga',
    panel_subtitle: 'Web Panel',
    server_selection_note:
      'NinjaSaga uses separate client-side signature/encryption flow and is isolated from other games.',
    has_tokens: true,
    has_account_stats: false,
    library_url: null,
    bootstrap_url: null,
    bootstrap_game: null,
    default_profile_id: 'official',
    build_num: 'latest',
  },
};

export const NINJASAGA_PROFILES = {
  official: {
    label: 'NinjaSaga.cc',
    gateway: 'https://amf.ninjasaga.cc/',
    build_num: 'latest',
    clan_url: 'https://ninjasaga.cc/',
  },
  nso: {
    label: 'NinjaSaga.online',
    gateway: 'https://ninjasaga.online/amf',
    build_num: 'latest',
    clan_url: 'https://ninjasaga.online/',
  },
};

export const GAME_PROFILES = {
  ninjasaga: NINJASAGA_PROFILES,
};

export const NINJASAGA_ANTI_DETECTION_PROFILE = {
  action_delay_seconds: 10,
  cycle_cooldown_seconds: 5,
  rest_every_cycles: 40,
  rest_duration_seconds: 60,
  action_jitter_seconds: 2,
  min_call_delay_seconds: 4,
  start_retry_delay_seconds: 6,
  start_max_retries: 3,
  cloudflare_rest_seconds: 60,
  cloudflare_backoff_steps_seconds: [60, 120, 240],
  cloudflare_backoff_max_seconds: 300,
  failure_window_seconds: 180,
  max_failures_in_window: 6,
  circuit_cooldown_seconds: 120,
};

export const NINJASAGA_AUTO_SPEND_PROFILE = {
  enabled: false,
  target: 'energy',
  trigger_energy: 0,
  max_refills_per_run: 1,
};

export const NINJASAGA_EVENT_RESOURCE_POLICY = {
  mode: 'wait',
  wait_minutes: 30,
};

export const NINJASAGA_EVENT_TIMING = {
  sakura_battle_delay_seconds: 20,
  pumpkin_battle_delay_seconds: 20,
};

function initialBaseGameId() {
  return Object.keys(BASE_GAMES)[0];
}

// ---------------------------------------------------------------------------
// Per-session game context (AsyncLocalStorage)
// ---------------------------------------------------------------------------
// Game modules keep reading/writing `config.loginData`, `config.ninjasagaState`,
// `config.stopEvent`, ... but those fields now resolve to the *active session context*
// instead of one shared singleton, so concurrent logins don't clobber each other's
// state across `await`s.
const _contextStore = new AsyncLocalStorage();

function _resolveProfile(baseGameId, profileId) {
  const profiles = GAME_PROFILES[baseGameId];
  if (!profiles) throw new Error(`Unknown base game: ${baseGameId}`);
  const resolvedProfileId = profileId || BASE_GAMES[baseGameId].default_profile_id;
  const profile = profiles[resolvedProfileId];
  if (!profile) throw new Error(`Unknown AMF profile: ${resolvedProfileId}`);
  return { profileId: resolvedProfileId, profile };
}

function makeGameContext(baseGameId, profileId) {
  const resolvedBase = baseGameId || initialBaseGameId();
  const { profileId: resolvedProfileId, profile } = _resolveProfile(resolvedBase, profileId);
  return {
    activeBaseGame: resolvedBase,
    activeAmfProfile: resolvedProfileId,
    gateway: profile.gateway,
    buildNum: profile.build_num,
    classRequestSeq: 0,
    allChar: null,
    charData: null,
    gameData: null,
    loginData: null,
    ninjasagaState: null,
    stopEvent: null,
    characterUpdateCallback: null,
    characterUpdateLoop: null,
    sessionReauthRequiredCallback: null,
    actionLogCallback: null,
  };
}

const DEFAULT_CONTEXT = makeGameContext(initialBaseGameId());

function activeContext() {
  return _contextStore.getStore() || DEFAULT_CONTEXT;
}

const _CONTEXT_FIELDS = {
  ACTIVE_BASE_GAME: 'activeBaseGame',
  ACTIVE_AMF_PROFILE: 'activeAmfProfile',
  GATEWAY: 'gateway',
  BUILD_NUM: 'buildNum',
  CLASSIC_REQUEST_SEQ: 'classRequestSeq',
  allChar: 'allChar',
  charData: 'charData',
  gameData: 'gameData',
  loginData: 'loginData',
  ninjasagaState: 'ninjasagaState',
  stopEvent: 'stopEvent',
  characterUpdateCallback: 'characterUpdateCallback',
  characterUpdateLoop: 'characterUpdateLoop',
  sessionReauthRequiredCallback: 'sessionReauthRequiredCallback',
  actionLogCallback: 'actionLogCallback',
};

export const config = {
  PANEL_BUILD_NUM,
  BASE_GAMES,
  GAME_PROFILES,
  NINJASAGA_ANTI_DETECTION_PROFILE,
  NINJASAGA_AUTO_SPEND_PROFILE,
  NINJASAGA_EVENT_RESOURCE_POLICY,
  NINJASAGA_EVENT_TIMING,

  BYTES_LOADED: 8228447,
  BYTES_TOTAL: 8228447,

  // Global (session-independent) state.
  quickLoginData: null,
  ninjasagaDebug: false,
  panelSettings: { ninjasaga: {} },

  createContext(baseGameId, profileId) {
    return makeGameContext(baseGameId, profileId);
  },

  runWithContext(context, fn) {
    return _contextStore.run(context, fn);
  },

  currentContext() {
    return activeContext();
  },

  _settingsFor(baseGameId) {
    const id = baseGameId || this.ACTIVE_BASE_GAME;
    if (!this.panelSettings[id] || typeof this.panelSettings[id] !== 'object') this.panelSettings[id] = {};
    const store = this.panelSettings[id];
    if (!store.anti_detection_profile) store.anti_detection_profile = {};
    if (!store.auto_spend_profile) store.auto_spend_profile = {};
    if (!store.event_resource_policy) store.event_resource_policy = {};
    if (!store.event_timing) store.event_timing = {};
    return store;
  },

  getBaseGames() {
    return Object.entries(BASE_GAMES).map(([id, game]) => ({
      id,
      label: game.label,
      panel_title: game.panel_title || game.label,
      panel_subtitle: game.panel_subtitle || 'Web Panel',
      server_selection_note: game.server_selection_note || '',
      has_tokens: !!game.has_tokens,
      has_account_stats: !!game.has_account_stats,
    }));
  },

  getCurrentBaseGame() {
    const game = BASE_GAMES[this.ACTIVE_BASE_GAME];
    return {
      id: this.ACTIVE_BASE_GAME,
      label: game.label,
      panel_title: game.panel_title || game.label,
      panel_subtitle: game.panel_subtitle || 'Web Panel',
      server_selection_note: game.server_selection_note || '',
      has_tokens: !!game.has_tokens,
      has_account_stats: !!game.has_account_stats,
      library_url: game.library_url || null,
      bootstrap_url: game.bootstrap_url || null,
    };
  },

  _profilesForBaseGame(baseGameId) {
    const resolved = baseGameId || this.ACTIVE_BASE_GAME;
    if (!(resolved in GAME_PROFILES)) throw new Error(`Unknown base game: ${resolved}`);
    return GAME_PROFILES[resolved];
  },

  _syncRuntimeConnection() {
    const profile = this._profilesForBaseGame()[this.ACTIVE_AMF_PROFILE];
    this.GATEWAY = profile.gateway;
    this.BUILD_NUM = profile.build_num;
  },

  setBaseGame(baseGameId) {
    if (!(baseGameId in BASE_GAMES)) throw new Error(`Unknown base game: ${baseGameId}`);
    this.ACTIVE_BASE_GAME = baseGameId;
    this.ACTIVE_AMF_PROFILE = BASE_GAMES[baseGameId].default_profile_id;
    this.CLASSIC_REQUEST_SEQ = 0;
    this._syncRuntimeConnection();
    return this.getCurrentBaseGame();
  },

  setRuntimeConnection(gateway, buildNum) {
    if (gateway) this.GATEWAY = gateway;
    if (buildNum) this.BUILD_NUM = buildNum;
  },

  getAmfProfiles() {
    const profiles = this._profilesForBaseGame();
    return Object.entries(profiles).map(([id, profile]) => ({
      id,
      label: profile.label,
      gateway: profile.gateway,
      build_num: profile.build_num,
      clan_url: profile.clan_url || null,
    }));
  },

  setAmfProfile(profileId) {
    const profiles = this._profilesForBaseGame();
    if (!(profileId in profiles)) throw new Error(`Unknown AMF profile: ${profileId}`);
    this.ACTIVE_AMF_PROFILE = profileId;
    this.CLASSIC_REQUEST_SEQ = 0;
    this._syncRuntimeConnection();
    return this.getCurrentAmfProfile();
  },

  getCurrentAmfProfile() {
    const profile = this._profilesForBaseGame()[this.ACTIVE_AMF_PROFILE];
    return {
      id: this.ACTIVE_AMF_PROFILE,
      base_game_id: this.ACTIVE_BASE_GAME,
      label: profile.label,
      gateway: profile.gateway,
      build_num: profile.build_num,
      clan_url: profile.clan_url || null,
    };
  },

  _defaultQuickLoginStore() {
    return { last_profile_id: null, profiles: {} };
  },

  getQuickLoginStorageKey(profileId, baseGameId) {
    const resolvedBase = baseGameId || this.ACTIVE_BASE_GAME;
    const resolvedProfile = profileId || this.ACTIVE_AMF_PROFILE;
    return `${resolvedBase}__${resolvedProfile}`;
  },

  normalizeQuickLoginData(data) {
    if (!data) return this._defaultQuickLoginStore();

    if (typeof data === 'object' && data.profiles && typeof data.profiles === 'object') {
      const store = this._defaultQuickLoginStore();
      store.last_profile_id = data.last_profile_id || null;
      for (const [profileId, profileData] of Object.entries(data.profiles)) {
        if (profileData && typeof profileData === 'object') {
          store.profiles[profileId] = {
            username: profileData.username,
            password: profileData.password,
            amf_label: profileData.amf_label,
          };
        }
      }
      if (!store.last_profile_id && Object.keys(store.profiles).length) {
        store.last_profile_id = Object.keys(store.profiles)[0];
      }
      return store;
    }

    if (typeof data === 'object' && data.username && data.password) {
      const currentProfile = this.getCurrentAmfProfile();
      const key = this.getQuickLoginStorageKey(currentProfile.id, currentProfile.base_game_id);
      return {
        last_profile_id: key,
        profiles: {
          [key]: { username: data.username, password: data.password, amf_label: currentProfile.label },
        },
      };
    }

    return this._defaultQuickLoginStore();
  },

  setQuickLoginCredentials(profileId, username, password, amfLabel) {
    const store = this.normalizeQuickLoginData(this.quickLoginData);
    const profile = this._profilesForBaseGame()[profileId] || {};
    const storageKey = this.getQuickLoginStorageKey(profileId);
    store.profiles[storageKey] = {
      username,
      password,
      amf_label: amfLabel || profile.label || profileId,
    };
    store.last_profile_id = storageKey;
    this.quickLoginData = store;
    return store;
  },

  getQuickLoginCredentials(profileId, data) {
    const store = this.normalizeQuickLoginData(data === undefined ? this.quickLoginData : data);
    const requestedKey = this.getQuickLoginStorageKey(profileId);
    const credentials = (store.profiles || {})[requestedKey];
    if (credentials) return [credentials, requestedKey];

    const fallback = profileId || this.ACTIVE_AMF_PROFILE;
    const legacy = (store.profiles || {})[fallback];
    if (legacy) return [legacy, fallback];

    const resolved = store.last_profile_id || requestedKey;
    return [(store.profiles || {})[resolved], resolved];
  },

  setNinjasagaDebug(enabled) {
    this.ninjasagaDebug = !!enabled;
    return this.ninjasagaDebug;
  },

  getNinjasagaDebug() {
    return !!this.ninjasagaDebug;
  },

  getNinjasagaAntiDetectionProfile(state) {
    const merged = { ...NINJASAGA_ANTI_DETECTION_PROFILE };
    let runtimeState = state && typeof state === 'object' && state.anti_detection_profile ? state : this._settingsFor();
    if (!runtimeState || typeof runtimeState !== 'object') runtimeState = {};

    const stateProfile = runtimeState.anti_detection_profile;
    if (stateProfile && typeof stateProfile === 'object') Object.assign(merged, stateProfile);

    const keyMap = {
      leveling_delay_seconds: 'action_delay_seconds',
      leveling_cycle_cooldown_seconds: 'cycle_cooldown_seconds',
      leveling_rest_every_cycles: 'rest_every_cycles',
      leveling_rest_duration_seconds: 'rest_duration_seconds',
      leveling_action_jitter_seconds: 'action_jitter_seconds',
      leveling_min_call_delay_seconds: 'min_call_delay_seconds',
      leveling_start_retry_delay_seconds: 'start_retry_delay_seconds',
      leveling_start_max_retries: 'start_max_retries',
      leveling_cloudflare_rest_seconds: 'cloudflare_rest_seconds',
      leveling_failure_window_seconds: 'failure_window_seconds',
      leveling_max_failures_in_window: 'max_failures_in_window',
      leveling_circuit_cooldown_seconds: 'circuit_cooldown_seconds',
    };
    for (const [stateKey, profileKey] of Object.entries(keyMap)) {
      if (stateKey in runtimeState && runtimeState[stateKey] !== null && runtimeState[stateKey] !== undefined) {
        merged[profileKey] = runtimeState[stateKey];
      }
    }

    const rawSteps = merged.cloudflare_backoff_steps_seconds;
    if (Array.isArray(rawSteps)) {
      const cleaned = [];
      for (const value of rawSteps) {
        const v = Number.parseInt(value, 10);
        if (!Number.isNaN(v) && v > 0) cleaned.push(v);
      }
      merged.cloudflare_backoff_steps_seconds = cleaned.length
        ? cleaned
        : [...NINJASAGA_ANTI_DETECTION_PROFILE.cloudflare_backoff_steps_seconds];
    } else {
      merged.cloudflare_backoff_steps_seconds = [
        ...NINJASAGA_ANTI_DETECTION_PROFILE.cloudflare_backoff_steps_seconds,
      ];
    }
    return merged;
  },

  getNinjasagaAutoSpendProfile(state) {
    const merged = { ...NINJASAGA_AUTO_SPEND_PROFILE };
    let runtimeState = state && typeof state === 'object' && state.auto_spend_profile ? state : this._settingsFor();
    if (!runtimeState || typeof runtimeState !== 'object') runtimeState = {};

    const stateProfile = runtimeState.auto_spend_profile;
    if (stateProfile && typeof stateProfile === 'object') Object.assign(merged, stateProfile);

    const keyMap = {
      leveling_auto_spend_enabled: 'enabled',
      leveling_auto_spend_target: 'target',
      leveling_auto_spend_trigger_energy: 'trigger_energy',
      leveling_auto_spend_max_refills_per_run: 'max_refills_per_run',
    };
    for (const [stateKey, profileKey] of Object.entries(keyMap)) {
      if (stateKey in runtimeState && runtimeState[stateKey] !== null && runtimeState[stateKey] !== undefined) {
        merged[profileKey] = runtimeState[stateKey];
      }
    }

    merged.enabled = !!merged.enabled;
    merged.target = String(merged.target || 'energy');
    const refills = Number.parseInt(merged.max_refills_per_run ?? 1, 10);
    merged.max_refills_per_run = Number.isNaN(refills) ? 1 : Math.max(0, refills);
    merged.trigger_energy = 0;
    return merged;
  },

  getNinjasagaEventResourcePolicy(state) {
    const merged = { ...NINJASAGA_EVENT_RESOURCE_POLICY };
    let runtimeState = state && typeof state === 'object' && state.event_resource_policy ? state : this._settingsFor();
    if (!runtimeState || typeof runtimeState !== 'object') runtimeState = {};

    const saved = runtimeState.event_resource_policy;
    if (saved && typeof saved === 'object') Object.assign(merged, saved);

    merged.mode = String(merged.mode || 'wait').trim().toLowerCase();
    if (!['buy', 'wait', 'stop'].includes(merged.mode)) merged.mode = 'wait';
    const waitMinutes = Number.parseInt(merged.wait_minutes ?? 30, 10);
    merged.wait_minutes = Number.isNaN(waitMinutes) ? 30 : Math.max(0, waitMinutes);
    return merged;
  },

  getNinjasagaEventTiming(state) {
    const merged = { ...NINJASAGA_EVENT_TIMING };
    let runtimeState = state && typeof state === 'object' && state.event_timing ? state : this._settingsFor();
    if (!runtimeState || typeof runtimeState !== 'object') runtimeState = {};

    const saved = runtimeState.event_timing;
    if (saved && typeof saved === 'object') Object.assign(merged, saved);

    const delay = Number.parseInt(merged.sakura_battle_delay_seconds ?? 20, 10);
    merged.sakura_battle_delay_seconds = Number.isNaN(delay) ? 20 : Math.max(1, delay);
    const pumpkinDelay = Number.parseInt(merged.pumpkin_battle_delay_seconds ?? 20, 10);
    merged.pumpkin_battle_delay_seconds = Number.isNaN(pumpkinDelay) ? 20 : Math.max(1, pumpkinDelay);
    return merged;
  },

};

// Runtime fields resolve to the active session context (see _CONTEXT_FIELDS above).
for (const [prop, key] of Object.entries(_CONTEXT_FIELDS)) {
  Object.defineProperty(config, prop, {
    enumerable: true,
    configurable: true,
    get() { return activeContext()[key]; },
    set(value) { activeContext()[key] = value; },
  });
}

export default config;
