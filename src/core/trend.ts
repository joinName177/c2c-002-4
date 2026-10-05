import type { Emotion, EmotionEntry } from './models';
import { EMOTIONS } from './models';

export type TrendGranularity = 'week' | 'month';

export interface TrendBucket {
  key: string;
  label: string;
  start: string;
  end: string;
  total: number;
  counts: Record<Emotion, number>;
  avgIntensity: number | null;
  entries: EmotionEntry[];
}

export interface TrendSummary {
  totalEntries: number;
  activeBuckets: number;
  avgIntensity: number | null;
  topEmotion: { emotion: Emotion; count: number } | null;
  peakBucketKey: string | null;
  peakTotal: number;
}

export interface TrendResult {
  granularity: TrendGranularity;
  buckets: TrendBucket[];
  summary: TrendSummary;
}

function isoOf(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function mondayOf(date: Date): Date {
  const copy = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return copy;
}

export function aggregateTrend(entries: EmotionEntry[], granularity: TrendGranularity, bucketCount: number): TrendResult {
  const size = Math.max(1, Math.floor(bucketCount) || 1);
  const now = new Date();
  const current = granularity === 'month' ? new Date(now.getFullYear(), now.getMonth(), 1) : mondayOf(now);
  const buckets: TrendBucket[] = [];
  for (let back = size - 1; back >= 0; back -= 1) {
    const start = new Date(current);
    if (granularity === 'month') start.setMonth(start.getMonth() - back);
    else start.setDate(start.getDate() - back * 7);
    const end = new Date(start);
    if (granularity === 'month') end.setMonth(end.getMonth() + 1);
    else end.setDate(end.getDate() + 7);
    end.setDate(end.getDate() - 1);
    const startISO = isoOf(start);
    buckets.push({
      key: granularity === 'month' ? startISO.slice(0, 7) : startISO,
      label: granularity === 'month' ? `${start.getFullYear()}/${start.getMonth() + 1}` : `${start.getMonth() + 1}/${start.getDate()}`,
      start: startISO,
      end: isoOf(end),
      total: 0,
      counts: Object.fromEntries(EMOTIONS.map((emotion) => [emotion, 0])) as Record<Emotion, number>,
      avgIntensity: null,
      entries: [],
    });
  }
  const byKey = new Map(buckets.map((bucket) => [bucket.key, bucket]));
  const keyOf = (date: string) => (granularity === 'month' ? date.slice(0, 7) : isoOf(mondayOf(new Date(`${date}T00:00:00`))));
  let intensitySum = 0;
  for (const entry of entries) {
    const bucket = byKey.get(keyOf(entry.date));
    if (!bucket) continue;
    bucket.entries.push(entry);
    bucket.total += 1;
    bucket.counts[entry.emotion] += 1;
    intensitySum += entry.intensity;
  }
  for (const bucket of buckets) {
    bucket.entries.sort((a, b) => a.date.localeCompare(b.date));
    if (bucket.total) bucket.avgIntensity = Math.round((bucket.entries.reduce((sum, entry) => sum + entry.intensity, 0) / bucket.total) * 10) / 10;
  }
  const totalEntries = buckets.reduce((sum, bucket) => sum + bucket.total, 0);
  const emotionTotals = EMOTIONS.map((emotion) => ({ emotion, count: buckets.reduce((sum, bucket) => sum + bucket.counts[emotion], 0) })).sort((a, b) => b.count - a.count);
  const peak = buckets.reduce<TrendBucket | null>((best, bucket) => (bucket.total > 0 && (!best || bucket.total > best.total) ? bucket : best), null);
  return {
    granularity,
    buckets,
    summary: {
      totalEntries,
      activeBuckets: buckets.filter((bucket) => bucket.total > 0).length,
      avgIntensity: totalEntries ? Math.round((intensitySum / totalEntries) * 10) / 10 : null,
      topEmotion: emotionTotals[0].count ? emotionTotals[0] : null,
      peakBucketKey: peak?.key ?? null,
      peakTotal: peak?.total ?? 0,
    },
  };
}
