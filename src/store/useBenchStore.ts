import { create } from 'zustand';
import type {
  ArchiveDB,
  Bench,
  BenchExperience,
  ConflictEntry,
  HandoffFile,
  ImportJob,
  MaterialType,
  OrientationType,
  ShadeLevelType,
  NoiseLevelType,
  UserRole,
} from '@/types';
import {
  broadcastMutation,
  loadDB,
  migrateBench,
  mutationChannel,
  saveDB,
  seedDB,
} from '@/utils/storage';
import { generateId } from '@/utils/comfort';
import { mockBenches } from '@/data/mockBenches';
import {
  createHandoffFile,
  dismissConflict as dismissConflictIO,
  makeImportJob,
  parseHandoffFile,
  resolveConflict as resolveConflictIO,
  resumeImport,
  type ReviewDecision,
} from '@/utils/handoff';
import { SaveConflictError } from '@/types';

export type BenchFormData = Omit<Bench, 'id' | 'createdAt' | 'updatedAt' | 'experiences' | 'rev' | 'lastEditor' | 'lastDevice' | 'reviewed' | 'publicNotes' | 'reviewedBy' | 'reviewedAt'>;

interface BenchState {
  db: ArchiveDB | null;
  initialized: boolean;
  searchQuery: string;
  materialFilter: MaterialType | null;
  orientationFilter: OrientationType | null;
  shadeFilter: ShadeLevelType | null;
  noiseFilter: NoiseLevelType | null;
}

interface SaveOptions {
  expectedRev?: number;
}

interface SaveResult {
  ok: boolean;
  currentRev?: number;
  error?: string;
}

interface BenchActions {
  initialize: () => void;
  replaceDB: (db: ArchiveDB) => void;

  // 角色
  setRole: (role: UserRole) => void;
  setInspectorName: (name: string) => void;

  // 查询
  getBenchById: (id: string) => Bench | undefined;
  getVisibleBenches: () => Bench[];
  getConflict: (benchId: string) => ConflictEntry | undefined;
  getFilteredBenches: () => Bench[];

  // 筛选
  setSearchQuery: (query: string) => void;
  setMaterialFilter: (m: MaterialType | null) => void;
  setOrientationFilter: (o: OrientationType | null) => void;
  setShadeFilter: (s: ShadeLevelType | null) => void;
  setNoiseFilter: (n: NoiseLevelType | null) => void;
  clearFilters: () => void;

  // 带修订号的写入（OCC）
  addBench: (data: BenchFormData, experiences?: BenchExperience[]) => Bench;
  saveBenchForm: (
    id: string,
    data: BenchFormData,
    experiences: BenchExperience[],
    options?: SaveOptions,
  ) => SaveResult;
  deleteBench: (id: string) => void;

  // 交接文件
  exportHandoff: () => { file: HandoffFile; text: string };
  startImport: (text: string, fileName: string) => ImportJob;
  retryImport: () => ImportJob;
  clearFinishedImport: () => void;

  // 核对
  resolveConflict: (conflict: ConflictEntry, decision: ReviewDecision) => void;
  dismissConflict: (benchId: string) => void;
}

const initialState: BenchState = {
  db: null,
  initialized: false,
  searchQuery: '',
  materialFilter: null,
  orientationFilter: null,
  shadeFilter: null,
  noiseFilter: null,
};

function commit(db: ArchiveDB, kind: string, set: (partial: Partial<BenchState>) => void) {
  saveDB(db);
  set({ db: { ...db } });
  broadcastMutation(kind, { deviceId: db.deviceId });
}

