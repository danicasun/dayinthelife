/**
 * Shared TypeScript contracts for the "Day in the Life of Stanford Students"
 * visualization. These types are consumed by every component and by the data
 * loader; keep them in sync with SPEC.md ("TypeScript types" section).
 */

/**
 * The 14 catalog activity ids, in the exact order specified by SPEC.md.
 * The string literal order here is purely documentation; canonical index order
 * lives in `lib/categories.ts` (`ACTIVITIES`).
 */
export type ActivityId =
  | 'sleep'
  | 'class'
  | 'study'
  | 'work'
  | 'eat'
  | 'social'
  | 'clubs'
  | 'exercise'
  | 'athletics'
  | 'transit'
  | 'leisure'
  | 'personal'
  | 'religion'
  | 'other';

/**
 * Static metadata for a single activity bucket.
 * `centroidX` / `centroidY` are pixel coordinates on the 1000x700 simulation
 * canvas (top-left origin, +x right, +y down).
 */
export interface Activity {
  id: ActivityId;
  label: string;
  /** CSS hex color, e.g. `#F4C430`. */
  color: string;
  /** Cluster centroid X in canvas pixels (0..1000). */
  centroidX: number;
  /** Cluster centroid Y in canvas pixels (0..700). */
  centroidY: number;
}

/**
 * Shape of `public/simulation.json` produced by `scripts/build_simulation.py`.
 *
 * Time discretization:
 *   - `blockMinutes` = 5
 *   - `startMinute`  = 360 (06:00 local time; day anchors on 06:00 → 06:00 next day)
 *   - `numBlocks`    = 288 (= 24h * 60min / 5min per block)
 *
 * `students[i][t]` is an integer in `0..13` indexing into `activities`.
 */
export interface SimulationData {
  /** Width of one timestep in simulated minutes. SPEC: 5. */
  blockMinutes: number;
  /** Minute-of-day at which block 0 begins. SPEC: 360 (06:00). */
  startMinute: number;
  /** Number of 5-minute blocks per simulated day. SPEC: 288. */
  numBlocks: number;
  /** Number of simulated students (dots). SPEC: 1000. */
  numStudents: number;
  /**
   * Number of *real* survey respondents whose forward-filled per-block
   * activity grids feed `surveyCountsPerBlock`. This is the sample size
   * `N` for the Bayesian credible intervals in the activity-probability
   * chart (NOT `numStudents`, which is the synthetic count). Includes
   * every respondent with at least one raw observation — i.e. the entire
   * surveyed pool — since marginal-share inference is much less
   * sensitive to fill quality than the Markov-chain transition inference
   * is. See `numChainRespondents` below for the stricter subset.
   */
  numSurveyRespondents: number;
  /**
   * Number of respondents whose raw block coverage exceeded 50% and who
   * were used to fit the time-varying Markov chain (transitions, π₀).
   * Lower than `numSurveyRespondents` because low-coverage respondents
   * forward-fill into long unrealistic self-transitions; we drop them
   * from the chain pool to keep transition counts honest, but keep them
   * in the survey pool for marginal-share inference where the bias is
   * much smaller (per-block, not per-transition).
   */
  numChainRespondents: number;
  /** Activity catalog in canonical index order (length 14). */
  activities: { id: ActivityId; label: string; color: string }[];
  /** Per-student activity index time series. Shape: [numStudents][numBlocks]. */
  students: number[][];
  /**
   * Per-block activity counts across all forward-filled survey
   * respondents (the survey pool of size `numSurveyRespondents`). Shape
   * `[numBlocks][numActivities]` (i.e. `[288][14]`). For each block `t`,
   * `surveyCountsPerBlock[t][i]` is the number of survey respondents
   * whose forward-filled activity at block `t` was activity `i`. By
   * construction, for every `t`,
   * `Σ_i surveyCountsPerBlock[t][i] === numSurveyRespondents`.
   */
  surveyCountsPerBlock: number[][];
}

/** Playback speed selector for the SpeedControls UI. */
export type Speed = 'paused' | 'slow' | 'medium' | 'fast';

/**
 * Playback rate in **simulated minutes per real second**.
 *   - slow   = 4   → ~6 min real time per simulated day (one 5-min block per 1.25s)
 *   - medium = 18  → ~80 sec real time per simulated day
 *   - fast   = 48  → ~30 sec real time per simulated day (matches FlowingData's "fast")
 *
 * Visual smoothness at minute-level resolution comes from each dot's
 * `staggerOffsetBlocks` (see `SimulationCanvas.tsx`): individual dots run on
 * personal time clocks shifted from global by ±half-a-block, so their
 * perceived block boundaries are scattered uniformly across a full
 * block-width of real time. The aggregate visual flow is continuous and
 * the 5-min "wave" disappears, even though the underlying Markov chain
 * is at 5-min granularity.
 */
export const SPEED_RATES: Record<Speed, number> = {
  paused: 0,
  slow: 4,
  medium: 18,
  fast: 48,
};
