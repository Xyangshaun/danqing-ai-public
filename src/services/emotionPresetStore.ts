/**
 * 情绪画布预设存储 (P1)
 * ===========================================================
 * localStorage 持久化用户的情绪组合预设:
 *   主/次情绪 + 配比 + 生成参数 + 自定义色板 + 自定义命名
 *
 * 存储 key: 'danqing-emotion-presets'
 * 上限 20 条,超出时移除最旧预设
 */

import type { GenerationParams } from './emotionLibrary';

export interface EmotionPreset {
  id: string;
  /** 用户自定义命名 */
  name: string;
  /** 主情绪 id */
  primaryId: string;
  /** 次情绪 id(可选) */
  secondaryId: string | null;
  /** 主情绪占比 0-1 */
  ratio: number;
  /** 情绪浓度 0-1 */
  intensity: number;
  /** 生成参数 */
  params: GenerationParams;
  /** 自定义色板(若用户编辑过) */
  customPalette: string[] | null;
  createdAt: number;
}

const STORAGE_KEY = 'danqing-emotion-presets';
const MAX_PRESETS = 20;

export function listEmotionPresets(): EmotionPreset[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is EmotionPreset =>
        p && typeof p.id === 'string' && typeof p.name === 'string' && typeof p.primaryId === 'string',
    );
  } catch {
    return [];
  }
}

export function saveEmotionPreset(
  preset: Omit<EmotionPreset, 'id' | 'createdAt'>,
): EmotionPreset {
  const list = listEmotionPresets();
  const entry: EmotionPreset = {
    ...preset,
    id: `preset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    createdAt: Date.now(),
  };
  const next = [entry, ...list].slice(0, MAX_PRESETS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return entry;
}

export function removeEmotionPreset(id: string): void {
  const next = listEmotionPresets().filter((p) => p.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}

export function renameEmotionPreset(id: string, name: string): void {
  const next = listEmotionPresets().map((p) => (p.id === id ? { ...p, name } : p));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
}
