// «Tiempo de uso»: horas en pista, vueltas y km acumulados, desglose por
// circuito y contadores reiniciables (neumáticos, aceite…) para saber cuánto
// uso llevan desde el último cambio.

import React, { useMemo, useState } from 'react';
import { CIRCUITS } from '../data/circuits.js';
import { formatDuration, formatKm, loadCounters, saveCounters, usageTotals } from '../storage/usage.js';

const fmtDate = (t) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });

export default function UsagePanel({ sessions }) {
  const [counters, setCounters] = useState(loadCounters);
  const [confirming, setConfirming] = useState(null); // id del contador pendiente de confirmar
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const total = useMemo(() => usageTotals(sessions), [sessions]);

  const update = (list) => {
    setCounters(list);
    saveCounters(list);
  };
  const reset = (id) => {
    update(counters.map((c) => (c.id === id ? { ...c, resetAt: Date.now() } : c)));
    setConfirming(null);
  };
  const remove = (id) => update(counters.filter((c) => c.id !== id));
  const add = () => {
    const name = newName.trim().slice(0, 40);
    if (!name) return;
    update([...counters, { id: `c${Date.now().toString(36)}`, name, resetAt: Date.now() }]);
    setNewName('');
    setAdding(false);
  };

  const circuits = Object.entries(total.byCircuit).sort((a, b) => b[1].durationMs - a[1].durationMs);

  return (
    <div className="rounded-2xl border border-edge bg-panel p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Tiempo de uso</div>

      {total.sessions === 0 ? (
        <p className="text-xs text-zinc-500">Aún no hay uso real: las sesiones simuladas no cuentan. Graba una tanda en pista o importa una sesión.</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-1.5">
            <Figure label="En pista" value={formatDuration(total.durationMs)} />
            <Figure label="Vueltas" value={total.laps.toLocaleString('es-ES')} />
            <Figure label="Distancia" value={formatKm(total.distanceM)} />
          </div>
          {circuits.length > 1 && (
            <ul className="mt-2 space-y-1 text-xs">
              {circuits.map(([id, u]) => (
                <li key={id} className="flex items-baseline justify-between gap-2">
                  <span className="min-w-0 truncate text-zinc-300">{CIRCUITS.find((c) => c.id === id)?.short ?? id}</span>
                  <span className="shrink-0 font-mono tabular text-zinc-400">
                    {formatDuration(u.durationMs)} · {u.laps} v · {formatKm(u.distanceM)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      <div className="mt-3 border-t border-edge pt-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-500">Desde el último cambio</div>
        <ul className="space-y-1.5">
          {counters.map((c) => {
            const u = usageTotals(sessions, { since: c.resetAt });
            return (
              <li key={c.id} className="flex min-h-[44px] items-center gap-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-zinc-200">{c.name}</div>
                  <div className="font-mono text-[11px] tabular text-zinc-400">
                    {formatDuration(u.durationMs)} · {u.laps} v · {formatKm(u.distanceM)}
                  </div>
                  <div className="text-[10px] text-zinc-500">{c.resetAt ? `desde el ${fmtDate(c.resetAt)}` : 'desde el principio'}</div>
                </div>
                {confirming === c.id ? (
                  <div className="flex shrink-0 gap-1">
                    <button type="button" onClick={() => reset(c.id)} className="min-h-[40px] rounded-lg bg-ideal px-3 text-xs font-bold text-black">
                      Poner a cero
                    </button>
                    <button type="button" onClick={() => setConfirming(null)} className="min-h-[40px] rounded-lg px-2 text-xs text-zinc-400">
                      Cancelar
                    </button>
                  </div>
                ) : (
                  <div className="flex shrink-0 items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setConfirming(c.id)}
                      className="min-h-[40px] rounded-lg border border-edge bg-panel2 px-3 text-xs font-medium text-zinc-200 hover:bg-white/[0.06]"
                    >
                      Reiniciar
                    </button>
                    {!DEFAULT_IDS.includes(c.id) && (
                      <button
                        type="button"
                        aria-label={`Quitar el contador ${c.name}`}
                        onClick={() => remove(c.id)}
                        className="grid h-10 w-8 place-items-center rounded-lg text-zinc-500 hover:text-red-300"
                      >
                        ✕
                      </button>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {adding ? (
          <form
            className="mt-2 flex gap-1.5"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input
              id="usage-new-counter"
              autoFocus
              maxLength={40}
              placeholder="Pastillas de freno, cadena…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              className="h-10 min-w-0 flex-1 rounded-lg border border-edge bg-panel2 px-3 text-sm text-zinc-100 focus:border-zinc-400 focus:outline-none"
            />
            <button type="submit" className="min-h-[40px] rounded-lg bg-zinc-100 px-3 text-xs font-bold text-black disabled:opacity-40" disabled={!newName.trim()}>
              Añadir
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="mt-1 min-h-[40px] text-xs text-zinc-400 underline-offset-2 hover:underline">
            + Añadir contador
          </button>
        )}
        <p className="mt-1 text-[10px] leading-snug text-zinc-500">
          Reinicia un contador al cambiar la pieza. Cuenta solo el tiempo en movimiento de las sesiones reales; las simuladas no suman.
        </p>
      </div>
    </div>
  );
}

const DEFAULT_IDS = ['tyres', 'oil'];

function Figure({ label, value }) {
  return (
    <div className="rounded-lg bg-black/40 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
      <div className="font-mono text-sm font-semibold tabular text-zinc-100">{value}</div>
    </div>
  );
}
