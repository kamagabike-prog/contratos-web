// Exportación (GPX / CSV / JSON) e importación (JSON / GPX) de sesiones.
//
// Los puntos se guardan en el plano local del circuito (metros); para GPX/CSV
// se convierten a lat/lon con la proyección del modelo (model.proj.toLatLon).
// Un GPX importado se pasa por el LapTimer para cortar las vueltas y se guarda
// con el mismo formato de sesión que LiveView (packLap).

import { CIRCUITS, getTrackModel, hasGeometry } from '../data/circuits.js';
import { haversine } from '../geo/projection.js';
import { LapTimer } from '../telemetry/lapTimer.js';
import { packLap, saveSession } from '../storage/sessions.js';

export const SESSION_FORMAT = 'racing-line-session';

const xmlEscape = (s) =>
  String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c]);

const isoTime = (t) => new Date(Math.round(t)).toISOString();

// ------------------------------------------------------------------ GPX

/**
 * GPX 1.1 a partir de fixes {lat, lon, t, speed?, lean?}. La velocidad (m/s) y
 * la inclinación (°) van en <extensions>.
 */
export function fixesToGPX(fixes, { name = 'Racing Line' } = {}) {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Racing Line" xmlns="http://www.topografix.com/GPX/1/1">',
    `  <metadata><name>${xmlEscape(name)}</name>${fixes.length ? `<time>${isoTime(fixes[0].t)}</time>` : ''}</metadata>`,
    `  <trk><name>${xmlEscape(name)}</name><trkseg>`,
  ];
  for (const f of fixes) {
    const ext = [];
    if (f.speed != null && Number.isFinite(f.speed)) ext.push(`<speed>${f.speed.toFixed(2)}</speed>`);
    if (f.lean != null && Number.isFinite(f.lean)) ext.push(`<lean>${f.lean.toFixed(1)}</lean>`);
    lines.push(
      `    <trkpt lat="${f.lat.toFixed(7)}" lon="${f.lon.toFixed(7)}"><time>${isoTime(f.t)}</time>` +
        (ext.length ? `<extensions>${ext.join('')}</extensions>` : '') +
        '</trkpt>'
    );
  }
  lines.push('  </trkseg></trk>', '</gpx>', '');
  return lines.join('\n');
}

/** Puntos de una vuelta (plano local) → fixes lat/lon. */
export function lapToFixes(points, proj) {
  return points.map((p) => {
    const { lat, lon } = proj.toLatLon(p.x, p.y);
    return { lat, lon, t: p.t, speed: p.v ?? null, lean: p.lean ?? null };
  });
}

/** GPX de una vuelta (puntos GPS originales, sin suavizar). */
export function lapToGPX(lap, proj, opts) {
  return fixesToGPX(lapToFixes(lap.points, proj), opts);
}

const num = (s) => {
  if (s == null || s === '') return null;
  const v = parseFloat(s);
  return Number.isFinite(v) ? v : null;
};

/** Parser con DOMParser (navegador / jsdom). */
function parseGPXDom(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('GPX no válido (XML mal formado)');
  const pts = doc.getElementsByTagNameNS('*', 'trkpt');
  const child = (el, local) => {
    const list = el.getElementsByTagNameNS('*', local);
    return list.length ? list[0].textContent.trim() : null;
  };
  const out = [];
  for (const el of pts) {
    out.push({
      lat: num(el.getAttribute('lat')),
      lon: num(el.getAttribute('lon')),
      time: child(el, 'time'),
      speed: num(child(el, 'speed')),
      lean: num(child(el, 'lean')),
    });
  }
  return out;
}

