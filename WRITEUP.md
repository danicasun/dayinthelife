# A Day in the Life of Stanford Students

**CS109 Challenge Project — Writeup (Draft)**

## Abstract

This project is a FlowingData-inspired interactive visualization of how Stanford students spend a typical weekday. We surveyed 45 Stanford students about their activities over a 24-hour period, fit a **time-varying Markov chain** to the resulting transition data (using the 41 respondents whose raw block coverage exceeded 50%), and used the chain to simulate 1,000 synthetic students whose trajectories are then animated as 1,000 dots flowing between 14 activity clusters (Sleep, Class, Studying, Eating, Exercise, …) on a D3 force-directed canvas. The probabilistic core of the project is the model fit: with only $\sim 41$ observations per timestep, the maximum-likelihood transition matrix is full of zeros and overfits aggressively. We address this with an **empirical-Bayes Dirichlet prior** — Dirichlet$(\alpha_{\text{total}} \cdot \boldsymbol{\pi}_{\text{marginal}})$, the conjugate prior for a Multinomial — where the prior shape is the global empirical activity distribution and the total prior strength $\alpha_{\text{total}} = 0.1$ is small. The point estimate is the closed-form Dirichlet posterior mean. This is "additive smoothing" framed correctly as Bayesian inference, *and* it fixes a real pathology we observed under uniform smoothing (the simulated overnight Sleep distribution collapsing from ~95% to ~32% by 5:30am — see §2.4). On top of the simulation, two analytics panels report **Bayesian credible intervals over the time-conditional activity probability** $P(A_t = i)$ via Beta-Binomial conjugacy with a uniform Beta(1, 1) prior over all 45 surveyed respondents (§2.5; the looser pool is appropriate here because per-block marginal-share inference is far less sensitive to fill quality than transition inference is), and the **conditional entropy** $H(A \mid T = t)$ over the day (§2.6). Together the project demonstrates time-varying Markov chains, Multinomial likelihood and MLE, Dirichlet–Multinomial conjugacy, posterior-mean estimation under an empirical-Bayes prior, Beta-Binomial conjugacy with exact percentile credible intervals, the Shannon conditional entropy as a measure of distributional concentration, categorical sampling, and the Law of Large Numbers (visible directly in the stable activity-share curves once you simulate 1,000 students).

## 1. Data collection

We built a small survey asking respondents to log their activities over a 24-hour weekday window in 5–60 minute intervals, using free-form `HH:MM` start/end times and an activity dropdown. The dataset, collected May 29 – June 2, 2026, consists of:

- **45 unique respondents** (grouped by `submitted_at`). The two inferences in this writeup use slightly different respondent pools, by design: the Markov-chain transition fit (§2.4) uses the **41 respondents whose raw block coverage was ≥ 50%** ($N_{\text{chain}} = 41$), while the time-conditional Bayesian credible intervals (§2.5) use **all 45 surveyed respondents** ($N = 45$). Per-block marginal-share inference is much less sensitive to forward-fill quality than per-transition inference is — a respondent with sparse raw coverage who forward-fills "Sleep" for the rest of the day inflates self-transition mass aggressively, but contributes only one extra Sleep observation to each block (a relatively benign perturbation when divided by 45).
- **573 total activity intervals** logged across all respondents.
- **14 activity categories** in a fixed catalog: *Sleep, Class, Studying / Schoolwork, Work / Research, Eating, Social Event, Clubs / Professional Events, Exercise, Stanford Athletics / Practice, Transit / Commute, Leisure / Entertainment, Personal Care / Chores, Religion, Other.*
- Days were anchored at **06:00 → 06:00** the next morning, giving each respondent **288 five-minute blocks** of activity.

Each respondent's intervals are bucketed into the 5-minute grid. Gaps within a respondent's day are forward-filled (or back-filled at the start) using their last known activity; this is appropriate because most gaps are continuations of an ongoing activity that the respondent simply did not log. Respondents whose raw (pre-fill) coverage is below 50% are dropped, and intervals crossing midnight are split into two halves to fit the 06:00-anchored grid.

