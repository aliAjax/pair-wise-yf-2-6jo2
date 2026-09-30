import type { Bench, ArchiveStats } from '@/types';
import { calculateComfortScore } from './comfort';

/** 重算档案统计：核对通过后调用，地图/排行/详情统计随之刷新 */
export function recomputeStats(benches: Bench[], pendingCount: number): ArchiveStats {
  const total = benches.length;
  const avgComfort =
    total > 0
      ? Math.round((benches.reduce((sum, b) => sum + calculateComfortScore(b), 0) / total) * 10) / 10
      : 0;
  const avgRating =
    total > 0
      ? Math.round((benches.reduce((sum, b) => sum + b.rating, 0) / total) * 10) / 10
      : 0;

  const materialDist: Record<string, number> = {};
  const townDist: Record<string, number> = {};
  for (const b of benches) {
    materialDist[b.material] = (materialDist[b.material] ?? 0) + 1;
    // 以位置描述中的片区词做粗略分布统计
    const town = b.location.length > 6 ? b.location.slice(0, 4) : b.location;
    townDist[town] = (townDist[town] ?? 0) + 1;
  }

  return { total, avgComfort, avgRating, pendingCount, materialDist, townDist };
}
