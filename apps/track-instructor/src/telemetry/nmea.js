// Lector de NMEA 0183 para receptores GPS externos (WiFi: TCP o UDP).
//
// La mayoría de receptores GPS con WiFi (pasarelas ESP32 + u-blox, receptores
// náuticos, data-loggers de circuito) envían frases NMEA 0183 en texto:
//   $GNRMC — posición, velocidad, rumbo, fecha y hora UTC (frase principal)
//   $GNGGA — calidad del fix, nº de satélites, HDOP, altitud
//   $GNGST — error estimado de posición en metros (si el receptor lo da)
//   $GNVTG — rumbo y velocidad (para receptores sin RMC)
// Cualquier talker (GP, GN, GL, GA, BD…) es válido.
//
// El instante de cada fix sale de la hora UTC del propio receptor (con
// décimas/centésimas), no de cuándo llega el paquete por WiFi: así el
// cronometraje no depende de la latencia de la red.

const KNOT = 0.514444; // m/s
const UERE = 2.5; // m por unidad de HDOP (estimación típica sin GST)

/** Checksum NMEA: XOR de los caracteres entre '$' y '*', en hex de 2 dígitos. */
export function checksum(body) {
  let c = 0;
  for (let i = 0; i < body.length; i++) c ^= body.charCodeAt(i);
  return c.toString(16).toUpperCase().padStart(2, '0');
}

/**
 * Valida y trocea una frase. Devuelve { type, talker, f: campos } o null.
 * Si la frase trae checksum (*HH) debe coincidir; sin checksum se acepta.
 */
export function parseSentence(line) {
  if (typeof line !== 'string') return null;
  line = line.trim();
  const start = line.indexOf('$');
  if (start < 0) return null;
  line = line.slice(start + 1);
  let body = line;
  const star = line.indexOf('*');
  if (star >= 0) {
    body = line.slice(0, star);
    const cs = line.slice(star + 1, star + 3).toUpperCase();
    if (cs.length !== 2 || cs !== checksum(body)) return null;
  }
  const f = body.split(',');
  const id = f[0];
  if (!/^[A-Z]{5}$/.test(id) && !/^P[A-Z]{3,}$/.test(id)) return null;
  return { talker: id.slice(0, 2), type: id.slice(-3), f };
}

/** ddmm.mmmm / dddmm.mmmm + hemisferio → grados decimales. */
export function parseCoord(value, hemi) {
  if (!value) return null;
  const dot = value.indexOf('.');
  const degLen = (dot < 0 ? value.length : dot) - 2;
  if (degLen < 1) return null;
  const deg = Number(value.slice(0, degLen));
  const min = Number(value.slice(degLen));
  if (!Number.isFinite(deg) || !Number.isFinite(min) || min >= 60) return null;
  const v = deg + min / 60;
  return hemi === 'S' || hemi === 'W' ? -v : v;
}

/** hhmmss.sss → ms desde las 00:00 UTC. */
export function parseTimeOfDay(s) {
  const m = /^(\d{2})(\d{2})(\d{2})(\.\d+)?$/.exec(s || '');
  if (!m) return null;
  const ms = Math.round(Number(m[4] || 0) * 1000);
  return ((Number(m[1]) * 60 + Number(m[2])) * 60 + Number(m[3])) * 1000 + ms;
}

/** ddmmyy → ms de las 00:00 UTC de ese día. */
export function parseDate(s) {
  const m = /^(\d{2})(\d{2})(\d{2})$/.exec(s || '');
  if (!m) return null;
  return Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]));
}

const num = (s) => (s === '' || s == null ? null : Number.isFinite(Number(s)) ? Number(s) : null);

/**
 * Ensambla fixes a partir de frases sueltas. Emite un fix por época:
 *  · con RMC válido (fecha + posición + velocidad), enriquecido con los
 *    satélites/HDOP/GST más recientes;
 *  · si el receptor no envía RMC, con GGA (fecha del sistema, velocidad de VTG).
 */
export class NmeaAssembler {
  constructor({ now = () => Date.now() } = {}) {
    this.now = now;
    this.gga = null; // { tod, sats, hdop, quality, alt }
    this.gst = null; // { tod, acc }
    this.vtg = null; // { speed }
    this.lastRmcAt = -Infinity;
    this.lastDay = null; // ms del día UTC (de RMC)
    this.lastT = -Infinity;
    this.stats = { sentences: 0, bad: 0, fixes: 0 };
  }

  /** @returns {null | {lat, lon, t, speed, accuracy, sats, hdop, quality, course, source:'ext'}} */
  push(line) {
    const s = parseSentence(line);
    if (!s) {
      if (typeof line === 'string' && line.trim()) this.stats.bad++;
      return null;
    }
    this.stats.sentences++;
    const { type, f } = s;
    if (type === 'GGA') return this.onGGA(f);
    if (type === 'RMC') return this.onRMC(f);
    if (type === 'GST') {
      const tod = parseTimeOfDay(f[1]);
      const la = num(f[6]);
      const lo = num(f[7]);
      if (la != null && lo != null) this.gst = { tod, acc: Math.hypot(la, lo) };
      return null;
    }
    if (type === 'VTG') {
      const kmh = num(f[7]);
      const kn = num(f[5]);
      this.vtg = { speed: kmh != null ? kmh / 3.6 : kn != null ? kn * KNOT : null, course: num(f[1]) };
      return null;
    }
    return null;
  }