**Limitations.** The sample is small ($N = 45$, of which 41 cleared the 50% raw-coverage filter) and demographically skewed — the surveyed pool is heavily weighted toward sophomores and CS-affiliated students, captures only weekdays, and is sourced from the author's social network. We treat the result as descriptive of "the kind of Stanford student who fills out a friend's survey," not of the campus population. We discuss implications for the model in §3 and §7.

## 2. Probability model — time-varying Markov chain

### 2.1 Setup

Let $S = \{0, 1, \ldots, 13\}$ be the set of activity ids in catalog order, with $K = |S| = 14$. Let $A_t \in S$ be the activity of a randomly drawn student at 5-minute block $t \in \{0, 1, \ldots, 287\}$, where $t = 0$ corresponds to 06:00. We model $(A_0, A_1, \ldots, A_{287})$ as a **time-inhomogeneous (time-varying) Markov chain**:

$$
P(A_{t+1} = j \mid A_t = i, A_{t-1}, \ldots, A_0) \;=\; P(A_{t+1} = j \mid A_t = i) \;=\; T_t[i, j],
$$

where each $T_t$ is a $K \times K$ row-stochastic matrix. We allow $T_t$ to depend on $t$ because the dynamics of the day are sharply non-stationary: the probability of transitioning from *Sleep* to *Class* at 09:00 is very different from that probability at 02:00. To close the day into a cycle (and to support continuous looping in the visualization), we treat block 287 → block 0 as a real transition, so $T_{287}$ is fitted just like any other matrix.

The starting distribution $\pi_0 \in \Delta^{K-1}$ (a $K$-simplex) describes $P(A_0 = i)$.

### 2.2 Likelihood and the MLE problem

Fix a row $i$ of timestep $t$. Let $n_t[i, j]$ be the number of respondents who were in activity $i$ at block $t$ and activity $j$ at block $t+1$, and let $N_t[i] = \sum_j n_t[i, j]$. The vector $\mathbf{n}_t[i, :]$ is a draw from a **Multinomial** distribution:

$$
\mathbf{n}_t[i, :] \;\sim\; \text{Multinomial}\!\left(N_t[i], \; \boldsymbol{\theta}_t^{(i)}\right),
$$

where $\boldsymbol{\theta}_t^{(i)} = T_t[i, :]$ is the unknown row of the transition matrix. The maximum-likelihood estimate is the familiar empirical proportion:

$$
\hat{\theta}_{t,j}^{(i),\,\text{MLE}} \;=\; \frac{n_t[i, j]}{N_t[i]}.
$$

With only ~45 respondents total and a 14-state chain, $N_t[i]$ is often small (single digits or zero) for many $(t, i)$ pairs, so the MLE is dominated by zeros. Plugging zero-MLE rows directly into the simulator yields pathological behavior: any state never observed transitioning out of becomes an absorbing state, and any unobserved transition becomes literally impossible — including transitions that are obviously possible in real life.

### 2.3 Dirichlet prior, conjugacy, and posterior mean

Following the standard CS109 treatment of multinomial smoothing, we place a **Dirichlet prior** on each row of each transition matrix. The Dirichlet is the **conjugate prior** for the Multinomial, so combining the prior with the likelihood gives a closed-form posterior in the same family. Generically, with prior concentration $\boldsymbol{\beta} = (\beta_0, \ldots, \beta_{K-1})$:

$$
\boldsymbol{\theta}_t^{(i)} \;\sim\; \text{Dirichlet}(\boldsymbol{\beta}), \qquad
\boldsymbol{\theta}_t^{(i)} \mid \mathbf{n}_t[i, :] \;\sim\; \text{Dirichlet}\!\left(\boldsymbol{\beta} + \mathbf{n}_t[i, :]\right).
$$

We use the **posterior mean** as our point estimate, which, for a Dirichlet, is the normalized concentration vector:

$$
\hat{T}_t[i, j] \;=\; \mathbb{E}\!\left[\theta_{t,j}^{(i)} \mid \text{data}\right] \;=\; \frac{n_t[i, j] + \beta_j}{\sum_{k=0}^{K-1} n_t[i, k] + \sum_{k=0}^{K-1} \beta_k}.
$$

The remaining choice — and the part that ended up requiring real probabilistic reasoning — is the prior concentration vector $\boldsymbol{\beta}$.

