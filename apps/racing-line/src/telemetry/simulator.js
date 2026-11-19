// Simulador de vueltas GPS para probar la app sin estar en pista.
//
// Genera fixes GPS que siguen la trazada ideal con:
//   · desviaciones laterales suaves (suma de senoides, ±1–2 m)
//   · errores típicos de piloto: abrirse a la salida de 1–2 curvas por vuelta
//   · perfil de velocidad realista (límite de aceleración lateral, frenada y
//     aceleración longitudinal) y ritmo variable entre vueltas
//   · ruido GPS (~0,6 m) a 10 Hz
// El reloj es virtual: con `timeScale` > 1 la simulación corre acelerada pero
// los tiempos de vuelta siguen siendo los "reales" de la moto.

import { curvatureClosed, normalsClosed, dist } from '../geo/geometry.js';

const G = 9.81;

function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Perfil de velocidad (m/s) sobre la trazada por pasadas adelante/atrás. */
export function speedProfile(line, { vmax, aLat = 1.25 * G, aAcc = 0.55 * G, aBrk = 1.05 * G }) {
  const n = line.length;
  const k = curvatureClosed(line);
  const ks = k.map((_, i) => {
    let s = 0;
    for (let j = -4; j <= 4; j++) s += Math.abs(k[(i + j + n) % n]);
    return s / 9;
  });
  const ds = line.map((p, i) => dist(p, line[(i + 1) % n]));
  const v = ks.map((kk) => Math.min(vmax, kk > 1e-6 ? Math.sqrt(aLat / kk) : vmax));
  // Dos vueltas de pasadas para que el perfil sea periódico.
  for (let pass = 0; pass < 2; pass++) {
    for (let i = 0; i < 2 * n; i++) {
      const a = i % n;
      const b = (i + 1) % n;
      v[b] = Math.min(v[b], Math.sqrt(v[a] ** 2 + 2 * aAcc * ds[a]));
    }
    for (let i = 2 * n; i > 0; i--) {
      const b = i % n;
      const a = (i - 1 + n) % n;
      v[a] = Math.min(v[a], Math.sqrt(v[b] ** 2 + 2 * aBrk * ds[a]));
    }
  }
  return { v, ds, curvature: ks };
}

/**
 * Crea una fuente de datos simulada.
 * @param {object} model   getTrackModel(circuit)
 * @param {object} opts
 * @param {number} [opts.laps=3]
 * @param {number} [opts.timeScale=4]  multiplicador de velocidad de reproducción
 * @param {number} [opts.vmaxKmh=280]
 * @param {number} [opts.pace=0.9]     0..1, ritmo del piloto respecto al límite
 * @param {number} [opts.seed]
 */
