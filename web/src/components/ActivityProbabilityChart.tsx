import { useEffect, useMemo, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { ActivityId, SimulationData } from '../lib/types';
import { ACTIVITIES } from '../lib/categories';
import { betaInverseCDF, betaMean } from '../lib/betaDistribution';

/**
 * ActivityProbabilityChart — interactive single-activity probability trace
 * P(A_t = i | T = t) across the 24h day, with Bayesian 95% credible
 * intervals computed via Beta-Binomial conjugacy on the *survey* counts.
 *
 * CS109 statistics
 * ----------------
 * For each block `t` and activity `i`, we treat the count of survey
 * respondents in activity `i` at time `t` — call it `k_i(t)` — as a
 * Binomial(N, p_i(t)) draw, where N is the number of survey respondents
 * (`data.numSurveyRespondents`). We do NOT use the simulated counts:
 * the 1000 synthetic trajectories are themselves draws from a model fit
 * to the survey, so the epistemic uncertainty about `p_i(t)` is bounded
 * by the survey sample size, not by the simulation count.
 *
 * The conjugate prior for a Binomial proportion is the Beta family. We
 * use a **uniform Beta(1, 1) prior**, which is flat on [0, 1] and adds
 * exactly one prior pseudo-success and one prior pseudo-failure. The
 * posterior is then
 *
 *     p_i(t) | k_i(t)  ~  Beta( k_i(t) + 1,  N − k_i(t) + 1 ).
 *
 * The chart renders:
 *
 *   - The posterior **mean** `(k + 1) / (N + 2)` as the primary line.
 *   - A shaded band spanning the **95% Bayesian credible interval**:
 *     the 2.5% and 97.5% quantiles of the Beta posterior, computed by
 *     numerical inversion of the regularized incomplete beta CDF
 *     (see `lib/betaDistribution.ts`). We use exact quantiles instead
 *     of `μ ± 1.96·σ` because at N = 41 the Beta posterior is visibly
 *     skewed near the boundaries (e.g. when k = N or k = 0).
 *
 * Reference lines:
 *  - Dashed horizontal: marginal P(A = i) = (1/T) Σ_t p_i(t), i.e. the
 *    average share of the day a randomly chosen student spends in this
 *    activity. The conditional curve oscillates around this baseline.
 *
 * Performance
 * -----------
 * For each selected activity we compute `numBlocks` posterior summaries.
 * Each summary requires two `betaInverseCDF` calls (≤ ~30 bisection steps
 * each), so the total work is ~17000 incomplete-beta evaluations per
 * selection change. Memoized on `[data, selectedActivityIndex]` so it
 * reruns at most once per dropdown event, never per animation frame.
 */

const CHART_WIDTH = 1000;
const CHART_HEIGHT = 320;
const CHART_MARGIN = { top: 24, right: 28, bottom: 40, left: 56 } as const;

/** Uniform Beta(1, 1) prior — flat on [0, 1], one pseudo-success + one pseudo-failure. */
const PRIOR_ALPHA = 1;
const PRIOR_BETA = 1;

/** Lower / upper quantile probabilities for a 95% credible interval. */
const CREDIBLE_LOWER_QUANTILE = 0.025;
const CREDIBLE_UPPER_QUANTILE = 0.975;

interface BlockProbability {
  /** Block midpoint in minutes since the visual day start (06:00). */
  minute: number;
  /** Posterior mean (k + 1) / (N + 2) under Beta(1, 1) prior. */
  posteriorMean: number;
  /** 2.5% quantile of Beta(k + 1, N − k + 1). */
  credibleLow: number;
  /** 97.5% quantile of Beta(k + 1, N − k + 1). */
  credibleHigh: number;
}

/**
 * Closed-form posterior summary for the Beta posterior under a Beta(1, 1)
 * prior, returning the posterior mean *and* the 95% credible-interval
 * endpoints (2.5% and 97.5% Beta quantiles, computed numerically).
 *
 *   posterior:  p | k  ~  Beta(k + 1, N − k + 1)
 *
 * @param observedSuccesses  k_i(t)  — count of respondents in activity i at block t
 * @param numTrials          N       — total survey respondents at block t
 */
function betaPosteriorInterval(
  observedSuccesses: number,
  numTrials: number,
): { mean: number; credibleLow: number; credibleHigh: number } {
  const alpha = PRIOR_ALPHA + observedSuccesses;
  const beta = PRIOR_BETA + (numTrials - observedSuccesses);
  return {
    mean: betaMean(alpha, beta),
    credibleLow: betaInverseCDF(CREDIBLE_LOWER_QUANTILE, alpha, beta),
    credibleHigh: betaInverseCDF(CREDIBLE_UPPER_QUANTILE, alpha, beta),
  };
}

interface ActivityProbabilityChartProps {
  data: SimulationData;
}

export default function ActivityProbabilityChart({
  data,
}: ActivityProbabilityChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [selectedActivityId, setSelectedActivityId] = useState<ActivityId>('sleep');

  const selectedActivityIndex = useMemo(
    () => ACTIVITIES.findIndex((activity) => activity.id === selectedActivityId),
    [selectedActivityId],
  );
  const selectedActivity = ACTIVITIES[selectedActivityIndex];

  // Bayesian credible intervals are a function of (k, N) only, where
  // k = surveyCountsPerBlock[t][i] ∈ [0, N] and N = numSurveyRespondents.
  // There are at most N + 1 distinct (k, N) pairs across the day, so we
  // pre-compute one posterior summary per integer k ∈ [0, N] and look up
  // the result per block — turning ~5,800 (block × quantile) inverse-Beta
  // evaluations into ~84 (= 2 · (N+1)) per selection.
  const probabilityData = useMemo<BlockProbability[]>(() => {
    const numRespondents = data.numSurveyRespondents;
    const counts = data.surveyCountsPerBlock;
    const intervalByCount = new Array<{
      mean: number;
      credibleLow: number;
      credibleHigh: number;
    }>(numRespondents + 1);
    for (let k = 0; k <= numRespondents; k++) {
      intervalByCount[k] = betaPosteriorInterval(k, numRespondents);
    }
    const result = new Array<BlockProbability>(data.numBlocks);
    for (let t = 0; t < data.numBlocks; t++) {
      const count = counts[t][selectedActivityIndex];
      const interval = intervalByCount[count];
      result[t] = {
        minute: (t + 0.5) * data.blockMinutes,
        posteriorMean: interval.mean,
        credibleLow: interval.credibleLow,
        credibleHigh: interval.credibleHigh,
      };
    }
    return result;
  }, [data, selectedActivityIndex]);

  // Marginal P(A = i) ≈ time-averaged posterior mean. Equal to the
  // overall fraction of (student, block) pairs spent in activity i.
  const marginalProbability = useMemo(() => {
    let sum = 0;
    for (const block of probabilityData) sum += block.posteriorMean;
    return sum / probabilityData.length;
  }, [probabilityData]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;
    if (probabilityData.length === 0) return;

    const innerWidth = CHART_WIDTH - CHART_MARGIN.left - CHART_MARGIN.right;
    const innerHeight = CHART_HEIGHT - CHART_MARGIN.top - CHART_MARGIN.bottom;

    const xScale = d3.scaleLinear().domain([0, 1440]).range([0, innerWidth]);

    // Auto-scale y to the max upper-credible-bound across the day, with
    // a 10% headroom so the band has breathing room. Floor at 5% so a
    // strictly-rare activity doesn't render as a comically-tall sliver.
    const yMaxRaw = d3.max(probabilityData, (d) => d.credibleHigh) ?? 0.01;
    const yScale = d3
      .scaleLinear()
      .domain([0, Math.max(0.05, yMaxRaw * 1.1)])
      .nice()
      .range([innerHeight, 0]);

    const svg = d3.select(svgEl);
    svg.selectAll('*').remove();

    const root = svg
      .append('g')
      .attr(
        'transform',
        `translate(${CHART_MARGIN.left}, ${CHART_MARGIN.top})`,
      );

    // ---- Subtle horizontal grid -----------------------------------------
    const yTicks = yScale.ticks(5);
    root
      .append('g')
      .attr('class', 'probability-chart-grid')
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
      .attr('class', 'probability-chart-axis probability-chart-axis--x')
      .attr('transform', `translate(0, ${innerHeight})`);
    xAxis
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('stroke', '#444444');
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
    const yAxis = root
      .append('g')
      .attr('class', 'probability-chart-axis probability-chart-axis--y');
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
        tick
          .append('line')
          .attr('x1', -5)
          .attr('x2', 0)
          .attr('stroke', '#444444');
        tick
          .append('text')
          .attr('x', -10)
          .attr('y', 4)
          .attr('text-anchor', 'end')
          .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
          .attr('font-size', 11)
          .attr('fill', '#444444')
          .text(`${(d * 100).toFixed(0)}%`);
      });
    yAxis
      .append('text')
      .attr(
        'transform',
        `translate(${-CHART_MARGIN.left + 14}, ${innerHeight / 2}) rotate(-90)`,
      )
      .attr('text-anchor', 'middle')
      .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
      .attr('font-size', 12)
      .attr('fill', '#444444')
      .text('P(A = i | T = t)');

    // ---- Marginal reference line (dashed, faint) ------------------------
    if (yScale(marginalProbability) >= 0 && yScale(marginalProbability) <= innerHeight) {
      root
        .append('line')
        .attr('class', 'probability-chart-marginal')
        .attr('x1', 0)
        .attr('x2', innerWidth)
        .attr('y1', yScale(marginalProbability))
        .attr('y2', yScale(marginalProbability))
        .attr('stroke', '#777777')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4 4')
        .attr('stroke-opacity', 0.7);
      root
        .append('text')
        .attr('x', innerWidth - 4)
        .attr('y', yScale(marginalProbability) - 6)
        .attr('text-anchor', 'end')
        .attr('font-family', 'Helvetica Neue, Helvetica, Arial, sans-serif')
        .attr('font-size', 10)
        .attr('fill', '#777777')
        .text(
          `marginal P(A = ${selectedActivity.id}) ≈ ${(marginalProbability * 100).toFixed(1)}%`,
        );
    }

    // ---- Credible-interval band -----------------------------------------
    const areaGenerator = d3
      .area<BlockProbability>()
      .x((d) => xScale(d.minute))
      .y0((d) => yScale(d.credibleLow))
      .y1((d) => yScale(d.credibleHigh))
      .curve(d3.curveMonotoneX);

    root
      .append('path')
      .datum(probabilityData)
      .attr('class', 'probability-chart-band')
      .attr('fill', selectedActivity.color)
      .attr('fill-opacity', 0.18)
      .attr('d', areaGenerator);

    // ---- Posterior-mean line --------------------------------------------
    const lineGenerator = d3
      .line<BlockProbability>()
      .x((d) => xScale(d.minute))
      .y((d) => yScale(d.posteriorMean))
      .curve(d3.curveMonotoneX);

    root
      .append('path')
      .datum(probabilityData)
      .attr('class', 'probability-chart-line')
      .attr('fill', 'none')
      .attr('stroke', selectedActivity.color)
      .attr('stroke-width', 2.4)
      .attr('d', lineGenerator);
  }, [probabilityData, selectedActivity, marginalProbability, data.startMinute]);

  return (
    <div className="probability-chart">
      <div className="probability-chart-controls">
        <label
          className="probability-chart-controls__label"
          htmlFor="activity-probability-select"
        >
          Activity:
        </label>
        <select
          id="activity-probability-select"
          className="probability-chart-controls__select"
          value={selectedActivityId}
          onChange={(event) =>
            setSelectedActivityId(event.target.value as ActivityId)
          }
        >
          {ACTIVITIES.map((activity) => (
            <option key={activity.id} value={activity.id}>
              {activity.label}
            </option>
          ))}
        </select>
        <span
          className="probability-chart-controls__swatch"
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
        aria-label={`Probability that a student is in ${selectedActivity.label} as a function of time of day, with 95% Bayesian credible interval band`}
      />
    </div>
  );
}
