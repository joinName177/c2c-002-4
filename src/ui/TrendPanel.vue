<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { EMOTIONS, EMOTION_META, type Emotion, type EmotionEntry } from '../core/models';
import { aggregateTrend, type TrendGranularity } from '../core/trend';

const props = defineProps<{ entries: EmotionEntry[] }>();
const emit = defineEmits<{ locate: [date: string] }>();

const RANGE_OPTIONS: Record<TrendGranularity, { label: string; buckets: number }[]> = {
  week: [{ label: '近 8 周', buckets: 8 }, { label: '近 16 周', buckets: 16 }, { label: '近 32 周', buckets: 32 }],
  month: [{ label: '近 6 个月', buckets: 6 }, { label: '近 12 个月', buckets: 12 }, { label: '近 24 个月', buckets: 24 }],
};

const granularity = ref<TrendGranularity>('week');
const rangeIndex = ref(0);
const selectedKey = ref<string | null>(null);

const rangeOptions = computed(() => RANGE_OPTIONS[granularity.value]);
// 唯一口径：图表、汇总数字、选中点全部来自这一次聚合结果
const trend = computed(() => aggregateTrend(props.entries, granularity.value, rangeOptions.value[Math.min(rangeIndex.value, rangeOptions.value.length - 1)].buckets));

// 聚合结果刷新后，旧的选中点若不在新范围内就清空，不保留上一轮的值
watch(trend, (result) => {
  if (selectedKey.value && !result.buckets.some((bucket) => bucket.key === selectedKey.value)) selectedKey.value = null;
});

const unit = computed(() => (granularity.value === 'week' ? '周' : '月'));
const selectedIndex = computed(() => trend.value.buckets.findIndex((bucket) => bucket.key === selectedKey.value));
const selectedBucket = computed(() => (selectedIndex.value >= 0 ? trend.value.buckets[selectedIndex.value] : null));

function setGranularity(value: TrendGranularity) { granularity.value = value; rangeIndex.value = 0; }
function toggleBucket(key: string) { selectedKey.value = selectedKey.value === key ? null : key; }

// ---- 图表几何 ----
const STEP = 54;
const PAD = { left: 40, right: 18 };
const COUNTS = { top: 26, height: 120 };
const INTENSITY = { top: 196, height: 92 };
const AXIS_Y = 306;
const SVG_H = 322;
const INTENSITY_TICKS = [0, 1, 2, 3, 4, 5];
const plotHeight = INTENSITY.top + INTENSITY.height - COUNTS.top;

const chartWidth = computed(() => Math.max(660, PAD.left + trend.value.buckets.length * STEP + PAD.right));
const xOf = (index: number) => PAD.left + index * STEP + STEP / 2;
const bandX = (index: number) => PAD.left + index * STEP;

const countScale = computed(() => {
  const max = Math.max(2, ...trend.value.buckets.flatMap((bucket) => EMOTIONS.map((emotion) => bucket.counts[emotion])));
  const step = max <= 5 ? 1 : Math.ceil(max / 5);
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= top; value += step) ticks.push(value);
  return { top, ticks };
});
const yCount = (value: number) => COUNTS.top + (1 - value / countScale.value.top) * COUNTS.height;
const yIntensity = (value: number) => INTENSITY.top + (1 - value / 5) * INTENSITY.height;

// 没有记录的周期返回 null，折线在这里断开形成空档
const countSeries = (emotion: Emotion) => trend.value.buckets.map((bucket) => (bucket.total ? bucket.counts[emotion] : null));
const intensitySeries = computed(() => trend.value.buckets.map((bucket) => bucket.avgIntensity));

