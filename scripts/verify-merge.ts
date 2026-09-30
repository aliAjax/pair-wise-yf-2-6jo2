// 场景验证：三方合并 / 修订号 / 断点续传 / 迁移 / 冲突核对
// Node 环境垫片：storage 层在浏览器中使用 localStorage
const memStore = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => (memStore.has(k) ? memStore.get(k)! : null),
  setItem: (k: string, v: string) => void memStore.set(k, v),
  removeItem: (k: string) => void memStore.delete(k),
};

import { mergeEntry, equalish } from '../src/utils/merge';
import type { Bench } from '../src/types';
import { migrateBench, ensureBenchMeta } from '../src/utils/storage';
import { resumeImport, makeImportJob, resolveConflict } from '../src/utils/handoff';
import type { ArchiveDB, HandoffFile, HandoffEntry } from '../src/types';

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
function eq(a: unknown, b: unknown) {
  return equalish(a, b);
}

function bench(over: Partial<Bench> = {}): Bench {
  return {
    id: 'b1',
    name: '梧桐长椅',
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
    review: '很好',
    experiences: [],
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    rev: 1,
    reviewed: true,
    ...over,
  };
}
const ctx = { now: '2024-05-01T00:00:00Z', incomingInspector: '巡查员乙', incomingDevice: 'dev-2', sourceExportedAt: '2024-05-01T00:00:00Z' };

console.log('1) 旧数据迁移为初始版本');
{
  const raw = { id: 'x1', name: '老长椅', location: '街边' } as Partial<Bench>;
  const m = migrateBench(raw);
  assert(m.rev === 1, '迁移后 rev=1');
  assert(m.reviewed === true, '迁移历史数据默认已核对公开');
  assert(m.lastEditor?.includes('迁移'), '标注为历史数据迁移');
  const m2 = ensureBenchMeta({ id: 'x2', name: 'n', rev: 3, lastEditor: '乙' }, '甲', 'dev-1');
  assert(m2.rev === 3 && m2.lastEditor === '乙', '交接文件已有修订号时保留 rev=3 与修改人');
}

console.log('2) 只有离线方改字段 -> 自动并入，修订号 +1');
{
  const base = bench({ rev: 3 });
  const local = bench({ rev: 3 });
  const incoming = bench({ rev: 4, name: '改名后的长椅', shadeLevel: 'none' });
  const out = mergeEntry(base, local, incoming, ctx);
  assert(out.status === 'merged', '状态 merged');
  assert(out.merged!.name === '改名后的长椅', 'name 并入');
  assert(out.merged!.shadeLevel === 'none', 'shadeLevel 并入');
  assert(out.merged!.location === '人民公园', '未改字段保留');
  assert(out.merged!.rev === 5, '修订号 max(3,4)+1=5');
  assert(out.appliedFields.length === 2, '报告 2 个自动并入字段');
  assert(out.merged!.reviewed === true, '无歧义快进合并保持已公开，不需重新核对');
}

console.log('3) 只有本机改字段 -> 保留本机，无冲突');
{
  const base = bench({ rev: 3 });
  const local = bench({ rev: 4, rating: 2 });
  const incoming = bench({ rev: 3 });
  const out = mergeEntry(base, local, incoming, ctx);
  assert(out.status === 'noop', '对端无变化 -> noop');
  // 对端落后但未改：不应覆盖本机 rating
  assert(out.merged === null, '不产生写入');
}

console.log('4) 双方改不同字段 -> 各自保留，自动合并');
{
  const base = bench({ rev: 2 });
  const local = bench({ rev: 3, name: '本机改名' });
  const incoming = bench({ rev: 3, rating: 1 });
  const out = mergeEntry(base, local, incoming, ctx);
  assert(out.status === 'merged', '不同字段自动合并');
  assert(out.merged!.name === '本机改名', '本机字段保留');
  assert(out.merged!.rating === 1, '对端字段并入');
}

