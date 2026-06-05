"""Build the Markov-chain simulation that drives the "Day in the Life of
Stanford Students" visualization.

Pipeline (see SPEC.md for the shared contract):

    1. Read the survey CSV (one row per (respondent, activity-interval)).
    2. Group rows by `submitted_at` (one respondent per unique timestamp).
    3. Expand each respondent's intervals onto a 06:00-anchored timeline
       of 288 five-minute blocks. Intervals that cross 06:00 are split.
    4. Forward-fill gaps within a respondent's day; back-fill any leading
       empties with the first known activity. Drop respondents whose raw
       (pre-fill) block coverage is below 50%.
    5. Build 288 time-varying 14x14 transition matrices T[t]. T[287]
       counts the cyclic transition from block 287 back to block 0.
       Each row is smoothed via an EMPIRICAL-BAYES Dirichlet prior:
       Dirichlet(alpha_total * pi_marginal), where pi_marginal is the
       global activity frequency across all (respondent, block) pairs and
       alpha_total is a small total prior strength (default 0.1, i.e.
       ~0.1 fake observations split across the 14 categories in
       proportion to their global frequency). This is the conjugate
       Dirichlet-Multinomial posterior-mean estimate of each row of T[t]
       — the CS109-friendly framing of "smarter than Laplace" smoothing,
       where the prior anchors unobserved transitions toward globally-
       common activities (sleep, study, ...) rather than spreading mass
       uniformly across all 14 buckets. Uniform Laplace with alpha=0.5
       was tried first but injected ~13.5% per-block leak from sleep
       during deep night, causing the simulated overnight sleep
       distribution to collapse from ~80% at 06:00 to ~32% at 05:30.
    6. Build pi_0 from empirical block-0 activity counts, smoothed and
       normalized.
    7. Simulate N = 1000 synthetic students with random.seed(109):
       a_0 ~ Categorical(pi_0), then a_{t+1} ~ Categorical(T[t][a_t])
       for t in [0, 287).
    8. Write simulation.json into web/public/ per the SPEC schema.

Library policy: standard library only (csv, json, random, collections,
datetime, pathlib, sys, typing). No pandas, no numpy.
"""

from __future__ import annotations

import csv
import json
import random
import sys
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Tuple


# ---------------------------------------------------------------------------
# Constants from SPEC.md
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path("/Users/dsun/dayinthelife")
CSV_PATH = PROJECT_ROOT / "Responses-Grid view.csv"
OUTPUT_PATH = PROJECT_ROOT / "web" / "public" / "simulation.json"

BLOCK_MINUTES: int = 5
START_MINUTE_OF_DAY: int = 360           # 06:00, anchor of the visual day
MINUTES_PER_DAY: int = 1440
NUM_BLOCKS: int = MINUTES_PER_DAY // BLOCK_MINUTES   # 288

NUM_STUDENTS: int = 1000
RANDOM_SEED: int = 109
EMP_BAYES_ALPHA_TOTAL: float = 0.1       # total Dirichlet prior strength per row;
                                          # split across the 14 activities in
                                          # proportion to the global marginal
                                          # distribution (empirical Bayes).
COVERAGE_THRESHOLD: float = 0.50         # drop respondents below this

# Activity catalog — EXACT order from SPEC.md (indices 0..13).
ACTIVITY_CATALOG: List[Dict[str, str]] = [
    {"id": "sleep",     "label": "Sleep",                         "color": "#F4C430"},
    {"id": "class",     "label": "Class",                         "color": "#845EC2"},
    {"id": "study",     "label": "Studying / Schoolwork",         "color": "#4D8AF0"},
    {"id": "work",      "label": "Work / Research",               "color": "#2A9D8F"},
    {"id": "eat",       "label": "Eating",                        "color": "#F4A261"},
    {"id": "social",    "label": "Social Event",                  "color": "#E83E8C"},
    {"id": "clubs",     "label": "Clubs / Professional Events",   "color": "#06A77D"},
    {"id": "exercise",  "label": "Exercise",                      "color": "#FF6B6B"},
    {"id": "athletics", "label": "Stanford Athletics / Practice", "color": "#8C1515"},
    {"id": "transit",   "label": "Transit / Commute",             "color": "#6C757D"},
    {"id": "leisure",   "label": "Leisure / Entertainment",       "color": "#A663CC"},
    {"id": "personal",  "label": "Personal Care / Chores",        "color": "#00B4D8"},
    {"id": "religion",  "label": "Religion",                      "color": "#14746F"},
    {"id": "other",     "label": "Other",                         "color": "#ADB5BD"},
]
NUM_ACTIVITIES: int = len(ACTIVITY_CATALOG)
ACTIVITY_INDEX_BY_LABEL: Dict[str, int] = {
    entry["label"]: idx for idx, entry in enumerate(ACTIVITY_CATALOG)
}
OTHER_INDEX: int = ACTIVITY_INDEX_BY_LABEL["Other"]

