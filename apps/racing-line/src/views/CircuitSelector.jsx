import React from 'react';
import { CIRCUITS, getTrackModel, hasGeometry } from '../data/circuits.js';
import MiniTrack from '../components/MiniTrack.jsx';

const QUALITY = {
  real: { label: 'GPS real', cls: 'bg-ideal/15 text-ideal', title: 'Trazado GPS real' },
  aprox: { label: 'Aprox.', cls: 'bg-amber-400/10 text-amber-300', title: 'Forma aproximada: sustitúyela por una vuelta GPS real' },
  template: { label: 'Plantilla', cls: 'bg-sky-400/10 text-sky-300', title: 'Trazado representativo listo para rellenar con datos reales' },
};

export default function CircuitSelector({ selectedId, onSelect }) {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-28 pt-4">
      <h1 className="text-xl font-bold tracking-tight">Elige circuito</h1>
      <p className="mt-1 text-sm text-zinc-400">
        Circuitos de velocidad de España. La <span className="font-semibold text-ideal">línea verde</span> es la trazada ideal calculada por mínima curvatura.
      </p>

      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {CIRCUITS.map((c) => {
          const ok = hasGeometry(c);
          const active = c.id === selectedId;
          return (
            <button
              key={c.id}
              type="button"
              disabled={!ok}
              onClick={() => onSelect(c.id)}
              className={`group relative flex flex-col overflow-hidden rounded-2xl border text-left transition ${
                active
                  ? 'border-ideal/70 bg-ideal/[0.06] ring-1 ring-ideal/40'
                  : ok
                  ? 'border-edge bg-panel hover:border-zinc-600'
                  : 'cursor-not-allowed border-edge/60 bg-panel/50 opacity-60'
              }`}
            >
              <div className="flex h-36 items-center justify-center bg-[#0c0f13] p-3">
                {ok ? (
                  <MiniTrack model={getTrackModel(c)} className="h-full w-full" />
                ) : (
                  <span className="font-mono text-xs uppercase tracking-widest text-zinc-600">Sin trazado</span>
                )}
              </div>
              <div className="flex flex-1 flex-col gap-1 p-3">
                <div className="flex items-start justify-between gap-2">
                  <span className="font-semibold leading-tight">{c.name}</span>
                  {ok && (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] uppercase ${QUALITY[c.dataQuality].cls}`}
                      title={QUALITY[c.dataQuality].title}
                    >
                      {QUALITY[c.dataQuality].label}
                    </span>
                  )}
                </div>
                <span className="text-xs text-zinc-400">{c.location}</span>
                <div className="mt-1 flex gap-3 font-mono text-[11px] text-zinc-300">
                  <span>{(c.lengthM / 1000).toFixed(3)} km</span>
                  <span>{c.turns} curvas</span>
                  <span>{c.direction}</span>
                </div>
                {!ok && <span className="mt-1 text-[11px] text-zinc-500">Geometría próximamente</span>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
