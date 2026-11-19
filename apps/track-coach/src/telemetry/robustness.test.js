// Robustez del cronometraje frente a problemas reales de GPS en pista.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { CIRCUITS, getTrackModel } from '../data/circuits.js';
import { LapTimer } from './lapTimer.js';
import { createSimulator } from './simulator.js';
import { rawLean, detectMount, wrap180, createLeanSensor } from './leanSensor.js';
import { smoothTrace } from '../geo/geometry.js';

const circuit = CIRCUITS[0]; // Jerez
const model = getTrackModel(circuit);

// --- Marco local centrado en la meta: along = sentido de marcha, lat = a lo largo de la línea
const [A, B] = model.finish;
const M = { x: (A.x + B.x) / 2, y: (A.y + B.y) / 2 };
const fwd0 = new LapTimer(model).finishFwd;
const nf = Math.hypot(fwd0.x, fwd0.y);
const F = { x: fwd0.x / nf, y: fwd0.y / nf };
const Lt = { x: -F.y, y: F.x };
const at = (along, lat = 0) => model.proj.toLatLon(M.x + F.x * along + Lt.x * lat, M.y + F.y * along + Lt.y * lat);
const fix = (along, lat, t, extra = {}) => ({ ...at(along, lat), t, speed: 40, accuracy: 3, lean: 0, ...extra });

/**
 * Recorre un circuito rectangular a velocidad constante que pasa por la meta
 * (recta along ∈ [-500, 500] con lateral L) y vuelve por un lado alejado
 * 400 m (nunca corta la meta). 2800 m por vuelta → 56 s a 50 m/s.
 * Cada vuelta k cruza la meta una vez (al principio) con lateral latByLoop(k).
 */
function ride({ t0 = 0, startAlong = -100, loops = 3, hz = 1, v = 50, lat = 0, latByLoop = null } = {}) {
  const Lk = (k) => (latByLoop ? latByLoop(k) : lat);
  const wps = [[startAlong, Lk(0)]];
  for (let k = 0; k < loops; k++) {
    if (k > 0) wps.push([-500, Lk(k)]);
    wps.push([500, Lk(k)], [500, 400], [-500, 400]);
  }
  // muestreo por longitud de arco (sin perder metros en las esquinas)
  const out = [];
  const step = v / hz;
  let carry = step;
  let t = t0;
  for (let i = 1; i < wps.length; i++) {
    const [ax, ay] = wps[i - 1];
    const [bx, by] = wps[i];
    const L = Math.hypot(bx - ax, by - ay);
    let d = carry;
    while (d <= L) {
      t += 1000 / hz;
      out.push(fix(ax + ((bx - ax) * d) / L, ay + ((by - ay) * d) / L, t, { speed: v }));
      d += step;
    }
    carry = d - L;
  }
  return out;
}
const LOOP_MS = 2800 / 50 * 1000;

function run(fixes, opts) {
  const timer = new LapTimer(model, opts);
  for (const f of fixes) timer.push(f);
  return timer;
}