# Survey-string normalization. "Personal / Chores" is a known alias for the
# catalog's "Personal Care / Chores"; everything else funnels to "Other".
ACTIVITY_LABEL_ALIASES: Dict[str, str] = {
    "Personal / Chores": "Personal Care / Chores",
}


# ---------------------------------------------------------------------------
# Time helpers (all times are in minutes-of-day, 0..1439, or minutes-since
# 06:00 in the anchored frame, 0..1439).
# ---------------------------------------------------------------------------

def parse_hhmm_to_minute_of_day(hhmm: str) -> int:
    """Parse a "HH:MM" string (24-hour clock) into minute-of-day [0, 1440)."""
    hours_str, minutes_str = hhmm.strip().split(":")
    hours = int(hours_str)
    minutes = int(minutes_str)
    return hours * 60 + minutes


def to_anchored_minute(minute_of_day: int) -> int:
    """Shift a minute-of-day into the 06:00-anchored frame.

    In the anchored frame, t=0 corresponds to 06:00 and t=1439 corresponds
    to 05:59 the next morning. The only wrap seam is 06:00.
    """
    return (minute_of_day - START_MINUTE_OF_DAY) % MINUTES_PER_DAY


def split_anchored_interval(
    anchored_start: int, anchored_end_raw: int
) -> List[Tuple[int, int]]:
    """Split an interval into one or two segments in the anchored frame.

    Inputs are minutes-since-06:00 in [0, 1440). If the raw shifted end is
    0, we treat it as 1440 (the interval ends exactly at the next 06:00,
    no wrap). If the shifted end <= shifted start (and shifted end > 0),
    the interval crosses 06:00 and we split into two halves.

    Returns segments as half-open [a, b) ranges of minutes-since-06:00.
    """
    if anchored_start == anchored_end_raw:
        return []  # zero-length, skip

    anchored_end = MINUTES_PER_DAY if anchored_end_raw == 0 else anchored_end_raw

    if anchored_end > anchored_start:
        return [(anchored_start, anchored_end)]
    # Wraps the 06:00 boundary.
    return [(anchored_start, MINUTES_PER_DAY), (0, anchored_end_raw)]


def normalize_activity_label(raw_label: str) -> str:
    """Apply alias mapping; fall back to 'Other' for unknown labels."""
    label = raw_label.strip()
    label = ACTIVITY_LABEL_ALIASES.get(label, label)
    if label not in ACTIVITY_INDEX_BY_LABEL:
        return "Other"
    return label


# ---------------------------------------------------------------------------
# CSV ingest
# ---------------------------------------------------------------------------

