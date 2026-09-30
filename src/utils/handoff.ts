import type {
  ArchiveDB,
  Bench,
  BenchExperience,
  ConflictEntry,
  HandoffEntry,
  HandoffFile,
  ImportEntryResult,
  ImportJob,
} from '@/types';
import { ensureBenchMeta, saveDB } from '@/utils/storage';
import { mergeEntry } from '@/utils/merge';

// ---------- 导出 ----------

/** 生成巡查员交接文件：每条长椅附带稳定编号、修订号与给各伙伴的共同基准 */
export function createHandoffFile(db: ArchiveDB): HandoffFile {
  const entries: HandoffEntry[] = db.benches
    // 待核对中的长椅不进入新的交接，先解决本地冲突
    .filter((b) => !db.conflicts.some((c) => c.benchId === b.id))
    .map((bench) => {
      const partners = db.sync.ledger[bench.id] ?? {};
      const partnerBases: Record<string, { rev: number; snapshot: Bench }> = {};
      for (const [deviceId, point] of Object.entries(partners)) {
        partnerBases[deviceId] = {
          rev: point.rev,
          snapshot: structuredCloneSafe(point.snapshot),
        };
      }
      const hasPartners = Object.keys(partners).length > 0;
      return {
        benchId: bench.id,
        baseRev: bench.rev ?? 1,
        bench: structuredCloneSafe(bench),
        // 有伙伴记录时兜底基准=主档当前版本；从未同步过则为 null（接收方按编号是否存在区分新建/下发）
        baseSnapshot: hasPartners ? structuredCloneSafe(bench) : null,
        partnerBases: hasPartners ? partnerBases : undefined,
      } satisfies HandoffEntry;
    });

  return {
    format: 'bench-handoff',
    formatVersion: 1,
    deviceId: db.deviceId,
    inspector: db.inspector,
    exportedAt: new Date().toISOString(),
    entries,
  };
}

export function serializeHandoff(file: HandoffFile): string {
  return JSON.stringify(file, null, 2);
}

function structuredCloneSafe<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

// ---------- 解析与校验 ----------

export function parseHandoffFile(text: string): HandoffFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('不是合法的 JSON 文件，请确认选择了巡查员交接文件');
  }

  const file = parsed as Partial<HandoffFile>;
  if (!file || file.format !== 'bench-handoff') {
    throw new Error('文件头缺少 bench-handoff 标识，不是有效的交接文件');
  }
  if (file.formatVersion !== 1) {
    throw new Error(`不支持的交接文件版本：${String(file.formatVersion)}（本机支持 v1）`);
  }
  if (!Array.isArray(file.entries)) {
    throw new Error('交接文件缺少长椅条目列表');
  }
  if (!file.deviceId || !file.inspector) {
    throw new Error('交接文件缺少导出设备或巡查员信息');
  }

  for (const [i, entry] of file.entries.entries()) {
    if (!entry || typeof entry.benchId !== 'string' || !entry.bench) {
      throw new Error(`第 ${i + 1} 条缺少稳定编号或长椅数据`);
    }
    if (entry.bench.id !== entry.benchId) {
      throw new Error(`第 ${i + 1} 条（${entry.benchId}）的编号与数据不一致`);
    }
  }

  return file as HandoffFile;
}

// ---------- 可恢复导入 ----------

export interface JobRunResult {
  job: ImportJob;
  db: ArchiveDB;
  processedNow: number;
}

/**
 * 从断点继续导入。
 * 进度（nextIndex、已完成 results）持久化在 pendingImport 中，
 * 单条失败或冲突都不会回滚此前已并入的条目。
 */
