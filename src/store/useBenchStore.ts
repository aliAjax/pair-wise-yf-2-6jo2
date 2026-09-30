import { create } from 'zustand';
import type {
  Bench,
  BenchExperience,
  MaterialType,
  OrientationType,
  ShadeLevelType,
  NoiseLevelType,
  UserRole,
  HandoffFile,
  ImportSession,
  ImportItemProgress,
  PendingImport,
  ArchiveStats,
} from '@/types';
import {
  saveBenches,
  loadBenches,
  savePendingImports,
  loadPendingImports,
  saveImportSessions,
  loadImportSessions,
  saveRole,
  loadRole,
  saveInspectorName,
  loadInspectorName,
  saveStats,
  loadStats,
} from '@/utils/storage';
import { generateId } from '@/utils/comfort';
import { mockBenches } from '@/data/mockBenches';
import { migrateBenches } from '@/utils/migration';
import { mergeBenchFields, snapshotOf, validateHandoff, applyResolutions } from '@/utils/merge';
import { recomputeStats } from '@/utils/stats';

interface BenchState {
  benches: Bench[];
  pendingImports: PendingImport[];
  importSessions: ImportSession[];
  activeImportSessionId: string | null;
  role: UserRole;
  inspectorName: string;
  stats: ArchiveStats | null;
  statsUpdatedAt: string | null;
  searchQuery: string;
  materialFilter: MaterialType | null;
  orientationFilter: OrientationType | null;
  shadeFilter: ShadeLevelType | null;
  noiseFilter: NoiseLevelType | null;
  initialized: boolean;
}

export type UpdateBenchResult =
  | { ok: true; bench: Bench }
  | { ok: false; reason: 'conflict'; currentRevision: number };

interface BenchActions {
  initialize: () => void;
  setRole: (role: UserRole) => void;
  setInspectorName: (name: string) => void;
  setSearchQuery: (query: string) => void;
  setMaterialFilter: (material: MaterialType | null) => void;
  setOrientationFilter: (orientation: OrientationType | null) => void;
  setShadeFilter: (shade: ShadeLevelType | null) => void;
  setNoiseFilter: (noise: NoiseLevelType | null) => void;
  clearFilters: () => void;
  addBench: (bench: Omit<Bench, 'id' | 'createdAt' | 'updatedAt' | 'experiences' | 'revision'> & { experiences?: BenchExperience[] }) => Bench;
  updateBench: (id: string, updates: Partial<Bench>, expectedRevision?: number) => UpdateBenchResult;
  deleteBench: (id: string) => void;
  getBenchById: (id: string) => Bench | undefined;
  getFilteredBenches: () => Bench[];
  // 交接导入导出
  exportHandoff: () => HandoffFile;
  importHandoff: (handoff: HandoffFile, fileName?: string) => Promise<{ sessionId: string; applied: number; conflicts: number }>;
  resumeImport: (sessionId: string) => Promise<{ applied: number; conflicts: number }>;
  // 待核对
  resolvePending: (pendingId: string, decisions: Record<string, 'local' | 'incoming'>) => void;
  discardPending: (pendingId: string) => void;
  // 统计
  recomputeStats: () => void;
}

const initialState: BenchState = {
  benches: [],
  pendingImports: [],
  importSessions: [],
  activeImportSessionId: null,
  role: 'inspector',
  inspectorName: '巡查员',
  stats: null,
  statsUpdatedAt: null,
  searchQuery: '',
  materialFilter: null,
  orientationFilter: null,
  shadeFilter: null,
  noiseFilter: null,
  initialized: false,
};

function persist(benches: Bench[], pending: PendingImport[]): void {
  saveBenches(benches);
  savePendingImports(pending);
}