### 2.4 Choosing the prior: from Jeffreys to empirical Bayes

We initially used **Jeffreys' prior** $\boldsymbol{\beta} = (\tfrac{1}{2}, \ldots, \tfrac{1}{2})$, the flat $\alpha = 0.5$ symmetric Dirichlet that is non-informative in the Fisher-information sense and a textbook default for the Multinomial. The smoothing formula collapses to the familiar add-$\alpha$ form $\hat{T}_t[i,j] = (n_t[i,j] + 0.5) / (N_t[i] + 7)$.

When we ran the resulting chain, we observed a striking pathology in the simulated overnight period. Empirically, ~95% of respondents are asleep at 5:30am. After fitting and simulating, the chain produced only **31.7% Sleep at 5:30am** — a massive under-representation. The cause is structural. Almost all 41 respondents are in *Sleep* during deep night, so $n_t[\text{Sleep}, \text{Sleep}] \approx 41$ and $n_t[\text{Sleep}, j] = 0$ for all other $j$. The smoothed self-transition probability is

$$
\hat{T}_t[\text{Sleep}, \text{Sleep}] \;=\; \frac{41 + 0.5}{41 + 14 \cdot 0.5} \;=\; \frac{41.5}{48} \;\approx\; 0.865.
$$

That's a **13.5% leak** out of *Sleep* per 5-minute block, despite the data unambiguously showing zero leak. Compounded over the ~80 night-time blocks, this drains the sleep cluster. The flat Dirichlet prior is "non-informative" in a strict statistical sense, but it is *informative-and-wrong* in a behavioral sense: it asserts that, absent data, all 14 activities are equally likely as a next state, which is obviously false for a population whose marginal time-use is dominated by a handful of activities.

We therefore switched to an **empirical-Bayes Dirichlet prior**:

$$
\boldsymbol{\beta} \;=\; \alpha_{\text{total}} \cdot \boldsymbol{\pi}_{\text{marginal}}, \qquad \alpha_{\text{total}} = 0.1,
$$

where $\boldsymbol{\pi}_{\text{marginal}}$ is the **global empirical activity distribution** across all (respondent, block) pairs (informally: "what fraction of all observed minutes is spent in each activity"). This is "empirical Bayes" in the sense that the prior shape is set from the data itself; the total prior strength $\alpha_{\text{total}} = 0.1$ keeps the prior weak enough that the likelihood dominates whenever it has signal. The smoothing formula becomes

$$
\boxed{\;\hat{T}_t[i, j] \;=\; \frac{n_t[i, j] + \alpha_{\text{total}}\,\pi_{\text{marginal}}[j]}{\sum_{k=0}^{K-1} n_t[i, k] + \alpha_{\text{total}}}\;}
$$

The empirical-Bayes prior fixes the pathology *and* is more principled. An unobserved transition row now defaults to "what the population is usually doing" rather than "all 14 activities are equally likely". The deep-night self-transition becomes

$$
\hat{T}_t[\text{Sleep}, \text{Sleep}] \;=\; \frac{41 + 0.1 \cdot \pi_{\text{marginal}}[\text{Sleep}]}{41 + 0.1} \;\approx\; \frac{41.03}{41.1} \;\approx\; 0.998,
$$

i.e. ~0.2% per-block leak, compatible with the empirical observation. The simulated 5:30am Sleep proportion rises from 31.7% to **95.3%**, matching the survey's empirical 5:30am Sleep frequency.

The starting distribution $\pi_0$ is treated identically: if $c_0[i]$ is the count of respondents whose first block (06:00) was activity $i$, we set $\hat{\pi}_0[i] = (c_0[i] + \alpha_{\text{total}}\,\pi_{\text{marginal}}[i]) / (\sum_k c_0[k] + \alpha_{\text{total}})$.

This shift — from Jeffreys to empirical Bayes — is the project's main probabilistic decision. We went from a textbook default to an empirically-grounded choice because we saw it fail in a way we could *quantify* (a 13.5% per-block leak over 80 blocks) and *fix* with a properly motivated prior.

### 2.5 Bayesian credible intervals over $P(A_t = i)$

