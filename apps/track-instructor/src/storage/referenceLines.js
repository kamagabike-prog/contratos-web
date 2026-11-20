// Trazada de referencia por circuito: una vuelta REAL (la mejor tuya, la de
// un instructor o la de un piloto rápido importada en GPX) que sustituye a la
// trazada calculada por mínima curvatura como línea verde y como base de la
// desviación. Se guarda en el plano local del circuito.

import { resampleClosed } from '../geo/geometry.js';

const KEY = 'racing-line:reference-lines';
const listeners = new Set();

function readAll() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}');
    return d && typeof d === 'object' ? d : {};
  } catch {
    return {};
  }
}

function writeAll(d) {
  try {
    localStorage.setItem(KEY, JSON.stringify(d));
  } catch {
    /* sin almacenamiento */
  }
  listeners.forEach((fn) => fn());
}

/** Avisa cuando cambia alguna referencia (para refrescar mapas abiertos). */
export function onReferenceChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/**
 * Convierte los puntos de una vuelta (cerrada en meta) en una línea cerrada
 * equiespaciada, apta para dibujar y medir desviaciones.
 */
export function lapToReferenceLine(points, step = 4) {
  const pts = points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length < 20) throw new Error('La vuelta tiene muy pocos puntos para usarla de referencia');
  // quitar el último punto si coincide con el primero (cruce de meta)
  const ring = Math.hypot(pts[0].x - pts.at(-1).x, pts[0].y - pts.at(-1).y) < 1 ? pts.slice(0, -1) : pts;
  return resampleClosed(ring, step);
}

/** @returns {{points:{x,y}[], label:string, timeMs:number|null, savedAt:number} | null} */
export function getReferenceLine(circuitId) {
  const r = readAll()[circuitId];
  if (!r || !Array.isArray(r.pts) || r.pts.length < 20) return null;
  return { points: r.pts.map(([x, y]) => ({ x, y })), label: r.label, timeMs: r.timeMs ?? null, savedAt: r.savedAt };
}

export function setReferenceLine(circuitId, points, { label, timeMs = null } = {}) {
  const line = lapToReferenceLine(points);
  const d = readAll();
  d[circuitId] = {
    pts: line.map((p) => [Math.round(p.x * 100) / 100, Math.round(p.y * 100) / 100]),
    label: label || 'Vuelta de referencia',
    timeMs,
    savedAt: Date.now(),
  };
  writeAll(d);
}

export function clearReferenceLine(circuitId) {
  const d = readAll();
  delete d[circuitId];
  writeAll(d);
}
