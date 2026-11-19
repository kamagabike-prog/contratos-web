// Lectores de los formatos que exportan los GPS / data-loggers de moto.
//
//   · GPX        (.gpx)               — casi todos (RaceBox, Garmin, apps)
//   · NMEA 0183  (.nmea .nma .log .txt) — registros en bruto de receptores y loggers
//   · VBO        (.vbo)               — Racelogic VBOX y compatibles
//   · CSV        (.csv)               — RaceChrono y CSV genéricos con lat/lon/tiempo
//   · JSON       (.json)              — sesiones exportadas por Track Instructor
//
// Todos producen una lista de fixes { lat, lon, t (ms), speed (m/s) | null }
// que se cronometran igual que una tanda grabada en vivo.

import { NmeaAssembler, LineSplitter } from '../telemetry/nmea.js';
import { parseGPX } from './exportImport.js';

export const IMPORT_EXTENSIONS = ['gpx', 'nmea', 'nma', 'log', 'txt', 'vbo', 'csv', 'json'];
export const IMPORT_ACCEPT = IMPORT_EXTENSIONS.map((e) => `.${e}`).join(',');

/** Formato a partir del nombre y del contenido. */
export function detectFormat(name = '', text = '') {
  const ext = (name.match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const head = text.slice(0, 4000).trimStart();
  if (ext === 'json' || head.startsWith('{') || head.startsWith('[')) return 'json';
  if (ext === 'gpx' || /^<\?xml|^<gpx/i.test(head)) return 'gpx';
  if (ext === 'vbo' || /^File created on|\[header\]/im.test(head)) return 'vbo';
  if (/\$[A-Z]{2}(RMC|GGA)\b/.test(head)) return 'nmea';
  if (ext === 'csv' || /lat/i.test(head.split('\n').find((l) => /lon|lng/i.test(l)) ?? '')) return 'csv';
  if (['nmea', 'nma', 'log', 'txt'].includes(ext)) return 'nmea';
  return null;
}

const sortFixes = (fixes) =>
  fixes
    .filter((f) => Number.isFinite(f.lat) && Number.isFinite(f.lon) && Number.isFinite(f.t) && Math.abs(f.lat) <= 90 && Math.abs(f.lon) <= 180 && (f.lat || f.lon))
    .sort((a, b) => a.t - b.t);

// ------------------------------------------------------------------ NMEA

/** Registro NMEA (texto con frases RMC/GGA…). */
export function parseNMEALog(text) {
  // Para logs solo-GGA sin fecha se usa la fecha actual (las vueltas no dependen del día).
  const asm = new NmeaAssembler({ now: () => Date.now() });
  const lines = new LineSplitter(1 << 20).push(text + '\n');
  const fixes = [];
  for (const l of lines) {
    const f = asm.push(l);
    if (f) fixes.push({ lat: f.lat, lon: f.lon, t: f.t, speed: f.speed, accuracy: f.accuracy });
  }
  return sortFixes(fixes);
}

// ------------------------------------------------------------------ VBO

/**
 * VBO de Racelogic: secciones [header], [column names], [data]. Latitud y
 * longitud en MINUTOS (longitud positiva = OESTE), hora UTC hhmmss.ss,
 * velocidad en km/h. La fecha sale de "File created on dd/mm/yyyy".
 */
export function parseVBO(text) {
  const lines = text.split(/\r?\n/);
  let day = null;
  const created = /File created on\s+(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})/i.exec(text);
  if (created) {
    const y = Number(created[3]) < 100 ? 2000 + Number(created[3]) : Number(created[3]);
    day = Date.UTC(y, Number(created[2]) - 1, Number(created[1]));
  }
  if (day == null) day = Math.floor(Date.now() / 86400000) * 86400000;

  let section = '';
  let cols = null;
  const fixes = [];
  let lastTod = -1;
  let dayOffset = 0;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const sec = /^\[(.+)\]$/.exec(line);
    if (sec) {
      section = sec[1].toLowerCase();
      continue;
    }
    if (section === 'column names') {
      cols = line.split(/\s+/).map((c) => c.toLowerCase());
      continue;
    }
    if (section !== 'data' || !cols) continue;
    const v = line.split(/\s+/);
    const get = (name) => {
      const i = cols.indexOf(name);
      return i >= 0 ? v[i] : undefined;
    };
    const time = get('time');
    const m = /^(\d{2})(\d{2})(\d{2}(?:\.\d+)?)$/.exec(time || '');
    if (!m) continue;
    const tod = (Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])) * 1000;
    if (tod < lastTod - 12 * 3600000) dayOffset += 86400000; // cruce de medianoche
    lastTod = tod;
    const latMin = Number(get('lat'));
    const lonMin = Number(get('long') ?? get('lon'));
    const kmh = Number(get('velocity') ?? get('speed'));
    fixes.push({
      lat: latMin / 60,
      lon: -lonMin / 60,
      t: day + dayOffset + tod,
      speed: Number.isFinite(kmh) ? kmh / 3.6 : null,
    });
  }
  return sortFixes(fixes);
}

