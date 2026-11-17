// gta6-twitch-ccu-forecast-01 — Candidate C
// Analog days (k-NN): pick the 8 past launches whose scale best matches this
// case — distance on log hour-1 viewers plus log mean viewers over the 24
// hours before release — and take the empirical quantiles of those analogs'
// release-day log-ratios per hour.
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const LEVELS: number[] = [0.05, 0.25, 0.5, 0.75, 0.95];
const K = 8;

type HourPt = { from: string; viewers: number | null; channels: number | null };
type Comparable = { name: string; day_start: string; hourly: HourPt[] };
type Case = {
  id: string;
  day_start: string;
  known: { hour: number; viewers: number }[];
  history_hourly: { from: string; viewers: number | null }[];
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

type Launch = {
  y1: number;
  pre: number | null; // mean log viewers, 24h before release day
  ratios: Map<number, number>;
};

function launchOf(comp: Comparable): Launch | null {
  const t0 = Date.parse(comp.day_start);
  if (!Number.isFinite(t0)) return null;
  const byOffset = new Map<number, number>();
  for (const pt of comp.hourly) {
    if (pt.viewers === null || pt.viewers === undefined || pt.viewers <= 0) continue;
    const off = Math.round((Date.parse(pt.from) - t0) / 3600000);
    byOffset.set(off, pt.viewers);
  }
  const y1 = byOffset.get(0);
  if (y1 === undefined || y1 <= 0) return null;
  let dayCount = 0;
  for (let off = 0; off <= 23; off++) if (byOffset.has(off)) dayCount++;
  if (dayCount < 20) return null;
  const ratios = new Map<number, number>();
  for (const [off, v] of byOffset) {
    if (off >= 1 && off <= 23) ratios.set(off + 1, Math.log(v / y1));
  }
  const preVals: number[] = [];
  for (let off = -24; off <= -1; off++) {
    const v = byOffset.get(off);
    if (v !== undefined) preVals.push(Math.log(v));
  }
  const pre = preVals.length >= 8 ? preVals.reduce((a, b) => a + b, 0) / preVals.length : null;
  return { y1, pre, ratios };
}

function forecast(c: Case): { hour: number; q: number[] }[] {
  const p = Math.max(c.known[0].viewers, 1);
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
  const scored = launches.map((l) => {
    let d = Math.abs(Math.log(l.y1) - Math.log(p));
    if (preTarget !== null && l.pre !== null) d += Math.abs(l.pre - preTarget);
    else d *= 2;
    return { l, d };
  });
  scored.sort((a, b) => a.d - b.d);
  const analogs = scored.slice(0, K).map((s) => s.l);
  const pool = analogs.length > 0 ? analogs : launches;

  const hours: { hour: number; q: number[] }[] = [];
  for (let h = 2; h <= 24; h++) {
    const s = pool
      .map((l) => l.ratios.get(h))
      .filter((v): v is number => v !== undefined)
      .sort((a, b) => a - b);
    let prev = 0;
    const q = LEVELS.map((tau) => {
      const r = s.length > 0 ? quantileOf(s, tau) : 0;
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
