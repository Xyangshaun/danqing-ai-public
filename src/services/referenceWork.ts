// ============================================================
// 丹青有AI - 标注参考作品解析(参考图混合方案 Phase 3 批次④)
//
// 职责:IssueMarkerReference.workId(master-work)与 KnowledgeCard.relatedWorks
//   的作品元数据解析——统一双库(后端 artworks.json 前端镜像 + 非遗 heritage-works.json)
//   检索,供标注卡缩略图/弹层关联作品列表消费。
//
// 双库均为模块级缓存(loadBuiltinArtworks/loadHeritageWorks 幂等),
// 首次调用 fetch,后续同步返回;workId 约定与后端 knowledge-card-match.service
//   getWorkMetaById 一致:heritage- 前缀走非遗库,其余走内置作品库。
// ============================================================

import { loadBuiltinArtworks, resolveArtworkThumbUrl } from './artworksDatabase';
import { loadHeritageWorks, resolveHeritageThumb } from './heritageDatabase';

/** 参考作品展示元数据 */
export interface ReferenceWorkMeta {
  /** 作品 ID(artworks.json / heritage-works.json 主键) */
  id: string;
  /** 作品标题 */
  title: string;
  /** 作者/产地(作品库 artist 或非遗库 origin·朝代) */
  attribution: string;
  /** 缩略图 URL(解析失败为 null,调用方渲染占位) */
  thumbUrl: string | null;
}

/**
 * 批量解析参考作品元数据(去重保持顺序;任一库加载失败时该库条目静默跳过)
 */
export async function resolveReferenceWorks(workIds: string[]): Promise<ReferenceWorkMeta[]> {
  if (workIds.length === 0) return [];

  const [artworks, heritageWorks] = await Promise.all([
    loadBuiltinArtworks(),
    loadHeritageWorks(),
  ]);

  const byId = new Map<string, ReferenceWorkMeta>();
  for (const id of workIds) {
    if (byId.has(id)) continue;
    if (id.startsWith('heritage-')) {
      const hw = heritageWorks.find((w) => w.id === id);
      if (hw) {
        byId.set(id, {
          id,
          title: hw.title,
          attribution: [hw.origin, hw.dynasty].filter(Boolean).join(' · '),
          thumbUrl: resolveHeritageThumb(hw),
        });
      }
      continue;
    }
    const art = artworks.find((a) => a.id === id);
    if (art) {
      byId.set(id, {
        id,
        title: art.title,
        attribution: [art.artist, art.year].filter(Boolean).join(' · '),
        thumbUrl: resolveArtworkThumbUrl(art),
      });
    }
  }
  return [...byId.values()];
}
