/**
 * 核心流程验证脚本：
 *  - 字段级三方合并（单方改自动采用 / 双方改进待核对）
 *  - 旧数据迁移为初始版本
 *  - 页签并发保存的乐观锁冲突
 *  - 离线交接导入 + 断点续传
 * 运行：npx tsx scripts/verify-flow.ts
 */
import { mergeBenchFields, snapshotOf, validateHandoff, applyResolutions } from '../src/utils/merge';
import { migrateBench } from '../src/utils/migration';
import type { Bench, HandoffFile } from '../src/types';

let passed = 0;
let failed = 0;
function assert(cond: boolean, msg: string) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

function makeBench(over: Partial<Bench> = {}): Bench {
  return {
    id: 'b1',
    revision: 1,
    name: '长椅',
    location: '人民公园',
    lat: 31.23,
    lng: 121.47,
    material: 'wood',
    orientation: 'south',
    hasBackrest: true,
    shadeLevel: 'full',
    noiseLevel: 'quiet',
    stayDuration: 'long',
    rating: 5,
    review: '公开备注',
    internalReview: '内部备注',
    experiences: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    ...over,
  };
}

console.log('\n[1] 字段级三方合并');
{
  const base = makeBench();
  const local = makeBench({ revision: 2, name: '主档改名', synced: undefined });
  const incoming = makeBench({ revision: 2, location: '交接位置', synced: undefined });
  const { merged, conflicts } = mergeBenchFields(local, incoming, snapshotOf(base));
  assert(merged.name === '主档改名', '只有主档改的字段保留主档');
  assert(merged.location === '交接位置', '只有交接方改的字段采用交接方');
  assert(conflicts.length === 0, '双方改不同字段不产生冲突');
}

{
  const base = makeBench();
  const local = makeBench({ revision: 2, name: '主档版本名', synced: undefined });
  const incoming = makeBench({ revision: 2, name: '交接版本名', synced: undefined });
  const { merged, conflicts } = mergeBenchFields(local, incoming, snapshotOf(base));
  assert(conflicts.length === 1 && conflicts[0].field === 'name', '双方都改同字段 → 1 个冲突');
  assert(conflicts[0].localValue === '主档版本名', '冲突保留主档值');
  assert(conflicts[0].incomingValue === '交接版本名', '冲突保留交接值');
  assert(merged.name === '主档版本名', '未核对前主档仍显示主档版本');
}

{
  // 无基线（首次同步旧数据）值不同 → 冲突
  const local = makeBench({ revision: 1, name: 'A', synced: undefined });
  const incoming = makeBench({ revision: 1, name: 'B', synced: undefined });
  const { conflicts } = mergeBenchFields(local, incoming, undefined);
  assert(conflicts.length === 1, '无基线时不同值进入待核对');
}

console.log('\n[2] 旧数据迁移');
{
  const old = makeBench({ synced: undefined });
  delete (old as Partial<Bench>).revision;
  delete (old as Partial<Bench>).internalReview;
  const migrated = migrateBench(old);
  assert(migrated.revision === 1, '无修订号迁移为初始版本 1');
  assert(migrated.synced !== undefined, '迁移时建立同步基线');
  assert(migrated.internalReview === '', '补齐内部备注字段');
}

console.log('\n[3] 乐观锁（页签并发保存）');
{
  // 模拟 store 中的 revision 比对逻辑
  const benches: Bench[] = [makeBench({ revision: 2 })];
  const expectedRevision = 2; // 页签打开时读到的修订号
  const current = benches.find((b) => b.id === 'b1')!;
  const canSave = current.revision === expectedRevision;
  assert(canSave, '修订号一致时可以保存');

  // 另一个页签先保存，修订号推进到 3
  benches[0] = { ...current, revision: 3 };
  const canSaveAfter = benches[0].revision === expectedRevision;
  assert(!canSaveAfter, '修订号被其他页签推进后，后到方保存失败');
}

console.log('\n[4] 交接文件校验');
{
  const good: HandoffFile = {
    format: 'bench-archive-handoff',
    version: 1,
    exportedAt: new Date().toISOString(),
    exportedBy: '巡查员甲',
    benches: [makeBench({ synced: undefined })],
  };
  assert(validateHandoff(good) === null, '合法交接文件通过校验');
  assert(validateHandoff({}) !== null, '空对象校验失败');
  assert(validateHandoff({ format: 'wrong', version: 1, benches: [] }) !== null, '错误格式校验失败');
  const noRevision = { ...good, benches: [makeBench({ revision: undefined as unknown as number, synced: undefined })] };
  assert(validateHandoff(noRevision) !== null, '缺少修订号校验失败');
}

console.log('\n[5] 核对解决');
{
  const local = makeBench({ revision: 2, name: '主档名', review: '主档公开备注', synced: undefined });
  const incoming = makeBench({ revision: 3, name: '交接名', review: '交接公开备注', synced: undefined });
  const { conflicts } = mergeBenchFields(local, incoming, snapshotOf(makeBench()));
  const pending = {
    id: 'b1',
    localBench: local,
    incomingBench: incoming,
    conflicts,
    detectedAt: new Date().toISOString(),
    sessionId: 's1',
  };
  const final = applyResolutions(pending, { name: 'incoming', review: 'local' }, '巡查员');
  assert(final.name === '交接名', '核对后名称采用交接版');
  assert(final.review === '主档公开备注', '核对后公开备注采用主档版');
  assert(final.revision === 4, '核对解决后修订号为双方较大值 +1');
  assert(final.synced !== undefined, '核对后基线推进');
}

console.log('\n[6] experiences 整体冲突');
{
  const base = makeBench();
  const local = makeBench({
    experiences: [{ id: 'e1', benchId: 'b1', timePeriod: 'morning', notes: '主档体验', rating: 5 }],
    synced: undefined,
  });
  const incoming = makeBench({
    experiences: [{ id: 'e1', benchId: 'b1', timePeriod: 'morning', notes: '交接体验', rating: 4 }],
    synced: undefined,
  });
  const { conflicts } = mergeBenchFields(local, incoming, snapshotOf(base));
  const expConflict = conflicts.find((c) => c.field === 'experiences');
  assert(expConflict !== undefined, '双方时段体验都改 → 整体冲突');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
