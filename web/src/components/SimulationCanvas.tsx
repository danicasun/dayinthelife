import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import type { SimulationData } from '../lib/types';
import { ACTIVITIES, CANVAS_WIDTH, CANVAS_HEIGHT } from '../lib/categories';

/**
 * SimulationCanvas — d3-force–driven moving-bubbles animation modelled
 * directly on FlowingData's "A Day in the Life of Americans" (Nathan Yau,
 * 2015) and the Observable canon moving-bubbles recipe.
 *
 * Architecture
 * ------------
 * Each of the 1,000 dots is a `d3.SimulationNodeDatum` with two custom
 * fields — `targetX/targetY` (per-frame attractor) and
 * `staggerOffsetBlocks` (fixed-per-mount). Two forces act on each tick:
 *
 *   1. `dynamicAttractionForce(strength)` — pulls each dot toward its
 *      *current* `targetX/targetY` by adding velocity each tick. Crucial
 *      detail: this is a custom force, NOT `d3.forceX`. Built-in
 *      `d3.forceX` caches the target value at `initialize()` time and
 *      uses the cached array on every subsequent tick — it does NOT
 *      re-evaluate the accessor per tick, so per-frame mutations of
 *      `node.targetX` are silently ignored. The dots would change color
 *      but never migrate. Our custom force re-reads `node.targetX` every
 *      tick, exactly mirroring the `forceCluster` pattern in Yau's
 *      Observable example.
 *
 *      The target is the cluster centroid of the dot's currently-
 *      displayed activity, lerped across block boundaries via a per-dot
 *      personal migration window. Each dot also runs on its own time
 *      clock — `dotMinute = globalMinute - staggerOffsetBlocks ·
 *      blockMinutes` — so dots perceive each Markov block boundary at
 *      different real-time moments. With stagger uniformly drawn from
 *      `[-0.5, +0.5]` block-durations, transitions for any one boundary
 *      are spread across a full block-width of real time. This gives
 *      minute-level visual smoothness *and* dissolves the "wave" of
 *      dots all starting transitions at the same instant, even though
 *      the underlying Markov chain is at 5-min granularity.
 *
 *   2. `rigidCollideForce(radius, fixedAlpha)` — pairwise non-overlap.
 *      Mirrors the Observable canon "moving bubbles" pattern: ignores the
 *      simulation's `alpha` cycle entirely and applies a *fixed* alpha
 *      when separating overlapping pairs. The Observable comment on this
 *      reads "fixed for greater rigidity!" — that's the trick. Built-in
 *      `d3.forceCollide` with `strength(1)` only effectively pushes by
 *      `1 · alpha = 0.18` per pass at our simulation alpha, leaving
 *      visible gaps in dense clusters; the custom version pushes by a
 *      fixed `0.3` per pass regardless of simulation energy → tight
 *      FlowingData-style packing.
 *
 * Driving the simulation
 * ----------------------
 * The native d3-force scheduler is stopped (`.stop()`) and we tick
 * manually from a single `requestAnimationFrame` loop, one physics step
 * per render frame. This pins pacing to the user's actual refresh rate
 * (no d3-force's faster internal interval, which made transitions outrun
 * targets in earlier iterations).
 *
 * Coordinates are in SVG pixel space on the {CANVAS_WIDTH} x
 * {CANVAS_HEIGHT} viewBox.
 */

/** Visible radius of each dot in canvas pixels. */
const DOT_RADIUS = 2;

/**
 * Effective collision radius. Slightly larger than `DOT_RADIUS` so the
 * collision force enforces a tiny gap between neighbors (visually cleaner
 * than dots that just barely touch).
 */
const COLLIDE_RADIUS = DOT_RADIUS + 0.3;

/**
 * Velocity damping per tick: `(1 - velocityDecay)` is the fraction of
 * velocity carried over. d3's default is `0.4`. We keep that — enough
 * damping to settle quickly after collisions without killing migration
 * momentum.
 */
const VELOCITY_DECAY = 0.4;