/** Parser mínimo por expresiones regulares (Node sin DOM). */
export function parseGPXRegex(text) {
  const out = [];
  const re = /<(?:\w+:)?trkpt\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?trkpt>)/g;
  const attr = (a, n) => (a.match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`)) || [])[1];
  const tag = (b, n) => (b.match(new RegExp(`<(?:\\w+:)?${n}\\b[^>]*>([^<]*)<`)) || [])[1]?.trim() ?? null;
  let m;
  while ((m = re.exec(text))) {
    const body = m[2] || '';
    out.push({
      lat: num(attr(m[1], 'lat')),
      lon: num(attr(m[1], 'lon')),
      time: tag(body, 'time'),
      speed: num(tag(body, 'speed')),
      lean: num(tag(body, 'lean')),
    });
  }
  return out;
}

/**
 * GPX → fixes {lat, lon, t, speed, lean} ordenados por tiempo. Si el GPX no
 * trae velocidad se estima con Haversine entre fixes consecutivos.
 */
export function parseGPX(text) {
  const raw = typeof DOMParser !== 'undefined' ? parseGPXDom(text) : parseGPXRegex(text);
  const fixes = raw
    .map((r) => ({ lat: r.lat, lon: r.lon, t: r.time ? Date.parse(r.time) : NaN, speed: r.speed, lean: r.lean }))
    .filter((f) => f.lat != null && f.lon != null);
  if (!fixes.length) throw new Error('El GPX no contiene puntos de track (trkpt)');
  if (fixes.some((f) => !Number.isFinite(f.t))) throw new Error('El GPX no tiene marcas de tiempo en todos los puntos: no se pueden cronometrar vueltas');
  fixes.sort((a, b) => a.t - b.t);
  const hasSpeed = fixes.some((f) => f.speed != null);
  if (!hasSpeed) {
    for (let i = 0; i < fixes.length; i++) {
      const a = fixes[Math.max(0, i - 1)];
      const b = fixes[Math.min(fixes.length - 1, i + 1)];
      const dt = (b.t - a.t) / 1000;
      fixes[i].speed = dt > 0 ? haversine(a.lat, a.lon, b.lat, b.lon) / dt : null;
    }
  }
  return fixes;
}

/** Circuito (con geometría) cuyo centro está más cerca de la nube de fixes. */
export function detectCircuit(fixes, circuits = CIRCUITS, maxKm = 10) {
  if (!fixes.length) return null;
  const step = Math.max(1, Math.floor(fixes.length / 50));
  let lat = 0;
  let lon = 0;
  let n = 0;
  for (let i = 0; i < fixes.length; i += step) {
    lat += fixes[i].lat;
    lon += fixes[i].lon;
    n++;
  }
  lat /= n;
  lon /= n;
  let best = null;
  let bestD = Infinity;
  for (const c of circuits) {
    if (!hasGeometry(c)) continue;
    const d = haversine(lat, lon, c.center[0], c.center[1]);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return bestD <= maxKm * 1000 ? best : null;
}

const newId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

/** Fixes → sesión (mismo formato que LiveView). Lanza error si no hay vueltas. */
export function sessionFromFixes(fixes, { circuit = detectCircuit(fixes), model, source = 'gpx', name } = {}) {
  if (!circuit) throw new Error('El GPX no corresponde a ningún circuito conocido (centro a más de 10 km)');
  const m = model ?? getTrackModel(circuit);
  const timer = new LapTimer(m);
  for (const f of fixes) timer.push(f);
  if (!timer.laps.length) throw new Error(`No se ha detectado ninguna vuelta completa en ${circuit.short ?? circuit.name}`);
  const gaps = fixes.slice(1, 200).map((f, i) => f.t - fixes[i].t).filter((d) => d > 0).sort((a, b) => a - b);
  const medianDt = gaps.length ? gaps[gaps.length >> 1] : null;
  return {
    id: newId(),
    circuitId: circuit.id,
    createdAt: fixes[0].t,
    source,
    gpsHz: medianDt ? Math.round((1000 / medianDt) * 10) / 10 : null,
    ...(name ? { name } : {}),
    laps: timer.laps.map(packLap),
  };
}

// ------------------------------------------------------------------ CSV

/**
 * CSV de una vuelta analizada (serie suavizada de analyzeLap, que es la que
 * tiene desviación por punto). t_ms relativo al inicio de la vuelta.
 * @param {{smooth:object[], trace:object[]}} stats  resultado de analyzeLap
 */
export function lapToCSV(stats, proj, startT = stats.smooth[0]?.t ?? 0) {
  const rows = ['t_ms,lat,lon,speed_kmh,lean_deg,deviation_m'];
  stats.smooth.forEach((p, i) => {
    const d = stats.trace[i];
    const { lat, lon } = proj.toLatLon(p.x, p.y);
    rows.push(
      [
        Math.round(p.t - startT),
        lat.toFixed(7),
        lon.toFixed(7),
        ((d?.v ?? p.v ?? 0) * 3.6).toFixed(1),
        p.lean == null ? '' : p.lean.toFixed(1),
        d ? d.dev.toFixed(2) : '',
      ].join(',')
    );
  });
  return rows.join('\n') + '\n';
}

// ------------------------------------------------------------------ JSON

export function sessionToJSON(session) {
  return JSON.stringify({ format: SESSION_FORMAT, version: 1, exportedAt: new Date().toISOString(), session }, null, 1);
}

/** Valida y normaliza una sesión importada desde JSON. */
export function sessionFromJSON(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('JSON no válido');
  }
  const s = data?.format === SESSION_FORMAT ? data.session : data;
  if (!s || typeof s !== 'object' || !Array.isArray(s.laps) || !s.circuitId) throw new Error('El JSON no es una sesión de Racing Line');
  if (!CIRCUITS.some((c) => c.id === s.circuitId)) throw new Error(`Circuito desconocido: ${s.circuitId}`);
  if (!s.laps.length || !s.laps.every((l) => Array.isArray(l.pts) && Number.isFinite(l.timeMs))) throw new Error('La sesión no tiene vueltas válidas');
  return { ...s, id: typeof s.id === 'string' && s.id ? s.id : newId(), createdAt: Number.isFinite(s.createdAt) ? s.createdAt : Date.now() };
}

// ------------------------------------------------------------------ navegador

/** Lee un archivo .json / .gpx, crea la sesión y la guarda. Devuelve la sesión. */
export async function importSessionFile(file) {
  const text = await file.text();
  const head = text.slice(0, 500).trimStart();
  const isGpx = /\.gpx$/i.test(file.name) || head.startsWith('<');
  const session = isGpx
    ? sessionFromFixes(parseGPX(text), { name: file.name.replace(/\.[^.]+$/, '') })
    : sessionFromJSON(text);
  await saveSession(session);
  return session;
}

// Extensiones que acepta el sistema de descargas de un Artifact de claude.ai.
const ARTIFACT_EXTS = ['txt', 'json', 'csv', 'md', 'html', 'zip'];

/**
 * Descarga un texto como archivo. Dentro de un Artifact de claude.ai (donde
 * los enlaces <a download> no funcionan) usa la capacidad `downloads`; en la
 * PWA normal, un enlace Blob temporal.
 * @returns {Promise<boolean>} true si se entregó el archivo
 */
export async function downloadText(filename, text, mime = 'text/plain') {
  const claude = typeof window !== 'undefined' ? window.claude : null;
  if (claude?.use) {
    try {
      const downloads = await claude.use('downloads');
      if (downloads) {
        const ext = filename.split('.').pop().toLowerCase();
        // .gpx no está permitido en Artifacts → se guarda como .gpx.txt
        const name = ARTIFACT_EXTS.includes(ext) ? filename : `${filename}.txt`;
        await downloads.save({ filename: name, data: text });
        return true;
      }
    } catch {
      return false; // el usuario canceló o la descarga no está disponible
    }
  }
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

/** Nombre de archivo seguro: racing-jerez-2026-11-19-v3.gpx */
export function exportFilename(circuitId, createdAt, suffix, ext) {
  const d = new Date(createdAt);
  const pad = (n) => String(n).padStart(2, '0');
  const date = Number.isFinite(d.getTime()) ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}` : 'sesion';
  return `racing-${circuitId}-${date}${suffix ? `-${suffix}` : ''}.${ext}`.replace(/[^\w.-]+/g, '_');
}
