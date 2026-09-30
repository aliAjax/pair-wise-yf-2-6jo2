// 端到端冒烟（最小 DOM 垫片）：迁移 -> OCC 冲突 -> 角色过滤 -> 导出/导入/核对
const mem = new Map<string, string>();
class BC {
  postMessage() {}
  close() {}
  set onmessage(_: unknown) {}
}
Object.assign(globalThis, {
  localStorage: {
    getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
    setItem: (k: string, v: string) => void mem.set(k, String(v)),
    removeItem: (k: string) => void mem.delete(k),
  },
  BroadcastChannel: BC,
  addEventListener: () => {},
  removeEventListener: () => {},
});

import { loadDB, saveDB } from '../src/utils/storage';
import { useBenchStore } from '../src/store/useBenchStore';
import { SaveConflictError } from '../src/types';
import { parseHandoffFile } from '../src/utils/handoff';
import type { Bench } from '../src/types';

let pass = 0;
let fail = 0;
const assert = (c: boolean, m: string) => {
  if (c) { pass++; console.log('  ✓', m); } else { fail++; console.error('  ✗', m); }
};

const formOf = (b: Bench) => {
  const { id, createdAt, updatedAt, experiences, rev, lastEditor, lastDevice, reviewed, publicNotes, reviewedBy, reviewedAt, ...rest } = b;
  void id; void createdAt; void updatedAt; void experiences; void rev; void lastEditor;
  void lastDevice; void reviewed; void publicNotes; void reviewedBy; void reviewedAt;
  return rest;
};

// 预置旧版数据（无 rev）
mem.set('bench-archive-data', JSON.stringify([
  {
    id: 'legacy-1', name: '老街口长椅', location: '中山路 1 号', lat: 31.2, lng: 121.4,
    material: 'wood', orientation: 'south', hasBackrest: true, shadeLevel: 'full',
    noiseLevel: 'quiet', stayDuration: 'long', rating: 5, review: '旧评价',
    experiences: [], createdAt: '2023-01-01T00:00:00Z', updatedAt: '2023-06-01T00:00:00Z',
  },
]));

console.log('A) initialize 迁移旧数据');
const store = useBenchStore.getState();
store.initialize();
let st = useBenchStore.getState();
assert(st.db!.benches.length === 1, '旧库迁移出 1 条');
assert(st.db!.benches[0].rev === 1, '迁移后 rev=1');
assert(st.db!.benches[0].reviewed === true, '历史数据默认已公开');

console.log('B) 两个页签先后保存同一长椅 -> 后到方版本冲突');
const b0 = st.db!.benches[0];
const r1 = st.saveBenchForm(b0.id, { ...formOf(b0), review: '页签甲的修改' }, b0.experiences, { expectedRev: 1 });
assert(r1.ok && r1.currentRev === 2, '页签甲基于 r1 保存成功 -> r2');

let conflictSeen: SaveConflictError | null = null;
try {
  // 页签乙仍持有 r1（模拟另一窗口未刷新）
  st.saveBenchForm(b0.id, { ...formOf(b0), review: '页签乙的修改' }, b0.experiences, { expectedRev: 1 });
} catch (e) {
  if (e instanceof SaveConflictError) conflictSeen = e;
}
assert(!!conflictSeen && conflictSeen!.currentRev === 2, '页签乙 r1 保存被拒，看到主档已到 r2');

// 乙刷新后基于 r2 保存成功
const b2 = useBenchStore.getState().getBenchById(b0.id)!;
const r2 = st.saveBenchForm(b0.id, { ...formOf(b2), review: '页签乙刷新后保存' }, b2.experiences, { expectedRev: 2 });
assert(r2.ok && r2.currentRev === 3, '页签乙加载 r2 后保存成功 -> r3');
assert(loadDB().benches[0].review === '页签乙刷新后保存', '磁盘主档是乙的内容，甲的未被覆盖（甲已先落盘）');

console.log('C) 导出交接文件可被解析，含稳定编号/修订号/基准');
const exported = st.exportHandoff();
const parsed = parseHandoffFile(exported.text);
assert(parsed.format === 'bench-handoff' && parsed.entries.length === 1, '交接文件合法，1 条');
assert(parsed.entries[0].benchId === 'legacy-1', '携带稳定编号');
assert(parsed.entries[0].bench.rev === 3, '携带修订号 r3');
// 迁移来的长椅尚未与任何设备同步过 -> 首次交接不带伙伴基准（离线新建语义）
assert(parsed.entries[0].baseSnapshot === null, '从未同步的长椅首次交接 baseSnapshot=null');