export function createSimulator(model, opts = {}) {
  const { laps = 3, timeScale = 4, vmaxKmh = 280, pace = 0.9, rateHz = 10 } = opts;
  const rnd = mulberry32(opts.seed ?? Date.now());
  const line = model.racingLine;
  const n = line.length;
  const normals = normalsClosed(line);
  const prof = speedProfile(line, { vmax: vmaxKmh / 3.6 });
  const lapLen = prof.ds.reduce((a, b) => a + b, 0);
  const cum = [0];
  for (let i = 0; i < n; i++) cum.push(cum[i] + prof.ds[i]);

  // Vértices de curva (máximos locales de curvatura) → candidatos a error.
  const apexes = [];
  for (let i = 0; i < n; i++) {
    const c = prof.curvature[i];
    if (c > 1 / 120 && c >= prof.curvature[(i - 1 + n) % n] && c >= prof.curvature[(i + 1) % n]) {
      if (!apexes.length || i - apexes[apexes.length - 1] > 15) apexes.push(i);
    }
  }
  const signedK = curvatureClosed(line);

  // Parámetros aleatorios por vuelta.
  const lapParams = Array.from({ length: laps + 2 }, () => ({
    pace: pace * (0.97 + rnd() * 0.04),
    waves: Array.from({ length: 3 }, () => ({
      amp: 0.4 + rnd() * 0.9,
      period: 250 + rnd() * 700,
      phase: rnd() * Math.PI * 2,
    })),
    mistakes: apexes
      .filter(() => rnd() < 0.18)
      .map((i) => ({
        s: cum[(i + 6) % n], // a la salida de la curva
        amp: 2.5 + rnd() * 3,
        width: 40 + rnd() * 50,
        side: -Math.sign(signedK[i]) || 1, // hacia el exterior
      })),
  }));

  // Arranque 300 m antes de meta, parado (salida del pit-lane).
  const startS = lapLen - 300;
  let s = startS; // distancia total recorrida (absoluta)
  let v = 0;
  let simT = 0;
  let idx = 0;
  let timer = null;
  let t0 = 0;
  let lastRealTick = 0;
  let finishedAt = null;

  const locate = (sAbs) => {
    const sl = ((sAbs % lapLen) + lapLen) % lapLen;
    while (cum[idx + 1] < sl) idx = (idx + 1) % n;
    while (cum[idx] > sl) idx = (idx - 1 + n) % n;
    const w = (sl - cum[idx]) / (prof.ds[idx] || 1);
    return { i: idx, w, sl };
  };

  const step = (dt) => {
    const lapNo = Math.floor(s / lapLen); // 0 = vuelta de salida
    const P = lapParams[Math.max(0, Math.min(lapParams.length - 1, lapNo))];
    const { i, w, sl } = locate(s);
    const j = (i + 1) % n;
    const vTarget = (prof.v[i] + (prof.v[j] - prof.v[i]) * w) * P.pace;
    // dinámica longitudinal simple
    const a = vTarget > v ? Math.min(0.55 * G, (vTarget - v) / dt) : Math.max(-1.1 * G, (vTarget - v) / dt);
    v = Math.max(3, v + a * dt);
    s += v * dt;
    simT += dt * 1000;

    let off = 0;
    for (const wv of P.waves) off += wv.amp * Math.sin((2 * Math.PI * sl) / wv.period + wv.phase);
    for (const m of P.mistakes) {
      let d = sl - m.s;
      if (d > lapLen / 2) d -= lapLen;
      if (d < -lapLen / 2) d += lapLen;
      off += m.side * m.amp * Math.exp(-((d / m.width) ** 2));
    }
    const base = {
      x: line[i].x + (line[j].x - line[i].x) * w,
      y: line[i].y + (line[j].y - line[i].y) * w,
    };
    const nx = normals[i].x;
    const ny = normals[i].y;
    const gx = (rnd() - 0.5) * 1.2;
    const gy = (rnd() - 0.5) * 1.2;
    const ll = model.proj.toLatLon(base.x + nx * off + gx, base.y + ny * off + gy);
    return { lat: ll.lat, lon: ll.lon, t: t0 + simT, speed: v, accuracy: 0.8 + rnd() };
  };

  const totalS = lapLen * (laps + 1) + 150; // vuelta de salida + N vueltas + frenada

  return {
    kind: 'sim',
    /** Reloj virtual (ms) de la simulación. */
    now() {
      if (!timer) return t0 + simT;
      return t0 + simT + Math.min(1000 / rateHz, (performance.now() - lastRealTick) * timeScale);
    },
    start(onFix, onEnd) {
      t0 = Date.now();
      lastRealTick = performance.now();
      const dt = 1 / rateHz;
      timer = setInterval(() => {
        lastRealTick = performance.now();
        // con timeScale > 1 avanzamos varios pasos por tick
        for (let k = 0; k < timeScale; k++) {
          onFix(step(dt));
          if (s >= totalS) {
            this.stop();
            finishedAt = t0 + simT;
            onEnd?.();
            return;
          }
        }
      }, 1000 / rateHz);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    /** Genera todos los fixes de golpe (tests / modo instantáneo). */
    generateAll() {
      t0 = Date.now();
      const out = [];
      while (s < totalS) out.push(step(1 / rateHz));
      return out;
    },
    get finishedAt() {
      return finishedAt;
    },
  };
}
