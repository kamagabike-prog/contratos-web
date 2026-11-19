// Métricas de vuelta: velocidad máxima, inclinación máxima y desviación
// respecto a la trazada ideal.
//
// Desviación: para cada punto rojo (trazada del piloto suavizada con
// Catmull-Rom) se busca el segmento verde más cercano, se obtiene el punto
// proyectado sobre él y la distancia entre ambos se mide con la fórmula de
// Haversine sobre sus coordenadas GPS.

import { dist, pointSegment, smoothTrace } from '../geo/geometry.js';
import { haversine } from '../geo/projection.js';

/**
 * Busca el segmento verde más cercano con una ventana alrededor del último
 * índice (O(n·w) en lugar de O(n²)); si la ventana falla, búsqueda completa.
 */
function makeMatcher(line) {
  const n = line.length;
  let last = -1;
  const test = (p, i, best) => {
    const a = line[i];
    const b = line[(i + 1) % n];
    const r = pointSegment(p, a, b);
    if (r.d < best.d) {
      const side = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
      return { d: r.d, index: i, proj: r.proj, side: side >= 0 ? 1 : -1 };
    }
    return best;
  };
  return (p) => {
    let best = { d: Infinity, index: last, proj: null, side: 1 };
    if (last >= 0) {
      for (let k = -15; k <= 40; k++) best = test(p, (last + k + n) % n, best);
    }
    if (best.d > 25) {
      best = { d: Infinity, index: -1, proj: null, side: 1 };
      for (let i = 0; i < n; i++) best = test(p, i, best);
    }
    last = best.index;
    return best;
  };
}

/**
 * @param {{x:number,y:number,t:number,v:number|null,lean?:number|null}[]} points  vuelta (plano local)
 * @param {{x:number,y:number}[]} racingLine
 * @param {{toLatLon:Function}} proj  proyección del circuito (para Haversine)
 */
export function analyzeLap(points, racingLine, proj) {
  const smooth = smoothTrace(points);
  const match = makeMatcher(racingLine);
  let maxV = 0;
  let maxLean = null;
  let sumDev = 0;
  let maxDev = 0;
  let distance = 0;
  const trace = []; // [{s, v, dev, lean, i}] para gráficas
  for (let i = 0; i < smooth.length; i++) {
    const p = smooth[i];
    if (i > 0) distance += dist(smooth[i - 1], p);
    let v = p.v;
    if (v == null && i > 0) {
      const dt = (p.t - smooth[i - 1].t) / 1000;
      v = dt > 0 ? dist(smooth[i - 1], p) / dt : 0;
    }
    if (v != null && v > maxV) maxV = v;
    if (p.lean != null && (maxLean == null || Math.abs(p.lean) > maxLean)) maxLean = Math.abs(p.lean);

    const m = match(p);
    const a = proj.toLatLon(p.x, p.y);
    const b = proj.toLatLon(m.proj.x, m.proj.y);
    const d = haversine(a.lat, a.lon, b.lat, b.lon);
    sumDev += d;
    if (d > maxDev) maxDev = d;
    trace.push({ s: distance, v: v ?? 0, dev: m.side * d, lean: p.lean ?? null, x: p.x, y: p.y });
  }
  return {
    maxSpeedKmh: maxV * 3.6,
    maxLeanDeg: maxLean,
    avgDeviationM: smooth.length ? sumDev / smooth.length : 0,
    maxDeviationM: maxDev,
    distanceM: distance,
    smooth,
    trace,
  };
}
