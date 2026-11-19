// Genera src/data/trackGeometry.js con las líneas centrales GPS de los circuitos.
//
//  · Montmeló: geometría REAL (GeoJSON de bacinger/f1-circuits, licencia MIT),
//    suavizada con Catmull-Rom y remuestreada cada 6 m.
//  · Aragón, Navarra, Albacete, Almería y Cartagena: trazados REPRESENTATIVOS
//    (centro, longitud y sentido aproximados) listos para sustituir.
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
  curvatureClosed,
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
  aragon: {
    center: { lat: 41.0780, lon: -0.2030 },
    length: 5077,
    rotationDeg: 0,
    clockwise: false,
    ctrl: [
      [0, 0], [300, 0], [600, 0], [760, 30], [800, 120], [720, 180], [600, 170],
      [520, 230], [560, 330], [700, 380], [820, 460], [800, 560], [650, 600],
      [400, 580], [200, 620], [0, 640], [-150, 600], [-200, 500], [-120, 420],
      [-160, 330], [-260, 280], [-300, 180], [-220, 80], [-120, 20],
    ],
  },
  navarra: {
    center: { lat: 42.5605, lon: -2.1623 },
    length: 3933,
    rotationDeg: 0,
    clockwise: true,
    ctrl: [
      [0, 0], [300, 0], [480, -20], [540, -100], [480, -170], [380, -160], [300, -220],
      [340, -320], [460, -360], [500, -450], [400, -520], [200, -500], [60, -430],
      [-80, -470], [-200, -420], [-220, -300], [-120, -230], [-180, -140], [-150, -40],
    ],
  },
  albacete: {
    center: { lat: 38.9573, lon: -1.7920 },
    length: 3539,
    rotationDeg: 0,
    clockwise: true,
    ctrl: [
      [0, 0], [350, 0], [520, -30], [560, -120], [460, -180], [300, -170], [200, -240],
      [260, -340], [200, -420], [0, -430], [-150, -380], [-200, -260], [-140, -160],
      [-200, -80], [-130, -10],
    ],
  },
  almeria: {
    center: { lat: 37.0234, lon: -2.3606 },
    length: 3389,
    rotationDeg: 0,
    clockwise: true,
    ctrl: [
      [0, 0], [280, 10], [420, -40], [430, -140], [330, -170], [250, -120], [170, -170],
      [200, -280], [120, -360], [-20, -330], [-60, -230], [-160, -260], [-250, -200],
      [-220, -90], [-120, -20],
    ],
  },
  cartagena: {
    center: { lat: 37.6346, lon: -1.0129 },
    length: 3545,
    rotationDeg: 0,
    clockwise: true,
    ctrl: [
      [0, 0], [320, 0], [470, -50], [480, -150], [380, -200], [280, -160], [200, -230],
      [240, -330], [150, -400], [20, -360], [-40, -260], [-140, -300], [-230, -230],
      [-200, -120], [-240, -40], [-140, 10],
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

const tracks = {
  jerez: { geo: fromControlPoints(APPROX.jerez), width: 12, source: 'aproximación' },
  montmelo: {
    geo: fromGeoJSON('./source-f1-circuits.geojson', 'es-1991'),
    width: 12,
    source: 'GPS real · bacinger/f1-circuits (MIT)',
  },
  cheste: { geo: fromControlPoints(APPROX.cheste), width: 12, source: 'aproximación' },
  aragon: { geo: fromControlPoints(APPROX.aragon), width: 15, source: 'representativo (rellenar)' },
  navarra: { geo: fromControlPoints(APPROX.navarra), width: 12, source: 'representativo (rellenar)' },
  albacete: { geo: fromControlPoints(APPROX.albacete), width: 12, source: 'representativo (rellenar)' },
  almeria: { geo: fromControlPoints(APPROX.almeria), width: 12, source: 'representativo (rellenar)' },
  cartagena: { geo: fromControlPoints(APPROX.cartagena), width: 12, source: 'representativo (rellenar)' },
};

/** Línea de cronometraje perpendicular a la pista en el índice i. */
function timingLine(latlon, width, i) {
  const lat0 = latlon[i].lat;
  const lon0 = latlon[i].lon;
  const proj = createProjection(lat0, lon0);
  const xy = latlon.map((c) => proj.toXY(c.lat, c.lon));
  const nrm = normalsClosed(xy)[i];
  const half = width / 2 + 8;
  const a = proj.toLatLon(nrm.x * half, nrm.y * half);
  const b = proj.toLatLon(-nrm.x * half, -nrm.y * half);
  return [a, b].map((p) => [round(p.lat), round(p.lon)]);
}

/** Índice de parcial: el tramo más recto cerca de la fracción `f` de la vuelta. */
function splitIndex(latlon, f) {
  const proj = createProjection(latlon[0].lat, latlon[0].lon);
  const xy = latlon.map((c) => proj.toXY(c.lat, c.lon));
  const k = curvatureClosed(xy);
  const n = xy.length;
  const c = Math.round(n * f);
  const win = Math.round(n * 0.07);
  let best = c;
  let bestK = Infinity;
  for (let i = c - win; i <= c + win; i++) {
    let s = 0;
    for (let j = -5; j <= 5; j++) s += Math.abs(k[(i + j + n) % n]);
    if (s < bestK) {
      bestK = s;
      best = i;
    }
  }
  return (best + n) % n;
}

const round = (v) => Math.round(v * 1e6) / 1e6;

let out = `// ARCHIVO GENERADO por scripts/build-circuits.mjs — no editar a mano.\n`;
out += `// Líneas centrales [lat, lon] (WGS84) equiespaciadas ~${STEP} m en sentido de marcha.\n`;
out += `// timing: [meta, T1, T2] → la vuelta se divide en 3 sectores (T1, T2, T3 = meta).\n\n`;
out += `export const GEOMETRY = {\n`;
for (const [id, t] of Object.entries(tracks)) {
  const i1 = splitIndex(t.geo, 1 / 3);
  const i2 = splitIndex(t.geo, 2 / 3);
  const finish = timingLine(t.geo, t.width, 0);
  const t1 = timingLine(t.geo, t.width, i1);
  const t2 = timingLine(t.geo, t.width, i2);
  out += `  // ${t.geo.length} puntos · fuente: ${t.source}\n`;
  out += `  ${id}: {\n    source: ${JSON.stringify(t.source)},\n`;
  out += `    finishLine: ${JSON.stringify(finish)},\n`;
  out += `    sectorLines: ${JSON.stringify([t1, t2])},\n`;
  out += `    centerline: [\n`;
  const rows = t.geo.map((p) => `[${round(p.lat)},${round(p.lon)}]`);
  for (let i = 0; i < rows.length; i += 6) out += '      ' + rows.slice(i, i + 6).join(',') + ',\n';
  out += `    ],\n  },\n`;
  console.log(id.padEnd(10), String(t.geo.length).padStart(4), 'pts', 'T1@', i1, 'T2@', i2);
}
out += `};\n`;
writeFileSync(new URL('../src/data/trackGeometry.js', import.meta.url), out);
console.log('OK → src/data/trackGeometry.js');
