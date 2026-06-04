import type { Activity, ActivityId } from './types';

/**
 * Width of the simulation canvas in CSS pixels.
 * Cluster centroids in `ACTIVITIES` are expressed in this coordinate frame
 * (top-left origin, +x right, +y down, pixels).
 */
export const CANVAS_WIDTH = 1000;

/** Height of the simulation canvas in CSS pixels. */
export const CANVAS_HEIGHT = 700;

/**
 * The 14 activity buckets, in canonical catalog index order (0..13).
 * Order, ids, labels, and colors match SPEC.md.
 *
 * Cluster centroids are arranged on an ellipse centered at (500, 350) with
 * `radiusX = 380, radiusY = 240`, with `transit` placed at the center to act
 * as a "hub" through which dots pass between activities. The 13 non-transit
 * activities are spaced evenly clockwise (Δθ = 360°/13 ≈ 27.7°) starting from
 * `leisure` at 12 o'clock; `sleep` lands at the 3-o'clock anchor (the
 * dominant overnight cluster gets the most horizontal canvas room).
 *
 * Adjacency reflects natural transition pairs: sleep↔personal↔eat,
 * work↔study↔class, clubs↔social, exercise↔athletics.
 */
export const ACTIVITIES: readonly Activity[] = [
  { id: 'sleep',     label: 'Sleep',                          color: '#F4C430', centroidX: 877, centroidY: 321 },
  { id: 'class',     label: 'Class',                          color: '#845EC2', centroidX: 248, centroidY: 530 },
  { id: 'study',     label: 'Studying / Schoolwork',          color: '#4D8AF0', centroidX: 409, centroidY: 583 },
  { id: 'work',      label: 'Work / Research',                color: '#2A9D8F', centroidX: 591, centroidY: 583 },
  { id: 'eat',       label: 'Eating',                         color: '#F4A261', centroidX: 752, centroidY: 530 },
  { id: 'social',    label: 'Social Event',                   color: '#E83E8C', centroidX: 123, centroidY: 321 },
  { id: 'clubs',     label: 'Clubs / Professional Events',    color: '#06A77D', centroidX: 145, centroidY: 435 },
  { id: 'exercise',  label: 'Exercise',                       color: '#FF6B6B', centroidX: 187, centroidY: 214 },
  { id: 'athletics', label: 'Stanford Athletics / Practice',  color: '#8C1515', centroidX: 324, centroidY: 137 },
  { id: 'transit',   label: 'Transit / Commute',              color: '#6C757D', centroidX: 500, centroidY: 350 },
  { id: 'leisure',   label: 'Leisure / Entertainment',        color: '#A663CC', centroidX: 500, centroidY: 110 },
  { id: 'personal',  label: 'Personal Care / Chores',         color: '#00B4D8', centroidX: 855, centroidY: 435 },
  { id: 'religion',  label: 'Religion',                       color: '#14746F', centroidX: 676, centroidY: 137 },
  { id: 'other',     label: 'Other',                          color: '#ADB5BD', centroidX: 813, centroidY: 214 },
] as const;

/**
 * Look up an activity by its catalog index (0..13).
 * Throws if `index` is out of range so that miswired data fails loudly rather
 * than silently rendering an undefined dot.
 */
export function getActivity(index: number): Activity {
  const activity = ACTIVITIES[index];
  if (activity === undefined) {
    throw new RangeError(
      `getActivity: index ${index} out of range (expected 0..${ACTIVITIES.length - 1})`,
    );
  }
  return activity;
}

/**
 * Find the canonical catalog index for a given `ActivityId`.
 * Returns `-1` if the id is not present (should be impossible given the union
 * type, but we keep the sentinel return so callers can defensively check).
 */
export function findActivityIndex(id: ActivityId): number {
  return ACTIVITIES.findIndex((activity) => activity.id === id);
}
