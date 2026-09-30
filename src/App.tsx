import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Navbar from '@/components/Layout/Navbar';
import ListPage from '@/pages/ListPage/ListPage';
import MapPage from '@/pages/MapPage/MapPage';
import RankingPage from '@/pages/RankingPage/RankingPage';
import BenchDetail from '@/pages/BenchDetail/BenchDetail';
import AddEditPage from '@/pages/AddEditPage/AddEditPage';
import ReviewQueue from '@/pages/ReviewQueue/ReviewQueue';

export default function App() {
  return (
    <Router>
      <div className="min-h-screen">
        <Navbar />
        <main className="pb-12">
          <Routes>
            <Route path="/" element={<ListPage />} />
            <Route path="/map" element={<MapPage />} />
            <Route path="/ranking" element={<RankingPage />} />
            <Route path="/bench/:id" element={<BenchDetail />} />
            <Route path="/add" element={<AddEditPage />} />
            <Route path="/edit/:id" element={<AddEditPage />} />
            <Route path="/review" element={<ReviewQueue />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}
