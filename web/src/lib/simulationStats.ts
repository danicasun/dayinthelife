/**
 * simulationStats.ts — summary statistics derived from `SimulationData`.
 *
 * Exports:
 *   - `ActivityRunStats`     — box-plot quantiles + mean for continuous run lengths
 *   - `SimulationStats`      — transition probability tensor + run stats array
 *   - `computeSimulationStats` — O(numStudents × numBlocks) computation
 *   - `forwardProbabilities`   — matrix-vector propagation over the transition tensor
 */

import type { SimulationData } from './types';
import { ACTIVITIES } from './categories';

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/**
 * Box-plot summary for continuous run lengths (in minutes) for one activity.
 * All duration fields are in simulated minutes.
 */
export interface ActivityRunStats {
  /** Catalog index of the activity (0..13). */
  activityIndex: number;
  /** 5th percentile of continuous session length, minutes. */
  p5: number;
  /** 25th percentile of continuous session length, minutes. */
  p25: number;
  /** Median (50th percentile) of continuous session length, minutes. */
  median: number;
  /** 75th percentile of continuous session length, minutes. */
  p75: number;
  /** 95th percentile of continuous session length, minutes. */
  p95: number;
  /** Arithmetic mean of continuous session length, minutes. */
  mean: number;
  /** Total number of continuous runs observed across all students. */
  count: number;
}

/**
 * All precomputed summary statistics for a `SimulationData` object.
 */
