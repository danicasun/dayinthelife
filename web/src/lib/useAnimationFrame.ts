import { useEffect, useRef } from 'react';

/** Maximum allowed frame delta in seconds. */
const MAX_DELTA_SECONDS = 0.1;

/**
 * Drive a per-frame callback via `requestAnimationFrame`.
 *
 * On every animation frame (while `isActive` is `true`), invokes `callback`
 * with the seconds elapsed since the previous frame. The delta is clamped to
 * `MAX_DELTA_SECONDS` to keep simulated time from leaping forward after the
 * tab has been backgrounded or the JS thread was blocked.
 *
 * The latest `callback` is held in a ref, so consumers do NOT need to wrap
 * their callback in `useCallback` — the loop always calls the freshest
 * function without restarting itself.
 *
 * The loop is fully torn down (`cancelAnimationFrame`) when `isActive` flips
 * to `false` or the host component unmounts.
 *
 * @param callback Function called once per frame with `deltaSeconds` (>= 0).
 * @param isActive When `false`, no frames are scheduled.
 */
export function useAnimationFrame(
  callback: (deltaSeconds: number) => void,
  isActive: boolean,
): void {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    if (!isActive) return;

    let rafId = 0;
    let lastTimestampMs: number | null = null;

    const tick = (nowMs: number): void => {
      if (lastTimestampMs === null) {
        lastTimestampMs = nowMs;
      }
      const rawDeltaSeconds = (nowMs - lastTimestampMs) / 1000;
      lastTimestampMs = nowMs;

      const deltaSeconds =
        rawDeltaSeconds > MAX_DELTA_SECONDS ? MAX_DELTA_SECONDS : rawDeltaSeconds;

      callbackRef.current(deltaSeconds);
      rafId = requestAnimationFrame(tick);
    };

    rafId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(rafId);
    };
  }, [isActive]);
}
