/**
 * 相手名つきハンドレンジの保存（Pro）
 */

const KEY = 'yomi_villain_profiles_v1';

/**
 * @typedef {{ id: string, name: string, hands: string[], updatedAt: number }} VillainProfile
 */

/** @returns {VillainProfile[]} */
export function listProfiles() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function writeAll(list) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

/**
 * @param {string} name
 * @param {string[]} hands
 * @param {string} [id]
 */
export function saveProfile(name, hands, id) {
  const n = String(name || '').trim();
  if (!n) throw new Error('相手の名前を入力してください');
  if (!hands?.length) throw new Error('ハンドを1つ以上選んでください');

  const list = listProfiles();
  const now = Date.now();
  if (id) {
    const i = list.findIndex((p) => p.id === id);
    if (i >= 0) {
      list[i] = { ...list[i], name: n, hands: [...hands], updatedAt: now };
      writeAll(list);
      return list[i];
    }
  }

  // 同名は上書き
  const same = list.findIndex((p) => p.name.toLowerCase() === n.toLowerCase());
  if (same >= 0) {
    list[same] = { ...list[same], name: n, hands: [...hands], updatedAt: now };
    writeAll(list);
    return list[same];
  }

  const profile = {
    id: `v_${now.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
    name: n,
    hands: [...hands],
    updatedAt: now,
  };
  list.unshift(profile);
  writeAll(list);
  return profile;
}

export function deleteProfile(id) {
  writeAll(listProfiles().filter((p) => p.id !== id));
}

export function getProfile(id) {
  return listProfiles().find((p) => p.id === id) || null;
}