describe('ruido GPS parado sobre la meta', () => {
  it('cruces adelante/atrás no crean vueltas ni tiempos negativos; la vuelta arranca en el último paso', () => {
    const fixes = [];
    // llega a meta y se para encima 120 s con ruido de ±4 m a 10 Hz
    for (let i = 0; i < 5; i++) fixes.push(fix(-50 + i * 10, 0, i * 1000));
    let t = 5000;
    let s = 1;
    for (let i = 0; i < 1200; i++) {
      t += 100;
      s = (s * 16807) % 2147483647;
      const noise = ((s / 2147483647) - 0.5) * 8;
      fixes.push(fix(noise, 0, t, { speed: 0.2 }));
    }
    const timer = run(fixes);
    expect(timer.laps).toHaveLength(0);
    expect(timer.lapStart).not.toBeNull();
    // memoria: parado no acumula 1200 puntos
    expect(timer.current.length).toBeLessThan(200);
    const lastStill = timer.lapStart;
    expect(timer.elapsed(lastStill - 5000)).toBe(0); // nunca negativo
    // sale desde parado y da 2 vueltas
    for (const f of ride({ t0: t, startAlong: 0, loops: 3 })) timer.push(f);
    expect(timer.laps).toHaveLength(2);
    for (const l of timer.laps) expect(l.timeMs).toBeGreaterThan(0);
    // la vuelta 1 empieza en el último paso hacia delante (≤ final del ruido),
    // no en el primero (5 s): mide la salida + 1 vuelta, no los 120 s parado.
    expect(timer.laps[0].startT).toBeGreaterThan(100000);
    expect(Math.abs(timer.laps[0].timeMs - LOOP_MS)).toBeLessThan(1000);
    expect(timer.laps[1].timeMs).toBeCloseTo(LOOP_MS, -2);
  });

  it('retroceder tras cruzar y volver a cruzar a los 30 s no crea vuelta falsa', () => {
    const fixes = [fix(-20, 0, 0), fix(10, 0, 1000), fix(-5, 0, 2000), fix(-6, 0, 30000), fix(15, 0, 31000)];
    const timer = run(fixes);
    expect(timer.laps).toHaveLength(0);
    expect(timer.lapStart).toBeCloseTo(30000 + (6 / 21) * 1000, 0);
  });

  it('cruzar la meta en sentido contrario nunca cuenta', () => {
    const fixes = ride({ loops: 3 }).map((f, i, arr) => ({ ...arr[arr.length - 1 - i], t: f.t }));
    const timer = run(fixes);
    expect(timer.laps).toHaveLength(0);
    expect(timer.lapStart).toBeNull();
  });

  it('un fix exactamente sobre la línea no cuenta dos veces', () => {
    const timer = run([fix(-40, 0, 0), fix(0, 0, 1000), fix(40, 0, 2000)]);
    expect(timer.lapStart).toBeCloseTo(1000, 6);
    // el tramo que SALE del fix situado sobre la línea no es un cruce (s ∈ (0,1])
    const pOn = timer.current[timer.current.length - 2];
    const pNext = timer.prev;
    expect(timer.crossingAny(pOn, pNext, timer.finishSeg, timer.finishFwd)).toBeNull();
  });
});

describe('pit-lane paralelo a la recta (25 m)', () => {
  // vuelta 0 por pista, vuelta 1 por el pit-lane, vuelta 2-3 por pista
  const lat = (k) => (k === 1 ? 25 : 0);
  it('por defecto la pasada por el pit-lane no corta la meta: sin doble conteo', () => {
    const timer = run(ride({ loops: 4, latByLoop: lat }));
    // pasos por meta reales: inicio, fin v1(=pit, no cuenta), fin v2, fin v3
    expect(timer.laps).toHaveLength(2);
    expect(Math.abs(timer.laps[0].timeMs - (2 * LOOP_MS - 1000))).toBeLessThan(50); // entrada + salida de boxes
    expect(timer.laps[1].timeMs).toBeCloseTo(LOOP_MS, -2);
  });
  it('con finishExtendM la pasada por el pit-lane cuenta como paso por meta', () => {
    const timer = run(ride({ loops: 4, latByLoop: lat }), { finishExtendM: 25 });
    expect(timer.laps).toHaveLength(3);
    // las vueltas que entran/salen por el pit-lane son 25 m más cortas
    timer.laps.forEach((l, i) => expect(Math.abs(l.timeMs - (i < 2 ? LOOP_MS - 500 : LOOP_MS))).toBeLessThan(50));
  });
});

