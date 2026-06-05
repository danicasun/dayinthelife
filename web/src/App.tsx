/**
 * App — top-level orchestration for the "Day in the Life of Stanford Students"
 * visualization.
 *
 * Responsibilities:
 *   1. Load `public/simulation.json` once on mount.
 *   2. Hold the three pieces of mutable state shared across UI components:
 *        - `data: SimulationData | null`         (loaded JSON)
 *        - `currentMinute: number` in `[0, 1440)` (fractional simulated time)
 *        - `speed: Speed`                         (playback speed selector)
 *   3. Drive `currentMinute` forward each animation frame via
 *      `useAnimationFrame` at `SPEED_RATES[speed]` simulated minutes per real
 *      second (units: sim-min / real-sec).
 *   4. Derive — once per 5-min block change, NOT once per frame —
 *        - `currentBlock`: index into `students[i][...]` (range `[0, 288)`)
 *        - `counts[14]`:   how many students are in each activity right now
 *      Both are wrapped in `useMemo` so that downstream `React.memo` checks on
 *      `SimulationCanvas` / `ActivityLegend` short-circuit when only
 *      `currentMinute` (a sub-block float) changed.
 *
 * Coordinate / time frames:
 *   - `currentMinute` units = simulated minutes since visual day start (06:00).
 *   - `dt` from `useAnimationFrame` units = real seconds since last frame.
 *   - All canvas coordinates are in CSS pixels on the 1000x700 stage.
 */

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { SimulationData, Speed } from './lib/types';
import { SPEED_RATES } from './lib/types';
import { ACTIVITIES, CANVAS_WIDTH, CANVAS_HEIGHT } from './lib/categories';
import { useAnimationFrame } from './lib/useAnimationFrame';
import { computeSimulationStats } from './lib/simulationStats';
import SimulationCanvas from './components/SimulationCanvas';
import ClockHeader from './components/ClockHeader';
import SpeedControls from './components/SpeedControls';
import ActivityLegend from './components/ActivityLegend';
import Description from './components/Description';
import EntropyChart from './components/EntropyChart';
import ActivityProbabilityChart from './components/ActivityProbabilityChart';
import TransitionChart from './components/TransitionChart';
import DurationStatsChart from './components/DurationStatsChart';
import ForwardProbabilityChart from './components/ForwardProbabilityChart';

/**
 * Public path of the precomputed simulation (served by Vite from `web/public/`).
 *
 * Prefixed with `import.meta.env.BASE_URL` so the URL respects whatever
 * `base` is configured in `vite.config.ts`. In dev that's `/`, so the URL
 * resolves to `/simulation.json`; in production (deployed under
 * `/dayatstanford/`) it resolves to `/dayatstanford/simulation.json`.
 * Hardcoding `/simulation.json` would 404 in production.
 */
const SIMULATION_JSON_URL = `${import.meta.env.BASE_URL}simulation.json`;

/** Minutes in a 24-hour day; `currentMinute` wraps modulo this value. */
const MINUTES_PER_DAY = 1440;

/**
 * `React.memo` wrapper around the legend so it only re-renders when `counts`
 * (per-block aggregate) changes, not on every sub-block animation frame.
 *
 * `SimulationCanvas` intentionally re-renders every frame because it consumes
 * `currentMinute` for continuous between-block target interpolation; the
 * actual DOM mutations happen inside d3-force's tick handler, so per-frame
 * React work is just a ref write.
 */
const MemoActivityLegend = memo(ActivityLegend);

