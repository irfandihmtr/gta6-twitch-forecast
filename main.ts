// gta6-twitch-ccu-forecast-01 — Candidate A
// Diurnal shape from comparables: for every past launch in the case, take the
// log-ratio r_h = log(y_h / y_1) of each release-day hour against its hour 1.
// The forecast for hour h is hour 1 of this case times the empirical quantiles
// of r_h across launches, one quantile per requested level. No model, no
// network, deterministic.
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

// Interpolated quantile (type 7) of an ascending-sorted sample.
function quantileOf(sorted: number[], tau: number): number {
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * tau;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  const frac = pos - lo;
  return sorted[lo] * (1 - frac) + sorted[hi] * frac;
}

// Release-day log-ratios for one comparable, or null when its release day is
// not a real launch day in the data (hour 1 missing, or the day is sparse —
// the pre-release category history in the case fails both tests).
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

function forecast(c: Case): { hour: number; q: number[] }[] {
  const p = Math.max(c.known[0].viewers, 1);
  const samples = new Map<number, number[]>();
  for (let h = 2; h <= 24; h++) samples.set(h, []);
  for (const comp of c.comparables) {
    const ratios = launchRatios(comp);
    if (ratios === null) continue;
    for (const [h, r] of ratios) samples.get(h)?.push(r);
  }
  const hours: { hour: number; q: number[] }[] = [];
  for (let h = 2; h <= 24; h++) {
    const s = (samples.get(h) ?? []).slice().sort((a, b) => a - b);
    let prev = 0;
    const q = LEVELS.map((tau) => {
      const r = s.length > 0 ? quantileOf(s, tau) : 0;
      let v = p * Math.exp(r);
      v = Math.min(Math.max(v, 0.01), 1000000000);
      v = Math.max(v, prev); // quantiles never cross
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
