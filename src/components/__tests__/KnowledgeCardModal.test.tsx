// ============================================================
// KnowledgeCardModal 组件测试(参考图混合方案 Phase 3 批次④)
// 对应源码: src/components/KnowledgeCardModal.tsx
//
// 测试范围:
//   1. cardId=null 不渲染
//   2. 加载态(加载分步参考…)
//   3. ready:分步图渲染 + 步骤切换(按钮/键盘)+ 讲解/练习/关联作品
//   4. 诚实降级:partial(部分生成)/ pending(未生成)不伪造图片
//   5. 加载失败错误态
//   6. 关闭交互(Esc/关闭按钮)
// ============================================================

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import KnowledgeCardModal from '../KnowledgeCardModal';
import { getKnowledgeCard } from '../../services/knowledge-card-api';
import { resolveReferenceWorks } from '../../services/referenceWork';
import type { KnowledgeCard } from '../../types/knowledge-card';

/* ---------- mock 依赖 ---------- */

const getKnowledgeCardMock = vi.mocked(getKnowledgeCard);
const resolveReferenceWorksMock = vi.mocked(resolveReferenceWorks);

vi.mock('../../services/knowledge-card-api', () => ({
  getKnowledgeCard: vi.fn(),
}));

vi.mock('../../services/referenceWork', () => ({
  resolveReferenceWorks: vi.fn().mockResolvedValue([]),
}));

/* ---------- 测试数据工厂 ---------- */

function makeCard(overrides: Partial<KnowledgeCard> = {}): KnowledgeCard {
  return {
    id: 'kcard_sketch_value_gray_001',
    category: 'sketch',
    topic: '明度/画面灰',
    problemPattern: '画面灰,黑白灰拉不开',
    difficulty: 'basic',
    explanation: '画面灰的根源是明度范围压缩。',
    practiceDrill: '做一张 5 级明度条,再为静物重新分配黑白灰。',
    referenceAssets: {
      status: 'ready',
      steps: 3,
      imageUrls: [
        'https://example.com/step-1.png',
        'https://example.com/step-2.png',
        'https://example.com/step-3.png',
      ],
      caption: '画面灰修正',
      generatedAt: '2026-09-06T00:00:00Z',
    },
    relatedWorks: null,
    isBuiltIn: true,
    enabled: true,
    sortOrder: 1,
    createdAt: '2026-09-06T00:00:00Z',
    updatedAt: '2026-09-06T00:00:00Z',
    ...overrides,
  };
}

/** 带 /styles 路由标记的渲染(关联作品跳转断言) */
function renderModal(cardId: string | null) {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route
          path="/"
          element={<KnowledgeCardModal cardId={cardId} onClose={vi.fn()} />}
        />
        <Route path="/styles" element={<div data-testid="styles-page" />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getKnowledgeCardMock.mockReset();
  resolveReferenceWorksMock.mockReset();
  resolveReferenceWorksMock.mockResolvedValue([]);
});

// ============================================================
// 1. cardId=null 与加载态
// ============================================================
describe('KnowledgeCardModal 渲染门控与加载态', () => {
  it('should_return_null_when_card_id_is_null', () => {
    const { container } = renderModal(null);
    expect(container.innerHTML).toBe('');
  });

  it('should_show_loading_state_while_fetching', async () => {
    getKnowledgeCardMock.mockReturnValue(new Promise(() => {})); // 永不 resolve
    renderModal('kcard_sketch_value_gray_001');
    expect(screen.getByText('加载分步参考…')).toBeInTheDocument();
    expect(getKnowledgeCardMock).toHaveBeenCalledWith('kcard_sketch_value_gray_001');
  });
});

