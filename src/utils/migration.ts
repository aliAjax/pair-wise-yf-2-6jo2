import type { Bench, BenchSnapshot } from '@/types';
import { snapshotOf } from './merge';

/**
 * 旧数据迁移：
 *  - 没有修订号 → 初始版本 1
 *  - 没有同步基线 → 以当前数据建立基线（迁移后首次导入即可做三方合并）
 *  - 补齐内部备注字段
 */
export function migrateBench(raw: Bench): Bench {
  const bench: Bench = { ...raw };

  if (typeof bench.revision !== 'number' || bench.revision < 1) {
    bench.revision = 1;
  }
  if (typeof bench.internalReview !== 'string') {
    bench.internalReview = '';
  }
  if (!bench.synced) {
    const at = bench.updatedAt || bench.createdAt || new Date().toISOString();
    const snapshot: BenchSnapshot = snapshotOf(bench);
    bench.synced = { at, by: 'migration', data: snapshot };
  }
  return bench;
}

export function migrateBenches(raw: Bench[]): Bench[] {
  return raw.map(migrateBench);
}
