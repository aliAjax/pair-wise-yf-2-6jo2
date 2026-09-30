export type MaterialType = 'wood' | 'metal' | 'stone' | 'plastic' | 'mixed';
export type OrientationType = 'east' | 'south' | 'west' | 'north' | 'southeast' | 'northeast' | 'southwest' | 'northwest';
export type ShadeLevelType = 'none' | 'partial' | 'full';
export type NoiseLevelType = 'quiet' | 'moderate' | 'noisy';
export type StayDurationType = 'short' | 'medium' | 'long' | 'verylong';
export type TimePeriodType = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

/** 巡查员（可编辑/合并/核对）或普通浏览者（只读公开内容） */
export type UserRole = 'inspector' | 'viewer';

export interface BenchExperience {
  id: string;
  benchId: string;
  timePeriod: TimePeriodType;
  notes: string;
  rating: number;
}

export interface Bench {
  /** 稳定编号：跨设备/跨交接文件终身不变，合并以此归并 */
  id: string;
  name: string;
  location: string;
  lat: number;
  lng: number;
  material: MaterialType;
  orientation: OrientationType;
  hasBackrest: boolean;
  shadeLevel: ShadeLevelType;
  noiseLevel: NoiseLevelType;
  stayDuration: StayDurationType;
  rating: number;
  review: string;
  experiences: BenchExperience[];
  createdAt: string;
  updatedAt: string;

  // ---- 版本控制（迁移后存在）----
  /** 修订号，初始为 1，每次落盘修改 +1 */
  rev?: number;
  /** 最近一次修改人（巡查员姓名） */
  lastEditor?: string;
  /** 最近一次修改人所在设备编号 */
  lastDevice?: string;
  /** 是否已通过核对；浏览者只能看到 true 的长椅 */
  reviewed?: boolean;
  /** 核对通过后对外展示的公开备注（浏览者仅可见此项，看不到 review/原始 notes） */
  publicNotes?: string;
  /** 最近一次核对人 */
  reviewedBy?: string;
  reviewedAt?: string;
}

/** 参与三方合并比对的标量字段（experiences 单独按编号合并） */
export const BENCH_FIELDS = [
  'name',
  'location',
  'lat',
  'lng',
  'material',
  'orientation',
  'hasBackrest',
  'shadeLevel',
  'noiseLevel',
  'stayDuration',
  'rating',
  'review',
] as const;
export type BenchField = (typeof BENCH_FIELDS)[number];

/** 冲突字段路径：标量字段（name）或时段备注（experience:<expId>:notes 等） */
export type FieldPath = string;

export const FIELD_LABELS: Record<string, string> = {
  name: '名称',
  location: '位置',
  lat: '纬度',
  lng: '经度',
  material: '材质',
  orientation: '朝向',
  hasBackrest: '靠背',
  shadeLevel: '遮阴',
  noiseLevel: '噪音',
  stayDuration: '停留时长',
  rating: '评分',
  review: '个人评价',
  experiences: '分时段体验',
};

export function fieldLabel(path: FieldPath): string {
  if (FIELD_LABELS[path]) return FIELD_LABELS[path];
  const [kind, expId, sub] = path.split(':');
  if (kind === 'experience') {
    const subLabel =
      sub === 'notes' ? '备注' : sub === 'rating' ? '评分' : sub === 'timePeriod' ? '时段' : sub;
    return `时段体验 ${expId.slice(-4)} · ${subLabel ?? '整条'}`;
  }
  return path;
}

// ---- 交接文件 ----

export interface HandoffEntry {
  /** 稳定编号 */
  benchId: string;
  /** 离线方所基于的主档修订号（新长椅为 0） */
  baseRev: number;
  /** 离线方改完后的快照（rev 为其当前修订号） */
  bench: Bench;
  /**
   * 共同基准快照（兜底）：有过同步记录时为发送方当前版本，
   * 从无同步的新建长椅为 null。
   */
  baseSnapshot: Bench | null;
  /**
   * 发送方为各伙伴设备保留的最近一次共同祖先：
   * 接收方优先用 partnerBases[自己的deviceId] 做三方合并基准。
   */
  partnerBases?: Record<string, { rev: number; snapshot: Bench }>;
}

