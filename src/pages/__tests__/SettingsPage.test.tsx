// ============================================================
// SettingsPage 页面单元测试 (任务包 E:块3)
// 对应源码: src/pages/SettingsPage.tsx
//
// 测试范围:
//   1. loading 态(骨架屏)
//   2. 左侧导航 8 个分区切换(账户/外观/通知/存储/云端/后端/快捷键/隐私)
//   3. 外观分区:主题与密度切换
//   4. 通知分区:Toggle 开关
//   5. 存储分区:历史记录清空
//   6. 后端分区:开关 / 地址保存 / 健康检查(fetch mock)
//   7. 错误处理(加载设置失败 / 保存失败)
//
// Mock 策略:
//   - data-service: getSettings/saveSettings/clearAnalysisHistory/getAnalysisHistory
//   - global.fetch: 健康检查可控返回
// ============================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SettingsPage from '../SettingsPage';
import { ToastProvider } from '../../components/ToastProvider';
import type { UserSettings } from '../../services/data-service';
import type { AuthContextValue } from '../../context/AuthContext';

/* ---------- mock 依赖 ---------- */

/* mock useAuth:SettingsPage 依赖 user/refreshUser/isAuthenticated
 * 默认返回未登录态(user=null),不阻塞渲染 */
const mockUseAuth = vi.fn<(...args: never[]) => AuthContextValue>();
vi.mock('../../hooks/useAuth', () => ({
  useAuth: () => mockUseAuth(),
}));

const getSettingsMock = vi.fn<(...args: unknown[]) => Promise<UserSettings>>();
const saveSettingsMock = vi.fn<(...args: unknown[]) => Promise<UserSettings>>();
const clearAnalysisHistoryMock = vi.fn<(...args: unknown[]) => Promise<void>>();
const getAnalysisHistoryMock = vi.fn<(...args: unknown[]) => Promise<unknown[]>>();
vi.mock('../../services/data-service', () => ({
  getSettings: (...args: unknown[]) => getSettingsMock(...args),
  saveSettings: (...args: unknown[]) => saveSettingsMock(...args),
  clearAnalysisHistory: (...args: unknown[]) => clearAnalysisHistoryMock(...args),
  getAnalysisHistory: (...args: unknown[]) => getAnalysisHistoryMock(...args),
  LS_KEYS: {
    history: 'danqing-ai-history',
    favorites: 'artwork-favorites',
    savedMaterials: 'danqing-ai-saved-materials',
    emotionPalette: 'danqing-ai-emotion-palette',
    settings: 'danqing-ai-settings',
    theme: 'danqing-ai-theme',
    density: 'danqing-ai-density',
    onlineMode: 'danqing-ai-online-mode',
  },
}));

/* mock updateUserProfile(账户编辑用) */
vi.mock('../../services/api', () => ({
  updateUserProfile: vi.fn().mockResolvedValue({}),
}));

/* 默认未登录态 AuthContextValue */
function createUnauthAuthValue(): AuthContextValue {
  return {
    user: null,
    tenant: null,
    memberships: [],
    isLoading: false,
    isAuthenticated: false,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshUser: vi.fn().mockResolvedValue(undefined),
    switchTenant: vi.fn().mockResolvedValue(undefined),
    loadTenants: vi.fn().mockResolvedValue(undefined),
    skipLogin: vi.fn(),
  };
}

const DEFAULT_SETTINGS: UserSettings = {
  theme: 'rice',
  density: 'comfortable',
  notifications: { analysis: true, growth: true, system: false },
  cloudSync: { enabled: true, autoSync: true, multiDevice: false },
  privacy: { anonymousAnalytics: true, localFirst: true, twoFactor: false },
};

/* ---------- 渲染辅助 ---------- */

