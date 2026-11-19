// Análisis post-sesión: lista de sesiones, vueltas (mejor destacada) y
// comparación visual de la vuelta elegida (roja) con la trazada ideal (verde).

import React, { useEffect, useMemo, useState } from 'react';
import TrackMap from '../components/TrackMap.jsx';
import TraceChart from '../components/TraceChart.jsx';
import { getCircuit, getTrackModel } from '../data/circuits.js';
import { analyzeLap } from '../telemetry/analysis.js';
import { deleteSession, listSessions, unpackLap } from '../storage/sessions.js';
import { formatDate, formatDelta, formatLap } from '../utils/format.js';

export default function AnalysisView({ sessionId, onSelectSession, onGoLive }) {
  const [sessions, setSessions] = useState(null);
  const [lapNo, setLapNo] = useState(null);
  const [hover, setHover] = useState(null);

  const refresh = () => listSessions().then(setSessions);
  useEffect(() => {
    refresh();
  }, [sessionId]);

  const session = sessions?.find((s) => s.id === sessionId) ?? sessions?.[0] ?? null;
  const circuit = session ? getCircuit(session.circuitId) : null;
  const model = circuit ? getTrackModel(circuit) : null;

  const laps = useMemo(() => {
    if (!session || !model) return [];
    return session.laps.map((l) => {
      const lap = unpackLap(l);
      return { ...lap, stats: analyzeLap(lap.points, model.racingLine) };
    });
  }, [session, model]);

  const best = laps.reduce((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);

  // Por defecto, la vuelta rápida
  useEffect(() => {
    setLapNo(best?.number ?? null);
    setHover(null);
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lap = laps.find((l) => l.number === lapNo) ?? best;
  const marker = lap && hover != null ? lap.points[lap.stats.trace[hover]?.i] : null;

  if (sessions === null) return <div className="p-6 text-zinc-500">Cargando…</div>;

  if (!sessions.length)
    return (
      <div className="mx-auto max-w-md px-6 pt-16 text-center">
        <div className="text-4xl">🏁</div>
        <h2 className="mt-3 text-lg font-bold">Aún no hay sesiones</h2>
        <p className="mt-1 text-sm text-zinc-400">Graba una tanda en pista o usa el simulador para generar vueltas de prueba.</p>
        <button onClick={onGoLive} className="mt-5 rounded-xl bg-ideal px-5 py-3 font-bold text-black">
          Ir a Grabación
        </button>
      </div>
    );

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 pb-28 pt-4 lg:flex-row">
      {/* Columna izquierda: sesiones + vueltas */}
      <aside className="flex flex-col gap-3 lg:w-80 lg:shrink-0">
        <label className="block">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Sesión</span>
          <select
            value={session.id}
            onChange={(e) => onSelectSession(e.target.value)}
            className="mt-1 w-full rounded-xl border border-edge bg-panel px-3 py-2.5 text-sm"
          >
            {sessions.map((s) => {
              const c = getCircuit(s.circuitId);
              return (
                <option key={s.id} value={s.id}>
                  {c?.short ?? s.circuitId} · {formatDate(s.createdAt)} · {s.laps.length} v{s.source === 'sim' ? ' · SIM' : ''}
                </option>
              );
            })}
          </select>
        </label>

        <div className="overflow-hidden rounded-2xl border border-edge bg-panel">
          <div className="flex items-center justify-between border-b border-edge px-3 py-2">
            <span className="text-sm font-semibold">{circuit?.name}</span>
            {session.source === 'sim' && (
              <span className="rounded bg-amber-400/10 px-1.5 py-0.5 font-mono text-[10px] text-amber-300">SIM</span>
            )}
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-1.5 font-medium">V</th>
                <th className="py-1.5 font-medium">Tiempo</th>
                <th className="py-1.5 font-medium">Δ</th>
                <th className="py-1.5 pr-3 text-right font-medium">Desv.</th>
              </tr>
            </thead>
            <tbody>
              {laps.map((l) => {
                const isBest = l === best;
                const sel = l === lap;
                return (
                  <tr
                    key={l.number}
                    onClick={() => {
                      setLapNo(l.number);
                      setHover(null);
                    }}
                    className={`cursor-pointer border-t border-edge/60 font-mono tabular ${sel ? 'bg-white/[0.06]' : 'hover:bg-white/[0.03]'}`}
                  >
                    <td className="px-3 py-2.5 text-zinc-400">
                      <span className={`inline-block w-1 rounded-full align-middle ${sel ? 'h-4 bg-rider' : 'h-0'}`} /> {l.number}
                    </td>
                    <td className={`py-2.5 font-semibold ${isBest ? 'text-violet-300' : ''}`}>
                      {formatLap(l.timeMs)}
                      {isBest && <span className="ml-1.5 rounded bg-violet-500/20 px-1 text-[9px] text-violet-300">RÁPIDA</span>}
                    </td>
                    <td className={`py-2.5 text-xs ${isBest ? 'text-zinc-500' : 'text-rider/90'}`}>
                      {isBest ? '—' : formatDelta(l.timeMs - best.timeMs)}
                    </td>
                    <td className="py-2.5 pr-3 text-right text-xs text-zinc-300">{l.stats.avgDeviationM.toFixed(2)} m</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <button
          type="button"
          onClick={async () => {
            if (!confirm('¿Borrar esta sesión?')) return;
            await deleteSession(session.id);
            onSelectSession(null);
            refresh();
          }}
          className="self-start text-xs text-zinc-500 underline-offset-2 hover:text-red-300 hover:underline"
        >
          Borrar sesión
        </button>
      </aside>

      {/* Columna derecha: mapa + métricas */}
      {lap && model && (
        <section className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric label="Tiempo" value={formatLap(lap.timeMs)} accent={lap === best ? 'text-violet-300' : ''} />
            <Metric label="Vel. máx" value={`${Math.round(lap.stats.maxSpeedKmh)}`} unit="km/h" />
            <Metric label="Desv. media" value={lap.stats.avgDeviationM.toFixed(2)} unit="m" />
            <Metric label="Desv. máx" value={lap.stats.maxDeviationM.toFixed(1)} unit="m" />
          </div>

          <div className="relative overflow-hidden rounded-2xl border border-edge">
            <TrackMap
              model={model}
              riderPoints={lap.points}
              marker={marker}
              className="h-[52vh] min-h-[320px] bg-[#0b0e12]"
            />
            <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-lg bg-black/60 px-2.5 py-2 text-[11px] backdrop-blur">
              <span className="flex items-center gap-2"><i className="h-0.5 w-5 rounded bg-ideal" /> Trazada ideal</span>
              <span className="flex items-center gap-2"><i className="h-0.5 w-5 rounded bg-rider" /> Vuelta {lap.number}</span>
            </div>
          </div>
          <p className="text-[11px] text-zinc-500">
            Rueda / pellizco para zoom, arrastra para mover, doble clic para acercar una curva. Desliza sobre las gráficas para situar el punto en el mapa.
          </p>

          <div className="grid gap-3 rounded-2xl border border-edge bg-panel p-3 xl:grid-cols-2">
            <TraceChart
              trace={lap.stats.trace}
              value={(d) => d.v * 3.6}
              title="Velocidad"
              unit="km/h"
              color="#38bdf8"
              hoverIndex={hover}
              onHover={setHover}
            />
            <TraceChart
              trace={lap.stats.trace}
              value={(d) => d.dev}
              title="Desviación vs ideal (+izq/−dcha)"
              unit="m"
              color="#ef4444"
              symmetric
              format={(v) => v.toFixed(1)}
              hoverIndex={hover}
              onHover={setHover}
            />
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ label, value, unit, accent = 'text-zinc-50' }) {
  return (
    <div className="rounded-xl border border-edge bg-panel px-3 py-2">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-mono text-xl font-bold tabular ${accent}`}>
        {value}
        {unit && <span className="ml-1 text-xs font-normal text-zinc-500">{unit}</span>}
      </div>
    </div>
  );
}
