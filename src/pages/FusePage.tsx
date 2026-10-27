import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Heart, Upload, Download, Loader2, Sparkles, X, Plus, Layout, Palette,
  Layers, Wand2, MapPin, Zap, Shuffle, Settings2, ChevronRight, Check,
  Grid3X3, ImageIcon, Info, ArrowRight, Bookmark, TrendingUp, Target,
  Lightbulb, ChevronDown, ChevronUp, RefreshCw, Save, Scan, Gem, Hourglass,
  Scale, Trash2, Columns2, Package, ChevronLeft,
} from 'lucide-react';
import {
  fuseStyles, fuseMethods, fuseIntensities, fusePresets,
  generateFusionAnalysis,
  getStyleById, getMethodById, getIntensityById,
  type FuseStyle, type FuseMethod, type FuseIntensity, type FusionAnalysis,
} from '../services/fuseStandards';
import { buildFusionPrompt } from '../services/fusionAlgorithms';
import {
  listFuseUserPresets, saveFuseUserPreset, removeFuseUserPreset,
  type FuseUserPreset,
} from '../services/fusePresetStore';
import { generateImage, ImageGenerationError } from '../services/imageService';
import { loadBuiltinArtworks, resolveArtworkImageUrl, resolveArtworkThumbUrl, resolveArtworkFallbackUrl, type ArtworkItem } from '../services/artworksDatabase';
import {
  loadHeritageWorks,
  HERITAGE_CATEGORY_LABEL,
  HERITAGE_LABEL_TO_KEY,
  resolveHeritageFull,
  heritageAsArtworkImageMarker,
  type HeritageWork,
} from '../services/heritageDatabase';
import type { HeritageCategory } from '../types';
import {
  getPacks, resolvePackMaterials,
  type MaterialPack, type UnifiedMaterial,
} from '../services/materialService';
import { useToast } from '../components/ToastProvider';
import { saveSavedMaterial, getSavedMaterials, type SavedMaterial } from '../services/data-service';
import EmptyState from '../components/EmptyState';
import GenerationLoading from '../components/GenerationLoading';
import ResultWorkshop, { type WorkshopItem } from '../components/ResultWorkshop';

const methodIconMap: Record<string, typeof Layout> = {
  composition: Layout,
  'color-transfer': Palette,
  'element-fusion': Layers,
  'style-transformation': Wand2,
  'hybrid-landscape': MapPin,
  'mood-blending': Heart,
  'region-swap': Scan,
  'material-graft': Gem,
  'time-fold': Hourglass,
};

/**
 * 非遗作品 → ArtworkItem 映射(Task 20:heritage 素材参与灵感嫁接)
 * ------------------------------------------------------------
 * heritage-works.json 采用非遗专用 schema,映射为 ArtworkItem 后
 * 可无缝接入现有双槽位选择 / prompt 构建 / 结果存档流程:
 *   - category='heritage':触发 fusionAlgorithms 的非遗纹样注入
 *   - style=类目中文名(剪纸/刺绣/瓷器):供 prompt 注入与回填 heritageCategory
 *   - tags=techniquePoints:作为非遗特征语料注入嫁接 prompt
 *   - imageUrl=__ARTWORK_IMAGE__:id:解析为 gold 系 SVG 占位(零网络)
 */
/**
 * 将非遗素材项转换为 ArtworkItem(用于灵感嫁接流程对接)
 * - 图像走 resolveHeritageThumb → 三级降级,且生产环境自动禁用 IDE 占位 URL
 */
function heritageToArtworkItem(hw: HeritageWork): ArtworkItem {
  return {
    id: hw.id,
    title: hw.title,
    artist: hw.origin,
    year: hw.dynasty,
    category: 'heritage',
    style: HERITAGE_CATEGORY_LABEL[hw.category],
    era: hw.dynasty,
    region: 'china',
    description: hw.craftFeature,
    imageUrl: heritageAsArtworkImageMarker(hw),
    source: 'heritage-works',
    tags: [...hw.techniquePoints, ...hw.tags],
  };
}

/**
 * 反向: 若 ArtworkItem 是非遗来源, 给出 full 图的解析结果,用于弹窗大图
 */
export function heritageArtworkFullUrl(item: ArtworkItem): string | null {
  if (item.source !== 'heritage-works') return null;
  // 尝试从缓存里找到对应 HeritageWork
  const cache = (globalThis as unknown as { __heritageCache?: HeritageWork[] }).__heritageCache;
  const hw = cache?.find((h) => h.id === item.id);
  if (hw) return resolveHeritageFull(hw);
  // 兜底: 同样走 thumb 降级(大图无图时不报错)
  const hwStub = {
    id: item.id, category: (HERITAGE_LABEL_TO_KEY[item.style] ?? 'papercut'),
    title: item.title, dynasty: item.year ?? '', origin: item.artist ?? '',
    history: '', craftFeature: item.description ?? '', representativeWork: '',
    techniquePoints: [], tags: [], images: { thumb: '', full: '' },
  } as HeritageWork;
  return resolveHeritageFull(hwStub);
}

interface FuseResult {
  id: string;
  url: string;
  prompt: string;
  analysis: FusionAnalysis;
  style: FuseStyle;
  method: FuseMethod;
  intensity: FuseIntensity;
}