/**
 * Strength of the dynamic attraction force toward each dot's
 * `targetX/targetY`. Per-tick velocity adjustment is
 * `(target − pos) · ATTRACTION_STRENGTH · alpha`. With
 * `SIMULATION_ALPHA = 0.18`, effective per-tick gain is `0.3 · 0.18 ≈ 0.054`
 * — strong enough to track a moving target across a ~250-px cluster-to-
 * cluster trip within ~14 animation frames (one personal migration window
 * at medium playback speed), while still gentle enough that settled dots
 * don't oscillate visibly.
 */
const ATTRACTION_STRENGTH = 0.3;

/**
 * Constant simulation `alpha`. Held fixed via `.alphaDecay(0)` so the
 * physics engine never relaxes, no matter how long the day plays. Higher
 * than the Observable example's `0.09` because we need enough per-tick
 * energy to actually migrate dots across the canvas during transitions —
 * the example only had to handle slow life-stage shifts, not minute-by-
 * minute activity changes.
 */
const SIMULATION_ALPHA = 0.18;

/**
 * Fixed alpha used inside `rigidCollideForce`. Independent of
 * `SIMULATION_ALPHA`. Higher = more aggressive overlap resolution per
 * tick → tighter packing. `0.3` is the sweet spot:
 * `0.2` (Observable example default) leaves slight gaps with our 1000
 * nodes, `0.5` causes minor jiggle as nodes overshoot.
 */
const RIGID_COLLIDE_ALPHA = 0.3;

/**
 * Number of pre-ticks to run before painting the first frame. Without
 * this, the canvas starts with all 1000 dots stacked near each cluster's
 * personal-block centroid (we initialize at `centroid + small jitter`,
 * where the centroid is read from the dot's *personal* block to absorb
 * the temporal stagger), and you'd watch them visibly explode outward
 * over the first second or two as collision resolves. Pre-ticking lets
 * the simulation settle off-screen so the first painted frame already
 * shows tight clusters.
 */
const SETTLE_PRETICKS = 250;

/**
 * Length of each dot's personal migration window, as a fraction of one
 * Markov block. `0.85` gives slow visible trips. Combined with the
 * full-block-width temporal stagger (see `STAGGER_RANGE_BLOCKS`), the
 * effective spread of transitions for any single Markov block boundary
 * across real time is `(1 + w) · blockMinutes ≈ 9 sim-minutes`.
 */
const MIGRATION_WINDOW_FRAC = 0.85;

/**
 * Half-width of the per-dot temporal stagger in *block-duration units*.
 * Each dot has a fixed `staggerOffsetBlocks ∈ [-STAGGER_RANGE_BLOCKS,
 * +STAGGER_RANGE_BLOCKS]` and operates on a personal clock shifted by
 * `staggerOffsetBlocks · blockMinutes` from global time. With
 * `STAGGER_RANGE_BLOCKS = 0.5`, transitions for any single block boundary
 * spread across a full Markov block of real time — the 5-min "wave" of
 * dots all moving together is replaced by a continuous trickle.
 *
 * Symmetric ([-0.5, +0.5]) so the average dot transitions exactly at the
 * block boundary; some are early, some are late, evenly distributed.
 */
const STAGGER_RANGE_BLOCKS = 0.5;

interface SimulationNode extends d3.SimulationNodeDatum {
  studentIndex: number;
  /** Catalog index whose color the dot is currently *painted*. */
  activityIndex: number;
  /**
   * Per-dot fixed temporal offset in *block-duration units*, drawn once
   * uniformly from `[-STAGGER_RANGE_BLOCKS, +STAGGER_RANGE_BLOCKS]`. The
   * dot's personal time is `globalMinute - staggerOffsetBlocks · blockMinutes`,
   * so dots with negative offsets transition early (before the global
   * boundary) and dots with positive offsets transition late. This shifts
   * each block boundary by ±2.5 sim-min per dot, eliminating the visual
   * "wave" of all dots starting transitions at the same instant.
   */
  staggerOffsetBlocks: number;
  /** Current per-frame attractor position (canvas pixels). */
  targetX: number;
  targetY: number;
}

interface SimulationCanvasProps {
  data: SimulationData;
  /**
   * Fractional simulated minute since the visual day start (06:00).
   * Range `[0, 1440)`. Read every animation frame via a ref to compute
   * each dot's lerped target.
   */
  currentMinute: number;
  width?: number;
  height?: number;
}