// ------------------------------------------------------------------ CSV

const norm = (s) => s.toLowerCase().replace(/["']/g, '').trim();

/**
 * CSV con cabecera: busca columnas de latitud, longitud, tiempo y velocidad
 * (RaceChrono: "Time (s)", "Latitude (deg)", "Longitude (deg)", "Speed (m/s)").
 * Tiempo admitido: epoch en s o ms, ISO 8601, hh:mm:ss(.sss) o segundos relativos.
 */
export function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const delim = (lines.find((l) => /lat/i.test(l)) ?? lines[0] ?? '').split(';').length > (lines[0] ?? '').split(',').length ? ';' : ',';
  const split = (l) => l.split(delim).map((c) => c.trim());
  const hi = lines.findIndex((l) => {
    const c = split(l).map(norm);
    return c.some((x) => /^lat/.test(x)) && c.some((x) => /^(lon|lng|long)/.test(x));
  });
  if (hi < 0) throw new Error('El CSV no tiene columnas de latitud y longitud');
  const head = split(lines[hi]).map(norm);
  const find = (re) => head.findIndex((h) => re.test(h));
  const iLat = find(/^lat/);
  const iLon = find(/^(lon|lng|long)/);
  const iTime = find(/^(timestamp|time|utc|date ?time|t_ms|t \(|elapsed)/);
  const iSpeed = find(/^(speed|velocity|vel)/);
  const speedUnit = iSpeed >= 0 ? head[iSpeed] : '';
  const toMs = speedUnit.includes('km') || speedUnit.includes('kph') ? 1 / 3.6 : speedUnit.includes('mph') ? 0.44704 : speedUnit.includes('kn') ? 0.514444 : 1;
  const timeHead = iTime >= 0 ? head[iTime] : '';
  const today = Math.floor(Date.now() / 86400000) * 86400000;

  const parseTime = (s, rowIndex) => {
    if (iTime < 0) return rowIndex * 100; // sin tiempo: suponemos 10 Hz
    if (s == null || s === '') return NaN;
    const n = Number(s);
    if (Number.isFinite(n)) {
      if (timeHead.includes('ms')) return n; // ya en ms
      if (n > 1e11) return n; // epoch ms
      if (n > 1e8) return n * 1000; // epoch s
      return n * 1000; // segundos relativos
    }
    const hms = /^(\d{1,2}):(\d{2}):(\d{2}(?:\.\d+)?)$/.exec(s);
    if (hms) return today + (Number(hms[1]) * 3600 + Number(hms[2]) * 60 + Number(hms[3])) * 1000;
    const d = Date.parse(s);
    return Number.isFinite(d) ? d : NaN;
  };

  const fixes = [];
  for (let r = hi + 1; r < lines.length; r++) {
    const c = split(lines[r]);
    const lat = Number(c[iLat]);
    const lon = Number(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue; // filas de unidades o vacías
    const sp = iSpeed >= 0 ? Number(c[iSpeed]) : NaN;
    fixes.push({ lat, lon, t: parseTime(c[iTime], r - hi - 1), speed: Number.isFinite(sp) ? sp * toMs : null });
  }
  return sortFixes(fixes);
}

// ------------------------------------------------------------------ común

/** Texto de un archivo → { format, fixes } (no aplica a JSON de sesión). */
export function fixesFromText(name, text) {
  const format = detectFormat(name, text);
  if (!format) throw new Error(`Formato no reconocido: ${name}`);
  if (format === 'json') return { format, fixes: null };
  const fixes = format === 'gpx' ? parseGPX(text) : format === 'vbo' ? parseVBO(text) : format === 'csv' ? parseCSV(text) : parseNMEALog(text);
  if (fixes.length < 10) throw new Error(`${name}: no contiene puntos GPS válidos`);
  return { format, fixes };
}
