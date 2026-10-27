// ============================================================
// MaterialsPage 页面单元测试 (任务包 E:块3)
// 对应源码: src/pages/MaterialsPage.tsx
//
// 测试范围:
//   1. 首页渲染(标题/统计卡片/筛选区)
//   2. 搜索过滤(关键词匹配)
//   3. 分类标签筛选
//   4. 视图切换(网格/列表)
//   5. 收藏切换
//   6. 素材包面板
//   7. 空结果态
//
// Mock 策略:
//   - artworksDatabase.getFilterOptions: 返回可控筛选选项
//   - materialService.getBuiltinArtworkItems: 返回可控作品列表
//   - materialService.getPacks: 返回空素材包
//   - data-service.getFavorites/toggleFavorite: 可控
//   - useLazyImage: 始终 loaded(避免 IntersectionObserver 依赖)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import MaterialsPage from '../MaterialsPage';
import { ToastProvider } from '../../components/ToastProvider';
import type { ArtworkItem } from '../../services/artworksDatabase';

/* ---------- mock 依赖 ---------- */

const loadBuiltinArtworksMock = vi.fn<(...args: unknown[]) => Promise<ArtworkItem[]>>();
const getPacksMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();

vi.mock('../../services/artworksDatabase', () => ({
  // 数据加载:由 loadBuiltinArtworksMock 控制返回的作品列表
  loadBuiltinArtworks: (...args: unknown[]) => loadBuiltinArtworksMock(...args),
  // 筛选计数:基于传入 items 实时计算,保证筛选徽章数量正确
  getFilterCounts: (items: ArtworkItem[] = []) => {
    const counts = {
      category: {} as Record<string, number>,
      style: {} as Record<string, number>,
      era: {} as Record<string, number>,
      region: {} as Record<string, number>,
      tag: {} as Record<string, number>,
    };
    items.forEach((a) => {
      counts.category[a.category] = (counts.category[a.category] || 0) + 1;
      counts.style[a.style] = (counts.style[a.style] || 0) + 1;
      counts.era[a.era] = (counts.era[a.era] || 0) + 1;
      counts.region[a.region] = (counts.region[a.region] || 0) + 1;
      a.tags.forEach((t) => { counts.tag[t] = (counts.tag[t] || 0) + 1; });
    });
    return counts;
  },
  // 图片 URL 解析:测试用 http URL,直接透传原 item
  resolveArtworkImageUrl: (item: ArtworkItem) => item,
  // 缩略图解析:与上一致,直接透传 thumbUrl ?? imageUrl
  resolveArtworkThumbUrl: (item: ArtworkItem) => item.thumbUrl || item.imageUrl,
  // 兜底图解析:源码用于 onError 降级,测试中返回原图即可
  resolveArtworkFallbackUrl: (item: ArtworkItem) => item.imageUrl,
  // 保留旧导出以兼容(源码未使用)
  getFilterOptions: () => ({
    categories: ['painting', 'design'],
    styles: ['水墨', '油画'],
    eras: ['宋代', '文艺复兴'],
    regions: ['china', 'europe'],
    artists: ['测试艺术家'],
    tags: ['山水', '人物'],
  }),
}));

vi.mock('../../services/materialService', () => ({
  getPacks: (...args: unknown[]) => getPacksMock(...args),
  createPack: vi.fn(),
  deletePack: vi.fn(),
  addToPack: vi.fn(),
  resolvePackMaterials: vi.fn().mockResolvedValue([]),
}));

const getFavoritesMock = vi.fn<(...args: unknown[]) => Promise<string[]>>();
const toggleFavoriteMock = vi.fn<(...args: unknown[]) => Promise<{ favorited: boolean }>>();
vi.mock('../../services/data-service', () => ({
  getFavorites: (...args: unknown[]) => getFavoritesMock(...args),
  toggleFavorite: (...args: unknown[]) => toggleFavoriteMock(...args),
}));

vi.mock('../../hooks/useLazyImage', () => ({
  useLazyImage: (src: string | undefined) => ({
    imgRef: { current: null },
    loadedSrc: src,
    isLoaded: !!src,
    isError: false,
  }),
}));

/* ---------- 测试数据工厂 ---------- */

function makeArtwork(overrides: Partial<ArtworkItem> = {}): ArtworkItem {
  return {
    id: 'art-1',
    title: '测试作品一',
    artist: '测试艺术家',
    year: '2026',
    category: 'painting',
    style: '水墨',
    era: '宋代',
    region: 'china',
    description: '描述',
    imageUrl: 'https://example.com/art.png',
    source: 'mock',
    tags: ['山水'],
    ...overrides,
  };
}

/* ---------- 渲染辅助 ---------- */