export default function App(): JSX.Element {
  const [data, setData] = useState<SimulationData | null>(null);
  const [currentMinute, setCurrentMinute] = useState<number>(0);
  const [speed, setSpeed] = useState<Speed>('medium');

  // Mirror `speed` in a ref so the rAF callback always reads the freshest
  // rate without forcing `useAnimationFrame` to tear down and restart the
  // loop on every speed change. (The hook already keeps `callback` fresh via
  // its own ref; this `speedRef` is belt-and-suspenders for clarity.)
  const speedRef = useRef<Speed>(speed);
  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  useEffect(() => {
    let cancelled = false;
    fetch(SIMULATION_JSON_URL)
      .then((response) => {
        if (!response.ok) {
          throw new Error(
            `Failed to load ${SIMULATION_JSON_URL}: HTTP ${response.status}`,
          );
        }
        return response.json() as Promise<SimulationData>;
      })
      .then((json) => {
        if (!cancelled) setData(json);
      })
      .catch((error: unknown) => {
        console.error('Failed to load simulation.json', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useAnimationFrame(
    (deltaSeconds) => {
      const rateSimMinPerRealSec = SPEED_RATES[speedRef.current];
      if (rateSimMinPerRealSec === 0) return;
      setCurrentMinute(
        (previousMinute) =>
          (previousMinute + rateSimMinPerRealSec * deltaSeconds) % MINUTES_PER_DAY,
      );
    },
    data !== null && speed !== 'paused',
  );

  // Pre-data fallbacks keep the `useMemo` dep arrays referentially stable when
  // `data === null` so React doesn't whine about changing hook deps post-load.
  const blockMinutes = data?.blockMinutes ?? 5;
  const numBlocks = data?.numBlocks ?? 288;

  // Integer block index for the current simulated minute. Computed every
  // render (cheap), then collapsed to a stable per-half-block value via
  // `displayBlock` below so downstream `React.memo` checks short-circuit.
  const blockIndex = Math.floor(currentMinute / blockMinutes);
  const fracIntoBlock = (currentMinute - blockIndex * blockMinutes) / blockMinutes;

  // `displayBlock` matches the canvas's color logic: during the first half
  // of each Markov block (frac < 0.5) the dots are still painted in the
  // previous block's colors, so the legend should display the previous
  // block's percentages too. The flip happens at the geometric midpoint.
  const displayBlockIndex = fracIntoBlock < 0.5 ? blockIndex - 1 : blockIndex;
  const displayBlock = useMemo<number>(
    () => ((displayBlockIndex % numBlocks) + numBlocks) % numBlocks,
    [displayBlockIndex, numBlocks],
  );

  // Precompute simulation statistics (transition probs + run-length box plots).
  // O(numStudents × numBlocks) work, done once after data loads.
  const stats = useMemo(
    () => (data ? computeSimulationStats(data) : null),
    [data],
  );

  // Tally students per activity at the displayed block (= what the canvas is
  // currently painting). O(numStudents); memoized on [data, displayBlock] so
  // it only re-runs once per *half-block* boundary, never per frame.
  const counts = useMemo<number[]>(() => {
    const tally = new Array<number>(ACTIVITIES.length).fill(0);
    if (data === null) return tally;
    const studentsAtBlock = data.students;
    const total = data.numStudents;
    for (let studentIndex = 0; studentIndex < total; studentIndex++) {
      const activityIndex = studentsAtBlock[studentIndex][displayBlock];
      tally[activityIndex] += 1;
    }
    return tally;
  }, [data, displayBlock]);

  if (data === null) {
    return (
      <div className="app-shell app-shell--loading">
        <div className="loading">Loading&hellip;</div>
      </div>
    );
  }

  return (
    <div className="page-layout">
      <div className="app-shell">
        <aside className="left-panel">
          <ClockHeader currentMinute={currentMinute} startMinute={data.startMinute} />
          <SpeedControls speed={speed} onChange={setSpeed} />
          <Description currentMinute={currentMinute} startMinute={data.startMinute} />
          <footer className="attribution">
            <p>
              Simulation of {data.numStudents.toLocaleString()} Stanford students,
              based on a survey of {data.numSurveyRespondents} students collected
              May&ndash;June 2026 at Stanford.
            </p>
          </footer>
        </aside>
        <main
          className="canvas-stage"
          style={{
            position: 'relative',
            width: CANVAS_WIDTH,
            height: CANVAS_HEIGHT,
          }}
        >
          <SimulationCanvas data={data} currentMinute={currentMinute} />
          <MemoActivityLegend counts={counts} total={data.numStudents} />
        </main>
      </div>

      <section
        className="analytics-section"
        aria-labelledby="entropy-section-heading"
      >
        <header className="analytics-section__header">
          <h2 id="entropy-section-heading" className="analytics-section__heading">
            How predictable is the day?
          </h2>
          <p className="analytics-section__copy">
            For each time block <em>t</em>, we measure how mixed or
            predictable students&rsquo; activities are using conditional
            entropy:{' '}
            <span className="analytics-section__formula">
              H(A &nbsp;&#124;&nbsp; T = t) = &minus;&Sigma;<sub>i</sub> p
              <sub>i</sub>(t) log<sub>2</sub> p<sub>i</sub>(t)
            </span>
            .
          </p>
          <p className="analytics-section__copy">
            This tells us how much variety there is in what students are
            doing at a certain time. A low value means student behavior is
            very predictable. For example, at 3 a.m., most students are
            probably sleeping, so the activity distribution is almost
            entirely concentrated in one category. A high entropy value
            means students are spread across many different activities,
            like studying, relaxing, socializing, eating, or sleeping. The
            highest possible value with 14 activity categories is log
            <sub>2</sub>(14) &asymp; 3.81 bits.
          </p>
        </header>
        <EntropyChart data={data} />
      </section>

      <section
        className="analytics-section"
        aria-labelledby="probability-section-heading"
      >
        <header className="analytics-section__header">
          <h2
            id="probability-section-heading"
            className="analytics-section__heading"
          >
            When is a student doing X?
          </h2>
          <p className="analytics-section__copy">
            For the selected activity <em>i</em>, the line shows the
            estimated probability that a student is doing that activity
            at each time of day. The shaded band shows a 95% Bayesian
            credible interval using a uniform Beta(1, 1) prior. After
            observing <em>k</em><sub>i</sub>(t) students doing the
            activity out of {data.numSurveyRespondents}, the posterior
            becomes{' '}
            <span className="analytics-section__formula">
              Beta(k<sub>i</sub>(t) + 1, &nbsp;{data.numSurveyRespondents}{' '}
              &minus; k<sub>i</sub>(t) + 1)
            </span>
            . This adds slight smoothing while keeping the estimate
            mostly driven by the observed data.
          </p>
        </header>
        <ActivityProbabilityChart data={data} />
      </section>

      {stats && (
        <section className="analytics-section" aria-labelledby="transition-section-heading">
          <header className="analytics-section__header">
            <h2 id="transition-section-heading" className="analytics-section__heading">
              What do students do next?
            </h2>
            <p className="analytics-section__copy">
              For each 5-minute block, the probability of transitioning <em>out of</em> the selected activity into each other activity. High values mean students frequently leave at that time; the colored lines show where they go.
            </p>
          </header>
          <TransitionChart data={data} stats={stats} />
        </section>
      )}

      {stats && (
        <section className="analytics-section" aria-labelledby="forward-section-heading">
          <header className="analytics-section__header">
            <h2 id="forward-section-heading" className="analytics-section__heading">
              What&rsquo;s next?
            </h2>
            <p className="analytics-section__copy">
              Select an activity and hour of day to see where students are most likely to transition to next &mdash; not just the following 5 minutes, but the next time their activity actually changes. Ranked by probability of that destination being the first new activity they move into.
            </p>
          </header>
          <ForwardProbabilityChart data={data} stats={stats} />
        </section>
      )}

      {stats && (
        <section className="analytics-section" aria-labelledby="duration-section-heading">
          <header className="analytics-section__header">
            <h2 id="duration-section-heading" className="analytics-section__heading">
              How long do students stay in each activity?
            </h2>
            <p className="analytics-section__copy">
              Distribution of continuous session lengths for each activity across all simulated students. The box spans the middle 50% (IQR), the line spans the 5th&ndash;95th percentile, and the dot marks the mean.
            </p>
          </header>
          <DurationStatsChart data={data} stats={stats} />
        </section>
      )}
    </div>
  );
}
