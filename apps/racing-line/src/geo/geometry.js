// Utilidades de geometría 2D sobre puntos {x, y} en metros.

export const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
export const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
export const cross = (a, b) => a.x * b.y - a.y * b.x;
export const dot = (a, b) => a.x * b.x + a.y * b.y;

/**
 * Intersección de los segmentos p1→p2 y q1→q2.
 * Devuelve { t, u } (parámetros 0..1 sobre cada segmento) o null.
 * t indica en qué fracción del segmento del piloto se produjo el cruce,
 * lo que permite interpolar el instante exacto de paso por meta.
 */
export function segmentIntersection(p1, p2, q1, q2) {
  const r = sub(p2, p1);
  const s = sub(q2, q1);
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-12) return null; // paralelos o colineales
  const qp = sub(q1, p1);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** Longitud de una polilínea (cerrada opcionalmente). */
export function polylineLength(pts, closed = false) {
  let L = 0;
  for (let i = 1; i < pts.length; i++) L += dist(pts[i - 1], pts[i]);
  if (closed && pts.length > 1) L += dist(pts[pts.length - 1], pts[0]);
  return L;
}

/** Distancia de un punto a un segmento ab, con el punto proyectado. */
export function pointSegment(p, a, b) {
  const ab = sub(b, a);
  const len2 = dot(ab, ab);
  let t = len2 > 0 ? dot(sub(p, a), ab) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const proj = { x: a.x + ab.x * t, y: a.y + ab.y * t };
  return { d: dist(p, proj), t, proj };
}

/**
 * Distancia mínima de p a una polilínea cerrada.
 * Devuelve { d, index, t, signed } donde signed > 0 = a la izquierda del sentido de marcha.
 */
export function distanceToPolyline(p, pts, closed = true) {
  let best = { d: Infinity, index: -1, t: 0, signed: 0 };
  const n = pts.length;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const r = pointSegment(p, a, b);
    if (r.d < best.d) {
      const side = cross(sub(b, a), sub(p, a));
      best = { d: r.d, index: i, t: r.t, signed: side >= 0 ? r.d : -r.d };
    }
  }
  return best;
}

/**
 * Spline Catmull-Rom centrípeta cerrada. Genera una curva suave que pasa por
 * todos los puntos de control.
 */
export function catmullRomClosed(ctrl, samplesPerSegment = 20, alpha = 0.5) {
  const n = ctrl.length;
  const out = [];
  const tj = (ti, a, b) => ti + Math.pow(Math.max(dist(a, b), 1e-6), alpha);
  for (let i = 0; i < n; i++) {
    const p0 = ctrl[(i - 1 + n) % n];
    const p1 = ctrl[i];
    const p2 = ctrl[(i + 1) % n];
    const p3 = ctrl[(i + 2) % n];
    const t0 = 0;
    const t1 = tj(t0, p0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, p3);
    for (let k = 0; k < samplesPerSegment; k++) {
      const t = t1 + ((t2 - t1) * k) / samplesPerSegment;
      const A1 = lerpT(p0, p1, t0, t1, t);
      const A2 = lerpT(p1, p2, t1, t2, t);
      const A3 = lerpT(p2, p3, t2, t3, t);
      const B1 = lerpT(A1, A2, t0, t2, t);
      const B2 = lerpT(A2, A3, t1, t3, t);
      out.push(lerpT(B1, B2, t1, t2, t));
    }
  }
  return out;
}

function lerpT(a, b, ta, tb, t) {
  const w = (t - ta) / (tb - ta);
  return { x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w };
}

/** Remuestrea una polilínea cerrada a puntos equiespaciados cada `step` metros. */
export function resampleClosed(pts, step) {
  const ring = [...pts, pts[0]];
  const total = polylineLength(ring);
  const count = Math.max(8, Math.round(total / step));
  const real = total / count;
  const out = [];
  let seg = 0;
  let segStart = 0;
  let segLen = dist(ring[0], ring[1]);
  for (let k = 0; k < count; k++) {
    const target = k * real;
    while (segStart + segLen < target && seg < ring.length - 2) {
      segStart += segLen;
      seg++;
      segLen = dist(ring[seg], ring[seg + 1]);
    }
    const w = segLen > 0 ? (target - segStart) / segLen : 0;
    const a = ring[seg];
    const b = ring[seg + 1];
    out.push({ x: a.x + (b.x - a.x) * w, y: a.y + (b.y - a.y) * w });
  }
  return out;
}