console.log('5) 双方改同一字段且不同 -> 冲突，两版都保留');
{
  const base = bench({ rev: 2, review: '原文' });
  const local = bench({ rev: 3, review: '本机改成 A' });
  const incoming = bench({ rev: 4, review: '离线改成 B' });
  const out = mergeEntry(base, local, incoming, ctx);
  assert(out.status === 'conflict', '状态 conflict');
  assert(!!out.conflict, '生成待核对记录');
  assert(eq(out.conflict!.fields.review.base, '原文'), '冲突保留基准值');
  assert(eq(out.conflict!.fields.review.local, '本机改成 A'), '冲突保留本机值');
  assert(eq(out.conflict!.fields.review.incoming, '离线改成 B'), '冲突保留对端值');
  // 冲突字段在主档中先保留本机版本
  assert(out.merged!.review === '本机改成 A', '主档先取本机版本，待核对');
  assert(out.merged!.rev === 5, '冲突也推进修订号 max+1');
}

console.log('6) 双方改成相同值 -> 不算冲突');
{
  const base = bench({ rev: 1, name: '旧名' });
  const local = bench({ rev: 2, name: '相同新名' });
  const incoming = bench({ rev: 2, name: '相同新名' });
  const out = mergeEntry(base, local, incoming, ctx);
  assert(out.status !== 'conflict', '同值不冲突');
}

console.log('7) 时段体验按编号合并：一方新增/修改/删除');
{
  const e1 = { id: 'e1', benchId: 'b1', timePeriod: 'morning' as const, notes: '原备注', rating: 3 };
  const base = bench({ rev: 1, experiences: [e1] });
  const local = bench({
    rev: 2,
    experiences: [
      { ...e1, notes: '本机修改备注' },
      { id: 'e2', benchId: 'b1', timePeriod: 'noon' as const, notes: '本机新增', rating: 4 },
    ],
  });
  const incoming = bench({
    rev: 2,
    experiences: [
      e1,
      { id: 'e3', benchId: 'b1', timePeriod: 'night' as const, notes: '离线新增', rating: 5 },
    ],
  });
  const out = mergeEntry(base, local, incoming, ctx);
  assert(out.status === 'merged', '时段不同动作自动合并');
  const ids = out.merged!.experiences.map((e) => e.id).sort();
  assert(eq(ids, ['e1', 'e2', 'e3']), '三条时段都在（本机改 e1 + 本机新增 e2 + 离线新增 e3）');
  const m1 = out.merged!.experiences.find((e) => e.id === 'e1')!;
  assert(m1.notes === '本机修改备注', '本机对 e1 的修改保留');
}

console.log('8) 同一时段备注双方都改 -> 字段级冲突');
{
  const e1 = { id: 'e1', benchId: 'b1', timePeriod: 'morning' as const, notes: '原', rating: 3 };
  const base = bench({ rev: 1, experiences: [e1] });
  const local = bench({ rev: 2, experiences: [{ ...e1, notes: '甲改' }] });
  const incoming = bench({ rev: 2, experiences: [{ ...e1, notes: '乙改' }] });
  const out = mergeEntry(base, local, incoming, ctx);
  assert(out.status === 'conflict', '时段备注冲突');
  assert(!!out.conflict!.fields['experience:e1:notes'], '冲突路径 experience:e1:notes');
}

console.log('9) 离线新建长椅 -> 并入且待核对');
{
  const incoming = bench({ id: 'new-9', rev: 1, reviewed: false });
  const out = mergeEntry(null, undefined, incoming, ctx);
  assert(out.status === 'merged', '新长椅并入');
  assert(out.merged!.id === 'new-9' && out.merged!.reviewed === false, '新长椅待核对');
}

console.log('10) 主档已删除但离线改过 -> 恢复并入');
{
  const base = bench({ rev: 2 });
  const incoming = bench({ rev: 3, name: '离线继续维护' });
  const out = mergeEntry(base, undefined, incoming, ctx);
  assert(out.status === 'merged', '恢复');
  assert(out.merged!.name === '离线继续维护', '内容为离线版本');
}

