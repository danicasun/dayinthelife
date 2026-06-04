import type { FC } from 'react';

interface DescriptionProps {
  currentMinute: number;
  startMinute?: number;
}

interface NarrativeBand {
  startMinuteOfDay: number;
  narrative: string;
}

const MINUTES_PER_DAY = 1440;
const DEFAULT_START_MINUTE_OF_DAY = 360;

const NARRATIVE_BANDS: readonly NarrativeBand[] = [
  {
    startMinuteOfDay: 0,
    narrative:
      'Late night. The procrastination peak and pset grind time.',
  },
  {
    startMinuteOfDay: 180,
    narrative:
      'Deep night. The campus quiets. Most students are asleep, a few stragglers finish problem sets or pull all-nighters. Shoutout EF and AS for being the outlier data points.',
  },
  {
    startMinuteOfDay: 360,
    narrative:
      'Early morning. Most students are still asleep. A few early risers head to morning workouts, breakfast, or a sunrise lap around the Dish.',
  },
  {
    startMinuteOfDay: 480,
    narrative:
      'The day is starting. Showers, breakfast, and the first bike to class.',
  },
  {
    startMinuteOfDay: 600,
    narrative:
      'Mid-morning. The class category peaks. Coupa Cafe and Green library start filling up.',
  },
  {
    startMinuteOfDay: 720,
    narrative:
      'Lunch time! Students stream from class to dining halls, then back toward office hours and afternoon classes.',
  },
  {
    startMinuteOfDay: 810,
    narrative:
      'Afternoon classes and study sessions overlap. Athletes head to practice. Green library is at its busiest.',
  },
  {
    startMinuteOfDay: 1020,
    narrative:
      'Dinner time. Students eat with friends, head to club meetings, and start their evening study sessions.',
  },
  {
    startMinuteOfDay: 1170,
    narrative:
      'Evening. Long study sessions in Green Library and dorm lounges/computer rooms. It is spring quarter, so we are seeing clubs and social events here and there.',
  },
  {
    startMinuteOfDay: 1350,
    narrative:
      'Late evening. Studying winds down for some, and just begins for others.',
  },
];

function pickNarrative(absoluteMinuteOfDay: number): string {
  let selected: NarrativeBand = NARRATIVE_BANDS[0];
  for (const band of NARRATIVE_BANDS) {
    if (band.startMinuteOfDay <= absoluteMinuteOfDay) {
      selected = band;
    } else {
      break;
    }
  }
  return selected.narrative;
}

export const Description: FC<DescriptionProps> = ({
  currentMinute,
  startMinute = DEFAULT_START_MINUTE_OF_DAY,
}) => {
  const absoluteMinuteOfDay =
    ((Math.floor(currentMinute) + startMinute) % MINUTES_PER_DAY + MINUTES_PER_DAY) %
    MINUTES_PER_DAY;
  const currentNarrative = pickNarrative(absoluteMinuteOfDay);

  return (
    <div className="description">
      <p>{currentNarrative}</p>
    </div>
  );
};

export default Description;
