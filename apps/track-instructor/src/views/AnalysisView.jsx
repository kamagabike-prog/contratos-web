// Análisis post-sesión: lista de sesiones, vueltas (mejor destacada) y
// comparación visual de la vuelta elegida (roja) con la trazada ideal (verde).

import React, { useEffect, useMemo, useState } from 'react';
import TrackMap from '../components/TrackMap.jsx';
import TraceChart from '../components/TraceChart.jsx';
import ExportImportPanel, { ImportButton } from '../components/ExportImportPanel.jsx';
import DeviceDownloadPanel from '../components/DeviceDownloadPanel.jsx';
import UsagePanel from '../components/UsagePanel.jsx';
import ReferenceLinePanel from '../components/ReferenceLinePanel.jsx';
import { useReferenceLine } from '../components/useReferenceLine.js';
import { formatDuration, sessionUsage } from '../storage/usage.js';
import { distanceTime, timeDelta } from '../telemetry/delta.js';
import { getCircuit, getTrackModel } from '../data/circuits.js';
import { analyzeLap } from '../telemetry/analysis.js';
import { deleteSession, listSessions, unpackLap } from '../storage/sessions.js';
import { formatDate, formatDelta, formatLap } from '../utils/format.js';

export default function AnalysisView({ sessionId, onSelectSession, onGoLive }) {
  const [sessions, setSessions] = useState(null);
  const [lapNo, setLapNo] = useState(null);
  const [hover, setHover] = useState(null);
  const [refChoice, setRefChoice] = useState('auto'); // 'auto' | 'none' | 'best' | nº de vuelta
  const [importStatus, setImportStatus] = useState(null);
  const [full, setFull] = useState(false); // análisis a pantalla completa

  const refresh = () => listSessions().then(setSessions);
  useEffect(() => {
    refresh();
  }, [sessionId]);

  const session = sessions?.find((s) => s.id === sessionId) ?? sessions?.[0] ?? null;
  const circuit = session ? getCircuit(session.circuitId) : null;
  const model = circuit ? getTrackModel(circuit) : null;
  // Línea verde: la trazada de referencia real del circuito si la hay; si no, la calculada
  const reference = useReferenceLine(circuit?.id);
  const idealLine = reference?.points ?? model?.racingLine;

  const laps = useMemo(() => {
    if (!session || !model) return [];
    return session.laps.map((l) => {
      const lap = unpackLap(l);
      return { ...lap, stats: analyzeLap(lap.points, idealLine, model.proj) };
    });
  }, [session, model, idealLine]);

  const best = laps.reduce((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);
  const bestSectors = [0, 1, 2].map((i) => {
    const vals = laps.map((l) => l.sectors?.[i]).filter((v) => v != null);
    return vals.length ? Math.min(...vals) : null;
  });
  const hasLean = laps.some((l) => l.stats.maxLeanDeg != null);

  // Por defecto, la vuelta rápida
  useEffect(() => {
    setLapNo(best?.number ?? null);
    setHover(null);
    setRefChoice('auto');
  }, [session?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const lap = laps.find((l) => l.number === lapNo) ?? best;
  const marker = lap && hover != null ? lap.stats.trace[hover] : null;

  // Vuelta de referencia: por defecto la rápida si la elegida no lo es
  const refKey = refChoice === 'auto' ? (lap && best && lap !== best ? 'best' : 'none') : refChoice;
  const refCandidate = refKey === 'best' ? best : typeof refKey === 'number' ? laps.find((l) => l.number === refKey) : null;
  const refLap = refCandidate && refCandidate !== lap ? refCandidate : null;
  const refSelectValue = refLap ? String(refKey) : 'none';

  // Delta alineado con lap.stats.trace (mismo índice → hover sincronizado)
  const deltaTrace = useMemo(() => {
    if (!lap || !refLap) return null;
    const d = timeDelta(distanceTime(lap.stats), distanceTime(refLap.stats));
    return lap.stats.trace.map((p, i) => ({ s: p.s, d: d[i] }));
  }, [lap, refLap]);
  const deltaRange = deltaTrace ? Math.max(0.5, ...deltaTrace.map((p) => Math.abs(p.d))) : 0.5;

  // Pantalla completa del sistema donde exista (Android, escritorio); en iPhone
  // basta con la capa a pantalla completa. Esc o el gesto de salir la cierran.
  useEffect(() => {
    if (!full) return;
    const fsSupported = !!document.documentElement.requestFullscreen && document.fullscreenEnabled;
    const onKey = (e) => e.key === 'Escape' && setFull(false);
    const onFs = () => !document.fullscreenElement && fsSupported && setFull(false);
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFs);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFs);
      document.body.style.overflow = '';
      if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
    };
  }, [full]);

  const toggleFull = () => {
    if (!full) {
      // se pide dentro del propio toque: los navegadores lo exigen
      const el = document.documentElement;
      if (el.requestFullscreen && document.fullscreenEnabled && !document.fullscreenElement) el.requestFullscreen().catch(() => {});
    }
    setFull((f) => !f);
  };

  const onImported = (s) => {
    onSelectSession(s.id);
    refresh();
  };

  if (sessions === null) return <div className="p-6 text-zinc-500">Cargando…</div>;

  if (!sessions.length)
    return (
      <div className="mx-auto max-w-md px-6 pb-28 pt-16 text-center">
        <div className="text-4xl">🏁</div>
        <h2 className="mt-3 text-lg font-bold">Aún no hay sesiones</h2>
        <p className="mt-1 text-sm text-zinc-400">Graba una tanda en pista o usa el simulador para generar vueltas de prueba.</p>
        <button onClick={onGoLive} className="mt-5 rounded-xl bg-ideal px-5 py-3 font-bold text-black">
          Ir a Grabación
        </button>
        <div className="mt-3 flex justify-center">
          <ImportButton
            onImported={onImported}
            onStatus={setImportStatus}
            className="flex min-h-[44px] items-center gap-1.5 rounded-xl border border-edge bg-panel px-4 text-sm text-zinc-200 hover:bg-white/[0.06]"
          />
        </div>
        {importStatus && <p className={`mt-2 text-xs ${importStatus.ok ? 'text-ideal' : 'text-red-300'}`}>{importStatus.text}</p>}
        <div className="mt-5">
          <DeviceDownloadPanel onImported={onImported} />
        </div>
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
                  {c?.short ?? s.circuitId} · {formatDate(s.createdAt)} · {s.laps.length} v · {formatDuration(sessionUsage(s).durationMs)}{s.source === 'sim' ? ' · SIM' : ''}
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
                <th className="py-1.5 text-right font-medium">T1</th>
                <th className="py-1.5 text-right font-medium">T2</th>
                <th className="py-1.5 pr-3 text-right font-medium">T3</th>
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
                    <td className="py-2">
                      <div className={`font-semibold ${isBest ? 'text-violet-300' : ''}`}>{formatLap(l.timeMs)}</div>
                      <div className={`text-[10px] ${isBest ? 'text-violet-300/80' : 'text-rider/90'}`}>
                        {isBest ? 'VUELTA RÁPIDA' : formatDelta(l.timeMs - best.timeMs)}
                      </div>
                    </td>
                    {[0, 1, 2].map((i) => {
                      const v = l.sectors?.[i];
                      const b = v != null && v === bestSectors[i];
                      return (
                        <td key={i} className={`py-2 text-right text-xs ${i === 2 ? 'pr-3' : ''}`}>
                          <span className={b ? 'rounded bg-violet-500/25 px-1 font-semibold text-violet-200' : 'text-zinc-300'}>
                            {v == null ? '—' : (v / 1000).toFixed(2)}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
              {bestSectors.every((v) => v != null) && laps.length > 1 && (
                <tr className="border-t border-edge font-mono tabular text-zinc-400">
                  <td className="px-3 py-2 text-[10px]">IDEAL</td>
                  <td className="py-2 text-xs" colSpan={4}>
                    {formatLap(bestSectors.reduce((a, b) => a + b, 0))}
                    <span className="ml-2 text-[10px] text-zinc-500">suma de mejores parciales</span>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {lap && model && (
          <ExportImportPanel session={session} circuit={circuit} model={model} lap={lap} onImported={onImported} />
        )}
        <DeviceDownloadPanel onImported={onImported} />
        <UsagePanel sessions={sessions} />

        <button
          type="button"
          onClick={async () => {
            if (!confirm('¿Borrar esta sesión?')) return;
            await deleteSession(session.id);
            onSelectSession(null);
            refresh();
          }}
          className="min-h-[40px] self-start text-xs text-zinc-500 underline-offset-2 hover:text-red-300 hover:underline"
        >
          Borrar sesión
        </button>
      </aside>

      {/* Columna derecha: mapa + métricas (o pantalla completa) */}
      {lap && model && (
        <section
          className={
            full
              ? 'fixed inset-0 z-50 flex flex-col gap-2 overflow-y-auto bg-[#09090b] px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-[calc(env(safe-area-inset-top)+0.5rem)]'
              : 'flex min-w-0 flex-1 flex-col gap-3'
          }
          aria-label={full ? 'Análisis a pantalla completa' : undefined}
        >
          {full && (
            <div className="order-[-2] flex items-center gap-2">
              <div className="no-scrollbar flex min-w-0 flex-1 gap-1.5 overflow-x-auto">
                {laps.map((l) => (
                  <button
                    key={l.number}
                    type="button"
                    onClick={() => {
                      setLapNo(l.number);
                      setHover(null);
                    }}
                    className={`min-h-[40px] shrink-0 rounded-lg border px-2.5 font-mono text-xs tabular ${
                      l === lap ? 'border-rider/60 bg-rider/15 text-zinc-50' : 'border-edge bg-panel text-zinc-300'
                    }`}
                  >
                    V{l.number} <span className={l === best ? 'text-violet-300' : ''}>{formatLap(l.timeMs)}</span>
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={toggleFull}
                className="min-h-[40px] shrink-0 rounded-lg bg-zinc-100 px-3 text-sm font-bold text-black"
              >
                Salir
              </button>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Metric label="Tiempo" value={formatLap(lap.timeMs)} accent={lap === best ? 'text-violet-300' : undefined} />
            <Metric label="Vel. máx" value={`${Math.round(lap.stats.maxSpeedKmh)}`} unit="km/h" />
            <Metric label="Incl. máx" value={lap.stats.maxLeanDeg == null ? 'N/D' : lap.stats.maxLeanDeg.toFixed(0)} unit={lap.stats.maxLeanDeg == null ? '' : '°'} />
            <Metric label="Desv. media" value={lap.stats.avgDeviationM.toFixed(2)} unit="m" />
            <Metric label="Desv. máx" value={lap.stats.maxDeviationM.toFixed(1)} unit="m" />
          </div>

          <label className="flex items-center gap-2">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Comparar con</span>
            <select
              value={refSelectValue}
              onChange={(e) => {
                const v = e.target.value;
                setRefChoice(v === 'none' || v === 'best' ? v : Number(v));
              }}
              className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-edge bg-panel px-3 text-sm"
            >
              <option value="none">Ninguna</option>
              {best && best !== lap && (
                <option value="best">Vuelta rápida (V{best.number} · {formatLap(best.timeMs)})</option>
              )}
              {laps
                .filter((l) => l !== lap && l !== best)
                .map((l) => (
                  <option key={l.number} value={l.number}>
                    Vuelta {l.number} · {formatLap(l.timeMs)} ({formatDelta(l.timeMs - lap.timeMs)})
                  </option>
                ))}
            </select>
          </label>

          <div className={`relative shrink-0 overflow-hidden rounded-2xl border border-edge ${full ? 'order-[-1]' : ''}`}>
            <TrackMap
              model={model}
              riderPoints={lap.stats.smooth}
              refPoints={refLap ? refLap.stats.smooth : null}
              smooth={false}
              marker={marker}
              idealPoints={reference?.points}
              className={full ? 'h-[calc(100dvh_-_5.5rem)] min-h-[320px] bg-[#0c0c10]' : 'h-[52vh] min-h-[320px] bg-[#0c0c10]'}
            />
            <button
              type="button"
              onClick={toggleFull}
              aria-label={full ? 'Salir de pantalla completa' : 'Ver el análisis a pantalla completa'}
              title={full ? 'Salir de pantalla completa' : 'Pantalla completa'}
              className="absolute bottom-2 right-2 flex min-h-[40px] items-center gap-1.5 rounded-lg border border-edge bg-black/70 px-3 text-xs font-semibold text-zinc-100 backdrop-blur hover:bg-black/90"
            >
              <span aria-hidden className="text-base leading-none">{full ? '⤡' : '⛶'}</span>
              {full ? 'Salir' : 'Pantalla completa'}
            </button>
            <div className="pointer-events-none absolute left-3 top-3 flex flex-col gap-1 rounded-lg bg-black/60 px-2.5 py-2 text-[11px] backdrop-blur">
              <span className="flex items-center gap-2"><i className="h-0.5 w-5 rounded bg-ideal" /> {reference ? `Referencia: ${reference.label}` : 'Trazada ideal (calculada)'}</span>
              <span className="flex items-center gap-2"><i className="h-0.5 w-5 rounded bg-rider" /> Vuelta {lap.number}</span>
              {refLap && (
                <span className="flex items-center gap-2">
                  <i className="h-[2px] w-5 rounded bg-[#a78bfa]" /> Vuelta {refLap.number}
                  {refLap === best ? ' (rápida)' : ''}
                </span>
              )}
            </div>
          </div>
          {!full && <ReferenceLinePanel circuit={circuit} lap={lap} best={best} reference={reference} />}
          <p className={full ? 'hidden' : 'text-[11px] text-zinc-500'}>
            Rueda / pellizco para zoom, arrastra para mover, doble clic para acercar una curva (frenada, ápice, salida). Desliza sobre las gráficas para
            situar el punto en el mapa. Trazada roja suavizada con Catmull-Rom; desviación medida con Haversine.
          </p>

          <div className="grid gap-3 rounded-2xl border border-edge bg-panel p-3 xl:grid-cols-2">
            {deltaTrace && (
              <div className="xl:col-span-2">
                <TraceChart
                  trace={deltaTrace}
                  value={deltaValue}
                  title={`Delta vs vuelta ${refLap.number} (+ pierdes / − ganas)`}
                  unit="s"
                  color="#ef4444"
                  symmetric
                  minRange={deltaRange <= 0.5 ? 0.5 : Math.ceil(deltaRange * 2) / 2}
                  format={formatSigned}
                  hoverIndex={hover}
                  onHover={setHover}
                />
              </div>
            )}
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
              title={reference ? 'Desviación vs referencia (+izq/−dcha)' : 'Desviación vs ideal (+izq/−dcha)'}
              unit="m"
              color="#ef4444"
              symmetric
              format={(v) => v.toFixed(1)}
              hoverIndex={hover}
              onHover={setHover}
            />
            {hasLean && lap.stats.maxLeanDeg != null && (
              <TraceChart
                trace={lap.stats.trace}
                value={(d) => d.lean ?? 0}
                title="Inclinación (+izq/−dcha)"
                unit="°"
                color="#f59e0b"
                symmetric
                hoverIndex={hover}
                onHover={setHover}
              />
            )}
          </div>
        </section>
      )}
    </div>
  );
}

const deltaValue = (d) => d.d;
const formatSigned = (v) => `${v > 0.004 ? '+' : v < -0.004 ? '−' : ''}${Math.abs(v).toFixed(2)}`;

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
