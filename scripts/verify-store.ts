/**
 * Store 级流程验证：模拟 localStorage，验证
 *  - 导出交接文件（基线推进）
 *  - 导入冲突检测与待核对
 *  - 核对解决
 *  - 导入失败后从断点续传
 * 运行：npx tsx scripts/verify-store.ts
 */

// ---- 浏览器环境 mock ----
const memory = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
  clear: () => memory.clear(),
  key: (i: number) => Array.from(memory.keys())[i] ?? null,
  get length() {
    return memory.size;
  },
};
(globalThis as unknown as { navigator: { userAgent: string } }).navigator = { userAgent: 'node-test' };

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

const { useBenchStore } = await import('../src/store/useBenchStore');
const { validateHandoff } = await import('../src/utils/merge');
type HandoffFile = import('../src/types').HandoffFile;

console.log('\n[1] 初始化与迁移');
{
  useBenchStore.getState().initialize();
  const benches = useBenchStore.getState().benches;
  assert(benches.length === 6, '首次加载 mock 数据 6 条');
  assert(benches.every((b) => b.revision >= 1), '所有长椅都有修订号');
  assert(benches.every((b) => b.synced !== undefined), '所有长椅都有同步基线');
}

console.log('\n[2] 导出交接文件');
let handoff: HandoffFile;
{
  handoff = useBenchStore.getState().exportHandoff();
  assert(handoff.format === 'bench-archive-handoff', '交接文件格式正确');
  assert(handoff.benches.length === 6, '包含 6 条长椅');
  assert(validateHandoff(handoff) === null, '导出的文件通过校验');
  const b1 = handoff.benches.find((b) => b.id === 'bench-001');
  assert(b1?.synced !== undefined, '导出时基线已推进');
}

console.log('\n[3] 本地修改 + 导入（双方都改 → 冲突）');
{
  // 模拟主档在导出后被修改（基于导出基线）
  const b1 = useBenchStore.getState().benches.find((b) => b.id === 'bench-001')!;
  useBenchStore.getState().updateBench('bench-001', { name: '主档后改的名字' }, b1.revision);

  // 交接文件也基于同一基线修改了名字
  const incoming = JSON.parse(JSON.stringify(handoff));
  incoming.benches = incoming.benches.map((b: { id: string; name: string; revision: number }) =>
    b.id === 'bench-001' ? { ...b, name: '交接后改的名字', revision: b.revision + 1 } : b,
  );

  const result = await useBenchStore.getState().importHandoff(incoming, 'test.json');
  assert(result.conflicts === 1, '检测到 1 条冲突');
  assert(useBenchStore.getState().pendingImports.length === 1, '待核对列表有 1 条');
  const pending = useBenchStore.getState().pendingImports[0];
  assert(pending.conflicts.some((c) => c.field === 'name'), 'name 字段冲突');
  assert(pending.localBench.name === '主档后改的名字', '待核对保留主档版本');
  assert(pending.incomingBench.name === '交接后改的名字', '待核对保留交接版本');
}

console.log('\n[4] 核对解决');
{
  const pending = useBenchStore.getState().pendingImports[0];
  useBenchStore.getState().resolvePending(pending.id, { name: 'incoming' });
  assert(useBenchStore.getState().pendingImports.length === 0, '核对后待核对清空');
  const b1 = useBenchStore.getState().benches.find((b) => b.id === 'bench-001')!;
  assert(b1.name === '交接后改的名字', '核对后采用交接版名字');
  assert(b1.revision >= 3, '核对后修订号推进');
  assert(useBenchStore.getState().stats !== null, '核对后统计已重算');
}

console.log('\n[5] 断点续传：跳过已完成条目，处理剩余条目');
{
  // 先正常导入一次，拿到完整 handoff
  const good = JSON.parse(JSON.stringify(handoff));
  // 注入一个"部分完成"的会话：前 2 条已 applied，后 4 条 pending（模拟中途崩溃）
  const partialSession = {
    sessionId: 'resume-test',
    fileName: 'partial.json',
    exportedAt: good.exportedAt,
    exportedBy: good.exportedBy,
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    status: 'in-progress' as const,
    total: good.benches.length,
    handoff: good,
    items: good.benches.map((b: { id: string; name: string }, i: number) => ({
      benchId: b.id,
      name: b.name,
      status: (i < 2 ? 'applied' : 'pending') as 'applied' | 'pending',
      processedAt: i < 2 ? '2024-01-01T00:00:00Z' : undefined,
      message: i < 2 ? '已并入主档' : undefined,
    })),
  };
  useBenchStore.setState({
    importSessions: [partialSession, ...useBenchStore.getState().importSessions],
    activeImportSessionId: 'resume-test',
  });

  const beforeProcessedAt = partialSession.items[0].processedAt;
  const result = await useBenchStore.getState().resumeImport('resume-test');
  const after = useBenchStore.getState().importSessions.find((s) => s.sessionId === 'resume-test');

  assert(after?.status === 'completed', '续传后会话完成');
  // 已 applied 的条目被跳过（processedAt 不变）
  assert(after!.items[0].processedAt === beforeProcessedAt, '已完成的条目跳过不重复处理');
  assert(after!.items[1].processedAt === beforeProcessedAt, '第 2 条已完成条目跳过');
  // 剩余 4 条被处理
  const remainingProcessed = after!.items.slice(2).filter((i) => i.status !== 'pending').length;
  assert(remainingProcessed === 4, '剩余 4 条全部处理');
  assert(result.applied + result.conflicts === 6, '续传返回的计数包含跳过的 2 条');
}

console.log('\n[6] 乐观锁：页签并发保存');
{
  const b1 = useBenchStore.getState().benches.find((b) => b.id === 'bench-001')!;
  // 页签 A 先保存
  const r1 = useBenchStore.getState().updateBench('bench-001', { review: 'A 改的' }, b1.revision);
  assert(r1.ok, '页签 A 保存成功');
  // 页签 B 用旧修订号保存
  const r2 = useBenchStore.getState().updateBench('bench-001', { review: 'B 改的' }, b1.revision);
  assert(!r2.ok && r2.reason === 'conflict', '页签 B 看到版本冲突');
  const current = useBenchStore.getState().benches.find((b) => b.id === 'bench-001')!;
  assert(current.review === 'A 改的', 'B 的保存未生效，A 的修改保留');
}

console.log(`\n结果：${passed} 通过，${failed} 失败`);
process.exit(failed > 0 ? 1 : 0);
