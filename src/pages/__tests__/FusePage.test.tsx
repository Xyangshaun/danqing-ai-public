// ============================================================
// FusePage 页面单元测试 (任务包 E:块3)
// 对应源码: src/pages/FusePage.tsx
//
// 测试范围:
//   1. 首页渲染(标题/融合标准设置开关)
//   2. 融合标准设置面板(嫁接风格/融合方法/融合强度)
//   3. 素材库选择器(打开/选择作品)
//   4. 灵感融合流程(选 2 作品 → 融合 → 结果)
//   5. 融合失败错误处理
//
// Mock 策略:
//   - imageService.generateImage: 返回占位图 URL
//   - artworksDatabase.loadBuiltinArtworks: 返回可控作品列表(源码已改为
//     异步加载 data/artworks.json,jsdom 环境由本 mock 提供数据)
//   - data-service.saveSavedMaterial: 可控
//   - fuseStandards: 保留真实导出(纯数据 + 纯函数,提升覆盖率)
// ============================================================

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import FusePage from '../FusePage';
import { ToastProvider } from '../../components/ToastProvider';
import type { ArtworkItem } from '../../services/artworksDatabase';

/* ---------- mock 依赖 ---------- */

const generateImageMock = vi.fn<(...args: unknown[]) => string>();
const saveSavedMaterialMock = vi.fn<(...args: unknown[]) => Promise<unknown>>();
const getSavedMaterialsMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
const getPacksMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
const resolvePackMaterialsMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
const loadBuiltinArtworksMock = vi.fn<(...args: unknown[]) => Promise<ArtworkItem[]>>();

vi.mock('../../services/imageService', () => ({
  generateImage: (...args: unknown[]) => generateImageMock(...args),
  /* 页面 catch 分支需 instanceof / new ImageGenerationError,mock 必须导出同名类 */
  ImageGenerationError: class MockImageGenerationError extends Error {
    readonly reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.name = 'ImageGenerationError';
      this.reason = reason;
    }
  },
}));

vi.mock('../../services/data-service', () => ({
  saveSavedMaterial: (...args: unknown[]) => saveSavedMaterialMock(...args),
  getSavedMaterials: (...args: unknown[]) => getSavedMaterialsMock(...args),
}));

vi.mock('../../services/materialService', () => ({
  getPacks: (...args: unknown[]) => getPacksMock(...args),
  resolvePackMaterials: (...args: unknown[]) => resolvePackMaterialsMock(...args),
}));

vi.mock('../../services/artworksDatabase', () => ({
  // 数据加载:由 loadBuiltinArtworksMock 控制返回的作品列表
  loadBuiltinArtworks: (...args: unknown[]) => loadBuiltinArtworksMock(...args),
  // 图片 URL 解析:测试用 http URL,直接透传
  resolveArtworkImageUrl: (item: ArtworkItem) => item,
  resolveArtworkThumbUrl: (item: ArtworkItem) => item.thumbUrl || item.imageUrl,
}));

/* ---------- 测试数据工厂 ---------- */

