// ============================================================
// 丹青有AI - 跨域启发区块(参考图混合方案 Phase 3 批次④·灵感嫁接协同)
//
// 对应真源文档:docs/visual-annotation-feedback-upgrade-spec-2026-09.md §5.3
//
// 职责:引导模式(feedbackMode=guidance)分析结果反馈区尾部——
//   从 fusionAlgorithms 16 风格包中按分析类目挑 2 个风格,
//   每个风格配一句嫁接启发文案 + 跳转灵感嫁接页(/fuse?style=<id> 风格预填)。
// 仅 guidance 模式渲染(diagnosis=诊断纠错场景,不做发散引导);
//   feedbackMode 缺失(旧数据/无档案)=diagnosis 语义,不渲染。
// ============================================================

import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, ArrowRight } from 'lucide-react';

/** 启发风格条目(纯函数 pickInspirationStyles 产物,便于单测) */
export interface InspirationStyle {
  /** FuseStyle id(跳转 /fuse?style=<styleId> 预填) */
  styleId: string;
  /** 风格名(展示) */
  title: string;
  /** 一句嫁接启发文案(与该类目创作痛点关联) */
  copy: string;
}

/**
 * 按分析上下文挑选 2 个跨域启发风格
 *
 * 映射设计(类目 → 风格对,取自 fuseStandards 16 风格;exam 科目优先于 artType):
 *   - 素描:漆器髹光(明度层次)/宋代院体(结构严谨)
 *   - 色彩:敦煌矿彩(纯度勇气)/青花分水(少色阶多层次)
 *   - 速写:水墨写意(笔墨取舍)/木版年画(刀味线条概括)
 *   - 绘画(教学):水墨写意/宋代院体
 *   - 设计:新艺术运动(有机曲线)/极简主义(减法美学)
 *   - 产品:漆器髹光(材质语言)/新艺术运动(有机形态)
 *   - 雕塑:唐卡(造像度量)/民间剪纸(正负形镂空)
 *   - 非遗:苏绣针意(丝缕渐变)/木版年画(套色饱和)
 */
export function pickInspirationStyles(analysis: {
  diagnosisMode?: string;
  examSubject?: string | null;
  artType: string;
}): InspirationStyle[] {
  const { diagnosisMode, examSubject, artType } = analysis;

  if (diagnosisMode === 'exam') {
    switch (examSubject) {
      case 'color':
        return [
          { styleId: 'dunhuang', title: '敦煌矿彩', copy: '石绿与朱砂的矿物撞色,补上你在灰调里一直不敢用的那口纯度。' },
          { styleId: 'blue-white', title: '青花分水', copy: '仅靠钴蓝浓淡分出五色——一门"少色阶画多层次"的功课。' },
        ];
      case 'quickSketch':
        return [
          { styleId: 'ink', title: '水墨写意', copy: '一笔见浓淡,速写的线条就该有笔墨的取舍与肯定。' },
          { styleId: 'nianhua', title: '木版年画', copy: '刀味的线条不容修改,练就"下笔不悔"的概括力。' },
        ];
      // sketch(缺省科目)
      default:
        return [
          { styleId: 'lacquer', title: '漆器髹光', copy: '深邃温润的漆层示范了"暗部透气"——最重的黑也要有层次。' },
          { styleId: 'song-academy', title: '宋代院体', copy: '精工细笔的结构意识,每一根线都在为形体转折负责。' },
        ];
    }
  }

  switch (artType) {
    case 'design':
      return [
        { styleId: 'art-nouveau', title: '新艺术运动', copy: '流动的有机曲线与自然纹样,给功能主义一点生命感。' },
        { styleId: 'minimal', title: '极简主义', copy: '做减法——留下的每一块面都必须有存在的理由。' },
      ];
    case 'product':
      return [
        { styleId: 'lacquer', title: '漆器髹光', copy: '大漆的材质语言与手作温度,是量产时代最稀缺的质感。' },
        { styleId: 'art-nouveau', title: '新艺术运动', copy: '把有机形态嫁接进产品曲线,器物也可以生长。' },
      ];
    case 'sculpture':
      return [
        { styleId: 'thangka', title: '唐卡', copy: '度量经的造像比例,形体严谨性的千年范本。' },
        { styleId: 'papercut', title: '民间剪纸', copy: '镂空即正负形——用"剪掉"来定义"留下"。' },
      ];
    case 'heritage':
      return [
        { styleId: 'embroidery-su', title: '苏绣针意', copy: '丝缕的渐变与光泽,精细语言推到极致的样子。' },
        { styleId: 'nianhua', title: '木版年画', copy: '红黄绿的高饱和套色,民俗配色的大胆教科书。' },
      ];
    // painting(教学模式默认)
    default:
      return [
        { styleId: 'ink', title: '水墨写意', copy: '留白与墨韵,给写实画面一点呼吸感。' },
        { styleId: 'song-academy', title: '宋代院体', copy: '格物写生的观察方式,先看懂再落笔。' },
      ];
  }
}

interface CrossDomainInspirationProps {
  /** 反馈模式(仅 guidance 渲染;缺失=diagnosis 语义) */
  feedbackMode?: 'diagnosis' | 'guidance';
  /** 分析上下文(类目映射用;artType 顶层透传,exam 科目优先) */
  diagnosisMode?: string;
  examSubject?: string | null;
  artType: string;
}

export default function CrossDomainInspiration({
  feedbackMode,
  diagnosisMode,
  examSubject,
  artType,
}: CrossDomainInspirationProps) {
  const navigate = useNavigate();

  const styles = useMemo(
    () => pickInspirationStyles({ diagnosisMode, examSubject, artType }),
    [diagnosisMode, examSubject, artType],
  );

  // 仅引导模式渲染(诊断模式聚焦纠错,不做发散引导)
  if (feedbackMode !== 'guidance') return null;

  return (
    <div className="bg-gradient-to-br from-gold/10 via-rice-50 to-jade/5 rounded-2xl p-6 shadow-card border border-gold/20">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 bg-gold/15 rounded-lg flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-gold-dark" />
        </div>
        <div>
          <h3 className="font-serif text-lg font-bold text-ink-900">跨域启发</h3>
          <p className="text-xs text-ink-500">顺着你的风格,试试把这两个方向的画面语言嫁接进创作</p>
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-4">
        {styles.map((s) => (
          <button
            key={s.styleId}
            type="button"
            onClick={() => navigate(`/fuse?style=${encodeURIComponent(s.styleId)}`)}
            className="group text-left rounded-xl bg-white/70 border border-ink-900/10 hover:border-gold/50 hover:shadow-card transition-all p-4"
            title={`带「${s.title}」风格预填,进入灵感嫁接`}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <span className="font-serif font-bold text-sm text-ink-900">{s.title}</span>
              <ArrowRight className="w-3.5 h-3.5 text-gold-dark opacity-0 group-hover:opacity-100 transition-opacity ml-auto" />
            </div>
            <p className="text-xs leading-relaxed text-ink-600">{s.copy}</p>
          </button>
        ))}
      </div>
    </div>
  );
}
