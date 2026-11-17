// gta6-twitch-ccu-forecast-01 — Candidate D
// Hierarchical: diurnal shape from all comparables, but each launch's
// log-ratios enter the per-hour quantiles with a similarity weight — a
// Gaussian kernel on log hour-1 viewers, on log pre-release level (mean of
// the 24h before release), and on log hour-1 channels when both sides have
// them. Weighted empirical quantiles per hour; no hard neighbour cut.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LEVELS: number[] = [0.05, 0.25, 0.5, 0.75, 0.95];
const SIGMA = 0.75;

type HourPt = { from: string; viewers: number | null; channels: number | null };
type Comparable = { name: string; day_start: string; hourly: HourPt[] };
type Case = {
  id: string;
  day_start: string;
  known: { hour: number; viewers: number; channels: number | null }[];
  history_hourly: { from: string; viewers: number | null }[];
  comparables: Comparable[];
};

type Launch = {
  y1: number;
  ch1: number | null;
  pre: number | null;
  ratios: Map<number, number>;
};

function launchOf(comp: Comparable): Launch | null {
  const t0 = Date.parse(comp.day_start);
  if (!Number.isFinite(t0)) return null;
  const byOffset = new Map<number, HourPt>();
  for (const pt of comp.hourly) {
    if (pt.viewers === null || pt.viewers === undefined || pt.viewers <= 0) continue;
    const off = Math.round((Date.parse(pt.from) - t0) / 3600000);
    byOffset.set(off, pt);
  }
  const first = byOffset.get(0);
  if (first === undefined) return null;
  let dayCount = 0;
  for (let off = 0; off <= 23; off++) if (byOffset.has(off)) dayCount++;
  if (dayCount < 20) return null;
  const y1 = first.viewers as number;
  const ratios = new Map<number, number>();
  for (const [off, pt] of byOffset) {
    if (off >= 1 && off <= 23) ratios.set(off + 1, Math.log((pt.viewers as number) / y1));
  }
  const preVals: number[] = [];
  for (let off = -24; off <= -1; off++) {
    const pt = byOffset.get(off);
    if (pt !== undefined) preVals.push(Math.log(pt.viewers as number));
  }
  const pre = preVals.length >= 8 ? preVals.reduce((a, b) => a + b, 0) / preVals.length : null;
  const ch1 = first.channels !== null && first.channels !== undefined && first.channels > 0
    ? first.channels : null;
  return { y1, ch1, pre, ratios };
}

function weightedQuantile(pairs: { v: number; w: number }[], tau: number): number {
  const s = pairs.slice().sort((a, b) => a.v - b.v);
  const total = s.reduce((a, x) => a + x.w, 0);
  if (total <= 0) return s[0].v;
  const target = tau * total;
  let acc = 0;
  for (let i = 0; i < s.length; i++) {
    acc += s[i].w;
    if (acc >= target) {
      if (i === 0) return s[i].v;
      const prevAcc = acc - s[i].w;
      const frac = (target - prevAcc) / s[i].w;
      return s[i - 1].v + frac * (s[i].v - s[i - 1].v);
    }
  }
  return s[s.length - 1].v;
}

function forecast(c: Case): { hour: number; q: number[] }[] {
  const p = Math.max(c.known[0].viewers, 1);
  const chT = c.known[0].channels !== null && c.known[0].channels !== undefined && c.known[0].channels > 0
    ? c.known[0].channels : null;
  const t0 = Date.parse(c.day_start);
  const preVals: number[] = [];
  for (const pt of c.history_hourly ?? []) {
    if (pt.viewers === null || pt.viewers === undefined || pt.viewers <= 0) continue;
    const t = Date.parse(pt.from);
    if (t >= t0 - 24 * 3600000 && t < t0) preVals.push(Math.log(pt.viewers));
  }
  const preTarget = preVals.length >= 8 ? preVals.reduce((a, b) => a + b, 0) / preVals.length : null;

  const launches: Launch[] = [];
  for (const comp of c.comparables) {
    const l = launchOf(comp);
    if (l !== null) launches.push(l);
  }
  const weighted = launches.map((l) => {
    let d2 = Math.pow(Math.log(l.y1) - Math.log(p), 2);
    if (preTarget !== null && l.pre !== null) d2 += Math.pow(l.pre - preTarget, 2);
    if (chT !== null && l.ch1 !== null) d2 += Math.pow(Math.log(l.ch1) - Math.log(chT), 2);
    return { l, w: Math.exp(-d2 / (2 * SIGMA * SIGMA)) };
  });

  const hours: { hour: number; q: number[] }[] = [];
  for (let h = 2; h <= 24; h++) {
    const pairs: { v: number; w: number }[] = [];
    for (const { l, w } of weighted) {
      const r = l.ratios.get(h);
      if (r !== undefined) pairs.push({ v: r, w });
    }
    let prev = 0;
    const q = LEVELS.map((tau) => {
      const r = pairs.length > 0 ? weightedQuantile(pairs, tau) : 0;
      let v = p * Math.exp(r);
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
