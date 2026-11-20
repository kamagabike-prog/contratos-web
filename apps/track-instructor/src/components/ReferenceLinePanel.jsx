// «Trazada de referencia»: elige qué línea verde usar en este circuito.
//  · una vuelta de esta sesión (la elegida o la rápida),
//  · una vuelta importada (GPX, NMEA, VBO, CSV) de un piloto más rápido o de
//    un instructor,
//  · o la trazada calculada por mínima curvatura (por defecto).

import React, { useRef, useState } from 'react';
import { clearReferenceLine, setReferenceLine } from '../storage/referenceLines.js';
import { sessionFromText } from '../utils/exportImport.js';
import { IMPORT_ACCEPT } from '../utils/importFormats.js';
import { unpackLap } from '../storage/sessions.js';
import { formatLap } from '../utils/format.js';

const btn =
  'flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-edge bg-panel2 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.06] active:bg-white/[0.1] disabled:opacity-40';

export default function ReferenceLinePanel({ circuit, lap, best, reference }) {
  const input = useRef(null);
  const [status, setStatus] = useState(null);

  const useLap = (l, label) => {
    try {
      setReferenceLine(circuit.id, l.points, { label, timeMs: l.timeMs });
      setStatus({ ok: true, text: `Referencia: ${label}` });
    } catch (e) {
      setStatus({ ok: false, text: e.message });
    }
  };

  const importRef = async (file) => {
    try {
      const s = sessionFromText(file.name, await file.text());
      if (s.circuitId !== circuit.id) throw new Error(`Ese archivo es de otro circuito (${s.circuitId}), no de ${circuit.short}.`);
      const laps = s.laps.map(unpackLap);
      const fastest = laps.reduce((b, l) => (!b || l.timeMs < b.timeMs ? l : b), null);
      const name = file.name.replace(/\.[^.]+$/, '');
      useLap(fastest, `${name} · ${formatLap(fastest.timeMs)}`);
    } catch (e) {
      setStatus({ ok: false, text: e.message || 'No se pudo leer el archivo' });
    }
  };

  return (
    <div className="rounded-2xl border border-edge bg-panel p-3">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Trazada de referencia (línea verde)</div>
      <p className="mb-2 text-xs text-zinc-400">
        {reference ? (
          <>
            <span className="font-semibold text-ideal">{reference.label}</span>
            <span className="text-zinc-500"> · guardada el {new Date(reference.savedAt).toLocaleDateString('es-ES')}</span>
          </>
        ) : (
          <>Calculada por mínima curvatura (orientativa). Para comparar con una trazada real, usa una vuelta rápida tuya o importa la de un piloto o instructor más rápido.</>
        )}
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        <button type="button" className={btn} onClick={() => useLap(lap, `Vuelta ${lap.number} · ${formatLap(lap.timeMs)}`)}>
          Usar vuelta {lap.number} como referencia
        </button>
        {best && best !== lap && (
          <button type="button" className={btn} onClick={() => useLap(best, `Vuelta rápida ${best.number} · ${formatLap(best.timeMs)}`)}>
            Usar la vuelta rápida (V{best.number})
          </button>
        )}
        <button type="button" className={btn} onClick={() => input.current?.click()}>
          ⬆ Importar referencia (GPX, NMEA, VBO, CSV)
        </button>
        {reference && (
          <button
            type="button"
            className={btn}
            onClick={() => {
              clearReferenceLine(circuit.id);
              setStatus({ ok: true, text: 'Vuelves a la trazada calculada' });
            }}
          >
            Volver a la calculada
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept={IMPORT_ACCEPT}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) importRef(f);
        }}
      />
      {status && (
        <p role="status" className={`mt-1.5 text-xs ${status.ok ? 'text-ideal' : 'text-red-300'}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