export interface SimulationStats {
  /**
   * `transitionProbs[t][from][to]` = empirical P(a_{t+1} = to | a_t = from)
   * at block t, estimated from the simulated trajectories.
   * Shape: [numBlocks][numActivities][numActivities].
   * Block numBlocks-1 counts the cyclic wrap-around transition back to block 0.
   * Each row `transitionProbs[t][from]` sums to 1 (or is all-zeros if no
   * student was in activity `from` at block `t`).
   */
  transitionProbs: number[][][];
  /**
   * Per-activity continuous run-length statistics across all simulated
   * students. Length: numActivities (14).
   */
  runStats: ActivityRunStats[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NUM_ACTIVITIES = ACTIVITIES.length; // 14

/**
 * Compute the `q`-th quantile (0..1) of a *pre-sorted* numeric array.
 * Uses linear interpolation (same as numpy's default method 7).
 */
function quantileSorted(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const index = q * (sorted.length - 1);
  const lo = Math.floor(index);
  const hi = Math.ceil(index);
  if (lo === hi) return sorted[lo];
  const frac = index - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Iterate all simulated trajectories once to compute:
 *   1. Time-varying empirical transition probabilities.
 *   2. Run-length distributions per activity.
 *
 * Complexity: O(numStudents × numBlocks).
 */
export function computeSimulationStats(data: SimulationData): SimulationStats {
  const { students, numBlocks, numStudents, blockMinutes } = data;
  const T = numBlocks;

  // ---- 1. Transition counts -----------------------------------------------
  // counts[t][from][to] — use a flat structure for cache friendliness.
  // Includes the cyclic block (T-1) → block 0 transition so the array has
  // exactly T entries and transitionProbs[t] is valid for all t in [0, T).
  const countFlat = new Float64Array(T * NUM_ACTIVITIES * NUM_ACTIVITIES);

  for (let s = 0; s < numStudents; s++) {
    const traj = students[s];
    for (let t = 0; t < T; t++) {
      const from = traj[t];
      const to = traj[(t + 1) % T]; // cyclic: last block wraps to first
      countFlat[t * NUM_ACTIVITIES * NUM_ACTIVITIES + from * NUM_ACTIVITIES + to] += 1;
    }
  }

  // Normalize rows → probabilities
  const transitionProbs: number[][][] = [];
  for (let t = 0; t < T; t++) {
    const slice: number[][] = [];
    for (let from = 0; from < NUM_ACTIVITIES; from++) {
      const row = new Array<number>(NUM_ACTIVITIES).fill(0);
      let rowSum = 0;
      for (let to = 0; to < NUM_ACTIVITIES; to++) {
        rowSum += countFlat[t * NUM_ACTIVITIES * NUM_ACTIVITIES + from * NUM_ACTIVITIES + to];
      }
      if (rowSum > 0) {
        for (let to = 0; to < NUM_ACTIVITIES; to++) {
          row[to] =
            countFlat[t * NUM_ACTIVITIES * NUM_ACTIVITIES + from * NUM_ACTIVITIES + to] / rowSum;
        }
      }
      slice.push(row);
    }
    transitionProbs.push(slice);
  }

  // ---- 2. Run lengths ------------------------------------------------------
  // runLengths[activityIndex] = array of consecutive-run lengths in minutes.
  //
  // The simulation day is anchored at 06:00, so a sleep session that started
  // at 11 PM and ends at 7 AM is split across the day boundary: blocks ~200-287
  // form the tail of the session and blocks 0-N form the head. We detect this
  // by checking whether the first and last blocks of a trajectory share the
  // same activity, and if so we merge the terminal run with the initial run
  // before recording lengths — giving the true continuous session duration.
  const runLengths: number[][] = Array.from({ length: NUM_ACTIVITIES }, () => []);

  for (let s = 0; s < numStudents; s++) {
    const traj = students[s];

    // Collect all runs as (activity, blockCount) pairs.
    const runs: Array<{ activity: number; blocks: number }> = [];
    let runStart = 0;
    let currentActivity = traj[0];
    for (let t = 1; t < T; t++) {
      if (traj[t] !== currentActivity) {
        runs.push({ activity: currentActivity, blocks: t - runStart });
        runStart = t;
        currentActivity = traj[t];
      }
    }
    runs.push({ activity: currentActivity, blocks: T - runStart });

    // Merge the terminal run into the initial run when they share the same
    // activity — the session straddles the 06:00 day boundary.
    if (runs.length >= 2 && runs[0].activity === runs[runs.length - 1].activity) {
      runs[0] = {
        activity: runs[0].activity,
        blocks: runs[0].blocks + runs[runs.length - 1].blocks,
      };
      runs.pop();
    }

    for (const { activity, blocks } of runs) {
      runLengths[activity].push(blocks * blockMinutes);
    }
  }

  // Sort and compute quantiles
  const runStats: ActivityRunStats[] = runLengths.map((lengths, activityIndex) => {
    lengths.sort((a, b) => a - b);
    const count = lengths.length;
    if (count === 0) {
      return { activityIndex, p5: 0, p25: 0, median: 0, p75: 0, p95: 0, mean: 0, count: 0 };
    }
    let sum = 0;
    for (const v of lengths) sum += v;
    return {
      activityIndex,
      p5: quantileSorted(lengths, 0.05),
      p25: quantileSorted(lengths, 0.25),
      median: quantileSorted(lengths, 0.5),
      p75: quantileSorted(lengths, 0.75),
      p95: quantileSorted(lengths, 0.95),
      mean: sum / count,
      count,
    };
  });

  return { transitionProbs, runStats };
}

// ---------------------------------------------------------------------------
// Next-transition distribution
// ---------------------------------------------------------------------------

/**
 * Compute the probability that the *next activity change* from `startActivity`
 * (beginning at `startBlock`) lands on each other activity.
 *
 * Algorithm: walk forward step-by-step carrying a "survival" probability —
 * the probability of still being in `startActivity`. At each step k, the
 * contribution to destination X is `survival × T[t][from][X]`, then survival
 * is multiplied by the self-transition rate `T[t][from][from]`. This sums
 * the geometric series P(leave to X after exactly k steps) over all k until
 * survival falls below the tolerance.
 *
 * The returned vector sums to ≈ 1 (the tiny remainder is probability of never
 * leaving within MAX_STEPS, negligible for all realistic self-transition rates).
 */
export function nextTransitionDistribution(
  transitionProbs: number[][][],
  startBlock: number,
  startActivity: number,
  numBlocks: number,
  maxSteps: number = 288,
): number[] {
  const exitProbs = new Array<number>(NUM_ACTIVITIES).fill(0);
  let survival = 1.0;

  for (let k = 0; k < maxSteps; k++) {
    if (survival < 1e-5) break;
    const t = (startBlock + k) % numBlocks;
    const row = transitionProbs[t]?.[startActivity];
    if (!row) break;
    for (let to = 0; to < NUM_ACTIVITIES; to++) {
      if (to === startActivity) continue;
      exitProbs[to] += survival * row[to];
    }
    survival *= row[startActivity];
  }

  return exitProbs;
}

// ---------------------------------------------------------------------------
// Forward probability propagation
// ---------------------------------------------------------------------------

/**
 * Compute `prob[k][activity]` = probability of being in `activity` after `k`
 * steps, starting deterministically in `startActivity` at block `startBlock`.
 *
 * @param transitionProbs  Output of `computeSimulationStats`, shape [T-1][A][A].
 * @param startBlock       Block index of the starting state (0-based).
 * @param startActivity    Activity index of the starting state (0..13).
 * @param nSteps           How many 5-minute steps to simulate forward.
 * @param numBlocks        Total blocks per day (used for modular wrap-around).
 * @returns                Array of length `nSteps + 1`; index 0 = starting state.
 */
export function forwardProbabilities(
  transitionProbs: number[][][],
  startBlock: number,
  startActivity: number,
  nSteps: number,
  numBlocks: number,
): number[][] {
  const T = transitionProbs.length; // = numBlocks - 1 typically
  const prob: number[][] = [];

  // k = 0: deterministic starting distribution
  const p0 = new Array<number>(NUM_ACTIVITIES).fill(0);
  p0[startActivity] = 1.0;
  prob.push(p0);

  for (let k = 0; k < nSteps; k++) {
    const t = (startBlock + k) % numBlocks;
    // Use modular index into transitionProbs (which has length T = numBlocks-1)
    const tIdx = t % T;
    const transRow = transitionProbs[tIdx];
    const pPrev = prob[k];
    const pNext = new Array<number>(NUM_ACTIVITIES).fill(0);

    for (let from = 0; from < NUM_ACTIVITIES; from++) {
      const pFrom = pPrev[from];
      if (pFrom === 0) continue;
      const row = transRow[from];
      for (let to = 0; to < NUM_ACTIVITIES; to++) {
        pNext[to] += pFrom * row[to];
      }
    }
    prob.push(pNext);
  }

  return prob;
}
