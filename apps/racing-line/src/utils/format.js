/** mm:ss.mmm */
export function formatLap(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--:--.---';
  // redondeo antes del signo: -0.4 ms no debe mostrarse como "-00:00.000"
  ms = Math.round(ms);
  const neg = ms < 0;
  ms = Math.abs(ms);
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

/** Diferencia con signo: +0.432 / -1.201 */
export function formatDelta(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  // signo según el valor ya redondeado al ms (evita "+0.000" / "−0.000")
  const r = Math.round(ms);
  const sign = r > 0 ? '+' : r < 0 ? '−' : '±';
  return `${sign}${(Math.abs(r) / 1000).toFixed(3)}`;
}

export const kmh = (ms) => (ms == null ? '--' : Math.round(ms * 3.6));

export function formatDate(ts) {
  return new Date(ts).toLocaleString('es-ES', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}