/**
 * Custom dynamic attraction force. Pulls each node toward its current
 * `targetX/targetY` by adjusting velocity, exactly like `d3.forceX` /
 * `d3.forceY` do — but reads `targetX` / `targetY` from each node *every
 * tick* instead of caching at `initialize()` time. This is the critical
 * difference: when targets change per-frame (as they do here, lerping
 * across cluster centroids during transitions), `d3.forceX` will silently
 * keep pulling toward the original cached values forever. The custom
 * version respects the live targets so dots actually migrate.
 *
 * Per d3-force convention, mutating `node.vx / node.vy` (rather than
 * positions directly) lets `velocityDecay` damp the resulting motion
 * naturally and lets simultaneous forces compose by superposition.
 */
type DynamicAttractionForce = ((alpha: number) => void) & {
  initialize: (nodes: SimulationNode[]) => void;
};

function dynamicAttractionForce(strength: number): DynamicAttractionForce {
  let nodes: SimulationNode[] = [];
  const force = ((alpha: number) => {
    const factor = strength * alpha;
    for (const node of nodes) {
      const x = node.x ?? 0;
      const y = node.y ?? 0;
      const vx = node.vx ?? 0;
      const vy = node.vy ?? 0;
      node.vx = vx + (node.targetX - x) * factor;
      node.vy = vy + (node.targetY - y) * factor;
    }
  }) as DynamicAttractionForce;
  force.initialize = (newNodes: SimulationNode[]) => {
    nodes = newNodes;
  };
  return force;
}

/**
 * Custom rigid collide force. Resolves pairwise overlaps with a *fixed*
 * alpha factor (independent of the simulation's overall alpha cycle). A
 * direct adaptation of the Observable canon "moving bubbles" pattern:
 *
 *   for each pair (a, b) with center-distance l < 2·radius:
 *     a moves outward by  (l − 2·radius) / l · fixedAlpha · (a − b) / 2
 *     b moves the opposite direction by the same amount.
 *
 * Uses a quadtree for O(N log N) neighbor lookup. Mutates `node.x` and
 * `node.y` directly — d3-force expects forces to write velocities, but
 * for collision the canonical approach is to nudge positions and let
 * `velocityDecay` clean up any spurious velocity inferred from the
 * position change in the next tick.
 */
type RigidCollideForce = ((alpha: number) => void) & {
  initialize: (nodes: SimulationNode[]) => void;
};

function rigidCollideForce(
  collideRadius: number,
  fixedAlpha: number,
): RigidCollideForce {
  let nodes: SimulationNode[] = [];
  const minDistance = 2 * collideRadius;
  const minDistanceSquared = minDistance * minDistance;

  const force = ((_alpha: number) => {
    if (nodes.length === 0) return;

    const tree = d3.quadtree<SimulationNode>(
      nodes,
      (d) => d.x ?? 0,
      (d) => d.y ?? 0,
    );

    for (const d of nodes) {
      const dx0 = d.x ?? 0;
      const dy0 = d.y ?? 0;
      const nx1 = dx0 - minDistance;
      const ny1 = dy0 - minDistance;
      const nx2 = dx0 + minDistance;
      const ny2 = dy0 + minDistance;

      tree.visit((quadNode, x1, y1, x2, y2) => {
        // Internal nodes have a `length` of 4 (the four child quadrants);
        // leaf nodes are linked-list singletons with `data` and `next`.
        const isLeaf = !('length' in quadNode) || !quadNode.length;
        if (isLeaf) {
          let leaf = quadNode as d3.QuadtreeLeaf<SimulationNode> | undefined;
          while (leaf !== undefined) {
            const other = leaf.data;
            if (other !== d) {
              const ox = other.x ?? 0;
              const oy = other.y ?? 0;
              let dx = dx0 - ox;
              let dy = dy0 - oy;
              const distanceSquared = dx * dx + dy * dy;
              if (
                distanceSquared > 0 &&
                distanceSquared < minDistanceSquared
              ) {
                const distance = Math.sqrt(distanceSquared);
                const factor =
                  ((distance - minDistance) / distance) * fixedAlpha;
                dx *= factor;
                dy *= factor;
                d.x = dx0 - dx;
                d.y = dy0 - dy;
                other.x = ox + dx;
                other.y = oy + dy;
              }
            }
            leaf = leaf.next as d3.QuadtreeLeaf<SimulationNode> | undefined;
          }
        }
        // Skip subtrees that can't contain a node within `minDistance` of d.
        return x1 > nx2 || x2 < nx1 || y1 > ny2 || y2 < ny1;
      });
    }
  }) as RigidCollideForce;

  force.initialize = (newNodes: SimulationNode[]) => {
    nodes = newNodes;
  };

  return force;
}