console.log('11) 可恢复导入：失败后从断点继续，已完成部分保留');
{
  const entries: HandoffEntry[] = ['a', 'b', 'c'].map((k) => ({
    benchId: k,
    baseRev: 0,
    baseSnapshot: null,
    bench: bench({ id: k, name: `新长椅 ${k}` }),
  }));
  const file: HandoffFile = {
    format: 'bench-handoff', formatVersion: 1, deviceId: 'dev-2',
    inspector: '乙', exportedAt: '2024-05-01T00:00:00Z', entries,
  };
  const db: ArchiveDB = {
    version: 1, benches: [], conflicts: [], sync: { ledger: {} },
    deviceId: 'dev-1', inspector: '甲', role: 'inspector', pendingImport: null,
    lastMutationAt: '',
  };
  const job = makeImportJob(file, 'handoff.json');

  // 模拟第二条在合并时抛错：临时给 ensureBenchMeta 无法处理的情况——用畸形 bench
  // 改为直接调用两次并手动制造：先正常跑完 a；把 b 的 bench 置为非法 id 不一致由 resume 不经 parse 校验，
  // 因此用 null 快照 + bench 缺字段仍能迁移。这里改为验证“切片续跑”语义：
  const res = resumeImport(db, job);
  assert(res.job.nextIndex === 3 && res.job.status === 'done', '三条全部处理完成');
  assert(res.db.benches.length === 3, '主档有 3 条长椅');
  assert(res.job.results.length === 3, '结果 3 条');

  // 断点语义：把 nextIndex 人为回退到 1 并塞一个 error 结果，resume 后不应重复第 0 条
  const partial: typeof job = {
    ...JSON.parse(JSON.stringify(job)),
    nextIndex: 1,
    status: 'running' as const,
    results: [res.job.results[0], { benchId: 'b', name: '新长椅 b', status: 'error' as const, message: 'boom' }],
  };
  db.benches = db.benches.filter((x) => x.id === 'a');
  const res2 = resumeImport(db, partial);
  assert(res2.job.results.length === 3, '续跑结果总数仍为 3（失败条结果被重跑替换）');
  assert(res2.db.benches.length === 3, '主档补齐为 3 条，a 未被重复写入');
  assert(res2.db.benches.filter((x) => x.id === 'a').length === 1, '已完成的 a 未重复');
}

console.log('12) 冲突核对通过后：字段定稿、rev+1、公开备注写入、冲突出列');
{
  // rating 双方都改成不同值 -> 成为冲突字段；review 仅本机改、对端未改 -> 自动保留
  const base = bench({ rev: 1, review: '原', rating: 4 });
  const local = bench({ rev: 2, review: '甲改评价', rating: 5 });
  const incoming = bench({ rev: 2, review: '原', rating: 2 });
  const out = mergeEntry(base, local, incoming, ctx);
  assert(out.status === 'conflict', 'rating 冲突');
  assert(eq(out.merged!.review, '甲改评价'), 'review 仅本机改，自动保留');
  const db: ArchiveDB = {
    version: 1, benches: [out.merged!], conflicts: [out.conflict!], sync: { ledger: {} },
    deviceId: 'dev-1', inspector: '甲', role: 'inspector', pendingImport: null, lastMutationAt: '',
  };
  const next = resolveConflict(db, out.conflict!, {
    choices: {
      rating: { pick: 'custom', custom: 3 },
    },
    publicNotes: '核对后对外结论',
    reviewedBy: '甲',
  });
  const b = next.benches[0];
  assert(b.rating === 3, 'rating 采用自定义值 3');
  assert(b.review === '甲改评价', '本机评价在自动合并中保留');
  assert(b.reviewed === true && b.publicNotes === '核对后对外结论', '已核对并写入公开备注');
  assert(b.rev === (out.merged!.rev ?? 1) + 1, '核对后 rev 再 +1');
  assert(next.conflicts.length === 0, '冲突出列');
}

console.log('13) 稳定编号贯穿：导入不改变 id');
{
  const base = bench({ id: 'stable-id-xyz', rev: 1 });
  const local = bench({ id: 'stable-id-xyz', rev: 2, name: '本机名' });
  const incoming = bench({ id: 'stable-id-xyz', rev: 2, name: '离线名' });
  const out = mergeEntry(base, local, incoming, ctx);
  assert(!!out.conflict && out.merged!.id === 'stable-id-xyz', '编号保持稳定（即便冲突）');
}

