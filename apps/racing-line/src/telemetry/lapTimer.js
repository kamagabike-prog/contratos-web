// Cronometrador automático por cruce de línea de meta virtual.
//
// Cada fix GPS forma, con el anterior, un vector de movimiento. Si ese vector
// corta el segmento de meta (intersección 2D de segmentos) y lo hace en el
// sentido de marcha, se cierra la vuelta. El instante exacto se interpola
// linealmente entre los dos fixes (t ∈ [0,1] sobre el segmento del piloto),
// por lo que la precisión no depende de la frecuencia del GPS.

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
    this.lapStart = null; // timestamp del último cruce
    this.laps = []; // vueltas cerradas
    this.current = []; // puntos de la vuelta en curso
    this.outLap = []; // puntos antes del primer cruce
  }

  /**
   * Procesa un fix GPS.
   * @param {{lat:number, lon:number, t:number, speed:number|null, acc?:number}} fix
   * @returns {null | object}  la vuelta cerrada si este fix cruza la meta
   */
  push(fix) {
    const { x, y } = this.model.proj.toXY(fix.lat, fix.lon);
    const p = { x, y, t: fix.t, v: fix.speed ?? null };
    let closed = null;

    if (this.prev) {
      const hit = segmentIntersection(this.prev, p, this.model.finish[0], this.model.finish[1]);
      const forward = dot(sub(p, this.prev), this.model.forward) > 0;
      if (hit && forward) {
        const tCross = this.prev.t + hit.t * (p.t - this.prev.t);
        const xCross = this.prev.x + hit.t * (p.x - this.prev.x);
        const yCross = this.prev.y + hit.t * (p.y - this.prev.y);
        const crossPt = { x: xCross, y: yCross, t: tCross, v: interpV(this.prev, p, hit.t) };

        if (this.lapStart === null) {
          this.lapStart = tCross; // fin de la vuelta de salida
          this.current = [crossPt];
        } else if (tCross - this.lapStart >= this.minLapMs) {
          this.current.push(crossPt);
          closed = {
            number: this.laps.length + 1,
            startT: this.lapStart,
            endT: tCross,
            timeMs: tCross - this.lapStart,
            points: this.current,
          };
          this.laps.push(closed);
          this.lapStart = tCross;
          this.current = [crossPt];
        }
      }
    }

    if (this.lapStart === null) this.outLap.push(p);
    else this.current.push(p);
    this.prev = p;
    return closed;
  }

  /** Tiempo transcurrido de la vuelta en curso (ms) para un instante dado. */
  elapsed(now) {
    return this.lapStart === null ? null : now - this.lapStart;
  }

  get bestLap() {
    return this.laps.reduce((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);
  }
}

function interpV(a, b, t) {
  if (a.v == null || b.v == null) return a.v ?? b.v;
  return a.v + (b.v - a.v) * t;
}
