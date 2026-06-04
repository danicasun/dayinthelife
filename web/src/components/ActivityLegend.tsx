/**
 * ActivityLegend — cluster-label overlay for the simulation canvas.
 *
 * Renders one small, absolutely-positioned label per activity (14 total) at a
 * fixed pixel offset from each cluster's centroid. The label shows the
 * activity name on line 1 and the live share of dots in that cluster on
 * line 2 (e.g. "Sleep" / "38%").
 *
 * Layout / coordinate frame:
 *   - Coordinates are in CSS pixels on the 1000x700 simulation canvas
 *     (top-left origin, +x right, +y down), matching `Activity.centroidX/Y`
 *     in `lib/types.ts`.
 *   - The component renders an absolutely-positioned wrapper (`inset: 0`)
 *     sized to (`width`, `height`). It is intended to be mounted as a sibling
 *     of `SimulationCanvas` inside a `position: relative` parent so the two
 *     layers register pixel-for-pixel.
 *   - Each label is centered horizontally on its centroid via
 *     `transform: translateX(-50%)`. Vertically, the label `top` is offset
 *     from `centroidY` so the text sits ABOVE the cluster, EXCEPT for
 *     clusters near the top edge of the canvas, which flip BELOW to avoid
 *     clipping (see `placeLabelBelow`).
 *
 * Visual styling (font, size, weight, color, line-height) is owned by
 * `styles.css` via the `.activity-legend`, `.activity-label`,
 * `.activity-label-name`, and `.activity-label-pct` class hooks, plus
 * the `data-activity-id` attribute for per-activity overrides.
 *
 * Contract: see SPEC.md ("Activity catalog", "Cluster centroids") and
 * `lib/categories.ts` (`ACTIVITIES`, `CANVAS_WIDTH`, `CANVAS_HEIGHT`).
 */

import type { CSSProperties } from 'react';

import { ACTIVITIES, CANVAS_HEIGHT, CANVAS_WIDTH } from '../lib/categories';

/**
 * Vertical pixel offset for labels placed ABOVE the cluster centroid.
 * The label's `top` is rendered at `centroidY - LABEL_OFFSET_ABOVE_PX`.
 * Two lines of small text (~28px tall) fit comfortably between this top and
 * the cluster's dot scatter radius without overlap.
 */
const LABEL_OFFSET_ABOVE_PX = 36;

/**
 * Vertical pixel offset for labels placed BELOW the cluster centroid.
 * Used for clusters near the top edge of the canvas so the label does not
 * clip off-canvas or visually crash into the dots above the centroid.
 */
const LABEL_OFFSET_BELOW_PX = 30;

/**
 * Clusters with `centroidY` at or below this threshold render their label
 * BELOW the centroid instead of above.
 *
 * Empirically this catches:
 *   - `athletics` (centroidY = 80) — would otherwise clip off the top edge.
 *   - `religion`  (centroidY = 100) — label-above would visually overlap
 *                                     with the cluster's own dot scatter.
 *
 * SPEC.md suggests `centroidY < 100` as a starting heuristic and explicitly
 * permits per-activity tuning; using `<= 100` keeps the rule simple while
 * also flipping `religion` (which sits exactly at the boundary).
 */
const TOP_EDGE_THRESHOLD_PX = 100;

/**
 * Decide whether a given cluster's label should be drawn BELOW its centroid
 * (true) instead of the default ABOVE placement (false).
 */
function placeLabelBelow(centroidY: number): boolean {
  return centroidY <= TOP_EDGE_THRESHOLD_PX;
}

/**
 * Format a (count, total) pair as a FlowingData-style percentage string.
 *
 * Rules (from spec):
 *   - `pct === 0`   → "0%"
 *   - `0 < pct < 1` → "<1%"
 *   - `pct >= 1`    → integer percent with trailing "%", e.g. "38%"
 *
 * Defensive: if `total <= 0` (would otherwise NaN), return "0%".
 *
 * @param count  Number of dots currently in this activity (>= 0).
 * @param total  Total number of dots (typically 1000, the cohort size).
 */
function formatPercent(count: number, total: number): string {
  if (total <= 0 || count <= 0) {
    return '0%';
  }
  const pct = (count / total) * 100;
  if (pct < 1) {
    return '<1%';
  }
  return `${Math.round(pct)}%`;
}

export interface ActivityLegendProps {
  /**
   * Number of dots currently in each activity, indexed by catalog order
   * (length 14, matching `ACTIVITIES`). Updated every block by the parent.
   */
  counts: number[];
  /**
   * Total number of dots being counted (typically 1000). Used as the
   * denominator for the displayed percentage.
   */
  total: number;
  /** Overlay width in CSS pixels. Defaults to `CANVAS_WIDTH` (1000). */
  width?: number;
  /** Overlay height in CSS pixels. Defaults to `CANVAS_HEIGHT` (700). */
  height?: number;
}

export function ActivityLegend({
  counts,
  total,
  width = CANVAS_WIDTH,
  height = CANVAS_HEIGHT,
}: ActivityLegendProps): JSX.Element {
  const containerStyle: CSSProperties = {
    position: 'absolute',
    inset: 0,
    width: `${width}px`,
    height: `${height}px`,
    pointerEvents: 'none',
  };

  return (
    <div className="activity-legend" style={containerStyle}>
      {ACTIVITIES.map((activity, index) => {
        const labelBelow = placeLabelBelow(activity.centroidY);
        const labelTopPx = labelBelow
          ? activity.centroidY + LABEL_OFFSET_BELOW_PX
          : activity.centroidY - LABEL_OFFSET_ABOVE_PX;

        const labelStyle: CSSProperties = {
          position: 'absolute',
          left: `${activity.centroidX}px`,
          top: `${labelTopPx}px`,
          transform: 'translateX(-50%)',
        };

        const count = counts[index] ?? 0;

        return (
          <div
            key={activity.id}
            className="activity-label"
            data-activity-id={activity.id}
            style={labelStyle}
          >
            <div className="activity-label-name">{activity.label}</div>
            <div className="activity-label-pct">{formatPercent(count, total)}</div>
          </div>
        );
      })}
    </div>
  );
}

export default ActivityLegend;
