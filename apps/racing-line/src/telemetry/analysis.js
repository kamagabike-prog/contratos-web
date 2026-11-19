// Métricas de vuelta: velocidad máxima, desviación respecto a la trazada ideal.

import { dist, distanceToPolyline, pointSegment } from '../geo/geometry.js';

/**
 * Busca la distancia a la trazada ideal con una ventana alrededor del último
 * índice encontrado (O(n·w) en lugar de O(n²)); si la ventana falla, hace
 * búsqueda completa.
 */
function makeMatcher(line) {
  const n = line.length;
  let last = -1;
  return (p) => {
    if (last < 0) {
      const r = distanceToPolyline(p, line, true);
      last = r.index;
      return r;
    }
    let best = { d: Infinity, index: last, signed: 0 };
    for (let k = -15; k <= 40; k++) {
      const i = (last + k + n) % n;
      const a = line[i];
      const b = line[(i + 1) % n];
      const r = pointSegment(p, a, b);
      if (r.d < best.d) {
        const side = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
        best = { d: r.d, index: i, signed: side >= 0 ? r.d : -r.d };
      }
    }
    if (best.d > 25) best = distanceToPolyline(p, line, true);
    last = best.index;
    return best;
  };
}

/**
 * @param {{x:number,y:number,t:number,v:number|null}[]} points  puntos de la vuelta (plano local)
 * @param {{x:number,y:number}[]} racingLine
 */
export function analyzeLap(points, racingLine) {
  const match = makeMatcher(racingLine);
  let maxV = 0;
  let sumDev = 0;
  let maxDev = 0;
  let distance = 0;
  const trace = []; // [{s, v, dev}] para gráficas
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (i > 0) distance += dist(points[i - 1], p);
    let v = p.v;
    if (v == null && i > 0) {
      const dt = (p.t - points[i - 1].t) / 1000;
      v = dt > 0 ? dist(points[i - 1], p) / dt : 0;
    }
    if (v != null && v > maxV) maxV = v;
    const m = match(p);
    sumDev += m.d;
    if (m.d > maxDev) maxDev = m.d;
    trace.push({ s: distance, v: v ?? 0, dev: m.signed, i });
  }
  return {
    maxSpeedKmh: maxV * 3.6,
    avgDeviationM: points.length ? sumDev / points.length : 0,
    maxDeviationM: maxDev,
    distanceM: distance,
    trace,
  };
}