console.log('14) 首次下发已公开长椅 -> 直接可见，不进待核对');
{
  // 主档 C 把已核对长椅发给从未见过它的设备 F：base=null，local 不存在
  const incoming = bench({ id: 'dist-1', rev: 1, reviewed: true, publicNotes: '公开内容' });
  const out = mergeEntry(null, undefined, incoming, ctx);
  assert(out.status === 'merged', '已公开长椅首次下发自动并入');
  assert(out.merged!.reviewed === true, '保持已核对公开');
  assert(out.merged!.publicNotes === '公开内容', '公开备注随档到达');
}

console.log('15) 离线新建未核对长椅 -> 进入待核对');
{
  const incoming = bench({ id: 'field-new', rev: 1, reviewed: false });
  const out = mergeEntry(null, undefined, incoming, ctx);
  assert(out.merged!.reviewed === false, '离线新建需核对后公开');
}

console.log('16) 多设备共同祖先：按 长椅×设备 取基准，不串台');
{
  // C 已分别与 dev-A（r2）、dev-B（r3）同步；A 基于 r2 的改动不应拿 B 的 r3 当基准
  const baseA = bench({ rev: 2, review: 'r2时的评价' });
  const localC = bench({ rev: 4, review: 'C在r3之后继续改的评价', rating: 4 });
  const incomingA = bench({ rev: 3, review: 'A基于r2改的评价' });
  const outA = mergeEntry(baseA, localC, incomingA, {
    ...ctx, incomingDevice: 'dev-A',
  });
  // 相对 r2：A 改了 review；C 也改了 review -> 冲突；rating 仅 C 改保留
  assert(outA.status === 'conflict', 'A 的改动与 C 冲突（基准是 r2 而非 r3）');
  assert(eq(outA.conflict!.fields.review.incoming, 'A基于r2改的评价'), '冲突记录 A 的版本');
  assert(outA.merged!.rating === 4, '仅本机改的 rating 保留');
}

console.log('17) 星型多设备：A/B 基于同一基线改不同字段，轮流回传主档均自动并入');
{
  // r1 基线
  const r1 = bench({ rev: 1, name: '原名', location: '原位', review: '原评' });
  // 主档 C：r1
  // A 基于 r1 改 name；B 也基于 r1 改 location
  const aChange = bench({ rev: 2, name: 'A改的名', location: '原位', review: '原评' });
  const bChange = bench({ rev: 2, name: '原名', location: 'B改的位置', review: '原评' });

  // C 先并入 A（基准 r1）
  const afterA = mergeEntry(r1, r1, aChange, { ...ctx, incomingDevice: 'dev-A' });
  assert(afterA.status === 'merged' && afterA.merged!.name === 'A改的名', 'C 并入 A 的 name');
  const cAfterA = afterA.merged!; // rev 2

  // B 回传，基准也是 r1（B 只见过 r1）。相对 r1：B 改了 location，C 改了 name -> 不同字段
  const afterB = mergeEntry(r1, cAfterA, bChange, { ...ctx, incomingDevice: 'dev-B' });
  assert(afterB.status === 'merged', 'B 与主档改不同字段，无冲突自动并入');
  assert(afterB.merged!.name === 'A改的名', 'A 的 name 保留');
  assert(afterB.merged!.location === 'B改的位置', 'B 的 location 并入');
  assert(afterB.merged!.review === '原评', '无人改动的 review 不变');
}

console.log('18) 星型多设备：A/B 基于同一基线改同一字段 -> 后到者进待核对（两版保留）');
{
  const r1 = bench({ rev: 1, review: '原评' });
  const aChange = bench({ rev: 2, review: 'A的评价' });
  const bChange = bench({ rev: 2, review: 'B的评价' });
  const afterA = mergeEntry(r1, r1, aChange, { ...ctx, incomingDevice: 'dev-A' });
  const afterB = mergeEntry(r1, afterA.merged!, bChange, { ...ctx, incomingDevice: 'dev-B' });
  assert(afterB.status === 'conflict', '同字段都改 -> B 看到冲突，不覆盖 A');
  assert(eq(afterB.conflict!.fields.review.local, 'A的评价'), '待核对保留 A 版');
  assert(eq(afterB.conflict!.fields.review.incoming, 'B的评价'), '待核对保留 B 版');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
// 存储层在浏览器中使用的 BroadcastChannel 会让 Node 事件循环保持，显式退出
process.exit(failed > 0 ? 1 : 0);