export default function FusePage() {
  const toast = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [artwork1, setArtwork1] = useState<ArtworkItem | null>(null);
  const [artwork2, setArtwork2] = useState<ArtworkItem | null>(null);
  const [customImage1, setCustomImage1] = useState<string>('');
  const [customImage2, setCustomImage2] = useState<string>('');
  const [fusing, setFusing] = useState(false);
  const [results, setResults] = useState<FuseResult[]>([]);
  /* 融合失败原因(失败不再静默回退占位图,显示原因+重试) */
  const [fuseError, setFuseError] = useState<ImageGenerationError | null>(null);
  /* 逐张上屏计数:每张完成 +1,驱动 GenerationLoading "已完成 X/N" */
  const [fuseCompleted, setFuseCompleted] = useState(0);
  const [selectedResultIndex, setSelectedResultIndex] = useState(0);
  const [showArtworkPicker, setShowArtworkPicker] = useState<1 | 2 | null>(null);
  const [pickerSearch, setPickerSearch] = useState('');
  const [pickerCategory, setPickerCategory] = useState<string>('all');
  /* 选择器来源:内置素材库 / 我的保存 / 我的素材包 */
  const [pickerSource, setPickerSource] = useState<'builtin' | 'saved' | 'packs'>('builtin');
  const [savedMaterials, setSavedMaterials] = useState<SavedMaterial[]>([]);
  const [pickerPacks, setPickerPacks] = useState<MaterialPack[]>([]);
  const [activePickerPack, setActivePickerPack] = useState<MaterialPack | null>(null);
  const [pickerPackMaterials, setPickerPackMaterials] = useState<UnifiedMaterial[]>([]);
  const [isLoadingPickerExtra, setIsLoadingPickerExtra] = useState(false);
  const fileInput1Ref = useRef<HTMLInputElement>(null);
  const fileInput2Ref = useRef<HTMLInputElement>(null);

  const [selectedStyle, setSelectedStyle] = useState<FuseStyle>(fuseStyles[0]);
  const [selectedMethod, setSelectedMethod] = useState<FuseMethod>(fuseMethods[2]);
  const [selectedIntensity, setSelectedIntensity] = useState<FuseIntensity>(fuseIntensities[1]);
  const [fusionRatio, setFusionRatio] = useState(0.5); // 作品A占比
  const [showSettings, setShowSettings] = useState(false);
  const [showPresets, setShowPresets] = useState(true);
  const [showAnalysis, setShowAnalysis] = useState(true);
  const [resultVariations, setResultVariations] = useState(1);
  const [workshopOpen, setWorkshopOpen] = useState(false);

  /* 用户自主搭配预设 */
  const [userPresets, setUserPresets] = useState<FuseUserPreset[]>([]);
  const [showUserPresetInput, setShowUserPresetInput] = useState(false);
  const [userPresetName, setUserPresetName] = useState('');

  useEffect(() => {
    const list = listFuseUserPresets();
    setUserPresets(list);
    /* URL ?preset=<id> 自动载入用户搭配 */
    const presetId = searchParams.get('preset');
    if (presetId) {
      const preset = list.find((p) => p.id === presetId);
      if (preset) {
        const s = getStyleById(preset.styleId);
        const m = getMethodById(preset.methodId);
        const i = getIntensityById(preset.intensityId);
        if (s) setSelectedStyle(s);
        if (m) setSelectedMethod(m);
        if (i) setSelectedIntensity(i);
        setFusionRatio(preset.ratio);
        setResultVariations(preset.variations);
        toast.success('搭配已载入', `「${preset.name}」`);
      }
    }
    /* Phase 3 批次④:URL ?style=<id> 风格预填(分析页"跨域启发"跳转入口;
       preset 同时存在时 preset 优先——preset 是用户显式保存的完整搭配) */
    const styleId = searchParams.get('style');
    if (styleId && !presetId) {
      const s = getStyleById(styleId);
      if (s) {
        setSelectedStyle(s);
        toast.info('风格已预填', `「${s.name}」`);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* 素材数据状态 */
  const [artworks, setArtworks] = useState<ArtworkItem[]>([]);
  const [isLoadingArtworks, setIsLoadingArtworks] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingArtworks(true);
    loadBuiltinArtworks()
      .then((data) => {
        if (!cancelled) {
          setArtworks(data);
          setIsLoadingArtworks(false);
        }
      })
      .catch((err) => {
        console.error('加载素材库失败:', err);
        if (!cancelled) setIsLoadingArtworks(false);
      });
    return () => { cancelled = true; };
  }, []);

  /* ---------- 非遗素材状态(Task 20:heritage 类目参与素材选取) ---------- */
  const [heritageWorks, setHeritageWorks] = useState<HeritageWork[]>([]);
  const [isLoadingHeritage, setIsLoadingHeritage] = useState(false);

  // 选择器切到 heritage 类目时按需加载非遗素材(避免首屏多一次 fetch)
  useEffect(() => {
    if (pickerSource !== 'builtin' || pickerCategory !== 'heritage') return;
    if (heritageWorks.length > 0 || isLoadingHeritage) return;
    let cancelled = false;
    setIsLoadingHeritage(true);
    loadHeritageWorks()
      .then((data) => {
        if (!cancelled) {
          setHeritageWorks(data);
          setIsLoadingHeritage(false);
        }
      })
      .catch((err) => {
        console.error('加载非遗素材库失败:', err);
        if (!cancelled) setIsLoadingHeritage(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickerSource, pickerCategory]);

  const image1 = artwork1 ? resolveArtworkImageUrl(artwork1).imageUrl : customImage1;
  const image2 = artwork2 ? resolveArtworkImageUrl(artwork2).imageUrl : customImage2;

  // 接收来自素材库的 URL 参数：?src=material&artworkId=xxx 或 &imageUrl=xxx
  // 处理后立即清除参数(replace),保证从素材库多次跳转都能正常载入
  useEffect(() => {
    const src = searchParams.get('src');
    if (src !== 'material') return;
    const artworkId = searchParams.get('artworkId');
    const imageUrl = searchParams.get('imageUrl');
    if (artworkId) {
      /* 内置素材尚未加载完成时等待,加载后再触发本 effect */
      if (artworks.length === 0) return;
      const found = artworks.find((a) => a.id === artworkId);
      if (!found) {
        toast.warning('未找到该素材', '可能已被移除,请重新选择');
        setSearchParams({}, { replace: true });
        return;
      }
      setArtwork1(found);
      setCustomImage1('');
      setResults([]);
      toast.info('已从素材库载入作品1');
    } else if (imageUrl) {
      setCustomImage1(imageUrl);
      setArtwork1(null);
      setResults([]);
      toast.info('已从素材库载入作品1');
    } else {
      return;
    }
    /* 清除已消费参数,允许下次从素材库再次载入 */
    setSearchParams({}, { replace: true });
  }, [artworks, searchParams, setSearchParams, toast]);

  // 接收来自独立画板的参考图:sessionStorage 'danqing-canvas-reference'(读后即删,一次性消费)
  useEffect(() => {
    const refImage = sessionStorage.getItem('danqing-canvas-reference');
    if (!refImage) return;
    sessionStorage.removeItem('danqing-canvas-reference');
    setCustomImage1(refImage);
    setArtwork1(null);
    setResults([]);
    toast.info('已载入画板参考图', '作为作品1参与灵感嫁接');
  }, [toast]);

  /* 打开作品选择器时:加载「我的保存」与「我的素材包」,并重置包内浏览状态 */
  useEffect(() => {
    if (showArtworkPicker === null) return;
    setActivePickerPack(null);
    setPickerPackMaterials([]);
    let cancelled = false;
    setIsLoadingPickerExtra(true);
    Promise.all([getSavedMaterials(), getPacks()])
      .then(([saved, packs]) => {
        if (cancelled) return;
        setSavedMaterials(saved);
        setPickerPacks(packs);
      })
      .catch((err) => console.error('加载我的素材失败:', err))
      .finally(() => { if (!cancelled) setIsLoadingPickerExtra(false); });
    return () => { cancelled = true; };
  }, [showArtworkPicker]);

  /* 展开素材包,加载包内素材 */
  const handleOpenPickerPack = async (pack: MaterialPack) => {
    setIsLoadingPickerExtra(true);
    try {
      const materials = await resolvePackMaterials(pack);
      setActivePickerPack(pack);
      setPickerPackMaterials(materials);
    } catch (err) {
      console.error('解析素材包失败:', err);
      toast.error('加载素材包失败', '请稍后重试');
    } finally {
      setIsLoadingPickerExtra(false);
    }
  };

  /* 选择自定义图片素材(我的保存 / 素材包中的非内置素材):直接以图片 URL 参与融合 */
  const handleCustomMaterialSelect = (imageUrl: string, title: string, slot: 1 | 2) => {
    if (slot === 1) {
      setCustomImage1(imageUrl);
      setArtwork1(null);
    } else {
      setCustomImage2(imageUrl);
      setArtwork2(null);
    }
    setShowArtworkPicker(null);
    setResults([]);
    toast.info(`已载入「${title}」`, `作为作品${slot}参与灵感嫁接`);
  };

  /* 选择统一素材:内置作品走完整元数据(供 prompt 构建),其余按图片 URL 处理 */
  const handleUnifiedMaterialSelect = (material: UnifiedMaterial, slot: 1 | 2) => {
    if (material.source === 'builtin') {
      handleArtworkSelect(material.ref as ArtworkItem, slot);
      return;
    }
    handleCustomMaterialSelect(material.imageUrl, material.title, slot);
  };

  // 保存当前嫁接结果到素材库（通过 data-service 异步落库）
  const handleSaveToMaterials = async () => {
    const result = results[selectedResultIndex];
    if (!result) return;
    try {
      /* 去重:生成时已自动存档,相同图片不重复入库 */
      const list = await getSavedMaterials();
      if (list.some((m) => m.imageUrl === result.url)) {
        toast.info('已在素材库中', '该作品生成时已自动保存');
        return;
      }
      await saveSavedMaterial({
        imageUrl: result.url,
        title: `嫁接作品-${new Date().toLocaleDateString('zh-CN')}`,
        source: 'fuse',
      });
      toast.success('已保存到素材库');
    } catch (err) {
      console.error('保存到素材库失败:', err);
      toast.error('保存失败', '请稍后重试');
    }
  };

  /* ---------- 结果工作台:条目归一化 ---------- */
  const workshopItems: WorkshopItem[] = useMemo(
    () =>
      results.map((r, i) => ({
        id: r.id,
        url: r.url,
        title: `方案 ${i + 1}`,
        subtitle: `${r.style.name} · ${r.method.name} · ${r.intensity.name}`,
        shareText: `【丹青有AI】我用「${r.style.name} × ${r.method.name}」把两张作品融合成了新创意 → ${window.location.origin}/app/#/fuse`,
      })),
    [results],
  );

  const handleSaveWorkshopItem = async (item: WorkshopItem) => {
    /* 去重:生成时已自动存档,相同图片不重复入库 */
    const list = await getSavedMaterials();
    if (list.some((m) => m.imageUrl === item.url)) return;
    await saveSavedMaterial({
      imageUrl: item.url,
      title: `嫁接作品-${item.title}-${new Date().toLocaleDateString('zh-CN')}`,
      source: 'fuse',
    });
  };

  const handleFileSelect = useCallback((file: File, slot: 1 | 2) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const url = e.target?.result as string;
      if (slot === 1) {
        setCustomImage1(url);
        setArtwork1(null);
      } else {
        setCustomImage2(url);
        setArtwork2(null);
      }
      setResults([]);
    };
    reader.readAsDataURL(file);
  }, []);

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>, slot: 1 | 2) => {
    const file = event.target.files?.[0];
    if (file) handleFileSelect(file, slot);
  };

  const handleDrop = useCallback((event: React.DragEvent<HTMLDivElement>, slot: 1 | 2) => {
    event.preventDefault();
    const file = event.dataTransfer.files?.[0];
    if (file && file.type.startsWith('image/')) {
      handleFileSelect(file, slot);
    }
  }, [handleFileSelect]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  }, []);

  const handleArtworkSelect = (artwork: ArtworkItem, slot: 1 | 2) => {
    if (slot === 1) {
      setArtwork1(artwork);
      setCustomImage1('');
    } else {
      setArtwork2(artwork);
      setCustomImage2('');
    }
    setShowArtworkPicker(null);
    setResults([]);
  };

  const applyPreset = (presetId: string) => {
    const preset = fusePresets.find((p) => p.id === presetId);
    if (!preset) return;
    const style = getStyleById(preset.styleId);
    const method = getMethodById(preset.methodId);
    const intensity = getIntensityById(preset.intensityId);
    if (style) setSelectedStyle(style);
    if (method) setSelectedMethod(method);
    if (intensity) setSelectedIntensity(intensity);
  };

  /* ---------- 用户自主搭配预设 ---------- */
  const handleSaveUserPreset = () => {
    const name = userPresetName.trim();
    if (!name) {
      toast.error('请输入搭配名称');
      return;
    }
    const entry = saveFuseUserPreset({
      name,
      styleId: selectedStyle.id,
      methodId: selectedMethod.id,
      intensityId: selectedIntensity.id,
      ratio: fusionRatio,
      variations: resultVariations,
    });
    setUserPresets((prev) => [entry, ...prev].slice(0, 20));
    setUserPresetName('');
    setShowUserPresetInput(false);
    toast.success('搭配已保存', `「${name}」可在「我的搭配」中快速载入`);
  };

  const handleLoadUserPreset = (preset: FuseUserPreset) => {
    const style = getStyleById(preset.styleId);
    const method = getMethodById(preset.methodId);
    const intensity = getIntensityById(preset.intensityId);
    if (style) setSelectedStyle(style);
    if (method) setSelectedMethod(method);
    if (intensity) setSelectedIntensity(intensity);
    setFusionRatio(preset.ratio);
    setResultVariations(preset.variations);
    toast.success('搭配已载入', `「${preset.name}」`);
  };

  const handleRemoveUserPreset = (preset: FuseUserPreset) => {
    removeFuseUserPreset(preset.id);
    setUserPresets((prev) => prev.filter((p) => p.id !== preset.id));
    toast.success('搭配已删除', preset.name);
  };

  const handleFuse = async () => {
    if (!image1 || !image2) {
      toast.warning('请选择两张作品', '需要两张作品才能进行灵感嫁接');
      return;
    }
    setFusing(true);
    setResults([]);
    setSelectedResultIndex(0);
    setFuseError(null);
    setFuseCompleted(0);

    try {
      /* P2:按方法调度对应融合算法,传入作品配比 */
      const prompt = buildFusionPrompt({
        style: selectedStyle,
        method: selectedMethod,
        intensity: selectedIntensity,
        ratio: fusionRatio,
        artwork1,
        artwork2,
      });

      const analysis = generateFusionAnalysis(
        selectedStyle,
        selectedMethod,
        selectedIntensity,
        artwork1,
        artwork2
      );

      // Task 20.3:检测非遗素材参与嫁接,生成结果携带 heritage 标签
      // (供 HistoryPage 灵感作品分类下显示非遗标记;style 字段为类目中文名,反查 key)
      const fuseHeritageArt = [artwork1, artwork2].find((a) => a?.category === 'heritage') ?? null;
      const fuseHeritageCategory: HeritageCategory | undefined = fuseHeritageArt
        ? HERITAGE_LABEL_TO_KEY[fuseHeritageArt.style]
        : undefined;

      const sizes = ['landscape_4_3', 'portrait_4_3', 'square'];

      // 并行生成多张变体,每张完成立即上屏(每张真实 AI 约 50-70s,
      // 逐张展示使感知等待从 N 倍降为 1 倍)
      const tasks = Array.from({ length: resultVariations }, (_, i) => {
        const variationPrompt = `${prompt} variation ${i + 1}, ${['dramatic lighting', 'soft ambient light', 'golden hour glow'][i % 3]}`;
        return generateImage(variationPrompt, sizes[i % sizes.length]).then((url) => ({
          id: `result-${Date.now()}-${i}`,
          url,
          prompt: variationPrompt,
          analysis,
          style: selectedStyle,
          method: selectedMethod,
          intensity: selectedIntensity,
        }));
      });

      const settled = await Promise.allSettled(tasks);
      const newResults: FuseResult[] = [];
      let firstError: unknown = null;
      for (const r of settled) {
        if (r.status === 'fulfilled') {
          newResults.push(r.value);
          /* 逐张上屏:每完成一张立即追加渲染 */
          setResults((prev) => [...prev, r.value]);
          setFuseCompleted((prev) => prev + 1);
          /* 自动持久化:生成即存档,关掉页面也能在历史记录「我的生成」找回 */
          void saveSavedMaterial({
            imageUrl: r.value.url,
            title: `嫁接作品-${r.value.style.name}×${r.value.method.name}-${new Date().toLocaleDateString('zh-CN')}`,
            source: 'fuse',
            // 非遗嫁接结果带 heritage 标签(灵感作品分类下显示非遗标记)
            ...(fuseHeritageCategory ? { heritageCategory: fuseHeritageCategory } : {}),
          }).catch((err) => console.error('自动保存嫁接作品失败:', err));
        } else if (!firstError) {
          firstError = r.reason;
        }
      }

      /* 全部失败:抛错由外层统一呈现错误卡片(不再回退占位图) */
      if (newResults.length === 0) {
        throw firstError instanceof ImageGenerationError
          ? firstError
          : new ImageGenerationError('unknown', '灵感融合失败,请检查网络或重试');
      }
      if (newResults.length < resultVariations) {
        toast.warning('部分方案生成失败', `成功 ${newResults.length}/${resultVariations} 张,可重试`);
      } else {
        toast.success('灵感融合完成', `生成 ${newResults.length} 张融合作品`);
      }
    } catch (error) {
      console.error('灵感融合失败:', error);
      setFuseError(
        error instanceof ImageGenerationError
          ? error
          : new ImageGenerationError('unknown', '灵感融合失败,请检查网络或重试'),
      );
    } finally {
      setFusing(false);
    }
  };

  const handleDownload = () => {
    const result = results[selectedResultIndex];
    if (!result) return;
    const link = document.createElement('a');
    link.href = result.url;
    link.download = `fused-${result.style.id}-${Date.now()}.png`;
    link.target = '_blank';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleClear = (slot: 1 | 2) => {
    if (slot === 1) {
      setArtwork1(null);
      setCustomImage1('');
    } else {
      setArtwork2(null);
      setCustomImage2('');
    }
    setResults([]);
  };

  const filteredArtworks = useMemo(() => {
    let results = [...artworks];
    if (pickerCategory !== 'all') {
      results = results.filter((a) => a.category === pickerCategory);
    }
    if (pickerSearch) {
      const kw = pickerSearch.toLowerCase();
      results = results.filter(
        (a) =>
          a.title.includes(pickerSearch) ||
          a.titleEn?.toLowerCase().includes(kw) ||
          a.artist.includes(pickerSearch) ||
          a.artistEn?.toLowerCase().includes(kw) ||
          a.tags.some((t) => t.includes(pickerSearch))
      );
    }
    return results.slice(0, 50);
  }, [artworks, pickerSearch, pickerCategory]);

  // 非遗素材选择器:按搜索词筛选(pickerCategory === 'heritage' 时使用)
  const filteredHeritageWorks = useMemo(() => {
    let results = [...heritageWorks];
    if (pickerSearch) {
      results = results.filter(
        (w) =>
          w.title.includes(pickerSearch) ||
          w.origin.includes(pickerSearch) ||
          w.dynasty.includes(pickerSearch) ||
          w.craftFeature.includes(pickerSearch) ||
          w.techniquePoints.some((p) => p.includes(pickerSearch)) ||
          w.tags.some((t) => t.includes(pickerSearch))
      );
    }
    return results.slice(0, 50);
  }, [heritageWorks, pickerSearch]);

  /* 我的保存:按标题关键词过滤 */
  const filteredSavedMaterials = useMemo(() => {
    if (!pickerSearch) return savedMaterials;
    return savedMaterials.filter((m) => m.title.includes(pickerSearch));
  }, [savedMaterials, pickerSearch]);

  /* 素材包:按包名/描述关键词过滤 */
  const filteredPickerPacks = useMemo(() => {
    if (!pickerSearch) return pickerPacks;
    return pickerPacks.filter(
      (p) => p.name.includes(pickerSearch) || p.description?.includes(pickerSearch)
    );
  }, [pickerPacks, pickerSearch]);

  const renderUploadBox = (slot: 1 | 2, artwork: ArtworkItem | null, customImg: string, label: string) => {
    const inputRef = slot === 1 ? fileInput1Ref : fileInput2Ref;
    // 素材库作品需经 resolveArtworkImageUrl 解析(加 /app 前缀),
    // 否则 /images/... 会 404(nginx 仅在 /app/images/ 挂载 artworks);
    // 自定义上传(customImg 为 blob:/data:)直接用原值
    const img = artwork ? resolveArtworkImageUrl(artwork).imageUrl : customImg;
    return (
      <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-lg font-bold text-ink-900">
            作品 {slot} · {label}
          </h3>
          <button
            onClick={() => setShowArtworkPicker(slot)}
            aria-label="从素材库选择"
            className="flex items-center gap-1 text-sm text-cinnabar hover:underline"
          >
            <Grid3X3 className="w-4 h-4" />
            从素材库选
          </button>
        </div>
        {!img ? (
          <div
            className="border-2 border-dashed border-ink-300 rounded-xl p-8 text-center cursor-pointer hover:border-cinnabar hover:bg-cinnabar/5 transition-all aspect-[4/3] flex flex-col items-center justify-center group"
            onDrop={(e) => handleDrop(e, slot)}
            onDragOver={handleDragOver}
            onClick={() => inputRef.current?.click()}
          >
            <input
              ref={inputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => handleFileChange(e, slot)}
              className="hidden"
            />
            <div className="w-16 h-16 bg-ink-900/5 rounded-full flex items-center justify-center mb-3 group-hover:bg-cinnabar/10 transition-all">
              <Upload className="w-8 h-8 text-ink-500 group-hover:text-cinnabar transition-all" />
            </div>
            <p className="font-medium text-ink-700 mb-1">点击或拖拽上传</p>
            <p className="text-sm text-ink-500">支持 JPG、PNG 格式</p>
            <p className="text-xs text-ink-400 mt-2">或点击上方「从素材库选」</p>
          </div>
        ) : (
          <div className="relative aspect-[4/3] rounded-xl overflow-hidden bg-ink-100 group">
            <img
              src={img}
              alt={`作品 ${slot}`}
              loading="lazy"
              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-105"
              onError={(e) => {
                // 大图加载失败时回退到本地生成的占位图(素材库作品按 id/风格兜底,自定义上传隐藏)
                if (artwork) {
                  e.currentTarget.src = resolveArtworkFallbackUrl(artwork);
                } else {
                  e.currentTarget.style.display = 'none';
                }
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-t from-ink-900/50 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="absolute top-3 left-3">
              <span className="px-2 py-1 bg-cinnabar/90 text-white text-xs rounded-full backdrop-blur-sm">
                作品 {slot}
              </span>
            </div>
            {artwork && (
              <div className="absolute bottom-3 left-3 right-3 text-white opacity-0 group-hover:opacity-100 transition-opacity">
                <p className="font-medium text-sm truncate">{artwork.title}</p>
                <p className="text-xs text-white/80 truncate">{artwork.artist} · {artwork.era}</p>
              </div>
            )}
            <button
              onClick={() => handleClear(slot)}
              aria-label="移除作品"
              className="absolute top-2 right-2 p-1.5 bg-white/90 backdrop-blur-sm text-ink-700 rounded-full hover:bg-cinnabar hover:text-white transition-all opacity-0 group-hover:opacity-100"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderSettingsPanel = () => (
    <div className="bg-rice-50 rounded-2xl p-6 shadow-card mb-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="font-serif text-lg font-bold text-ink-900 flex items-center gap-2">
          <Settings2 className="w-5 h-5 text-cinnabar" />
          融合标准设置
        </h3>
        <button
          onClick={() => setShowSettings(false)}
          className="text-sm text-ink-500 hover:text-cinnabar"
        >
          收起
        </button>
      </div>

      {/* Presets */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="w-4 h-4 text-cinnabar" />
            <p className="font-medium text-ink-700">创意预设</p>
            <span className="text-xs text-ink-400">一键应用专业融合方案</span>
          </div>
          <button
            onClick={() => setShowPresets(!showPresets)}
            className="text-xs text-cinnabar hover:underline"
          >
            {showPresets ? '收起' : '展开'}
          </button>
        </div>
        {showPresets && (
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {fusePresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => applyPreset(preset.id)}
                aria-label={preset.name}
                className="p-3 rounded-xl bg-rice-50 hover:bg-rice-100 border-2 border-transparent hover:border-cinnabar/30 transition-all text-left group"
              >
                <div className="text-2xl mb-2">{preset.icon}</div>
                <p className="font-medium text-sm text-ink-900 group-hover:text-cinnabar transition-colors">
                  {preset.name}
                </p>
                <p className="text-xs text-ink-500 line-clamp-1">{preset.description}</p>
                <p className="text-xs text-cinnabar/70 mt-1">{preset.useCase}</p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 我的搭配(用户自主保存) */}
      <div className="mb-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Bookmark className="w-4 h-4 text-cinnabar" />
            <p className="font-medium text-ink-700">我的搭配</p>
            <span className="text-xs text-ink-400">保存你的专属融合方案</span>
          </div>
          <div className="relative">
            {showUserPresetInput ? (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={userPresetName}
                  onChange={(e) => setUserPresetName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSaveUserPreset()}
                  placeholder="搭配名称,如:青花骏马"
                  maxLength={12}
                  autoFocus
                  className="px-3 py-1 text-sm border border-ink-200 rounded-lg focus:outline-none focus:border-cinnabar w-40"
                />
                <button
                  onClick={handleSaveUserPreset}
                  className="px-3 py-1 text-sm bg-cinnabar text-white rounded-lg hover:bg-cinnabar/90 transition-all"
                >
                  保存
                </button>
                <button
                  onClick={() => setShowUserPresetInput(false)}
                  aria-label="取消"
                  className="p-1 text-ink-400 hover:text-ink-600"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <button
                onClick={() => setShowUserPresetInput(true)}
                className="flex items-center gap-1 text-xs text-cinnabar hover:underline"
              >
                <Save className="w-3.5 h-3.5" />
                存为我的搭配
              </button>
            )}
          </div>
        </div>
        {userPresets.length === 0 ? (
          <p className="text-xs text-ink-400 px-1">暂无保存的搭配 — 调好风格/方法/强度/配比后,点击右上角「存为我的搭配」</p>
        ) : (
          <div className="flex gap-2 flex-wrap">
            {userPresets.map((preset) => {
              const style = getStyleById(preset.styleId);
              const method = getMethodById(preset.methodId);
              return (
                <div
                  key={preset.id}
                  className="group flex items-center gap-2 pl-2 pr-1 py-1.5 bg-rice-100 hover:bg-rice-200 rounded-full transition-all"
                >
                  <div
                    className="w-4 h-4 rounded-full shadow-inner"
                    style={{ backgroundColor: style?.color ?? '#c53030' }}
                  />
                  <button
                    onClick={() => handleLoadUserPreset(preset)}
                    className="text-sm text-ink-700 hover:text-cinnabar transition-all"
                    title={`${style?.name ?? ''} + ${method?.name ?? ''} · 配比 ${Math.round(preset.ratio * 100)}%`}
                  >
                    {preset.name}
                  </button>
                  <button
                    onClick={() => handleRemoveUserPreset(preset)}
                    aria-label={`删除搭配 ${preset.name}`}
                    className="p-0.5 text-ink-300 hover:text-cinnabar rounded-full opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Style */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Palette className="w-4 h-4 text-ink-500" />
          <p className="font-medium text-ink-700">嫁接风格</p>
          <span className="text-xs text-ink-400">选择融合后的艺术风格 · 16 种</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {fuseStyles.map((style) => (
            <button
              key={style.id}
              onClick={() => setSelectedStyle(style)}
              aria-label={style.name}
              className={`p-4 rounded-xl border-2 transition-all text-left ${
                selectedStyle.id === style.id
                  ? 'border-cinnabar bg-cinnabar/5'
                  : 'border-transparent bg-rice-50 hover:bg-rice-100'
              }`}
            >
              <div
                className="w-full h-10 rounded-lg mb-2 shadow-sm"
                style={{ backgroundColor: style.color }}
              />
              <p className="font-medium text-sm text-ink-900">{style.name}</p>
              <p className="text-xs text-ink-500 line-clamp-1">{style.description}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Method */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Shuffle className="w-4 h-4 text-ink-500" />
          <p className="font-medium text-ink-700">融合方法</p>
          <span className="text-xs text-ink-400">选择两种作品如何结合</span>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {fuseMethods.map((method) => {
            const Icon = methodIconMap[method.id] || Layers;
            const isSelected = selectedMethod.id === method.id;
            return (
              <button
                key={method.id}
                onClick={() => setSelectedMethod(method)}
                aria-label={method.name}
                className={`p-4 rounded-xl border-2 transition-all text-left ${
                  isSelected
                    ? 'border-cinnabar bg-cinnabar/5'
                    : 'border-transparent bg-rice-50 hover:bg-rice-100'
                }`}
              >
                <div className="flex items-center gap-2 mb-2">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    isSelected ? 'bg-cinnabar text-white' : 'bg-ink-900/10 text-ink-600'
                  }`}>
                    <Icon className="w-4 h-4" />
                  </div>
                  <p className="font-medium text-sm text-ink-900">{method.name}</p>
                </div>
                <p className="text-xs text-ink-500 line-clamp-2">{method.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Intensity */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-ink-500" />
          <p className="font-medium text-ink-700">融合强度</p>
          <span className="text-xs text-ink-400">控制两种风格的混合程度</span>
        </div>
        <div className="grid grid-cols-4 gap-3">
          {fuseIntensities.map((intensity) => {
            const isSelected = selectedIntensity.id === intensity.id;
            return (
              <button
                key={intensity.id}
                onClick={() => setSelectedIntensity(intensity)}
                aria-label={intensity.name}
                className={`p-4 rounded-xl border-2 transition-all text-center ${
                  isSelected
                    ? 'border-cinnabar bg-cinnabar/5'
                    : 'border-transparent bg-rice-50 hover:bg-rice-100'
                }`}
              >
                <div className="flex justify-center gap-0.5 mb-2">
                  {[1, 2, 3, 4].map((i) => (
                    <div
                      key={i}
                      className={`w-2 h-6 rounded-full transition-all ${
                        i <= Math.round(intensity.value * 4)
                          ? isSelected ? 'bg-cinnabar' : 'bg-ink-500'
                          : 'bg-ink-200'
                      }`}
                    />
                  ))}
                </div>
                <p className="font-medium text-sm text-ink-900">{intensity.name}</p>
                <p className="text-xs text-ink-500">{intensity.description}</p>
              </button>
            );
          })}
        </div>
      </div>

      {/* Fusion Ratio */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Scale className="w-4 h-4 text-ink-500" />
          <p className="font-medium text-ink-700">作品配比</p>
          <span className="text-xs text-ink-400">作品A与作品B在融合中的主导权重</span>
        </div>
        <div className="bg-rice-50 rounded-xl p-4">
          <div className="flex justify-between mb-2 text-sm">
            <span className="font-medium text-cinnabar">作品A {Math.round(fusionRatio * 100)}%</span>
            <span className="font-medium text-ink-600">作品B {100 - Math.round(fusionRatio * 100)}%</span>
          </div>
          <input
            type="range"
            min="10"
            max="90"
            step="5"
            value={Math.round(fusionRatio * 100)}
            onChange={(e) => setFusionRatio(parseInt(e.target.value, 10) / 100)}
            aria-label="作品配比"
            className="w-full h-2 rounded-full appearance-none cursor-pointer"
            style={{
              background: `linear-gradient(to right, #c53030 0%, #c53030 ${fusionRatio * 100}%, #8a8f98 ${fusionRatio * 100}%, #8a8f98 100%)`,
            }}
          />
          <div className="flex justify-between mt-2">
            {[
              { v: 0.8, label: 'A为主' },
              { v: 0.6, label: 'A侧重' },
              { v: 0.5, label: '均衡' },
              { v: 0.4, label: 'B侧重' },
              { v: 0.2, label: 'B为主' },
            ].map((preset) => (
              <button
                key={preset.v}
                onClick={() => setFusionRatio(preset.v)}
                className={`text-xs px-2 py-1 rounded-md transition-all ${
                  Math.abs(fusionRatio - preset.v) < 0.03
                    ? 'bg-cinnabar/10 text-cinnabar font-medium'
                    : 'text-ink-400 hover:text-ink-600 hover:bg-ink-50'
                }`}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Variations */}
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-3">
          <Layers className="w-4 h-4 text-ink-500" />
          <p className="font-medium text-ink-700">生成数量</p>
          <span className="text-xs text-ink-400">每次融合生成的方案数</span>
        </div>
        <div className="flex gap-2">
          {[1, 3, 5].map((num) => (
            <button
              key={num}
              onClick={() => setResultVariations(num)}
              className={`px-4 py-2 rounded-lg border-2 transition-all ${
                resultVariations === num
                  ? 'border-cinnabar bg-cinnabar/5 text-cinnabar'
                  : 'border-transparent bg-rice-50 text-ink-600 hover:bg-rice-100'
              }`}
            >
              {num} 张
            </button>
          ))}
        </div>
      </div>

      {/* Method Process Detail */}
      <div className="p-4 bg-rice-50 rounded-xl">
        <div className="flex items-start gap-2">
          <Info className="w-4 h-4 text-cinnabar flex-shrink-0 mt-0.5" />
          <div className="flex-1">
            <p className="font-medium text-ink-700 text-sm mb-2">
              {selectedMethod.name} · 融合流程
            </p>
            <ol className="space-y-1">
              {selectedMethod.process.map((step, i) => (
                <li key={i} className="text-xs text-ink-600 flex items-start gap-2">
                  <span className="w-4 h-4 rounded-full bg-cinnabar/20 text-cinnabar flex-shrink-0 flex items-center justify-center text-xs font-bold">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );

  const renderAnalysisPanel = (result: FuseResult) => (
    <div className="bg-rice-50 rounded-2xl p-6 shadow-card mt-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-serif text-lg font-bold text-ink-900 flex items-center gap-2">
          <Target className="w-5 h-5 text-cinnabar" />
          融合分析报告
        </h3>
        <button
          onClick={() => setShowAnalysis(!showAnalysis)}
          aria-label={showAnalysis ? '收起分析报告' : '展开分析报告'}
          className="text-sm text-ink-500 hover:text-cinnabar flex items-center gap-1"
        >
          {showAnalysis ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          {showAnalysis ? '收起' : '展开'}
        </button>
      </div>

      {showAnalysis && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Extracted Elements */}
          <div className="space-y-4">
            <div className="p-4 bg-rice-50 rounded-xl">
              <p className="font-medium text-ink-700 text-sm mb-3 flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-cinnabar" />
                提取元素 · 作品A
              </p>
              <ul className="space-y-2">
                {result.analysis.extractedElementsA.map((el, i) => (
                  <li key={i} className="text-xs text-ink-600 flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cinnabar/40 mt-1.5 flex-shrink-0" />
                    {el}
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-4 bg-rice-50 rounded-xl">
              <p className="font-medium text-ink-700 text-sm mb-3 flex items-center gap-2">
                <Bookmark className="w-4 h-4 text-cinnabar" />
                提取元素 · 作品B
              </p>
              <ul className="space-y-2">
                {result.analysis.extractedElementsB.map((el, i) => (
                  <li key={i} className="text-xs text-ink-600 flex items-start gap-2">
                    <span className="w-1.5 h-1.5 rounded-full bg-cinnabar/40 mt-1.5 flex-shrink-0" />
                    {el}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Fusion Highlights */}
          <div className="space-y-4">
            <div className="p-4 bg-gradient-to-br from-cinnabar/5 to-transparent rounded-xl">
              <p className="font-medium text-ink-700 text-sm mb-3 flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-cinnabar" />
                融合亮点
              </p>
              <ul className="space-y-2">
                {result.analysis.fusionHighlights.map((h, i) => (
                  <li key={i} className="text-xs text-ink-600 flex items-start gap-2">
                    <Check className="w-4 h-4 text-cinnabar flex-shrink-0" />
                    {h}
                  </li>
                ))}
              </ul>
            </div>
            <div className="p-4 bg-rice-50 rounded-xl">
              <p className="font-medium text-ink-700 text-sm mb-2 flex items-center gap-2">
                <Lightbulb className="w-4 h-4 text-cinnabar" />
                创意价值
              </p>
              <p className="text-xs text-ink-600 leading-relaxed">
                {result.analysis.creativeValue}
              </p>
            </div>
          </div>

          {/* Metrics */}
          <div className="space-y-4">
            {[
              { label: '风格兼容性', value: result.analysis.styleCompatibility, icon: Palette },
              { label: '主题一致性', value: result.analysis.themeConsistency, icon: Target },
              { label: '创新指数', value: result.analysis.innovationScore, icon: TrendingUp },
            ].map((metric) => (
              <div key={metric.label} className="p-4 bg-rice-50 rounded-xl">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-sm text-ink-700 flex items-center gap-2">
                    <metric.icon className="w-4 h-4 text-cinnabar" />
                    {metric.label}
                  </p>
                  <span className="font-bold text-cinnabar">{metric.value}%</span>
                </div>
                <div className="w-full h-2 bg-ink-200 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-1000"
                    style={{
                      width: `${metric.value}%`,
                      background: `linear-gradient(90deg, ${result.style.color}, #c41e3a)`,
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-rice-200 ink-texture pt-20 pb-20">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-ink-900/5 rounded-full mb-4">
            <Heart className="w-4 h-4 text-cinnabar" />
            <span className="text-sm text-ink-600">灵感嫁接</span>
          </div>
          <h1 className="font-serif text-3xl md:text-5xl font-bold text-ink-900 mb-4">
            创意融合 · 1+1&gt;2
          </h1>
          <p className="text-ink-600 max-w-2xl mx-auto text-lg">
            选择两件作品，设定融合标准，AI 将提取各自创意元素进行嫁接
            <br />
            <span className="text-sm text-ink-500">
              16种嫁接风格 · 9种融合方法 · 4级融合强度 · 作品配比可调 · 576种创意组合
            </span>
          </p>
        </div>

        {/* Settings Toggle */}
        <div className="flex justify-center mb-6">
          <button
            onClick={() => setShowSettings(!showSettings)}
            aria-label="融合标准设置"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-white rounded-full shadow-card hover:shadow-card-hover transition-all"
          >
            <Settings2 className="w-4 h-4 text-cinnabar" />
            <span className="font-medium text-ink-700">
              {showSettings ? '收起标准设置' : '融合标准设置'}
            </span>
            <span className="px-2 py-0.5 bg-cinnabar/10 text-cinnabar text-xs rounded-full">
              {selectedStyle.name} + {selectedMethod.name}
            </span>
            <ChevronRight className={`w-4 h-4 text-ink-400 transition-transform ${showSettings ? 'rotate-90' : ''}`} />
          </button>
        </div>

        {/* Settings Panel */}
        {showSettings && renderSettingsPanel()}

        {/* Upload Two Sketches */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
          {renderUploadBox(1, artwork1, customImage1, '主体作品')}
          {renderUploadBox(2, artwork2, customImage2, '嫁接元素')}
        </div>

        {/* Fusion Formula */}
        <div className="bg-rice-50 rounded-2xl p-6 shadow-card mb-8">
          <div className="flex flex-col md:flex-row items-center justify-center gap-4 md:gap-6">
            <div className="flex items-center gap-3">
              <div className="w-16 h-16 bg-rice-100 rounded-xl flex items-center justify-center overflow-hidden shadow-sm">
                {image1 ? (
                  <img
                    src={image1}
                    alt="作品1"
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-ink-300" />
                )}
              </div>
              <div>
                <span className="text-ink-400 text-sm">作品A</span>
                {artwork1 && (
                  <p className="text-xs text-ink-500 truncate max-w-[100px]">{artwork1.title}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-cinnabar/10 rounded-full flex items-center justify-center">
                <Plus className="w-4 h-4 text-cinnabar" />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="w-16 h-16 bg-rice-100 rounded-xl flex items-center justify-center overflow-hidden shadow-sm">
                {image2 ? (
                  <img
                    src={image2}
                    alt="作品2"
                    loading="lazy"
                    className="w-full h-full object-cover"
                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                  />
                ) : (
                  <ImageIcon className="w-6 h-6 text-ink-300" />
                )}
              </div>
              <div>
                <span className="text-ink-400 text-sm">作品B</span>
                {artwork2 && (
                  <p className="text-xs text-ink-500 truncate max-w-[100px]">{artwork2.title}</p>
                )}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <ArrowRight className="w-6 h-6 text-cinnabar" />
            </div>

            <div className="flex items-center gap-3">
              <div
                className="w-16 h-16 rounded-xl flex items-center justify-center shadow-lg"
                style={{ backgroundColor: selectedStyle.color }}
              >
                <Sparkles className="w-6 h-6 text-white" />
              </div>
              <div>
                <p className="font-medium text-ink-700 text-sm">{selectedStyle.name}</p>
                <p className="text-xs text-ink-400">{selectedMethod.name} · {selectedIntensity.name}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Fuse Button */}
        {image1 && image2 && results.length === 0 && !fusing && (
          <div className="text-center mb-8">
            <button
              onClick={handleFuse}
              disabled={fusing}
              aria-label="开始灵感嫁接"
              className="inline-flex items-center gap-3 px-12 py-4 bg-gradient-to-r from-cinnabar to-stone text-white rounded-xl hover:opacity-90 transition-all disabled:opacity-50 transform hover:scale-105 shadow-card"
            >
              <Sparkles className="w-6 h-6" />
              <span className="font-serif text-lg">开始灵感嫁接</span>
            </button>
          </div>
        )}

        {/* Process Animation(逐张上屏:已完成的方案会实时出现在下方成果区) */}
        {fusing && (
          <div className="mb-8">
            <GenerationLoading
              title="AI 正在嫁接创意"
              subtitle={`以「${selectedStyle.name}」风格,通过「${selectedMethod.name}」方法融合 · 每张完成即刻上屏`}
              color={selectedStyle.color}
              estimatedSeconds={75}
              completedCount={fuseCompleted}
              totalCount={resultVariations}
            />
          </div>
        )}

        {/* 融合失败:明确错误原因 + 重试(不再静默回退占位图) */}
        {fuseError && !fusing && (
          <div className="mb-8 bg-rice-50 rounded-2xl p-8 shadow-card text-center">
            <div className="w-14 h-14 mx-auto mb-4 rounded-full bg-cinnabar/10 flex items-center justify-center">
              <Zap className="w-7 h-7 text-cinnabar" />
            </div>
            <h3 className="font-serif text-xl font-semibold text-ink-900 mb-2">
              {fuseError.reason === 'disabled'
                ? 'AI 生成功能暂未开放'
                : fuseError.reason === 'timeout'
                ? '生成超时'
                : fuseError.reason === 'quota'
                ? '请求过于频繁'
                : '融合失败'}
            </h3>
            <p className="text-sm text-ink-500 mb-6 max-w-md mx-auto">{fuseError.message}</p>
            <button
              onClick={handleFuse}
              aria-label="重试融合"
              className="inline-flex items-center gap-2 px-6 py-2.5 bg-cinnabar hover:bg-cinnabar-dark text-white rounded-lg transition-colors font-medium"
            >
              <RefreshCw className="w-4 h-4" />
              重试融合
            </button>
          </div>
        )}

        {/* Results */}
        {results.length > 0 && (
          <div className="bg-rice-50 rounded-2xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-4">
              <h2 className="font-serif text-xl font-bold text-ink-900 flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-cinnabar" />
                嫁接成果
              </h2>
              <div className="flex items-center gap-2 flex-wrap">
                <span
                  className="px-3 py-1 text-xs rounded-full text-white"
                  style={{ backgroundColor: results[selectedResultIndex].style.color }}
                >
                  {results[selectedResultIndex].style.name}
                </span>
                <span className="px-3 py-1 text-xs rounded-full bg-rice-100 text-ink-600">
                  {results[selectedResultIndex].method.name}
                </span>
                <span className="px-3 py-1 text-xs rounded-full bg-rice-100 text-ink-600">
                  {results[selectedResultIndex].intensity.name}
                </span>
                <button
                  onClick={() => setWorkshopOpen(true)}
                  aria-label="打开结果工作台"
                  className="flex items-center gap-2 px-4 py-2 bg-ink-900 text-rice-100 rounded-lg hover:bg-cinnabar transition-all"
                  title="对比 · 收藏 · 分享 · 微调重生成"
                >
                  <Columns2 className="w-4 h-4" />
                  <span className="text-sm font-medium">结果工作台</span>
                </button>
                <button
                  onClick={handleDownload}
                  aria-label="下载"
                  className="flex items-center gap-2 px-4 py-2 bg-ink-900 text-rice-100 rounded-lg hover:bg-cinnabar transition-all ml-2"
                >
                  <Download className="w-4 h-4" />
                  <span className="text-sm font-medium">下载</span>
                </button>
                <button
                  onClick={handleSaveToMaterials}
                  aria-label="保存到素材库"
                  className="flex items-center gap-2 px-4 py-2 border-2 border-cinnabar/40 text-cinnabar rounded-lg hover:bg-cinnabar hover:text-white transition-all"
                  title="保存到素材库"
                >
                  <Bookmark className="w-4 h-4" />
                  <span className="text-sm font-medium">保存到素材库</span>
                </button>
                <button
                  onClick={handleFuse}
                  disabled={fusing}
                  aria-label="重新生成"
                  className="flex items-center gap-2 px-4 py-2 border-2 border-ink-200 text-ink-700 rounded-lg hover:border-cinnabar hover:text-cinnabar transition-all"
                >
                  <RefreshCw className={`w-4 h-4 ${fusing ? 'animate-spin' : ''}`} />
                  <span className="text-sm font-medium">重新生成</span>
                </button>
              </div>
            </div>

            {/* Main Result */}
            <div className="bg-ink-900 rounded-xl overflow-hidden flex items-center justify-center min-h-[400px]">
              <img
                src={results[selectedResultIndex].url}
                alt="融合结果"
                loading="lazy"
                className="w-full max-h-[600px] object-contain"
              />
            </div>

            {/* Variations Thumbnails */}
            {results.length > 1 && (
              <div className="mt-4">
                <p className="text-sm text-ink-500 mb-2">其他方案</p>
                <div className="flex gap-3 overflow-x-auto pb-2">
                  {results.map((result, i) => (
                    <button
                      key={result.id}
                      onClick={() => setSelectedResultIndex(i)}
                      aria-label={`查看方案 ${i + 1}`}
                      className={`flex-shrink-0 w-24 h-24 rounded-lg overflow-hidden border-2 transition-all ${
                        selectedResultIndex === i
                          ? 'border-cinnabar ring-2 ring-cinnabar/30'
                          : 'border-transparent hover:border-ink-300'
                      }`}
                    >
                      <img
                        src={result.url}
                        alt={`方案 ${i + 1}`}
                        loading="lazy"
                        className="w-full h-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Analysis Panel */}
            {renderAnalysisPanel(results[selectedResultIndex])}

            <div className="mt-6 flex justify-center gap-4 flex-wrap">
              <button
                onClick={handleFuse}
                disabled={fusing}
                aria-label="换一批"
                className="inline-flex items-center gap-2 px-6 py-2.5 border-2 border-ink-200 text-ink-700 rounded-lg hover:border-cinnabar hover:text-cinnabar transition-all"
              >
                <Shuffle className="w-4 h-4" />
                <span className="text-sm font-medium">换一批</span>
              </button>
              <button
                onClick={() => setResults([])}
                aria-label="保存到收藏"
                className="inline-flex items-center gap-2 px-6 py-2.5 border-2 border-ink-200 text-ink-700 rounded-lg hover:border-cinnabar hover:text-cinnabar transition-all"
              >
                <Save className="w-4 h-4" />
                <span className="text-sm font-medium">保存到收藏</span>
              </button>
            </div>
          </div>
        )}

        {/* Empty State */}
        {!image1 && !image2 && results.length === 0 && !fusing && (
          <div className="bg-rice-50 rounded-2xl shadow-card">
            <EmptyState
              icon={Sparkles}
              title="选择两张作品开始融合"
              desc="从素材库或历史记录中选择图片"
            />
          </div>
        )}

        {/* 结果工作台:对比 / 收藏 / 分享 / 微调重生成 */}
        <ResultWorkshop
          open={workshopOpen}
          onClose={() => setWorkshopOpen(false)}
          items={workshopItems}
          initialIndex={selectedResultIndex}
          accentColor={selectedStyle.color}
          onSave={handleSaveWorkshopItem}
          onRegenerate={handleFuse}
          tweakPanel={
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-rice-100 rounded-xl p-4">
                <div className="flex justify-between mb-2 text-sm">
                  <span className="font-medium text-cinnabar">作品A {Math.round(fusionRatio * 100)}%</span>
                  <span className="font-medium text-ink-600">作品B {100 - Math.round(fusionRatio * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="90"
                  step="5"
                  value={Math.round(fusionRatio * 100)}
                  onChange={(e) => setFusionRatio(parseInt(e.target.value, 10) / 100)}
                  aria-label="微调作品配比"
                  className="w-full h-2 rounded-full appearance-none cursor-pointer"
                  style={{
                    background: `linear-gradient(to right, #c53030 0%, #c53030 ${fusionRatio * 100}%, #8a8f98 ${fusionRatio * 100}%, #8a8f98 100%)`,
                  }}
                />
              </div>
              <div className="bg-rice-100 rounded-xl p-4">
                <p className="text-sm font-medium text-ink-700 mb-2">融合强度</p>
                <div className="flex gap-2">
                  {fuseIntensities.map((it) => (
                    <button
                      key={it.id}
                      onClick={() => setSelectedIntensity(it)}
                      aria-label={it.name}
                      className={`flex-1 px-2 py-1.5 text-xs rounded-lg border-2 transition-all ${
                        selectedIntensity.id === it.id
                          ? 'border-cinnabar bg-cinnabar/5 text-cinnabar font-medium'
                          : 'border-transparent bg-rice-50 text-ink-600 hover:bg-rice-200'
                      }`}
                    >
                      {it.name}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          }
        />

        {/* Artwork Picker Modal */}
        {showArtworkPicker && (
          <div
            className="fixed inset-0 bg-ink-900/60 backdrop-blur-sm z-50 flex items-center justify-center p-4"
            onClick={() => setShowArtworkPicker(null)}
          >
            <div
              className="bg-rice-50 rounded-2xl overflow-hidden max-w-5xl w-full max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-ink-100 flex items-center justify-between">
                <h3 className="font-serif text-lg font-bold text-ink-900">
                  从素材库选择作品 {showArtworkPicker}
                </h3>
                <button
                  onClick={() => setShowArtworkPicker(null)}
                  aria-label="关闭"
                  className="p-2 hover:bg-rice-100 rounded-full transition-all"
                >
                  <X className="w-5 h-5 text-ink-700" />
                </button>
              </div>
              <div className="p-4 border-b border-ink-100 space-y-3">
                <div className="relative">
                  <input
                    type="text"
                    value={pickerSearch}
                    onChange={(e) => setPickerSearch(e.target.value)}
                    placeholder="搜索作品名称、画家、标签..."
                    className="w-full px-4 py-2 pl-10 border border-ink-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-cinnabar/30 focus:border-cinnabar"
                  />
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                  </svg>
                </div>
                {/* 来源切换:内置素材库 / 我的保存 / 我的素材包 */}
                <div className="flex gap-2">
                  {([
                    { id: 'builtin', name: '内置素材库' },
                    { id: 'saved', name: `我的保存${savedMaterials.length > 0 ? ` (${savedMaterials.length})` : ''}` },
                    { id: 'packs', name: `我的素材包${pickerPacks.length > 0 ? ` (${pickerPacks.length})` : ''}` },
                  ] as const).map((src) => (
                    <button
                      key={src.id}
                      onClick={() => { setPickerSource(src.id); setActivePickerPack(null); }}
                      className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${
                        pickerSource === src.id
                          ? 'bg-ink-900 text-rice-100'
                          : 'bg-rice-100 text-ink-600 hover:bg-rice-200'
                      }`}
                    >
                      {src.name}
                    </button>
                  ))}
                </div>
                {/* 分类筛选仅对内置素材库有效 */}
                {pickerSource === 'builtin' && (
                  <div className="flex gap-2 flex-wrap">
                    {['all', 'painting', 'design', 'product', 'sculpture', 'heritage'].map((cat) => (
                      <button
                        key={cat}
                        onClick={() => setPickerCategory(cat)}
                        className={`px-3 py-1 text-sm rounded-full transition-all ${
                          pickerCategory === cat
                            ? cat === 'heritage'
                              ? 'bg-gold-dark text-white'
                              : 'bg-cinnabar text-white'
                            : 'bg-rice-100 text-ink-600 hover:bg-rice-200'
                        }`}
                      >
                        {cat === 'all' ? '全部' : cat === 'painting' ? '绘画' : cat === 'design' ? '设计' : cat === 'product' ? '产品' : cat === 'sculpture' ? '雕塑' : '非遗'}
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto p-4">
                {pickerSource === 'builtin' ? (
                  pickerCategory === 'heritage' ? (
                    /* ---------- 非遗素材库(Task 20:剪纸/刺绣/瓷器优先) ---------- */
                    isLoadingHeritage ? (
                      <div className="flex flex-col items-center justify-center py-12">
                        <Loader2 className="w-8 h-8 text-gold-dark animate-spin mb-2" />
                        <p className="text-sm text-ink-500">正在加载非遗素材库...</p>
                      </div>
                    ) : filteredHeritageWorks.length === 0 ? (
                      <div className="text-center py-12">
                        <p className="text-sm text-ink-500">未找到匹配的非遗作品</p>
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                        {filteredHeritageWorks.map((hw) => (
                          <button
                            key={hw.id}
                            onClick={() => handleArtworkSelect(heritageToArtworkItem(hw), showArtworkPicker)}
                            aria-label={hw.title}
                            className="bg-rice-50 rounded-lg overflow-hidden hover:ring-2 hover:ring-gold-dark transition-all text-left group border border-gold/20"
                          >
                            <div className="aspect-[4/3] overflow-hidden bg-gradient-to-br from-gold/15 to-rice-100">
                              <img
                                src={resolveArtworkThumbUrl(heritageToArtworkItem(hw))}
                                alt={hw.title}
                                className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                loading="lazy"
                              />
                            </div>
                            <div className="p-2">
                              <p className="text-sm font-medium text-ink-900 truncate">{hw.title}</p>
                              <p className="text-xs text-ink-500 truncate">{hw.origin}</p>
                              <p className="text-xs text-gold-dark truncate">{HERITAGE_CATEGORY_LABEL[hw.category]} · {hw.dynasty}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                    )
                  ) : (
                  /* ---------- 内置素材库 ---------- */
                  isLoadingArtworks ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 text-cinnabar animate-spin mb-2" />
                      <p className="text-sm text-ink-500">正在加载素材库...</p>
                    </div>
                  ) : filteredArtworks.length === 0 ? (
                    <div className="text-center py-12">
                      <p className="text-sm text-ink-500">未找到匹配作品</p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {filteredArtworks.map((artwork) => (
                      <button
                        key={artwork.id}
                        onClick={() => handleArtworkSelect(artwork, showArtworkPicker)}
                        aria-label={artwork.title}
                        className="bg-rice-50 rounded-lg overflow-hidden hover:ring-2 hover:ring-cinnabar transition-all text-left group"
                      >
                        <div className="aspect-[4/3] overflow-hidden bg-ink-100">
                          <img
                            src={resolveArtworkThumbUrl(artwork)}
                            alt={artwork.title}
                            className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                            loading="lazy"
                          />
                        </div>
                        <div className="p-2">
                          <p className="text-sm font-medium text-ink-900 truncate">{artwork.title}</p>
                          <p className="text-xs text-ink-500 truncate">{artwork.artist}</p>
                          <p className="text-xs text-cinnabar/70 truncate">{artwork.style} · {artwork.era}</p>
                        </div>
                      </button>
                      ))}
                    </div>
                  )
                  )
                ) : pickerSource === 'saved' ? (
                  /* ---------- 我的保存(情绪画布/灵感嫁接生成存档) ---------- */
                  isLoadingPickerExtra ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 text-cinnabar animate-spin mb-2" />
                      <p className="text-sm text-ink-500">正在加载我的保存...</p>
                    </div>
                  ) : filteredSavedMaterials.length === 0 ? (
                    <div className="text-center py-12">
                      <Bookmark className="w-10 h-10 text-ink-300 mx-auto mb-3" />
                      <p className="text-sm text-ink-500">
                        {savedMaterials.length === 0
                          ? '暂无保存的素材 — 情绪画布/灵感嫁接生成的作品会自动存档到这里'
                          : '未找到匹配素材'}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                      {filteredSavedMaterials.map((material) => (
                        <button
                          key={material.id}
                          onClick={() => handleCustomMaterialSelect(material.imageUrl, material.title, showArtworkPicker)}
                          aria-label={material.title}
                          className="bg-rice-50 rounded-lg overflow-hidden hover:ring-2 hover:ring-cinnabar transition-all text-left group"
                        >
                          <div className="aspect-[4/3] overflow-hidden bg-ink-100">
                            <img
                              src={material.imageUrl}
                              alt={material.title}
                              className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                              loading="lazy"
                              onError={(e) => { e.currentTarget.style.display = 'none'; }}
                            />
                          </div>
                          <div className="p-2">
                            <p className="text-sm font-medium text-ink-900 truncate">{material.title}</p>
                            <p className="text-xs text-cinnabar/70 truncate">
                              {material.source === 'fuse' ? '灵感嫁接' : material.source === 'emotion' ? '情绪画布' : '素材库'}
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )
                ) : (
                  /* ---------- 我的素材包 ---------- */
                  isLoadingPickerExtra ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <Loader2 className="w-8 h-8 text-cinnabar animate-spin mb-2" />
                      <p className="text-sm text-ink-500">正在加载素材包...</p>
                    </div>
                  ) : activePickerPack ? (
                    /* 包内素材视图 */
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <button
                          onClick={() => { setActivePickerPack(null); setPickerPackMaterials([]); }}
                          aria-label="返回素材包列表"
                          className="flex items-center gap-1 text-sm text-ink-600 hover:text-cinnabar transition-all"
                        >
                          <ChevronLeft className="w-4 h-4" />
                          返回素材包列表
                        </button>
                        <span className="text-sm font-medium text-ink-900">
                          「{activePickerPack.name}」
                        </span>
                        <span className="text-xs text-ink-400">{pickerPackMaterials.length} 件</span>
                      </div>
                      {pickerPackMaterials.length === 0 ? (
                        <div className="text-center py-12">
                          <p className="text-sm text-ink-500">包内暂无素材</p>
                        </div>
                      ) : (
                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-3">
                          {pickerPackMaterials.map((material) => (
                            <button
                              key={material.id}
                              onClick={() => handleUnifiedMaterialSelect(material, showArtworkPicker)}
                              aria-label={material.title}
                              className="bg-rice-50 rounded-lg overflow-hidden hover:ring-2 hover:ring-cinnabar transition-all text-left group"
                            >
                              <div className="aspect-[4/3] overflow-hidden bg-ink-100">
                                <img
                                  src={material.imageUrl}
                                  alt={material.title}
                                  className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
                                  loading="lazy"
                                  onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                />
                              </div>
                              <div className="p-2">
                                <p className="text-sm font-medium text-ink-900 truncate">{material.title}</p>
                                <p className="text-xs text-ink-500 truncate">{material.subtitle}</p>
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : filteredPickerPacks.length === 0 ? (
                    <div className="text-center py-12">
                      <Package className="w-10 h-10 text-ink-300 mx-auto mb-3" />
                      <p className="text-sm text-ink-500">
                        {pickerPacks.length === 0
                          ? '暂无素材包 — 可前往素材库页面创建素材包'
                          : '未找到匹配素材包'}
                      </p>
                    </div>
                  ) : (
                    /* 素材包列表视图 */
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {filteredPickerPacks.map((pack) => (
                        <button
                          key={pack.id}
                          onClick={() => handleOpenPickerPack(pack)}
                          aria-label={`打开素材包 ${pack.name}`}
                          className="bg-rice-50 rounded-lg p-4 hover:ring-2 hover:ring-cinnabar transition-all text-left group"
                        >
                          <div className="flex items-center gap-2 mb-2">
                            <Package className="w-5 h-5 text-cinnabar" />
                            <p className="font-medium text-ink-900 truncate group-hover:text-cinnabar transition-colors">
                              {pack.name}
                            </p>
                          </div>
                          {pack.description && (
                            <p className="text-xs text-ink-500 line-clamp-2 mb-2">{pack.description}</p>
                          )}
                          <p className="text-xs text-ink-400">{pack.materialIds.length} 件素材</p>
                        </button>
                      ))}
                    </div>
                  )
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