export const useBenchStore = create<BenchState & BenchActions>((set, get) => ({
  ...initialState,

  initialize: () => {
    if (get().initialized) return;
    const stored = loadBenches();
    const benches = stored.length > 0 ? migrateBenches(stored) : migrateBenches(mockBenches);
    if (stored.length === 0) saveBenches(benches);
    set({
      benches,
      pendingImports: loadPendingImports(),
      importSessions: loadImportSessions(),
      role: loadRole(),
      inspectorName: loadInspectorName(),
      stats: loadStats(),
      initialized: true,
    });
  },

  setRole: (role) => {
    saveRole(role);
    set({ role });
  },

  setInspectorName: (name) => {
    saveInspectorName(name);
    set({ inspectorName: name });
  },

  setSearchQuery: (query) => set({ searchQuery: query }),
  setMaterialFilter: (material) => set({ materialFilter: material }),
  setOrientationFilter: (orientation) => set({ orientationFilter: orientation }),
  setShadeFilter: (shade) => set({ shadeFilter: shade }),
  setNoiseFilter: (noise) => set({ noiseFilter: noise }),

  clearFilters: () =>
    set({
      searchQuery: '',
      materialFilter: null,
      orientationFilter: null,
      shadeFilter: null,
      noiseFilter: null,
    }),

  addBench: (benchData) => {
    const now = new Date().toISOString();
    const inspector = get().inspectorName;
    const newBench: Bench = {
      ...benchData,
      id: generateId(),
      revision: 1,
      experiences: benchData.experiences ?? [],
      createdAt: now,
      updatedAt: now,
      lastModifiedBy: inspector,
    };
    newBench.synced = { at: now, by: inspector, data: snapshotOf(newBench) };
    const newBenches = [newBench, ...get().benches];
    set({ benches: newBenches });
    persist(newBenches, get().pendingImports);
    return newBench;
  },

  updateBench: (id, updates, expectedRevision) => {
    const state = get();
    const target = state.benches.find((b) => b.id === id);
    if (!target) {
      return { ok: false, reason: 'conflict', currentRevision: -1 };
    }
    // 乐观锁：保存时修订号已被其他页签/导入推进 → 后到的一方看到冲突
    if (expectedRevision !== undefined && target.revision !== expectedRevision) {
      return { ok: false, reason: 'conflict', currentRevision: target.revision };
    }
    const now = new Date().toISOString();
    const updated: Bench = {
      ...target,
      ...updates,
      revision: target.revision + 1,
      updatedAt: now,
      lastModifiedBy: state.inspectorName,
    };
    const newBenches = state.benches.map((b) => (b.id === id ? updated : b));
    set({ benches: newBenches });
    persist(newBenches, state.pendingImports);
    return { ok: true, bench: updated };
  },

  deleteBench: (id) => {
    const newBenches = get().benches.filter((bench) => bench.id !== id);
    const newPending = get().pendingImports.filter((p) => p.id !== id);
    set({ benches: newBenches, pendingImports: newPending });
    persist(newBenches, newPending);
  },

  getBenchById: (id) => {
    return get().benches.find((bench) => bench.id === id);
  },

  getFilteredBenches: () => {
    const { benches, searchQuery, materialFilter, orientationFilter, shadeFilter, noiseFilter } = get();

    return benches.filter((bench) => {
      if (searchQuery) {
        const query = searchQuery.toLowerCase();
        const matchName = bench.name.toLowerCase().includes(query);
        const matchLocation = bench.location.toLowerCase().includes(query);
        const matchReview = (bench.review || '').toLowerCase().includes(query);
        if (!matchName && !matchLocation && !matchReview) return false;
      }

      if (materialFilter && bench.material !== materialFilter) return false;
      if (orientationFilter && bench.orientation !== orientationFilter) return false;
      if (shadeFilter && bench.shadeLevel !== shadeFilter) return false;
      if (noiseFilter && bench.noiseLevel !== noiseFilter) return false;

      return true;
    });
  },

  // ---------- 交接导出 ----------
  exportHandoff: () => {
    const state = get();
    const now = new Date().toISOString();
    // 导出是一次同步点：把每条长椅的基线推进到当前版本
    const benches = state.benches.map((b) => {
      const synced = { at: now, by: state.inspectorName, data: snapshotOf(b) };
      return { ...b, synced };
    });
    set({ benches });
    saveBenches(benches);

    const handoff: HandoffFile = {
      format: 'bench-archive-handoff',
      version: 1,
      exportedAt: now,
      exportedBy: state.inspectorName,
      sourceDevice: navigator.userAgent.includes('Mobile') ? 'mobile' : 'desktop',
      benches: benches.map((b) => ({ ...b })),
    };
    return handoff;
  },

  // ---------- 交接导入（断点续传）----------
  importHandoff: async (handoff, fileName = 'handoff.json') => {
    const validationError = validateHandoff(handoff);
    if (validationError) throw new Error(validationError);

    const sessionId = `imp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const items: ImportItemProgress[] = handoff.benches.map((b) => ({
      benchId: b.id,
      name: b.name,
      status: 'pending' as const,
    }));
    const session: ImportSession = {
      sessionId,
      fileName,
      exportedAt: handoff.exportedAt,
      exportedBy: handoff.exportedBy,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: 'in-progress',
      total: handoff.benches.length,
      handoff,
      items,
    };
    const sessions = [session, ...get().importSessions];
    set({ importSessions: sessions, activeImportSessionId: sessionId });
    saveImportSessions(sessions);

    const result = await get().resumeImport(sessionId);
    return { sessionId, ...result };
  },

  resumeImport: async (sessionId) => {
    const state = get();
    const session = state.importSessions.find((s) => s.sessionId === sessionId);
    if (!session) throw new Error('找不到导入会话');

    let benches = [...state.benches];
    let pending = [...state.pendingImports];
    let applied = 0;
    let conflicts = 0;

    const persistSession = (status: ImportSession['status']) => {
      const sessions = get().importSessions.map((s) =>
        s.sessionId === sessionId
          ? { ...s, status, updatedAt: new Date().toISOString(), items: [...s.items] }
          : s,
      );
      set({ importSessions: sessions, activeImportSessionId: status === 'in-progress' ? sessionId : null });
      saveImportSessions(sessions);
    };

    try {
      for (let i = 0; i < session.items.length; i++) {
        const item = session.items[i];
        // 断点续传：已完成（applied/conflict）的部分跳过，从 pending/error 继续
        if (item.status === 'applied' || item.status === 'conflict') {
          if (item.status === 'applied') applied++;
          else conflicts++;
          continue;
        }

        const incoming = session.handoff.benches.find((b) => b.id === item.benchId);
        if (!incoming) {
          item.status = 'error';
          item.message = '交接文件中找不到该长椅数据';
          item.processedAt = new Date().toISOString();
          persistSession('failed');
          throw new Error(`导入失败：${item.name} 的数据缺失，已从断点保存进度`);
        }

        const local = benches.find((b) => b.id === incoming.id);

        if (!local) {
          // 主档没有 → 新增，基线为导入版本
          const newBench: Bench = {
            ...incoming,
            experiences: (incoming.experiences ?? []).map((e) => ({ ...e, benchId: incoming.id })),
            synced: {
              at: new Date().toISOString(),
              by: session.handoff.exportedBy,
              data: snapshotOf({ ...incoming }),
            },
          };
          benches = [newBench, ...benches];
          item.status = 'applied';
          item.message = '新增长椅';
          applied++;
        } else {
          const { merged, conflicts: fieldConflicts } = mergeBenchFields(
            local,
            incoming,
            local.synced?.data,
          );

          if (fieldConflicts.length === 0) {
            // 无冲突 → 快进合并，基线推进
            merged.synced = {
              at: new Date().toISOString(),
              by: session.handoff.exportedBy,
              data: snapshotOf(merged),
            };
            benches = benches.map((b) => (b.id === incoming.id ? merged : b));
            item.status = 'applied';
            item.message = '已并入主档';
            applied++;
          } else {
            // 字段冲突 → 保留两版进入待核对
            merged.revision = Math.max(local.revision, incoming.revision);
            benches = benches.map((b) => (b.id === incoming.id ? merged : b));
            const pendingItem: PendingImport = {
              id: incoming.id,
              localBench: local,
              incomingBench: incoming,
              conflicts: fieldConflicts,
              detectedAt: new Date().toISOString(),
              sessionId,
            };
            pending = [pendingItem, ...pending.filter((p) => p.id !== incoming.id)];
            item.status = 'conflict';
            item.message = `${fieldConflicts.length} 个字段待核对`;
            conflicts++;
          }
        }

        item.processedAt = new Date().toISOString();
        // 每个条目处理完立即落盘：崩溃/失败后可从断点继续
        set({ benches: [...benches], pendingImports: [...pending] });
        persist(benches, pending);
        persistSession('in-progress');
        // 让出事件循环，让 UI 进度条刷新
        await new Promise((r) => setTimeout(r, 30));
      }

      persistSession('completed');
      persist(benches, pending);
      return { applied, conflicts };
    } catch (err) {
      persistSession('failed');
      persist(benches, pending);
      throw err;
    }
  },

  // ---------- 待核对解决 ----------
  resolvePending: (pendingId, decisions) => {
    const state = get();
    const item = state.pendingImports.find((p) => p.id === pendingId);
    if (!item) return;

    const finalBench = applyResolutions(item, decisions, state.inspectorName);
    const newBenches = state.benches.map((b) => (b.id === pendingId ? finalBench : b));
    const newPending = state.pendingImports.filter((p) => p.id !== pendingId);
    set({ benches: newBenches, pendingImports: newPending });
    persist(newBenches, newPending);
    // 核对通过后重算地图、排行和详情统计
    get().recomputeStats();
  },

  discardPending: (pendingId) => {
    // 放弃导入版本：主档保留 local 版，移除待核对
    const state = get();
    const item = state.pendingImports.find((p) => p.id === pendingId);
    if (item) {
      // 把主档恢复为 local 版（合并时可能采用了无冲突字段，这里还原）
      const restored = item.localBench;
      const newBenches = state.benches.map((b) => (b.id === pendingId ? restored : b));
      const newPending = state.pendingImports.filter((p) => p.id !== pendingId);
      set({ benches: newBenches, pendingImports: newPending });
      persist(newBenches, newPending);
    }
  },

  // ---------- 统计重算 ----------
  recomputeStats: () => {
    const stats = recomputeStats(get().benches, get().pendingImports.length);
    saveStats(stats);
    set({ stats, statsUpdatedAt: new Date().toISOString() });
  },
}));
