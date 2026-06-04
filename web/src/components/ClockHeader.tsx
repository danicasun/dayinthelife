/**
 * ClockHeader — the big FlowingData-style "7:18am" header.
 *
 * Renders the current simulated time of day given a fractional
 * `currentMinute` in `[0, 1440)` (see SPEC.md, "Animation semantics").
 *
 * Visual style (font, size, weight, color, alignment) is owned by
 * `styles.css` via the `.clock-header` class. This component intentionally
 * stays presentation-light so Agent 9's stylesheet can fully control look.
 */

export interface ClockHeaderProps {
  /** Fractional simulated minute since visual day start, in `[0, 1440)`. */
  currentMinute: number;
  /**
   * Minute-of-day at which `currentMinute === 0` corresponds.
   * Defaults to 360 (06:00), matching `SimulationData.startMinute`.
   */
  startMinute?: number;
}

/**
 * Normalize an arbitrary real number into `[0, 1440)` minutes-of-day.
 * Defensive against negative inputs and values >= 1440.
 */
function wrapMinuteOfDay(minute: number): number {
  const floored = Math.floor(minute);
  return ((floored % 1440) + 1440) % 1440;
}

/**
 * Format a 0..1439 minute-of-day as a FlowingData-style 12-hour string.
 *
 * Style rules (match the original viz exactly):
 *  - 12-hour clock with no leading zero on the hour
 *  - 2-digit minute, zero-padded
 *  - lowercase `am` / `pm`, with NO space between the minute and the suffix
 *  - midnight (0) → "12:00am", noon (720) → "12:00pm"
 *
 * Examples: 0 → "12:00am", 378 → "6:18am", 720 → "12:00pm", 780 → "1:00pm".
 *
 * @param minuteOfDay  Integer or fractional minute of day; floored and wrapped
 *                     into `[0, 1440)` before formatting.
 */
export function formatHHmm12(minuteOfDay: number): string {
  const minute = wrapMinuteOfDay(minuteOfDay);
  const hour24 = Math.floor(minute / 60);
  const minuteOfHour = minute % 60;
  const suffix = hour24 < 12 ? 'am' : 'pm';
  const hour12 = ((hour24 + 11) % 12) + 1;
  const mm = minuteOfHour.toString().padStart(2, '0');
  return `${hour12}:${mm}${suffix}`;
}

export function ClockHeader({
  currentMinute,
  startMinute = 360,
}: ClockHeaderProps): JSX.Element {
  const displayMinute = wrapMinuteOfDay(Math.floor(currentMinute) + startMinute);
  return <div className="clock-header">{formatHHmm12(displayMinute)}</div>;
}

export default ClockHeader;
