import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft,
  Save,
  Plus,
  Trash2,
  Sunrise,
  Sun,
  Sunset,
  Moon,
  CloudSun,
  AlertTriangle,
  RefreshCw,
  Eye,
} from 'lucide-react';
import { useBenchStore } from '@/store/useBenchStore';
import {
  MATERIAL_LABELS,
  ORIENTATION_LABELS,
  SHADE_LABELS,
  NOISE_LABELS,
  STAY_DURATION_LABELS,
  TIME_PERIOD_LABELS,
  SaveConflictError,
} from '@/types';
import type {
  MaterialType,
  OrientationType,
  ShadeLevelType,
  NoiseLevelType,
  StayDurationType,
  TimePeriodType,
  BenchExperience,
} from '@/types';
import Rating from '@/components/Rating/Rating';
import { generateId } from '@/utils/comfort';

const EMPTY_FORM = {
  name: '',
  location: '',
  lat: 31.23,
  lng: 121.47,
  material: 'wood' as MaterialType,
  orientation: 'south' as OrientationType,
  hasBackrest: true,
  shadeLevel: 'partial' as ShadeLevelType,
  noiseLevel: 'moderate' as NoiseLevelType,
  stayDuration: 'medium' as StayDurationType,
  rating: 3,
  review: '',
};

