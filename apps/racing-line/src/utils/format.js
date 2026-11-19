/** mm:ss.mmm */
export function formatLap(ms) {
  if (ms == null || !Number.isFinite(ms)) return '--:--.---';
  const neg = ms < 0;
  ms = Math.abs(Math.round(ms));
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const r = ms % 1000;
  return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(r).padStart(3, '0')}`;
}

/** Diferencia con signo: +0.432 / -1.201 */
export function formatDelta(ms) {
  if (ms == null || !Number.isFinite(ms)) return '';
  const sign = ms > 0 ? '+' : ms < 0 ? '−' : '±';
  return `${sign}${(Math.abs(ms) / 1000).toFixed(3)}`;
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