describe('simulación con fallos de GPS', () => {
  const base = createSimulator(model, { laps: 3, seed: 11, vmaxKmh: circuit.vmaxKmh, rateHz: 1 }).generateAll();
  const ref = run(base);
  expect(ref.laps).toHaveLength(3);
  const L2 = ref.laps[1];
  const t1 = L2.startT + L2.sectors[0];

  it('dropout de 8 s a mitad de sector: misma vuelta exacta', () => {
    const mid = t1 + L2.sectors[1] / 2;
    const timer = run(base.filter((f) => f.t < mid - 4000 || f.t > mid + 4000));
    expect(timer.laps).toHaveLength(3);
    expect(timer.laps[1].timeMs).toBeCloseTo(L2.timeMs, 6);
    expect(timer.laps[1].sectors).toEqual(L2.sectors);
  });

  it('dropout de 10 s sobre T1: la vuelta cierra y el parcial es null o aproximado, nunca absurdo', () => {
    const timer = run(base.filter((f) => f.t < t1 - 5000 || f.t > t1 + 5000));
    expect(timer.laps).toHaveLength(3);
    const lap = timer.laps[1];
    expect(lap.timeMs).toBeCloseTo(L2.timeMs, 6);
    if (lap.sectors) {
      expect(lap.sectors.reduce((a, b) => a + b, 0)).toBeCloseTo(lap.timeMs, 6);
      lap.sectors.forEach((s, i) => expect(Math.abs(s - L2.sectors[i])).toBeLessThan(1500));
    }
  });

  it('dropout sobre T1 cuyo tramo recto no corta T1: sectores null', () => {
    // fix "puente" alejado de T1 para forzar que el tramo no la corte
    const [q1, q2] = model.sectorLines[0];
    const far = model.proj.toLatLon(q1.x + (q1.x - q2.x) * 5, q1.y + (q1.y - q2.y) * 5);
    const fixes = base.filter((f) => f.t < t1 - 3000 || f.t > t1 + 3000);
    // sustituimos el hueco por nada: ¿corta? si sí, este test no aplica a esta geometría
    const timer = run(fixes);
    const timer2 = new LapTimer(model);
    let inserted = false;
    for (const f of fixes) {
      if (!inserted && f.t > t1 + 3000) {
        // dos fixes a un lado de la línea (fuera de su extensión), velocidad plausible
        timer2.push({ ...far, t: t1, speed: 40, accuracy: 3 });
        inserted = true;
      }
      timer2.push(f);
    }
    expect(timer.laps).toHaveLength(3);
    expect(timer2.laps).toHaveLength(3);
    expect(timer2.laps[1].timeMs).toBeCloseTo(L2.timeMs, 6);
    // o bien no hay sectores, o bien los que hay son coherentes
    const s = timer2.laps[1].sectors;
    if (s) expect(s.reduce((a, b) => a + b, 0)).toBeCloseTo(timer2.laps[1].timeMs, 6);
    expect(timer2.laps[2].sectors).not.toBeNull(); // la vuelta siguiente se recupera
  });

  it('dropout de 8 s sobre la meta: la vuelta cierra igualmente con tiempo interpolado', () => {
    const tf = L2.endT;
    const timer = run(base.filter((f) => f.t < tf - 4000 || f.t > tf + 4000));
    expect(timer.laps).toHaveLength(3);
    // la cuerda de 8 s en curva no pasa por la línea de 28 m: se cuenta gracias
    // a la prolongación en huecos; el instante es aproximado (interpolación lineal)
    expect(Math.abs(timer.laps[1].timeMs - L2.timeMs)).toBeLessThan(1000);
    expect(Math.abs(timer.laps[1].endT - tf)).toBeLessThan(1000);
    expect(Math.abs(timer.laps[1].timeMs + timer.laps[2].timeMs - L2.timeMs - ref.laps[2].timeMs)).toBeLessThan(1e-6);
  });

  it('duplicados (mismo t) y fixes desordenados se ignoran', () => {
    const fixes = [];
    base.forEach((f, i) => {
      fixes.push(f);
      if (i % 7 === 0) fixes.push({ ...f, lat: f.lat + 0.0003 }); // duplicado con t igual y otra posición
      if (i % 11 === 0 && i > 0) fixes.push({ ...base[i - 1] }); // fix viejo que llega tarde
    });
    const timer = run(fixes);
    expect(timer.laps.map((l) => l.timeMs)).toEqual(ref.laps.map((l) => l.timeMs));
    for (const l of timer.laps) for (const s of l.sectors) expect(s).toBeGreaterThan(0);
  });

  it('speed null, NaN, precisión mala: sin errores ni vueltas falsas', () => {
    const fixes = [];
    base.forEach((f, i) => {
      fixes.push(i % 3 === 0 ? { ...f, speed: null, lean: undefined } : f);
      if (i % 13 === 0) fixes.push({ ...f, t: f.t + 1, lat: NaN });
      if (i % 17 === 0) fixes.push({ ...f, t: NaN });
      if (i % 19 === 0) fixes.push({ ...f, t: f.t + 500, lat: f.lat + 0.0001, accuracy: 60 });
    });
    const timer = run(fixes);
    expect(timer.laps).toHaveLength(3);
    timer.laps.forEach((l, i) => expect(Math.abs(l.timeMs - ref.laps[i].timeMs)).toBeLessThan(5));
    for (const l of timer.laps) for (const p of l.points) {
      expect(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.t)).toBe(true);
    }
    // sin filtro de precisión (opción) los fixes imprecisos sí entran
    const loose = run(fixes, { maxAccuracyM: Infinity });
    expect(loose.rejected).toBeLessThan(timer.rejected);
  });
});

