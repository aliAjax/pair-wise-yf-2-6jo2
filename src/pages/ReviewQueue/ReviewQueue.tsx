import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  GitMerge,
  CheckCircle2,
  ArrowDownToLine,
  ArrowUpFromLine,
  Eye,
  ShieldCheck,
  BarChart3,
} from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import {
  MATERIAL_LABELS,
  ORIENTATION_LABELS,
  SHADE_LABELS,
  NOISE_LABELS,
  STAY_DURATION_LABELS,
  TIME_PERIOD_LABELS,
} from '@/types';
import type { PendingImport } from '@/types';

function displayValue(field: string, value: unknown): string {
  if (value === undefined || value === null || value === '') return '（空）';
  switch (field) {
    case 'material':
      return MATERIAL_LABELS[value as keyof typeof MATERIAL_LABELS] ?? String(value);
    case 'orientation':
      return ORIENTATION_LABELS[value as keyof typeof ORIENTATION_LABELS] ?? String(value);
    case 'shadeLevel':
      return SHADE_LABELS[value as keyof typeof SHADE_LABELS] ?? String(value);
    case 'noiseLevel':
      return NOISE_LABELS[value as keyof typeof NOISE_LABELS] ?? String(value);
    case 'stayDuration':
      return STAY_DURATION_LABELS[value as keyof typeof STAY_DURATION_LABELS] ?? String(value);
    case 'hasBackrest':
      return value ? '有靠背' : '无靠背';
    case 'experiences': {
      const exps = value as { timePeriod: string; notes: string; rating: number }[];
      if (!Array.isArray(exps) || exps.length === 0) return '（无时段体验）';
      return exps
        .map((e) => `${TIME_PERIOD_LABELS[e.timePeriod as keyof typeof TIME_PERIOD_LABELS] ?? e.timePeriod}：${e.notes}（${e.rating}星）`)
        .join('\n');
    }
    default:
      return String(value);
  }
}

