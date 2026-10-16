// Port of desktop_app/core/ninjasaga/progress_parser.py

export function extractCharacterId(charData) {
  if (!charData || typeof charData !== 'object') return null;
  const value = charData.character_id ?? charData.char_id ?? charData.id;
  if (Array.isArray(value)) return value.length ? value[0] : null;
  return value;
}

export function extractCharacterLevel(charData, defaultValue = 1) {
  if (!charData || typeof charData !== 'object') return Number(defaultValue);
  const value = charData.character_level ?? charData.level ?? defaultValue;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? Number(defaultValue) : parsed;
}

export function extractProgressSnapshot(response, defaultLevel, defaultRank = null) {
  const data = response && typeof response === 'object' && !Array.isArray(response) ? response : {};
  let nested = null;
  for (const key of ['character_data', 'data', 'character', 'result']) {
    const value = data[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      nested = value;
      break;
    }
  }
  const merged = { ...(nested || {}), ...data };

  const name = merged.character_name || merged.name || 'Unknown';
  const levelRaw = merged.character_level ?? merged.level;
  const xpRaw = merged.character_xp ?? merged.xp;
  const goldRaw = merged.character_gold ?? merged.gold;
  const rankRaw = merged.character_rank ?? merged.rank ?? merged.current_rank ?? merged.rank_id;
  const energyRaw = merged.character_energy ?? merged.current_energy ?? merged.energy;

  let level = levelRaw !== null && levelRaw !== undefined ? Number.parseInt(levelRaw, 10) : Number.parseInt(defaultLevel, 10);
  if (Number.isNaN(level)) level = Number.parseInt(defaultLevel, 10);
  let xp = xpRaw !== null && xpRaw !== undefined ? Number.parseInt(xpRaw, 10) : 0;
  if (Number.isNaN(xp)) xp = 0;
  let gold = goldRaw !== null && goldRaw !== undefined ? Number.parseInt(goldRaw, 10) : 0;
  if (Number.isNaN(gold)) gold = 0;
  let rank = rankRaw !== null && rankRaw !== undefined ? Number.parseInt(rankRaw, 10) : defaultRank;
  if (Number.isNaN(rank)) rank = defaultRank;
  let energy = energyRaw !== null && energyRaw !== undefined ? Number.parseInt(energyRaw, 10) : null;
  if (Number.isNaN(energy)) energy = null;

  return [String(name), level, xp, gold, rank, energy];
}