export const useBenchStore = create<BenchState & BenchActions>((set, get) => {
  // 跨页签：其它页签写入后，本页签重新从磁盘读取最新主档（保存冲突因此可见）
  if (mutationChannel) {
    mutationChannel.onmessage = (ev: MessageEvent) => {
      const state = get();
      if (!state.db) return;
      if (ev.data?.deviceId && ev.data.deviceId === state.db.deviceId) return;
      const fresh = loadDB();
      set({ db: fresh });
    };
  }
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', (e) => {
      if (e.key === 'bench-archive-db') {
        const state = get();
        if (!state.initialized) return;
        set({ db: loadDB() });
      }
    });
  }

  const touch = (db: ArchiveDB, kind: string) => commit(db, kind, set);

  return {
    ...initialState,

    initialize: () => {
      if (get().initialized) return;
      let db = loadDB();
      // 全新环境（无旧数据）：灌入演示数据并迁移为 rev=1 初始版本
      if (db.benches.length === 0 && !localStorage.getItem('bench-archive-data')) {
        db = seedDB(mockBenches.map((b) => migrateBench(b)));
      }
      set({ db, initialized: true });
    },

    replaceDB: (db) => set({ db: { ...db } }),

    setRole: (role) => {
      const db = get().db;
      if (!db) return;
      db.role = role;
      touch(db, 'role-change');
    },

    setInspectorName: (name) => {
      const db = get().db;
      if (!db) return;
      db.inspector = name.trim() || '巡查员';
      touch(db, 'inspector-change');
    },

    getBenchById: (id) => get().db?.benches.find((b) => b.id === id),
    getConflict: (benchId) => get().db?.conflicts.find((c) => c.benchId === benchId),

    getVisibleBenches: () => {
      const db = get().db;
      if (!db) return [];
      // 普通浏览者只能看到核对通过的长椅
      if (db.role === 'viewer') return db.benches.filter((b) => b.reviewed === true);
      return db.benches;
    },

    getFilteredBenches: () => {
      const { searchQuery, materialFilter, orientationFilter, shadeFilter, noiseFilter } = get();
      return get()
        .getVisibleBenches()
        .filter((bench) => {
          if (searchQuery) {
            const q = searchQuery.toLowerCase();
            if (
              !bench.name.toLowerCase().includes(q) &&
              !bench.location.toLowerCase().includes(q) &&
              !bench.review.toLowerCase().includes(q)
            ) {
              return false;
            }
          }
          if (materialFilter && bench.material !== materialFilter) return false;
          if (orientationFilter && bench.orientation !== orientationFilter) return false;
          if (shadeFilter && bench.shadeLevel !== shadeFilter) return false;
          if (noiseFilter && bench.noiseLevel !== noiseFilter) return false;
          return true;
        });
    },

    setSearchQuery: (query) => set({ searchQuery: query }),
    setMaterialFilter: (m) => set({ materialFilter: m }),
    setOrientationFilter: (o) => set({ orientationFilter: o }),
    setShadeFilter: (s) => set({ shadeFilter: s }),
    setNoiseFilter: (n) => set({ noiseFilter: n }),
    clearFilters: () =>
      set({
        searchQuery: '',
        materialFilter: null,
        orientationFilter: null,
        shadeFilter: null,
        noiseFilter: null,
      }),

    addBench: (data, experiences) => {
      const db = get().db!;
      const now = new Date().toISOString();
      const benchId = generateId();
      const bench: Bench = {
        ...data,
        id: benchId,
        experiences: (experiences ?? []).map((e) => ({
          ...e,
          id: !e.id || e.id === 'temp' || e.benchId === 'temp' ? generateId() : e.id,
          benchId,
        })),
        createdAt: now,
        updatedAt: now,
        rev: 1,
        lastEditor: db.inspector,
        lastDevice: db.deviceId,
        // 本机巡查员直接录入的档案视为已核对公开
        reviewed: true,
        publicNotes: data.review,
      };
      db.benches = [bench, ...db.benches];
      touch(db, 'bench-add');
      return bench;
    },

    // 整表单次保存：expectedRev 与主档当前修订号不一致即拒绝（后到方看到版本冲突）
    saveBenchForm: (id, data, experiences, options) => {
      // 始终以磁盘上的最新主档为准，避免覆盖其它页签刚写入的修订
      const latest = loadDB();
      const current = latest.benches.find((b) => b.id === id);
      if (!current) return { ok: false, error: '长椅已被删除或不存在' };

      const currentRev = current.rev ?? 1;
      if (options?.expectedRev != null && options.expectedRev !== currentRev) {
        set({ db: latest });
        throw new SaveConflictError(currentRev);
      }

      const now = new Date().toISOString();
      // 表单中的时段列表即权威结果（删除即移除）；临时编号落盘时换成稳定编号
      const mergedExperiences: BenchExperience[] = experiences.map((e) => ({
        ...e,
        id: !e.id || e.id === 'temp' || e.benchId === 'temp' ? generateId() : e.id,
        benchId: id,
      }));

      const updated: Bench = {
        ...current,
        ...data,
        experiences: mergedExperiences,
        rev: currentRev + 1,
        updatedAt: now,
        lastEditor: latest.inspector,
        lastDevice: latest.deviceId,
        // 本地巡查员的直接修改不改变核对门控；已公开的档案同步刷新公开备注。
        // 待核对/未核对状态保持不变（导入合并产生的档案需走核对流程）。
        reviewed: current.reviewed ?? false,
        publicNotes: current.reviewed ? data.review : current.publicNotes,
      };

      latest.benches = latest.benches.map((b) => (b.id === id ? updated : b));
      touch(latest, 'bench-update');
      return { ok: true, currentRev: updated.rev };
    },

    deleteBench: (id) => {
      const db = get().db!;
      db.benches = db.benches.filter((b) => b.id !== id);
      db.conflicts = db.conflicts.filter((c) => c.benchId !== id);
      touch(db, 'bench-delete');
    },

    exportHandoff: () => {
      const db = get().db!;
      const file = createHandoffFile(db);
      return { file, text: JSON.stringify(file, null, 2) };
    },

    startImport: (text, fileName) => {
      const db = get().db!;
      // 已存在未完成任务时不允许叠加
      if (db.pendingImport && db.pendingImport.status === 'running') {
        return db.pendingImport;
      }
      const parsed = parseHandoffFile(text);
      const job = makeImportJob(parsed, fileName);
      const { job: ran, db: next } = resumeImport(db, job);
      set({ db: { ...next } });
      broadcastMutation('import-progress', { deviceId: db.deviceId });
      return ran;
    },

    retryImport: () => {
      const db = loadDB();
      const job = db.pendingImport;
      if (!job) throw new Error('没有待重试的导入任务');
      const { job: ran, db: next } = resumeImport(db, job);
      set({ db: { ...next } });
      broadcastMutation('import-progress', { deviceId: db.deviceId });
      return ran;
    },

    clearFinishedImport: () => {
      const db = get().db!;
      if (db.pendingImport?.status === 'done') {
        db.pendingImport = null;
        touch(db, 'import-cleared');
      }
    },

    resolveConflict: (conflict, decision) => {
      const db = get().db!;
      const next = resolveConflictIO(db, conflict, decision);
      set({ db: { ...next } });
      broadcastMutation('conflict-resolved', { deviceId: db.deviceId });
    },

    dismissConflict: (benchId) => {
      const db = get().db!;
      const next = dismissConflictIO(db, benchId);
      set({ db: { ...next } });
      broadcastMutation('conflict-dismissed', { deviceId: db.deviceId });
    },
  };
});
