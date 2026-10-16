// Port of UserSession / ConnectionManager / session registry in main.py.

export class AsyncEvent {
  constructor() {
    this._set = false;
    this._waiters = [];
  }

  set() {
    this._set = true;
    const waiters = this._waiters;
    this._waiters = [];
    for (const resolve of waiters) resolve(true);
  }

  clear() {
    this._set = false;
  }

  isSet() {
    return this._set;
  }

  wait(timeoutMs = null) {
    if (this._set) return Promise.resolve(true);
    return new Promise((resolve) => {
      if (timeoutMs === null) {
        this._waiters.push(() => resolve(true));
        return;
      }
      const timer = setTimeout(() => resolve(false), timeoutMs);
      this._waiters.push(() => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}

export function timestampHms() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export class UserSession {
  constructor(userId, username, config, baseGameId = null, profileId = null) {
    this.user_id = userId;
    this.username = username;
    const game = baseGameId ? { id: baseGameId } : config.getCurrentBaseGame();
    const profile = profileId ? { id: profileId } : config.getCurrentAmfProfile();
    this.base_game_id = game.id;
    this.profile_id = profile.id;
    this.game_context = config.createContext(this.base_game_id, this.profile_id);
    this.game_data = null;
    this.login_data = null;
    this.characters = null;
    this.raw_characters_response = null;
    this.current_character = null;
    this.character_data = null;
    this.action_task = null;
    this.stop_event = new AsyncEvent();
    this.logs = [];
    this.battle_logs = [];
    this.websocket = null;
    this.last_activity = new Date();
    this.quick_login_data = null;
    this.clan_war_state = {};
    this.clan_war_modal_stop_only = false;
    this.clan_war_captcha_resume = new AsyncEvent();
  }

  addLog(message, logType = 'info') {
    this.logs.push({ timestamp: timestampHms(), message, type: logType });
    if (this.logs.length > 1000) this.logs = this.logs.slice(-1000);
  }

  addBattleLog(message, result = 'info') {
    this.battle_logs.push({ timestamp: timestampHms(), message, result });
    if (this.battle_logs.length > 500) this.battle_logs = this.battle_logs.slice(-500);
  }

  clearLogs() {
    this.logs = [];
    this.battle_logs = [];
    this.addLog('Logs cleared.', 'info');
  }

  toDict() {
    return {
      user_id: this.user_id,
      username: this.username,
      base_game_id: this.base_game_id,
      profile_id: this.profile_id,
      has_characters: this.characters != null && this.characters.length > 0,
      character_count: this.characters ? this.characters.length : 0,
      current_character: this.current_character ? this.current_character.character_name : null,
      is_running: this.action_task != null && !this.action_task.done,
      current_action: this.action_task ? this.action_task.action_name || 'None' : null,
      last_activity: this.last_activity.toISOString(),
    };
  }
}

export class ConnectionManager {
  constructor(getSession) {
    this.active_connections = new Map();
    this.getSession = getSession;
  }

  connect(userId, websocket) {
    this.active_connections.set(userId, websocket);
    const session = this.getSession(userId);
    if (session) session.websocket = websocket;
  }

  disconnect(userId) {
    this.active_connections.delete(userId);
    const session = this.getSession(userId);
    if (session) session.websocket = null;
  }

  async _send(userId, payload) {
    const ws = this.active_connections.get(userId);
    if (!ws) return;
    try {
      ws.send(JSON.stringify(payload));
    } catch {
      // ignore closed sockets
    }
  }

  async sendLog(userId, logEntry) {
    await this._send(userId, { type: 'log', data: logEntry });
  }

  async sendBattleLog(userId, logEntry) {
    await this._send(userId, { type: 'battle_log', data: logEntry });
  }

  async sendStatus(userId, status) {
    await this._send(userId, { type: 'status', data: status });
  }

  async sendCharacterUpdate(userId, character) {
    await this._send(userId, { type: 'character_update', character });
  }
}

export class SessionManager {
  constructor(config) {
    this.config = config;
    this.sessions = new Map();
    this.pendingRiftVerifications = new Map();
    this.manager = new ConnectionManager((userId) => this.getSession(userId));
  }

  create(userId, username, baseGameId = null, profileId = null) {
    const session = new UserSession(userId, username, this.config, baseGameId, profileId);
    this.sessions.set(userId, session);
    return session;
  }

  getSession(userId) {
    const session = this.sessions.get(userId);
    if (session) session.last_activity = new Date();
    return session;
  }

  async cleanupOldSessions() {
    const now = Date.now();
    for (const [userId, session] of [...this.sessions.entries()]) {
      if ((now - session.last_activity.getTime()) / 1000 > 3600) {
        if (session.action_task && !session.action_task.done) {
          session.stop_event.set();
          session.action_task.cancel?.();
        }
        this.sessions.delete(userId);
      }
    }
  }

  startCleanupLoop(intervalMs = 300000) {
    this._cleanupTimer = setInterval(() => {
      this.cleanupOldSessions().catch(() => {});
    }, intervalMs);
    if (this._cleanupTimer.unref) this._cleanupTimer.unref();
  }
}

export function getSessionTokens(config, session) {
  if (!config.getCurrentBaseGame().has_tokens) return 0;
  const sources = [session.raw_characters_response, session.login_data, config.allChar];
  for (const source of sources) {
    if (source && typeof source === 'object') {
      const raw = source.tokens ?? source.account_tokens ?? source.account_balance;
      if (raw !== undefined && raw !== null) {
        const parsed = Number.parseInt(raw, 10);
        if (!Number.isNaN(parsed)) return parsed;
      }
    }
  }
  return 0;
}
