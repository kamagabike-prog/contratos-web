// Genera src/data/trackGeometry.js con las líneas centrales GPS de los circuitos.
//
//  · Montmeló: geometría REAL (GeoJSON de bacinger/f1-circuits, licencia MIT),
//    suavizada con Catmull-Rom y remuestreada cada 6 m.
//  · Jerez y Cheste: APROXIMACIÓN construida a partir de puntos de control en
//    metros, anclada en las coordenadas reales del circuito, escalada a la
//    longitud oficial y con el sentido de giro real. Sustitúyela por una vuelta
//    GPS real (o un export de OpenStreetMap) para obtener precisión centimétrica.
//
// Uso: npm run gen:circuits

import { readFileSync, writeFileSync } from 'node:fs';
import { createProjection } from '../src/geo/projection.js';
import {
  catmullRomClosed,
  resampleClosed,
  polylineLength,
  signedArea,
  normalsClosed,
} from '../src/geo/geometry.js';

const STEP = 6; // m entre puntos

// ---------------------------------------------------------------------------
// Puntos de control aproximados (x = Este, y = Norte, metros, sentido de marcha)
// ---------------------------------------------------------------------------
const APPROX = {
  jerez: {
    center: { lat: 36.7086, lon: -6.0342 },
    length: 4423,
    rotationDeg: -12,
    clockwise: true,
    ctrl: [
      [0, 0], [180, 2], [380, 4], [540, 0], // recta de meta
      [610, -20], [635, -75], [600, -125], // C1 Expo 92
      [545, -150], [525, -200], // C2
      [550, -270], [610, -315], [655, -375], // C3 Michelin
      [665, -455], [625, -520], // C4 Sito Pons
      [520, -560], [360, -575], [200, -585], // recta de atrás
      [70, -600], [10, -575], [5, -530], [45, -500], // C6 Dry Sack
      [120, -480], [190, -440], [205, -385], // C7
      [170, -335], [100, -310], // C8-C9 Ferrari / Crivillé
      [10, -290], [-80, -270], [-170, -235], // C10-C11
      [-235, -180], [-250, -110], // C12
      [-215, -45], [-140, -8], [-70, -2], // C13 Lorenzo
    ],
  },
  cheste: {
    center: { lat: 39.4889, lon: -0.6283 },
    length: 4005,
    rotationDeg: 8,
    clockwise: false,
    ctrl: [
      [0, 0], [220, -2], [450, -3], [640, 0], // recta de meta
      [715, 18], [742, 75], [705, 122], // C1 Doohan
      [625, 142], [560, 168], // C2
      [520, 215], [540, 280], // C3
      [505, 330], [440, 315], // C4 Nieto (horquilla)
      [385, 260], [310, 255], // C5
      [250, 300], [215, 365], [150, 378], // C6-C8
      [60, 350], [-30, 340], // contrarrecta
      [-95, 320], [-125, 275], [-105, 235], // C10-C11
      [-60, 200], [-75, 145], // C12-C13
      [-135, 85], [-130, 20], [-75, -5], // C14 Adrián Campos
    ],
  },
};

function fromControlPoints(def) {
  const rot = (def.rotationDeg * Math.PI) / 180;
  let pts = def.ctrl.map(([x, y]) => ({
    x: x * Math.cos(rot) - y * Math.sin(rot),
    y: x * Math.sin(rot) + y * Math.cos(rot),
  }));
  let curve = catmullRomClosed(pts, 30);
  const scale = def.length / polylineLength(curve, true);
  curve = curve.map((p) => ({ x: p.x * scale, y: p.y * scale }));
  // centrar el circuito en su coordenada real
  const cx = curve.reduce((s, p) => s + p.x, 0) / curve.length;
  const cy = curve.reduce((s, p) => s + p.y, 0) / curve.length;
  curve = curve.map((p) => ({ x: p.x - cx, y: p.y - cy }));
  const res = resampleClosed(curve, STEP);
  checkDirection(res, def.clockwise);
  const proj = createProjection(def.center.lat, def.center.lon);
  return res.map((p) => proj.toLatLon(p.x, p.y));
}

function fromGeoJSON(file, id) {
  const gj = JSON.parse(readFileSync(new URL(file, import.meta.url)));
  const f = gj.features.find((x) => x.properties.id === id);
  let coords = f.geometry.coordinates.map(([lon, lat]) => ({ lat, lon }));
  if (coords.length > 1) {
    const a = coords[0];
    const b = coords[coords.length - 1];
    if (a.lat === b.lat && a.lon === b.lon) coords = coords.slice(0, -1);
  }
  const lat0 = coords.reduce((s, c) => s + c.lat, 0) / coords.length;
  const lon0 = coords.reduce((s, c) => s + c.lon, 0) / coords.length;
  const proj = createProjection(lat0, lon0);
  const xy = coords.map((c) => proj.toXY(c.lat, c.lon));
  const smooth = catmullRomClosed(xy, 12);
  const res = resampleClosed(smooth, STEP);
  checkDirection(res, true);
  return res.map((p) => proj.toLatLon(p.x, p.y));
}

function checkDirection(pts, clockwise) {
  const cw = signedArea(pts) < 0;
  if (cw !== clockwise) throw new Error('Sentido de giro inesperado');
}

/** Línea de meta: segmento perpendicular a la pista en el punto 0. */
function finishLine(latlon, width) {
  const lat0 = latlon[0].lat;
  const lon0 = latlon[0].lon;
  const proj = createProjection(lat0, lon0);
  const xy = latlon.map((c) => proj.toXY(c.lat, c.lon));
  const nrm = normalsClosed(xy)[0];
  const half = width / 2 + 8; // un poco más ancha que la pista (pit-lane excluido)
  const a = proj.toLatLon(nrm.x * half, nrm.y * half);
  const b = proj.toLatLon(-nrm.x * half, -nrm.y * half);
  return [a, b].map((p) => [round(p.lat), round(p.lon)]);
}

const round = (v) => Math.round(v * 1e6) / 1e6;

const tracks = {
  jerez: { geo: fromControlPoints(APPROX.jerez), width: 12, source: 'approx' },
  montmelo: {
    geo: fromGeoJSON('./source-f1-circuits.geojson', 'es-1991'),
    width: 12,
    source: 'bacinger/f1-circuits (MIT)',
  },
  cheste: { geo: fromControlPoints(APPROX.cheste), width: 12, source: 'approx' },
};

let out = `// ARCHIVO GENERADO por scripts/build-circuits.mjs — no editar a mano.\n`;
out += `// Líneas centrales en formato [lat, lon] (WGS84), equiespaciadas ~${STEP} m, en sentido de marcha.\n\n`;
for (const [id, t] of Object.entries(tracks)) {
  const fl = finishLine(t.geo, t.width);
  out += `// ${id}: ${t.geo.length} puntos · fuente: ${t.source}\n`;
  out += `export const ${id}FinishLine = ${JSON.stringify(fl)};\n`;
  out += `export const ${id}Centerline = [\n`;
  const rows = t.geo.map((p) => `[${round(p.lat)},${round(p.lon)}]`);
  for (let i = 0; i < rows.length; i += 6) out += '  ' + rows.slice(i, i + 6).join(',') + ',\n';
  out += `];\n\n`;
  console.log(id, t.geo.length, 'pts', 'meta', fl);
}
writeFileSync(new URL('../src/data/trackGeometry.js', import.meta.url), out);
console.log('OK → src/data/trackGeometry.js');
