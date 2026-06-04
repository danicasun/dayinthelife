/**
 * SpeedControls — playback speed selector for the simulation timeline.
 *
 * Renders four mutually-exclusive buttons (SLOW, MEDIUM, FAST, PAUSE) in a
 * horizontal row. The button matching the current `speed` is marked active
 * via the `speed-btn--active` class and `aria-pressed="true"`. All visual
 * styling lives in `styles.css` (owned by Agent 9); this component only
 * emits structure and class names.
 *
 * Contract: see SPEC.md ("Speed semantics") and `lib/types.ts` (`Speed`).
 */

import type { Speed } from '../lib/types';

export interface SpeedControlsProps {
  /** Currently selected playback speed. */
  speed: Speed;
  /** Invoked with the new speed when the user clicks a button. */
  onChange: (speed: Speed) => void;
}

/**
 * Visible button order, per spec: SLOW, MEDIUM, FAST, PAUSE.
 * `value` is the `Speed` literal dispatched to `onChange`; `label` is the
 * uppercase text rendered inside the button.
 */
const SPEED_BUTTONS: ReadonlyArray<{ value: Speed; label: string }> = [
  { value: 'slow', label: 'SLOW' },
  { value: 'medium', label: 'MEDIUM' },
  { value: 'fast', label: 'FAST' },
  { value: 'paused', label: 'PAUSE' },
];

export function SpeedControls({ speed, onChange }: SpeedControlsProps): JSX.Element {
  return (
    <div className="speed-controls">
      {SPEED_BUTTONS.map(({ value, label }) => {
        const isActive = speed === value;
        const className = isActive ? 'speed-btn speed-btn--active' : 'speed-btn';
        return (
          <button
            key={value}
            type="button"
            className={className}
            aria-pressed={isActive}
            onClick={() => onChange(value)}
          >
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default SpeedControls;