export default function ReviewQueue() {
  const navigate = useNavigate();
  const {
    pendingImports,
    initialize,
    initialized,
    resolvePending,
    discardPending,
    role,
    stats,
    statsUpdatedAt,
    benches,
  } = useBenchStore();

  // 每条待核对项的字段选择：pendingId -> field -> 'local' | 'incoming'
  const [decisions, setDecisions] = useState<Record<string, Record<string, 'local' | 'incoming'>>>({});

  useEffect(() => {
    if (!initialized) initialize();
  }, [initialized, initialize]);

  // 非巡查员无权核对
  useEffect(() => {
    if (initialized && role !== 'inspector') navigate('/');
  }, [initialized, role, navigate]);

  const defaultDecisions = useMemo(() => {
    const map: Record<string, Record<string, 'local' | 'incoming'>> = {};
    for (const p of pendingImports) {
      map[p.id] = {};
      for (const conflict of p.conflicts) {
        map[p.id][conflict.field] = 'local';
      }
    }
    return map;
  }, [pendingImports]);

  const currentDecisions = (p: PendingImport) => decisions[p.id] ?? defaultDecisions[p.id] ?? {};

  const setFieldChoice = (pendingId: string, field: string, choice: 'local' | 'incoming') => {
    setDecisions((prev) => ({
      ...prev,
      [pendingId]: { ...(prev[pendingId] ?? defaultDecisions[pendingId] ?? {}), [field]: choice },
    }));
  };

  const setAll = (p: PendingImport, choice: 'local' | 'incoming') => {
    const next: Record<string, 'local' | 'incoming'> = {};
    for (const c of p.conflicts) next[c.field] = choice;
    setDecisions((prev) => ({ ...prev, [p.id]: next }));
  };

  const handleResolve = (p: PendingImport) => {
    resolvePending(p.id, currentDecisions(p));
  };

  return (
    <div className="container mx-auto px-4 py-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-ink-light hover:text-deep-brown mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">返回</span>
      </button>

      <div className="mb-6">
        <h2 className="font-serif text-2xl font-semibold text-deep-brown mb-1 flex items-center gap-2">
          <GitMerge className="w-6 h-6 text-ochre" />
          待核对
        </h2>
        <p className="text-ink-light text-sm">
          离线交接中双方都修改过的字段保留了两版，请逐字段核对采用哪一版；核对通过后将重算地图、排行和详情统计。
        </p>
      </div>

      {/* 统计重算状态 */}
      <div className="paper-texture rounded-xl shadow-paper p-4 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
        <div className="flex items-center gap-2 text-deep-brown">
          <BarChart3 className="w-4 h-4 text-moss-green" />
          <span>档案统计</span>
        </div>
        <span className="text-ink-light">
          长椅总数 <span className="font-medium text-deep-brown">{stats?.total ?? benches.length}</span>
        </span>
        <span className="text-ink-light">
          平均舒适度 <span className="font-medium text-deep-brown">{stats?.avgComfort ?? '-'}</span>
        </span>
        <span className="text-ink-light">
          平均评分 <span className="font-medium text-deep-brown">{stats?.avgRating ?? '-'}</span>
        </span>
        <span className="text-ink-light">
          待核对 <span className="font-medium text-ochre">{pendingImports.length}</span>
        </span>
        {statsUpdatedAt && (
          <span className="text-xs text-ink-light/70 ml-auto">
            上次重算：{new Date(statsUpdatedAt).toLocaleString('zh-CN')}
          </span>
        )}
      </div>

      {pendingImports.length === 0 ? (
        <div className="paper-texture rounded-xl shadow-paper p-12 text-center">
          <CheckCircle2 className="w-12 h-12 text-moss-green mx-auto mb-3" />
          <h3 className="font-serif text-lg font-medium text-deep-brown mb-2">没有待核对的冲突</h3>
          <p className="text-ink-light text-sm">
            所有交接内容都已自动合并，或双方修改互不冲突。
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {pendingImports.map((p) => {
            const dec = currentDecisions(p);
            return (
              <div key={p.id} className="paper-texture rounded-xl shadow-paper overflow-hidden">
                <div className="px-5 py-3 bg-warm-cream/60 border-b border-deep-brown/10 flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <h3 className="font-serif font-semibold text-deep-brown truncate">
                      {p.localBench.name}
                    </h3>
                    <p className="text-xs text-ink-light">
                      稳定编号 {p.id} · 主档修订号 {p.localBench.revision} → 交接修订号 {p.incomingBench.revision}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setAll(p, 'local')}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-ink-light hover:bg-deep-brown/5 rounded-lg transition-colors"
                    >
                      <ArrowUpFromLine className="w-3.5 h-3.5" />
                      全部采用主档
                    </button>
                    <button
                      onClick={() => setAll(p, 'incoming')}
                      className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-ink-light hover:bg-deep-brown/5 rounded-lg transition-colors"
                    >
                      <ArrowDownToLine className="w-3.5 h-3.5" />
                      全部采用交接版
                    </button>
                  </div>
                </div>

                <div className="divide-y divide-deep-brown/5">
                  {p.conflicts.map((conflict) => {
                    const choice = dec[conflict.field] ?? 'local';
                    return (
                      <div key={conflict.field} className="px-5 py-4">
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-sm font-medium text-deep-brown">{conflict.label}</span>
                          <span className="text-xs text-ochre bg-ochre/10 px-2 py-0.5 rounded-full">
                            双方都修改
                          </span>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <button
                            onClick={() => setFieldChoice(p.id, conflict.field, 'local')}
                            className={`text-left p-3 rounded-lg border transition-all ${
                              choice === 'local'
                                ? 'border-moss-green bg-moss-green/5 ring-1 ring-moss-green/30'
                                : 'border-deep-brown/10 bg-white/40 hover:border-moss-green/40'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-medium text-moss-green mb-1.5">
                              <ShieldCheck className="w-3.5 h-3.5" />
                              主档版本（当前）
                            </div>
                            <p className="text-sm text-deep-brown whitespace-pre-wrap break-words line-clamp-4">
                              {displayValue(conflict.field, conflict.localValue)}
                            </p>
                          </button>
                          <button
                            onClick={() => setFieldChoice(p.id, conflict.field, 'incoming')}
                            className={`text-left p-3 rounded-lg border transition-all ${
                              choice === 'incoming'
                                ? 'border-ochre bg-ochre/5 ring-1 ring-ochre/30'
                                : 'border-deep-brown/10 bg-white/40 hover:border-ochre/40'
                            }`}
                          >
                            <div className="flex items-center gap-1.5 text-xs font-medium text-ochre mb-1.5">
                              <Eye className="w-3.5 h-3.5" />
                              交接版本（巡查员带回）
                            </div>
                            <p className="text-sm text-deep-brown whitespace-pre-wrap break-words line-clamp-4">
                              {displayValue(conflict.field, conflict.incomingValue)}
                            </p>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="px-5 py-3 bg-warm-cream/40 border-t border-deep-brown/10 flex items-center justify-between gap-3">
                  <button
                    onClick={() => discardPending(p.id)}
                    className="px-3 py-1.5 text-sm text-ink-light hover:text-red-500 transition-colors"
                  >
                    放弃交接版（保留主档）
                  </button>
                  <button
                    onClick={() => handleResolve(p)}
                    className="flex items-center gap-1.5 px-4 py-2 bg-moss-green text-white rounded-lg text-sm font-medium hover:bg-moss-light transition-colors"
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    核对通过并重算统计
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
