// gta6-twitch-ccu-forecast-01 — Candidate E (control)
// Parametric shape: the comparables' median log-ratio profile is fitted with
// a log-linear decay plus a Gaussian evening bump (prime-time peak near hour
// 21 UTC); the spread is one pooled set of residual quantiles, constant
// across hours. A deliberately simple control for the empirical designs.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LEVELS: number[] = [0.05, 0.25, 0.5, 0.75, 0.95];

type HourPt = { from: string; viewers: number | null; channels: number | null };
type Comparable = { name: string; day_start: string; hourly: HourPt[] };
type Case = {
  id: string;
  day_start: string;
  known: { hour: number; viewers: number }[];
  comparables: Comparable[];
};

function quantileOf(sorted: number[], tau: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * tau;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

function launchRatios(comp: Comparable): Map<number, number> | null {
  const t0 = Date.parse(comp.day_start);
  if (!Number.isFinite(t0)) return null;
  const byOffset = new Map<number, number>();
  for (const pt of comp.hourly) {
    if (pt.viewers === null || pt.viewers === undefined) continue;
    const off = Math.round((Date.parse(pt.from) - t0) / 3600000);
    if (off >= 0 && off <= 23) byOffset.set(off, pt.viewers);
  }
  const y1 = byOffset.get(0);
  if (y1 === undefined || y1 <= 0) return null;
  if (byOffset.size < 20) return null;
  const ratios = new Map<number, number>();
  for (const [off, v] of byOffset) {
    if (off >= 1 && v > 0) ratios.set(off + 1, Math.log(v / y1));
  }
  return ratios;
}

// Least squares for y ~ a + b*x1 + c*x2 via normal equations (3x3 solve).
function fit3(xs: number[][], ys: number[]): number[] {
  const n = xs.length;
  const m = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const v = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const row = [1, xs[i][0], xs[i][1]];
    for (let a = 0; a < 3; a++) {
      v[a] += row[a] * ys[i];
      for (let b = 0; b < 3; b++) m[a][b] += row[a] * row[b];
    }
  }
  // Gaussian elimination
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(m[r][col]) > Math.abs(m[piv][col])) piv = r;
    const tmp = m[col]; m[col] = m[piv]; m[piv] = tmp;
    const tv = v[col]; v[col] = v[piv]; v[piv] = tv;
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = m[r][col] / m[col][col];
      for (let cc = 0; cc < 3; cc++) m[r][cc] -= f * m[col][cc];
      v[r] -= f * v[col];
    }
  }
  return [v[0] / m[0][0], v[1] / m[1][1], v[2] / m[2][2]];
}

function forecast(c: Case): { hour: number; q: number[] }[] {
  const p = Math.max(c.known[0].viewers, 1);
  const all: Map<number, number>[] = [];
  const samples = new Map<number, number[]>();
  for (let h = 2; h <= 24; h++) samples.set(h, []);
  for (const comp of c.comparables) {
    const ratios = launchRatios(comp);
    if (ratios === null) continue;
    all.push(ratios);
    for (const [h, r] of ratios) samples.get(h)?.push(r);
  }
  const bump = (h: number) => Math.exp(-Math.pow(h - 21, 2) / (2 * 2.5 * 2.5));
  const xs: number[][] = [];
  const ys: number[] = [];
  for (let h = 2; h <= 24; h++) {
    const s = (samples.get(h) ?? []).slice().sort((a, b) => a - b);
    if (s.length === 0) continue;
    xs.push([h - 2, bump(h)]);
    ys.push(quantileOf(s, 0.5));
  }
  const coef = xs.length >= 3 ? fit3(xs, ys) : [0, 0, 0];
  const fitted = (h: number) => coef[0] + coef[1] * (h - 2) + coef[2] * bump(h);
  const residuals: number[] = [];
  for (const ratios of all) {
    for (const [h, r] of ratios) residuals.push(r - fitted(h));
  }
  residuals.sort((a, b) => a - b);
  const rq = LEVELS.map((tau) => (residuals.length > 0 ? quantileOf(residuals, tau) : 0));
  const rq50 = residuals.length > 0 ? quantileOf(residuals, 0.5) : 0;

  const hours: { hour: number; q: number[] }[] = [];
  for (let h = 2; h <= 24; h++) {
    let prev = 0;
    const q = LEVELS.map((_, i) => {
      let v = p * Math.exp(fitted(h) + rq[i] - rq50);
      v = Math.min(Math.max(v, 0.01), 1000000000);
      v = Math.max(v, prev);
      prev = v;
      return Math.round(v * 100) / 100;
    });
    hours.push({ hour: h, q });
  }
  return hours;
}

function main(): void {
  const inDir = process.env.MAKEFUN_INPUT_DIR ?? "/input";
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const files = readdirSync(inDir).filter((f) => f.endsWith(".in")).sort();
  for (const f of files) {
    const c = JSON.parse(readFileSync(join(inDir, f), "utf8")) as Case;
    const outName = f.slice(0, -3) + ".out";
    writeFileSync(join(outDir, outName), JSON.stringify({ hours: forecast(c) }));
  }
}

main();
