import type { Emotion, EmotionEntry, GardenSnapshot, GrowthStage, Plant } from './models';
import { EMOTION_META, EMOTIONS } from './models';

const day = 86400000;
export function stageFor(streak: number): GrowthStage { if (streak >= 14) return '结果'; if (streak >= 7) return '开花'; if (streak >= 3) return '发芽'; return '种子'; }
export function streakFor(entries: EmotionEntry[], emotion: Emotion): number {
  const dates = new Set(entries.filter((item) => item.emotion === emotion).map((item) => item.date));
  let streak = 0; const cursor = new Date(); cursor.setHours(0, 0, 0, 0);
  while (dates.has(cursor.toISOString().slice(0, 10))) { streak += 1; cursor.setTime(cursor.getTime() - day); }
  if (!streak) {
    const sortedDates = [...dates].sort(); const latest = sortedDates[sortedDates.length - 1]; if (!latest) return 0;
    const distance = Math.floor((Date.now() - new Date(`${latest}T00:00:00`).getTime()) / day);
    if (distance > 1) return 0;
    streak = 1;
  }
  return streak;
}
export function syncPlants(entries: EmotionEntry[], previous: Plant[] = []): Plant[] {
  return EMOTIONS.filter((emotion) => entries.some((item) => item.emotion === emotion)).map((emotion) => {
    const own = entries.filter((item) => item.emotion === emotion).sort((a, b) => a.date.localeCompare(b.date));
    const existing = previous.find((item) => item.emotion === emotion);
    const streak = streakFor(entries, emotion);
    return { id: existing?.id ?? `plant-${emotion}`, emotion, plantedAt: own[0].date, lastWatered: own[own.length - 1].date, streak, stage: stageFor(streak), status: streak ? '繁茂' : '枯萎', entryIds: own.map((item) => item.id) };
  });
}
export function createEntry(emotion: Emotion, note: string, intensity: number, date = new Date().toISOString().slice(0, 10)): EmotionEntry { return { id: `emotion-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date, emotion, note: note.trim() || EMOTION_META[emotion].hint, intensity: Math.min(5, Math.max(1, Number(intensity) || 3)) }; }
export function annualReport(entries: EmotionEntry[]) {
  const counts = EMOTIONS.map((emotion) => ({ emotion, count: entries.filter((item) => item.emotion === emotion).length })).sort((a, b) => b.count - a.count);
  const active = new Set(entries.map((item) => item.date)).size;
  const intensity = entries.length ? entries.reduce((sum, item) => sum + item.intensity, 0) / entries.length : 0;
  return { top: counts[0], counts, active, lushness: Math.min(100, Math.round((active / 90) * 70 + (intensity / 5) * 30)), intensity: Math.round(intensity * 10) / 10 };
}
export type TrendGranularity = 'week' | 'month';
export interface TrendBucket {
  key: string;
  label: string;
  title: string;
  start: string;
  end: string;
  hasData: boolean;
  total: number;
  avgIntensity: number;
  counts: Record<Emotion, number>;
  entries: EmotionEntry[];
}
export interface TrendResult {
  granularity: TrendGranularity;
  span: number;
  start: string;
  end: string;
  buckets: TrendBucket[];
  totalEntries: number;
  activeBuckets: number;
  emptyBuckets: number;
  avgIntensity: number;
  peak: { label: string; total: number } | null;
}

function localISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function startOfWeek(date: Date): Date {
  const cursor = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  cursor.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
  return cursor;
}
function addMonths(date: Date, months: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + months, 1);
}
function emptyCounts(): Record<Emotion, number> {
  return { 愤怒: 0, 平静: 0, 喜悦: 0, 忧伤: 0, 焦虑: 0 };
}

/**
 * 以自然周（周一起）/ 自然月对齐，生成覆盖最近 span 个区间的完整桶序列。
 * 没有记录的区间同样占一个桶（hasData=false），供图表留白、折线断开。
 * 图表、汇总数字、选中点全部以这一份聚合结果为唯一口径。
 */
export function aggregateTrends(entries: EmotionEntry[], granularity: TrendGranularity, span: number): TrendResult {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let starts: Date[];
  let endOf: (start: Date, index: number) => Date;
  let labelOf: (start: Date, index: number) => { label: string; title: string };
  if (granularity === 'week') {
    const first = startOfWeek(today);
    first.setDate(first.getDate() - (span - 1) * 7);
    starts = Array.from({ length: span }, (_, index) => {
      const d = new Date(first);
      d.setDate(d.getDate() + index * 7);
      return d;
    });
    endOf = (start) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
    labelOf = (start) => ({ label: `${start.getMonth() + 1}/${start.getDate()}`, title: `${start.getMonth() + 1}月${start.getDate()}日 起的一周` });
  } else {
    const thisMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    starts = Array.from({ length: span }, (_, index) => addMonths(thisMonth, index - span + 1));
    endOf = (start) => new Date(start.getFullYear(), start.getMonth() + 1, 0);
    labelOf = (start) => ({ label: `${start.getMonth() + 1}月`, title: `${start.getFullYear()}年${start.getMonth() + 1}月` });
  }

  const buckets: TrendBucket[] = starts.map((start, index) => {
    const endInclusive = endOf(start, index);
    const key = localISO(start);
    const { label, title } = labelOf(start, index);
    return {
      key,
      label,
      title: granularity === 'week' ? title : `${title}（截至 ${today < endInclusive ? localISO(today) : localISO(endInclusive)}）`,
      start: key,
      end: localISO(endInclusive),
      hasData: false,
      total: 0,
      avgIntensity: 0,
      counts: emptyCounts(),
      entries: [],
    };
  });

  const lastExclusive = granularity === 'week'
    ? new Date(starts[0].getFullYear(), starts[0].getMonth(), starts[0].getDate() + 7 * span)
    : addMonths(starts[0], span);
  const rangeStart = localISO(starts[0]);
  const rangeEndRaw = granularity === 'week'
    ? new Date(lastExclusive.getFullYear(), lastExclusive.getMonth(), lastExclusive.getDate() - 1)
    : new Date(lastExclusive.getFullYear(), lastExclusive.getMonth(), 0);

  for (const entry of entries) {
    if (entry.date < rangeStart) continue;
    const entryDate = new Date(`${entry.date}T00:00:00`);
    if (entryDate >= lastExclusive) continue;
    let index: number;
    if (granularity === 'week') {
      index = Math.round((startOfWeek(entryDate).getTime() - starts[0].getTime()) / (7 * day));
    } else {
      index = (entryDate.getFullYear() - starts[0].getFullYear()) * 12 + entryDate.getMonth() - starts[0].getMonth();
    }
    const bucket = buckets[index];
    if (!bucket) continue;
    bucket.entries.push(entry);
    bucket.counts[entry.emotion] += 1;
    bucket.total += 1;
  }

  let totalEntries = 0;
  let intensitySum = 0;
  let activeBuckets = 0;
  let peak: TrendResult['peak'] = null;
  for (const bucket of buckets) {
    bucket.hasData = bucket.total > 0;
    if (bucket.hasData) {
      activeBuckets += 1;
      totalEntries += bucket.total;
      intensitySum += bucket.entries.reduce((sum, item) => sum + item.intensity, 0);
      bucket.entries.sort((a, b) => a.date.localeCompare(b.date));
      bucket.avgIntensity = Math.round((bucket.entries.reduce((sum, item) => sum + item.intensity, 0) / bucket.total) * 10) / 10;
      if (!peak || bucket.total > peak.total) peak = { label: bucket.label, total: bucket.total };
    }
  }

  return {
    granularity,
    span,
    start: rangeStart,
    end: localISO(rangeEndRaw),
    buckets,
    totalEntries,
    activeBuckets,
    emptyBuckets: buckets.length - activeBuckets,
    avgIntensity: totalEntries ? Math.round((intensitySum / totalEntries) * 10) / 10 : 0,
    peak,
  };
}

export function sampleSnapshot(): GardenSnapshot {
  const today = new Date(); const entries: EmotionEntry[] = [];
  const seed: Emotion[] = ['喜悦', '喜悦', '平静', '平静', '平静', '平静', '喜悦', '忧伤', '焦虑', '平静', '喜悦'];
  seed.forEach((emotion, index) => { const date = new Date(today.getTime() - (seed.length - index - 1) * day).toISOString().slice(0, 10); entries.push(createEntry(emotion, index % 2 ? '今天注意到了自己的节奏。' : '给这一天留下一颗种子。', (index % 5) + 1, date)); });
  return { entries, plants: syncPlants(entries) };
}
