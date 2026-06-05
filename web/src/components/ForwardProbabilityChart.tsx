import { useMemo, useState } from 'react';
import type { ActivityId, SimulationData } from '../lib/types';
import { ACTIVITIES, findActivityIndex } from '../lib/categories';
import type { SimulationStats } from '../lib/simulationStats';

/**
 * ForwardProbabilityChart — given a starting activity and hour of day,
 * shows the probability of transitioning to each other activity next,
 * ranked from most to least likely.
 *
 * Probabilities are averaged across all 12 five-minute blocks within
 * the selected hour for a stable estimate.
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
  // hourIndex 0 = 6 AM (data.startMinute anchor), default 3 = 9 AM
  const [selectedHour, setSelectedHour] = useState<number>(3);

  const selectedActivityIndex = useMemo(
    () => findActivityIndex(selectedActivityId),
    [selectedActivityId],
  );
  const selectedActivity = ACTIVITIES[selectedActivityIndex];
  const hourOptions = useMemo(() => makeHourOptions(data.startMinute), [data.startMinute]);

  // Average transition probabilities across the 12 blocks in the selected hour,
  // then sort descending to produce a ranked list.
  const rankedTransitions = useMemo<RankedActivity[]>(() => {
    const blocksPerHour = Math.round(60 / data.blockMinutes); // 12
    const startBlock = selectedHour * blocksPerHour;
    const numActivities = ACTIVITIES.length;
    const avgProbs = new Array<number>(numActivities).fill(0);

    for (let b = 0; b < blocksPerHour; b++) {
      const t = (startBlock + b) % data.numBlocks;
      const row = stats.transitionProbs[t]?.[selectedActivityIndex];
      if (!row) continue;
      for (let a = 0; a < numActivities; a++) {
        avgProbs[a] += row[a] / blocksPerHour;
      }
    }

    return avgProbs
      .map((prob, activityIndex) => ({ activityIndex, prob }))
      .sort((a, b) => b.prob - a.prob);
  }, [stats, selectedActivityIndex, selectedHour, data.blockMinutes, data.numBlocks]);

  const maxProb = rankedTransitions[0]?.prob ?? 1;

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
          At:
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
        {rankedTransitions.map(({ activityIndex, prob }, rank) => {
          const activity = ACTIVITIES[activityIndex];
          const barPct = maxProb > 0 ? (prob / maxProb) * 100 : 0;
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