export interface HandoffFile {
  format: 'bench-handoff';
  formatVersion: 1;
  deviceId: string;
  inspector: string;
  exportedAt: string;
  entries: HandoffEntry[];
}

// ---- 待核对冲突 ----

export interface ConflictEntry {
  benchId: string;
  /** 检测到冲突的时间 */
  detectedAt: string;
  /** 字段路径 -> 双方取值 */
  fields: Record<FieldPath, { base: unknown; local: unknown; incoming: unknown }>;
  /** 主档（本机）版本快照 */
  localBench: Bench;
  /** 交接文件中的版本快照 */
  incomingBench: Bench;
  incomingInspector: string;
  incomingDevice: string;
  /** 冲突时双方的修订号 */
  localRev: number;
  incomingRev: number;
  /** 来源交接文件 */
  sourceExportedAt: string;
}

// ---- 可恢复的导入任务 ----

export type ImportEntryStatus = 'merged' | 'conflict' | 'error';

export interface ImportEntryResult {
  benchId: string;
  name: string;
  status: ImportEntryStatus;
  message: string;
  appliedFields?: FieldPath[];
}

export interface ImportJob {
  id: string;
  fileName: string;
  inspector: string;
  deviceId: string;
  exportedAt: string;
  startedAt: string;
  /** 交接文件中的全部条目 */
  entries: HandoffEntry[];
  /** 已逐条处理到的位置，重试时从此处继续 */
  nextIndex: number;
  results: ImportEntryResult[];
  status: 'running' | 'done';
}

// ---- 本机档案库（持久化）----

export interface PartnerSyncPoint {
  /** 该设备最近一次见到的修订号 */
  rev: number;
  /** 该设备最近一次的版本快照（共同祖先） */
  snapshot: Bench;
  at: string;
}

export interface SyncState {
  /** 共同祖先台账：benchId -> 对端设备编号 -> 同步点 */
  ledger: Record<string, Record<string, PartnerSyncPoint>>;
}

export interface ArchiveDB {
  version: 1;
  benches: Bench[];
  conflicts: ConflictEntry[];
  sync: SyncState;
  deviceId: string;
  inspector: string;
  role: UserRole;
  pendingImport: ImportJob | null;
  lastMutationAt: string;
}

/** 保存时发现主档修订号已变化 */
export class SaveConflictError extends Error {
  currentRev: number;
  constructor(currentRev: number) {
    super(`版本冲突：主档已更新到修订号 ${currentRev}`);
    this.name = 'SaveConflictError';
    this.currentRev = currentRev;
  }
}

export const MATERIAL_LABELS: Record<MaterialType, string> = {
  wood: '木质',
  metal: '金属',
  stone: '石质',
  plastic: '塑料',
  mixed: '混合材质',
};

export const ORIENTATION_LABELS: Record<OrientationType, string> = {
  east: '东',
  south: '南',
  west: '西',
  north: '北',
  southeast: '东南',
  northeast: '东北',
  southwest: '西南',
  northwest: '西北',
};

export const SHADE_LABELS: Record<ShadeLevelType, string> = {
  none: '无遮阴',
  partial: '部分遮阴',
  full: '完全遮阴',
};

export const NOISE_LABELS: Record<NoiseLevelType, string> = {
  quiet: '安静',
  moderate: '一般',
  noisy: '嘈杂',
};

export const STAY_DURATION_LABELS: Record<StayDurationType, string> = {
  short: '少于15分钟',
  medium: '15-30分钟',
  long: '30-60分钟',
  verylong: '1小时以上',
};

export const TIME_PERIOD_LABELS: Record<TimePeriodType, string> = {
  morning: '早晨',
  noon: '中午',
  afternoon: '下午',
  evening: '傍晚',
  night: '夜晚',
};

export const TIME_PERIOD_ICONS: Record<TimePeriodType, string> = {
  morning: 'sunrise',
  noon: 'sun',
  afternoon: 'cloud-sun',
  evening: 'sunset',
  night: 'moon',
};
