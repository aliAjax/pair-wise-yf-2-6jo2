import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { MapPin, List, Trophy, Plus, TreeDeciduous, GitMerge, Upload, Eye, ShieldCheck } from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import ExportButton from '@/components/Handoff/ExportButton';
import ImportDialog from '@/components/Handoff/ImportDialog';

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [showImport, setShowImport] = useState(false);
  const role = useBenchStore((s) => s.role);
  const setRole = useBenchStore((s) => s.setRole);
  const pendingCount = useBenchStore((s) => s.pendingImports.length);

  const navItems = [
    { path: '/', icon: List, label: '列表' },
    { path: '/map', icon: MapPin, label: '地图' },
    { path: '/ranking', icon: Trophy, label: '排行' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const toggleRole = () => {
    setRole(role === 'inspector' ? 'viewer' : 'inspector');
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
                className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  isActive(item.path)
                    ? 'bg-moss-green text-white shadow-md'
                    : 'text-ink-light hover:bg-deep-brown/5 hover:text-deep-brown'
                }`}
              >
                <item.icon className="w-4 h-4" />
                <span className="hidden sm:inline">{item.label}</span>
              </button>
            ))}

            {role === 'inspector' && (
              <button
                onClick={() => navigate('/review')}
                className={`relative flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                  location.pathname === '/review'
                    ? 'bg-moss-green text-white shadow-md'
                    : 'text-ink-light hover:bg-deep-brown/5 hover:text-deep-brown'
                }`}
                title="待核对：双方都修改过的字段"
              >
                <GitMerge className="w-4 h-4" />
                <span className="hidden sm:inline">待核对</span>
                {pendingCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-ochre text-white text-xs rounded-full flex items-center justify-center">
                    {pendingCount}
                  </span>
                )}
              </button>
            )}
          </nav>

          <div className="flex items-center gap-1">
            {role === 'inspector' && (
              <>
                <button
                  onClick={() => setShowImport(true)}
                  title="导入交接文件"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm text-ink-light hover:bg-deep-brown/5 hover:text-deep-brown rounded-lg transition-colors"
                >
                  <Upload className="w-4 h-4" />
                  <span className="hidden sm:inline">导入</span>
                </button>
                <ExportButton />
              </>
            )}

            <button
              onClick={toggleRole}
              title={role === 'inspector' ? '当前：巡查员（可见内部备注与核对），点击切换为普通浏览者' : '当前：普通浏览者（仅公开备注），点击切换为巡查员'}
              className="flex items-center gap-1.5 px-3 py-2 text-sm text-ink-light hover:bg-deep-brown/5 hover:text-deep-brown rounded-lg transition-colors"
            >
              {role === 'inspector' ? (
                <ShieldCheck className="w-4 h-4 text-moss-green" />
              ) : (
                <Eye className="w-4 h-4" />
              )}
              <span className="hidden sm:inline">{role === 'inspector' ? '巡查员' : '浏览者'}</span>
            </button>

            {role === 'inspector' && (
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

      {showImport && <ImportDialog onClose={() => setShowImport(false)} />}
    </header>
  );
}
