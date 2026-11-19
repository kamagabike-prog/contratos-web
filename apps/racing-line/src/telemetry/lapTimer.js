// Cronometrador automático por cruce de líneas virtuales (meta + parciales).
//
// Cada fix GPS forma, con el anterior, un vector de movimiento. Si ese vector
// corta un segmento de cronometraje (intersección 2D de segmentos) en el
// sentido de marcha, se registra el paso. El instante exacto se interpola
// linealmente entre los dos fixes (t ∈ [0,1] sobre el segmento del piloto),
// así que la precisión no depende de la frecuencia del GPS (1 Hz incluido).
//
// Orden de líneas: T1 → T2 → META. Sectores: S1 = meta→T1, S2 = T1→T2,
// S3 = T2→meta. Al cruzar meta se cierra la vuelta y arranca la siguiente.

import { segmentIntersection, dot, sub } from '../geo/geometry.js';

export class LapTimer {
  /**
   * @param {object} model   modelo de pista (getTrackModel)
   * @param {object} [opts]
   * @param {number} [opts.minLapMs=20000]  antirrebote: tiempo mínimo de vuelta
   */
  constructor(model, opts = {}) {
    this.model = model;
    this.minLapMs = opts.minLapMs ?? 20000;
    this.reset();
  }

  reset() {
    this.prev = null;
    this.lapStart = null; // timestamp del último paso por meta
    this.laps = []; // vueltas cerradas
    this.current = []; // puntos de la vuelta en curso
    this.outLap = []; // puntos antes del primer paso por meta
    this.splits = []; // instantes de paso por T1, T2 en la vuelta en curso
    this.maxSpeed = 0; // m/s de la vuelta en curso
    this.maxLean = null; // grados de la vuelta en curso
  }

  /** Cruce del vector prev→p con una línea de cronometraje, en sentido de marcha. */
  crossing(prev, p, line) {
    const hit = segmentIntersection(prev, p, line[0], line[1]);
    if (!hit) return null;
    // sentido de marcha: el movimiento debe ir en la dirección de la pista en esa línea
    if (dot(sub(p, prev), this.forwardAt(line)) <= 0) return null;
    return {
      t: prev.t + hit.t * (p.t - prev.t),
      x: prev.x + hit.t * (p.x - prev.x),
      y: prev.y + hit.t * (p.y - prev.y),
      v: interp(prev.v, p.v, hit.t),
      lean: interp(prev.lean, p.lean, hit.t),
    };
  }

  /** Dirección de la pista en una línea de cronometraje (perpendicular a ella). */
  forwardAt(line) {
    if (!line._fwd) {
      const d = sub(line[1], line[0]);
      // normal de la línea orientada según la tangente de la línea central más cercana
      const n1 = { x: -d.y, y: d.x };
      const mid = { x: (line[0].x + line[1].x) / 2, y: (line[0].y + line[1].y) / 2 };
      const c = this.model.center;
      let bi = 0;
      let bd = Infinity;
      for (let i = 0; i < c.length; i++) {
        const dd = (c[i].x - mid.x) ** 2 + (c[i].y - mid.y) ** 2;
        if (dd < bd) {
          bd = dd;
          bi = i;
        }
      }
      const nx = c[(bi + 1) % c.length];
      const tangent = sub(nx, c[bi]);
      line._fwd = dot(n1, tangent) >= 0 ? n1 : { x: -n1.x, y: -n1.y };
    }
    return line._fwd;
  }

  /**
   * Procesa un fix GPS.
   * @param {{lat:number, lon:number, t:number, speed:number|null, lean?:number|null}} fix
   * @returns {null | object}  la vuelta cerrada si este fix cruza la meta
   */
  push(fix) {
    const { x, y } = this.model.proj.toXY(fix.lat, fix.lon);
    const p = { x, y, t: fix.t, v: fix.speed ?? null, lean: fix.lean ?? null };
    let closed = null;
    const [t1, t2, finish] = this.model.sectorLines;

    if (this.prev) {
      // Parciales intermedios (solo dentro de una vuelta lanzada y en orden)
      if (this.lapStart !== null && this.splits.length < 2) {
        const line = this.splits.length === 0 ? t1 : t2;
        const c = this.crossing(this.prev, p, line);
        if (c) this.splits.push(c.t);
      }

      const c = this.crossing(this.prev, p, finish);
      if (c) {
        if (this.lapStart === null) {
          this.startLap(c);
        } else if (c.t - this.lapStart >= this.minLapMs) {
          this.current.push(c);
          this.track(c);
          const timeMs = c.t - this.lapStart;
          const sectors =
            this.splits.length === 2
              ? [this.splits[0] - this.lapStart, this.splits[1] - this.splits[0], c.t - this.splits[1]]
              : null;
          closed = {
            number: this.laps.length + 1,
            startT: this.lapStart,
            endT: c.t,
            timeMs,
            sectors,
            maxSpeed: this.maxSpeed,
            maxLean: this.maxLean,
            points: this.current,
          };
          this.laps.push(closed);
          this.startLap(c);
        }
      }
    }

    if (this.lapStart === null) this.outLap.push(p);
    else {
      this.current.push(p);
      this.track(p);
    }
    this.prev = p;
    return closed;
  }

  startLap(c) {
    this.lapStart = c.t;
    this.current = [c];
    this.splits = [];
    this.maxSpeed = c.v ?? 0;
    this.maxLean = c.lean ?? null;
  }

  track(p) {
    if (p.v != null && p.v > this.maxSpeed) this.maxSpeed = p.v;
    if (p.lean != null) {
      const a = Math.abs(p.lean);
      if (this.maxLean == null || a > this.maxLean) this.maxLean = a;
    }
  }

  /** Tiempo transcurrido de la vuelta en curso (ms) para un instante dado. */
  elapsed(now) {
    return this.lapStart === null ? null : now - this.lapStart;
  }

  /** Parciales cerrados de la vuelta en curso (ms). */
  currentSectors() {
    if (this.lapStart === null) return [];
    const out = [];
    let prev = this.lapStart;
    for (const s of this.splits) {
      out.push(s - prev);
      prev = s;
    }
    return out;
  }

  get bestLap() {
    return this.laps.reduce((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);
  }
}

function interp(a, b, t) {
  if (a == null || b == null) return a ?? b ?? null;
  return a + (b - a) * t;
}
