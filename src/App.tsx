import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import Navbar from '@/components/Layout/Navbar';
import ListPage from '@/pages/ListPage/ListPage';
import MapPage from '@/pages/MapPage/MapPage';
import RankingPage from '@/pages/RankingPage/RankingPage';
import BenchDetail from '@/pages/BenchDetail/BenchDetail';
import AddEditPage from '@/pages/AddEditPage/AddEditPage';
import SyncPage from '@/pages/SyncPage/SyncPage';
import ReviewPage from '@/pages/ReviewPage/ReviewPage';
import { useBenchStore } from '@/store/useBenchStore';

export default function App() {
  const initialize = useBenchStore((s) => s.initialize);

  // 应用启动即载入主档并完成旧数据迁移（无修订号 -> rev=1 初始版本）
  useEffect(() => {
    initialize();
  }, [initialize]);

  return (
    <Router>
      <div className="min-h-screen">
        <Navbar />
        <main className="pb-12">
          <Routes>
            <Route path="/" element={<ListPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/ranking" element={<RankingPage />} />
            <Route path="/sync" element={<SyncPage />} />
            <Route path="/review" element={<ReviewPage />} />
            <Route path="/review/:benchId" element={<ReviewPage />} />
            <Route path="/bench/:id" element={<BenchDetail />} />
            <Route path="/add" element={<AddEditPage />} />
            <Route path="/edit/:id" element={<AddEditPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
