# A Day in the Life of Stanford Students — Build Spec (v1)

Shared contract for parallel agents building the v1 visualization. Read this file in full before writing any code. Project root: `/Users/dsun/dayinthelife`.

## Project description

A FlowingData-style web visualization of 1,000 simulated Stanford students moving between activity clusters across a 24-hour day, driven by a time-varying Markov chain fitted from a survey of ~45 real Stanford students.

Inspiration: <https://flowingdata.com/2015/12/15/a-day-in-the-life-of-americans/>

## Architecture

```
CSV  →  Python pipeline  →  simulation.json  →  React + D3 SPA
```

Two halves: an offline Python preprocessing pipeline and a static React + D3 frontend.

## Repo layout

```
/Users/dsun/dayinthelife/
  Responses-Grid view.csv             # existing — survey data
  SPEC.md                             # this file
  README.md
  scripts/
    build_simulation.py
    requirements.txt
  web/
    package.json
    vite.config.ts
    tsconfig.json
    tsconfig.node.json
    index.html
    public/
      simulation.json                 # produced by build_simulation.py
    src/
      main.tsx
      App.tsx
      styles.css
      components/
        SimulationCanvas.tsx
        ClockHeader.tsx
        SpeedControls.tsx
        ActivityLegend.tsx
        Description.tsx
      lib/
        types.ts
        categories.ts
        useAnimationFrame.ts
```

## Activity catalog (14 buckets)

EXACT order, EXACT ids — assign indices 0..13 in this order:

| index | id        | label                          |
|-------|-----------|--------------------------------|
| 0     | sleep     | Sleep                          |
| 1     | class     | Class                          |
| 2     | study     | Studying / Schoolwork          |
| 3     | work      | Work / Research                |
| 4     | eat       | Eating                         |
| 5     | social    | Social Event                   |
| 6     | clubs     | Clubs / Professional Events    |
| 7     | exercise  | Exercise                       |
| 8     | athletics | Stanford Athletics / Practice  |
| 9     | transit   | Transit / Commute              |
| 10    | leisure   | Leisure / Entertainment        |
| 11    | personal  | Personal Care / Chores         |
| 12    | religion  | Religion                       |
| 13    | other     | Other                          |

### Data cleaning rules

- Map `Personal / Chores` → `Personal Care / Chores`.
- Any unrecognized activity string → `Other`.
- Group survey rows by `submitted_at` (one respondent per unique value).
- Day timeline anchors on 06:00 → 06:00 next morning (288 5-min blocks). Block `i` corresponds to minute-of-day `(360 + i*5) % 1440`.
- Forward-fill any gaps within a respondent's day with the previous block's activity. If the very first blocks are empty, back-fill with the first known activity.
- Drop any respondent whose coverage is < 50% of blocks after forward/back fill.
- For interval splits across midnight: split (start, end) into two halves.

## Color palette

| id        | hex       |
|-----------|-----------|
| sleep     | #F4C430   |
| class     | #845EC2   |
| study     | #4D8AF0   |
| work      | #2A9D8F   |
| eat       | #F4A261   |
| social    | #E83E8C   |
| clubs     | #06A77D   |
| exercise  | #FF6B6B   |
| athletics | #8C1515   |
| transit   | #6C757D   |
| leisure   | #A663CC   |
| personal  | #00B4D8   |
| religion  | #14746F   |
| other     | #ADB5BD   |

## Cluster centroids on a 1000×700 canvas

The 13 non-transit activities are arranged on an ellipse centered at `(500, 350)`
with `radiusX = 380, radiusY = 240`, with `transit` placed at the center as a
"hub" through which dots transition between activities (mirroring FlowingData's
"Traveling" cluster). Activities are spaced evenly clockwise (Δθ = 360°/13 ≈
27.7°), with `sleep` placed at the 3-o'clock anchor so the dominant overnight
cluster gets the most horizontal canvas room. Adjacency reflects natural
transition pairs (sleep↔personal↔eat, work↔study↔class, clubs↔social,
exercise↔athletics).

| id        | x   | y   | clock pos |
|-----------|-----|-----|-----------|
| leisure   | 500 | 110 | 12        |
| religion  | 676 | 137 | 1         |
| other     | 813 | 214 | 2         |
| sleep     | 877 | 321 | 3         |
| personal  | 855 | 435 | 4         |
| eat       | 752 | 530 | 5         |
| work      | 591 | 583 | 6         |
| study     | 409 | 583 | 6         |
| class     | 248 | 530 | 7         |
| clubs     | 145 | 435 | 8         |
| social    | 123 | 321 | 9         |
| exercise  | 187 | 214 | 10        |
| athletics | 324 | 137 | 11        |
| transit   | 500 | 350 | center    |