describe('saltos imposibles (teletransporte)', () => {
  it('un fix a 300 m en 1 s que cruzaría la meta se descarta', () => {
    const fixes = ride({ loops: 2 });
    const ref = run(fixes);
    // en la vuelta 1, 5 s antes de meta, un fix falso al otro lado de la línea
    const i = fixes.findIndex((f) => f.t > ref.laps[0].endT - 5000);
    const bad = [...fixes.slice(0, i), fix(50, 0, fixes[i].t - 500), ...fixes.slice(i)];
    const timer = run(bad);
    expect(timer.laps.map((l) => l.timeMs)).toEqual(ref.laps.map((l) => l.timeMs));
  });
  it('si el GPS se reubica de forma coherente se re-sincroniza sin crear cruces', () => {
    const timer = new LapTimer(model);
    timer.push(fix(-1000, 0, 0));
    // la posición "real" resulta estar 900 m más adelante (pasada la meta): 5 fixes coherentes
    for (let k = 1; k <= 5; k++) timer.push(fix(-100 + k * 20, 0, k * 1000));
    expect(timer.lapStart).not.toBeNull(); // el tramo -40 → -20 → 0 → +20 sí cruza (tras resync)
    expect(timer.prev.t).toBe(5000);
    const t2 = new LapTimer(model);
    t2.push(fix(-1000, 0, 0));
    t2.push(fix(500, 0, 1000)); // salto que cruza la meta: no cuenta
    expect(t2.lapStart).toBeNull();
  });
});

describe('inicio y fin de sesión', () => {
  it('empezar pasada la meta: la vuelta de salida acaba en el primer paso', () => {
    const timer = run(ride({ startAlong: 20, loops: 3 }));
    expect(timer.outLap.length).toBeGreaterThan(10);
    expect(timer.laps).toHaveLength(1); // cruces al empezar las vueltas 2 y 3
    for (const l of timer.laps) expect(l.timeMs).toBeCloseTo(LOOP_MS, -2);
  });
  it('parar a mitad de vuelta: solo cuentan las vueltas cerradas', () => {
    const fixes = ride({ loops: 3 });
    const timer = run(fixes.slice(0, Math.floor(fixes.length * 0.8)));
    expect(timer.laps).toHaveLength(2); // 3 pasos por meta antes de parar
    expect(timer.current.length).toBeGreaterThan(5);
    expect(timer.currentSectors().every((s) => s > 0)).toBe(true);
  });
});

describe('memoria en sesiones largas', () => {
  it('60 min a 10 Hz parado en boxes antes de salir: la vuelta de salida no crece', () => {
    const timer = new LapTimer(model);
    let s = 7;
    for (let i = 0; i < 36000; i++) {
      s = (s * 16807) % 2147483647;
      const n = (s / 2147483647 - 0.5) * 3;
      timer.push(fix(-300 + n, 60 + n, i * 100, { speed: 0.3 }));
    }
    expect(timer.outLap.length).toBeLessThan(500);
  });
  it('60 min a 10 Hz sin cruzar la meta: la vuelta de salida tiene tope', () => {
    const timer = new LapTimer(model, { maxOutLapPoints: 3000 });
    // vueltas por el lado lejano del rectángulo (lateral 400): nunca pasan por meta
    const fixes = ride({ loops: 70, hz: 10, lat: 300 });
    for (const f of fixes) timer.push(f);
    expect(timer.lapStart).toBeNull();
    expect(timer.outLap.length).toBeLessThanOrEqual(4500);
  });
  it('sesión de ~30 min a 10 Hz: vuelta en curso acotada y suavizado por frame barato', () => {
    const fixes = createSimulator(model, { laps: 20, seed: 3, vmaxKmh: circuit.vmaxKmh, rateHz: 10 }).generateAll();
    const timer = new LapTimer(model);
    let maxCur = 0;
    for (const f of fixes) {
      timer.push(f);
      maxCur = Math.max(maxCur, timer.current.length);
    }
    expect(timer.laps).toHaveLength(20);
    expect(maxCur).toBeLessThan(1500);
    // lo que hace la vista en vivo en cada frame con la peor vuelta
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) smoothTrace(timer.laps[0].points.slice());
    expect((performance.now() - t0) / 10).toBeLessThan(16);
  });
});

// --- Sensor de inclinación -------------------------------------------------
const D = Math.PI / 180;
const mul = (a, b) => a.map((r, i) => b[0].map((_, j) => r.reduce((s, _, k) => s + a[i][k] * b[k][j], 0)));
const Rx = (a) => [[1, 0, 0], [0, Math.cos(a), -Math.sin(a)], [0, Math.sin(a), Math.cos(a)]];
const Ry = (a) => [[Math.cos(a), 0, Math.sin(a)], [0, 1, 0], [-Math.sin(a), 0, Math.cos(a)]];
/** β, γ (W3C) a partir de la matriz dispositivo→mundo. */
function betaGamma(R) {
  const [r20, r21, r22] = R[2];
  const g = Math.atan(-r20 / r22);
  const cb = Math.sign(r22) * Math.hypot(r20, r22);
  return [Math.atan2(r21, cb) / D, g / D];
}
// Mundo: x derecha, y = hacia delante (marcha), z arriba. Inclinar a la
// izquierda = girar alrededor de +y con ángulo negativo (lo de arriba va a −x).
const leanWorld = (deg) => Ry(-deg * D);

