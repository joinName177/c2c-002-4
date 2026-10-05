<script setup lang="ts">
import { computed, nextTick, reactive, ref, watch } from 'vue';
import { LocalGardenRepository } from '../adapters/local-garden.repository';
import { EMOTION_META, EMOTIONS, type Emotion, type EmotionEntry } from '../core/models';
import { aggregateTrends, annualReport, createEntry, sampleSnapshot, syncPlants, type TrendBucket, type TrendGranularity } from '../core/garden-engine';

const repo = new LocalGardenRepository();
const state = reactive(repo.load());
const tab = ref<'花园' | '种植' | '时间轴' | '趋势' | '标本馆' | '年报'>('花园');
const selectedEmotion = ref<Emotion>('喜悦');
const notice = ref('');
const draft = reactive({ note: '', intensity: 3 });
const report = computed(() => annualReport(state.entries));
const living = computed(() => state.plants.filter((plant) => plant.status === '繁茂'));
const specimens = computed(() => state.plants.filter((plant) => plant.status === '枯萎'));
const timeline = computed(() => [...state.entries].sort((a, b) => b.date.localeCompare(a.date)));
function save() { state.plants = syncPlants(state.entries, state.plants); repo.save({ entries: state.entries, plants: state.plants }); }
function plant() { state.entries.unshift(createEntry(selectedEmotion.value, draft.note, draft.intensity)); draft.note = ''; save(); notice.value = `${EMOTION_META[selectedEmotion.value].plant} 已经种下`; tab.value = '花园'; }
function reset() { const fresh = sampleSnapshot(); state.entries = fresh.entries; state.plants = fresh.plants; save(); notice.value = '已恢复初始示例花园'; }

// —— 趋势页：粒度、范围、选中点。trend 是当次唯一聚合结果，图表与汇总都从它刷新 ——
const trendGranularity = ref<TrendGranularity>('week');
const trendSpan = ref(8);
const SPANS: Record<TrendGranularity, number[]> = { week: [8, 12, 24], month: [6, 12] };
const spanOptions = computed(() => SPANS[trendGranularity.value]);
const selectedBucketKey = ref<string | null>(null);
const locatedEntryId = ref<string | null>(null);

// 切换粒度时，原范围可能不适用于新粒度（如 24 周 → 月），回落到该粒度的第一个范围
watch(trendGranularity, (granularity) => {
  if (!SPANS[granularity].includes(trendSpan.value)) trendSpan.value = SPANS[granularity][0];
});

// 唯一口径：粒度或范围变化后，图表、汇总数字、选中点全部以这份新聚合结果为准
const trend = computed(() => aggregateTrends(state.entries, trendGranularity.value, trendSpan.value));

// 旧选中点若不在新范围内，立即清空，不保留上一轮的值
watch(trend, (result) => {
  if (selectedBucketKey.value && !result.buckets.some((bucket) => bucket.key === selectedBucketKey.value)) {
    selectedBucketKey.value = null;
  }
});

const selectedBucket = computed<TrendBucket | null>(() => trend.value.buckets.find((bucket) => bucket.key === selectedBucketKey.value) ?? null);

// 图表几何：两张折线图共用同一条时间横轴
const CHART = { width: 900, padL: 46, padR: 14, padT: 16, countH: 170, gapH: 46, intensityH: 120, padB: 34 };
const plotW = computed(() => CHART.width - CHART.padL - CHART.padR);
const bucketX = computed(() => (index: number) => CHART.padL + (trend.value.buckets.length <= 1 ? plotW.value / 2 : (index / (trend.value.buckets.length - 1)) * plotW.value));
const countMax = computed(() => Math.max(4, ...trend.value.buckets.flatMap((bucket) => EMOTIONS.map((emotion) => bucket.counts[emotion]))));
const yCount = computed(() => (value: number) => CHART.padT + CHART.countH - (value / countMax.value) * CHART.countH);
const intensityTop = computed(() => CHART.padT + CHART.countH + CHART.gapH);
const yIntensity = computed(() => (value: number) => intensityTop.value + CHART.intensityH - (value / 5) * CHART.intensityH);
const countTicks = computed(() => { const max = countMax.value; const step = max <= 5 ? 1 : Math.ceil(max / 4); return Array.from({ length: Math.floor(max / step) + 1 }, (_, i) => i * step); });
const labelEvery = computed(() => Math.ceil(trend.value.buckets.length / 12));
const selectedX = computed(() => {
  const index = trend.value.buckets.findIndex((bucket) => bucket.key === selectedBucketKey.value);
  return index < 0 ? null : bucketX.value(index);
});