/** Normales unitarias (a la izquierda del sentido de marcha) de una polilínea cerrada. */
export function normalsClosed(pts) {
  const n = pts.length;
  return pts.map((_, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    return { x: -ty / l, y: tx / l };
  });
}

/** Curvatura con signo (1/m, positiva = curva a izquierdas) en cada punto. */
export function curvatureClosed(pts) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[(i - 1 + n) % n];
    const b = pts[(i + 1) % n];
    const ab = dist(a, b);
    const ap = dist(a, p);
    const pb = dist(p, b);
    const area2 = cross(sub(p, a), sub(b, a));
    const denom = ab * ap * pb;
    return denom > 1e-9 ? (2 * area2) / denom : 0;
  });
}

/** Desplaza una polilínea cerrada lateralmente `offset` metros (positivo = izquierda). */
export function offsetClosed(pts, offset, normals = normalsClosed(pts)) {
  return pts.map((p, i) => ({
    x: p.x + normals[i].x * offset,
    y: p.y + normals[i].y * offset,
  }));
}

/** Área con signo (shoelace). Positiva = antihorario. */
export function signedArea(pts) {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export function bounds(pts) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

/**
 * Suavizado Catmull-Rom (centrípeta) de una trazada GPS abierta.
 *
 * Un GPS de móvil a 1 Hz da un punto cada 20–70 m a velocidad de circuito:
 * unir los puntos con rectas dibuja polígonos y "corta" las curvas. La spline
 * pasa exactamente por cada fix y genera `samples` puntos intermedios por
 * tramo. Los atributos escalares (t, v, lean) se interpolan linealmente.
 *
 * @param {{x:number,y:number,t?:number,v?:number|null,lean?:number|null}[]} pts
 * @param {number} [maxStep=4]  separación máxima deseada entre puntos (m)
 */
export function smoothTrace(pts, maxStep = 4, alpha = 0.5) {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out = [];
  const tj = (ti, a, b) => ti + Math.pow(Math.max(dist(a, b), 1e-6), alpha);
  for (let i = 0; i < n - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n - 1, i + 2)];
    const segLen = dist(p1, p2);
    const samples = Math.max(1, Math.min(40, Math.ceil(segLen / maxStep)));
    if (segLen < 1e-6) {
      out.push(p1);
      continue;
    }
    // extremos: duplicar puntos degenera la spline → extrapolamos un punto fantasma
    const q0 = p0 === p1 ? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y } : p0;
    const q3 = p3 === p2 ? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y } : p3;
    const t0 = 0;
    const t1 = tj(t0, q0, p1);
    const t2 = tj(t1, p1, p2);
    const t3 = tj(t2, p2, q3);
    for (let k = 0; k < samples; k++) {
      const w = k / samples;
      const t = t1 + (t2 - t1) * w;
      const A1 = lerpT(q0, p1, t0, t1, t);
      const A2 = lerpT(p1, p2, t1, t2, t);
      const A3 = lerpT(p2, q3, t2, t3, t);
      const B1 = lerpT(A1, A2, t0, t2, t);
      const B2 = lerpT(A2, A3, t1, t3, t);
      const C = lerpT(B1, B2, t1, t2, t);
      out.push({
        x: C.x,
        y: C.y,
        t: lin(p1.t, p2.t, w),
        v: lin(p1.v, p2.v, w),
        lean: lin(p1.lean, p2.lean, w),
      });
    }
  }
  out.push(pts[n - 1]);
  return out;
}

function lin(a, b, w) {
  if (a == null || b == null) return a ?? b ?? null;
  return a + (b - a) * w;
}