## TypeScript types (lib/types.ts)

```ts
export type ActivityId =
  | 'sleep' | 'class' | 'study' | 'work' | 'eat'
  | 'social' | 'clubs' | 'exercise' | 'athletics'
  | 'transit' | 'leisure' | 'personal' | 'religion' | 'other';

export interface Activity {
  id: ActivityId;
  label: string;
  color: string;
  centroidX: number;
  centroidY: number;
}

export interface SimulationData {
  blockMinutes: number;       // 5
  startMinute: number;        // 360 (=06:00)
  numBlocks: number;          // 288
  numStudents: number;        // 1000
  activities: { id: ActivityId; label: string; color: string }[];
  students: number[][];       // [numStudents][numBlocks], values 0..13
}

export type Speed = 'paused' | 'slow' | 'medium' | 'fast';

export const SPEED_RATES: Record<Speed, number> = {
  paused: 0,
  slow:   4,    // sim minutes per real second  → ~6 min real time per simulated day
  medium: 18,   // → ~80 sec real time per simulated day
  fast:   48,   // → ~30 sec real time per simulated day (matches FlowingData "fast")
};
```

## simulation.json schema

```json
{
  "blockMinutes": 5,
  "startMinute": 360,
  "numBlocks": 288,
  "numStudents": 1000,
  "activities": [
    {"id": "sleep", "label": "Sleep", "color": "#F4C430"},
    "...14 entries in catalog order"
  ],
  "students": [
    [0, 0, 0, 2, 2, "..."],
    "...1000 entries, each length 288"
  ]
}
```

## Animation semantics

- App holds a fractional `currentMinute` in `[0, 1440)`.
- Clock display = `formatHHmm((floor(currentMinute) + 360) % 1440)`. Day starts visually at 06:00.
- `currentBlock = floor(currentMinute / 5)` — index into `students[i]`.
- Dot `i`'s current activity index = `students[i][currentBlock]`.
- A `requestAnimationFrame` ticker advances `currentMinute` by `SPEED_RATES[speed] * dt` per frame (`dt` is seconds since last frame).
- When `currentMinute >= 1440`, wrap to `0`.

## Survey CSV details (existing input)

`/Users/dsun/dayinthelife/Responses-Grid view.csv` — columns:

```
Name, submitted_at, year, major, date_logged, athlete, start_time, end_time, activity, note
```

- 45 unique respondents (group by `submitted_at`).
- 573 total activity rows.
- `start_time` / `end_time` are `HH:MM` (24h).
- Activity strings are one of the 14 catalog labels OR `Personal / Chores` (which maps to `Personal Care / Chores`).
- Dates: 2026-05-29 through 2026-06-02.

## Markov chain methodology

- For each timestep `t` in `[0, 288)` (5-min blocks): build a 14×14 transition matrix `T[t]` from observed `(activity_t → activity_{t+1})` pairs across all respondents.
- Smooth each row via an **empirical-Bayes Dirichlet prior**:

      prior   = Dirichlet(α_total · π_marginal)
      posterior  = Dirichlet(α_total · π_marginal  +  counts[t][i][·])
      T[t][i][j] = (count + α_total · π_marginal[j]) / (sum_k count + α_total)

  with `α_total = 0.1` and `π_marginal` = the global activity frequency across all `(respondent, block)` pairs. The CS109 framing is the conjugate Dirichlet–Multinomial posterior mean of each row. The empirical-Bayes choice (prior shape ∝ marginal) means an unobserved transition row falls back to "what activity is the population usually doing", not "all 14 activities are equally likely".
- A flat Laplace prior (`α = 0.5`, uniform) was tried first but injected ~13.5% per-block leak from sleep during deep night, collapsing simulated 5:30am sleep from the empirical ~95% to ~32%. The empirical-Bayes prior fixes this.
- Starting distribution `π_0` = posterior mean of the block-0 activity distribution under the same prior.
- Wrap-around: `T[287]` counts transitions from block 287 to block 0, completing the cyclic day.

## Simulation

- `N = 1000` synthetic students.
- `random.seed(109)` for reproducibility.
- For each student: sample `a_0 ~ Categorical(pi_0)`. For `t in [0, 287)`: sample `a_{t+1} ~ Categorical(T[t][a_t])`.

## Library policy

Per CS109 challenge rules ("we are not going to give credit for using advanced python libraries"), the Python pipeline uses **stdlib only** (`csv`, `json`, `random`, `collections`, `datetime`). NO pandas. NO numpy.

## Speed semantics

`SPEED_RATES` are simulated minutes per real second. The clock display always advances at 1-minute resolution regardless. Block lookup uses `floor(currentMinute / 5)`.
