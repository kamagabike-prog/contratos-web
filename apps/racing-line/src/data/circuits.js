// Base de datos de circuitos de velocidad de España.
//
// Cada circuito con geometría almacena:
//   · centerline  — línea central GPS [lat, lon] en sentido de marcha
//   · width       — ancho de pista (m) → define el polígono de pista
//   · finishLine  — segmento virtual de meta (2 coordenadas GPS)
// La Trazada Ideal se calcula a partir de la geometría (ver geo/racingLine.js)
// y se cachea en memoria.

import {
  jerezCenterline,
  jerezFinishLine,
  montmeloCenterline,
  montmeloFinishLine,
  chesteCenterline,
  chesteFinishLine,
} from './trackGeometry.js';
import { createProjection } from '../geo/projection.js';
import { curvatureClosed, normalsClosed, offsetClosed, polylineLength } from '../geo/geometry.js';
import { computeRacingLine } from '../geo/racingLine.js';

export const CIRCUITS = [
  {
    id: 'jerez',
    name: 'Circuito de Jerez – Ángel Nieto',
    short: 'Jerez',
    location: 'Jerez de la Frontera, Cádiz',
    lengthM: 4423,
    turns: 13,
    direction: 'Horario',
    width: 12,
    center: [36.7086, -6.0342],
    centerline: jerezCenterline,
    finishLine: jerezFinishLine,
    dataQuality: 'aprox',
    vmaxKmh: 270,
  },
  {
    id: 'montmelo',
    name: 'Circuit de Barcelona-Catalunya',
    short: 'Montmeló',
    location: 'Montmeló, Barcelona',
    lengthM: 4657,
    turns: 14,
    direction: 'Horario',
    width: 12,
    center: [41.5700, 2.2611],
    centerline: montmeloCenterline,
    finishLine: montmeloFinishLine,
    dataQuality: 'real',
    vmaxKmh: 300,
  },
  {
    id: 'cheste',
    name: 'Circuit Ricardo Tormo',
    short: 'Cheste',
    location: 'Cheste, Valencia',
    lengthM: 4005,
    turns: 14,
    direction: 'Antihorario',
    width: 12,
    center: [39.4889, -0.6283],
    centerline: chesteCenterline,
    finishLine: chesteFinishLine,
    dataQuality: 'aprox',
    vmaxKmh: 290,
  },
  // Circuitos pendientes de geometría: graba una vuelta o importa un GeoJSON.
  { id: 'aragon', name: 'MotorLand Aragón', short: 'Aragón', location: 'Alcañiz, Teruel', lengthM: 5077, turns: 17, direction: 'Antihorario', center: [41.0784, -0.2034] },
  { id: 'navarra', name: 'Circuito de Navarra', short: 'Navarra', location: 'Los Arcos, Navarra', lengthM: 3933, turns: 15, direction: 'Horario', center: [42.5620, -2.1606] },
  { id: 'albacete', name: 'Circuito de Albacete', short: 'Albacete', location: 'Albacete', lengthM: 3539, turns: 9, direction: 'Horario', center: [38.9586, -1.7894] },
  { id: 'almeria', name: 'Circuito de Almería', short: 'Almería', location: 'Tabernas, Almería', lengthM: 3389, turns: 15, direction: 'Horario', center: [37.0310, -2.3686] },
];

export const getCircuit = (id) => CIRCUITS.find((c) => c.id === id);
export const hasGeometry = (c) => Array.isArray(c?.centerline);

const cache = new Map();

/**
 * Prepara la geometría de un circuito en el plano local (metros):
 * línea central, bordes, pianos, trazada ideal y línea de meta.
 */
export function getTrackModel(circuit) {
  if (cache.has(circuit.id)) return cache.get(circuit.id);
  const [lat0, lon0] = circuit.center;
  const proj = createProjection(lat0, lon0);
  const center = circuit.centerline.map(([lat, lon]) => proj.toXY(lat, lon));
  const normals = normalsClosed(center);
  const half = circuit.width / 2;
  const leftEdge = offsetClosed(center, half, normals);
  const rightEdge = offsetClosed(center, -half, normals);
  const curvature = curvatureClosed(center);
  const racing = computeRacingLine(center, circuit.width);
  const finish = circuit.finishLine.map(([lat, lon]) => proj.toXY(lat, lon));
  const forward = { x: center[1].x - center[0].x, y: center[1].y - center[0].y };

  const model = {
    id: circuit.id,
    width: circuit.width,
    proj,
    center,
    normals,
    leftEdge,
    rightEdge,
    curvature,
    kerbs: computeKerbs(center, normals, curvature, half),
    racingLine: racing.points,
    racingOffsets: racing.offsets,
    finish,
    forward,
    length: polylineLength(center, true),
  };
  cache.set(circuit.id, model);
  return model;
}

/**
 * Pianos: tramos de alta curvatura. Se dibujan en el borde interior
 * (y uno corto en el exterior a la salida) como en un circuito real.
 */
function computeKerbs(center, normals, curvature, half) {
  const n = center.length;
  const TH = 1 / 90; // radio < 90 m → curva con piano
  const smooth = curvature.map((_, i) => {
    let s = 0;
    for (let k = -3; k <= 3; k++) s += curvature[(i + k + n) % n];
    return s / 7;
  });
  const runs = [];
  let cur = null;
  for (let i = 0; i < n; i++) {
    const k = smooth[i];
    const side = Math.sign(k);
    if (Math.abs(k) > TH) {
      if (cur && cur.side === side && cur.end === i - 1) cur.end = i;
      else {
        cur = { start: i, end: i, side };
        runs.push(cur);
      }
    }
  }
  return runs
    .filter((r) => r.end - r.start >= 2)
    .map((r) => {
      const pts = [];
      for (let i = r.start - 1; i <= r.end + 1; i++) {
        const j = (i + n) % n;
        const off = r.side * (half + 0.6);
        pts.push({ x: center[j].x + normals[j].x * off, y: center[j].y + normals[j].y * off });
      }
      // piano exterior a la salida de la curva
      const outer = [];
      for (let i = r.end - 2; i <= r.end + 6; i++) {
        const j = (i + n) % n;
        const off = -r.side * (half + 0.6);
        outer.push({ x: center[j].x + normals[j].x * off, y: center[j].y + normals[j].y * off });
      }
      return { inner: pts, outer };
    });
}
