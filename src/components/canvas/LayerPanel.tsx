// ============================================================
// 丹青有AI - 图层面板(P0 基础图层)
// 新建/删除/重命名(双击)/显隐/上下排序/不透明度
// 列表顶部 = 图层栈顶层(layers 数组末尾)
// ============================================================

import { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2, ChevronUp, ChevronDown, Layers } from 'lucide-react';
import type { Layer } from './useCanvasLayers';

export interface LayerPanelProps {
  layers: Layer[];
  activeLayerId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRemove: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onToggleVisible: (id: string) => void;
  onOpacityChange: (id: string, opacity: number) => void;
  onMove: (id: string, dir: 1 | -1) => void;
}

export default function LayerPanel(props: LayerPanelProps) {
  const {
    layers, activeLayerId,
    onSelect, onAdd, onRemove, onRename, onToggleVisible, onOpacityChange, onMove,
  } = props;

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const commitRename = (id: string) => {
    onRename(id, editingName);
    setEditingId(null);
  };

  /* 显示顺序:顶层在前(layers 数组末尾 = 最顶层) */
  const displayLayers = [...layers].reverse();

  return (
    <div className="w-60 flex-shrink-0 bg-rice-50 border-l border-ink-900/5 flex flex-col">
      {/* 头部 */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b border-ink-900/5">
        <div className="flex items-center gap-1.5">
          <Layers className="w-4 h-4 text-cinnabar" />
          <span className="text-sm font-medium text-ink-800">图层</span>
          <span className="text-xs text-ink-400">{layers.length}</span>
        </div>
        <button
          onClick={onAdd}
          className="p-1.5 rounded-md text-ink-500 hover:bg-cinnabar/10 hover:text-cinnabar transition-all"
          title="新建图层"
          aria-label="新建图层"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* 图层列表 */}
      <div className="flex-1 overflow-y-auto scrollbar-thin p-2 space-y-1">
        {displayLayers.map((layer) => {
          const isActive = layer.id === activeLayerId;
          const isEditing = editingId === layer.id;
          return (
            <div
              key={layer.id}
              onClick={() => onSelect(layer.id)}
              className={`rounded-lg border p-2 cursor-pointer transition-all ${
                isActive
                  ? 'border-cinnabar bg-cinnabar/5 shadow-sm'
                  : 'border-transparent bg-white hover:border-ink-200'
              }`}
            >
              <div className="flex items-center gap-1.5">
                {/* 显隐 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleVisible(layer.id);
                  }}
                  className={`p-1 rounded transition-all ${
                    layer.visible ? 'text-ink-600 hover:text-ink-800' : 'text-ink-300 hover:text-ink-500'
                  }`}
                  title={layer.visible ? '隐藏图层' : '显示图层'}
                  aria-label={layer.visible ? '隐藏图层' : '显示图层'}
                >
                  {layer.visible ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                </button>

                {/* 名称(双击重命名) */}
                {isEditing ? (
                  <input
                    autoFocus
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onBlur={() => commitRename(layer.id)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(layer.id);
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="flex-1 min-w-0 px-1 py-0.5 text-xs border border-cinnabar rounded outline-none"
                    aria-label="图层名称"
                  />
                ) : (
                  <span
                    className="flex-1 min-w-0 text-xs text-ink-700 truncate select-none"
                    title="双击重命名"
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setEditingId(layer.id);
                      setEditingName(layer.name);
                    }}
                  >
                    {layer.name}
                    <span className="text-ink-300 ml-1">({layer.strokes.length})</span>
                  </span>
                )}

                {/* 排序 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove(layer.id, 1);
                  }}
                  className="p-1 rounded text-ink-400 hover:text-ink-700 transition-all"
                  title="上移图层"
                  aria-label="上移图层"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onMove(layer.id, -1);
                  }}
                  className="p-1 rounded text-ink-400 hover:text-ink-700 transition-all"
                  title="下移图层"
                  aria-label="下移图层"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {/* 删除 */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove(layer.id);
                  }}
                  disabled={layers.length <= 1}
                  className="p-1 rounded text-ink-400 hover:text-cinnabar disabled:opacity-30 transition-all"
                  title={layers.length <= 1 ? '至少保留一个图层' : '删除图层'}
                  aria-label="删除图层"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>

              {/* 不透明度(仅激活层展开) */}
              {isActive && (
                <div className="flex items-center gap-2 mt-2 px-1" onClick={(e) => e.stopPropagation()}>
                  <span className="text-[10px] text-ink-400 whitespace-nowrap">不透明</span>
                  <input
                    type="range"
                    min="0.05"
                    max="1"
                    step="0.05"
                    value={layer.opacity}
                    onChange={(e) => onOpacityChange(layer.id, parseFloat(e.target.value))}
                    className="flex-1 h-1 accent-cinnabar cursor-pointer"
                    aria-label="图层不透明度"
                  />
                  <span className="text-[10px] text-ink-400 font-mono w-7 text-right">
                    {Math.round(layer.opacity * 100)}%
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 底部提示 */}
      <div className="px-3 py-2 border-t border-ink-900/5">
        <p className="text-[10px] text-ink-400 leading-relaxed">
          点击切换活动图层 · 双击名称重命名
          <br />
          撤销/重做作用于当前活动图层
        </p>
      </div>
    </div>
  );
}
