import { useState, useMemo, useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Heart, Sparkles, Loader2, Download, Share2, Palette, Sliders, Layers,
  RefreshCw, Brush, Moon, Wind, Droplets, Flame, Waves,
  Mountain, Cloud, CloudFog, TreePine, Flower, Flower2, Sunrise, Leaf,
  Feather, CloudRain, Circle, Zap, MountainSnow, Save, Bookmark, Trash2, X,
  Columns2,
} from 'lucide-react';
import { generateEmotionCanvas, ImageGenerationError } from '../services/imageService';
import {
  EMOTION_LIBRARY,
  getEmotionsByGroup,
  getEmotionByName,
  getEmotionById,
  mixPalettes,
  DEFAULT_GENERATION_PARAMS,
  type EmotionEntry,
  type GenerationParams,
} from '../services/emotionLibrary';
import {
  listEmotionPresets,
  saveEmotionPreset,
  removeEmotionPreset,
  type EmotionPreset,
} from '../services/emotionPresetStore';
import { saveEmotionPalette, saveSavedMaterial, getSavedMaterials } from '../services/data-service';
import { useToast } from '../components/ToastProvider';
import EmptyState from '../components/EmptyState';
import EmotionBrushCanvas from '../components/EmotionBrushCanvas';
import GenerationLoading from '../components/GenerationLoading';
import EmotionMixer from '../components/emotion/EmotionMixer';
import EditablePalette from '../components/emotion/EditablePalette';
import GenerationParamsPanel from '../components/emotion/GenerationParamsPanel';
import ResultWorkshop, { type WorkshopItem } from '../components/ResultWorkshop';

/* 情绪名 → 图标映射(图标依赖保留在页面层,情绪库保持纯净) */
const EMOTION_ICONS: Record<string, typeof Heart> = {
  宁静: Wind,
  空灵: Cloud,
  悠远: Mountain,
  苍茫: CloudFog,
  隐逸: TreePine,
  喜悦: Flower,
  希望: Sunrise,
  烂漫: Flower2,
  清新: Leaf,
  温婉: Feather,
  孤独: Moon,
  忧伤: Droplets,
  思念: CloudRain,
  禅意: Circle,
  激情: Waves,
  豪迈: Zap,
  磅礴: MountainSnow,
  壮烈: Flame,
};

function emotionIcon(entry: EmotionEntry) {
  return EMOTION_ICONS[entry.name] ?? Heart;
}

const intensityLevels = [
  { value: 0.3, label: '淡', desc: '轻柔含蓄' },
  { value: 0.6, label: '中', desc: '平衡适中' },
  { value: 1.0, label: '浓', desc: '浓烈饱满' },
];

