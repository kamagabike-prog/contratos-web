// Delta de tiempo entre dos vueltas a lo largo de la distancia.
//
// Emparejamiento por distancia normalizada: el punto a la distancia s de la
// vuelta elegida se compara con el punto de la vuelta de referencia situado en
// la misma fracción de vuelta (s / Ltotal). Normalizar por la distancia total
// de cada vuelta cancela la deriva de distancia del GPS (una vuelta "mide" 4.61
// km y otra 4.64 km por ruido y suavizado aunque sean el mismo trazado).
//
// delta(s) = t_sel(s) − t_ref(s · Lref / Lsel), en segundos.
// Positivo → la vuelta elegida va por detrás (pierde tiempo); negativo → gana.

/**
 * @param {{s:number,t:number}[]} sel  vuelta elegida: distancia acumulada (m) y tiempo (ms)
 * @param {{s:number,t:number}[]} ref  vuelta de referencia
 * @returns {number[]} delta en segundos, un valor por punto de `sel` (mismo índice)
 */
export function timeDelta(sel, ref) {
  if (!sel?.length) return [];
  if (!ref?.length || ref.length < 2) return sel.map(() => 0);
  const Ls = sel[sel.length - 1].s - sel[0].s;
  const Lr = ref[ref.length - 1].s - ref[0].s;
  if (!(Ls > 0) || !(Lr > 0)) return sel.map(() => 0);
  const ts0 = sel[0].t;
  const tr0 = ref[0].t;
  const rs0 = ref[0].s;
  const out = new Array(sel.length);
  let j = 0; // puntero monótono sobre ref (sel recorre s de forma creciente)
  for (let i = 0; i < sel.length; i++) {
    const f = Math.min(1, Math.max(0, (sel[i].s - sel[0].s) / Ls));
    const target = rs0 + f * Lr;
    if (ref[j].s > target) j = 0; // por si s no fuera monótona
    while (j < ref.length - 2 && ref[j + 1].s < target) j++;
    const a = ref[j];
    const b = ref[j + 1];
    const span = b.s - a.s;
    const w = span > 0 ? Math.min(1, Math.max(0, (target - a.s) / span)) : 0;
    const tr = a.t + (b.t - a.t) * w - tr0;
    out[i] = (sel[i].t - ts0 - tr) / 1000;
  }
  return out;
}

/**
 * Serie {s,t} de una vuelta analizada (trace y smooth de analyzeLap van
 * alineados por índice).
 */
export function distanceTime(stats) {
  return stats.trace.map((d, i) => ({ s: d.s, t: stats.smooth[i].t }));
}
