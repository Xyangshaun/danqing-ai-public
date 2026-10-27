/**
 * 灵感嫁接 · 用户自主搭配预设 (P2)
 * ===========================================================
 * 用户可将当前「风格 + 方法 + 强度 + 配比 + 生成数量」
 * 组合保存为命名预设,localStorage 持久化,上限 20 条。
 *
 * 存储 key: 'danqing-fuse-presets'
 */

export interface FuseUserPreset {
  id: string;
  /** 用户自定义命名 */
  name: string;
  styleId: string;
  methodId: string;
  intensityId: string;
  /** 作品A占比 0-1 */
  ratio: number;
  /** 生成数量 */
  variations: number;
  createdAt: number;
}

const STORAGE_KEY = 'danqing-fuse-presets';
const MAX_PRESETS = 20;

export function listFuseUserPresets(): FuseUserPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is FuseUserPreset =>
        p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.styleId === 'string',
    );
  } catch {
    return [];
  }
}

export function saveFuseUserPreset(
  preset: Omit<FuseUserPreset, 'id' | 'createdAt'>,
): FuseUserPreset {
  const list = listFuseUserPresets();
  const entry: FuseUserPreset = {
    ...preset,
    id: `fpreset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  const next = [entry, ...list].slice(0, MAX_PRESETS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return entry;
}

export function removeFuseUserPreset(id: string): void {
  const next = listFuseUserPresets().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