Separately from the Markov-chain estimation, the visualization includes an interactive panel showing how the **time-conditional probability** $P(A_t = i \mid T = t)$ — "how likely is a randomly-drawn student to be in activity $i$ at time $t$" — varies across the day, with a 95% Bayesian credible band around the point estimate. This is a different inference problem from §2.3: we are not trying to estimate transition rows, we are estimating a single Bernoulli proportion at each $(t, i)$ pair.

For a fixed activity $i$ and time block $t$, define $k_i(t) \in \{0, 1, \ldots, N\}$ to be the number of survey respondents whose recorded activity at block $t$ is $i$, where $N = 45$ is the surveyed pool (every respondent with at least one raw observation, forward-filled). The chain-fitting subset of 41 (§2.4) drops 4 low-coverage respondents because their forward-fills inflate self-transition mass, but for marginal-share inference at a single block those 4 only contribute one observation each, so the bias is bounded by $4/45 \approx 9\%$ — much smaller than the gain in posterior precision from using the full surveyed pool. Conditional on $p_i(t) = P(A_t = i)$, the count is **Binomial**:

$$
k_i(t) \mid p_i(t) \;\sim\; \text{Binomial}\!\left(N, \, p_i(t)\right).
$$

The **Beta** distribution is the conjugate prior for the Binomial proportion. We use a **uniform Beta(1, 1) prior** — flat on $[0, 1]$, equivalent to one prior pseudo-success and one prior pseudo-failure — because, unlike the deep-night Sleep transition discussed in §2.4, here the data has plenty of signal at every block (every $(t, i)$ has $N = 45$ Bernoulli trials, not zero, even for rare activities), so we want a prior that is genuinely uninformative at the boundaries rather than tilted toward the global activity mix. Conjugacy gives the posterior in closed form:

$$
p_i(t) \mid k_i(t) \;\sim\; \text{Beta}\!\left(k_i(t) + 1, \;\; N - k_i(t) + 1\right).
$$

Crucially, we use the **survey** counts here, not the simulated counts. The 1,000 simulated trajectories are themselves draws from the chain fit in §2.4, so re-using them as Bernoulli observations would understate uncertainty by a factor of roughly $\sqrt{1000 / 45} \approx 4.7$. The natural sample size for an inference about $p_i(t)$ is the one set by the survey, not the one we chose for the visualization.

**Point estimate.** We plot the **posterior mean** as the primary line:

$$
\hat{p}_i(t) \;=\; \mathbb{E}\!\left[p_i(t) \mid k_i(t)\right] \;=\; \frac{k_i(t) + 1}{N + 2}.
$$

**Credible interval.** Around the line we plot the 95% **Bayesian credible interval** $\left[\;p_i(t)^{(0.025)}, \;\; p_i(t)^{(0.975)}\;\right]$, defined as the 2.5% and 97.5% quantiles of the posterior:

$$
\Pr\!\left(p_i(t)^{(0.025)} \le p_i(t) \le p_i(t)^{(0.975)} \;\big|\; k_i(t)\right) \;=\; 0.95.
$$

These quantiles are values $x \in [0, 1]$ satisfying $I_x(\alpha, \beta) = 0.025$ or $0.975$, where $I_x(\alpha, \beta)$ is the regularized incomplete beta function (i.e., the Beta CDF). With $N = 45$ and $\alpha = k+1$, $\beta = N-k+1$, the posterior is visibly skewed near the boundaries — for example when $k = 0$ (a never-observed activity at this block) the posterior is $\text{Beta}(1, N+1)$, which is right-skewed with a long tail. The standard Normal approximation $\mu \pm 1.96\,\sigma$ underestimates the upper tail in that regime and would also produce nonsensical negative lower bounds, so we use **exact percentile inversion**: a Numerical-Recipes-style continued-fraction evaluator for $I_x$, wrapped in a bisection search to invert it. Implementation in `web/src/lib/betaDistribution.ts`. The dashed reference line on the chart is the **marginal** $P(A = i) = \frac{1}{T}\sum_t \hat{p}_i(t)$, the daily-average share.

