import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CheckCircle2, ShieldCheck, User, Wifi, Eye, Undo2 } from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import {
  fieldLabel,
  MATERIAL_LABELS,
  ORIENTATION_LABELS,
  SHADE_LABELS,
  NOISE_LABELS,
  STAY_DURATION_LABELS,
  TIME_PERIOD_LABELS,
} from '@/types';
import type { ConflictEntry, TimePeriodType } from '@/types';

type PickSide = 'local' | 'incoming' | 'custom';

const ENUM_MAPS: Record<string, Record<string, string>> = {
  material: MATERIAL_LABELS,
  orientation: ORIENTATION_LABELS,
  shadeLevel: SHADE_LABELS,
  noiseLevel: NOISE_LABELS,
  stayDuration: STAY_DURATION_LABELS,
};

function formatValue(path: string, value: unknown): string {
  if (value === undefined) return '（删除/不存在）';
  if (value === null || value === '') return '（空）';

  if (path.startsWith('experience:')) {
    const sub = path.split(':')[2];
    if (sub === 'timePeriod') return TIME_PERIOD_LABELS[value as TimePeriodType] ?? String(value);
    if (sub === 'rating') return `${value} 星`;
    if (!sub && typeof value === 'object') {
      const e = value as { timePeriod?: TimePeriodType; notes?: string; rating?: number };
      return `${e.timePeriod ? TIME_PERIOD_LABELS[e.timePeriod] : ''} ${e.rating ?? ''}星｜${e.notes ?? ''}`;
    }
    return String(value);
  }

  if (path === 'hasBackrest') return value ? '有靠背' : '无靠背';
  if (ENUM_MAPS[path]) return ENUM_MAPS[path][String(value)] ?? String(value);
  return String(value);
}