// ============================================================
// 2. ready:分步图 + 切换 + 讲解/练习
// ============================================================
describe('KnowledgeCardModal ready 态', () => {
  beforeEach(() => {
    getKnowledgeCardMock.mockResolvedValue(makeCard());
  });

  it('should_render_topic_explanation_and_practice', async () => {
    renderModal('kcard_sketch_value_gray_001');
    await waitFor(() => {
      expect(screen.getByText('明度/画面灰')).toBeInTheDocument();
    });
    expect(screen.getByText('原理讲解')).toBeInTheDocument();
    expect(screen.getByText(/画面灰的根源是明度范围压缩/)).toBeInTheDocument();
    expect(screen.getByText('针对性练习')).toBeInTheDocument();
    expect(screen.getByText(/做一张 5 级明度条/)).toBeInTheDocument();
  });

  it('should_render_step_image_with_counter_and_switch_by_buttons', async () => {
    renderModal('kcard_sketch_value_gray_001');
    await waitFor(() => {
      expect(screen.getByAltText('明度/画面灰第 1 步参考图')).toBeInTheDocument();
    });
    expect(screen.getByText('第 1 / 3 步')).toBeInTheDocument();

    // 下一步 → 第 2 步
    fireEvent.click(screen.getByRole('button', { name: '下一步' }));
    await waitFor(() => {
      expect(screen.getByAltText('明度/画面灰第 2 步参考图')).toBeInTheDocument();
    });
    expect(screen.getByText('第 2 / 3 步')).toBeInTheDocument();

    // 上一步 → 回到第 1 步
    fireEvent.click(screen.getByRole('button', { name: '上一步' }));
    await waitFor(() => {
      expect(screen.getByAltText('明度/画面灰第 1 步参考图')).toBeInTheDocument();
    });
  });

  it('should_switch_step_by_keyboard_arrows', async () => {
    renderModal('kcard_sketch_value_gray_001');
    await waitFor(() => {
      expect(screen.getByAltText('明度/画面灰第 1 步参考图')).toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await waitFor(() => {
      expect(screen.getByAltText('明度/画面灰第 2 步参考图')).toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    await waitFor(() => {
      expect(screen.getByAltText('明度/画面灰第 1 步参考图')).toBeInTheDocument();
    });
  });

  it('should_render_related_works_and_navigate_to_styles', async () => {
    resolveReferenceWorksMock.mockResolvedValue([
      {
        id: 'art-1',
        title: '静物·明度研究',
        attribution: '某画家 · 2020',
        thumbUrl: 'https://example.com/art1.png',
      },
    ]);
    getKnowledgeCardMock.mockResolvedValue(
      makeCard({ relatedWorks: ['art-1'] }),
    );
    renderModal('kcard_sketch_value_gray_001');
    await waitFor(() => {
      expect(screen.getByText('关联作品')).toBeInTheDocument();
    });
    expect(resolveReferenceWorksMock).toHaveBeenCalledWith(['art-1']);
    fireEvent.click(screen.getByTitle('在知识库查看《静物·明度研究》'));
    expect(screen.getByTestId('styles-page')).toBeInTheDocument();
  });
});

// ============================================================
// 3. 诚实降级:partial / pending / null assets
// ============================================================
describe('KnowledgeCardModal 诚实降级', () => {
  it('should_show_partial_hint_when_status_is_partial', async () => {
    getKnowledgeCardMock.mockResolvedValue(
      makeCard({
        referenceAssets: {
          status: 'partial',
          steps: 3,
          imageUrls: ['https://example.com/step-1.png', '', ''],
          caption: '画面灰修正',
        },
      }),
    );
    renderModal('kcard_sketch_value_gray_001');
    await waitFor(() => {
      expect(screen.getByText('部分参考图已生成,其余步骤生成中')).toBeInTheDocument();
    });
    // 不伪造图片:无第 1 步参考图 img
    expect(screen.queryByAltText(/参考图$/)).not.toBeInTheDocument();
    // 讲解与练习仍可用
    expect(screen.getByText('原理讲解')).toBeInTheDocument();
    expect(screen.getByText('针对性练习')).toBeInTheDocument();
  });

  it('should_show_pending_hint_when_status_is_pending', async () => {
    getKnowledgeCardMock.mockResolvedValue(
      makeCard({
        referenceAssets: { status: 'pending', steps: 0, imageUrls: [], caption: '' },
      }),
    );
    renderModal('kcard_sketch_value_gray_001');
    await waitFor(() => {
      expect(screen.getByText('参考图生成中')).toBeInTheDocument();
    });
    expect(screen.getByText(/分步图稍后回来查看/)).toBeInTheDocument();
  });

  it('should_show_pending_hint_when_assets_is_null', async () => {
    getKnowledgeCardMock.mockResolvedValue(
      makeCard({ referenceAssets: null }),
    );
    renderModal('kcard_sketch_value_gray_001');
    await waitFor(() => {
      expect(screen.getByText('参考图生成中')).toBeInTheDocument();
    });
    // 头部步数显示"未生成"
    expect(screen.getByText(/未生成/)).toBeInTheDocument();
  });
});

// ============================================================
// 4. 错误态与关闭交互
// ============================================================
describe('KnowledgeCardModal 错误态与关闭', () => {
  it('should_show_error_hint_when_fetch_fails', async () => {
    getKnowledgeCardMock.mockRejectedValue(new Error('network'));
    renderModal('kcard_sketch_value_gray_001');
    await waitFor(() => {
      expect(screen.getByText('卡片加载失败,请稍后重试')).toBeInTheDocument();
    });
  });

  it('should_call_on_close_when_esc_pressed', async () => {
    const onClose = vi.fn();
    getKnowledgeCardMock.mockResolvedValue(makeCard());
    render(
      <MemoryRouter>
        <KnowledgeCardModal cardId="kcard_sketch_value_gray_001" onClose={onClose} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByText('明度/画面灰')).toBeInTheDocument();
    });
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('should_call_on_close_when_close_button_clicked', async () => {
    const onClose = vi.fn();
    getKnowledgeCardMock.mockResolvedValue(makeCard());
    render(
      <MemoryRouter>
        <KnowledgeCardModal cardId="kcard_sketch_value_gray_001" onClose={onClose} />
      </MemoryRouter>,
    );
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '关闭' })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(onClose).toHaveBeenCalled();
  });
});
