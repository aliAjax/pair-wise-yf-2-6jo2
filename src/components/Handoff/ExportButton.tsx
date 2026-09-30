import { Download } from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';

export default function ExportButton() {
  const exportHandoff = useBenchStore((s) => s.exportHandoff);

  const handleExport = () => {
    const handoff = exportHandoff();
    const blob = new Blob([JSON.stringify(handoff, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `长椅交接文件-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <button
      onClick={handleExport}
      title="导出交接文件（离线带给其他巡查员）"
      className="flex items-center gap-1.5 px-3 py-2 text-sm text-ink-light hover:bg-deep-brown/5 hover:text-deep-brown rounded-lg transition-colors"
    >
      <Download className="w-4 h-4" />
      <span className="hidden sm:inline">导出</span>
    </button>
  );
}
