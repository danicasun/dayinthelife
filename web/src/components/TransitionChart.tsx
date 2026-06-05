import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { ActivityId, SimulationData } from '../lib/types';
import { ACTIVITIES, findActivityIndex } from '../lib/categories';
import type { SimulationStats } from '../lib/simulationStats';

/**
 * TransitionChart — for a selected "from" activity, plots the probability of
 * transitioning OUT of that activity INTO each other activity at each 5-minute
 * block across the day.
 *
 * Self-transitions (staying in the same activity) are excluded — they dominate
 * and make all other transitions invisible. The top-5 destination activities
 * by max probability are shown as colored lines.
 */

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 280;
const CHART_MARGIN = { top: 24, right: 28, bottom: 40, left: 56 } as const;

interface TransitionChartProps {
  data: SimulationData;
  stats: SimulationStats;
}

export default function TransitionChart({ data, stats }: TransitionChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<ActivityId>('eat');

  const selectedActivityIndex = useMemo(
    () => findActivityIndex(selectedActivityId),
    [selectedActivityId],
  );
  const selectedActivity = ACTIVITIES[selectedActivityIndex];

  // Build per-block non-self transition probabilities for each destination
  // and identify the top-5 destinations by max probability across all blocks.
  const { seriesData, top5Indices } = useMemo(() => {
    const { transitionProbs } = stats;
    const numBlocks = transitionProbs.length;
    const numActivities = ACTIVITIES.length;
    const fromIdx = selectedActivityIndex;
    const blockMinutes = data.blockMinutes;

    // Shape: [numActivities][numBlocks] — probability to transition FROM→TO at block t
    const probs: number[][] = Array.from({ length: numActivities }, () =>
      new Array<number>(numBlocks).fill(0),
    );

    for (let t = 0; t < numBlocks; t++) {
      const row = transitionProbs[t][fromIdx];
      for (let toIdx = 0; toIdx < numActivities; toIdx++) {
        if (toIdx === fromIdx) continue; // exclude self-transition
        probs[toIdx][t] = row[toIdx];
      }
    }

    // Find top-5 destinations by max probability across all blocks
    const maxByDest = ACTIVITIES.map((_, toIdx) => {
      if (toIdx === fromIdx) return -1;
      let maxP = 0;
      for (let t = 0; t < numBlocks; t++) {
        if (probs[toIdx][t] > maxP) maxP = probs[toIdx][t];
      }
      return maxP;
    });

    const ranked = ACTIVITIES.map((_, i) => i)
      .filter((i) => i !== fromIdx)
      .sort((a, b) => maxByDest[b] - maxByDest[a]);
    const top5 = ranked.slice(0, 5);

    // Build line series: { minute, prob }[]
    // minute = block midpoint in minutes since startMinute
    const seriesData = top5.map((toIdx) => ({
      toIdx,
      points: Array.from({ length: numBlocks }, (_, t) => ({
        minute: (t + 0.5) * blockMinutes,
        prob: probs[toIdx][t],
      })),
    }));

    return { seriesData, top5Indices: top5 };
  }, [stats, selectedActivityIndex, data.blockMinutes]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    if (seriesData.length === 0) return;

    const innerWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
    const innerHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;

    const xScale = d3.scaleLinear().domain([0, 1440]).range([0, innerWidth]);

    // yMax = max non-self transition prob for selected activity
    let yMaxRaw = 0;
    for (const series of seriesData) {
      for (const pt of series.points) {
        if (pt.prob > yMaxRaw) yMaxRaw = pt.prob;
      }
    }
    const yScale = d3
      .scaleLinear()
      .domain([0, Math.max(0.01, yMaxRaw * 1.1)])
      .nice()
      .range([innerHeight, 0]);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const root = svg
      .append('g')
      .attr('transform', `translate(${CHART_MARGIN.left}, ${CHART_MARGIN.top})`);

    // ---- Subtle horizontal grid ------------------------------------------
    const yTicks = yScale.ticks(5);
    root
      .append('g')
      .attr('class', 'transition-chart-grid')
      .selectAll('line')
      .data(yTicks)
      .join('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d) => yScale(d))
      .attr('y2', (d) => yScale(d))
      .attr('stroke', '#d8d2c2')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 4');

    // ---- X axis -------------------------------------------------------------
    const startMinute = data.startMinute;
    const tickMinuteOffsets = [0, 180, 360, 540, 720, 900, 1080, 1260, 1440];
    const tickLabels = tickMinuteOffsets.map((offset) => {
      const minuteOfDay = (startMinute + offset) % 1440;
      const hour24 = Math.floor(minuteOfDay / 60);
      const hour12 = ((hour24 + 11) % 12) + 1;
      const ampm = hour24 < 12 ? 'am' : 'pm';
      return `${hour12}${ampm}`;
    });

    const xAxis = root
      .append('g')
      .attr('class', 'transition-chart-axis transition-chart-axis--x')
      .attr('transform', `translate(0, ${innerHeight})`);
    xAxis
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('stroke', '#444444')
      .attr('stroke-width', 1);
    xAxis
      .selectAll('g.tick')
      .data(tickMinuteOffsets)
      .join('g')
      .attr('class', 'tick')
      .attr('transform', (d) => `translate(${xScale(d)}, 0)`)
      .each(function (_, i) {
        const tick = d3.select(this);
        tick.append('line').attr('y1', 0).attr('y2', 5).attr('stroke', '#444444');
        tick
          .append('text')
          .attr('y', 20)
          .attr('text-anchor', 'middle')
          .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
          .attr('font-size', 11)
          .attr('fill', '#444444')
          .text(tickLabels[i]);
      });

    // ---- Y axis -------------------------------------------------------------
    const yAxis = root
      .append('g')
      .attr('class', 'transition-chart-axis transition-chart-axis--y');
    yAxis
      .append('line')
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#444444');
    yAxis
      .selectAll('g.tick')
      .data(yTicks)
      .join('g')
      .attr('class', 'tick')
      .attr('transform', (d) => `translate(0, ${yScale(d)})`)
      .each(function (d) {
        const tick = d3.select(this);
        tick.append('line').attr('x1', -5).attr('x2', 0).attr('stroke', '#444444');
        tick
          .append('text')
          .attr('x', -10)
          .attr('y', 4)
          .attr('text-anchor', 'end')
          .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
          .attr('font-size', 11)
          .attr('fill', '#444444')
          .text(`${(d * 100).toFixed(1)}%`);
      });
    yAxis
      .append('text')
      .attr('transform', `translate(${-CHART_MARGIN.left + 14}, ${innerHeight / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
      .attr('font-size', 12)
      .attr('fill', '#444444')
      .text('P(transition to activity)');

    // ---- Lines per top-5 destination ----------------------------------------
    const lineGenerator = d3
      .line<{ minute: number; prob: number }>()
      .x((pt) => xScale(pt.minute))
      .y((pt) => yScale(pt.prob))
      .curve(d3.curveMonotoneX);

    for (const series of seriesData) {
      const activity = ACTIVITIES[series.toIdx];
      root
        .append('path')
        .datum(series.points)
        .attr('fill', 'none')
        .attr('stroke', activity.color)
        .attr('stroke-width', 2)
        .attr('d', lineGenerator);
    }

    // ---- Legend (top-right) ------------------------------------------------
    const legendX = innerWidth - 4;
    const legendStartY = 8;
    const legendRowH = 18;

    top5Indices.forEach((toIdx, rank) => {
      const activity = ACTIVITIES[toIdx];
      const ly = legendStartY + rank * legendRowH;
      const legendG = root.append('g').attr('transform', `translate(${legendX}, ${ly})`);

      legendG
        .append('rect')
        .attr('x', -10)
        .attr('y', -5)
        .attr('width', 10)
        .attr('height', 10)
        .attr('fill', activity.color)
        .attr('rx', 2);

      legendG
        .append('text')
        .attr('x', -16)
        .attr('y', 4)
        .attr('text-anchor', 'end')
        .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
        .attr('font-size', 11)
        .attr('fill', '#444444')
        .text(activity.label);
    });
  }, [seriesData, top5Indices, data.startMinute, selectedActivity]);

  return (
    <div className="transition-chart">
      <div className="chart-controls">
        <label className="chart-controls__label" htmlFor="transition-activity-select">
          From activity:
        </label>
        <select
          id="transition-activity-select"
          className="chart-controls__select"
          value={selectedActivityId}
          onChange={(e) => setSelectedActivityId(e.target.value as ActivityId)}
        >
          {ACTIVITIES.map((activity) => (
            <option key={activity.id} value={activity.id}>
              {activity.label}
            </option>
          ))}
        </select>
        <span
          className="chart-controls__swatch"
          aria-hidden="true"
          style={{ backgroundColor: selectedActivity.color }}
        />
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: 'auto' }}
        role="img"
        aria-label={`Probability of transitioning out of ${selectedActivity.label} into each other activity across the day`}
      />
    </div>
  );
}