function linePath(values: (number | null)[], yFn: (value: number) => number): string {
  let path = '';
  let pen = false;
  values.forEach((value, index) => {
    if (value === null) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${xOf(index).toFixed(1)},${yFn(value).toFixed(1)}`;
    pen = true;
  });
  return path;
}

// ---- 汇总数字（同一份 trend 结果） ----
const topEmotionText = computed(() => trend.value.summary.topEmotion?.emotion ?? '—');
const topEmotionColor = computed(() => (trend.value.summary.topEmotion ? EMOTION_META[trend.value.summary.topEmotion.emotion].color : '#8a9a8d'));
const peakLabel = computed(() => {
  const key = trend.value.summary.peakBucketKey;
  if (!key) return '—';
  return trend.value.buckets.find((bucket) => bucket.key === key)?.label ?? '—';
});

// ---- 选中周期的每一天 ----
const selectedDays = computed(() => {
  const bucket = selectedBucket.value;
  if (!bucket) return [];
  const byDate = new Map<string, EmotionEntry[]>();
  for (const entry of bucket.entries) {
    const list = byDate.get(entry.date) ?? [];
    list.push(entry);
    byDate.set(entry.date, list);
  }
  return [...byDate.entries()].map(([date, items]) => ({ date, items })).sort((a, b) => a.date.localeCompare(b.date));
});
const now = new Date();
const todayISO = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const emptyDayCount = computed(() => {
  const bucket = selectedBucket.value;
  if (!bucket) return 0;
  const end = bucket.end > todayISO ? todayISO : bucket.end;
  if (bucket.start > end) return 0;
  const days = Math.round((new Date(`${end}T00:00:00`).getTime() - new Date(`${bucket.start}T00:00:00`).getTime()) / 86400000) + 1;
  return Math.max(0, days - selectedDays.value.length);
});
const dayLabel = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', weekday: 'short' });
</script>

<template>
  <section class="trend-section">
    <div class="board-heading">
      <div><span class="eyebrow">EMOTION TRENDS</span><h3>情绪的起落，被时间连成线</h3></div>
      <div class="trend-controls">
        <div class="segmented">
          <button type="button" :class="{ active: granularity === 'week' }" @click="setGranularity('week')">按周</button>
          <button type="button" :class="{ active: granularity === 'month' }" @click="setGranularity('month')">按月</button>
        </div>
        <div class="segmented">
          <button v-for="(option, index) in rangeOptions" :key="option.label" type="button" :class="{ active: rangeIndex === index }" @click="rangeIndex = index">{{ option.label }}</button>
        </div>
      </div>
    </div>
    <div class="trend-summary">
      <div><strong>{{ trend.summary.totalEntries }}</strong><span>范围内记录</span></div>
      <div><strong>{{ trend.summary.activeBuckets }}<small> / {{ trend.buckets.length }}</small></strong><span>有记录的{{ unit }}</span></div>
      <div><strong>{{ trend.summary.avgIntensity ?? '—' }}</strong><span>平均强度</span></div>
      <div><strong :style="{ color: topEmotionColor }">{{ topEmotionText }}</strong><span>最高频情绪</span></div>
      <div><strong>{{ peakLabel }}</strong><span>峰值{{ unit }} · {{ trend.summary.peakTotal }} 条</span></div>
    </div>
    <div class="trend-chart">
      <div class="chart-head">
        <span>上：各情绪出现次数 · 下：平均强度</span>
        <div class="chart-legend">
          <span v-for="emotion in EMOTIONS" :key="emotion"><i :style="{ background: EMOTION_META[emotion].color }"></i>{{ emotion }}</span>
          <span><i class="legend-intensity"></i>平均强度</span>
        </div>
      </div>
      <div class="chart-scroll">
        <svg :width="chartWidth" :height="SVG_H" :viewBox="`0 0 ${chartWidth} ${SVG_H}`" role="img">
          <template v-for="(bucket, i) in trend.buckets" :key="`gap-${bucket.key}`">
            <rect v-if="!bucket.total" class="gap-band" :x="bandX(i)" :y="COUNTS.top" :width="STEP" :height="plotHeight" />
          </template>
          <rect v-if="selectedIndex >= 0" class="selected-band" :x="bandX(selectedIndex)" :y="COUNTS.top" :width="STEP" :height="plotHeight" />
          <g v-for="tick in countScale.ticks" :key="`ct-${tick}`">
            <line class="grid" :x1="PAD.left" :x2="chartWidth - PAD.right" :y1="yCount(tick)" :y2="yCount(tick)" />
            <text class="axis-label" :x="PAD.left - 7" :y="yCount(tick)" text-anchor="end" dominant-baseline="central">{{ tick }}</text>
          </g>
          <g v-for="tick in INTENSITY_TICKS" :key="`it-${tick}`">
            <line class="grid" :x1="PAD.left" :x2="chartWidth - PAD.right" :y1="yIntensity(tick)" :y2="yIntensity(tick)" />
            <text class="axis-label" :x="PAD.left - 7" :y="yIntensity(tick)" text-anchor="end" dominant-baseline="central">{{ tick }}</text>
          </g>
          <line class="grid divider" :x1="PAD.left" :x2="chartWidth - PAD.right" :y1="171" :y2="171" />
          <text class="panel-caption" :x="PAD.left" :y="14">各情绪出现次数</text>
          <text class="panel-caption" :x="PAD.left" :y="INTENSITY.top - 12">平均强度（0–5）</text>
          <text v-for="(bucket, i) in trend.buckets" :key="`xl-${bucket.key}`" class="axis-label" :x="xOf(i)" :y="AXIS_Y" text-anchor="middle">{{ bucket.label }}</text>
          <g v-for="emotion in EMOTIONS" :key="emotion">
            <path class="trend-line" :stroke="EMOTION_META[emotion].color" :d="linePath(countSeries(emotion), yCount)" />
            <template v-for="(bucket, i) in trend.buckets" :key="bucket.key">
              <circle v-if="bucket.total" :cx="xOf(i)" :cy="yCount(bucket.counts[emotion])" r="2.6" :fill="EMOTION_META[emotion].color" />
            </template>
          </g>
          <path class="trend-line intensity-line" :d="linePath(intensitySeries, yIntensity)" />
          <template v-for="(bucket, i) in trend.buckets" :key="`ip-${bucket.key}`">
            <circle v-if="bucket.avgIntensity !== null" class="intensity-dot" :cx="xOf(i)" :cy="yIntensity(bucket.avgIntensity)" r="3" />
          </template>
          <rect v-for="(bucket, i) in trend.buckets" :key="`hit-${bucket.key}`" class="hit-band" :x="bandX(i)" :y="COUNTS.top" :width="STEP" :height="plotHeight" @click="toggleBucket(bucket.key)" />
        </svg>
      </div>
      <p class="chart-note">空档表示该{{ unit }}没有任何记录，折线不会跨空档连接。点击某个{{ unit }}可以查看其中的每一天。</p>
    </div>
    <div v-if="selectedBucket" class="bucket-detail">
      <div class="bucket-detail-head">
        <div><span class="eyebrow">SELECTED · {{ granularity === 'week' ? 'WEEK' : 'MONTH' }}</span><h4>{{ selectedBucket.start }} ~ {{ selectedBucket.end }}</h4></div>
        <span class="bucket-meta">{{ selectedBucket.total }} 条记录 · 平均强度 {{ selectedBucket.avgIntensity ?? '—' }}</span>
        <button class="quiet-button" type="button" @click="selectedKey = null">清除选择</button>
      </div>
      <div v-if="selectedDays.length" class="day-chips">
        <button v-for="day in selectedDays" :key="day.date" class="day-chip" type="button" @click="emit('locate', day.date)">
          <b>{{ dayLabel(day.date) }}</b>
          <span class="day-symbols"><i v-for="item in day.items" :key="item.id" :style="{ color: EMOTION_META[item.emotion].color }">{{ EMOTION_META[item.emotion].symbol }}</i></span>
          <small>定位到时间轴 →</small>
        </button>
      </div>
      <div v-else class="empty-state">这个{{ unit }}没有记录，时间轴上没有可定位的叶子。</div>
      <p v-if="emptyDayCount" class="gap-note">其余 {{ emptyDayCount }} 天没有记录，在图表上留作空档。</p>
    </div>
    <p v-else class="trend-hint">点击图表中的某个{{ unit }}，查看它包含的每一天，并跳到时间轴定位当天记录。</p>
  </section>
</template>