type PointValue = { value: number | null };
// 空桶 / 某情绪当桶未出现 -> null，path 在此断开（M 起笔），不连成假趋势线
function buildLine(values: PointValue[], y: (value: number) => number): string {
  let path = '';
  let pen = false;
  values.forEach((point, index) => {
    if (point.value === null) { pen = false; return; }
    path += `${pen ? 'L' : 'M'}${bucketX.value(index).toFixed(1)},${y(point.value).toFixed(1)}`;
    pen = true;
  });
  return path;
}
const emotionLines = computed(() => EMOTIONS.map((emotion) => ({
  emotion,
  color: EMOTION_META[emotion].color,
  path: buildLine(trend.value.buckets.map((bucket) => ({ value: bucket.hasData ? bucket.counts[emotion] : null })), yCount.value),
})));
const intensityLine = computed(() => buildLine(trend.value.buckets.map((bucket) => ({ value: bucket.hasData ? bucket.avgIntensity : null })), yIntensity.value));

function toggleBucket(bucket: TrendBucket) {
  selectedBucketKey.value = selectedBucketKey.value === bucket.key ? null : bucket.key;
}

// 选中桶内按天归组，点击某一天跳到时间轴并定位到当天记录
const selectedDays = computed(() => {
  if (!selectedBucket.value) return [];
  const byDate = new Map<string, EmotionEntry[]>();
  for (const entry of selectedBucket.value.entries) {
    const group = byDate.get(entry.date);
    if (group) group.push(entry);
    else byDate.set(entry.date, [entry]);
  }
  return [...byDate.entries()].map(([date, entries]) => ({ date, entries }));
});
function weekdayCaption(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
}
function rangeCaption(start: string, end: string): string {
  const s = new Date(`${start}T00:00:00`);
  const e = new Date(`${end}T00:00:00`);
  return `${s.getFullYear()}年${s.getMonth() + 1}月${s.getDate()}日 – ${e.getMonth() + 1}月${e.getDate()}日`;
}
async function locateDay(date: string) {
  const target = timeline.value.find((entry) => entry.date === date);
  if (!target) return;
  locatedEntryId.value = target.id;
  tab.value = '时间轴';
  await nextTick();
  document.getElementById(`timeline-${target.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
}
</script>

<template>
  <div class="garden-app">
    <header class="garden-topbar"><div class="garden-brand"><span class="garden-mark">✿</span><div><span class="eyebrow">THE INNER GARDEN / 02</span><h1>情绪植物园</h1></div></div><div class="garden-top-actions"><span class="weather">今日花园 · {{ living.length }} 株在生长</span><button class="quiet-button" type="button" @click="reset">重置演示</button></div></header>
    <main class="garden-wrap"><section class="garden-hero"><div><span class="eyebrow green-text">DAILY EMOTION CULTIVATION</span><h2>给情绪一块<br /><i>可以生长的土壤。</i></h2><p>你不需要每天都阳光明媚，只需要为此刻诚实地浇一次水。</p></div><div class="garden-stats"><div><strong>{{ report.active }}</strong><span>活跃日</span></div><div><strong>{{ report.lushness }}<small>%</small></strong><span>花园繁茂度</span></div><div><strong>{{ state.entries.length }}</strong><span>情绪标本</span></div></div></section>
      <nav class="garden-tabs"><button v-for="item in ['花园', '种植', '时间轴', '趋势', '标本馆', '年报']" :key="item" type="button" :class="{ active: tab === item }" @click="tab = item as typeof tab">{{ item }}</button></nav>
      <section v-if="tab === '花园'" class="garden-board"><div class="board-heading"><div><span class="eyebrow">YOUR EMOTIONAL BIOME</span><h3>正在生长的情绪</h3></div><span class="season-label">秋季 · 第 40 周</span></div><div class="plant-grid"><article v-for="plant in living" :key="plant.id" class="plant-card" :style="{ '--plant-color': EMOTION_META[plant.emotion].color }"><div class="plant-card-top"><span class="plant-status">正在生长</span><span>{{ plant.streak }} 天连续</span></div><div class="plant-illustration"><span class="plant-glow"></span><strong>{{ EMOTION_META[plant.emotion].symbol }}</strong><i v-for="n in Math.min(plant.streak + 1, 5)" :key="n" :style="{ '--n': n }">●</i></div><div class="plant-info"><span class="plant-emotion">{{ plant.emotion }}</span><h4>{{ EMOTION_META[plant.emotion].plant }}</h4><p>{{ EMOTION_META[plant.emotion].hint }}</p><div class="growth-track"><span :style="{ width: `${Math.min(100, Math.max(12, plant.streak / 14 * 100))}%` }"></span></div><small>{{ plant.stage }} · 下一阶段还需 {{ Math.max(0, 3 - plant.streak) }} 天</small></div></article><button class="add-plant-card" type="button" @click="tab = '种植'"><span>＋</span><strong>种下一颗新情绪</strong><small>每天记录，植物就会长大</small></button></div></section>
      <section v-else-if="tab === '种植'" class="planting-layout"><article class="plant-form"><div class="board-heading"><div><span class="eyebrow">PLANT A FEELING</span><h3>今天的你，是什么天气？</h3></div></div><div class="emotion-picker"><button v-for="emotion in EMOTIONS" :key="emotion" type="button" :class="{ selected: selectedEmotion === emotion }" :style="{ '--emotion-color': EMOTION_META[emotion].color }" @click="selectedEmotion = emotion"><span>{{ EMOTION_META[emotion].symbol }}</span><b>{{ emotion }}</b><small>{{ EMOTION_META[emotion].plant }}</small></button></div><label>给这颗情绪留一句话<textarea v-model="draft.note" rows="5" placeholder="它今天为什么来到这里？"></textarea></label><label>情绪强度 <output>{{ draft.intensity }} / 5</output><input v-model.number="draft.intensity" type="range" min="1" max="5" /></label><button class="plant-button" type="button" @click="plant">种下这颗情绪 ✦</button><p class="notice">{{ notice }}</p></article><aside class="plant-preview" :style="{ '--preview-color': EMOTION_META[selectedEmotion].color }"><span class="eyebrow">PREVIEW / {{ selectedEmotion }}</span><div class="preview-plant">{{ EMOTION_META[selectedEmotion].symbol }}</div><h3>{{ EMOTION_META[selectedEmotion].plant }}</h3><p>今天种下，连续记录 3 天后发芽，7 天后开花，14 天后结果。</p></aside></section>
      <section v-else-if="tab === '时间轴'" class="timeline-section"><div class="board-heading"><div><span class="eyebrow">GROWTH TIMELINE</span><h3>每一天，都留下了一片叶子</h3></div></div><div class="timeline"><div v-for="(entry, index) in timeline" :id="`timeline-${entry.id}`" :key="entry.id" class="timeline-item" :class="{ located: locatedEntryId === entry.id }"><div class="timeline-date"><strong>{{ new Date(`${entry.date}T00:00:00`).getDate() }}</strong><span>{{ new Date(`${entry.date}T00:00:00`).toLocaleDateString('zh-CN', { month: 'short' }) }}</span></div><div class="timeline-dot" :style="{ background: EMOTION_META[entry.emotion].color }"></div><div class="timeline-content"><div><span class="timeline-emotion" :style="{ color: EMOTION_META[entry.emotion].color }">{{ EMOTION_META[entry.emotion].symbol }} {{ entry.emotion }}</span><span class="intensity">强度 {{ entry.intensity }}/5</span></div><p>{{ entry.note }}</p><small>{{ EMOTION_META[entry.emotion].plant }} · 第 {{ index + 1 }} 片叶子</small></div></div></div></section>
      <section v-else-if="tab === '标本馆'" class="specimen-section"><div class="board-heading"><div><span class="eyebrow">SPECIMEN ARCHIVE</span><h3>枯萎不是消失，是被好好保存</h3></div></div><div v-if="specimens.length" class="specimen-grid"><div v-for="plant in specimens" :key="plant.id" class="specimen-card"><div class="pressed-flower">{{ EMOTION_META[plant.emotion].symbol }}</div><div><span>{{ plant.emotion }} · {{ EMOTION_META[plant.emotion].plant }}</span><strong>生长了 {{ plant.entryIds.length }} 天</strong><small>最后浇水：{{ plant.lastWatered }}</small></div></div></div><div v-else class="empty-state">你的标本馆还是空的。持续记录，等一朵花完成它的季节。</div></section>
      <section v-else-if="tab === '趋势'" class="trend-section">
        <div class="board-heading">
          <div><span class="eyebrow">EMOTION TIDE / OVER TIME</span><h3>情绪起伏的潮线</h3></div>
          <div class="trend-controls">
            <div class="seg"><button v-for="g in (['week', 'month'] as const)" :key="g" type="button" :class="{ active: trendGranularity === g }" @click="trendGranularity = g">{{ g === 'week' ? '按周' : '按月' }}</button></div>
            <div class="seg"><button v-for="s in spanOptions" :key="s" type="button" :class="{ active: trendSpan === s }" @click="trendSpan = s">{{ trendGranularity === 'week' ? `近 ${s} 周` : `近 ${s} 个月` }}</button></div>
          </div>
        </div>

        <div class="trend-legend">
          <span v-for="emotion in EMOTIONS" :key="emotion" class="legend-item"><i :style="{ background: EMOTION_META[emotion].color }"></i>{{ EMOTION_META[emotion].symbol }} {{ emotion }} 次数</span>
          <span class="legend-item"><i class="dash"></i>平均强度（右轴 0–5）</span>
          <span class="legend-gap">浅色块＝无记录空档，折线在此断开</span>
        </div>

        <svg class="trend-chart" :viewBox="`0 0 ${CHART.width} ${intensityTop + CHART.intensityH + CHART.padB}`" role="img" aria-label="情绪出现次数与平均强度趋势图">
          <!-- 次数图网格 -->
          <g class="grid">
            <line v-for="tick in countTicks" :key="`cg-${tick}`" :x1="CHART.padL" :x2="CHART.width - CHART.padR" :y1="yCount(tick)" :y2="yCount(tick)"></line>
            <text v-for="tick in countTicks" :key="`ct-${tick}`" :x="CHART.padL - 8" :y="yCount(tick) + 3">{{ tick }}</text>
          </g>
          <text class="axis-note" :x="CHART.padL" :y="CHART.padT - 4">出现次数</text>
          <!-- 强度图网格 -->
          <g class="grid">
            <line v-for="tick in [1, 3, 5]" :key="`ig-${tick}`" :x1="CHART.padL" :x2="CHART.width - CHART.padR" :y1="yIntensity(tick)" :y2="yIntensity(tick)"></line>
            <text v-for="tick in [1, 3, 5]" :key="`it-${tick}`" :x="CHART.width - CHART.padR + 4" :y="yIntensity(tick) + 3">{{ tick }}</text>
          </g>
          <text class="axis-note" :x="CHART.padL" :y="intensityTop - 6">平均强度</text>

          <!-- 无记录空档：有数据桶之外的区间整体留底，不参与连线 -->
          <rect v-for="(bucket, index) in trend.buckets" v-show="!bucket.hasData" :key="`gap-${bucket.key}`" class="gap-band"
            :x="CHART.padL + (index - (index === 0 ? 0 : 0.5)) * (plotW / trend.buckets.length)"
            :y="CHART.padT" :width="plotW / trend.buckets.length" :height="CHART.countH + CHART.gapH + CHART.intensityH"></rect>

          <!-- 情绪次数折线：空桶处断开 -->
          <path v-for="line in emotionLines" :key="line.emotion" :d="line.path" fill="none" :stroke="line.color" stroke-width="1.8" stroke-linejoin="round"></path>
          <!-- 平均强度折线：同样在空桶处断开 -->
          <path :d="intensityLine" fill="none" stroke="#54765e" stroke-width="1.6" stroke-dasharray="5 4" stroke-linecap="round"></path>

          <!-- 次数点 -->
          <template v-for="(line, li) in emotionLines" :key="`dots-${line.emotion}`">
            <circle v-for="(bucket, index) in trend.buckets" v-show="bucket.hasData && bucket.counts[line.emotion] > 0" :key="`${li}-${bucket.key}`"
              :cx="bucketX(index)" :cy="yCount(bucket.counts[line.emotion])" r="3" :fill="line.color"></circle>
          </template>
          <!-- 强度点 -->
          <circle v-for="(bucket, index) in trend.buckets" v-show="bucket.hasData" :key="`i-${bucket.key}`"
            :cx="bucketX(index)" :cy="yIntensity(bucket.avgIntensity)" r="3" fill="#f4f7ee" stroke="#54765e" stroke-width="1.6"></circle>

          <!-- 选中引导线 -->
          <line v-if="selectedX !== null" :x1="selectedX" :x2="selectedX" :y1="CHART.padT" :y2="intensityTop + CHART.intensityH" class="select-guide"></line>

          <!-- x 轴标签 + 命中区 -->
          <g class="x-axis">
            <text v-for="(bucket, index) in trend.buckets" v-show="index % labelEvery === 0 || index === trend.buckets.length - 1" :key="`xl-${bucket.key}`"
              :x="bucketX(index)" :y="intensityTop + CHART.intensityH + 20">{{ bucket.label }}</text>
          </g>
          <rect v-for="(bucket, index) in trend.buckets" :key="`hit-${bucket.key}`" class="hit"
            :x="CHART.padL + (index - 0.5) * (plotW / trend.buckets.length)" :y="CHART.padT"
            :width="plotW / trend.buckets.length" :height="CHART.countH + CHART.gapH + CHART.intensityH"
            :class="{ on: selectedBucketKey === bucket.key }" @click="toggleBucket(bucket)">
            <title>{{ bucket.title }} · {{ bucket.hasData ? `${bucket.total} 次记录，平均强度 ${bucket.avgIntensity}/5` : '无记录空档' }}</title>
          </rect>
        </svg>

        <!-- 汇总数字：与图表同源，全部取自 trend 这一份聚合结果 -->
        <div class="trend-summary">
          <div class="trend-stat"><span>统计范围</span><strong>{{ rangeCaption(trend.start, trend.end) }}</strong><small>按{{ trendGranularity === 'week' ? '自然周（周一）' : '自然月' }} · {{ trend.span }} 个区间</small></div>
          <div class="trend-stat"><span>记录总数</span><strong>{{ trend.totalEntries }}</strong><small>覆盖 {{ trend.activeBuckets }} 个区间</small></div>
          <div class="trend-stat"><span>平均强度</span><strong>{{ trend.totalEntries ? trend.avgIntensity : '—' }}</strong><small>满分 5</small></div>
          <div class="trend-stat"><span>最高峰值</span><strong>{{ trend.peak ? trend.peak.total : '—' }}</strong><small>{{ trend.peak ? `出现在 ${trend.peak.label}` : '区间内暂无记录' }}</small></div>
          <div class="trend-stat"><span>空档区间</span><strong>{{ trend.emptyBuckets }}</strong><small>未记录的{{ trendGranularity === 'week' ? '周' : '月' }}，折线已断开</small></div>
        </div>

        <!-- 选中桶：同样只从同一份聚合结果的 bucket 取数 -->
        <div v-if="selectedBucket" class="trend-detail">
          <div class="detail-head">
            <div><span class="eyebrow">SELECTED BUCKET</span><h4>{{ selectedBucket.title }}</h4></div>
            <button type="button" class="quiet-button" @click="selectedBucketKey = null">取消选择 ✕</button>
          </div>
          <div class="detail-grid">
            <ul class="detail-days">
              <li v-for="day in selectedDays" :key="day.date">
                <button type="button" @click="locateDay(day.date)"><b>{{ weekdayCaption(day.date) }}</b><span>{{ day.entries.length }} 条记录 → 时间轴定位</span></button>
              </li>
            </ul>
            <div class="detail-counts">
              <div class="detail-totals">
                <div><strong>{{ selectedBucket.total }}</strong><span>记录次数</span></div>
                <div><strong>{{ selectedBucket.avgIntensity }}</strong><span>平均强度</span></div>
              </div>
              <div v-for="emotion in EMOTIONS" :key="emotion" class="count-row">
                <b>{{ EMOTION_META[emotion].symbol }} {{ emotion }}</b>
                <div><i :style="{ width: `${selectedBucket.total ? (selectedBucket.counts[emotion] / selectedBucket.total) * 100 : 0}%`, background: EMOTION_META[emotion].color }"></i></div>
                <small>{{ selectedBucket.counts[emotion] }}</small>
              </div>
            </div>
          </div>
        </div>
        <p v-else class="detail-hint">点击图表中的任意区间查看该{{ trendGranularity === 'week' ? '周' : '月' }}的逐日记录，再点某一天即可跳到时间轴定位。</p>
      </section>
      <section v-else class="report-section"><div class="report-heading"><span class="eyebrow">EMOTIONAL ECOLOGY REPORT · 2026</span><h3>你的情绪生态年报</h3><p>这一年，你和自己的内在天气相处得怎么样？</p></div><div class="report-grid"><div class="report-score"><span>花园繁茂度</span><strong>{{ report.lushness }}<small>/ 100</small></strong><div class="report-progress"><i :style="{ width: `${report.lushness}%` }"></i></div><p>每一次诚实的记录，都会让生态系统更完整。</p></div><div class="top-emotion"><span>最常出现的物种</span><div><strong :style="{ color: EMOTION_META[report.top.emotion].color }">{{ EMOTION_META[report.top.emotion].symbol }}</strong><h4>{{ report.top.emotion }}</h4></div><p>{{ report.top.count }} 次记录 · 是你今年最熟悉的一种天气</p></div><div class="count-chart"><span>情绪物种分布</span><div v-for="item in report.counts" :key="item.emotion" class="count-row"><b>{{ item.emotion }}</b><div><i :style="{ width: `${Math.max(5, item.count / Math.max(report.top.count, 1) * 100)}%`, background: EMOTION_META[item.emotion].color }"></i></div><small>{{ item.count }}</small></div></div></div></section>
    </main>
  </div>
</template>
