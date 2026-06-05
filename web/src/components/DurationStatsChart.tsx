import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { SimulationData } from '../lib/types';
import { ACTIVITIES } from '../lib/categories';
import type { SimulationStats } from '../lib/simulationStats';

/**
 * DurationStatsChart — horizontal box-plot showing continuous session lengths
 * for each of the 14 activities across all simulated students.
 *
 * Each row shows:
 *   - A thin whisker line from p5 to p95 (activity color, opacity 0.4)
 *   - A filled IQR box from p25 to p75, height 10px (activity color, opacity 0.7)
 *   - A vertical median tick, height 14px (activity color, stroke-width 2.5)
 *   - A small circle at the mean (r=4, activity color)
 *
 * Answers: "95% of students continuously eat for between X and Y minutes."
 */

const CHART_WIDTH = 1000;
const ROW_HEIGHT = 28;
const CHART_MARGIN = { top: 16, right: 60, bottom: 50, left: 148 } as const;

interface DurationStatsChartProps {
  data: SimulationData;
  stats: SimulationStats;
}

export default function DurationStatsChart({ data, stats }: DurationStatsChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);

  const numActivities = ACTIVITIES.length;
  const chartHeight = numActivities * ROW_HEIGHT + CHART_MARGIN.top + CHART_MARGIN.bottom;

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const innerWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
    const innerHeight = numActivities * ROW_HEIGHT;

    // x-axis: derive max from actual data so no activity is clipped
    const rawMax = Math.max(...stats.runStats.map((r) => r.p95), 60);
    const xMax = Math.ceil(rawMax / 60) * 60; // round up to next whole hour
    const xScale = d3.scaleLinear().domain([0, xMax]).range([0, innerWidth]);

    // y-axis: one row per activity, center-of-row
    // row i is centered at (i + 0.5) * ROW_HEIGHT
    const yCenter = (activityIndex: number) => (activityIndex + 0.5) * ROW_HEIGHT;

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const root = svg
      .append('g')
      .attr('transform', `translate(${CHART_MARGIN.left}, ${CHART_MARGIN.top})`);

    // ---- Subtle vertical grid at 60-min intervals --------------------------
    const xTickValues = Array.from({ length: Math.floor(xMax / 60) + 1 }, (_, i) => i * 60);
    root
      .append('g')
      .attr('class', 'duration-chart-grid')
      .selectAll('line')
      .data(xTickValues.slice(1)) // skip 0
      .join('line')
      .attr('x1', (d) => xScale(d))
      .attr('x2', (d) => xScale(d))
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#d8d2c2')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '2 4');

    // ---- Rows ---------------------------------------------------------------
    stats.runStats.forEach((rs) => {
      const activity = ACTIVITIES[rs.activityIndex];
      const cy = yCenter(rs.activityIndex);
      const color = activity.color;

      const p5x = xScale(rs.p5);
      const p25x = xScale(rs.p25);
      const medianX = xScale(rs.median);
      const p75x = xScale(rs.p75);
      const p95x = xScale(rs.p95);
      const meanX = xScale(rs.mean);

      const rowG = root.append('g').attr('class', `duration-row duration-row--${activity.id}`);

      // Whisker: p5 → p95
      rowG
        .append('line')
        .attr('x1', p5x)
        .attr('x2', p95x)
        .attr('y1', cy)
        .attr('y2', cy)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.4);

      // End caps at p5 and p95
      rowG
        .append('line')
        .attr('x1', p5x)
        .attr('x2', p5x)
        .attr('y1', cy - 4)
        .attr('y2', cy + 4)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.4);
      rowG
        .append('line')
        .attr('x1', p95x)
        .attr('x2', p95x)
        .attr('y1', cy - 4)
        .attr('y2', cy + 4)
        .attr('stroke', color)
        .attr('stroke-width', 1.5)
        .attr('stroke-opacity', 0.4);

      // IQR box: p25 → p75, height 10px, centered on cy
      rowG
        .append('rect')
        .attr('x', p25x)
        .attr('y', cy - 5)
        .attr('width', Math.max(0, p75x - p25x))
        .attr('height', 10)
        .attr('fill', color)
        .attr('fill-opacity', 0.7);

      // Median tick: height 14px
      rowG
        .append('line')
        .attr('x1', medianX)
        .attr('x2', medianX)
        .attr('y1', cy - 7)
        .attr('y2', cy + 7)
        .attr('stroke', color)
        .attr('stroke-width', 2.5);

      // Mean circle: r=4
      rowG
        .append('circle')
        .attr('cx', meanX)
        .attr('cy', cy)
        .attr('r', 4)
        .attr('fill', color);
    });

    // ---- Y axis (activity labels with color swatches) ----------------------
    const yAxis = root.append('g').attr('class', 'duration-chart-axis duration-chart-axis--y');

    ACTIVITIES.forEach((activity, i) => {
      const cy = yCenter(i);
      const labelG = yAxis.append('g').attr('transform', `translate(-8, ${cy})`);

      // Color swatch circle
      labelG
        .append('circle')
        .attr('cx', -10)
        .attr('cy', 0)
        .attr('r', 5)
        .attr('fill', activity.color);

      // Activity label
      labelG
        .append('text')
        .attr('x', -20)
        .attr('y', 4)
        .attr('text-anchor', 'end')
        .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
        .attr('font-size', 11)
        .attr('fill', '#444444')
        .text(activity.label);
    });

    // Left border line
    yAxis
      .append('line')
      .attr('x1', 0)
      .attr('x2', 0)
      .attr('y1', 0)
      .attr('y2', innerHeight)
      .attr('stroke', '#444444')
      .attr('stroke-width', 1);

    // ---- X axis ------------------------------------------------------------
    const xAxis = root
      .append('g')
      .attr('class', 'duration-chart-axis duration-chart-axis--x')
      .attr('transform', `translate(0, ${innerHeight})`);

    xAxis
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('stroke', '#444444')
      .attr('stroke-width', 1);

    xAxis
      .selectAll('g.tick')
      .data(xTickValues)
      .join('g')
      .attr('class', 'tick')
      .attr('transform', (d) => `translate(${xScale(d)}, 0)`)
      .each(function (d) {
        const tick = d3.select(this);
        tick.append('line').attr('y1', 0).attr('y2', 5).attr('stroke', '#444444');
        const label = d === 0 ? '0' : `${d / 60}h`;
        tick
          .append('text')
          .attr('y', 20)
          .attr('text-anchor', 'middle')
          .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
          .attr('font-size', 11)
          .attr('fill', '#444444')
          .text(label);
      });

    // X axis label
    xAxis
      .append('text')
      .attr('x', innerWidth / 2)
      .attr('y', 42)
      .attr('text-anchor', 'middle')
      .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
      .attr('font-size', 12)
      .attr('fill', '#444444')
      .text('minutes per continuous session');
  }, [stats, data, numActivities]);

  return (
    <div className="duration-stats-chart">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${CHART_WIDTH} ${chartHeight}`}
        preserveAspectRatio="xMidYMid meet"
        style={{ display: 'block', width: '100%', height: 'auto' }}
        role="img"
        aria-label="Box plots showing the distribution of continuous session lengths for each of the 14 student activities"
      />
    </div>
  );
}