export default function AddEditPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const isEdit = !!id;

  const {
    getBenchById,
    addBench,
    saveBenchForm,
    initialize,
    initialized,
    db,
  } = useBenchStore();
  const existingBench = id ? getBenchById(id) : undefined;
  const isViewer = db?.role === 'viewer';

  const [formData, setFormData] = useState({ ...EMPTY_FORM });
  const [experiences, setExperiences] = useState<BenchExperience[]>([]);
  /** 进入编辑页时读取的修订号，保存时用于乐观并发检查 */
  const [baseRev, setBaseRev] = useState<number | undefined>(undefined);
  const [conflictRev, setConflictRev] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!initialized) initialize();
  }, [initialized, initialize]);

  // 用打开时的快照填充表单
  useEffect(() => {
    if (isEdit && existingBench) {
      setFormData({
        name: existingBench.name,
        location: existingBench.location,
        lat: existingBench.lat,
        lng: existingBench.lng,
        material: existingBench.material,
        orientation: existingBench.orientation,
        hasBackrest: existingBench.hasBackrest,
        shadeLevel: existingBench.shadeLevel,
        noiseLevel: existingBench.noiseLevel,
        stayDuration: existingBench.stayDuration,
        rating: existingBench.rating,
        review: existingBench.review,
      });
      setExperiences(existingBench.experiences.map((e) => ({ ...e })));
      setBaseRev(existingBench.rev ?? 1);
    }
    // 仅在首次打开长椅时取快照；后续主档变化由冲突提示处理，不覆盖正在编辑的表单
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, id, initialized]);

  const timePeriodIcons: Record<TimePeriodType, typeof Sunrise> = useMemo(
    () => ({
      morning: Sunrise,
      noon: Sun,
      afternoon: CloudSun,
      evening: Sunset,
      night: Moon,
    }),
    [],
  );

  const handleChange = (field: string, value: string | number | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleAddExperience = () => {
    setExperiences((prev) => [
      ...prev,
      { id: generateId(), benchId: id || 'temp', timePeriod: 'morning', notes: '', rating: 3 },
    ]);
  };

  const handleUpdateExperience = (expId: string, field: string, value: string | number) => {
    setExperiences((prev) =>
      prev.map((exp) => (exp.id === expId ? { ...exp, [field]: value } : exp)),
    );
  };

  const handleDeleteExperience = (expId: string) => {
    setExperiences((prev) => prev.filter((exp) => exp.id !== expId));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSaveError(null);

    if (!formData.name.trim()) return setSaveError('请输入长椅名称');
    if (!formData.location.trim()) return setSaveError('请输入位置描述');

    try {
      if (isEdit && id) {
        const result = saveBenchForm(id, formData, experiences, { expectedRev: baseRev });
        if (result.ok) {
          navigate(`/bench/${id}`);
        } else {
          setSaveError(result.error ?? '保存失败');
        }
      } else {
        const bench = addBench({ ...formData }, experiences);
        navigate(`/bench/${bench.id}`);
      }
    } catch (err) {
      if (err instanceof SaveConflictError) {
        setConflictRev(err.currentRev);
      } else {
        setSaveError(err instanceof Error ? err.message : String(err));
      }
    }
  };

  const reloadLatest = () => {
    if (!id) return;
    const latest = getBenchById(id);
    if (latest) {
      setFormData({
        name: latest.name,
        location: latest.location,
        lat: latest.lat,
        lng: latest.lng,
        material: latest.material,
        orientation: latest.orientation,
        hasBackrest: latest.hasBackrest,
        shadeLevel: latest.shadeLevel,
        noiseLevel: latest.noiseLevel,
        stayDuration: latest.stayDuration,
        rating: latest.rating,
        review: latest.review,
      });
      setExperiences(latest.experiences.map((e) => ({ ...e })));
      setBaseRev(latest.rev ?? 1);
    }
    setConflictRev(null);
  };

  const inputCls =
    'w-full px-4 py-2.5 bg-white/50 border border-deep-brown/10 rounded-lg text-deep-brown placeholder:text-ink-light/60 focus:bg-white transition-colors disabled:opacity-60';

  return (
    <div className="container mx-auto px-4 py-6">
      <button
        onClick={() => navigate(-1)}
        className="flex items-center gap-2 text-ink-light hover:text-deep-brown mb-6 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="text-sm">返回</span>
      </button>

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="font-serif text-2xl font-bold text-deep-brown">
            {isEdit ? '编辑长椅档案' : '添加长椅档案'}
          </h1>
          {isEdit && existingBench && (
            <div className="flex items-center gap-2 text-xs text-ink-light">
              <span className="px-2 py-1 bg-white/60 rounded-full">
                编号 {existingBench.id.slice(0, 10)}
              </span>
              <span className="px-2 py-1 bg-white/60 rounded-full">
                修订 r{existingBench.rev ?? 1}
              </span>
              {existingBench.reviewed ? (
                <span className="px-2 py-1 bg-moss-green/10 text-moss-green rounded-full">
                  已核对
                </span>
              ) : (
                <span className="px-2 py-1 bg-ochre/10 text-ochre rounded-full">待核对</span>
              )}
            </div>
          )}
        </div>

        {isViewer && (
          <div className="mb-4 p-4 rounded-xl bg-warm-beige/70 border border-deep-brown/10 flex items-start gap-3">
            <Eye className="w-5 h-5 text-ochre flex-shrink-0 mt-0.5" />
            <p className="text-sm text-deep-brown">
              当前是浏览者身份，只能查看核对后的公开备注，不能编辑。请切换到巡查员身份后再修改。
            </p>
          </div>
        )}

        {conflictRev != null && (
          <div className="mb-4 p-4 rounded-xl bg-red-50 border border-red-200">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-serif font-semibold text-red-700 mb-1">
                  版本冲突：主档已更新到 r{conflictRev}
                </h3>
                <p className="text-sm text-red-600/90 mb-3">
                  你打开的是 r{baseRev}，另一个页签或巡查员已经先保存了这张长椅。为避免覆盖对方的修改，本次保存未写入。
                  你可以加载最新版本查看对方的改动，再决定如何合并你的修改。
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={reloadLatest}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm bg-red-500 text-white rounded-lg hover:bg-red-600 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                    加载最新版本（放弃当前编辑）
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate(`/bench/${id}`)}
                    className="px-3 py-1.5 text-sm text-red-600 hover:bg-red-100 rounded-lg transition-colors"
                  >
                    先去详情页查看
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {saveError && (
          <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
            {saveError}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-1">
            <h2 className="font-serif text-lg font-semibold text-deep-brown mb-4">基本信息</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">长椅名称 *</label>
                <input
                  type="text"
                  value={formData.name}
                  disabled={isViewer}
                  onChange={(e) => handleChange('name', e.target.value)}
                  placeholder="给这张长椅起个名字"
                  className={inputCls}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">位置描述 *</label>
                <input
                  type="text"
                  value={formData.location}
                  disabled={isViewer}
                  onChange={(e) => handleChange('location', e.target.value)}
                  placeholder="例如：人民公园东门北侧"
                  className={inputCls}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-deep-brown mb-1.5">纬度</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.lat}
                    disabled={isViewer}
                    onChange={(e) => handleChange('lat', parseFloat(e.target.value) || 0)}
                    className={inputCls}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-deep-brown mb-1.5">经度</label>
                  <input
                    type="number"
                    step="0.0001"
                    value={formData.lng}
                    disabled={isViewer}
                    onChange={(e) => handleChange('lng', parseFloat(e.target.value) || 0)}
                    className={inputCls}
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-2">
            <h2 className="font-serif text-lg font-semibold text-deep-brown mb-4">特征属性</h2>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">材质</label>
                <select
                  value={formData.material}
                  disabled={isViewer}
                  onChange={(e) => handleChange('material', e.target.value)}
                  className={`${inputCls} cursor-pointer`}
                >
                  {Object.entries(MATERIAL_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">朝向</label>
                <select
                  value={formData.orientation}
                  disabled={isViewer}
                  onChange={(e) => handleChange('orientation', e.target.value)}
                  className={`${inputCls} cursor-pointer`}
                >
                  {Object.entries(ORIENTATION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">遮阴情况</label>
                <select
                  value={formData.shadeLevel}
                  disabled={isViewer}
                  onChange={(e) => handleChange('shadeLevel', e.target.value)}
                  className={`${inputCls} cursor-pointer`}
                >
                  {Object.entries(SHADE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">噪音等级</label>
                <select
                  value={formData.noiseLevel}
                  disabled={isViewer}
                  onChange={(e) => handleChange('noiseLevel', e.target.value)}
                  className={`${inputCls} cursor-pointer`}
                >
                  {Object.entries(NOISE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">适合停留时长</label>
                <select
                  value={formData.stayDuration}
                  disabled={isViewer}
                  onChange={(e) => handleChange('stayDuration', e.target.value)}
                  className={`${inputCls} cursor-pointer`}
                >
                  {Object.entries(STAY_DURATION_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">是否有靠背</label>
                <div className="flex items-center gap-4 h-[42px]">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="hasBackrest"
                      checked={formData.hasBackrest}
                      disabled={isViewer}
                      onChange={() => handleChange('hasBackrest', true)}
                      className="text-moss-green focus:ring-moss-green"
                    />
                    <span className="text-sm text-deep-brown">有</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="hasBackrest"
                      checked={!formData.hasBackrest}
                      disabled={isViewer}
                      onChange={() => handleChange('hasBackrest', false)}
                      className="text-moss-green focus:ring-moss-green"
                    />
                    <span className="text-sm text-deep-brown">无</span>
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-3">
            <h2 className="font-serif text-lg font-semibold text-deep-brown mb-4">个人评价</h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">综合评分</label>
                <Rating
                  value={formData.rating}
                  onChange={(value) => !isViewer && handleChange('rating', value)}
                  size="lg"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-deep-brown mb-1.5">评价文字（巡查员内部记录）</label>
                <textarea
                  value={formData.review}
                  disabled={isViewer}
                  onChange={(e) => handleChange('review', e.target.value)}
                  placeholder="写下你对这张长椅的感受..."
                  rows={4}
                  className={`${inputCls} resize-none`}
                />
              </div>
            </div>
          </div>

          <div className="paper-texture rounded-xl shadow-paper p-6 fade-in opacity-0 stagger-4">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-serif text-lg font-semibold text-deep-brown">分时段体验</h2>
              {!isViewer && (
                <button
                  type="button"
                  onClick={handleAddExperience}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-moss-green hover:bg-moss-green/10 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                  添加时段
                </button>
              )}
            </div>

            {experiences.length > 0 ? (
              <div className="space-y-4">
                {experiences.map((exp) => {
                  const TimeIcon = timePeriodIcons[exp.timePeriod];
                  return (
                    <div key={exp.id} className="p-4 bg-warm-cream/50 rounded-lg">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                          <TimeIcon className="w-5 h-5 text-ochre" />
                          <select
                            value={exp.timePeriod}
                            disabled={isViewer}
                            onChange={(e) => handleUpdateExperience(exp.id, 'timePeriod', e.target.value)}
                            className="px-2 py-1 text-sm bg-white border border-deep-brown/10 rounded-md text-deep-brown cursor-pointer disabled:opacity-60"
                          >
                            {Object.entries(TIME_PERIOD_LABELS).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </div>
                        {!isViewer && (
                          <button
                            type="button"
                            onClick={() => handleDeleteExperience(exp.id)}
                            className="p-1.5 text-red-400 hover:text-red-500 hover:bg-red-50 rounded-md transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div className="mb-3">
                        <label className="text-xs text-ink-light mb-1 block">时段评分</label>
                        <Rating
                          value={exp.rating}
                          onChange={(value) => !isViewer && handleUpdateExperience(exp.id, 'rating', value)}
                          size="sm"
                        />
                      </div>
                      <div>
                        <label className="text-xs text-ink-light mb-1 block">体验备注</label>
                        <textarea
                          value={exp.notes}
                          disabled={isViewer}
                          onChange={(e) => handleUpdateExperience(exp.id, 'notes', e.target.value)}
                          placeholder="记录这个时段的体验..."
                          rows={2}
                          className="w-full px-3 py-2 text-sm bg-white/60 border border-deep-brown/10 rounded-md text-deep-brown placeholder:text-ink-light/60 focus:bg-white resize-none disabled:opacity-60"
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <p className="text-sm text-ink-light">还没有添加时段体验</p>
                <p className="text-xs text-ink-light/60 mt-1">可以记录早晨、中午、下午等不同时段的感受</p>
              </div>
            )}
          </div>

          {!isViewer && (
            <div className="flex gap-4 pb-6">
              <button
                type="button"
                onClick={() => navigate(-1)}
                className="flex-1 px-6 py-3 bg-warm-beige text-deep-brown rounded-xl font-medium hover:bg-warm-beige/80 transition-colors"
              >
                取消
              </button>
              <button
                type="submit"
                className="flex-1 px-6 py-3 bg-moss-green text-white rounded-xl font-medium hover:bg-moss-light transition-colors shadow-md hover:shadow-lg flex items-center justify-center gap-2"
              >
                <Save className="w-4 h-4" />
                {isEdit ? `保存修改（将生成 r${(baseRev ?? 1) + 1}）` : '添加档案'}
              </button>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
