import {
  BENCH_FIELDS,
  type Bench,
  type BenchExperience,
  type ConflictEntry,
  type FieldPath,
} from '@/types';

/** JSON 级相等：用于判断字段相对基准是否发生变化 */
export function equalish(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return a === b;
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false;
  }
}

type ExpMap = Map<string, BenchExperience>;

function expMap(bench: Bench | null | undefined): ExpMap {
  const m: ExpMap = new Map();
  for (const e of bench?.experiences ?? []) m.set(e.id, e);
  return m;
}

const EXP_SUBFIELDS = ['timePeriod', 'rating', 'notes'] as const;

export interface MergeContext {
  now: string;
  incomingInspector: string;
  incomingDevice: string;
  sourceExportedAt: string;
}

export interface MergeOutcome {
  /** merged=已自动并入；conflict=有字段待核对（其余字段已并入）；noop=无变化 */
  status: 'merged' | 'conflict' | 'noop';
  /** 写回主档的长椅；noop 时为 null */
  merged: Bench | null;
  /** 待核对记录（status=conflict 时存在） */
  conflict: ConflictEntry | null;
  /** 本次自动并入的字段路径，用于导入报告 */
  appliedFields: FieldPath[];
  message: string;
}

/**
 * 三方合并单条交接条目。
 * @param base 共同基准（上次同步点快照），离线新建时为 null
 * @param local 主档当前版本，主档不存在时为 undefined
 * @param incoming 交接文件中的版本
 */
export function mergeEntry(
  base: Bench | null,
  local: Bench | undefined,
  incoming: Bench,
  ctx: MergeContext,
): MergeOutcome {
  // 情况一：接收方没有该长椅
  if (!base) {
    if (!local) {
      const inserted: Bench = {
        ...incoming,
        rev: Math.max(1, incoming.rev ?? 1),
        // 尊重来源核对状态：首次下发的已公开长椅直接可见；离线新建（未核对）需核对后公开
        reviewed: incoming.reviewed ?? false,
        lastEditor: incoming.lastEditor ?? ctx.incomingInspector,
        lastDevice: incoming.lastDevice ?? ctx.incomingDevice,
        updatedAt: incoming.updatedAt ?? ctx.now,
      };
      return {
        status: 'merged',
        merged: inserted,
        conflict: null,
        appliedFields: ['(new)'],
        message: inserted.reviewed ? '新增长椅（已核对）' : '新增长椅，等待核对',
      };
    }
    // 极小概率：双方用相同稳定编号各自新建 —— 逐字段比对，不同即冲突
    return mergeDivergedCreation(local, incoming, ctx);
  }

  // 情况二：主档中已不存在（本机删除过）—— 按交接内容恢复并入
  if (!local) {
    const restored: Bench = {
      ...incoming,
      rev: Math.max(incoming.rev ?? base.rev ?? 1, 1) + 1,
      reviewed: incoming.reviewed ?? false,
      lastEditor: incoming.lastEditor ?? ctx.incomingInspector,
      lastDevice: incoming.lastDevice ?? ctx.incomingDevice,
      updatedAt: ctx.now,
    };
    return {
      status: 'merged',
      merged: restored,
      conflict: null,
      appliedFields: ['(restore)'],
      message: '主档缺失，已按交接文件恢复',
    };
  }

  const fields: Record<FieldPath, { base: unknown; local: unknown; incoming: unknown }> = {};
  const appliedFields: FieldPath[] = [];
  // 以主档为基底，逐字段吸收可自动并入的修改
  const patch: Partial<Bench> = {};

  for (const f of BENCH_FIELDS) {
    const bv = base[f];
    const lv = local[f];
    const iv = incoming[f];
    const localChanged = !equalish(lv, bv);
    const incomingChanged = !equalish(iv, bv);

    if (!localChanged && !incomingChanged) continue;
    if (incomingChanged && !localChanged) {
      (patch as Record<string, unknown>)[f] = iv;
      appliedFields.push(f);
    } else if (localChanged && !incomingChanged) {
      // 本机修改保留
    } else if (equalish(lv, iv)) {
      // 双方改成相同值
    } else {
      fields[f] = { base: bv, local: lv, incoming: iv };
    }
  }

  // ---- 时段体验：按稳定编号三方合并 ----
  const bExp = expMap(base);
  const lExp = expMap(local);
  const iExp = expMap(incoming);
  const mergedExperiences: BenchExperience[] = [];
  const allIds = new Set([...bExp.keys(), ...lExp.keys(), ...iExp.keys()]);

  for (const expId of allIds) {
    const be = bExp.get(expId);
    const le = lExp.get(expId);
    const ie = iExp.get(expId);

    if (be && !le && ie) {
      // 本机删除、对端保留
      if (EXP_SUBFIELDS.every((s) => equalish(ie[s], be[s]))) continue; // 对端没改，删除生效
      // 对端也改了已删除的记录 → 冲突，先保留对端版本待核对
      mergedExperiences.push(ie);
      fields[`experience:${expId}`] = { base: be, local: undefined, incoming: ie };
      continue;
    }
    if (be && le && !ie) {
      // 对端删除、本机保留
      const localTouched = EXP_SUBFIELDS.some((s) => !equalish(le[s], be[s]));
      if (!localTouched) continue; // 本机没改，删除生效
      mergedExperiences.push(le);
      fields[`experience:${expId}`] = { base: be, local: le, incoming: undefined };
      continue;
    }
    if (!be) {
      // 新增的时段
      if (le && ie) {
        const kept: BenchExperience = { ...le, benchId: local.id };
        for (const s of EXP_SUBFIELDS) {
          if (!equalish(le[s], ie[s])) {
            fields[`experience:${expId}:${s}`] = {
              base: undefined,
              local: le[s],
              incoming: ie[s],
            };
          }
        }
        mergedExperiences.push(kept);
      } else if (ie) {
        mergedExperiences.push(ie);
        appliedFields.push(`experience:${expId}`);
      } else if (le) {
        mergedExperiences.push(le);
      }
      continue;
    }
    if (le && ie) {
      const kept: BenchExperience = { ...le, benchId: local.id };
      let changedByIncoming = false;
      for (const s of EXP_SUBFIELDS) {
        const localChanged = !equalish(le[s], be[s]);
        const incomingChanged = !equalish(ie[s], be[s]);
        if (incomingChanged && !localChanged) {
          (kept as unknown as Record<string, unknown>)[s] = ie[s];
          changedByIncoming = true;
        } else if (localChanged && incomingChanged && !equalish(le[s], ie[s])) {
          fields[`experience:${expId}:${s}`] = {
            base: be[s],
            local: le[s],
            incoming: ie[s],
          };
        }
      }
      if (changedByIncoming) appliedFields.push(`experience:${expId}`);
      mergedExperiences.push(kept);
    }
  }

  const hasConflict = Object.keys(fields).length > 0;
  const incomingTouched = appliedFields.length > 0 || hasConflict;

  if (!incomingTouched) {
    return {
      status: 'noop',
      merged: null,
      conflict: null,
      appliedFields: [],
      message: '交接版本与主档一致，跳过',
    };
  }

  const merged: Bench = {
    ...local,
    ...patch,
    experiences: mergedExperiences,
    rev: Math.max(local.rev ?? 1, incoming.rev ?? 1) + 1,
    updatedAt: ctx.now,
    lastEditor: ctx.incomingInspector,
    lastDevice: ctx.incomingDevice,
    // 仅在双方都改过同一字段时进入待核对；无歧义的快进合并保持原核对/公开状态
    reviewed: hasConflict ? false : local.reviewed ?? false,
  };

  if (!hasConflict) {
    return {
      status: 'merged',
      merged,
      conflict: null,
      appliedFields,
      message: `自动并入 ${appliedFields.length} 个字段`,
    };
  }

  const conflict: ConflictEntry = {
    benchId: local.id,
    detectedAt: ctx.now,
    fields,
    localBench: local,
    incomingBench: incoming,
    incomingInspector: ctx.incomingInspector,
    incomingDevice: ctx.incomingDevice,
    localRev: local.rev ?? 1,
    incomingRev: incoming.rev ?? 1,
    sourceExportedAt: ctx.sourceExportedAt,
  };

  return {
    status: 'conflict',
    merged,
    conflict,
    appliedFields,
    message: `${Object.keys(fields).length} 个字段双方都改过，已保留两版待核对`,
  };
}

