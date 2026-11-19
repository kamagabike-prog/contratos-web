import { describe, it, expect } from 'vitest';
import { CIRCUITS, getTrackModel, hasGeometry } from '../data/circuits.js';
import { segmentIntersection } from '../geo/geometry.js';
import { LapTimer } from './lapTimer.js';
import { createSimulator } from './simulator.js';
import { analyzeLap } from './analysis.js';

describe('segmentIntersection', () => {
  it('detecta cruce y parámetro t', () => {
    const r = segmentIntersection({ x: 0, y: -1 }, { x: 0, y: 3 }, { x: -1, y: 0 }, { x: 1, y: 0 });
    expect(r.t).toBeCloseTo(0.25);
    expect(r.u).toBeCloseTo(0.5);
  });
  it('null si no se cortan', () => {
    expect(segmentIntersection({ x: 0, y: 1 }, { x: 0, y: 3 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
});

describe.each(CIRCUITS.filter(hasGeometry).map((c) => [c.id, c]))('%s', (_id, c) => {
  const model = getTrackModel(c);
  it('trazada ideal dentro de pista', () => {
    for (const o of model.racingOffsets) expect(Math.abs(o)).toBeLessThanOrEqual(c.width / 2);
    // debe usar el ancho de pista (no ser la línea central)
    expect(Math.max(...model.racingOffsets.map(Math.abs))).toBeGreaterThan(c.width / 2 - 2);
  });
  it('simulación → vueltas cronometradas y métricas', () => {
    const sim = createSimulator(model, { laps: 3, seed: 42, vmaxKmh: c.vmaxKmh });
    const timer = new LapTimer(model);
    for (const f of sim.generateAll()) timer.push(f);
    expect(timer.laps.length).toBe(3);
    for (const lap of timer.laps) {
      expect(lap.timeMs).toBeGreaterThan(80000);
      expect(lap.timeMs).toBeLessThan(150000);
      const a = analyzeLap(lap.points, model.racingLine);
      expect(a.avgDeviationM).toBeGreaterThan(0.3);
      expect(a.avgDeviationM).toBeLessThan(4);
      expect(a.distanceM).toBeGreaterThan(c.lengthM * 0.97);
      console.log(c.id, lap.number, (lap.timeMs / 1000).toFixed(3), 'vmax', a.maxSpeedKmh.toFixed(0), 'dev', a.avgDeviationM.toFixed(2), 'max', a.maxDeviationM.toFixed(1));
    }
  });
});