console.log('D) 浏览者只能看到核对后的公开备注');
st.setRole('viewer');
st = useBenchStore.getState();
assert(st.getVisibleBenches().length === 1, '已核对长椅对浏览者可见');
// 造一条未核对的新档案（巡查员身份）
st.setRole('inspector');
const nb = st.addBench({
  ...formOf(st.db!.benches[0]), name: '待审的新椅', review: '内部草稿',
}, []);
// addBench 默认 reviewed=true（本机直接录入）；手动模拟导入产生的未核对档案
const dbx = loadDB();
const target = dbx.benches.find((x) => x.id === nb.id)!;
target.reviewed = false; target.publicNotes = '';
saveDB(dbx);
useBenchStore.getState().replaceDB(loadDB());
st = useBenchStore.getState();
st.setRole('viewer');
assert(st.getVisibleBenches().every((x) => x.reviewed === true), '浏览者列表全是已核对');
assert(!st.getBenchById(nb.id) || st.getVisibleBenches().every((x) => x.id !== nb.id), '未核对档案对浏览者隐藏');
st.setRole('inspector');

console.log('E) 导入离线修改：双方改不同字段自动并入');
// 构造一份基于 r3 的离线交接：只改 location
const incomingBench: Bench = {
  ...structuredClone(loadDB().benches.find((x) => x.id === 'legacy-1')!),
  location: '离线巡查改的位置',
  rev: 4,
  lastEditor: '外勤小李',
};
const handoff = JSON.stringify({
  format: 'bench-handoff', formatVersion: 1, deviceId: 'dev-field',
  inspector: '外勤小李', exportedAt: new Date().toISOString(),
  entries: [{
    benchId: 'legacy-1', baseRev: 3,
    bench: incomingBench,
    baseSnapshot: structuredClone(loadDB().benches.find((x) => x.id === 'legacy-1')!),
  }],
});
const job = st.startImport(handoff, 'field.json');
assert(job.status === 'done', '导入任务一次跑完');
assert(job.results[0].status === 'merged', '自动并入无冲突');
const after = useBenchStore.getState().getBenchById('legacy-1')!;
assert(after.location === '离线巡查改的位置', '对端 location 并入');
assert(after.review === '页签乙刷新后保存', '本机 review 保留');
assert(after.lastEditor === '外勤小李', '记录了是谁改的');
assert(after.rev === 5, '修订号 r5');

console.log('F) 导入双方都改同字段 -> 冲突，核对通过后发布公开备注');
// 双方从 r5 各自改 review
const baseNow = structuredClone(useBenchStore.getState().getBenchById('legacy-1')!);
// 本机先改 review 落盘 r6
st.saveBenchForm(baseNow.id, { ...formOf(baseNow), review: '主档新评价' }, baseNow.experiences, { expectedRev: 5 });
// 离线方也基于 r5 改 review
const conflictHandoff = JSON.stringify({
  format: 'bench-handoff', formatVersion: 1, deviceId: 'dev-field2',
  inspector: '外勤小王', exportedAt: new Date().toISOString(),
  entries: [{
    benchId: 'legacy-1', baseRev: 5,
    bench: { ...baseNow, review: '离线新评价', rev: 6, lastEditor: '外勤小王' },
    baseSnapshot: baseNow,
  }],
});
const job2 = st.startImport(conflictHandoff, 'field2.json');
assert(job2.results[0].status === 'conflict', '同字段双方都改 -> conflict');
st = useBenchStore.getState();
assert(st.db!.conflicts.length === 1, '待核对列表有 1 条');
const conflict = st.db!.conflicts[0];
assert(Object.keys(conflict.fields).includes('review'), '冲突字段是 review');
st.resolveConflict(conflict, {
  choices: { review: { pick: 'incoming' } },
  publicNotes: '核对通过：以小王的实地复勘为准',
  reviewedBy: st.db!.inspector,
});
st = useBenchStore.getState();
assert(st.db!.conflicts.length === 0, '核对后冲突出列');
const finalB = st.getBenchById('legacy-1')!;
assert(finalB.review === '离线新评价', '采用离线版本');
assert(finalB.reviewed === true, '恢复已核对');
assert(finalB.publicNotes!.startsWith('核对通过'), '公开备注写入');
// 本机 r6 与离线 r6 合并 max+1=r7，核对通过再 +1=r8
assert(finalB.rev === 8, '修订号 r8（合并 r7，核对 r8）');

console.log(`\n冒烟结果：${pass} 通过，${fail} 失败`);
process.exit(fail > 0 ? 1 : 0);
