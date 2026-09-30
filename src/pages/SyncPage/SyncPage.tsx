import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Download,
  Upload,
  Users,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  RotateCcw,
  ShieldCheck,
  Eye,
  ClipboardList,
  GitMerge,
  History,
} from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import type { ImportJob } from '@/types';

export default function SyncPage() {
  const navigate = useNavigate();
  const {
    db,
    initialize,
    initialized,
    exportHandoff,
    startImport,
    retryImport,
    clearFinishedImport,
    setRole,
    setInspectorName,
  } = useBenchStore();

  const fileRef = useRef<HTMLInputElement>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [nameDraft, setNameDraft] = useState('');

  useEffect(() => {
    if (!initialized) initialize();
  }, [initialized, initialize]);

  useEffect(() => {
    setJob(db?.pendingImport ?? null);
    setNameDraft(db?.inspector ?? '');
  }, [db]);

  if (!db) {
    return (
      <div className="container mx-auto px-4 py-6">
        <p className="text-ink-light">加载中...</p>
      </div>
    );
  }

  const isViewer = db.role === 'viewer';
  const conflictCount = db.conflicts.length;
  const pendingBenches = db.benches.filter((b) => !b.reviewed).length;

  const handleExport = () => {
    if (conflictCount > 0) {
      setImportError('仍有待核对冲突，请先核对后再导出交接文件');
      return;
    }
    const { text, file } = exportHandoff();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `长椅交接_${file.inspector}_${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleFile = async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const ran = startImport(text, file.name);
      setJob(ran);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleRetry = () => {
    setImportError(null);
    try {
      setJob(retryImport());
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    }
  };

  const mergedCount = job?.results.filter((r) => r.status === 'merged').length ?? 0;
  const conflictResults = job?.results.filter((r) => r.status === 'conflict').length ?? 0;
  const errorResults = job?.results.filter((r) => r.status === 'error').length ?? 0;
  const progress = job ? Math.round((job.nextIndex / job.entries.length) * 100) : 0;

  return (
    <div className="container mx-auto px-4 py-6 max-w-4xl">
      <div className="mb-6">
        <h2 className="font-serif text-2xl font-semibold text-deep-brown mb-1">巡查交接中心</h2>
        <p className="text-ink-light text-sm">
          按稳定编号与修订号并回主档，字段双方都改过会保留两版待核对，核对通过后地图、排行、详情自动重算
        </p>
      </div>

      {/* 身份与角色 */}
      <div className="paper-texture rounded-xl shadow-paper p-6 mb-5">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5 text-moss-green" />
          <h3 className="font-serif text-lg font-semibold text-deep-brown">本机身份</h3>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs text-ink-light mb-1.5">巡查员姓名（写入修订记录）</label>
            <div className="flex gap-2">
              <input
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                disabled={isViewer}
                placeholder="例如：小王"
                className="flex-1 px-3 py-2 text-sm bg-white/60 border border-deep-brown/10 rounded-lg disabled:opacity-60"
              />
              <button
                onClick={() => setInspectorName(nameDraft)}
                disabled={isViewer}
                className="px-3 py-2 text-sm bg-moss-green text-white rounded-lg hover:bg-moss-light disabled:opacity-50"
              >
                保存
              </button>
            </div>
            <p className="text-xs text-ink-light/70 mt-1">设备编号：{db.deviceId}</p>
          </div>
          <div>
            <label className="block text-xs text-ink-light mb-1.5">当前角色</label>
            <div className="flex rounded-lg overflow-hidden border border-deep-brown/10">
              <button
                onClick={() => setRole('inspector')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                  !isViewer ? 'bg-moss-green text-white' : 'bg-white/50 text-ink-light hover:bg-white'
                }`}
              >
                <ShieldCheck className="w-4 h-4" />
                巡查员
              </button>
              <button
                onClick={() => setRole('viewer')}
                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm transition-colors ${
                  isViewer ? 'bg-ochre text-white' : 'bg-white/50 text-ink-light hover:bg-white'
                }`}
              >
                <Eye className="w-4 h-4" />
                浏览者
              </button>
            </div>
            <p className="text-xs text-ink-light/70 mt-1">
              {isViewer ? '浏览者只能看到核对后的公开备注' : '巡查员可编辑、导入与核对'}
            </p>
          </div>
        </div>
      </div>

      {/* 状态概览 */}
      <div className="grid grid-cols-3 gap-3 mb-5">
        <div className="paper-texture rounded-xl shadow-paper p-4 text-center">
          <div className="text-2xl font-bold font-serif text-deep-brown">{db.benches.length}</div>
          <div className="text-xs text-ink-light mt-1">主档长椅</div>
        </div>
        <button
          onClick={() => conflictCount > 0 && navigate('/review')}
          className={`paper-texture rounded-xl shadow-paper p-4 text-center transition-transform ${
            conflictCount > 0 ? 'hover:-translate-y-0.5 cursor-pointer ring-2 ring-ochre/40' : 'cursor-default'
          }`}
        >
          <div className={`text-2xl font-bold font-serif ${conflictCount > 0 ? 'text-ochre' : 'text-deep-brown'}`}>
            {conflictCount}
          </div>
          <div className="text-xs text-ink-light mt-1">待核对冲突</div>
        </button>
        <div className="paper-texture rounded-xl shadow-paper p-4 text-center">
          <div className={`text-2xl font-bold font-serif ${pendingBenches > 0 ? 'text-ochre' : 'text-deep-brown'}`}>
            {pendingBenches}
          </div>
          <div className="text-xs text-ink-light mt-1">未公开档案</div>
        </div>
      </div>

      {isViewer ? (
        <div className="paper-texture rounded-xl shadow-paper p-8 text-center">
          <Eye className="w-10 h-10 text-ochre/50 mx-auto mb-3" />
          <p className="text-deep-brown font-medium mb-1">当前为浏览者身份</p>
          <p className="text-sm text-ink-light">导入、导出与核对功能仅对巡查员开放</p>
        </div>
      ) : (
        <>
          {/* 导出 / 导入 */}
          <div className="grid md:grid-cols-2 gap-5 mb-5">
            <div className="paper-texture rounded-xl shadow-paper p-6">
              <div className="flex items-center gap-2 mb-2">
                <Download className="w-5 h-5 text-moss-green" />
                <h3 className="font-serif text-lg font-semibold text-deep-brown">导出交接文件</h3>
              </div>
              <p className="text-sm text-ink-light mb-4">
                带走每条长椅的稳定编号、当前修订号和共同基准，巡查回来后供主档做三方合并。
              </p>
              <button
                onClick={handleExport}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-moss-green text-white rounded-xl font-medium hover:bg-moss-light transition-colors"
              >
                <FileJson className="w-4 h-4" />
                下载交接 JSON（{db.benches.length - conflictCount} 条）
              </button>
            </div>

            <div className="paper-texture rounded-xl shadow-paper p-6">
              <div className="flex items-center gap-2 mb-2">
                <Upload className="w-5 h-5 text-ochre" />
                <h3 className="font-serif text-lg font-semibold text-deep-brown">导入交接文件</h3>
              </div>
              <p className="text-sm text-ink-light mb-4">
                逐条按编号与修订号并回，已完成部分即时落盘；失败后可从断点继续重试，不会覆盖他人改动。
              </p>
              <input
                ref={fileRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <button
                onClick={() => fileRef.current?.click()}
                disabled={job?.status === 'running'}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-ochre text-white rounded-xl font-medium hover:bg-ochre-light transition-colors disabled:opacity-50"
              >
                <GitMerge className="w-4 h-4" />
                {job?.status === 'running' ? '有待处理任务，请先继续' : '选择交接文件并回'}
              </button>
            </div>
          </div>

          {importError && (
            <div className="mb-5 p-4 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3">
              <XCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-red-700">{importError}</p>
            </div>
          )}

          {/* 导入任务进度：可恢复 */}
          {job && (
            <div className="paper-texture rounded-xl shadow-paper p-6 mb-5">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <History className="w-5 h-5 text-deep-brown" />
                  <h3 className="font-serif text-lg font-semibold text-deep-brown">
                    导入任务{job.status === 'done' ? '（已完成）' : '（可断点续传）'}
                  </h3>
                </div>
                <span className="text-xs text-ink-light">{job.fileName}</span>
              </div>

              <div className="flex items-center gap-4 text-xs text-ink-light mb-3">
                <span>来自：{job.inspector} · {job.deviceId}</span>
                <span>导出于 {new Date(job.exportedAt).toLocaleString('zh-CN')}</span>
              </div>

              <div className="h-2.5 bg-warm-beige rounded-full overflow-hidden mb-2">
                <div
                  className={`h-full rounded-full transition-all ${
                    errorResults > 0 ? 'bg-red-400' : 'bg-moss-green'
                  }`}
                  style={{ width: `${progress}%` }}
                />
              </div>
              <div className="flex items-center justify-between text-sm mb-4">
                <span className="text-ink-light">
                  已处理 {job.nextIndex}/{job.entries.length} 条
                </span>
                <span className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1 text-moss-green">
                    <CheckCircle2 className="w-4 h-4" />{mergedCount} 并入
                  </span>
                  <span className="inline-flex items-center gap-1 text-ochre">
                    <AlertTriangle className="w-4 h-4" />{conflictResults} 冲突
                  </span>
                  {errorResults > 0 && (
                    <span className="inline-flex items-center gap-1 text-red-500">
                      <XCircle className="w-4 h-4" />{errorResults} 失败
                    </span>
                  )}
                </span>
              </div>

              {job.status === 'running' && errorResults > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200">
                  <p className="text-sm text-red-700 mb-1">
                    第 {job.nextIndex + 1} 条处理失败，此前 {job.nextIndex} 条已并入并保留。
                  </p>
                  <p className="text-xs text-red-600/80">
                    {job.results.find((r) => r.status === 'error')?.message}
                  </p>
                </div>
              )}

              <div className="flex gap-2">
                {job.status === 'running' && (
                  <button
                    onClick={handleRetry}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-ochre text-white rounded-xl font-medium hover:bg-ochre-light"
                  >
                    <RotateCcw className="w-4 h-4" />
                    从第 {job.nextIndex + 1} 条继续重试
                  </button>
                )}
                {conflictCount > 0 && (
                  <button
                    onClick={() => navigate('/review')}
                    className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-moss-green text-white rounded-xl font-medium hover:bg-moss-light"
                  >
                    <ClipboardList className="w-4 h-4" />
                    前往核对（{conflictCount}）
                  </button>
                )}
                {job.status === 'done' && (
                  <button
                    onClick={clearFinishedImport}
                    className="flex-1 px-4 py-2.5 bg-warm-beige text-deep-brown rounded-xl font-medium hover:bg-warm-beige/80"
                  >
                    清除任务记录
                  </button>
                )}
              </div>

              {/* 逐条结果 */}
              <div className="mt-4 max-h-56 overflow-y-auto space-y-1.5">
                {job.results.map((r, i) => (
                  <div
                    key={`${r.benchId}-${i}`}
                    className="flex items-center gap-2 text-xs px-3 py-2 bg-white/50 rounded-lg"
                  >
                    {r.status === 'merged' ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-moss-green flex-shrink-0" />
                    ) : r.status === 'conflict' ? (
                      <AlertTriangle className="w-3.5 h-3.5 text-ochre flex-shrink-0" />
                    ) : (
                      <XCircle className="w-3.5 h-3.5 text-red-500 flex-shrink-0" />
                    )}
                    <span className="font-medium text-deep-brown truncate">{r.name}</span>
                    <span className="text-ink-light truncate flex-1">{r.message}</span>
                    {r.status === 'conflict' && (
                      <button
                        onClick={() => navigate(`/review/${r.benchId}`)}
                        className="text-moss-green hover:underline flex-shrink-0"
                      >
                        去核对
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 待核对列表 */}
          {conflictCount > 0 && (
            <div className="paper-texture rounded-xl shadow-paper p-6">
              <div className="flex items-center gap-2 mb-4">
                <ClipboardList className="w-5 h-5 text-ochre" />
                <h3 className="font-serif text-lg font-semibold text-deep-brown">待核对长椅</h3>
              </div>
              <div className="space-y-2">
                {db.conflicts.map((c) => {
                  const bench = db.benches.find((b) => b.id === c.benchId);
                  return (
                    <button
                      key={c.benchId}
                      onClick={() => navigate(`/review/${c.benchId}`)}
                      className="w-full flex items-center justify-between px-4 py-3 bg-warm-cream/60 hover:bg-warm-cream rounded-lg text-left transition-colors"
                    >
                      <div>
                        <div className="font-medium text-deep-brown text-sm">
                          {bench?.name ?? c.benchId}
                        </div>
                        <div className="text-xs text-ink-light mt-0.5">
                          {Object.keys(c.fields).length} 个字段双方都改过 · 对方 {c.incomingInspector}（r{c.incomingRev}）/ 本机 r{c.localRev}
                        </div>
                      </div>
                      <span className="text-xs text-moss-green font-medium">逐字段核对 →</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
