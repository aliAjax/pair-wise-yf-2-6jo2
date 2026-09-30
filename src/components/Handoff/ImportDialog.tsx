import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X,
  Upload,
  FileJson,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  RotateCcw,
  ClipboardPaste,
} from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import type { HandoffFile } from '@/types';

type Phase = 'input' | 'running' | 'done' | 'error';

interface Props {
  onClose: () => void;
}

export default function ImportDialog({ onClose }: Props) {
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [phase, setPhase] = useState<Phase>('input');
  const [errorMsg, setErrorMsg] = useState('');
  const [summary, setSummary] = useState<{ applied: number; conflicts: number } | null>(null);
  const [resumeSessionId, setResumeSessionId] = useState<string | null>(null);

  const importHandoff = useBenchStore((s) => s.importHandoff);
  const resumeImport = useBenchStore((s) => s.resumeImport);
  const activeSessionId = useBenchStore((s) => s.activeImportSessionId);
  const sessions = useBenchStore((s) => s.importSessions);

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);

  const parseFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      setText(String(reader.result ?? ''));
    };
    reader.readAsText(file);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) parseFile(file);
  };

  const runImport = async (handoff: HandoffFile, fileName: string) => {
    setPhase('running');
    setErrorMsg('');
    try {
      const result = await importHandoff(handoff, fileName);
      setSummary(result);
      setPhase('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '导入失败');
      // 找到最近失败的会话用于断点续传
      const failed = useBenchStore
        .getState()
        .importSessions.find((s) => s.status === 'failed');
      setResumeSessionId(failed?.sessionId ?? null);
      setPhase('error');
    }
  };

  const handleStart = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      setErrorMsg('粘贴的内容不是有效的 JSON');
      setPhase('error');
      return;
    }
    const handoff = parsed as HandoffFile;
    runImport(handoff, '粘贴导入.json');
  };

  const handleResume = async () => {
    if (!resumeSessionId) return;
    setPhase('running');
    setErrorMsg('');
    try {
      const result = await resumeImport(resumeSessionId);
      setSummary(result);
      setPhase('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : '续传失败');
      setPhase('error');
    }
  };

  const pendingCount = activeSession?.items.filter((i) => i.status === 'pending').length ?? 0;
  const appliedCount = activeSession?.items.filter((i) => i.status === 'applied').length ?? 0;
  const conflictCount = activeSession?.items.filter((i) => i.status === 'conflict').length ?? 0;
  const errorCount = activeSession?.items.filter((i) => i.status === 'error').length ?? 0;
  const total = activeSession?.total ?? 0;
  const processed = appliedCount + conflictCount + errorCount;
  const progressPct = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="paper-texture rounded-xl shadow-paper-hover w-full max-w-lg max-h-[85vh] flex flex-col fade-in">
        <div className="flex items-center justify-between px-6 py-4 border-b border-deep-brown/10">
          <h3 className="font-serif text-lg font-semibold text-deep-brown flex items-center gap-2">
            <Upload className="w-5 h-5 text-moss-green" />
            导入交接文件
          </h3>
          <button
            onClick={onClose}
            className="p-1 text-ink-light hover:text-deep-brown rounded-lg hover:bg-deep-brown/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto">
          {phase === 'input' && (
            <div className="space-y-4">
              <p className="text-sm text-ink-light">
                选择巡查员带回的交接文件（.json），或直接粘贴文件内容。导入将按稳定编号与修订号合并到主档。
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-6 border-2 border-dashed border-deep-brown/15 rounded-xl text-ink-light hover:border-moss-green hover:text-moss-green transition-colors"
              >
                <FileJson className="w-6 h-6" />
                <span className="text-sm">点击选择交接文件</span>
              </button>

              <div className="relative">
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="或粘贴交接文件 JSON 内容..."
                  rows={6}
                  className="w-full px-3 py-2 text-sm bg-white/60 border border-deep-brown/10 rounded-lg text-deep-brown placeholder:text-ink-light/50 focus:bg-white resize-none font-mono"
                />
                {text && (
                  <button
                    onClick={() => setText('')}
                    className="absolute top-2 right-2 p-1 text-ink-light hover:text-deep-brown"
                    title="清空"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                  <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <span>{errorMsg}</span>
                </div>
              )}

              <button
                onClick={handleStart}
                disabled={!text.trim()}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-moss-green text-white rounded-lg font-medium hover:bg-moss-light transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <ClipboardPaste className="w-4 h-4" />
                开始导入
              </button>
            </div>
          )}

          {phase === 'running' && activeSession && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 text-deep-brown">
                <Loader2 className="w-5 h-5 animate-spin text-moss-green" />
                <span className="text-sm font-medium">
                  正在导入 {activeSession.fileName}（{processed}/{total}）
                </span>
              </div>
              <div className="h-2 bg-warm-beige rounded-full overflow-hidden">
                <div
                  className="h-full bg-moss-green rounded-full transition-all duration-300"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <div className="max-h-48 overflow-y-auto space-y-1.5">
                {activeSession.items.map((item) => (
                  <div
                    key={item.benchId}
                    className="flex items-center gap-2 text-sm px-3 py-2 bg-warm-cream/60 rounded-lg"
                  >
                    {item.status === 'pending' && (
                      <Loader2 className="w-4 h-4 animate-spin text-ink-light flex-shrink-0" />
                    )}
                    {item.status === 'applied' && (
                      <CheckCircle2 className="w-4 h-4 text-moss-green flex-shrink-0" />
                    )}
                    {item.status === 'conflict' && (
                      <AlertTriangle className="w-4 h-4 text-ochre flex-shrink-0" />
                    )}
                    {item.status === 'error' && (
                      <AlertTriangle className="w-4 h-4 text-red-500 flex-shrink-0" />
                    )}
                    <span className="text-deep-brown truncate flex-1">{item.name}</span>
                    <span className="text-xs text-ink-light flex-shrink-0">
                      {item.status === 'pending'
                        ? '等待处理'
                        : item.status === 'applied'
                          ? item.message ?? '已并入'
                          : item.status === 'conflict'
                            ? item.message ?? '待核对'
                            : item.message ?? '失败'}
                    </span>
                  </div>
                ))}
              </div>
              {pendingCount > 0 && (
                <p className="text-xs text-ink-light">
                  导入中途关闭也不会丢失进度，已完成的条目会跳过。
                </p>
              )}
            </div>
          )}

          {phase === 'error' && (
            <div className="space-y-4">
              <div className="flex items-start gap-2 p-3 bg-red-50 text-red-600 rounded-lg text-sm">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium mb-1">导入中断</p>
                  <p>{errorMsg}</p>
                  <p className="mt-1 text-red-500/80">
                    已完成 {appliedCount} 条、冲突 {conflictCount} 条均已落盘，可从断点继续。
                  </p>
                </div>
              </div>
              <button
                onClick={handleResume}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-ochre text-white rounded-lg font-medium hover:bg-ochre-light transition-colors"
              >
                <RotateCcw className="w-4 h-4" />
                从已完成部分继续重试
              </button>
              <button
                onClick={() => setPhase('input')}
                className="w-full px-4 py-2.5 text-sm text-ink-light hover:text-deep-brown transition-colors"
              >
                重新选择文件
              </button>
            </div>
          )}

          {phase === 'done' && summary && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="w-12 h-12 text-moss-green mx-auto" />
              <div>
                <p className="font-serif text-lg font-semibold text-deep-brown">导入完成</p>
                <p className="text-sm text-ink-light mt-1">
                  成功并入 {summary.applied} 条，{summary.conflicts} 条存在字段冲突待核对
                </p>
              </div>
              {summary.conflicts > 0 && (
                <button
                  onClick={() => {
                    onClose();
                    navigate('/review');
                  }}
                  className="w-full px-4 py-2.5 bg-ochre text-white rounded-lg font-medium hover:bg-ochre-light transition-colors"
                >
                  前往核对冲突（{summary.conflicts}）
                </button>
              )}
              <button
                onClick={onClose}
                className="w-full px-4 py-2.5 text-sm text-ink-light hover:text-deep-brown transition-colors"
              >
                完成
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
