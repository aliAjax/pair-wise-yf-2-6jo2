import type { ArchiveDB, Bench } from '@/types';

const STORAGE_KEY = 'bench-archive-db';
/** 旧版整库 key，迁移成功后保留备份 */
const LEGACY_KEY = 'bench-archive-data';

function createDeviceId(): string {
  return 'dev-' + Math.random().toString(36).slice(2, 8);
}

function emptyDB(): ArchiveDB {
  return {
    version: 1,
    benches: [],
    conflicts: [],
    sync: { ledger: {} },
    deviceId: createDeviceId(),
    inspector: '本机巡查员',
    role: 'inspector',
    pendingImport: null,
    lastMutationAt: new Date().toISOString(),
  };
}

/** 旧数据（无修订号的长椅）迁移为初始版本 rev=1，并标记为已核对以保持历史可见性 */
export function migrateBench(raw: Partial<Bench>): Bench {
  const now = raw.updatedAt ?? new Date().toISOString();
  return {
    id: raw.id as string,
    name: raw.name ?? '未命名长椅',
    location: raw.location ?? '',
    lat: raw.lat ?? 31.23,
    lng: raw.lng ?? 121.47,
    material: raw.material ?? 'wood',
    orientation: raw.orientation ?? 'south',
    hasBackrest: raw.hasBackrest ?? true,
    shadeLevel: raw.shadeLevel ?? 'partial',
    noiseLevel: raw.noiseLevel ?? 'moderate',
    stayDuration: raw.stayDuration ?? 'medium',
    rating: raw.rating ?? 3,
    review: raw.review ?? '',
    experiences: (raw.experiences ?? []).map((e) => ({ ...e, benchId: raw.id as string })),
    createdAt: raw.createdAt ?? now,
    updatedAt: now,
    // —— 迁移：初始版本 ——
    rev: 1,
    lastEditor: raw.lastEditor ?? '（历史数据迁移）',
    reviewed: true,
    publicNotes: raw.publicNotes ?? raw.review ?? '',
  };
}

/** 迁移任何来源（存储 / 交接文件 / 粘贴 JSON）的长椅：补齐修订元数据但不改修订号 */
export function ensureBenchMeta(raw: Partial<Bench>, editor: string, deviceId: string): Bench {
  if (raw.rev == null) return migrateBench(raw);
  return {
    ...migrateBench(raw),
    rev: raw.rev,
    lastEditor: raw.lastEditor ?? editor,
    lastDevice: raw.lastDevice ?? deviceId,
    reviewed: raw.reviewed ?? false,
    publicNotes: raw.publicNotes,
    reviewedBy: raw.reviewedBy,
    reviewedAt: raw.reviewedAt,
  };
}

export function loadDB(): ArchiveDB {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (data) {
      const parsed = JSON.parse(data) as ArchiveDB;
      if (parsed.version === 1 && Array.isArray(parsed.benches)) {
        // 防御性补齐元数据
        parsed.benches = parsed.benches.map((b) =>
          b.rev == null
            ? migrateBench(b)
            : { ...b, experiences: b.experiences ?? [] },
        );
        parsed.conflicts ??= [];
        parsed.sync ??= { ledger: {} };
        parsed.sync.ledger ??= {};
        parsed.pendingImport ??= null;
        parsed.role ??= 'inspector';
        return parsed;
      }
    }
  } catch (error) {
    console.error('Failed to load archive DB:', error);
  }

  // 首次启动：迁移旧版整库（旧应用存的是 Bench[]）
  const db = emptyDB();
  try {
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed) && parsed.length > 0) {
        db.benches = parsed.map((b) => migrateBench(b));
      }
    }
  } catch (error) {
    console.error('Failed to migrate legacy benches:', error);
  }
  saveDB(db);
  return db;
}

export function saveDB(db: ArchiveDB): void {
  try {
    db.lastMutationAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (error) {
    console.error('Failed to save archive DB:', error);
  }
}

/** 初次进入新版时灌入演示数据（同样迁移成 rev=1 已核对） */
export function seedDB(benches: Bench[]): ArchiveDB {
  const db = emptyDB();
  db.benches = benches.map((b) => migrateBench(b));
  saveDB(db);
  return db;
}

/** 跨页签广播通道：后到的保存方借此看到主档已被别人更新 */
export const mutationChannel: BroadcastChannel | null =
  typeof BroadcastChannel !== 'undefined'
    ? new BroadcastChannel('bench-archive-mutations')
    : null;

export function broadcastMutation(kind: string, payload?: Record<string, unknown>): void {
  mutationChannel?.postMessage({ kind, at: new Date().toISOString(), ...payload });
}
