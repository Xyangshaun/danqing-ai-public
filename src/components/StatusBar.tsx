import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import {
  GitBranch, Cpu, Wifi, Activity, Check, Clock,
} from 'lucide-react';

const routeNames: Record<string, string> = {
  '/': '工作台',
  '/analyze': 'AI 诊断',
  '/materials': '素材库',
  '/styles': '风格库',
  '/fuse': '灵感嫁接',
  '/emotion': '情绪画布',
  '/history': '历史记录',
  '/growth': '成长曲线',
  '/settings': '设置',
};

export default function StatusBar() {
  const location = useLocation();
  const [time, setTime] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const moduleName = routeNames[location.pathname] || '未知模块';
  const timeStr = time.toLocaleTimeString('zh-CN', { hour12: false });

  return (
    <footer className="h-6 flex-shrink-0 bg-ink-900 text-rice-200 flex items-center justify-between px-3 text-2xs font-mono select-none">
      {/* 左：模块状态 */}
      <div className="flex items-center gap-3 min-w-0">
        <span className="flex items-center gap-1.5">
          <GitBranch className="w-3 h-3 text-cinnabar-light" />
          <span className="text-rice-300">main</span>
        </span>
        <span className="text-rice-500">|</span>
        <span className="flex items-center gap-1.5">
          <Check className="w-3 h-3 text-jade" />
          <span className="text-rice-300">{moduleName}</span>
        </span>
        <span className="text-rice-500">|</span>
        <span className="flex items-center gap-1.5 hidden sm:flex">
          <Activity className="w-3 h-3 text-gold-light" />
          <span className="text-rice-300">引擎就绪</span>
        </span>
      </div>

      {/* 右：系统状态 */}
      <div className="flex items-center gap-3">
        <span className="hidden md:flex items-center gap-1.5">
          <Cpu className="w-3 h-3 text-stone-light" />
          <span className="text-rice-300">本地+云端</span>
        </span>
        <span className="text-rice-500 hidden md:inline">|</span>
        <span className="flex items-center gap-1.5">
          <Wifi className="w-3 h-3 text-jade" />
          <span className="text-rice-300 hidden sm:inline">在线</span>
        </span>
        <span className="text-rice-500">|</span>
        <span className="flex items-center gap-1.5">
          <Clock className="w-3 h-3 text-rice-400" />
          <span className="text-rice-300">{timeStr}</span>
        </span>
      </div>
    </footer>
  );
}