function renderMaterials() {
  return render(
    <MemoryRouter initialEntries={['/materials']}>
      <ToastProvider>
        <MaterialsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  loadBuiltinArtworksMock.mockReset();
  getPacksMock.mockReset();
  getFavoritesMock.mockReset();
  toggleFavoriteMock.mockReset();
  loadBuiltinArtworksMock.mockResolvedValue([makeArtwork()]);
  getPacksMock.mockResolvedValue([]);
  getFavoritesMock.mockResolvedValue([]);
  toggleFavoriteMock.mockResolvedValue({ favorited: true });
});

/* ============================================================
 * 1. 首页渲染
 * ============================================================ */
describe('MaterialsPage 首页渲染', () => {
  it('渲染标题"海内外名作 · 实时获取"与"在线艺术素材库"徽章', () => {
    renderMaterials();
    expect(screen.getByText('海内外名作 · 实时获取')).toBeInTheDocument();
    expect(screen.getByText('在线艺术素材库')).toBeInTheDocument();
  });

  it('渲染统计卡片(总作品数/风格类型/时代跨度/地区来源/标签数量)', () => {
    renderMaterials();
    expect(screen.getByText('总作品数')).toBeInTheDocument();
    expect(screen.getByText('风格类型')).toBeInTheDocument();
    expect(screen.getByText('时代跨度')).toBeInTheDocument();
    expect(screen.getByText('地区来源')).toBeInTheDocument();
    expect(screen.getByText('标签数量')).toBeInTheDocument();
  });

  it('渲染搜索输入框', () => {
    renderMaterials();
    expect(screen.getByPlaceholderText('搜索作品名称、画家、标签（支持中英文）...')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 搜索过滤
 * ============================================================ */
describe('MaterialsPage 搜索过滤', () => {
  it('输入关键词过滤作品列表', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([
      makeArtwork({ id: 'a1', title: '山水画卷' }),
      makeArtwork({ id: 'a2', title: '花鸟图', tags: ['花鸟'] }),
    ]);
    renderMaterials();
    const input = screen.getByPlaceholderText('搜索作品名称、画家、标签（支持中英文）...');
    fireEvent.change(input, { target: { value: '山水' } });
    // 防抖 300ms 后才过滤:在 waitFor 内同时校验「命中保留」与「未命中移除」,
    // 避免在防抖触发前(两张卡片均渲染)过早断言导致竞态。
    await waitFor(() => {
      expect(screen.getByText('山水画卷')).toBeInTheDocument();
      expect(screen.queryByText('花鸟图')).not.toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 3. 作品列表渲染
 * ============================================================ */
describe('MaterialsPage 作品列表', () => {
  it('渲染作品卡片(标题可见)', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([
      makeArtwork({ id: 'a1', title: '清明上河图' }),
    ]);
    renderMaterials();
    await waitFor(() => {
      expect(screen.getByText('清明上河图')).toBeInTheDocument();
    });
  });

  it('无匹配结果时显示空态', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([
      makeArtwork({ id: 'a1', title: '山水画' }),
    ]);
    renderMaterials();
    const input = screen.getByPlaceholderText('搜索作品名称、画家、标签（支持中英文）...');
    fireEvent.change(input, { target: { value: '不存在的作品XYZ' } });
    await waitFor(() => {
      expect(screen.queryByText('山水画')).not.toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 4. 收藏切换
 * ============================================================ */
describe('MaterialsPage 收藏切换', () => {
  it('点击收藏按钮调用 toggleFavorite', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([
      makeArtwork({ id: 'a1', title: '可收藏作品' }),
    ]);
    renderMaterials();
    await waitFor(() => {
      expect(screen.getByText('可收藏作品')).toBeInTheDocument();
    });
    // 收藏按钮(Heart 图标按钮,使用 aria-label 选择)
    const favBtn = screen.getByLabelText('收藏');
    fireEvent.click(favBtn);
    await waitFor(() => {
      expect(toggleFavoriteMock).toHaveBeenCalledWith('a1');
    });
  });
});

/* ============================================================
 * 5. 素材包面板
 * ============================================================ */
describe('MaterialsPage 素材包', () => {
  it('挂载时调用 getPacks 加载素材包', async () => {
    renderMaterials();
    await waitFor(() => {
      expect(getPacksMock).toHaveBeenCalled();
    });
  });

  it('挂载时调用 getFavorites 加载收藏列表', async () => {
    renderMaterials();
    await waitFor(() => {
      expect(getFavoritesMock).toHaveBeenCalled();
    });
  });
});

/* ============================================================
 * 6. 错误处理
 * ============================================================ */
describe('MaterialsPage 错误处理', () => {
  it('getFavorites 抛错时静默不崩溃', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    getFavoritesMock.mockRejectedValue(new Error('storage'));
    renderMaterials();
    await waitFor(() => {
      expect(screen.getByText('海内外名作 · 实时获取')).toBeInTheDocument();
    });
    errorSpy.mockRestore();
  });

  it('toggleFavorite 抛错时显示错误提示(不崩溃)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    toggleFavoriteMock.mockRejectedValue(new Error('fail'));
    loadBuiltinArtworksMock.mockResolvedValue([
      makeArtwork({ id: 'a1', title: '收藏失败作品' }),
    ]);
    renderMaterials();
    await waitFor(() => {
      expect(screen.getByText('收藏失败作品')).toBeInTheDocument();
    });
    const favBtn = screen.getByLabelText('收藏');
    fireEvent.click(favBtn);
    await waitFor(() => {
      expect(toggleFavoriteMock).toHaveBeenCalled();
    });
    errorSpy.mockRestore();
  });
});

/* ============================================================
 * 7. Pinterest 改造:瀑布流 / 无限滚动 / 艺术家筛选 / 相关推荐
 * ============================================================ */
describe('MaterialsPage Pinterest 改造', () => {
  it('网格视图使用 JS 预分配列瀑布流容器(flex 列,非均匀 grid / CSS columns)', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([makeArtwork({ id: 'a1', title: '瀑布流作品' })]);
    const { container } = renderMaterials();
    await waitFor(() => {
      expect(screen.getByText('瀑布流作品')).toBeInTheDocument();
    });
    /* 瀑布流已改造为 JS 预分配列(修复无限滚动 CLS):
     *   外层 flex gap-4 items-start,每列 flex-1 flex flex-col gap-4 min-w-0;
     *   不再使用 columns-* / grid-cols-* 均匀网格 */
    const columns = container.querySelectorAll('.flex-1.flex.flex-col.gap-4.min-w-0');
    expect(columns.length).toBeGreaterThan(0);
    expect(columns[0].className).not.toContain('grid-cols-');
    expect(columns[0].className).not.toContain('columns-');
  });

  it('作品数不足一页时,无限滚动哨兵显示「已加载全部」', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([makeArtwork({ id: 'a1', title: '唯一作品' })]);
    renderMaterials();
    await waitFor(() => {
      expect(screen.getByText(/已加载全部/)).toBeInTheDocument();
    });
  });

  it('渲染「艺术家」筛选区(可多选)', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([makeArtwork({ id: 'a1', title: '艺术家筛选作品' })]);
    renderMaterials();
    await waitFor(() => {
      expect(screen.getByText('艺术家筛选作品')).toBeInTheDocument();
    });
    expect(screen.getByText('艺术家')).toBeInTheDocument();
  });

  it('点击艺术家标签按艺术家过滤作品', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([
      makeArtwork({ id: 'a1', title: '张三作品', artist: '张三' }),
      makeArtwork({ id: 'a2', title: '李四作品', artist: '李四' }),
    ]);
    renderMaterials();
    await waitFor(() => {
      expect(screen.getByText('张三作品')).toBeInTheDocument();
      expect(screen.getByText('李四作品')).toBeInTheDocument();
    });
    // 点击「张三」艺术家标签,仅保留张三作品
    const zhangBtn = screen.getByRole('button', { name: /张三/ });
    fireEvent.click(zhangBtn);
    await waitFor(() => {
      expect(screen.getByText('张三作品')).toBeInTheDocument();
      expect(screen.queryByText('李四作品')).not.toBeInTheDocument();
    });
  });

  it('详情弹窗底部渲染「相关推荐」(6 件,排除当前作品)', async () => {
    loadBuiltinArtworksMock.mockResolvedValue([
      makeArtwork({ id: 'a1', title: '主作品' }),
      makeArtwork({ id: 'a2', title: '相关二' }),
      makeArtwork({ id: 'a3', title: '相关三' }),
      makeArtwork({ id: 'a4', title: '相关四' }),
      makeArtwork({ id: 'a5', title: '相关五' }),
      makeArtwork({ id: 'a6', title: '相关六' }),
      makeArtwork({ id: 'a7', title: '相关七' }),
    ]);
    renderMaterials();
    await waitFor(() => {
      expect(screen.getByText('主作品')).toBeInTheDocument();
    });
    // 点击主作品标题(悬停遮罩内的 h3)打开详情弹窗
    fireEvent.click(screen.getByText('主作品'));
    await waitFor(() => {
      expect(screen.getByText('相关推荐')).toBeInTheDocument();
    });
    // 弹窗以 overlay 形式叠加,背景瀑布流卡片仍挂载:
    // 因此「相关二」会同时出现在背景卡片 h3 与相关推荐 compact 卡片 h3 中(共 2 处),
    // 据此可断言相关推荐卡片确实渲染。
    expect(screen.getAllByText('相关二')).toHaveLength(2);
    expect(screen.getAllByText('相关七')).toHaveLength(2);
  });
});