/** 相同稳定编号各自新建的罕见情况：值相同取其一，不同则全部进冲突 */
function mergeDivergedCreation(local: Bench, incoming: Bench, ctx: MergeContext): MergeOutcome {
  const fields: Record<FieldPath, { base: unknown; local: unknown; incoming: unknown }> = {};
  const appliedFields: FieldPath[] = [];

  for (const f of BENCH_FIELDS) {
    if (!equalish(local[f], incoming[f])) {
      fields[f] = { base: undefined, local: local[f], incoming: incoming[f] };
    }
  }

  const lExp = expMap(local);
  const iExp = expMap(incoming);
  const mergedExperiences = [...local.experiences];
  for (const [expId, ie] of iExp) {
    const le = lExp.get(expId);
    if (!le) {
      mergedExperiences.push(ie);
      appliedFields.push(`experience:${expId}`);
    } else {
      for (const s of EXP_SUBFIELDS) {
        if (!equalish(le[s], ie[s])) {
          fields[`experience:${expId}:${s}`] = {
            base: undefined,
            local: le[s],
            incoming: ie[s],
          };
        }
      }
    }
  }

  const hasConflict = Object.keys(fields).length > 0;
  const merged: Bench = {
    ...local,
    experiences: mergedExperiences,
    rev: Math.max(local.rev ?? 1, incoming.rev ?? 1) + 1,
    updatedAt: ctx.now,
    lastEditor: ctx.incomingInspector,
    lastDevice: ctx.incomingDevice,
    reviewed: false,
  };

  if (!hasConflict) {
    return {
      status: 'merged',
      merged,
      conflict: null,
      appliedFields,
      message: '双方新建内容一致，已并入',
    };
  }

  return {
    status: 'conflict',
    merged,
    conflict: {
      benchId: local.id,
      detectedAt: ctx.now,
      fields,
      localBench: local,
      incomingBench: incoming,
      incomingInspector: ctx.incomingInspector,
      incomingDevice: ctx.incomingDevice,
      localRev: local.rev ?? 1,
      incomingRev: incoming.rev ?? 1,
      sourceExportedAt: ctx.sourceExportedAt,
    },
    appliedFields,
    message: `${Object.keys(fields).length} 个字段双方新建内容不一致，待核对`,
  };
}