export function resumeImport(db: ArchiveDB, job: ImportJob): JobRunResult {
  const work = structuredCloneSafe(job);
  // 重试：丢弃上次在 nextIndex 处失败的条目结果，从该条重新处理
  work.results = work.results.slice(0, work.nextIndex);
  const benches = db.benches.map((b) => structuredCloneSafe(b));
  const conflicts = db.conflicts.map((c) => structuredCloneSafe(c));
  const ledger = { ...db.sync.ledger };

  let processedNow = 0;

  while (work.nextIndex < work.entries.length) {
    const entry = work.entries[work.nextIndex];

    try {
      const incoming = ensureBenchMeta(entry.bench, work.inspector, work.deviceId);
      const local = benches.find((b) => b.id === entry.benchId);

      // 共同祖先基准（按优先级）：
      // 1) 发送方为本机设备号内嵌的伙伴基准；
      // 2) 本机台账中该发送设备的最近同步点；
      // 3) 文件兜底基准快照；
      // 4) 无（离线新建）。
      const receiverId = db.deviceId;
      const partnerBase = entry.partnerBases?.[receiverId]?.snapshot;
      const localLedgerBase = ledger[entry.benchId]?.[work.deviceId]?.snapshot;
      const base: Bench | null =
        partnerBase ?? localLedgerBase ?? entry.baseSnapshot ?? null;

      const outcome = mergeEntry(
        base as Bench | null,
        local,
        incoming,
        {
          now: new Date().toISOString(),
          incomingInspector: work.inspector,
          incomingDevice: work.deviceId,
          sourceExportedAt: work.exportedAt,
        },
      );

      let result: ImportEntryResult;
      if (outcome.status === 'noop') {
        result = {
          benchId: entry.benchId,
          name: incoming.name,
          status: 'merged',
          message: outcome.message,
        };
      } else if (outcome.merged) {
        const idx = benches.findIndex((b) => b.id === entry.benchId);
        if (idx >= 0) benches[idx] = outcome.merged;
        else benches.push(outcome.merged);

        if (outcome.conflict) {
          // 同一长椅重复导入时，只保留一条待核对（按编号去重，刷新为最新两版）
          const cIdx = conflicts.findIndex((c) => c.benchId === entry.benchId);
          if (cIdx >= 0) conflicts[cIdx] = outcome.conflict;
          else conflicts.push(outcome.conflict);
          result = {
            benchId: entry.benchId,
            name: incoming.name,
            status: 'conflict',
            message: outcome.message,
            appliedFields: outcome.appliedFields,
          };
        } else {
          result = {
            benchId: entry.benchId,
            name: incoming.name,
            status: 'merged',
            message: outcome.message,
            appliedFields: outcome.appliedFields,
          };
        }

        // 记录与该发送设备的共同祖先（按 长椅×设备 二维台账，多设备轮流交接不串基准）
        const perBench = ledger[entry.benchId] ?? {};
        perBench[work.deviceId] = {
          rev: incoming.rev ?? 1,
          snapshot: incoming,
          at: new Date().toISOString(),
        };
        ledger[entry.benchId] = perBench;
      } else {
        result = {
          benchId: entry.benchId,
          name: incoming.name,
          status: 'error',
          message: '合并未产出结果',
        };
      }

      work.results.push(result);
    } catch (err) {
      // 单条失败：记录后中断，已完成条目保留；下次 resume 从本条继续
      work.results.push({
        benchId: entry.benchId,
        name: entry.bench?.name ?? entry.benchId,
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
      work.status = 'running';
      db.benches = benches;
      db.conflicts = conflicts;
      db.sync = { ledger };
      db.pendingImport = work;
      saveDB(db);
      return { job: work, db, processedNow };
    }

    work.nextIndex += 1;
    processedNow += 1;

    // 每处理一条就落盘一次进度 —— 中断/刷新都可从已完成部分继续
    db.benches = benches;
    db.conflicts = conflicts;
    db.sync = { ledger };
    db.pendingImport = work;
    saveDB(db);
  }

  work.status = 'done';
  db.benches = benches;
  db.conflicts = conflicts;
  db.sync = { ledger };
  db.pendingImport = work;
  saveDB(db);
  return { job: work, db, processedNow };
}

export function makeImportJob(file: HandoffFile, fileName: string): ImportJob {
  return {
    id: 'job-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fileName,
    inspector: file.inspector,
    deviceId: file.deviceId,
    exportedAt: file.exportedAt,
    startedAt: new Date().toISOString(),
    entries: file.entries,
    nextIndex: 0,
    results: [],
    status: 'running',
  };
}

// ---------- 核对 ----------

export interface ReviewDecision {
  /** 冲突字段路径 -> 选用版本或自定义值 */
  choices: Record<string, { pick: 'local' | 'incoming' | 'custom'; custom?: unknown }>;
  publicNotes: string;
  reviewedBy: string;
}

/** 核对通过：按决定合并字段、版本号 +1、写入公开备注，冲突出列 */
export function resolveConflict(
  db: ArchiveDB,
  conflict: ConflictEntry,
  decision: ReviewDecision,
): ArchiveDB {
  const benches = db.benches.map((b) => structuredCloneSafe(b));
  const bench = benches.find((b) => b.id === conflict.benchId);
  if (!bench) throw new Error('主档中找不到该长椅，无法核对');

  for (const [path, choice] of Object.entries(decision.choices)) {
    const field = conflict.fields[path];
    if (!field) continue;
    const value =
      choice.pick === 'local'
        ? field.local
        : choice.pick === 'incoming'
          ? field.incoming
          : choice.custom;

    if (path.startsWith('experience:')) {
      const parts = path.split(':');
      const expId = parts[1];
      const sub = parts[2];
      const exp = bench.experiences.find((e) => e.id === expId);
      if (!sub) {
        // 整条记录：所选值为 undefined 表示删除该时段
        if (value === undefined) {
          bench.experiences = bench.experiences.filter((e) => e.id !== expId);
        } else if (!exp && value) {
          bench.experiences.push({ ...(value as BenchExperience), benchId: bench.id });
        }
      } else if (exp) {
        (exp as unknown as Record<string, unknown>)[sub] = value;
      }
    } else {
      (bench as unknown as Record<string, unknown>)[path] = value;
    }
  }

  bench.rev = (bench.rev ?? 1) + 1;
  bench.reviewed = true;
  bench.publicNotes = decision.publicNotes;
  bench.reviewedBy = decision.reviewedBy;
  bench.reviewedAt = new Date().toISOString();
  bench.updatedAt = bench.reviewedAt;

  const conflicts = db.conflicts.filter((c) => c.benchId !== conflict.benchId);
  db.benches = benches;
  db.conflicts = conflicts;
  saveDB(db);
  return db;
}

/** 放弃待核对：直接以主档（本机）版本为准，冲突出列但不提升为已核对 */
export function dismissConflict(db: ArchiveDB, benchId: string): ArchiveDB {
  db.conflicts = db.conflicts.filter((c) => c.benchId !== benchId);
  saveDB(db);
  return db;
}
