# A Day in the Life of Stanford Students

A FlowingData-inspired visualization of 1,000 simulated Stanford students moving between activities across a 24-hour day. The simulation is driven by a time-varying Markov chain fitted from a small survey of real Stanford students, using a Dirichlet–Multinomial conjugate prior for smoothing.

## Demo


## Methodology

- Survey of ~45 Stanford students collected May 29 – June 2, 2026 (573 logged activity intervals).
- 14 activity buckets: Sleep, Class, Studying / Schoolwork, Work / Research, Eating, Social Event, Clubs / Professional Events, Exercise, Stanford Athletics / Practice, Transit / Commute, Leisure / Entertainment, Personal Care / Chores, Religion, Other.
- Time-varying Markov chain at 5-minute resolution: 288 timesteps spanning 06:00 → 06:00 the next morning, with cyclic wrap-around.
- Dirichlet–Multinomial smoothing with α = 0.5 on each row of the transition matrix and on the starting distribution (CS109-friendly MAP / posterior-mean framing of "Laplace smoothing").
- 1,000 synthetic students sampled from the chain (seed 109) and animated with a D3 force layout that pulls each dot toward its current activity's centroid.

## Project structure

```
/Users/dsun/dayinthelife/
  Responses-Grid view.csv             # survey data (input)
  SPEC.md                             # shared build contract
  README.md
  WRITEUP.md
  scripts/
    build_simulation.py               # CSV → simulation.json
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

## Running it

### 1. Build the simulation data

Run the Python pipeline (stdlib only — no `pip install` needed):

```bash
python3 scripts/build_simulation.py
```

This produces `web/public/simulation.json`.

### 2. Run the web app

```bash
cd web
npm install
npm run dev
```

Open <http://localhost:5173> in your browser.

### 3. Build for production

```bash
cd web
npm run build
npm run preview
```

## Data attribution

Survey data collected by [name] from Stanford students, May–June 2026.
Inspired by [Nathan Yau's "A Day in the Life of Americans"](https://flowingdata.com/2015/12/15/a-day-in-the-life-of-americans/) (FlowingData, 2015).

## License

[Placeholder]
