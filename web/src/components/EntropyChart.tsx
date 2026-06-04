import { useEffect, useMemo, useRef } from 'react';
import * as d3 from 'd3';
import type { SimulationData } from '../lib/types';
import { ACTIVITIES } from '../lib/categories';

/**
 * EntropyChart — total conditional entropy H(activity | time-of-day) over
 * the simulated 24h day. One bold line, no clutter.
 *
 * Theory
 * ------
 * Let A_t be the random activity of a uniformly chosen student at block t,
 * and let p_i(t) = P(A_t = i) be the activity-i marginal at t, estimated
 * from the 1,000 simulated trajectories. The conditional entropy
 *
 *     H(A | T = t) = − Σ_i  p_i(t) · log₂ p_i(t)            [bits]
 *
 * traces the **predictability** of student life across the day. It is
 * low at 3am (everyone is sleeping → the activity distribution is a
 * near-degenerate point mass), and high in the late evening (students
 * scatter across study, leisure, social, food, sleep → the distribution
 * is spread). The theoretical max for 14 activities is log₂(14) ≈ 3.81
 * bits, achieved only when the population is uniformly spread across all
 * 14 categories.
 *
 * Visual conventions
 * ------------------
 * - Single bold black line. Faint area fill underneath for visual punch.
 * - x-axis: minute-of-day, ticks every 3 hours starting at 06:00 (the
 *   simulation's anchor `data.startMinute`) wrapping back.
 * - y-axis: bits in [0, max·1.1].
 *
 * Performance
 * -----------
 * O(numStudents · numBlocks) computation, memoized on `data` (~288k integer
 * reads at mount). No per-frame work.
 */

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 280;
const CHART_MARGIN = { top: 24, right: 28, bottom: 40, left: 56 } as const;

/** Natural log of 2, used to convert nats → bits. */
const LN2 = Math.log(2);

/** Per-activity term `−p · log₂ p`; `0` when `p ≤ 0` to avoid `log(0) = −∞`. */
function entropyTerm(probability: number): number {
  if (probability <= 0) return 0;
  return -probability * (Math.log(probability) / LN2);
}

interface EntropyData {
  /** Total conditional entropy H(A|T=t) in bits. Length: numBlocks. */
  total: number[];
  /** X coordinate (minutes since visual day start) for each block. */
  minutesSinceStart: number[];
}

interface EntropyChartProps {
  data: SimulationData;
}

export default function EntropyChart({ data }: EntropyChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const entropyData: EntropyData = useMemo(() => {
    const numActivities = ACTIVITIES.length;
    const numBlocks = data.numBlocks;
    const numStudents = data.numStudents;
    const blockMinutes = data.blockMinutes;

    const total = new Array<number>(numBlocks);
    const minutesSinceStart = new Array<number>(numBlocks);
    const counts = new Array<number>(numActivities);

    for (let t = 0; t < numBlocks; t++) {
      counts.fill(0);
      for (let i = 0; i < numStudents; i++) {
        counts[data.students[i][t]] += 1;
      }
      let totalEntropy = 0;
      for (let a = 0; a < numActivities; a++) {
        const probability = counts[a] / numStudents;
        totalEntropy += entropyTerm(probability);
      }
      total[t] = totalEntropy;
      minutesSinceStart[t] = (t + 0.5) * blockMinutes;
    }

    return { total, minutesSinceStart };
  }, [data]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const numBlocks = entropyData.total.length;
    if (numBlocks === 0) return;

    const innerWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
    const innerHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;

    const xScale = d3.scaleLinear().domain([0, 1440]).range([0, innerWidth]);
    const yMaxRaw = d3.max(entropyData.total) ?? 1;
    const yScale = d3
      .scaleLinear()
      .domain([0, yMaxRaw * 1.1])
      .nice()
      .range([innerHeight, 0]);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const root = svg
      .append('g')
      .attr('transform', `translate(${CHART_MARGIN.left}, ${CHART_MARGIN.top})`);

    // ---- Subtle horizontal grid -----------------------------------------
    const yTicks = yScale.ticks(5);
    root
      .append('g')
      .attr('class', 'entropy-chart-grid')
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

    // ---- X axis ----------------------------------------------------------
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
      .attr('class', 'entropy-chart-axis entropy-chart-axis--x')
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
        tick
          .append('line')
          .attr('y1', 0)
          .attr('y2', 5)
          .attr('stroke', '#444444');
        tick
          .append('text')
          .attr('y', 20)
          .attr('text-anchor', 'middle')
          .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
          .attr('font-size', 11)
          .attr('fill', '#444444')
          .text(tickLabels[i]);
      });

    // ---- Y axis ----------------------------------------------------------
    const yAxis = root.append('g').attr('class', 'entropy-chart-axis entropy-chart-axis--y');
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
          .text(d.toFixed(1));
      });
    yAxis
      .append('text')
      .attr('transform', `translate(${-CHART_MARGIN.left + 14}, ${innerHeight / 2}) rotate(-90)`)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
      .attr('font-size', 12)
      .attr('fill', '#444444')
      .text('H(A | T = t)   bits');

    // ---- Area + line -----------------------------------------------------
    const totalSeries = entropyData.minutesSinceStart.map((minute, t) => ({
      x: minute,
      y: entropyData.total[t],
    }));

    const areaGenerator = d3
      .area<{ x: number; y: number }>()
      .x((point) => xScale(point.x))
      .y0(innerHeight)
      .y1((point) => yScale(point.y))
      .curve(d3.curveMonotoneX);

    const lineGenerator = d3
      .line<{ x: number; y: number }>()
      .x((point) => xScale(point.x))
      .y((point) => yScale(point.y))
      .curve(d3.curveMonotoneX);

    root
      .append('path')
      .datum(totalSeries)
      .attr('class', 'entropy-chart-area')
      .attr('fill', '#222222')
      .attr('fill-opacity', 0.08)
      .attr('d', areaGenerator);

    root
      .append('path')
      .datum(totalSeries)
      .attr('class', 'entropy-chart-line entropy-chart-line--total')
      .attr('fill', 'none')
      .attr('stroke', '#222222')
      .attr('stroke-width', 2.4)
      .attr('d', lineGenerator);
  }, [entropyData, data.startMinute]);

  return (
    <div className="entropy-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: 'auto' }}
        role="img"
        aria-label="Total conditional entropy of activity given time of day, plotted across the 24-hour simulated day"
      />
    </div>
  );
}