  accuracy() {
    if (this.gst?.acc != null) return this.gst.acc;
    if (this.gga?.hdop != null) return this.gga.hdop * UERE;
    return null;
  }

  onGGA(f) {
    const tod = parseTimeOfDay(f[1]);
    const quality = num(f[6]) ?? 0;
    this.gga = { tod, quality, sats: num(f[7]), hdop: num(f[8]), alt: num(f[9]) };
    // Receptores con RMC: GGA solo aporta calidad. Sin RMC: GGA emite el fix.
    if (this.now() - this.lastRmcAt < 3000) return null;
    if (!quality || tod == null) return null;
    const lat = parseCoord(f[2], f[3]);
    const lon = parseCoord(f[4], f[5]);
    if (lat == null || lon == null) return null;
    return this.emit({ lat, lon, t: this.dayFor(tod) + tod, speed: this.vtg?.speed ?? null, course: this.vtg?.course ?? null });
  }

  onRMC(f) {
    const tod = parseTimeOfDay(f[1]);
    const status = f[2];
    const mode = f[12]; // NMEA 2.3+: A autónomo, D diferencial, N no válido…
    if (status !== 'A' || mode === 'N' || tod == null) return null;
    this.lastRmcAt = this.now();
    const lat = parseCoord(f[3], f[4]);
    const lon = parseCoord(f[5], f[6]);
    if (lat == null || lon == null) return null;
    const day = parseDate(f[9]);
    if (day != null) this.lastDay = day;
    const kn = num(f[7]);
    return this.emit({
      lat,
      lon,
      t: (day ?? this.dayFor(tod)) + tod,
      speed: kn == null ? null : kn * KNOT,
      course: num(f[8]),
    });
  }

  /** Día UTC para receptores sin fecha: el último de RMC o el del sistema (con cambio de día). */
  dayFor(tod) {
    if (this.lastDay != null) return this.lastDay;
    const now = this.now();
    const day = Math.floor(now / 86400000) * 86400000;
    const todNow = now - day;
    // fix de justo antes de medianoche recibido después de medianoche
    if (tod - todNow > 12 * 3600000) return day - 86400000;
    if (todNow - tod > 12 * 3600000) return day + 86400000;
    return day;
  }

  emit(fix) {
    if (!(fix.t > this.lastT)) return null; // duplicado de la misma época
    this.lastT = fix.t;
    this.stats.fixes++;
    return {
      ...fix,
      accuracy: this.accuracy(),
      sats: this.gga?.sats ?? null,
      hdop: this.gga?.hdop ?? null,
      quality: this.gga?.quality ?? null,
      source: 'ext',
    };
  }
}

/** Trocea un flujo de texto (TCP) o datagramas (UDP) en líneas completas. */
export class LineSplitter {
  constructor(maxBuffer = 8192) {
    this.buf = '';
    this.max = maxBuffer;
  }

  push(chunk) {
    this.buf += chunk;
    const parts = this.buf.split(/\r?\n|\r/);
    this.buf = parts.pop();
    // un receptor que no manda saltos de línea: cortar por '$'
    if (this.buf.length > this.max) this.buf = this.buf.slice(this.buf.lastIndexOf('$'));
    return parts.filter((l) => l.length > 0);
  }
}

// ---------------------------------------------------------------------------
// Codificador (tests y simulador de receptor WiFi)
// ---------------------------------------------------------------------------

const pad = (n, w) => String(n).padStart(w, '0');

function fmtCoord(v, degDigits) {
  const a = Math.abs(v);
  const deg = Math.floor(a);
  const min = (a - deg) * 60;
  return pad(deg, degDigits) + min.toFixed(5).padStart(8, '0');
}

const wrap = (body) => `$${body}*${checksum(body)}`;

/** Frases RMC + GGA + GST de un fix {lat, lon, t, speed (m/s), course}. */
export function encodeFix(fix, { talker = 'GN', sats = 14, hdop = 0.7, acc = 1.2 } = {}) {
  const d = new Date(fix.t);
  const hms = `${pad(d.getUTCHours(), 2)}${pad(d.getUTCMinutes(), 2)}${pad(d.getUTCSeconds(), 2)}.${pad(Math.floor(d.getUTCMilliseconds() / 10), 2)}`;
  const date = `${pad(d.getUTCDate(), 2)}${pad(d.getUTCMonth() + 1, 2)}${pad(d.getUTCFullYear() % 100, 2)}`;
  const lat = fmtCoord(fix.lat, 2);
  const lon = fmtCoord(fix.lon, 3);
  const ns = fix.lat < 0 ? 'S' : 'N';
  const ew = fix.lon < 0 ? 'W' : 'E';
  const kn = ((fix.speed ?? 0) / KNOT).toFixed(3);
  const course = (fix.course ?? 0).toFixed(1);
  return [
    wrap(`${talker}RMC,${hms},A,${lat},${ns},${lon},${ew},${kn},${course},${date},,,A`),
    wrap(`${talker}GGA,${hms},${lat},${ns},${lon},${ew},1,${pad(sats, 2)},${hdop.toFixed(1)},45.0,M,50.0,M,,`),
    wrap(`${talker}GST,${hms},${acc.toFixed(1)},${acc.toFixed(1)},${acc.toFixed(1)},0.0,${(acc / Math.SQRT2).toFixed(2)},${(acc / Math.SQRT2).toFixed(2)},${(acc * 1.5).toFixed(1)}`),
  ];
}
