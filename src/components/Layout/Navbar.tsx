import { useLocation, useNavigate } from 'react-router-dom';
import { MapPin, List, Trophy, Plus, TreeDeciduous, GitMerge, Eye, ShieldCheck } from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';

export default function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const db = useBenchStore((s) => s.db);

  const conflictCount = db?.conflicts.length ?? 0;
  const isViewer = db?.role === 'viewer';

  const navItems = [
    { path: '/', icon: List, label: '列表' },
    { path: '/map', icon: MapPin, label: '地图' },
    { path: '/ranking', icon: Trophy, label: '排行' },
    { path: '/sync', icon: GitMerge, label: '交接', badge: conflictCount },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  return (
    <header className="sticky top-0 z-50 bg-warm-beige/90 backdrop-blur-sm border-b border-deep-brown/10">
      <div className="container mx-auto px-4 py-3">
        <div className="flex items-center justify-between gap-2">
          <button
            onClick={() => navigate('/')}
            className="flex items-center gap-2 group"
          >
            <div className="w-10 h-10 rounded-xl bg-moss-green/10 flex items-center justify-center group-hover:bg-moss-green/20 transition-colors">
              <TreeDeciduous className="w-5 h-5 text-moss-green" />
            </div>
            <div>
              <h1 className="font-serif text-lg font-semibold text-deep-brown leading-tight">
                长椅观察
              </h1>
              <p className="text-xs text-ink-light">城市休憩档案</p>
            </div>
          </button>

          <nav className="flex items-center gap-1">
            {navItems.map((item) => (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive(item.path)
                    ? 'bg-moss-green text-white shadow-md'
                    : 'text-ink-light hover:bg-deep-brown/5 hover:text-deep-brown'
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
                {item.badge ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-ochre text-white text-[10px] font-bold flex items-center justify-center">
                    {item.badge}
                    <span className="sr-only">条待核对</span>
                  </span>
                ) : null}
              </button>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {/* 角色指示 */}
            <button
              onClick={() => navigate('/sync')}
              title={isViewer ? '浏览者：仅可见核对后的公开备注' : `巡查员：${db?.inspector ?? ''}`}
              className={`hidden md:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium ${
                isViewer
                  ? 'bg-ochre/10 text-ochre'
                  : 'bg-moss-green/10 text-moss-green'
              }`}
            >
              {isViewer ? <Eye className="w-3.5 h-3.5" /> : <ShieldCheck className="w-3.5 h-3.5" />}
              {isViewer ? '浏览者' : db?.inspector ?? '巡查员'}
            </button>

            {!isViewer && (
              <button
                onClick={() => navigate('/add')}
                className="flex items-center gap-1.5 px-4 py-2 bg-ochre text-white rounded-lg font-medium text-sm hover:bg-ochre-light transition-colors shadow-md hover:shadow-lg"
              >
                <Plus className="w-4 h-4" />
                <span className="hidden sm:inline">添加长椅</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </header>
  );
}