export default function ReviewPage() {
  const { benchId } = useParams<{ benchId: string }>();
  const navigate = useNavigate();
  const { db, initialize, initialized, getConflict, resolveConflict, dismissConflict } = useBenchStore();

  const conflict: ConflictEntry | undefined = benchId ? getConflict(benchId) : undefined;
  const bench = benchId ? db?.benches.find((b) => b.id === benchId) : undefined;

  const [choices, setChoices] = useState<Record<string, { pick: PickSide; custom?: unknown }>>({});
  const [publicNotes, setPublicNotes] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) initialize();
  }, [initialized, initialize]);

  // 默认建议：文本类取本机，枚举类取本机；巡查员可逐字段改选
  useEffect(() => {
    if (conflict) {
      const defaults: Record<string, { pick: PickSide }> = {};
      for (const path of Object.keys(conflict.fields)) {
        defaults[path] = { pick: 'local' };
      }
      setChoices(defaults);
      setPublicNotes(bench?.publicNotes ?? '');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conflict?.benchId]);

  const paths = useMemo(() => Object.keys(conflict?.fields ?? {}), [conflict]);

  if (!db || !initialized) {
    return (
      <div className="container mx-auto px-4 py-6">
        <p className="text-ink-light">加载中...</p>
      </div>
    );
  }

  // 浏览者无权核对
  if (db.role === 'viewer') {
    return (
      <div className="container mx-auto px-4 py-6 max-w-xl">
        <button
          onClick={() => navigate('/')}
          className="flex items-center gap-2 text-ink-light hover:text-deep-brown mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">返回列表</span>
        </button>
        <div className="paper-texture rounded-xl shadow-paper p-12 text-center">
          <Eye className="w-10 h-10 text-ochre/50 mx-auto mb-3" />
          <h3 className="font-serif text-lg font-medium text-deep-brown mb-2">仅巡查员可核对冲突</h3>
          <p className="text-ink-light text-sm">普通浏览者只能查看核对后的公开内容。</p>
        </div>
      </div>
    );
  }

  if (!conflict || !bench) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-3xl">
        <button
          onClick={() => navigate('/sync')}
          className="flex items-center gap-2 text-ink-light hover:text-deep-brown mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="text-sm">返回交接中心</span>
        </button>
        <div className="paper-texture rounded-xl shadow-paper p-12 text-center">
          <CheckCircle2 className="w-10 h-10 text-moss-green/50 mx-auto mb-3" />
          <h3 className="font-serif text-lg font-medium text-deep-brown mb-2">没有待核对的冲突</h3>
          <p className="text-ink-light text-sm mb-4">所有字段双方都一致，或冲突已核对完成。</p>
          <button
            onClick={() => navigate('/sync')}
            className="px-4 py-2 text-sm bg-moss-green text-white rounded-lg"
          >
            回到交接中心
          </button>
        </div>
      </div>
    );
  }

  const setPick = (path: string, pick: PickSide, custom?: unknown) => {
    setChoices((prev) => ({ ...prev, [path]: { pick, custom } }));
  };

  const allDecided = paths.every((p) => choices[p]?.pick);

  const handleConfirm = () => {
    setError(null);
    if (!allDecided) {
      setError('还有字段未选择保留哪一版');
      return;
    }
    if (!publicNotes.trim()) {
      setError('请填写核对后的公开备注（浏览者只能看到这条）');
      return;
    }
    resolveConflict(conflict, { choices, publicNotes: publicNotes.trim(), reviewedBy: db.inspector });
    // 核对通过：主档已更新，地图/排行/详情读取的都是同一份数据，自动重算
    navigate('/sync');
  };

  const isNumeric = (path: string) => path === 'lat' || path === 'lng' || path === 'rating' || path.endsWith(':rating');

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <button
        onClick={() => navigate('/sync')}
        className="flex items-center gap-2 text-ink-light hover:text-deep-brown mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">返回交接中心</span>
      </button>

      <div className="mb-6">
        <h2 className="font-serif text-2xl font-semibold text-deep-brown mb-1">
          核对：{bench.name}
        </h2>
        <p className="text-ink-light text-sm">
          同一字段双方都改过，两版都在此保留。逐字段确认保留哪一版（或填自定义值），核对通过后重算地图、排行与详情统计。
        </p>
        <div className="flex flex-wrap items-center gap-3 mt-3 text-xs">
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-white/60 rounded-full text-ink-light">
            稳定编号 {bench.id.slice(0, 12)}
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-warm-cream rounded-full text-ink-light">
            <User className="w-3 h-3" /> 本机 r{conflict.localRev}（{db.inspector}）
          </span>
          <span className="inline-flex items-center gap-1 px-2 py-1 bg-warm-cream rounded-full text-ink-light">
            <Wifi className="w-3 h-3" /> 离线方 r{conflict.incomingRev}（{conflict.incomingInspector} · {conflict.incomingDevice}）
          </span>
        </div>
      </div>

      <div className="space-y-4">
        {paths.map((path) => {
          const field = conflict.fields[path];
          const choice = choices[path]?.pick;
          const customVal = choices[path]?.custom;
          const numeric = isNumeric(path);

          const SideCard = ({
            side,
            label,
            value,
            badge,
          }: {
            side: PickSide;
            label: string;
            value: unknown;
            badge?: string;
          }) => {
            const active = choice === side;
            return (
              <button
                type="button"
                onClick={() => setPick(path, side)}
                className={`flex-1 text-left p-3 rounded-lg border transition-all ${
                  active
                    ? 'border-moss-green bg-moss-green/5 ring-1 ring-moss-green/40'
                    : 'border-deep-brown/10 bg-white/50 hover:bg-white'
                }`}
              >
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-medium text-ink-light">{label}</span>
                  <span
                    className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                      active ? 'border-moss-green bg-moss-green' : 'border-deep-brown/20'
                    }`}
                  >
                    {active && <CheckCircle2 className="w-3 h-3 text-white" />}
                  </span>
                </div>
                {badge && <div className="text-[10px] text-ink-light/60 mb-1">{badge}</div>}
                <p className="text-sm text-deep-brown break-words whitespace-pre-wrap min-h-[1.5rem]">
                  {formatValue(path, value)}
                </p>
              </button>
            );
          };

          return (
            <div key={path} className="paper-texture rounded-xl shadow-paper p-4">
              <div className="flex items-center gap-2 mb-3">
                <ShieldCheck className="w-4 h-4 text-ochre" />
                <h4 className="font-serif font-semibold text-deep-brown text-sm">{fieldLabel(path)}</h4>
              </div>
              <div className="flex flex-col sm:flex-row gap-3">
                <SideCard side="local" label="本机版本（主档）" value={field.local} badge={`r${conflict.localRev}`} />
                <SideCard side="incoming" label={`离线版本（${conflict.incomingInspector}）`} value={field.incoming} badge={`r${conflict.incomingRev}`} />
              </div>
              {numeric && (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() =>
                      setPick(path, 'custom', customVal ?? field.local ?? field.incoming)
                    }
                    className={`text-xs px-2 py-1 rounded-md border ${
                      choice === 'custom'
                        ? 'border-moss-green text-moss-green'
                        : 'border-deep-brown/15 text-ink-light hover:text-deep-brown'
                    }`}
                  >
                    改用自定义数值
                  </button>
                  {choice === 'custom' && (
                    <input
                      type="number"
                      step={path.includes('lat') || path.includes('lng') ? '0.0001' : '1'}
                      value={String(customVal ?? '')}
                      onChange={(e) => setPick(path, 'custom', parseFloat(e.target.value) || 0)}
                      className="mt-2 w-40 px-3 py-1.5 text-sm bg-white border border-deep-brown/10 rounded-lg"
                    />
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 公开备注：浏览者唯一可见的备注 */}
      <div className="paper-texture rounded-xl shadow-paper p-6 mt-5">
        <h3 className="font-serif text-lg font-semibold text-deep-brown mb-1">核对后的公开备注</h3>
        <p className="text-xs text-ink-light mb-3">
          普通浏览者只能看到这条公开备注，巡查员的个人评价与原始时段备注不会对其展示。
        </p>
        <textarea
          value={publicNotes}
          onChange={(e) => setPublicNotes(e.target.value)}
          rows={3}
          placeholder="综合两版结论，写下对外公开的一句话..."
          className="w-full px-4 py-2.5 bg-white/60 border border-deep-brown/10 rounded-lg text-sm resize-none focus:bg-white"
        />
      </div>

      {error && (
        <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
          {error}
        </div>
      )}

      <div className="flex gap-3 mt-5 pb-8">
        <button
          onClick={() => {
            dismissConflict(conflict.benchId);
            navigate('/sync');
          }}
          title="放弃离线版本的冲突字段，以本机主档为准，冲突出列（不会标记为已核对）"
          className="px-4 py-3 bg-white/60 border border-deep-brown/10 text-ink-light rounded-xl font-medium hover:bg-white flex items-center gap-2"
        >
          <Undo2 className="w-4 h-4" />
          以本机为准
        </button>
        <button
          onClick={() => navigate('/sync')}
          className="flex-1 px-6 py-3 bg-warm-beige text-deep-brown rounded-xl font-medium hover:bg-warm-beige/80"
        >
          稍后核对
        </button>
        <button
          onClick={handleConfirm}
          className="flex-[2] px-6 py-3 bg-moss-green text-white rounded-xl font-medium hover:bg-moss-light shadow-md flex items-center justify-center gap-2"
        >
          <CheckCircle2 className="w-4 h-4" />
          核对通过并发布（{paths.length} 个字段，修订号升到 r{(bench.rev ?? 1) + 1}）
        </button>
      </div>
    </div>
  );
}