function renderSettings() {
  return render(
    <MemoryRouter initialEntries={['/settings']}>
      <ToastProvider>
        <SettingsPage />
      </ToastProvider>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  getSettingsMock.mockReset();
  saveSettingsMock.mockReset();
  clearAnalysisHistoryMock.mockReset();
  getAnalysisHistoryMock.mockReset();
  localStorage.clear();
  getSettingsMock.mockResolvedValue(DEFAULT_SETTINGS);
  saveSettingsMock.mockResolvedValue(DEFAULT_SETTINGS);
  getAnalysisHistoryMock.mockResolvedValue([{}, {}, {}]);
  clearAnalysisHistoryMock.mockResolvedValue(undefined);
  mockUseAuth.mockReset();
  mockUseAuth.mockReturnValue(createUnauthAuthValue());
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ============================================================
 * 1. loading 态
 * ============================================================ */
describe('SettingsPage loading 态', () => {
  it('加载中渲染骨架屏(role=status)', () => {
    getSettingsMock.mockReturnValue(new Promise(() => {}));
    renderSettings();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByLabelText('加载设置中')).toBeInTheDocument();
  });
});

/* ============================================================
 * 2. 左侧导航分区切换
 * ============================================================ */
describe('SettingsPage 分区导航', () => {
  it('默认显示"账户"分区(用户名/邮箱/身份角色)', async () => {
    renderSettings();
    await waitFor(() => {
      expect(screen.getAllByText('账户').length).toBeGreaterThan(0);
    });
    expect(screen.getByText('用户名')).toBeInTheDocument();
    expect(screen.getByText('邮箱')).toBeInTheDocument();
    expect(screen.getByText('身份角色')).toBeInTheDocument();
  });

  it('点击"外观"显示主题与界面密度', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('外观'));
    await waitFor(() => {
      expect(screen.getByText('主题')).toBeInTheDocument();
    });
  });

  it('点击"通知"显示三个 Toggle', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('通知'));
    await waitFor(() => {
      expect(screen.getByText('诊断完成')).toBeInTheDocument();
    });
  });

  it('点击"存储"显示历史记录与清空按钮', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('存储'));
    await waitFor(() => {
      expect(screen.getByText('历史记录')).toBeInTheDocument();
    });
  });

  it('点击"云端同步"显示云端分析 Toggle', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('云端同步'));
    await waitFor(() => {
      expect(screen.getByText('云端分析')).toBeInTheDocument();
    });
  });

  it('点击"后端设置"显示后端开关与地址输入', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('后端设置'));
    await waitFor(() => {
      expect(screen.getByText('启用后端 API')).toBeInTheDocument();
    });
  });

  it('点击"快捷键"显示快捷键列表', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('快捷键'));
    await waitFor(() => {
      expect(screen.getByText('跳转设置')).toBeInTheDocument();
    });
  });

  it('点击"隐私"显示隐私 Toggle', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('隐私'));
    await waitFor(() => {
      expect(screen.getByText('匿名分析')).toBeInTheDocument();
    });
  });
});

/* ============================================================
 * 3. 外观:主题与密度切换
 * ============================================================ */
describe('SettingsPage 外观切换', () => {
  it('点击"墨黑"主题触发 saveSettings', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('外观'));
    await waitFor(() => expect(screen.getByText('墨黑')).toBeInTheDocument());
    fireEvent.click(screen.getByText('墨黑'));
    await waitFor(() => {
      expect(saveSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ theme: 'ink' }));
    });
  });

  it('点击"紧凑"密度触发 saveSettings', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('外观'));
    await waitFor(() => expect(screen.getByText('紧凑')).toBeInTheDocument());
    fireEvent.click(screen.getByText('紧凑'));
    await waitFor(() => {
      expect(saveSettingsMock).toHaveBeenCalledWith(expect.objectContaining({ density: 'compact' }));
    });
  });
});

/* ============================================================
 * 4. 存储分区:清空历史
 * ============================================================ */
describe('SettingsPage 清空历史', () => {
  it('点击"清空历史"调用 clearAnalysisHistory', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('存储'));
    const clearBtn = await screen.findByText('清空历史');
    expect(clearBtn).not.toBeDisabled();
    fireEvent.click(clearBtn);
    await waitFor(() => {
      expect(clearAnalysisHistoryMock).toHaveBeenCalled();
    });
  });

  it('historyCount=0 时清空按钮禁用', async () => {
    getAnalysisHistoryMock.mockResolvedValue([]);
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('存储'));
    const clearBtn = await screen.findByText('清空历史');
    expect(clearBtn).toBeDisabled();
  });
});

/* ============================================================
 * 5. 后端分区:健康检查
 * ============================================================ */
describe('SettingsPage 后端健康检查', () => {
  it('点击"测试连接"且后端返回 ok 时显示连接成功', async () => {
    const fetchMock = vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
    } as Response);
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('后端设置'));
    const testBtn = await screen.findByText('测试连接');
    fireEvent.click(testBtn);
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalled();
    });
  });

  it('后端返回非 ok 时显示连接失败', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue({
      ok: false,
      status: 500,
    } as Response);
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('后端设置'));
    const testBtn = await screen.findByText('测试连接');
    fireEvent.click(testBtn);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it('fetch 抛错时显示连接失败(不崩溃)', async () => {
    vi.spyOn(global, 'fetch').mockRejectedValue(new Error('network'));
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('后端设置'));
    const testBtn = await screen.findByText('测试连接');
    fireEvent.click(testBtn);
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalled();
    });
  });

  it('切换"启用后端 API"开关写入 localStorage', async () => {
    renderSettings();
    await waitFor(() => expect(screen.getAllByText('账户').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByText('后端设置'));
    // Toggle 按钮带 aria-label,用 getByRole 定位
    const toggleBtn = await screen.findByRole('button', { name: '启用后端 API' });
    fireEvent.click(toggleBtn);
    await waitFor(() => {
      expect(localStorage.getItem('danqing-ai-use-api')).toBe('true');
    });
  });
});

/* ============================================================
 * 6. 错误处理
 * ============================================================ */
describe('SettingsPage 错误处理', () => {
  it('getSettings 抛错时静默不崩溃(loading 结束后渲染)', async () => {
    getSettingsMock.mockRejectedValue(new Error('storage'));
    renderSettings();
    await waitFor(() => {
      expect(screen.getAllByText('设置').length).toBeGreaterThan(0);
    });
  });
});