function makeArtwork(overrides: Partial<ArtworkItem> = {}): ArtworkItem {
  return {
    id: 'art-1',
    title: '测试素材',
    artist: '艺术家',
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

function renderFuse() {
  return render(
    <MemoryRouter initialEntries={['/fuse']}>
      <ToastProvider>
        <FusePage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  generateImageMock.mockReset();
  saveSavedMaterialMock.mockReset();
  getSavedMaterialsMock.mockReset();
  getPacksMock.mockReset();
  resolvePackMaterialsMock.mockReset();
  loadBuiltinArtworksMock.mockReset();
  generateImageMock.mockReturnValue('https://example.com/generated.png');
  saveSavedMaterialMock.mockResolvedValue(undefined);
  getSavedMaterialsMock.mockResolvedValue([]);
  getPacksMock.mockResolvedValue([]);
  resolvePackMaterialsMock.mockResolvedValue([]);
  loadBuiltinArtworksMock.mockResolvedValue([
    makeArtwork({ id: 'a1', title: '素材一' }),
    makeArtwork({ id: 'a2', title: '素材二' }),
  ]);
});

/* ============================================================
 * 1. 首页渲染
 * ============================================================ */
describe('FusePage 首页渲染', () => {
  it('渲染标题"创意融合 · 1+1>2"与"灵感嫁接"徽章', () => {
    renderFuse();
    expect(screen.getByText('创意融合 · 1+1>2')).toBeInTheDocument();
    expect(screen.getByText('灵感嫁接')).toBeInTheDocument();
  });

  it('渲染"融合标准设置"开关按钮', () => {
    renderFuse();
    expect(screen.getByText('融合标准设置')).toBeInTheDocument();
  });

  it('渲染主体作品与嫁接元素上传区', () => {
    renderFuse();
    // 实际文本为"作品 1 · 主体作品"和"作品 2 · 嫁接元素",用正则匹配
    expect(screen.getByText(/主体作品/)).toBeInTheDocument();
    expect(screen.getByText(/嫁接元素/)).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 融合标准设置面板
 * ============================================================ */
describe('FusePage 融合标准设置', () => {
  it('点击"融合标准设置"展开设置面板(显示嫁接风格/融合方法/融合强度)', () => {
    renderFuse();
    fireEvent.click(screen.getByText('融合标准设置'));
    expect(screen.getByText('嫁接风格')).toBeInTheDocument();
    expect(screen.getByText('融合方法')).toBeInTheDocument();
    expect(screen.getByText('融合强度')).toBeInTheDocument();
  });

  it('再次点击收起设置面板', () => {
    renderFuse();
    const btn = screen.getByText('融合标准设置');
    fireEvent.click(btn);
    expect(screen.getByText('嫁接风格')).toBeInTheDocument();
    fireEvent.click(screen.getByText('收起标准设置'));
    expect(screen.queryByText('嫁接风格')).not.toBeInTheDocument();
  });
});

/* ============================================================
 * 3. 素材库选择器
 * ============================================================ */
describe('FusePage 素材库选择器', () => {
  it('点击"从素材库选"打开选择器面板', async () => {
    renderFuse();
    const pickBtn = screen.getAllByText(/从素材库选/)[0];
    fireEvent.click(pickBtn);
    // 素材数据异步加载(useEffect → loadBuiltinArtworks),等待列表渲染
    const items = await screen.findAllByText('素材一');
    expect(items.length).toBeGreaterThan(0);
  });

  it('在选择器中点击作品选中第一张', async () => {
    renderFuse();
    const pickBtn = screen.getAllByText(/从素材库选/)[0];
    fireEvent.click(pickBtn);
    // 选择器中点击"素材一"(选择器打开时取列表中最后一个匹配项)
    const items = await screen.findAllByText('素材一');
    fireEvent.click(items[items.length - 1]);
    // 选中后选择器关闭,作品区显示标题
    expect(screen.getAllByText('素材一').length).toBeGreaterThan(0);
  });
});

/* ============================================================
 * 4. 灵感融合流程
 * ============================================================ */
describe('FusePage 灵感融合', () => {
  it('选中两张作品后显示"开始灵感嫁接"按钮', async () => {
    renderFuse();
    // 选择第一张(点击 slot 1 的"从素材库选"按钮)
    fireEvent.click(screen.getAllByText(/从素材库选/)[0]);
    let items = await screen.findAllByText('素材一');
    fireEvent.click(items[items.length - 1]);
    // 选择第二张(点击 slot 2 的"从素材库选"按钮,索引为 1)
    fireEvent.click(screen.getAllByText(/从素材库选/)[1]);
    items = await screen.findAllByText('素材二');
    fireEvent.click(items[items.length - 1]);
    // "开始灵感嫁接"在 span 中,用正则匹配
    expect(screen.getByText(/开始灵感嫁接/)).toBeInTheDocument();
  });

  it('点击"开始灵感嫁接"调用 generateImage 生成结果', async () => {
    renderFuse();
    // 选择两张作品
    fireEvent.click(screen.getAllByText(/从素材库选/)[0]);
    let items = await screen.findAllByText('素材一');
    fireEvent.click(items[items.length - 1]);
    fireEvent.click(screen.getAllByText(/从素材库选/)[1]);
    items = await screen.findAllByText('素材二');
    fireEvent.click(items[items.length - 1]);
    fireEvent.click(screen.getByText(/开始灵感嫁接/));
    await waitFor(() => {
      expect(generateImageMock).toHaveBeenCalled();
    });
  });
});

/* ============================================================
 * 5. 错误处理
 * ============================================================ */
describe('FusePage 错误处理', () => {
  it('generateImage 抛错时显示融合失败提示(不崩溃)', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    generateImageMock.mockImplementation(() => {
      throw new Error('generate fail');
    });
    renderFuse();
    fireEvent.click(screen.getAllByText(/从素材库选/)[0]);
    let items = await screen.findAllByText('素材一');
    fireEvent.click(items[items.length - 1]);
    fireEvent.click(screen.getAllByText(/从素材库选/)[1]);
    items = await screen.findAllByText('素材二');
    fireEvent.click(items[items.length - 1]);
    fireEvent.click(screen.getByText(/开始灵感嫁接/));
    await waitFor(() => {
      expect(generateImageMock).toHaveBeenCalled();
    });
    errorSpy.mockRestore();
  });
});

/* ============================================================
 * 6. Phase 3 批次④:URL ?style=<id> 风格预填
 *    (分析页"跨域启发"区块跳转入口的落点)
 * ============================================================ */
describe('FusePage style 预填(Phase 3 批次④)', () => {
  function renderFuseWithEntry(entry: string) {
    return render(
      <MemoryRouter initialEntries={[entry]}>
        <ToastProvider>
          <FusePage />
        </ToastProvider>
      </MemoryRouter>,
    );
  }

  beforeEach(() => {
    // 清除用户搭配预设,避免 preset 干扰 style 预填分支
    localStorage.clear();
  });

  it('?style=ink 显示"风格已预填"提示', async () => {
    renderFuseWithEntry('/fuse?style=ink');
    await waitFor(() => {
      expect(screen.getByText('风格已预填')).toBeInTheDocument();
    });
    expect(screen.getByText(/「水墨写意」/)).toBeInTheDocument();
  });

  it('?style=<未知id> 静默忽略,不显示预填提示', async () => {
    renderFuseWithEntry('/fuse?style=not-exist-style');
    // 给 useEffect 一拍时间确认 toast 未触发
    await waitFor(() => {
      expect(screen.getByText('创意融合 · 1+1>2')).toBeInTheDocument();
    });
    expect(screen.queryByText('风格已预填')).not.toBeInTheDocument();
  });

  it('无 style 参数时不显示预填提示', async () => {
    renderFuseWithEntry('/fuse');
    await waitFor(() => {
      expect(screen.getByText('创意融合 · 1+1>2')).toBeInTheDocument();
    });
    expect(screen.queryByText('风格已预填')).not.toBeInTheDocument();
  });
});
