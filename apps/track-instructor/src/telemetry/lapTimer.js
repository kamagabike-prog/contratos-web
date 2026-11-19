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
//
// Robustez frente a GPS real (ver robustness.test.js):
//   · Fixes inválidos (lat/lon/t no finitos), duplicados o desordenados en el
//     tiempo (t <= t anterior) y con precisión peor que `maxAccuracyM` se
//     descartan: no generan cruces ni puntos.
//   · Saltos imposibles (velocidad implícita > `maxSpeedKmh`) se descartan; si
//     se repiten de forma coherente varias veces se asume que el GPS se ha
//     re-sincronizado y se acepta la nueva posición SIN evaluar cruces.
//   · Meta "armada": tras pasar por meta hay que alejarse `armDistanceM` de la
//     línea antes de que otro paso pueda cerrar vuelta. Así el ruido GPS con la
//     moto parada sobre la meta (cruces adelante/atrás) nunca crea vueltas.
//     Si estando desarmada se cruza hacia atrás y luego hacia delante (salida
//     parada justo detrás de la línea), se re-sincroniza el inicio de vuelta
//     al último paso hacia delante.
//   · Cruces hacia atrás nunca cuentan.
//   · Una pérdida de cobertura (dropout) se trata como un tramo recto entre los
//     dos fixes: si ese tramo corta la meta, la vuelta se cierra con el instante
//     interpolado; si se salta un parcial, `sectors` queda en null (nunca se
//     inventa un parcial). Como en una curva la cuerda del hueco puede pasar
//     unos metros por fuera de la línea, en tramos con hueco > GAP_MS las
//     líneas se prolongan GAP_EXTEND_M por cada extremo.
//   · Pit-lane: la meta mide ancho/2 + 8 m a cada lado del eje. Un pit-lane a
//     20–30 m del eje NO la corta, así que esa pasada no cierra vuelta (la
//     vuelta de entrada + salida queda como una sola vuelta larga, nunca se
//     cuenta doble). Con `finishExtendM` se puede prolongar la meta para que
//     el pit-lane también cuente, como hacen los cronos con lazo en el pit.

import { segmentIntersection, dot, sub, dist } from '../geo/geometry.js';

const MOVING_MS = 10 / 3.6; // por debajo de 10 km/h se considera parado

const GAP_MS = 2000; // tramo entre fixes considerado "hueco" de cobertura
const GAP_EXTEND_M = 25; // prolongación de las líneas en tramos con hueco
const STILL_SPEED = 1.5; // m/s: por debajo, la moto se considera parada
const STILL_RADIUS_M = 5; // con la moto parada no se guardan puntos a menos de esto

export class LapTimer {
  /**
   * @param {object} model   modelo de pista (getTrackModel)
   * @param {object} [opts]
   * @param {number} [opts.minLapMs=20000]     antirrebote: tiempo mínimo de vuelta
   * @param {number} [opts.maxAccuracyM=30]    descarta fixes con accuracy peor (Infinity = no filtrar)
   * @param {number} [opts.maxSpeedKmh=400]    velocidad implícita máxima entre fixes (anti-teletransporte)
   * @param {number} [opts.armDistanceM=150]   distancia a la meta para rearmarla tras un paso
   * @param {number} [opts.finishExtendM=0]    prolonga la meta por ambos extremos (p. ej. pit-lane)
   * @param {number} [opts.maxOutLapPoints=3000] tope de puntos guardados antes de la 1ª vuelta
   */
  constructor(model, opts = {}) {
    this.model = model;
    this.minLapMs = opts.minLapMs ?? 20000;
    this.maxAccuracyM = opts.maxAccuracyM ?? 30;
    this.maxSpeedMs = (opts.maxSpeedKmh ?? 400) / 3.6;
    this.armDistanceM = opts.armDistanceM ?? 150;
    this.maxOutLapPoints = opts.maxOutLapPoints ?? 3000;
    const finish = model.sectorLines[2];
    this.finishMid = { x: (finish[0].x + finish[1].x) / 2, y: (finish[0].y + finish[1].y) / 2 };
    this.finishFwd = this.forwardAt(finish);
    this.finishSeg = extendSegment(finish, opts.finishExtendM ?? 0);
    this.finishSegGap = extendSegment(finish, (opts.finishExtendM ?? 0) + GAP_EXTEND_M);
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
    this.armed = true; // la meta puede cerrar vuelta
    this.rolledBack = false; // cruce hacia atrás de meta desde el último inicio
    this.jumpRejects = 0; // saltos imposibles consecutivos descartados
    this.lastRejected = null;
    this.rejected = 0; // total de fixes descartados (diagnóstico)
    // Uso: tiempo en movimiento y distancia recorrida en toda la sesión
    // (vueltas de salida/entrada incluidas; parado en boxes no cuenta).
    this.movingMs = 0;
    this.distanceM = 0;
  }