This is exactly the CS109 Beta-Binomial story applied at every $(t, i)$ pair, with the credible interval communicating a real, sample-size-driven uncertainty band that the Markov-chain animation alone cannot show.

### 2.6 Conditional entropy $H(A \mid T = t)$

A second analytics panel reports the Shannon **conditional entropy** of activity given time, computed at every block from the same simulated population. For block $t$ let $\hat{p}_i(t)$ denote the empirical share of simulated students in activity $i$ at time $t$ (plug-in estimator, equivalent up to a $1/(N+2)$ shift to the posterior mean from §2.5 with $N = 1000$, so essentially the share itself). Then

$$
H(A \mid T = t) \;=\; -\sum_{i=0}^{K-1} \hat{p}_i(t)\,\log_2 \hat{p}_i(t),
$$

with the standard convention $0 \cdot \log 0 = 0$ for unrepresented activities. This is just the entropy of the time-$t$ activity distribution, in bits. With $K = 14$ activities the maximum possible value is $\log_2(14) \approx 3.81$ bits, attained only if all 14 activities were equally likely; the minimum (zero) is attained when one activity has all the mass.

Why this is interesting visually: the curve is a quantitative trace of "predictability of student life" across the day. It is low overnight (everyone is sleeping → the distribution is a near-degenerate point mass), and it rises sharply mid-morning as people scatter into class, study, work, exercise, breakfast, and commute. It plateaus through the afternoon and peaks in the late evening, when students are spread across study, leisure, social, food, and the start of sleep simultaneously. This is a direct application of CS109's information-theoretic vocabulary: **entropy** as a measure of "spread" of a categorical distribution.

## 3. Simulation

With the smoothed $\hat{T}_t$ and $\hat{\pi}_0$ in hand, simulating a synthetic student is straightforward ancestral sampling on a Markov chain:

1. Sample $a_0 \sim \text{Categorical}(\hat{\pi}_0)$.
2. For $t = 0, 1, \ldots, 286$: sample $a_{t+1} \sim \text{Categorical}(\hat{T}_t[a_t, :])$.

We do this $N = 1{,}000$ times (independently) to produce a $1000 \times 288$ matrix of activity ids, written to `web/public/simulation.json`. We seed Python's `random` module with `random.seed(109)` so the build is reproducible. The categorical sampling itself is performed via stdlib `random.choices(population, weights=row)` — i.e., the standard CDF-inverse method on a discrete distribution.

The visualization uses minute-resolution time but block-resolution data: at simulated minute $m$, student $i$'s activity is `students[i][⌊m/5⌋]`, so each block is held for 5 simulated minutes before potentially changing.

A consequence of the model that the user can *see* in the running visualization is the **Law of Large Numbers**: with only one synthetic student, the activity-share curve over the day is jagged and noisy; with 1,000 synthetic students, the share of dots in each cluster as a function of time stabilizes into smooth curves that closely track the empirical activity-share curves from the survey. This is exactly the Monte Carlo intuition LLN gives us — averaging many i.i.d. draws of $\mathbb{1}[A_t = j]$ converges to $P(A_t = j)$ — made visceral.

## 4. Visualization

The frontend is a small Vite + React + TypeScript SPA (`/web`). The 1,000 students are rendered as small colored circles on a 1000×700 SVG/canvas. Each of the 14 activities has a fixed **centroid** (its anchor position on the canvas) and a fixed **color**; the catalog of centroids and colors is shared between the Python pipeline (only as labels) and the frontend (`lib/categories.ts`).

The animation is driven by a `requestAnimationFrame` ticker that maintains a fractional `currentMinute ∈ [0, 1440)`. At every frame:

1. The current 5-minute block is computed as `floor(currentMinute / 5)`.
2. Each dot's *target* activity is `students[i][currentBlock]`, and its target position is that activity's centroid plus a small per-dot random jitter (so dots in the same cluster don't all stack on one pixel).
3. A **D3 force simulation** (mainly an `forceX`/`forceY` toward each dot's target plus a weak `forceCollide`) integrates the dots toward their targets. When a dot's activity changes, the force simulation produces a smooth migration across the canvas instead of a teleport — visually echoing the FlowingData original.

The clock display is `formatHHmm((floor(currentMinute) + 360) % 1440)`, which makes the day visually start at 06:00 and wrap at 06:00 the next morning. Speed controls (paused / slow / medium / fast) just scale `currentMinute`'s rate of advance.

Below the moving-bubbles canvas, two analytics panels render the inferences described in §2.5 and §2.6:

- **"How predictable is the day?"** plots the conditional entropy $H(A \mid T = t)$ across the 24-hour day as a single line — a quantitative companion to the visual "spread" you see in the dot animation.
- **"When is a student doing X?"** is interactive: the user picks an activity from a dropdown, and the panel plots the posterior mean $\hat{p}_i(t)$ as a colored line, the 95% Bayesian credible interval as a shaded band of the same hue, and the daily marginal $P(A = i)$ as a dashed reference line. The percentile bounds are computed on demand via the Beta-CDF inverter in `web/src/lib/betaDistribution.ts`.

## 5. CS109 concepts demonstrated

1. **Time-varying (time-inhomogeneous) Markov chains.** The core model: 288 distinct $K \times K$ transition matrices, with cyclic wrap-around. The state is the activity bucket; the time index is the 5-minute block.
2. **Multinomial likelihood and MLE.** Each row of each transition matrix is a multinomial parameter, and the count of observed transitions out of $(t, i)$ is a Multinomial draw whose MLE is the empirical proportion.
3. **Dirichlet–Multinomial conjugate prior; posterior-mean estimation under an empirical-Bayes prior.** We place a Dirichlet$(\alpha_{\text{total}} \cdot \pi_{\text{marginal}})$ prior on each row, with the prior shape pinned to the global activity marginal. The closed-form posterior mean is our point estimate. The project's central probabilistic decision was diagnosing why the textbook Jeffreys' $\alpha = 0.5$ prior failed (a 13.5% per-block sleep leak that destroyed overnight sleep mass — see §2.4) and fixing it with a properly motivated empirical-Bayes prior.
4. **Beta-Binomial conjugacy with a uniform Beta(1, 1) prior; exact percentile credible intervals.** The activity-probability panel models $k_i(t) \mid p_i(t) \sim \text{Binomial}(N, p_i(t))$ with $N = 45$ survey respondents (the full pool, not the chain-fitting subset of 41), and reports the posterior $p_i(t) \mid k_i(t) \sim \text{Beta}(k_i(t) + 1, N - k_i(t) + 1)$. The 95% credible interval uses the **2.5% and 97.5% Beta quantiles** evaluated by numerical inversion of the regularized incomplete beta function — i.e., the actual posterior percentiles, not a Normal approximation, because at $N = 45$ the posterior is visibly skewed near the activity-rarity boundaries.
5. **Conditional entropy as a distributional summary.** The entropy panel computes $H(A \mid T = t) = -\sum_i \hat{p}_i(t) \log_2 \hat{p}_i(t)$ at every block. This makes the project's information-theoretic vocabulary explicit: the same time-$t$ marginal that the Markov chain produces is also a categorical distribution whose Shannon entropy quantifies how "concentrated" or "spread" student behavior is at that moment of the day.
6. **Categorical sampling.** Each step of each simulated trajectory is a draw from a categorical distribution with parameter equal to a row of $\hat{T}_t$.
7. **Law of Large Numbers.** Simulating $N = 1000$ trajectories and animating them yields visually stable activity-share curves — a direct, visceral instance of the Monte Carlo intuition that $\frac{1}{N} \sum_i \mathbb{1}[A_t^{(i)} = j] \to P(A_t = j)$ as $N$ grows. The contrast between the wide credible bands in the §2.5 panel ($N = 45$) and the smooth dot animation ($N = 1000$) is exactly the LLN tradeoff made visible: the simulation has very low Monte-Carlo variance, but the underlying parameter $p_i(t)$ still inherits the survey's epistemic uncertainty.

## 6. Limitations and future work

- **Small sample.** With $N_{\text{chain}} = 41$ for transition fitting, even with smoothing, many transition rows are dominated by the prior. A posterior over the *transitions themselves* (e.g., bootstrap or full Dirichlet posterior intervals) would let us communicate uncertainty in the visualization (e.g., transparent "fog" around clusters where the data is thin). This is straightforward to add: instead of a single $\hat{T}_t$ we can sample $T_t^{(s)}$ from the Dirichlet posterior and compute share-curve quantiles.
- **Demographic skew.** The respondent pool is heavy on sophomores and CS-affiliated students; we have not yet implemented per-cohort filtering (e.g., "show me athletes only" or "show me freshmen"), even though the survey collects `year`, `major`, and `athlete`. Adding a slicer is an obvious next step.
- **Weekday-only.** The survey covers weekdays only; weekend dynamics are very different (no class, more athletics, more leisure) and would warrant a separate chain.
- **Point estimates.** The current pipeline emits one trajectory matrix from a single fitted chain. A natural extension is to *bootstrap* the survey respondents (or sample from the full Dirichlet posterior) and re-fit, producing an ensemble of chains; the visualization can then average across them or show uncertainty bands.
- **Markov assumption.** Real activity sequences have dependencies longer than one block (you don't typically alternate Class–Eat–Class–Eat at 5-minute granularity). A higher-order chain or a semi-Markov / duration-aware model would capture activity *durations* more faithfully, at the cost of even sparser counts and a more aggressive prior.

## 7. LLM use disclosure

*Per CS109 challenge rules, the following section discloses LLM use.*

[Placeholder — fill in honestly. E.g., "I used Cursor with Claude/GPT models for: drafting boilerplate React component scaffolds, refactoring the build pipeline, and copy-editing this writeup. All probabilistic modeling decisions (choice of prior, smoothing formula, simulation procedure) were made by me. All survey-data cleaning rules and methodology were specified by me. No LLM-generated text appears in this writeup without my review and edits."]

## Appendix: key formulas at a glance

**Smoothed transition probability (posterior mean under empirical-Bayes Dirichlet–Multinomial):**

$$
P(A_{t+1} = j \mid A_t = i) \;=\; \frac{n_t[i, j] + \alpha_{\text{total}}\,\pi_{\text{marginal}}[j]}{\sum_{k=0}^{K-1} n_t[i, k] + \alpha_{\text{total}}}, \qquad K = 14,\; \alpha_{\text{total}} = 0.1.
$$

**Posterior over a transition row (empirical-Bayes prior):**

$$
\boldsymbol{\theta}_t^{(i)} \mid \text{counts} \;\sim\; \text{Dirichlet}\!\left(\alpha_{\text{total}}\,\pi_{\text{marginal}}[0] + n_t[i, 0], \ldots, \alpha_{\text{total}}\,\pi_{\text{marginal}}[K-1] + n_t[i, K-1]\right).
$$

**Time-conditional activity probability (Beta-Binomial posterior under uniform Beta(1, 1) prior):** for survey count $k_i(t) \in \{0, \ldots, N\}$ with $N = 45$,

$$
p_i(t) \mid k_i(t) \;\sim\; \text{Beta}\!\left(k_i(t) + 1, \;\; N - k_i(t) + 1\right), \qquad \mathbb{E}\!\left[p_i(t) \mid k_i(t)\right] \;=\; \frac{k_i(t) + 1}{N + 2}.
$$

**95% Bayesian credible interval (exact Beta percentiles):** $\left[I^{-1}(0.025;\; \alpha,\; \beta),\;\; I^{-1}(0.975;\; \alpha,\; \beta)\right]$ where $\alpha = k_i(t) + 1$, $\beta = N - k_i(t) + 1$, and $I^{-1}$ inverts the regularized incomplete beta function $I_x(\alpha, \beta)$.

**Conditional entropy of activity given time (bits):**

$$
H(A \mid T = t) \;=\; -\sum_{i=0}^{K-1} \hat{p}_i(t)\,\log_2 \hat{p}_i(t), \qquad H \in [0,\; \log_2 K] \;=\; [0,\; \log_2 14] \;\approx\; [0,\; 3.81].
$$

**Simulation:** $a_0 \sim \text{Categorical}(\hat{\pi}_0)$, then $a_{t+1} \sim \text{Categorical}(\hat{T}_t[a_t, :])$, repeated $N = 1{,}000$ times with `random.seed(109)`.