/** Linear interpolation between `a` and `b` at parameter `t ∈ [0, 1]`. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export default function SimulationCanvas({
  data,
  currentMinute,
  width = CANVAS_WIDTH,
  height = CANVAS_HEIGHT,
}: SimulationCanvasProps) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Latest fractional simulated minute, mirrored into a ref so the rAF
  // tick can read it without forcing a React re-render-per-frame.
  const minuteRef = useRef<number>(currentMinute);

  useEffect(() => {
    minuteRef.current = currentMinute;
  }, [currentMinute]);

  useEffect(() => {
    const svgEl = svgRef.current;
    if (!svgEl) return;

    const numStudents = data.numStudents;
    const blockMinutes = data.blockMinutes;
    const numBlocks = data.numBlocks;
    const minutesPerDay = numBlocks * blockMinutes;

    const initialMinute = minuteRef.current;

    /** Resolves a global minute through the per-dot temporal stagger,
     *  with day-wrap, returning the block index *that dot* perceives. */
    const dotPersonalBlock = (
      globalMinute: number,
      staggerOffsetBlocks: number,
    ): number => {
      const dotMinute =
        (((globalMinute - staggerOffsetBlocks * blockMinutes) % minutesPerDay) +
          minutesPerDay) %
        minutesPerDay;
      return Math.floor(dotMinute / blockMinutes);
    };

    // ---- Build nodes ------------------------------------------------------
    // Initial position is the dot's *personal* current-block centroid plus a
    // small jitter so pre-ticking has something for collision to spread out.
    // Drawing the stagger here (rather than at first frame) means each dot
    // owns its temporal offset for the lifetime of the mount.
    const nodes: SimulationNode[] = new Array(numStudents);
    for (let studentIndex = 0; studentIndex < numStudents; studentIndex++) {
      const staggerOffsetBlocks =
        (Math.random() - 0.5) * 2 * STAGGER_RANGE_BLOCKS;
      const personalBlock = dotPersonalBlock(initialMinute, staggerOffsetBlocks);
      const activityIndex = data.students[studentIndex][personalBlock];
      if (activityIndex < 0 || activityIndex >= ACTIVITIES.length) continue;
      const activity = ACTIVITIES[activityIndex];
      const initialJitterX = (Math.random() - 0.5) * 60;
      const initialJitterY = (Math.random() - 0.5) * 60;
      nodes[studentIndex] = {
        studentIndex,
        activityIndex,
        staggerOffsetBlocks,
        targetX: activity.centroidX,
        targetY: activity.centroidY,
        x: activity.centroidX + initialJitterX,
        y: activity.centroidY + initialJitterY,
        vx: 0,
        vy: 0,
      };
    }

    // ---- d3-force simulation ---------------------------------------------
    // Custom forces only:
    //   - `attraction` reads node.targetX/Y per tick (no caching, unlike
    //     stock d3.forceX/forceY which freeze targets at initialize time).
    //   - `collide` uses fixed-alpha rigid pairwise separation.
    const simulation = d3
      .forceSimulation<SimulationNode>(nodes)
      .alpha(SIMULATION_ALPHA)
      .alphaDecay(0)
      .alphaTarget(SIMULATION_ALPHA)
      .velocityDecay(VELOCITY_DECAY)
      .force('attraction', dynamicAttractionForce(ATTRACTION_STRENGTH))
      .force('collide', rigidCollideForce(COLLIDE_RADIUS, RIGID_COLLIDE_ALPHA))
      .stop();

    // Pre-tick to settle initial positions before the first frame paints.
    for (let i = 0; i < SETTLE_PRETICKS; i++) {
      simulation.tick();
    }

    // ---- D3 render setup -------------------------------------------------
    const svg = d3.select(svgEl);
    svg.selectAll('*').remove(); // guard against double-mounts (StrictMode, HMR)
    const dotsGroup = svg.append('g').attr('class', 'dots');
    const circleSelection = dotsGroup
      .selectAll<SVGCircleElement, SimulationNode>('circle')
      .data(nodes, (d) => d.studentIndex)
      .join('circle')
      .attr('r', DOT_RADIUS)
      .attr('cx', (d) => d.x ?? 0)
      .attr('cy', (d) => d.y ?? 0)
      .attr('fill', (d) => ACTIVITIES[d.activityIndex].color);

    // ---- Animation loop --------------------------------------------------
    // Each dot runs on its own personal clock, shifted from global time
    // by `staggerOffsetBlocks · blockMinutes`. As a result, different dots
    // perceive the *same* Markov block boundary at different real-time
    // moments — spreading transitions for any single boundary across a
    // full block-width of real time. The migration window is then a
    // simple fraction of *that dot's* personal block: transition during
    // the first `MIGRATION_WINDOW_FRAC` of the personal block, idle in
    // the centroid for the remainder.
    const window0 = MIGRATION_WINDOW_FRAC;
    let rafHandle = 0;
    const animate = () => {
      const minute = minuteRef.current;

      for (let studentIndex = 0; studentIndex < nodes.length; studentIndex++) {
        const node = nodes[studentIndex];

        const dotMinute =
          (((minute - node.staggerOffsetBlocks * blockMinutes) %
            minutesPerDay) +
            minutesPerDay) %
          minutesPerDay;
        const dotBlockRaw = Math.floor(dotMinute / blockMinutes);
        const currentBlock =
          ((dotBlockRaw % numBlocks) + numBlocks) % numBlocks;
        const prevBlock = (currentBlock - 1 + numBlocks) % numBlocks;
        const frac = (dotMinute - dotBlockRaw * blockMinutes) / blockMinutes;

        const currIdx = data.students[studentIndex][currentBlock];
        const prevIdx = data.students[studentIndex][prevBlock];
        if (currIdx < 0 || currIdx >= ACTIVITIES.length) continue;
        if (prevIdx < 0 || prevIdx >= ACTIVITIES.length) continue;
        const currA = ACTIVITIES[currIdx];
        const prevA = ACTIVITIES[prevIdx];

        // Migration window: transition during first `window0` of the
        // dot's personal block, then sit at curr centroid for the
        // remainder. Stagger comes entirely from the temporal offset, so
        // there's no within-block sub-stagger here.
        let personalFrac: number;
        if (frac <= 0) personalFrac = 0;
        else if (frac >= window0) personalFrac = 1;
        else personalFrac = frac / window0;

        // Per-dot color flip at the geometric midpoint of the personal trip.
        node.activityIndex = personalFrac < 0.5 ? prevIdx : currIdx;

        // Continuous target lerp from prev cluster centroid to current.
        node.targetX = lerp(prevA.centroidX, currA.centroidX, personalFrac);
        node.targetY = lerp(prevA.centroidY, currA.centroidY, personalFrac);
      }

      simulation.tick();

      circleSelection
        .attr('cx', (d) => d.x ?? 0)
        .attr('cy', (d) => d.y ?? 0)
        .attr('fill', (d) => ACTIVITIES[d.activityIndex].color);

      rafHandle = requestAnimationFrame(animate);
    };
    rafHandle = requestAnimationFrame(animate);

    return () => {
      if (rafHandle) cancelAnimationFrame(rafHandle);
      simulation.stop();
      svg.selectAll('*').remove();
    };
  }, [data]);

  return (
    <svg
      ref={svgRef}
      width={width}
      height={height}
      viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`}
      preserveAspectRatio="xMidYMid meet"
      style={{ display: 'block', maxWidth: '100%', height: 'auto' }}
      role="img"
      aria-label="Animated cluster of 1000 dots representing Stanford students moving between activities throughout the day"
    />
  );
}
