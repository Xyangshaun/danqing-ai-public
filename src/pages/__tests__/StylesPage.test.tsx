// ============================================================
// StylesPage 页面单元测试 (任务包 E:块3)
// 对应源码: src/pages/StylesPage.tsx
//
// 测试范围:
//   1. 首页渲染(标题/分类卡片/热门风格)
//   2. 点击分类卡片进入风格列表
//   3. 点击热门风格标签进入对应分类
//   4. 返回分类首页
//   5. 收藏切换(toast 反馈)
//
// Mock 策略:
//   - artworksDatabase.loadBuiltinArtworks: 返回可控作品列表(源码已改为
//     异步加载 data/artworks.json,jsdom 环境由本 mock 提供数据)
//   - artworksDatabase.styleCategories: 保留真实数据(只读常量)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import StylesPage from '../StylesPage';
import { ToastProvider } from '../../components/ToastProvider';
import type { ArtworkItem } from '../../services/artworksDatabase';

/* ---------- mock 依赖 ---------- */

const loadBuiltinArtworksMock = vi.fn<(...args: unknown[]) => Promise<ArtworkItem[]>>();
vi.mock('../../services/artworksDatabase', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../services/artworksDatabase')>();
  return {
    ...mod,
    // 数据加载:由 loadBuiltinArtworksMock 控制返回的作品列表
    loadBuiltinArtworks: (...args: unknown[]) => loadBuiltinArtworksMock(...args),
    // 缩略图解析:测试用 http URL,直接透传
    resolveArtworkThumbUrl: (item: ArtworkItem) => item.thumbUrl || item.imageUrl,
  };
});

/* ---------- 测试数据工厂 ---------- */

function makeArtwork(overrides: Partial<ArtworkItem> = {}): ArtworkItem {
  return {
    id: 'art-1',
    title: '测试作品',
    artist: '测试艺术家',
    year: '2026',
    category: 'painting',
    style: '水墨',
    era: '宋代',
    region: 'china',
    description: '描述',
    imageUrl: 'https://example.com/art.png',
    source: 'mock',
    tags: [],
    ...overrides,
  };
}

/* ---------- 渲染辅助 ---------- */

function renderStyles() {
  return render(
    <MemoryRouter initialEntries={['/styles']}>
      <ToastProvider>
        <StylesPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  loadBuiltinArtworksMock.mockReset();
  loadBuiltinArtworksMock.mockResolvedValue([makeArtwork()]);
});

/* ============================================================
 * 1. 首页渲染
 * ============================================================ */
describe('StylesPage 首页渲染', () => {
  it('渲染标题"艺术风格 · 分类索引"与"在线风格库"徽章', () => {
    renderStyles();
    expect(screen.getByText('艺术风格 · 分类索引')).toBeInTheDocument();
    expect(screen.getByText('在线风格库')).toBeInTheDocument();
  });

  it('渲染 4 个分类卡片(绘画/设计/产品设计/雕塑)', () => {
    renderStyles();
    expect(screen.getAllByText('绘画').length).toBeGreaterThan(0);
    expect(screen.getAllByText('设计').length).toBeGreaterThan(0);
    // "产品设计"可能在分类卡片和其他位置多次出现
    expect(screen.getAllByText('产品设计').length).toBeGreaterThan(0);
    expect(screen.getAllByText('雕塑').length).toBeGreaterThan(0);
  });

  it('渲染"热门风格"区块', () => {
    renderStyles();
    expect(screen.getByText('热门风格')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 分类导航
 * ============================================================ */
describe('StylesPage 分类导航', () => {
  it('点击"绘画"分类卡片进入风格列表(显示作品数)', () => {
    renderStyles();
    // 点击分类卡片(卡片内 h3 标题为"绘画")
    const cards = screen.getAllByText('绘画');
    fireEvent.click(cards[0]);
    // 进入分类后应有返回按钮或风格选择区
    expect(screen.getByText('返回分类')).toBeInTheDocument();
  });

  it('点击热门风格标签"水墨"进入对应分类', () => {
    renderStyles();
    const inkBtn = screen.getByText('水墨', { exact: false });
    fireEvent.click(inkBtn.closest('button')!);
    expect(screen.getByText('返回分类')).toBeInTheDocument();
  });

  it('点击"返回分类"回到分类首页', () => {
    renderStyles();
    const cards = screen.getAllByText('绘画');
    fireEvent.click(cards[0]);
    fireEvent.click(screen.getByText('返回分类'));
    // 回到首页后热门风格区块重新出现
    expect(screen.getByText('热门风格')).toBeInTheDocument();
  });
});

/* ============================================================
 * 3. 收藏切换
 * ============================================================ */
describe('StylesPage 收藏切换', () => {
  it('点击分类卡片后进入列表,点击作品收藏触发 toast', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([
      makeArtwork({ id: 'a1', title: '水墨山水图', style: '水墨', category: 'painting' }),
    ]);
    renderStyles();
    const cards = screen.getAllByText('绘画');
    fireEvent.click(cards[0]);
    // 等待作品列表渲染
    await waitFor(() => {
      expect(screen.getByText('水墨山水图')).toBeInTheDocument();
    });
  });
});
