import { describe, it, expect } from 'vitest';
import { CIRCUITS, getTrackModel } from '../data/circuits.js';
import { segmentIntersection, smoothTrace } from '../geo/geometry.js';
import { haversine } from '../geo/projection.js';
import { LapTimer } from './lapTimer.js';
import { createSimulator } from './simulator.js';
import { analyzeLap } from './analysis.js';
import { rawLean } from './leanSensor.js';

describe('geometría', () => {
  it('intersección de segmentos y parámetro t', () => {
    const r = segmentIntersection({ x: 0, y: -1 }, { x: 0, y: 3 }, { x: -1, y: 0 }, { x: 1, y: 0 });
    expect(r.t).toBeCloseTo(0.25);
    expect(r.u).toBeCloseTo(0.5);
    expect(segmentIntersection({ x: 0, y: 1 }, { x: 0, y: 3 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBeNull();
  });
  it('haversine: 1° de latitud ≈ 111 km', () => {
    expect(haversine(40, -3, 41, -3)).toBeGreaterThan(111000);
    expect(haversine(40, -3, 41, -3)).toBeLessThan(111400);
  });
  it('Catmull-Rom pasa por los fixes y densifica', () => {
    const pts = [0, 1, 2, 3].map((i) => ({ x: i * 50, y: Math.sin(i) * 30, t: i * 1000, v: 50, lean: 0 }));
    const s = smoothTrace(pts, 4);
    expect(s.length).toBeGreaterThan(30);
    expect(s[0]).toEqual(pts[0]);
    expect(s[s.length - 1]).toEqual(pts[3]);
  });
  it('inclinación: móvil vertical girado 30°', () => {
    expect(rawLean(90, 30)).toBeCloseTo(0, 5); // β=90 → cos β = 0: el giro es alrededor del eje Z
    // montaje horizontal: γ>0 = borde derecho abajo = inclinación a la DERECHA (−)
    expect(rawLean(10, 25)).toBeCloseTo(-25, 6);
  });
});

it('hay 8 circuitos con geometría, meta y 2 parciales', () => {
  expect(CIRCUITS.map((c) => c.id)).toEqual(['jerez', 'montmelo', 'cheste', 'aragon', 'navarra', 'albacete', 'almeria', 'cartagena']);
  for (const c of CIRCUITS) {
    expect(c.centerline.length).toBeGreaterThan(300);
    expect(c.finishLine).toHaveLength(2);
    expect(c.sectorLines).toHaveLength(2);
  }
});

describe.each(CIRCUITS.map((c) => [c.id, c]))('%s', (_id, c) => {
  const model = getTrackModel(c);
  it('trazada ideal dentro de pista y usando su ancho', () => {
    for (const o of model.racingOffsets) expect(Math.abs(o)).toBeLessThanOrEqual(c.width / 2);
    expect(Math.max(...model.racingOffsets.map(Math.abs))).toBeGreaterThan(c.width / 2 - 2);
  });
  it.each([1, 10])('simulación a %i Hz → vueltas, parciales y métricas', (hz) => {
    const sim = createSimulator(model, { laps: 3, seed: 7, vmaxKmh: c.vmaxKmh, rateHz: hz });
    const timer = new LapTimer(model);
    for (const f of sim.generateAll()) timer.push(f);
    expect(timer.laps.length).toBe(3);
    for (const lap of timer.laps) {
      expect(lap.sectors).not.toBeNull();
      expect(lap.sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(lap.timeMs, 3);
      for (const s of lap.sectors) expect(s).toBeGreaterThan(lap.timeMs * 0.15);
      expect(lap.maxSpeed * 3.6).toBeLessThanOrEqual(c.vmaxKmh + 5);
      expect(lap.maxLean).toBeGreaterThan(35);
      expect(lap.maxLean).toBeLessThanOrEqual(62);
      const a = analyzeLap(lap.points, model.racingLine, model.proj);
      expect(a.avgDeviationM).toBeGreaterThan(0.3);
      expect(a.avgDeviationM).toBeLessThan(4);
      expect(a.distanceM).toBeGreaterThan(c.lengthM * 0.96);
      const vmin = Math.min(...a.trace.map((d) => d.v)) * 3.6;
      expect(vmin).toBeGreaterThan(65);
      if (hz === 1 && lap.number === 1)
        console.log(c.id.padEnd(10), (lap.timeMs / 1000).toFixed(3), lap.sectors.map((s) => (s / 1000).toFixed(2)).join('/'),
          'v', vmin.toFixed(0), '-', a.maxSpeedKmh.toFixed(0), 'lean', lap.maxLean.toFixed(0), 'dev', a.avgDeviationM.toFixed(2));
    }
  });
});