export default function EmotionPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  /* ---------- 情绪选择状态 ---------- */
  const [selectedEmotion, setSelectedEmotion] = useState('宁静');
  const [secondaryEmotion, setSecondaryEmotion] = useState<string | null>(null);
  const [ratio, setRatio] = useState(0.7); // 主情绪占比
  const [intensity, setIntensity] = useState(0.6);

  /* ---------- 生成参数 ---------- */
  const [genParams, setGenParams] = useState<GenerationParams>({ ...DEFAULT_GENERATION_PARAMS });

  /* ---------- 色板编辑 ---------- */
  const [customPalette, setCustomPalette] = useState<string[] | null>(null);

  /* ---------- 生成结果 ---------- */
  const [generating, setGenerating] = useState(false);
  const [results, setResults] = useState<string[]>([]);
  /* 生成失败原因(逐张上屏改造:失败不再静默回退占位图,显示原因+重试) */
  const [genError, setGenError] = useState<ImageGenerationError | null>(null);
  /* 逐张上屏计数:每张完成 +1,驱动 GenerationLoading "已完成 X/3" */
  const [completedCount, setCompletedCount] = useState(0);

  /* ---------- 结果工作台 ---------- */
  const [workshopOpen, setWorkshopOpen] = useState(false);

  /* ---------- 预设 ---------- */
  const [presets, setPresets] = useState<EmotionPreset[]>([]);
  const [showPresetInput, setShowPresetInput] = useState(false);
  const [presetName, setPresetName] = useState('');

  /* 从首页/跳转链接携带的自动生成标记(一次性):?preset=xxx&auto=1 进入时,载入后立即生成 */
  const autoGenerateRef = useRef(false);
  const presetAppliedRef = useRef(false);
  const handleGenerateRef = useRef<() => void>(() => {});

  useEffect(() => {
    const list = listEmotionPresets();
    setPresets(list);
    /* URL ?preset=<id> 自动载入预设 */
    const presetId = searchParams.get('preset');
    const auto = searchParams.get('auto') === '1';
    if (presetId) {
      const preset = list.find((p) => p.id === presetId);
      if (preset) {
        const primary = getEmotionById(preset.primaryId);
        setSelectedEmotion(primary.name);
        const secondary = preset.secondaryId ? getEmotionById(preset.secondaryId) : null;
        setSecondaryEmotion(secondary && secondary.id !== primary.id ? secondary.name : null);
        setRatio(preset.ratio);
        setIntensity(preset.intensity);
        setGenParams({ ...preset.params });
        setCustomPalette(preset.customPalette ? [...preset.customPalette] : null);
        presetAppliedRef.current = true;
        if (auto) autoGenerateRef.current = true;
        toast.success('预设已载入', `「${preset.name}」${auto ? '，即将自动生成' : ''}`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentEmotion = getEmotionByName(selectedEmotion);
  const secondaryEmotionData = secondaryEmotion ? getEmotionByName(secondaryEmotion) : null;
  const groups = useMemo(() => getEmotionsByGroup(), []);

  /* 自动色板:无双情绪 = 主色板;有双情绪 = 按比例混合 */
  const autoPalette = useMemo(
    () =>
      secondaryEmotionData
        ? mixPalettes(currentEmotion.colorPalette, secondaryEmotionData.colorPalette, ratio)
        : currentEmotion.colorPalette,
    [currentEmotion, secondaryEmotionData, ratio],
  );

  /* 展示色板:用户编辑过则用自定义,否则用自动混合 */
  const displayPalette = customPalette ?? autoPalette;

  /* 情绪/配比变化时清除自定义色板,回到自动混合 */
  useEffect(() => {
    setCustomPalette(null);
  }, [selectedEmotion, secondaryEmotion, ratio]);

  const themeColor = displayPalette[1] ?? currentEmotion.colorPalette[1];

  /* ---------- 预设操作 ---------- */
  const handleSavePreset = () => {
    const name = presetName.trim();
    if (!name) {
      toast.error('请输入预设名称');
      return;
    }
    const entry = saveEmotionPreset({
      name,
      primaryId: currentEmotion.id,
      secondaryId: secondaryEmotionData?.id ?? null,
      ratio,
      intensity,
      params: genParams,
      customPalette,
    });
    setPresets((prev) => [entry, ...prev].slice(0, 20));
    setPresetName('');
    setShowPresetInput(false);
    toast.success('预设已保存', `「${name}」可在预设栏快速载入`);
  };

  const handleLoadPreset = (preset: EmotionPreset) => {
    const primary = getEmotionById(preset.primaryId);
    setSelectedEmotion(primary.name);
    const secondary = preset.secondaryId ? getEmotionById(preset.secondaryId) : null;
    setSecondaryEmotion(secondary && secondary.id !== primary.id ? secondary.name : null);
    setRatio(preset.ratio);
    setIntensity(preset.intensity);
    setGenParams({ ...preset.params });
    setCustomPalette(preset.customPalette ? [...preset.customPalette] : null);
    toast.success('预设已载入', `「${preset.name}」`);
  };

  const handleRemovePreset = (preset: EmotionPreset) => {
    removeEmotionPreset(preset.id);
    setPresets((prev) => prev.filter((p) => p.id !== preset.id));
    toast.success('预设已删除', preset.name);
  };

  /* ---------- 生成 ---------- */
  const handleGenerate = async () => {
    setGenerating(true);
    setResults([]);
    setGenError(null);
    setCompletedCount(0);
    try {
      /* 将配比/浓度/参数暂存,imageService 读取后构建 prompt */
      sessionStorage.setItem(
        'danqing-emotion-gen-config',
        JSON.stringify({ ratio, intensity, params: genParams }),
      );
      const expr = selectedEmotion + (secondaryEmotion ? `-${secondaryEmotion}` : '');
      /* 逐张上屏:每张完成立即追加到结果区,无需等待全部 3 张 */
      const images = await generateEmotionCanvas(expr, {
        onImageReady: (url) => {
          setResults((prev) => [...prev, url]);
          setCompletedCount((prev) => prev + 1);
          /* 自动持久化:生成即存档,关掉页面也能在历史记录「我的生成」找回 */
          void saveSavedMaterial({
            imageUrl: url,
            title: `情绪画布-${expr}-${new Date().toLocaleDateString('zh-CN')}`,
            source: 'emotion',
          }).catch((err) => console.error('自动保存情绪画布失败:', err));
        },
      });
      if (images.length < 3) {
        toast.warning('部分画面生成失败', `成功 ${images.length}/3 张,可点击"换一批"重试`);
      } else {
        toast.success('情绪画布已生成', `共 ${images.length} 张参考图`);
      }
    } catch (error) {
      console.error('生成失败:', error);
      /* 全部失败:显示错误卡片(含原因与重试),不再静默吞错 */
      setGenError(
        error instanceof ImageGenerationError
          ? error
          : new ImageGenerationError('unknown', '生成失败,请检查网络后重试'),
      );
    } finally {
      setGenerating(false);
    }
  };
  handleGenerateRef.current = handleGenerate;

  /* URL ?auto=1:预设应用后下一帧自动触发生成(确保状态已 commit) */
  useEffect(() => {
    if (autoGenerateRef.current && !generating) {
      let cancelled = false;
      const t = window.setTimeout(() => {
        if (!cancelled) {
          autoGenerateRef.current = false;
          handleGenerateRef.current?.();
        }
      }, 200);
      return () => {
        cancelled = true;
        window.clearTimeout(t);
      };
    }
  }, [generating, selectedEmotion, ratio, intensity, genParams]);

  // 将当前情绪色板通过 data-service 保存并跳转到风格库
  const handleApplyToStyles = async () => {
    try {
      await saveEmotionPalette({
        emotion: selectedEmotion + (secondaryEmotion ? `+${secondaryEmotion}` : ''),
        colorPalette: displayPalette,
        intensity,
      });
      toast.success('色板已保存，可在风格库查看');
      navigate('/styles?from=emotion');
    } catch (err) {
      console.error('保存色板失败:', err);
      toast.error('保存失败', '请稍后重试');
    }
  };

  const handleDownload = (url: string, index: number) => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `emotion-${selectedEmotion}-${index + 1}.png`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  /* ---------- 结果工作台:条目归一化 + 分享文案 ---------- */
  const emotionExpr = selectedEmotion + (secondaryEmotion ? ` × ${secondaryEmotion}` : '');
  const workshopItems: WorkshopItem[] = useMemo(
    () =>
      results.map((url, i) => ({
        id: `emotion-${Date.now()}-${i}`,
        url,
        title: `${emotionExpr} · ${i + 1}`,
        subtitle: `浓度 ${Math.round(intensity * 100)}% · ${genParams.aspect === 'square' ? '斗方' : genParams.aspect === 'landscape' ? '横卷' : '立轴'}`,
        shareText: `【丹青有AI】我把「${emotionExpr}」的情绪画成了画(浓度 ${Math.round(intensity * 100)}%) → ${window.location.origin}/app/#/emotion`,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [results, emotionExpr, intensity, genParams.aspect],
  );

  const handleShareCard = (index: number) => {
    const item = workshopItems[index];
    if (!item) return;
    navigator.clipboard?.writeText(item.shareText).then(
      () => toast.success('分享文案已复制', '粘贴即可分享给好友'),
      () => toast.error('复制失败', '请检查浏览器剪贴板权限'),
    );
  };

  const handleSaveWorkshopItem = async (item: WorkshopItem) => {
    /* 去重:生成时已自动存档,相同图片不重复入库 */
    const list = await getSavedMaterials();
    if (list.some((m) => m.imageUrl === item.url)) return;
    await saveSavedMaterial({
      imageUrl: item.url,
      title: `情绪画布-${emotionExpr}-${new Date().toLocaleDateString('zh-CN')}`,
      source: 'emotion',
    });
  };

  // 渐变色
  const getGradient = (colors: string[], alpha: number) => {
    const a = Math.floor(alpha * 255).toString(16).padStart(2, '0');
    return `linear-gradient(135deg, ${colors[0]} 0%, ${colors[2]} 35%, ${colors[4]} 70%, ${colors[5]}${a} 100%)`;
  };

  const intensityLabel = intensityLevels.find((l) => Math.abs(l.value - intensity) < 0.15)?.label || '中';

  return (
    <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900/5 rounded-full mb-4">
            <Heart className="w-4 h-4 text-cinnabar" />
            <span className="text-sm text-ink-600">情绪画布</span>
          </div>
          <h1 className="font-serif text-3xl md:text-5xl font-bold text-ink-900 mb-4">
            情感可视化 · 色彩语言
          </h1>
          <p className="text-ink-600 max-w-2xl mx-auto text-lg">
            把抽象情感转化为视觉语言，让内心感受化作可触可感的画面
            <br />
            <span className="text-sm text-ink-500">18 种东方情绪 · 双情绪配比 · 参数化生成 · 预设收藏</span>
          </p>
        </div>

        {/* 预设栏 */}
        <div className="mb-8 bg-rice-50 rounded-2xl p-4 shadow-card">
          <div className="flex items-center gap-3 flex-wrap">
            <p className="text-sm font-medium text-ink-700 flex items-center gap-1.5">
              <Bookmark className="w-4 h-4 text-cinnabar" />
              我的预设
            </p>
            {presets.length === 0 && (
              <span className="text-xs text-ink-400">暂无预设 — 调好情绪与参数后点击「存为预设」</span>
            )}
            <div className="flex items-center gap-2 flex-wrap flex-1">
              {presets.map((preset) => {
                const p = getEmotionById(preset.primaryId);
                const s = preset.secondaryId ? getEmotionById(preset.secondaryId) : null;
                return (
                  <div
                    key={preset.id}
                    className="group flex items-center gap-1.5 pl-2 pr-1 py-1 bg-rice-100 hover:bg-rice-200 rounded-full transition-all"
                  >
                    <div
                      className="w-4 h-4 rounded-full shadow-inner"
                      style={{ background: `linear-gradient(135deg, ${p.colorPalette[1]}, ${s?.colorPalette[1] ?? p.colorPalette[3]})` }}
                    />
                    <button
                      onClick={() => handleLoadPreset(preset)}
                      className="text-sm text-ink-700 hover:text-cinnabar transition-all"
                      title={`${p.name}${s ? ` × ${s.name}` : ''} · 配比 ${Math.round(preset.ratio * 100)}%`}
                    >
                      {preset.name}
                    </button>
                    <button
                      onClick={() => handleRemovePreset(preset)}
                      aria-label={`删除预设 ${preset.name}`}
                      className="p-0.5 text-ink-300 hover:text-cinnabar rounded-full opacity-0 group-hover:opacity-100 transition-all"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
            {/* 存为预设 */}
            <div className="relative ml-auto">
              {showPresetInput ? (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={presetName}
                    onChange={(e) => setPresetName(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                    placeholder="预设名称,如:雨后青山"
                    maxLength={12}
                    autoFocus
                    className="px-3 py-1.5 text-sm border border-ink-200 rounded-lg focus:outline-none focus:border-cinnabar w-44"
                  />
                  <button
                    onClick={handleSavePreset}
                    className="px-3 py-1.5 text-sm bg-cinnabar text-white rounded-lg hover:bg-cinnabar/90 transition-all"
                  >
                    保存
                  </button>
                  <button
                    onClick={() => setShowPresetInput(false)}
                    aria-label="取消"
                    className="p-1.5 text-ink-400 hover:text-ink-600"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setShowPresetInput(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-cinnabar bg-cinnabar/5 hover:bg-cinnabar/10 rounded-lg transition-all"
                >
                  <Save className="w-4 h-4" />
                  存为预设
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Emotion Selection - 按 4 组展示 */}
        <div className="mb-8">
          <h2 className="font-serif text-xl font-bold text-ink-900 mb-4 flex items-center gap-2">
            <Palette className="w-5 h-5 text-cinnabar" />
            选择主情绪
            <span className="text-xs font-normal text-ink-400 ml-1">18 种东方情绪 · 四大心境</span>
          </h2>
          <div className="space-y-6">
            {groups.map(({ group, meta, items }) => (
              <div key={group}>
                <div className="flex items-center gap-2 mb-3">
                  <div className="w-1 h-4 rounded-full" style={{ backgroundColor: meta.accent }} />
                  <p className="text-sm font-medium text-ink-700">{meta.label}</p>
                  <span className="text-xs text-ink-400">{meta.desc}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {items.map((entry) => {
                    const isSelected = selectedEmotion === entry.name;
                    const Icon = emotionIcon(entry);
                    return (
                      <button
                        key={entry.id}
                        onClick={() => setSelectedEmotion(entry.name)}
                        aria-label={entry.name}
                        className={`group relative bg-rice-50 rounded-2xl p-5 shadow-card transition-all overflow-hidden ${
                          isSelected
                            ? 'ring-2 ring-cinnabar shadow-card-hover transform -translate-y-1'
                            : 'hover:shadow-card-hover hover:-translate-y-0.5'
                        }`}
                      >
                        {isSelected && (
                          <div
                            className="absolute top-0 left-0 right-0 h-1"
                            style={{ background: getGradient(entry.colorPalette, 1) }}
                          />
                        )}
                        <div
                          className="w-full h-20 rounded-xl mb-3 flex items-center justify-center transition-all group-hover:scale-105 shadow-inner"
                          style={{ background: getGradient(entry.colorPalette, 0.7) }}
                        >
                          <Icon className="w-8 h-8 text-white drop-shadow-lg" />
                        </div>
                        <p className="font-serif text-lg font-bold text-ink-900 mb-1">{entry.name}</p>
                        <p className="text-xs text-ink-500 line-clamp-1">{entry.desc}</p>
                        <div className="flex gap-0.5 mt-2">
                          {entry.colorPalette.slice(0, 5).map((c, i) => (
                            <div
                              key={i}
                              className="h-1.5 flex-1 rounded-full first:rounded-l-full last:rounded-r-full"
                              style={{ backgroundColor: c }}
                            />
                          ))}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 控制区:浓度+叠加+配比 | 生成参数 */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
          {/* 左:情绪控制 */}
          <div className="space-y-6">
            {/* Intensity Control */}
            <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
              <h3 className="font-serif text-lg font-bold text-ink-900 mb-4 flex items-center gap-2">
                <Sliders className="w-5 h-5 text-cinnabar" />
                情绪浓度
              </h3>
              <div className="mb-4">
                <div className="flex justify-between mb-3">
                  {intensityLevels.map((level) => (
                    <button
                      key={level.value}
                      onClick={() => setIntensity(level.value)}
                      className={`text-sm font-medium transition-all ${
                        Math.abs(intensity - level.value) < 0.15
                          ? 'text-cinnabar'
                          : 'text-ink-400 hover:text-ink-600'
                      }`}
                    >
                      {level.label} · {level.desc}
                    </button>
                  ))}
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.05"
                  value={intensity}
                  onChange={(e) => setIntensity(parseFloat(e.target.value))}
                  aria-label="情绪浓度"
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, ${displayPalette[5]} 0%, ${displayPalette[2]} 50%, ${displayPalette[0]} 100%)`,
                  }}
                />
                <p className="text-center text-sm text-ink-500 mt-2">
                  当前浓度：{Math.round(intensity * 100)}%
                </p>
              </div>
              <div
                className="h-20 rounded-xl flex items-center justify-center transition-all"
                style={{ background: getGradient(displayPalette, intensity) }}
              >
                <p className="text-white font-serif text-xl font-bold drop-shadow-lg">
                  {selectedEmotion}{secondaryEmotion ? ` × ${secondaryEmotion}` : ''} · {intensityLabel}
                </p>
              </div>
            </div>

            {/* Secondary Emotion + Mixer */}
            <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
              <h3 className="font-serif text-lg font-bold text-ink-900 mb-4 flex items-center gap-2">
                <Layers className="w-5 h-5 text-cinnabar" />
                情绪叠加
                <span className="text-xs font-normal text-ink-400 ml-1">(可选)</span>
              </h3>
              <p className="text-sm text-ink-500 mb-4">
                选择第二种情绪进行叠加混合，创造更复杂的情感表达
              </p>
              <div className="grid grid-cols-6 gap-2">
                {EMOTION_LIBRARY.map((entry) => {
                  if (entry.name === selectedEmotion) return null;
                  const isSelected = secondaryEmotion === entry.name;
                  return (
                    <button
                      key={entry.id}
                      onClick={() => setSecondaryEmotion(isSelected ? null : entry.name)}
                      aria-label={entry.name}
                      title={entry.name}
                      className={`p-2 rounded-xl border-2 transition-all text-center ${
                        isSelected
                          ? 'border-cinnabar bg-cinnabar/5'
                          : 'border-transparent bg-rice-100 hover:bg-rice-200'
                      }`}
                    >
                      <div
                        className="w-6 h-6 rounded-full mx-auto mb-1 shadow"
                        style={{ backgroundColor: entry.colorPalette[1] }}
                      />
                      <p className="text-xs font-medium text-ink-700">{entry.name}</p>
                    </button>
                  );
                })}
              </div>

              {/* 双情绪比例滑杆 */}
              <EmotionMixer
                primary={currentEmotion}
                secondary={secondaryEmotionData}
                ratio={ratio}
                onRatioChange={setRatio}
                onClearSecondary={() => setSecondaryEmotion(null)}
              />
            </div>
          </div>

          {/* 右:生成参数 */}
          <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
            <h3 className="font-serif text-lg font-bold text-ink-900 mb-4 flex items-center gap-2">
              <Brush className="w-5 h-5 text-cinnabar" />
              生成参数
              <span className="text-xs font-normal text-ink-400 ml-1">画幅 · 构图 · 笔触 · 留白</span>
            </h3>
            <GenerationParamsPanel
              params={genParams}
              onChange={setGenParams}
              accentColor={themeColor}
            />
          </div>
        </div>

        {/* Emotion Details */}
        <div className="bg-rice-50 rounded-2xl p-6 md:p-8 shadow-card mb-8">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-8">
            <div className="md:col-span-3">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-14 h-14 rounded-2xl flex items-center justify-center shadow-lg"
                  style={{ background: getGradient(displayPalette, 1) }}
                >
                  {(() => {
                    const Icon = emotionIcon(currentEmotion);
                    return <Icon className="w-7 h-7 text-white" />;
                  })()}
                </div>
                <div>
                  <h3 className="font-serif text-3xl font-bold text-ink-900">
                    {selectedEmotion}
                    {secondaryEmotion && <span className="text-ink-300 mx-2">×</span>}
                    {secondaryEmotion && <span className="text-ink-700">{secondaryEmotion}</span>}
                  </h3>
                  <p className="text-ink-500">
                    {currentEmotion.desc}
                    {secondaryEmotionData && (
                      <span className="text-ink-400">
                        {' '}· 配比 {Math.round(ratio * 100)}:{100 - Math.round(ratio * 100)}
                      </span>
                    )}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-6">
                <div className="bg-rice-50 rounded-xl p-4">
                  <p className="text-sm font-medium text-ink-700 mb-2">代表场景</p>
                  <p className="text-sm text-ink-600">{currentEmotion.scene}</p>
                </div>
                <div className="bg-rice-50 rounded-xl p-4">
                  <p className="text-sm font-medium text-ink-700 mb-2">音乐意境</p>
                  <p className="text-sm text-ink-600">{currentEmotion.musicMood}</p>
                </div>
              </div>

              <div className="mb-4">
                <p className="text-sm font-medium text-ink-700 mb-2">
                  关键词联想
                  <span className="text-xs font-normal text-ink-400 ml-2">点击复制</span>
                </p>
                <div className="flex flex-wrap gap-2">
                  {(secondaryEmotionData && ratio < 0.6
                    ? [...currentEmotion.keywords, ...secondaryEmotionData.keywords.slice(0, 2)]
                    : currentEmotion.keywords
                  ).map((kw) => (
                    <button
                      key={kw}
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(kw).then(
                          () => toast.success('已复制', kw),
                          () => toast.error('复制失败', '请检查浏览器权限')
                        );
                      }}
                      className="px-3 py-1 text-sm rounded-full transition-all hover:scale-105 hover:shadow-card cursor-pointer active:scale-95"
                      style={{
                        backgroundColor: `${themeColor}15`,
                        color: themeColor,
                      }}
                    >
                      {kw}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-sm font-medium text-ink-700 mb-2">艺术表现形式</p>
                <div className="flex flex-wrap gap-2">
                  {currentEmotion.artForms.map((form) => (
                    <span
                      key={form}
                      className="px-3 py-1 text-sm bg-ink-900/5 text-ink-600 rounded-full"
                    >
                      {form}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="md:col-span-2 flex flex-col items-center justify-center">
              <div
                className="w-48 h-48 rounded-full shadow-2xl mb-6 transition-all"
                style={{
                  background: `radial-gradient(circle at 30% 30%, ${displayPalette[3]} 0%, ${displayPalette[1]} 50%, ${displayPalette[0]} 100%)`,
                  opacity: 0.3 + intensity * 0.7,
                }}
              />
              <div className="w-full max-w-xs">
                <EditablePalette
                  colors={displayPalette}
                  originalColors={autoPalette}
                  onChange={setCustomPalette}
                />
              </div>
            </div>
          </div>
        </div>

        {/* 手绘创作区域 */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-4">
            <Brush className="w-5 h-5 text-cinnabar" />
            <h2 className="font-serif text-xl font-bold text-ink-900">手绘创作</h2>
            <span className="text-xs text-ink-400 ml-1">用画笔直接表达情绪</span>
            <button
              onClick={() => {
                /* 携带当前情绪色板跳转独立画板(图层/橡皮/吸管/缩放) */
                sessionStorage.setItem(
                  'danqing-canvas-palette',
                  JSON.stringify({
                    emotion: selectedEmotion + (secondaryEmotion ? `-${secondaryEmotion}` : ''),
                    colorPalette: displayPalette,
                  }),
                );
                navigate('/canvas');
              }}
              className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-sm text-cinnabar bg-cinnabar/5 hover:bg-cinnabar/10 rounded-lg transition-all"
              aria-label="打开完整画板"
            >
              <Brush className="w-4 h-4" />
              打开完整画板
              <span className="text-xs text-ink-400">图层 · 橡皮 · 缩放</span>
            </button>
          </div>
          <EmotionBrushCanvas
            colorPalette={displayPalette}
            emotionName={selectedEmotion + (secondaryEmotion ? `-${secondaryEmotion}` : '')}
            width={Math.min(900, typeof window !== 'undefined' ? window.innerWidth - 80 : 800)}
            height={420}
          />
        </div>

        {/* Generate Button */}
        <div className="text-center mb-8">
          <button
            onClick={handleGenerate}
            disabled={generating}
            aria-label="生成情绪画面"
            className="inline-flex items-center gap-3 px-12 py-4 rounded-xl transition-all disabled:opacity-50 transform hover:scale-105 shadow-card text-white font-serif text-lg"
            style={{ background: getGradient(displayPalette, 1) }}
          >
            {generating ? (
              <>
                <Loader2 className="w-6 h-6 animate-spin" />
                <span>AI 创作中...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-6 h-6" />
                <span>生成「{selectedEmotion}{secondaryEmotion ? `·${secondaryEmotion}` : ''}」画面</span>
              </>
            )}
          </button>
          <p className="text-sm text-ink-400 mt-3">
            生成 3 张参考画面 · {genParams.aspect === 'square' ? '斗方' : genParams.aspect === 'landscape' ? '横卷' : '立轴'}画幅 · 真实 AI 约需 1 分钟
          </p>
        </div>

        {/* Loading State(逐张上屏:已完成的结果会实时出现在下方结果区) */}
        {generating && (
          <div className="mb-8">
            <GenerationLoading
              title={`AI 正在描绘「${selectedEmotion}」`}
              subtitle="将抽象情感转化为视觉语言 · 每张完成即刻上屏"
              color={themeColor}
              estimatedSeconds={75}
              completedCount={completedCount}
              totalCount={3}
            />
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-6">
              <h2 className="font-serif text-xl font-bold text-ink-900 flex items-center gap-2">
                <Heart className="w-5 h-5 text-cinnabar" />
                「{selectedEmotion}」的视觉表达
              </h2>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setWorkshopOpen(true)}
                  aria-label="打开结果工作台"
                  className="flex items-center gap-2 px-3 py-1.5 text-sm bg-ink-900 text-rice-100 rounded-lg transition-all hover:bg-cinnabar"
                  title="对比 · 收藏 · 分享 · 微调重生成"
                >
                  <Columns2 className="w-4 h-4" />
                  结果工作台
                </button>
                <button
                  onClick={handleApplyToStyles}
                  aria-label="应用到风格调色板"
                  className="flex items-center gap-2 px-3 py-1.5 text-sm border-2 rounded-lg transition-all hover:bg-cinnabar hover:text-white hover:border-cinnabar"
                  style={{ borderColor: `${themeColor}40`, color: themeColor }}
                  title="应用到风格调色板"
                >
                  <Palette className="w-4 h-4" />
                  应用到风格调色板
                </button>
                <button
                  onClick={handleGenerate}
                  aria-label="换一批"
                  className="flex items-center gap-2 text-sm text-ink-500 hover:text-cinnabar transition-all"
                >
                  <RefreshCw className="w-4 h-4" />
                  换一批
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {results.map((url, index) => (
                <div
                  key={index}
                  className="bg-rice-50 rounded-2xl overflow-hidden shadow-card hover:shadow-card-hover transition-all group"
                >
                  <div className={`overflow-hidden relative ${
                    genParams.aspect === 'landscape' ? 'aspect-[4/3]' : genParams.aspect === 'portrait' ? 'aspect-[3/4]' : 'aspect-square'
                  }`}>
                    <img
                      src={url}
                      alt={`${selectedEmotion}画面 ${index + 1}`}
                      loading="lazy"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                    />
                    <div
                      className="absolute top-3 left-3 px-2 py-1 rounded-full text-xs text-white"
                      style={{ backgroundColor: themeColor }}
                    >
                      {selectedEmotion} · {index + 1}
                    </div>
                  </div>
                  <div className="p-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-ink-700 text-sm">AI 情绪参考画面</p>
                      <p className="text-xs text-ink-500">第 {index + 1} 版</p>
                    </div>
                    <div className="flex gap-2">
                      <button
                        onClick={() => handleDownload(url, index)}
                        aria-label="下载"
                        className="p-2 bg-ink-900/5 text-ink-700 rounded-lg hover:bg-cinnabar hover:text-white transition-all"
                        title="下载"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => handleShareCard(index)}
                        aria-label="分享"
                        className="p-2 bg-ink-900/5 text-ink-700 rounded-lg hover:bg-ink-900 hover:text-rice-100 transition-all"
                        title="分享"
                      >
                        <Share2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 生成失败:明确错误原因 + 重试(不再静默回退占位图) */}
        {genError && !generating && (
          <div className="mb-8 bg-rice-50 rounded-2xl p-8 shadow-card text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-cinnabar/10 flex items-center justify-center">
              <CloudRain className="w-7 h-7 text-cinnabar" />
            </div>
            <h3 className="font-serif text-xl font-semibold text-ink-900 mb-2">
              {genError.reason === 'disabled'
                ? 'AI 生成功能暂未开放'
                : genError.reason === 'timeout'
                ? '生成超时'
                : genError.reason === 'quota'
                ? '请求过于频繁'
                : '生成失败'}
            </h3>
            <p className="text-sm text-ink-500 mb-6 max-w-md mx-auto">{genError.message}</p>
            <button
              onClick={handleGenerate}
              aria-label="重试生成"
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-cinnabar hover:bg-cinnabar-dark text-white rounded-lg transition-colors font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              重试生成
            </button>
          </div>
        )}

        {/* Empty State */}
        {results.length === 0 && !generating && !genError && (
          <div className="bg-rice-50 rounded-2xl shadow-card">
            <EmptyState
              icon={Heart}
              title="输入情绪词开始探索"
              desc="将情绪转化为色彩方案"
            />
          </div>
        )}

        {/* 结果工作台:对比 / 收藏 / 分享 / 微调重生成 */}
        <ResultWorkshop
          open={workshopOpen}
          onClose={() => setWorkshopOpen(false)}
          items={workshopItems}
          accentColor={themeColor}
          onSave={handleSaveWorkshopItem}
          onRegenerate={handleGenerate}
          tweakPanel={
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-rice-100 rounded-xl p-4">
                <div className="flex justify-between mb-2 text-sm">
                  <span className="font-medium text-ink-700">情绪浓度</span>
                  <span className="text-ink-500">{Math.round(intensity * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="1"
                  step="0.05"
                  value={intensity}
                  onChange={(e) => setIntensity(parseFloat(e.target.value))}
                  aria-label="微调情绪浓度"
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, ${displayPalette[5]} 0%, ${displayPalette[2]} 50%, ${displayPalette[0]} 100%)`,
                  }}
                />
              </div>
              {secondaryEmotionData && (
                <div className="bg-rice-100 rounded-xl p-4">
                  <div className="flex justify-between mb-2 text-sm">
                    <span className="font-medium" style={{ color: currentEmotion.colorPalette[1] }}>
                      {selectedEmotion} {Math.round(ratio * 100)}%
                    </span>
                    <span className="font-medium" style={{ color: secondaryEmotionData.colorPalette[1] }}>
                      {secondaryEmotion} {100 - Math.round(ratio * 100)}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="0.5"
                    max="0.9"
                    step="0.05"
                    value={ratio}
                    onChange={(e) => setRatio(parseFloat(e.target.value))}
                    aria-label="微调双情绪配比"
                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                    style={{
                      background: `linear-gradient(to right, ${currentEmotion.colorPalette[1]} 0%, ${currentEmotion.colorPalette[1]} ${ratio * 100}%, ${secondaryEmotionData.colorPalette[1]} ${ratio * 100}%, ${secondaryEmotionData.colorPalette[1]} 100%)`,
                    }}
                  />
                </div>
              )}
            </div>
          }
        />
      </div>
    </div>
  );
}
