import type {
  Bench,
  BenchSnapshot,
  FieldConflict,
  PendingImport,
  HandoffFile,
  SyncBase,
} from '@/types';
import { BENCH_MERGE_FIELDS } from '@/types';

/** 深比较（值类型 + experiences 数组） */
export function isEqualValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a && b && typeof a === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/** 去掉 synced 基线，生成快照 */
export function snapshotOf(bench: Bench): BenchSnapshot {
  const snapshot: BenchSnapshot = { ...bench };
  delete (snapshot as { synced?: SyncBase }).synced;
  return snapshot;
}

/**
 * 字段级三方合并。
 * 规则（base 为上次同步时的共同祖先快照）：
 *  - local === incoming              → 无变化
 *  - base === local && base !== incoming → 只有导入方改了 → 采用导入方
 *  - base !== local && base === incoming → 只有主档改了 → 保留主档
 *  - base 与两者都不同               → 双方都改 → 冲突，两版留待核对
 *  - 无 base（首次同步旧数据）       → 值不同即冲突（宁可人工核对，不丢修改）
 */
export function mergeBenchFields(
  local: Bench,
  incoming: Bench,
  base?: BenchSnapshot,
): { merged: Bench; conflicts: FieldConflict[] } {
  const conflicts: FieldConflict[] = [];
  const merged: Bench = { ...local };

  for (const { field, label } of BENCH_MERGE_FIELDS) {
    const localValue = (local as unknown as Record<string, unknown>)[field];
    const incomingValue = (incoming as unknown as Record<string, unknown>)[field];
    if (isEqualValue(localValue, incomingValue)) continue;

    const baseValue = base
      ? (base as unknown as Record<string, unknown>)[field]
      : undefined;
    const localChanged = !base || !isEqualValue(baseValue, localValue);
    const incomingChanged = !base || !isEqualValue(baseValue, incomingValue);

    if (base && !localChanged && incomingChanged) {
      // 只有导入方改了 → 采用导入方
      (merged as unknown as Record<string, unknown>)[field] = incomingValue;
    } else if (base && localChanged && !incomingChanged) {
      // 只有主档改了 → 保留主档
      (merged as unknown as Record<string, unknown>)[field] = localValue;
    } else {
      // 双方都改了（或无基线）→ 冲突
      conflicts.push({ field, label, baseValue, localValue, incomingValue });
    }
  }

  // experiences 作为整体字段参与合并
  const localExps = local.experiences ?? [];
  const incomingExps = incoming.experiences ?? [];
  if (!isEqualValue(localExps, incomingExps)) {
    const baseExps = base?.experiences ?? [];
    const localChanged = !base || !isEqualValue(baseExps, localExps);
    const incomingChanged = !base || !isEqualValue(baseExps, incomingExps);
    if (base && !localChanged && incomingChanged) {
      merged.experiences = incomingExps.map((e) => ({ ...e }));
    } else if (base && localChanged && !incomingChanged) {
      merged.experiences = localExps.map((e) => ({ ...e }));
    } else {
      conflicts.push({
        field: 'experiences',
        label: '时段体验',
        baseValue: baseExps,
        localValue: localExps,
        incomingValue: incomingExps,
      });
    }
  }

  return { merged, conflicts };
}

/** 校验交接文件格式，返回错误信息（合法返回 null） */
export function validateHandoff(data: unknown): string | null {
  if (!data || typeof data !== 'object') return '文件不是有效的 JSON 对象';
  const f = data as Partial<HandoffFile>;
  if (f.format !== 'bench-archive-handoff') {
    return '文件格式不正确：缺少 bench-archive-handoff 标识';
  }
  if (f.version !== 1) return '不支持的交接文件版本';
  if (!Array.isArray(f.benches)) return '文件中缺少 benches 数组';
  for (let i = 0; i < f.benches.length; i++) {
    const b = f.benches[i] as Partial<Bench> | null;
    if (!b || typeof b !== 'object') return `第 ${i + 1} 条长椅数据无效`;
    if (typeof b.id !== 'string' || !b.id) return `第 ${i + 1} 条长椅缺少稳定编号 id`;
    if (typeof b.name !== 'string') return `第 ${i + 1} 条长椅缺少名称`;
    if (typeof b.revision !== 'number' || b.revision < 1) {
      return `长椅「${b.name ?? b.id}」缺少修订号 revision`;
    }
  }
  return null;
}

/** 应用核对决定：根据每字段选择的版本生成最终长椅 */
export function applyResolutions(
  pending: PendingImport,
  decisions: Record<string, 'local' | 'incoming'>,
  by: string,
): Bench {
  const { localBench, incomingBench, conflicts } = pending;
  const finalBench: Bench = { ...localBench };

  for (const { field } of conflicts) {
    const choice = decisions[field] ?? 'local';
    const source = choice === 'incoming' ? incomingBench : localBench;
    if (field === 'experiences') {
      finalBench.experiences = (source.experiences ?? []).map((e) => ({ ...e }));
    } else {
      const value = (source as unknown as Record<string, unknown>)[field];
      (finalBench as unknown as Record<string, unknown>)[field] = value;
    }
  }

  const maxRevision = Math.max(localBench.revision, incomingBench.revision);
  finalBench.revision = maxRevision + 1;
  finalBench.updatedAt = new Date().toISOString();
  finalBench.lastModifiedBy = by;
  // 核对解决后，基线推进到合并后的版本
  finalBench.synced = {
    at: finalBench.updatedAt,
    by,
    data: snapshotOf(finalBench),
  };
  return finalBench;
}
