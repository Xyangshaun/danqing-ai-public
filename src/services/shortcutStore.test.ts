// ============================================================
// 快捷入口存储 shortcutStore - 单元测试
// 覆盖:list / add / remove / isShortcutAdded / resolve / 上限 / 失效清理
// ============================================================

import { beforeEach, describe, expect, it } from 'vitest';
import {
  listShortcuts,
  addShortcut,
  removeShortcut,
  isShortcutAdded,
  resolveShortcuts,
  pruneInvalidShortcuts,
  MAX_SHORTCUTS,
} from './shortcutStore';

const EMOTION_KEY = 'danqing-emotion-presets';
const FUSE_KEY = 'danqing-fuse-presets';
const SHORTCUT_KEY = 'danqing-shortcuts';

/** 写入一条可被 resolve 的情绪画布预设(primaryId 用库中真实存在的 'calm') */
function seedEmotionPreset(id: string, name: string) {
  localStorage.setItem(EMOTION_KEY, JSON.stringify([
    {
      id,
      name,
      primaryId: 'calm',
      secondaryId: null,
      ratio: 0.7,
      intensity: 0.6,
      params: {},
      customPalette: null,
      createdAt: 1000,
    },
  ]));
}

/** 写入一条灵感嫁接预设(只要求 id/name 有效,resolve 不查 style) */
function seedFusePreset(id: string, name: string) {
  localStorage.setItem(FUSE_KEY, JSON.stringify([
    {
      id,
      name,
      styleId: 'style-a',
      methodId: 'method-a',
      intensityId: 'mid',
      ratio: 0.5,
      variations: 3,
      createdAt: 2000,
    },
  ]));
}

function seedShortcuts(list: unknown[]) {
  localStorage.setItem(SHORTCUT_KEY, JSON.stringify(list));
}

beforeEach(() => {
  localStorage.clear();
});

describe('shortcutStore', () => {
  it('listShortcuts 初始为空', () => {
    expect(listShortcuts()).toEqual([]);
  });

  it('addShortcut 成功添加并可通过 isShortcutAdded 判断', () => {
    seedEmotionPreset('e1', '宁静配色');
    const res = addShortcut('emotion', 'e1');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.shortcut.kind).toBe('emotion');
      expect(res.shortcut.presetId).toBe('e1');
      expect(typeof res.shortcut.id).toBe('string');
    }
    expect(isShortcutAdded('emotion', 'e1')).toBe(true);
  });

  it('重复添加返回 duplicate', () => {
    seedEmotionPreset('e1', '宁静配色');
    addShortcut('emotion', 'e1');
    const res = addShortcut('emotion', 'e1');
    expect(res).toEqual({ ok: false, reason: 'duplicate' });
  });

  it('达到上限 8 时返回 limit', () => {
    for (let i = 0; i < 8; i++) {
      seedEmotionPreset(`e${i}`, `预设${i}`);
      const res = addShortcut('emotion', `e${i}`);
      expect(res.ok).toBe(true);
    }
    // 第 9 个不同预设 → limit
    seedEmotionPreset('e9', '第9个');
    const res = addShortcut('emotion', 'e9');
    expect(res).toEqual({ ok: false, reason: 'limit' });
    expect(listShortcuts()).toHaveLength(MAX_SHORTCUTS);
  });

  it('removeShortcut 按 id 移除', () => {
    seedEmotionPreset('e1', '宁静配色');
    const res = addShortcut('emotion', 'e1');
    if (!res.ok) throw new Error('add should succeed');
    removeShortcut(res.shortcut.id);
    expect(listShortcuts()).toEqual([]);
    expect(isShortcutAdded('emotion', 'e1')).toBe(false);
  });

  it('resolveShortcuts 用最新预设名/色覆盖冗余并生成正确跳转链接', () => {
    // 先以旧名字添加快捷入口,再改预设名为新名字 → 渲染应取最新名
    seedEmotionPreset('e1', '旧名');
    const res = addShortcut('emotion', 'e1');
    if (!res.ok) throw new Error('add should succeed');
    // 改预设名
    localStorage.setItem(EMOTION_KEY, JSON.stringify([
      { ...JSON.parse(localStorage.getItem(EMOTION_KEY)!)[0], name: '新名' },
    ]));

    const resolved = resolveShortcuts();
    expect(resolved).toHaveLength(1);
    expect(resolved[0].name).toBe('新名');
    expect(resolved[0].accent).toBe('#0d4f4f'); // 'calm' 的主色
    expect(resolved[0].link).toBe('/emotion?preset=e1&auto=1');
  });

  it('resolveShortcuts 关联 fuse 预设并生成正确跳转链接', () => {
    seedFusePreset('f1', '嫁接方案A');
    addShortcut('fuse', 'f1');
    const resolved = resolveShortcuts();
    expect(resolved).toHaveLength(1);
    expect(resolved[0].name).toBe('嫁接方案A');
    expect(resolved[0].accent).toBe('#B45309');
    expect(resolved[0].link).toBe('/fuse?preset=f1&auto=1');
  });

  it('resolveShortcuts 过滤失效预设(preset 已删除)', () => {
    seedEmotionPreset('e1', '宁静配色');
    addShortcut('emotion', 'e1');
    // 删除该预设
    localStorage.setItem(EMOTION_KEY, JSON.stringify([]));
    expect(resolveShortcuts()).toEqual([]);
  });

  it('pruneInvalidShortcuts 静默清理失效快捷入口', () => {
    seedEmotionPreset('e1', '宁静配色');
    addShortcut('emotion', 'e1');
    seedFusePreset('f1', '嫁接方案A');
    addShortcut('fuse', 'f1');
    // 删除 e1 对应预设,仅剩 f1 有效
    localStorage.setItem(EMOTION_KEY, JSON.stringify([]));
    expect(listShortcuts()).toHaveLength(2);
    pruneInvalidShortcuts();
    const left = listShortcuts();
    expect(left).toHaveLength(1);
    expect(left[0].presetId).toBe('f1');
  });

  it('损坏的 localStorage 数据返回空且不抛错', () => {
    localStorage.setItem(SHORTCUT_KEY, 'not-json{{{');
    expect(listShortcuts()).toEqual([]);
    expect(resolveShortcuts()).toEqual([]);
  });
});
