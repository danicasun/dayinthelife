import { useMemo, useState } from 'react';
import type { ActivityId, SimulationData } from '../lib/types';
import { ACTIVITIES, findActivityIndex } from '../lib/categories';
import type { SimulationStats } from '../lib/simulationStats';
import { nextTransitionDistribution } from '../lib/simulationStats';

/**
 * ForwardProbabilityChart — given a starting activity and time of day,
 * shows the probability distribution over the *next activity change*:
 * "when this student eventually leaves, where do they go?"
 *
 * Uses nextTransitionDistribution: walks forward summing
 * P(stay for k steps, then leave to X) over all k until survival ≈ 0,
 * yielding a proper probability distribution over destinations that sums to ~1.
 */

interface Props {
  data: SimulationData;
  stats: SimulationStats;
}

interface RankedActivity {
  activityIndex: number;
  prob: number;
}

function makeHourOptions(startMinute: number): { label: string; hourIndex: number }[] {
  return Array.from({ length: 24 }, (_, i) => {
    const minuteOfDay = (startMinute + i * 60) % 1440;
    const hour24 = Math.floor(minuteOfDay / 60);
    const hour12 = ((hour24 + 11) % 12) + 1;
    const ampm = hour24 < 12 ? 'AM' : 'PM';
    return { label: `${hour12}:00 ${ampm}`, hourIndex: i };
  });
}

export default function ForwardProbabilityChart({ data, stats }: Props) {
  const [selectedActivityId, setSelectedActivityId] = useState<ActivityId>('eat');
  const [selectedHour, setSelectedHour] = useState<number>(3); // default 9 AM

  const selectedActivityIndex = useMemo(
    () => findActivityIndex(selectedActivityId),
    [selectedActivityId],
  );
  const selectedActivity = ACTIVITIES[selectedActivityIndex];
  const hourOptions = useMemo(() => makeHourOptions(data.startMinute), [data.startMinute]);

  const exitRanked = useMemo<RankedActivity[]>(() => {
    const startBlock = selectedHour * Math.round(60 / data.blockMinutes);
    const exitProbs = nextTransitionDistribution(
      stats.transitionProbs,
      startBlock,
      selectedActivityIndex,
      data.numBlocks,
    );
    return exitProbs
      .map((prob, activityIndex) => ({ activityIndex, prob }))
      .filter(({ activityIndex }) => activityIndex !== selectedActivityIndex)
      .sort((a, b) => b.prob - a.prob);
  }, [stats, selectedActivityIndex, selectedHour, data.blockMinutes, data.numBlocks]);

  const maxProb = exitRanked[0]?.prob ?? 1;

  return (
    <div className="forward-prob-chart">
      <div className="chart-controls">
        <label className="chart-controls__label" htmlFor="next-activity-select">
          Currently doing:
        </label>
        <select
          id="next-activity-select"
          className="chart-controls__select"
          value={selectedActivityId}
          onChange={(e) => setSelectedActivityId(e.target.value as ActivityId)}
        >
          {ACTIVITIES.map((a) => (
            <option key={a.id} value={a.id}>
              {a.label}
            </option>
          ))}
        </select>
        <span
          className="chart-controls__swatch"
          aria-hidden="true"
          style={{ backgroundColor: selectedActivity.color }}
        />
        <label className="chart-controls__label" htmlFor="next-hour-select">
          at:
        </label>
        <select
          id="next-hour-select"
          className="chart-controls__select chart-controls__select--narrow"
          value={selectedHour}
          onChange={(e) => setSelectedHour(Number(e.target.value))}
        >
          {hourOptions.map(({ label, hourIndex }) => (
            <option key={hourIndex} value={hourIndex}>
              {label}
            </option>
          ))}
        </select>
      </div>

      <div className="next-activity-ranking">
        {exitRanked.map(({ activityIndex, prob }, rank) => {
          const activity = ACTIVITIES[activityIndex];
          const barPct = (prob / maxProb) * 100;
          return (
            <div key={activityIndex} className="next-activity-row">
              <span className="next-activity-rank">{rank + 1}</span>
              <span
                className="next-activity-swatch"
                aria-hidden="true"
                style={{ backgroundColor: activity.color }}
              />
              <span className="next-activity-label">{activity.label}</span>
              <div className="next-activity-bar-track">
                <div
                  className="next-activity-bar-fill"
                  style={{ width: `${barPct}%`, backgroundColor: activity.color }}
                />
              </div>
              <span className="next-activity-pct">{(prob * 100).toFixed(1)}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
