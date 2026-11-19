import { describe, it, expect } from 'vitest';
import { timeDelta, distanceTime } from './delta.js';
import { CIRCUITS, getTrackModel } from '../data/circuits.js';
import { LapTimer } from './lapTimer.js';
import { createSimulator } from './simulator.js';
import { analyzeLap } from './analysis.js';

// vuelta a velocidad constante v (m/s) sobre L metros, muestreada cada ds
const lap = (L, v, ds = 10, t0 = 0) => {
  const n = Math.round(L / ds);
  return Array.from({ length: n + 1 }, (_, i) => {
    const s = (i / n) * L;
    return { s, t: t0 + (s / v) * 1000 };
  });
};

describe('timeDelta', () => {
  it('misma vuelta → delta 0', () => {
    const a = lap(1000, 50);
    expect(timeDelta(a, a).every((d) => Math.abs(d) < 1e-9)).toBe(true);
  });

  it('vuelta más lenta → delta positivo creciente hasta la diferencia total', () => {
    const sel = lap(1000, 40, 8, 5000); // 25 s
    const ref = lap(1000, 50, 10, 900); // 20 s
    const d = timeDelta(sel, ref);
    expect(d).toHaveLength(sel.length);
    expect(d[0]).toBeCloseTo(0, 6);
    expect(d[d.length - 1]).toBeCloseTo(5, 6);
    for (let i = 1; i < d.length; i++) expect(d[i]).toBeGreaterThanOrEqual(d[i - 1] - 1e-9);
    // a mitad de vuelta: 12.5 − 10
    const mid = sel.findIndex((p) => p.s >= 497);
    expect(d[mid]).toBeCloseTo((sel[mid].s / 40 - sel[mid].s / 50), 6);
  });

  it('normaliza por distancia total (deriva GPS)', () => {
    // mismo ritmo, pero la referencia "mide" un 3 % más
    const sel = lap(1000, 50);
    const ref = lap(1030, 51.5);
    const d = timeDelta(sel, ref);
    expect(Math.max(...d.map(Math.abs))).toBeLessThan(1e-6);
  });

  it('ganar al principio y perder al final', () => {
    const ref = lap(1000, 50);
    // sel: 1ª mitad a 60 m/s, 2ª mitad a 40 m/s
    const sel = [];
    for (let s = 0; s <= 1000; s += 10) sel.push({ s, t: s <= 500 ? (s / 60) * 1000 : (500 / 60 + (s - 500) / 40) * 1000 });
    const d = timeDelta(sel, ref);
    const mid = d[50];
    expect(mid).toBeCloseTo(500 / 60 - 10, 6); // negativo: gana
    expect(mid).toBeLessThan(0);
    expect(d[d.length - 1]).toBeCloseTo(500 / 60 + 12.5 - 20, 6);
  });

  it('casos degenerados', () => {
    expect(timeDelta([], lap(100, 10))).toEqual([]);
    expect(timeDelta(lap(100, 10), [])).toEqual(lap(100, 10).map(() => 0));
  });

  it('vueltas simuladas: el delta final ≈ diferencia de tiempos de vuelta', () => {
    const c = CIRCUITS.find((x) => x.id === 'jerez');
    const model = getTrackModel(c);
    const timer = new LapTimer(model);
    for (const f of createSimulator(model, { laps: 2, seed: 3, vmaxKmh: c.vmaxKmh }).generateAll()) timer.push(f);
    const [a, b] = timer.laps.map((l) => analyzeLap(l.points, model.racingLine, model.proj));
    const d = timeDelta(distanceTime(a), distanceTime(b));
    expect(d).toHaveLength(a.trace.length);
    expect(d[d.length - 1]).toBeCloseTo((timer.laps[0].timeMs - timer.laps[1].timeMs) / 1000, 2);
  });
});
