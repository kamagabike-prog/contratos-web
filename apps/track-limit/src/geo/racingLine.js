// Generador de Trazada Ideal (Racing Line) por mínima curvatura.
//
// Partimos de la línea central y buscamos, para cada punto, un desplazamiento
// lateral α_i dentro de los límites de pista que minimice la curvatura de la
// trayectoria resultante (patrón clásico exterior–ápice–exterior). Se resuelve
// por relajación iterativa multiescala, que converge en milisegundos para
// ~1000 puntos y no requiere librerías de optimización.

import { normalsClosed, dot } from './geometry.js';

/**
 * @param {{x:number,y:number}[]} center  línea central equiespaciada (cerrada)
 * @param {number} width                 ancho de pista (m)
 * @param {object} [opts]
 * @param {number} [opts.margin=1.2]     margen de seguridad a cada borde (m)
 * @param {number[]} [opts.scales]       saltos de vecindad para la relajación
 * @param {number} [opts.iterations=400] iteraciones por escala
 * @returns {{points:{x:number,y:number}[], offsets:number[]}}
 */
export function computeRacingLine(center, width, opts = {}) {
  const { margin = 1.2, scales = [24, 12, 6, 3, 1], iterations = 400 } = opts;
  const n = center.length;
  const N = normalsClosed(center);
  const lim = Math.max(0, width / 2 - margin);
  const alpha = new Float64Array(n);

  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const refresh = () => {
    for (let i = 0; i < n; i++) {
      px[i] = center[i].x + N[i].x * alpha[i];
      py[i] = center[i].y + N[i].y * alpha[i];
    }
  };

  refresh();
  for (const k of scales) {
    for (let it = 0; it < iterations; it++) {
      for (let i = 0; i < n; i++) {
        const a = (i - k + n) % n;
        const b = (i + k) % n;
        // Punto medio de los vecinos: moverse hacia él reduce la curvatura local.
        const tx = (px[a] + px[b]) / 2 - px[i];
        const ty = (py[a] + py[b]) / 2 - py[i];
        let v = alpha[i] + 0.6 * dot({ x: tx, y: ty }, N[i]);
        if (v > lim) v = lim;
        else if (v < -lim) v = -lim;
        alpha[i] = v;
        px[i] = center[i].x + N[i].x * v;
        py[i] = center[i].y + N[i].y * v;
      }
    }
  }

  const points = [];
  for (let i = 0; i < n; i++) points.push({ x: px[i], y: py[i] });
  return { points, offsets: Array.from(alpha) };
}
