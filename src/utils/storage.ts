import type { Bench, PendingImport, ImportSession, UserRole, ArchiveStats } from '@/types';

const BENCHES_KEY = 'bench-archive-data';
const PENDING_KEY = 'bench-pending-imports';
const SESSIONS_KEY = 'bench-import-sessions';
const ROLE_KEY = 'bench-user-role';
const INSPECTOR_KEY = 'bench-inspector-name';
const STATS_KEY = 'bench-archive-stats';

function readJSON<T>(key: string, fallback: T): T {
  try {
    const data = localStorage.getItem(key);
    if (data) return JSON.parse(data) as T;
  } catch (error) {
    console.error(`Failed to read ${key} from localStorage:`, error);
  }
  return fallback;
}

function writeJSON(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (error) {
    console.error(`Failed to write ${key} to localStorage:`, error);
  }
}

// ---- 长椅主档 ----
export function loadBenches(): Bench[] {
  return readJSON<Bench[]>(BENCHES_KEY, []);
}

export function saveBenches(benches: Bench[]): void {
  writeJSON(BENCHES_KEY, benches);
}

export function clearBenches(): void {
  try {
    localStorage.removeItem(BENCHES_KEY);
  } catch (error) {
    console.error('Failed to clear benches from localStorage:', error);
  }
}

// ---- 待核对 ----
export function loadPendingImports(): PendingImport[] {
  return readJSON<PendingImport[]>(PENDING_KEY, []);
}

export function savePendingImports(items: PendingImport[]): void {
  writeJSON(PENDING_KEY, items);
}

// ---- 导入会话（断点续传检查点）----
export function loadImportSessions(): ImportSession[] {
  return readJSON<ImportSession[]>(SESSIONS_KEY, []);
}

export function saveImportSessions(sessions: ImportSession[]): void {
  // 最多保留最近 8 个会话
  writeJSON(SESSIONS_KEY, sessions.slice(0, 8));
}

// ---- 角色与巡查员代号 ----
export function loadRole(): UserRole {
  return readJSON<UserRole>(ROLE_KEY, 'inspector');
}

export function saveRole(role: UserRole): void {
  writeJSON(ROLE_KEY, role);
}

export function loadInspectorName(): string {
  return readJSON<string>(INSPECTOR_KEY, '巡查员');
}

export function saveInspectorName(name: string): void {
  writeJSON(INSPECTOR_KEY, name);
}

// ---- 统计 ----
export function loadStats(): ArchiveStats | null {
  return readJSON<ArchiveStats | null>(STATS_KEY, null);
}

export function saveStats(stats: ArchiveStats | null): void {
  writeJSON(STATS_KEY, stats);
}
