// Tiempo de uso: horas en pista, vueltas y kilómetros acumulados, y
// contadores reiniciables (neumáticos, aceite…) para el mantenimiento.
//
// Solo cuentan las sesiones reales (GPS del móvil, GPS WiFi, descargadas o
// importadas); las simuladas no suman uso.

const COUNTERS_KEY = 'racing-line:usage-counters';

export const DEFAULT_COUNTERS = [
  { id: 'tyres', name: 'Neumáticos', resetAt: null },
  { id: 'oil', name: 'Aceite motor', resetAt: null },
];

export const isRealSession = (s) => s && s.source !== 'sim';

/** Distancia (m) de una vuelta guardada en formato compacto [x, y, t, v, lean]. */
export function lapDistance(lap) {
  const p = lap.pts || [];
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]);
  return d;
}

/**
 * Uso de una sesión. `durationMs` es el tiempo total rodando (vueltas de
 * salida y entrada incluidas) cuando se grabó con esta versión; en sesiones
 * antiguas se usa la suma de las vueltas.
 */
export function sessionUsage(s) {
  const laps = s.laps || [];
  const lapsMs = laps.reduce((a, l) => a + (l.timeMs || 0), 0);
  const distanceM = Number.isFinite(s.distanceM) ? s.distanceM : laps.reduce((a, l) => a + lapDistance(l), 0);
  return {
    durationMs: Number.isFinite(s.durationMs) && s.durationMs >= lapsMs ? s.durationMs : lapsMs,
    laps: laps.length,
    distanceM,
  };
}

/** Suma el uso de las sesiones reales (opcionalmente desde una fecha). */
export function usageTotals(sessions, { since = null } = {}) {
  const total = { durationMs: 0, laps: 0, distanceM: 0, sessions: 0, byCircuit: {} };
  for (const s of sessions) {
    if (!isRealSession(s)) continue;
    if (since != null && !(s.createdAt >= since)) continue;
    const u = sessionUsage(s);
    total.durationMs += u.durationMs;
    total.laps += u.laps;
    total.distanceM += u.distanceM;
    total.sessions++;
    const c = (total.byCircuit[s.circuitId] ||= { durationMs: 0, laps: 0, distanceM: 0, sessions: 0 });
    c.durationMs += u.durationMs;
    c.laps += u.laps;
    c.distanceM += u.distanceM;
    c.sessions++;
  }
  return total;
}

export function loadCounters() {
  try {
    const list = JSON.parse(localStorage.getItem(COUNTERS_KEY) || 'null');
    if (Array.isArray(list) && list.every((c) => c && typeof c.id === 'string' && typeof c.name === 'string')) return list;
  } catch {
    /* sin almacenamiento */
  }
  return DEFAULT_COUNTERS.map((c) => ({ ...c }));
}

export function saveCounters(list) {
  try {
    localStorage.setItem(COUNTERS_KEY, JSON.stringify(list));
  } catch {
    /* sin almacenamiento */
  }
}

/** "3 h 25 min", "45 min", "0 min". */
export function formatDuration(ms) {
  const min = Math.floor((ms || 0) / 60000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? `${h} h ${String(m).padStart(2, '0')} min` : `${m} min`;
}

export const formatKm = (m) => `${((m || 0) / 1000).toLocaleString('es-ES', { maximumFractionDigits: (m || 0) < 100000 ? 1 : 0 })} km`;
