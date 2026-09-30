export type MaterialType = 'wood' | 'metal' | 'stone' | 'plastic' | 'mixed';
export type OrientationType = 'east' | 'south' | 'west' | 'north' | 'southeast' | 'northeast' | 'southwest' | 'northwest';
export type ShadeLevelType = 'none' | 'partial' | 'full';
export type NoiseLevelType = 'quiet' | 'moderate' | 'noisy';
export type StayDurationType = 'short' | 'medium' | 'long' | 'verylong';
export type TimePeriodType = 'morning' | 'noon' | 'afternoon' | 'evening' | 'night';

/** 用户角色：普通浏览者 / 巡查员 */
export type UserRole = 'viewer' | 'inspector';

export interface BenchExperience {
  id: string;
  benchId: string;
  timePeriod: TimePeriodType;
  notes: string;
  rating: number;
}

/** 长椅快照（不含同步基线本身，避免嵌套） */
export type BenchSnapshot = Omit<Bench, 'synced'>;

/** 上次同步基线：用于离线交接时的三方合并 */
export interface SyncBase {
  /** 同步时间 */
  at: string;
  /** 同步操作者 */
  by: string;
  /** 同步时的长椅快照 */
  data: BenchSnapshot;
}

export interface Bench {
  id: string;
  /** 修订号：每次本地编辑 +1；导入快进时取来源修订号；核对解决后取双方较大值 +1 */
  revision: number;
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
  /** 公开备注：核对通过后对普通浏览者可见 */
  review: string;
  /** 内部备注：仅巡查员可见 */
  internalReview?: string;
  experiences: BenchExperience[];
  createdAt: string;
  updatedAt: string;
  /** 最后修改者（巡查员代号） */
  lastModifiedBy?: string;
  /** 上次与外部设备同步时的基线快照 */
  synced?: SyncBase;
}

/** 字段级冲突：同一字段双方都做了修改 */
export interface FieldConflict {
  field: string;
  label: string;
  /** 基线（共同祖先）值 */
  baseValue: unknown;
  /** 主档当前值 */
  localValue: unknown;
  /** 交接文件带来的值 */
  incomingValue: unknown;
}

/** 待核对项：一条长椅的字段级冲突集合 */
export interface PendingImport {
  /** 长椅稳定编号 */
  id: string;
  /** 主档版本 */
  localBench: Bench;
  /** 交接文件版本 */
  incomingBench: Bench;
  conflicts: FieldConflict[];
  detectedAt: string;
  sessionId: string;
}

/** 交接文件格式 */
export interface HandoffFile {
  format: 'bench-archive-handoff';
  version: 1;
  exportedAt: string;
  exportedBy: string;
  sourceDevice?: string;
  benches: Bench[];
}

export type ImportItemStatus = 'pending' | 'applied' | 'conflict' | 'error';

export interface ImportItemProgress {
  benchId: string;
  name: string;
  status: ImportItemStatus;
  message?: string;
  processedAt?: string;
}

/** 导入会话：断点续传的检查点 */
export interface ImportSession {
  sessionId: string;
  fileName: string;
  exportedAt: string;
  exportedBy: string;
  startedAt: string;
  updatedAt: string;
  status: 'in-progress' | 'completed' | 'failed';
  total: number;
  handoff: HandoffFile;
  items: ImportItemProgress[];
}

/** 档案统计（核对通过后重算） */
export interface ArchiveStats {
  total: number;
  avgComfort: number;
  avgRating: number;
  pendingCount: number;
  materialDist: Record<string, number>;
  townDist: Record<string, number>;
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

/** 参与合并的长椅字段（experiences 作为整体参与） */
export const BENCH_MERGE_FIELDS: { field: string; label: string }[] = [
  { field: 'name', label: '名称' },
  { field: 'location', label: '位置' },
  { field: 'lat', label: '纬度' },
  { field: 'lng', label: '经度' },
  { field: 'material', label: '材质' },
  { field: 'orientation', label: '朝向' },
  { field: 'hasBackrest', label: '靠背' },
  { field: 'shadeLevel', label: '遮阴' },
  { field: 'noiseLevel', label: '噪音' },
  { field: 'stayDuration', label: '停留时长' },
  { field: 'rating', label: '评分' },
  { field: 'review', label: '公开备注' },
  { field: 'internalReview', label: '内部备注' },
];
