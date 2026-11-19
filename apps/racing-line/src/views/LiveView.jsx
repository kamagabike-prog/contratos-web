// Grabación en vivo: cronómetro, paso por meta automático, mapa con la
// trazada ideal (verde) y la del piloto (rojo). Fuente: GPS real o simulador.

import React, { useCallback, useEffect, useRef, useState } from 'react';
import TrackMap from '../components/TrackMap.jsx';
import { getTrackModel } from '../data/circuits.js';
import { LapTimer } from '../telemetry/lapTimer.js';
import { createSimulator } from '../telemetry/simulator.js';
import { createGpsSource, isGeolocationAvailable, requestWakeLock } from '../telemetry/gpsSource.js';
import { packLap, saveSession } from '../storage/sessions.js';
import { formatDelta, formatLap } from '../utils/format.js';

const SIM_SPEEDS = [1, 4, 10];

export default function LiveView({ circuit, onFinished }) {
  const model = getTrackModel(circuit);
  const [mode, setMode] = useState('sim'); // 'sim' | 'gps'
  const [simSpeed, setSimSpeed] = useState(4);
  const [simLaps, setSimLaps] = useState(3);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const [view, setView] = useState({ elapsed: null, laps: [], trail: [], marker: null, speed: null, acc: null, fixes: 0 });
  const [flash, setFlash] = useState(null);

  const timerRef = useRef(null);
  const sourceRef = useRef(null);
  const lastFix = useRef(null);
  const fixCount = useRef(0);
  const rafRef = useRef(0);
  const wakeRef = useRef(null);
  const startedAt = useRef(0);

  // Bucle de render a ~30 fps independiente de la frecuencia del GPS
  const loop = useCallback(() => {
    const timer = timerRef.current;
    const src = sourceRef.current;
    if (!timer || !src) return;
    const f = lastFix.current;
    const p = f ? model.proj.toXY(f.lat, f.lon) : null;
    setView({
      elapsed: timer.elapsed(src.now()),
      laps: timer.laps,
      trail: timer.lapStart === null ? timer.outLap.slice() : timer.current.slice(),
      marker: p,
      speed: f?.speed ?? null,
      acc: f?.accuracy ?? null,
      fixes: fixCount.current,
    });
    rafRef.current = requestAnimationFrame(loop);
  }, [model]);

  const stop = useCallback(async () => {
    cancelAnimationFrame(rafRef.current);
    sourceRef.current?.stop();
    wakeRef.current?.release?.().catch(() => {});
    wakeRef.current = null;
    setRunning(false);
    const timer = timerRef.current;
    const src = sourceRef.current;
    timerRef.current = null;
    sourceRef.current = null;
    if (!timer) return;
    if (timer.laps.length === 0) {
      setError('Sesión detenida sin vueltas completas: no se ha guardado.');
      return;
    }
    const session = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      circuitId: circuit.id,
      createdAt: startedAt.current,
      source: src?.kind ?? mode,
      laps: timer.laps.map(packLap),
    };
    await saveSession(session);
    onFinished(session.id);
  }, [circuit.id, mode, onFinished]);

  const stopRef = useRef(stop);
  stopRef.current = stop;

  const start = async () => {
    setError(null);
    if (mode === 'gps' && !isGeolocationAvailable()) {
      setError('Este dispositivo/navegador no ofrece geolocalización.');
      return;
    }
    const timer = new LapTimer(model);
    const src =
      mode === 'sim'
        ? createSimulator(model, { laps: simLaps, timeScale: simSpeed, vmaxKmh: circuit.vmaxKmh, pace: 0.9 })
        : createGpsSource();
    timerRef.current = timer;
    sourceRef.current = src;
    lastFix.current = null;
    fixCount.current = 0;
    startedAt.current = Date.now();
    wakeRef.current = await requestWakeLock();
    setRunning(true);
    src.start(
      (fix) => {
        fixCount.current++;
        lastFix.current = fix;
        const lap = timer.push(fix);
        if (lap) {
          setFlash(lap.number);
          navigator.vibrate?.(200);
          setTimeout(() => setFlash(null), 2500);
        }
      },
      () => stopRef.current(),
      (err) => setError(`GPS: ${err.message || 'error'}`)
    );
    rafRef.current = requestAnimationFrame(loop);
  };

  // Limpieza al salir de la vista
  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      sourceRef.current?.stop();
    },
    []
  );

  const laps = view.laps;
  const best = laps.reduce((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);
  const last = laps[laps.length - 1];
  const delta = last && best && laps.length > 1 ? last.timeMs - best.timeMs : null;
  const inOutLap = running && view.elapsed == null;

  return (
    <div className="flex h-full flex-col">
      {/* Panel de tiempos */}
      <div className="border-b border-edge bg-panel px-4 pb-3 pt-3">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-wider text-zinc-400">
          <span className="font-semibold text-zinc-300">{circuit.short}</span>
          <span className="flex items-center gap-2 font-mono">
            <span className={`h-2 w-2 rounded-full ${running ? (mode === 'sim' ? 'bg-amber-400' : 'bg-ideal') + ' animate-pulse' : 'bg-zinc-600'}`} />
            {running ? (mode === 'sim' ? `SIM ×${simSpeed}` : 'GPS') : 'EN ESPERA'}
            {running && view.acc != null && <span className="text-zinc-500">±{view.acc.toFixed(1)}m</span>}
          </span>
        </div>

        <div className="mt-1 flex items-end justify-between gap-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">
              {inOutLap ? 'Vuelta de salida' : `Vuelta ${laps.length + 1}`}
            </div>
            <div
              className={`font-mono text-5xl font-bold leading-none tabular sm:text-6xl ${
                flash ? 'text-violet-300' : 'text-zinc-50'
              }`}
            >
              {flash && last ? formatLap(last.timeMs) : formatLap(view.elapsed)}
            </div>
          </div>
          <div className="text-right">
            <div className="font-mono text-4xl font-bold leading-none tabular text-zinc-100">
              {view.speed == null ? '--' : Math.round(view.speed * 3.6)}
            </div>
            <div className="text-[11px] uppercase tracking-wider text-zinc-500">km/h</div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-2">
          <Stat label="Última" value={formatLap(last?.timeMs)} />
          <Stat label="Mejor" value={formatLap(best?.timeMs)} accent="text-violet-300" />
          <Stat
            label="Δ mejor"
            value={delta == null ? '—' : formatDelta(delta)}
            accent={delta == null ? '' : delta <= 0 ? 'text-ideal' : 'text-rider'}
          />
        </div>
      </div>

      {/* Mapa */}
      <TrackMap
        model={model}
        riderPoints={view.trail}
        marker={view.marker}
        follow={running}
        className="min-h-[200px] flex-1 bg-[#0b0e12]"
        overlay={
          flash && (
            <div className="pointer-events-none absolute inset-x-0 top-3 mx-auto w-max rounded-full bg-violet-500/90 px-4 py-1 font-mono text-sm font-bold">
              VUELTA {flash} · {formatLap(last?.timeMs)}
            </div>
          )
        }
      />

      {/* Controles */}
      <div className="border-t border-edge bg-panel px-4 pb-[calc(env(safe-area-inset-bottom)+5.5rem)] pt-3">
        {!running && (
          <div className="mb-3 space-y-2">
            <div className="grid grid-cols-2 gap-2 rounded-xl bg-black/40 p-1">
              <Seg active={mode === 'gps'} onClick={() => setMode('gps')}>GPS real</Seg>
              <Seg active={mode === 'sim'} onClick={() => setMode('sim')}>Simular vuelta GPS</Seg>
            </div>
            {mode === 'sim' && (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-zinc-400">
                <label className="flex items-center gap-2">
                  Vueltas
                  <select
                    value={simLaps}
                    onChange={(e) => setSimLaps(+e.target.value)}
                    className="rounded-md border border-edge bg-panel2 px-2 py-1 font-mono text-zinc-100"
                  >
                    {[1, 2, 3, 5, 8].map((n) => <option key={n}>{n}</option>)}
                  </select>
                </label>
                <span className="flex items-center gap-1">
                  Velocidad
                  {SIM_SPEEDS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setSimSpeed(s)}
                      className={`rounded-md px-2 py-1 font-mono ${simSpeed === s ? 'bg-amber-400/20 text-amber-300' : 'bg-panel2 text-zinc-300'}`}
                    >
                      ×{s}
                    </button>
                  ))}
                </span>
              </div>
            )}
            {mode === 'gps' && (
              <p className="text-xs text-zinc-500">
                Usa GPS de alta precisión. La vuelta empieza al cruzar la línea de meta. Coloca el móvil con vista despejada al cielo.
              </p>
            )}
          </div>
        )}
        {error && <p className="mb-2 rounded-lg bg-rider/10 px-3 py-2 text-xs text-red-300">{error}</p>}
        <button
          type="button"
          onClick={running ? stop : start}
          className={`h-20 w-full rounded-2xl text-xl font-extrabold uppercase tracking-wide shadow-lg transition active:scale-[0.98] ${
            running ? 'bg-rider text-white shadow-rider/20' : 'bg-ideal text-black shadow-ideal/20'
          }`}
        >
          {running ? '■ Detener sesión' : mode === 'sim' ? '▶ Simular tanda' : '● Iniciar sesión / Grabar tanda'}
        </button>
        {running && <p className="mt-2 text-center font-mono text-[10px] text-zinc-500">{view.fixes} fixes GPS</p>}
      </div>
    </div>
  );
}

function Stat({ label, value, accent = 'text-zinc-100' }) {
  return (
    <div className="rounded-lg bg-black/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono text-base font-semibold tabular sm:text-lg ${accent}`}>{value}</div>
    </div>
  );
}

function Seg({ active, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-lg py-2.5 text-sm font-semibold transition ${active ? 'bg-zinc-100 text-black' : 'text-zinc-400'}`}
    >
      {children}
    </button>
  );
}
