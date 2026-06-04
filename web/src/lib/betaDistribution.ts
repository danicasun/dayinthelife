/**
 * Beta distribution utilities — minimal, dependency-free, accurate to ~1e-9.
 *
 * Exposes:
 *   - `logGamma(z)`                       Lanczos approximation for ln Γ(z)
 *   - `regularizedIncompleteBeta(x, a, b)` I_x(a, b), the Beta CDF
 *   - `betaInverseCDF(p, a, b)`           Bisection inverse of the Beta CDF
 *   - `betaMean(a, b)`                    a / (a + b)
 *
 * Use case
 * --------
 * The activity-probability chart needs *exact* 95% Bayesian credible
 * intervals for the parameter `p_i(t)` of a Beta-Binomial model with a
 * uniform Beta(1, 1) prior:
 *
 *   p_i(t) | k_i(t)  ~  Beta( k_i(t) + 1,  N − k_i(t) + 1 )
 *
 * where N = number of survey respondents. With N = 41 (our post-coverage-
 * filter sample size), the Normal approximation `μ ± 1.96·σ` is unreliable
 * at the boundaries (e.g. when k = 0 or k = N), so we use the actual 2.5%
 * and 97.5% quantiles of the Beta posterior via numerical inversion.
 *
 * Algorithm
 * ---------
 * Standard Numerical-Recipes-style implementation:
 *
 *   1. `logGamma` via Lanczos (g = 7, 9-term coefficient set; ~1e-15 relative
 *      error for x > 0.5).
 *   2. `regularizedIncompleteBeta(x, a, b)` evaluates the regularized
 *      incomplete beta I_x(a, b) by analytic continuation:
 *          - Use the continued fraction `betacf` for x < (a+1)/(a+b+2).
 *          - Use 1 − I_{1-x}(b, a) (i.e. the reflection identity) otherwise.
 *      Both branches share `betacf`, which converges in ~30 iterations for
 *      our parameter range (a, b ∈ [1, N+1] with N = 41).
 *   3. `betaInverseCDF(p, a, b)` runs vanilla bisection on
 *      I_x(a, b) − p ∈ [0, 1]. Convergence to a tolerance of 1e-9 takes
 *      ~30 steps. Performance is fine for the use case (≤ 2·(N+1) inverse
 *      calls per chart-rerender).
 */

const LANCZOS_G = 7;
const LANCZOS_COEFFICIENTS: ReadonlyArray<number> = [
  0.99999999999980993,
  676.5203681218851,
  -1259.1392167224028,
  771.32342877765313,
  -176.61502916214059,
  12.507343278686905,
  -0.13857109526572012,
  9.9843695780195716e-6,
  1.5056327351493116e-7,
];

/** Natural log of Γ(z) via the Lanczos approximation (z > 0). */
export function logGamma(z: number): number {
  // Reflection formula keeps numerical stability for very small z.
  if (z < 0.5) {
    return (
      Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z)
    );
  }
  const zShifted = z - 1;
  let sum = LANCZOS_COEFFICIENTS[0];
  for (let i = 1; i < LANCZOS_COEFFICIENTS.length; i++) {
    sum += LANCZOS_COEFFICIENTS[i] / (zShifted + i);
  }
  const t = zShifted + LANCZOS_G + 0.5;
  return (
    0.5 * Math.log(2 * Math.PI) +
    (zShifted + 0.5) * Math.log(t) -
    t +
    Math.log(sum)
  );
}

/**
 * Continued-fraction expansion used by both branches of the regularized
 * incomplete beta. Adapted from Numerical Recipes §6.4. Lentz's algorithm
 * with the standard tiny-floor `FPMIN` and ratio-tolerance `EPS`.
 */
function betaContinuedFraction(a: number, b: number, x: number): number {
  const FPMIN = 1e-30;
  const EPS = 1e-12;
  const MAX_ITERATIONS = 200;

  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;

  for (let m = 1; m <= MAX_ITERATIONS; m++) {
    const m2 = 2 * m;
    // Even step
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    // Odd step
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const delta = d * c;
    h *= delta;
    if (Math.abs(delta - 1) < EPS) break;
  }
  return h;
}

/**
 * Regularized incomplete beta function I_x(a, b) ∈ [0, 1].
 * This is the CDF of a Beta(a, b) distribution evaluated at x.
 *
 * Identities:
 *   I_0(a, b) = 0,  I_1(a, b) = 1,  I_x(a, b) = 1 − I_{1−x}(b, a).
 */
export function regularizedIncompleteBeta(
  x: number,
  a: number,
  b: number,
): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  // log B(a, b) = log Γ(a) + log Γ(b) − log Γ(a+b)
  const logBetaPrefactor =
    logGamma(a + b) -
    logGamma(a) -
    logGamma(b) +
    a * Math.log(x) +
    b * Math.log(1 - x);
  const prefactor = Math.exp(logBetaPrefactor);
  if (x < (a + 1) / (a + b + 2)) {
    return (prefactor * betaContinuedFraction(a, b, x)) / a;
  }
  return 1 - (prefactor * betaContinuedFraction(b, a, 1 - x)) / b;
}

/** Closed-form mean of Beta(a, b). */
export function betaMean(a: number, b: number): number {
  return a / (a + b);
}

/**
 * Inverse Beta CDF: returns x ∈ [0, 1] such that I_x(a, b) ≈ p, via
 * bisection. Tolerance `1e-9` is well below visual perceptibility on the
 * probability axis.
 *
 * Edge cases:
 *   - p ≤ 0  → 0
 *   - p ≥ 1  → 1
 *   - For a or b ≤ 0, behavior is undefined (we never hit this in the
 *     application: a = k+1 ≥ 1, b = N−k+1 ≥ 1).
 */
export function betaInverseCDF(p: number, a: number, b: number): number {
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let low = 0;
  let high = 1;
  // 50 bisection halvings → 2^-50 ≈ 9e-16 absolute tolerance, well
  // beyond the ~1e-12 numerical precision of our CDF evaluator.
  for (let iteration = 0; iteration < 60; iteration++) {
    const mid = 0.5 * (low + high);
    const cdf = regularizedIncompleteBeta(mid, a, b);
    if (cdf < p) {
      low = mid;
    } else {
      high = mid;
    }
    if (high - low < 1e-12) break;
  }
  return 0.5 * (low + high);
}