def load_respondent_rows(csv_path: Path) -> Dict[str, List[dict]]:
    """Group CSV rows by `submitted_at` (one respondent per group).

    Preserves row order within each respondent (so later rows overwrite
    earlier ones on the rare overlap).
    """
    grouped: Dict[str, List[dict]] = defaultdict(list)
    with csv_path.open(newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        for row in reader:
            submitted_at = row.get("submitted_at", "").strip()
            if not submitted_at:
                continue
            grouped[submitted_at].append(row)
    return grouped


# ---------------------------------------------------------------------------
# Per-respondent block grid
# ---------------------------------------------------------------------------

def build_respondent_blocks(rows: List[dict]) -> Tuple[List[Optional[int]], float]:
    """Return (blocks, raw_coverage) for one respondent.

    `blocks` is a list of length NUM_BLOCKS. Each entry is an activity
    index (0..13) or None if no survey row covered that block (pre-fill).
    `raw_coverage` is the fraction of blocks filled from the raw survey
    (i.e., before any forward/back-fill is applied).
    """
    blocks: List[Optional[int]] = [None] * NUM_BLOCKS

    for row in rows:
        raw_start = row.get("start_time", "").strip()
        raw_end = row.get("end_time", "").strip()
        raw_activity = row.get("activity", "")
        if not raw_start or not raw_end or not raw_activity:
            continue

        try:
            start_mod = parse_hhmm_to_minute_of_day(raw_start)
            end_mod = parse_hhmm_to_minute_of_day(raw_end)
        except ValueError:
            continue

        activity_label = normalize_activity_label(raw_activity)
        activity_index = ACTIVITY_INDEX_BY_LABEL[activity_label]

        anchored_start = to_anchored_minute(start_mod)
        anchored_end_raw = to_anchored_minute(end_mod)
        segments = split_anchored_interval(anchored_start, anchored_end_raw)

        for seg_start, seg_end in segments:
            # Block i has start-minute i*BLOCK_MINUTES in the anchored frame.
            first_block = seg_start // BLOCK_MINUTES
            # Block i is included iff i*BLOCK_MINUTES < seg_end.
            # The smallest excluded block index is ceil(seg_end / BLOCK_MINUTES).
            last_block_excl = (seg_end + BLOCK_MINUTES - 1) // BLOCK_MINUTES
            for block_idx in range(first_block, min(last_block_excl, NUM_BLOCKS)):
                # Include a block when its 5-minute span has any overlap
                # with this segment. The block spans [b*5, b*5 + 5).
                block_start = block_idx * BLOCK_MINUTES
                if block_start < seg_end and block_start + BLOCK_MINUTES > seg_start:
                    blocks[block_idx] = activity_index

    filled_count = sum(1 for entry in blocks if entry is not None)
    raw_coverage = filled_count / NUM_BLOCKS
    return blocks, raw_coverage


def forward_then_back_fill(blocks: List[Optional[int]]) -> List[int]:
    """Forward-fill empty blocks with the previous block; then back-fill
    any leading empties with the first known activity. Assumes the input
    has at least one filled block.
    """
    filled: List[Optional[int]] = list(blocks)

    first_known_index: Optional[int] = None
    for i in range(NUM_BLOCKS):
        if filled[i] is not None:
            first_known_index = i
            break
    if first_known_index is None:
        raise ValueError("Cannot fill an empty block grid.")

    # Back-fill the leading empties with the first known activity.
    first_activity = filled[first_known_index]
    for i in range(first_known_index):
        filled[i] = first_activity

    # Forward-fill any remaining gaps.
    for i in range(first_known_index + 1, NUM_BLOCKS):
        if filled[i] is None:
            filled[i] = filled[i - 1]

    # mypy: at this point every slot is filled with an int.
    return [int(entry) for entry in filled]  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Markov chain estimation
# ---------------------------------------------------------------------------

def compute_marginal_distribution(
    respondent_grids: List[List[int]],
) -> List[float]:
    """Global activity frequency across all (respondent, block) pairs.

    Returns a length-14 probability vector that sums to 1. Used as the
    base measure of the empirical-Bayes Dirichlet prior: a transition row
    that sees zero observations falls back to "what activity is the
    population usually doing", not "all 14 activities are equally likely".
    """
    counts = [0.0] * NUM_ACTIVITIES
    for grid in respondent_grids:
        for activity_index in grid:
            counts[activity_index] += 1.0
    total = sum(counts)
    if total <= 0.0:
        # Defensive: should never happen if there's at least one kept grid.
        return [1.0 / NUM_ACTIVITIES] * NUM_ACTIVITIES
    return [c / total for c in counts]


def build_transition_matrices(
    respondent_grids: List[List[int]],
    pi_marginal: List[float],
) -> List[List[List[float]]]:
    """Estimate T[t] for t in [0, NUM_BLOCKS).

    T[t][i][j] is the posterior mean of P(activity_{t+1}=j | activity_t=i)
    under an EMPIRICAL-BAYES Dirichlet prior on each row of T[t]:

        prior   = Dirichlet(alpha_total * pi_marginal)
        likelihood (row i at t) = Multinomial(counts[t][i][:])
        posterior = Dirichlet(alpha_total * pi_marginal + counts[t][i][:])

    The posterior mean is the conjugate Dirichlet-Multinomial estimate:

        T[t][i][j] = (counts[t][i][j] + alpha_total * pi_marginal[j])
                    / (sum_k counts[t][i][k] + alpha_total)

    With alpha_total small (we use 0.1) and ~41 observations per row, the
    likelihood dominates whenever the data exists, but unobserved
    transitions get a non-zero probability proportional to how common the
    target activity is globally. The cyclic matrix T[NUM_BLOCKS-1] counts
    transitions from block 287 back to block 0 (useful for downstream
    cyclic analyses; the forward simulation stops at block 287).
    """
    counts: List[List[List[float]]] = [
        [[0.0] * NUM_ACTIVITIES for _ in range(NUM_ACTIVITIES)]
        for _ in range(NUM_BLOCKS)
    ]

    for grid in respondent_grids:
        for t in range(NUM_BLOCKS):
            next_t = (t + 1) % NUM_BLOCKS   # cyclic for t = NUM_BLOCKS - 1
            current_activity = grid[t]
            next_activity = grid[next_t]
            counts[t][current_activity][next_activity] += 1.0

    # Per-category prior pseudo-counts (sums to alpha_total).
    prior_pseudocounts = [EMP_BAYES_ALPHA_TOTAL * p for p in pi_marginal]

    transitions: List[List[List[float]]] = [
        [[0.0] * NUM_ACTIVITIES for _ in range(NUM_ACTIVITIES)]
        for _ in range(NUM_BLOCKS)
    ]
    for t in range(NUM_BLOCKS):
        for i in range(NUM_ACTIVITIES):
            row_sum = 0.0
            for j in range(NUM_ACTIVITIES):
                smoothed = counts[t][i][j] + prior_pseudocounts[j]
                transitions[t][i][j] = smoothed
                row_sum += smoothed
            for j in range(NUM_ACTIVITIES):
                transitions[t][i][j] /= row_sum

    return transitions


def build_initial_distribution(
    respondent_grids: List[List[int]],
    pi_marginal: List[float],
) -> List[float]:
    """Posterior mean of the block-0 distribution under the same
    empirical-Bayes Dirichlet prior used for the transition rows.
    """
    counts = [0.0] * NUM_ACTIVITIES
    for grid in respondent_grids:
        counts[grid[0]] += 1.0
    smoothed = [c + EMP_BAYES_ALPHA_TOTAL * pi_marginal[idx]
                for idx, c in enumerate(counts)]
    total = sum(smoothed)
    return [c / total for c in smoothed]


# ---------------------------------------------------------------------------
# Simulation constraints
# ---------------------------------------------------------------------------

# Activity catalog indices (must match ACTIVITY_CATALOG order above).
CLASS_INDEX:     int = 1
EXERCISE_INDEX:  int = 7
ATHLETICS_INDEX: int = 8

# Minimum number of consecutive blocks a dot must stay in these activities
# before the chain is allowed to transition it out.  One block = 5 min.
#   class / exercise: at least 30 min (6 blocks) — dropping out after 5 min is
#     unrealistic; real sessions are at least half an hour.
#   athletics: at least 60 min (12 blocks) — practices are typically 1-2 hours.
MIN_STAY_BLOCKS: Dict[int, int] = {
    CLASS_INDEX:     4,   # 20 min
    EXERCISE_INDEX:  6,   # 30 min
    ATHLETICS_INDEX: 12,  # 60 min
}


# ---------------------------------------------------------------------------
# Simulation
# ---------------------------------------------------------------------------

def simulate_students(
    pi_0: List[float],
    transitions: List[List[List[float]]],
    num_students: int,
    rng: random.Random,
) -> List[List[int]]:
    """Sample `num_students` trajectories of length NUM_BLOCKS.

    Applies a minimum-stay constraint: once a dot enters class, exercise, or
    athletics it must remain for at least MIN_STAY_BLOCKS[activity] blocks.
    While the minimum is unsatisfied the row of T[t] is replaced with a
    stay-in-place distribution (self-transition prob = 1).
    """
    activity_indices = list(range(NUM_ACTIVITIES))
    students: List[List[int]] = []
    for _ in range(num_students):
        trajectory: List[int] = [0] * NUM_BLOCKS
        trajectory[0] = rng.choices(activity_indices, weights=pi_0, k=1)[0]
        blocks_in_current: int = 1  # consecutive blocks spent in trajectory[0]

        for t in range(NUM_BLOCKS - 1):
            current = trajectory[t]
            weights: List[float] = list(transitions[t][current])

            # --- Constraint 1: minimum stay ---
            min_stay = MIN_STAY_BLOCKS.get(current, 0)
            if blocks_in_current < min_stay:
                # Force self-transition; ignore all other chain weights.
                weights = [0.0] * NUM_ACTIVITIES
                weights[current] = 1.0

            next_activity = rng.choices(activity_indices, weights=weights, k=1)[0]
            trajectory[t + 1] = next_activity

            if next_activity == current:
                blocks_in_current += 1
            else:
                blocks_in_current = 1

        students.append(trajectory)
    return students


# ---------------------------------------------------------------------------
# Orchestration
# ---------------------------------------------------------------------------

def main() -> None:
    if not CSV_PATH.exists():
        print(f"[error] CSV not found at {CSV_PATH}", file=sys.stderr)
        sys.exit(1)

    grouped_rows = load_respondent_rows(CSV_PATH)
    total_respondents = len(grouped_rows)

    # Two parallel respondent pools:
    #   - `kept_grids`:        respondents passing the 50% raw-coverage filter.
    #                          Used for the Markov chain transition estimation
    #                          (§2.4 of WRITEUP), which is sensitive to fill
    #                          quality: a respondent with 5.6% raw coverage who
    #                          forward-fills "Sleep" for the rest of the day
    #                          would inject spurious self-transition mass.
    #   - `all_filled_grids`:  every respondent with at least one raw block,
    #                          forward-filled. Used for `surveyCountsPerBlock`
    #                          (§2.5: Bayesian credible intervals over the
    #                          time-conditional marginal P(A_t = i)). Marginal
    #                          estimation is much less sensitive to fill
    #                          quality than transition estimation, and the
    #                          natural sample size for that inference is the
    #                          surveyed pool itself, not a coverage subset.
    kept_grids: List[List[int]] = []
    all_filled_grids: List[List[int]] = []
    coverage_report: List[Tuple[str, float]] = []
    dropped_from_chain: List[Tuple[str, float]] = []
    fully_empty: List[str] = []
    unknown_activities: Dict[str, int] = defaultdict(int)
    rows_seen = 0

    for submitted_at, rows in grouped_rows.items():
        rows_seen += len(rows)
        # Count unrecognized labels for the anomaly report.
        for row in rows:
            raw = row.get("activity", "").strip()
            if not raw:
                continue
            aliased = ACTIVITY_LABEL_ALIASES.get(raw, raw)
            if aliased not in ACTIVITY_INDEX_BY_LABEL:
                unknown_activities[raw] += 1

        blocks, raw_coverage = build_respondent_blocks(rows)
        coverage_report.append((submitted_at, raw_coverage))

        # A respondent with literally zero raw observations cannot be
        # forward-filled and must be dropped from both pools.
        if all(entry is None for entry in blocks):
            fully_empty.append(submitted_at)
            continue

        filled_grid = forward_then_back_fill(blocks)
        all_filled_grids.append(filled_grid)

        # Stricter filter for the chain: drop low-coverage respondents.
        if raw_coverage < COVERAGE_THRESHOLD:
            dropped_from_chain.append((submitted_at, raw_coverage))
            continue
        kept_grids.append(filled_grid)

    if not kept_grids:
        print("[error] No respondents passed the coverage filter.", file=sys.stderr)
        sys.exit(1)
    if not all_filled_grids:
        print("[error] No respondents had any raw observations.", file=sys.stderr)
        sys.exit(1)

    pi_marginal = compute_marginal_distribution(kept_grids)
    transitions = build_transition_matrices(kept_grids, pi_marginal)
    pi_0 = build_initial_distribution(kept_grids, pi_marginal)

    rng = random.Random()
    rng.seed(RANDOM_SEED)
    # Also seed the module-level RNG for determinism if any helper uses it.
    random.seed(RANDOM_SEED)
    students = simulate_students(pi_0, transitions, NUM_STUDENTS, rng)

    # Per-block activity counts across ALL respondents with at least one raw
    # observation (forward-filled), shape [numBlocks][numActivities]. By
    # construction, every block sums to len(all_filled_grids). Used by the
    # frontend to compute Bayesian credible intervals over the time-conditional
    # marginal P(A_t = i | T = t). The natural sample size for that inference
    # is the surveyed pool, NOT the simulated 1000 (which would massively
    # understate uncertainty since the 1000 trajectories are themselves draws
    # from a model fit to the survey) and NOT the chain-fitting subset (which
    # excludes low-coverage respondents who are still informative for
    # marginal-share estimation).
    survey_counts_per_block: List[List[int]] = [
        [0] * NUM_ACTIVITIES for _ in range(NUM_BLOCKS)
    ]
    for grid in all_filled_grids:
        for t in range(NUM_BLOCKS):
            survey_counts_per_block[t][grid[t]] += 1

    output = {
        "blockMinutes": BLOCK_MINUTES,
        "startMinute": START_MINUTE_OF_DAY,
        "numBlocks": NUM_BLOCKS,
        "numStudents": NUM_STUDENTS,
        "numSurveyRespondents": len(all_filled_grids),
        "numChainRespondents": len(kept_grids),
        "activities": [
            {"id": entry["id"], "label": entry["label"], "color": entry["color"]}
            for entry in ACTIVITY_CATALOG
        ],
        "students": students,
        "surveyCountsPerBlock": survey_counts_per_block,
    }

    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT_PATH.open("w", encoding="utf-8") as out:
        json.dump(output, out, separators=(",", ":"))

    # ----- Summary report -----
    total_transitions_counted = sum(len(grid) for grid in kept_grids)
    file_size_bytes = OUTPUT_PATH.stat().st_size
    timestamp = datetime.now().isoformat(timespec="seconds")

    print(f"[{timestamp}] build_simulation.py complete")
    print(f"  CSV path:                 {CSV_PATH}")
    print(f"  Output path:              {OUTPUT_PATH}")
    print(f"  Output file size:         {file_size_bytes:,} bytes "
          f"({file_size_bytes / 1024:.1f} KiB)")
    print(f"  Total respondents seen:           {total_respondents}")
    print(f"  Respondents in survey pool (N1):  {len(all_filled_grids)} "
          f"(used for surveyCountsPerBlock; ≥1 raw block)")
    print(f"  Respondents in chain pool (N2):   {len(kept_grids)} "
          f"(coverage ≥ {COVERAGE_THRESHOLD:.0%}; used for transitions / pi_0)")
    print(f"  Respondents fully empty:          {len(fully_empty)} (excluded)")
    print(f"  Respondents below coverage:       {len(dropped_from_chain)} "
          f"(in survey pool but not chain pool)")
    print(f"  Raw CSV rows processed:           {rows_seen}")
    print(f"  Total per-block samples:          {total_transitions_counted}")
    print(f"  Transitions per matrix:           {len(kept_grids)} respondents "
          f"x {NUM_BLOCKS} blocks = {len(kept_grids) * NUM_BLOCKS}")

    print(f"  Coverage stats (raw, pre-fill):")
    coverages = [cov for _, cov in coverage_report]
    if coverages:
        coverages_sorted = sorted(coverages)
        median_cov = coverages_sorted[len(coverages_sorted) // 2]
        print(f"    min={min(coverages):.3f}  "
              f"median={median_cov:.3f}  "
              f"max={max(coverages):.3f}  "
              f"mean={sum(coverages) / len(coverages):.3f}")

    print(f"  Empirical-Bayes prior strength alpha_total={EMP_BAYES_ALPHA_TOTAL}")
    print(f"  pi_marginal (global activity frequency, used as prior shape):")
    for idx, prob in enumerate(pi_marginal):
        label = ACTIVITY_CATALOG[idx]["label"]
        print(f"    [{idx:2d}] {label:32s}  {prob:.4f}")

    print(f"  pi_0 (initial distribution at 06:00, posterior mean):")
    for idx, prob in enumerate(pi_0):
        label = ACTIVITY_CATALOG[idx]["label"]
        print(f"    [{idx:2d}] {label:32s}  {prob:.4f}")

    if dropped_from_chain:
        print(f"  Respondents below 50%-coverage threshold "
              f"(in survey pool, not chain pool):")
        for submitted_at, cov in dropped_from_chain:
            print(f"    - {submitted_at}  coverage={cov:.3f}")
    if fully_empty:
        print(f"  Fully empty respondents (excluded from both pools):")
        for submitted_at in fully_empty:
            print(f"    - {submitted_at}")

    if unknown_activities:
        print(f"  Unknown activity strings mapped to 'Other':")
        for raw, count in sorted(unknown_activities.items()):
            print(f"    - {raw!r}: {count} rows")
    else:
        print("  No unrecognized activity strings encountered.")


if __name__ == "__main__":
    main()