  /**
   * Cruce del vector prev→p con una línea de cronometraje.
   * Devuelve el punto interpolado con `s` (fracción sobre prev→p) y `forward`
   * (true si va en sentido de marcha), o null si no la corta.
   * Intervalo semiabierto s ∈ (0, 1]: un fix exactamente sobre la línea cuenta
   * una sola vez (al llegar), no dos.
   */
  crossingAny(prev, p, seg, fwd) {
    const hit = segmentIntersection(prev, p, seg[0], seg[1]);
    if (!hit || hit.t <= 0) return null;
    return {
      t: prev.t + hit.t * (p.t - prev.t),
      x: prev.x + hit.t * (p.x - prev.x),
      y: prev.y + hit.t * (p.y - prev.y),
      v: interp(prev.v, p.v, hit.t),
      lean: interp(prev.lean, p.lean, hit.t),
      s: hit.t,
      forward: dot(sub(p, prev), fwd) > 0,
    };
  }

  /** Cruce del vector prev→p con una línea de cronometraje, en sentido de marcha. */
  crossing(prev, p, line) {
    const c = this.crossingAny(prev, p, line, this.forwardAt(line));
    if (!c || !c.forward) return null;
    return { t: c.t, x: c.x, y: c.y, v: c.v, lean: c.lean };
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
   * @param {{lat:number, lon:number, t:number, speed:number|null, lean?:number|null, accuracy?:number|null}} fix
   * @returns {null | object}  la vuelta cerrada si este fix cruza la meta
   */
  push(fix) {
    // 1) Filtros de calidad: fix inválido, impreciso, duplicado o desordenado.
    if (!fix || !Number.isFinite(fix.lat) || !Number.isFinite(fix.lon) || !Number.isFinite(fix.t)) {
      this.rejected++;
      return null;
    }
    if (Number.isFinite(fix.accuracy) && fix.accuracy > this.maxAccuracyM) {
      this.rejected++;
      return null;
    }
    if (this.prev && fix.t <= this.prev.t) {
      this.rejected++;
      return null;
    }
    const { x, y } = this.model.proj.toXY(fix.lat, fix.lon);
    const speed = Number.isFinite(fix.speed) && fix.speed >= 0 ? fix.speed : null;
    const lean = Number.isFinite(fix.lean) ? fix.lean : null;
    const p = { x, y, t: fix.t, v: speed, lean };

    // 2) Anti-teletransporte: velocidad implícita imposible respecto al último fix válido.
    let timeCrossings = this.prev !== null;
    if (this.prev && this.isJump(this.prev, p)) {
      // ¿re-sincronización? varios saltos seguidos, coherentes entre sí
      const coherent = this.lastRejected && !this.isJump(this.lastRejected, p);
      this.jumpRejects++;
      this.rejected++;
      if (!(coherent && this.jumpRejects >= 3)) {
        this.lastRejected = p;
        return null;
      }
      timeCrossings = false; // aceptamos la nueva posición, pero sin cronometrar este tramo
    }
    this.jumpRejects = 0;
    this.lastRejected = null;

    const closed = timeCrossings ? this.processSegment(this.prev, p) : null;
    if (timeCrossings) this.accumulateUsage(this.prev, p);

    // 3) Rearme de la meta al alejarse de ella.
    if (!this.armed && dist(p, this.finishMid) > this.armDistanceM) this.armed = true;

    this.store(p);
    this.prev = p;
    return closed;
  }

  /** Suma tiempo y distancia del tramo a→b si la moto se movía (> 10 km/h) y no hubo hueco largo. */
  accumulateUsage(a, b) {
    const dt = b.t - a.t;
    if (!(dt > 0) || dt > 5000) return;
    const d = dist(a, b);
    const v = b.v ?? a.v ?? d / (dt / 1000);
    if (v < MOVING_MS) return;
    this.movingMs += dt;
    this.distanceM += d;
  }

  isJump(a, b) {
    const d = dist(a, b);
    const dt = (b.t - a.t) / 1000;
    return d > 30 && (dt <= 0 || d / dt > this.maxSpeedMs);
  }

  /** Evalúa meta y parciales sobre el tramo a→b, en orden temporal. */
  processSegment(a, b) {
    let closed = null;
    const gap = b.t - a.t > GAP_MS;
    let fin = this.crossingAny(a, b, gap ? this.finishSegGap : this.finishSeg, this.finishFwd);
    if (fin && !fin.forward) {
      if (this.lapStart !== null) this.rolledBack = true;
      fin = null;
    }
    // Parciales de la vuelta en curso anteriores al paso por meta.
    if (this.lapStart !== null) this.checkSplits(a, b, 0, fin ? fin.s : 1);
    if (!fin) return null;

    let started = false;
    if (this.lapStart === null) {
      this.startLap(fin);
      started = true;
    } else if (this.armed && fin.t - this.lapStart >= this.minLapMs) {
      const c = strip(fin);
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
      this.startLap(fin);
      started = true;
    } else if (!this.armed && this.rolledBack) {
      // Ruido/retroceso sobre la meta sin haberse alejado: re-sincroniza el
      // inicio de la vuelta en curso al último paso hacia delante.
      this.startLap(fin);
      started = true;
    }
    // Parciales de la vuelta nueva en el mismo tramo (tramos largos por dropout).
    if (started) this.checkSplits(a, b, fin.s, 1);
    return closed;
  }

  /** Registra los parciales esperados (T1 y luego T2) con s ∈ (sMin, sMax]. */
  checkSplits(a, b, sMin, sMax) {
    const [t1, t2] = this.model.sectorLines;
    const gap = b.t - a.t > GAP_MS;
    while (this.splits.length < 2) {
      const line = this.splits.length === 0 ? t1 : t2;
      if (gap && !line._gapSeg) line._gapSeg = extendSegment(line, GAP_EXTEND_M);
      const c = this.crossingAny(a, b, gap ? line._gapSeg : line, this.forwardAt(line));
      if (!c || !c.forward || c.s <= sMin || c.s > sMax || c.t <= this.lapStart) return;
      this.splits.push(c.t);
      sMin = c.s;
    }
  }

  startLap(fin) {
    const c = strip(fin);
    this.lapStart = c.t;
    this.current = [c];
    this.splits = [];
    this.maxSpeed = c.v ?? 0;
    this.maxLean = c.lean != null ? Math.abs(c.lean) : null;
    this.armed = false;
    this.rolledBack = false;
  }

  /**
   * Guarda el punto en la vuelta en curso (o en la de salida).
   * Con la moto parada (boxes, semáforo) no se acumulan puntos casi idénticos:
   * a 10 Hz una hora parado serían 36 000 puntos que la vista en vivo copia y
   * suaviza en cada frame. La vuelta de salida además tiene un tope.
   */
  store(p) {
    const arr = this.lapStart === null ? this.outLap : this.current;
    const last = arr[arr.length - 1];
    if (last && this.prev) {
      const dt = (p.t - this.prev.t) / 1000;
      const vEst = p.v ?? (dt > 0 ? dist(this.prev, p) / dt : 0);
      if (vEst < STILL_SPEED && dist(last, p) < STILL_RADIUS_M) return; // parado: punto redundante
    }
    arr.push(p);
    if (this.lapStart === null) {
      if (arr.length > this.maxOutLapPoints * 1.5) arr.splice(0, arr.length - this.maxOutLapPoints);
    } else this.track(p);
  }

  track(p) {
    if (p.v != null && p.v > this.maxSpeed) this.maxSpeed = p.v;
    if (p.lean != null) {
      const a = Math.abs(p.lean);
      if (this.maxLean == null || a > this.maxLean) this.maxLean = a;
    }
  }

  /** Tiempo transcurrido de la vuelta en curso (ms) para un instante dado (nunca negativo). */
  elapsed(now) {
    return this.lapStart === null ? null : Math.max(0, now - this.lapStart);
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

/** Punto de cruce sin los campos internos (s, forward). */
function strip(c) {
  return { t: c.t, x: c.x, y: c.y, v: c.v, lean: c.lean };
}

/** Prolonga un segmento `m` metros por cada extremo. */
function extendSegment(seg, m) {
  if (!m) return seg;
  const d = sub(seg[1], seg[0]);
  const L = Math.hypot(d.x, d.y) || 1;
  const ux = (d.x / L) * m;
  const uy = (d.y / L) * m;
  return [
    { x: seg[0].x - ux, y: seg[0].y - uy },
    { x: seg[1].x + ux, y: seg[1].y + uy },
  ];
}