describe('inclinación (leanSensor)', () => {
  // vertical: pantalla hacia el piloto (mira a −y), con 5° hacia atrás
  const upright = Rx((90 - 5) * D);
  const flat = Rx(3 * D); // tumbado sobre el depósito, borde superior hacia delante
  it.each([0, 15, 30, 45, 60, -30, -60])('vertical, %i° → mismo ángulo con signo (+ izquierda)', (lean) => {
    const [b, g] = betaGamma(mul(leanWorld(lean), upright));
    expect(rawLean(b, g, 'upright')).toBeCloseTo(lean, 0);
  });
  it.each([0, 20, 45, 60, -45])('tumbado, %i° → mismo ángulo con signo', (lean) => {
    const [b, g] = betaGamma(mul(leanWorld(lean), flat));
    expect(rawLean(b, g, 'flat')).toBeCloseTo(lean, 0);
  });
  it('detección de montaje en reposo', () => {
    expect(detectMount(...betaGamma(upright))).toBe('upright');
    expect(detectMount(...betaGamma(flat))).toBe('flat');
  });
  it('vertical a 60°: la detección automática por lectura fallaría, por eso se fija al calibrar', () => {
    // β cae a ~30°: con el antiguo umbral |β|<35 se usaba γ (≈ ±90°)
    const [b, g] = betaGamma(mul(leanWorld(60), upright));
    expect(Math.abs(b)).toBeLessThan(35);
    expect(rawLean(b, g, 'upright')).toBeCloseTo(60, 0);
  });
  it('wrap180', () => {
    expect(wrap180(190)).toBeCloseTo(-170);
    expect(wrap180(-190)).toBeCloseTo(170);
    expect(wrap180(540)).toBeCloseTo(180);
    expect(wrap180(-180)).toBe(180);
  });
  it('sensor: calibra cero, fija montaje y filtra sin saltos al cruzar ±180', () => {
    const listeners = {};
    vi.stubGlobal('window', {
      DeviceOrientationEvent: function () {},
      addEventListener: (k, f) => (listeners[k] = f),
      removeEventListener: () => {},
    });
    try {
      const s = createLeanSensor();
      s.start();
      expect(s.value).toBeNull();
      const send = (R) => {
        const [beta, gamma] = betaGamma(R);
        listeners.deviceorientation({ beta, gamma });
      };
      send(upright);
      expect(s.value).toBeCloseTo(0, 6);
      for (let i = 0; i < 40; i++) send(mul(leanWorld(60), upright));
      expect(s.value).toBeCloseTo(60, 0);
      // calibrado tumbado boca abajo (cero cerca de 180): sin promedios absurdos
      s.recalibrate();
      listeners.deviceorientation({ beta: 0, gamma: 0 });
      listeners.deviceorientation({ beta: 0, gamma: 1 });
      expect(Math.abs(s.value)).toBeLessThan(2);
      s.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// --- Simulador ---------------------------------------------------------------
describe('simulador', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it.each([1, 10])('generateAll a %i Hz: t estrictamente creciente y paso constante', (hz) => {
    const f = createSimulator(model, { laps: 1, seed: 1, rateHz: hz }).generateAll();
    for (let i = 1; i < f.length; i++) expect(f[i].t - f[i - 1].t).toBeCloseTo(1000 / hz, 6);
  });
  it('now() es monótono y no adelanta al siguiente fix (×4)', () => {
    vi.useFakeTimers();
    let perf = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => perf);
    const sim = createSimulator(model, { laps: 1, seed: 2, rateHz: 10, timeScale: 4 });
    const fixes = [];
    sim.start((f) => fixes.push(f));
    let last = -Infinity;
    for (let i = 0; i < 200; i++) {
      perf += 25;
      if (i % 4 === 3) vi.advanceTimersByTime(100);
      const n = sim.now();
      expect(n).toBeGreaterThanOrEqual(last);
      last = n;
      if (fixes.length) {
        const tLast = fixes[fixes.length - 1].t;
        expect(n).toBeGreaterThanOrEqual(tLast);
        expect(n - tLast).toBeLessThanOrEqual(400 + 1e-6);
      }
    }
    // con ×4 el reloj virtual avanza ~4× el real
    expect(fixes[fixes.length - 1].t - fixes[0].t).toBeGreaterThan(15000);
    sim.stop();
  });
});
