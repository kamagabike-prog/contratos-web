// Botones de exportación (GPX / CSV de la vuelta, JSON de la sesión) e
// importación de sesiones (JSON / GPX).

import React, { useRef, useState } from 'react';
import {
  downloadText,
  exportFilename,
  importSessionFile,
  lapToCSV,
  lapToGPX,
  sessionToJSON,
} from '../utils/exportImport.js';

const btn =
  'flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-edge bg-panel2 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.06] active:bg-white/[0.1] disabled:opacity-40';

/** Botón + input oculto para importar. Llama a onImported(session). */
export function ImportButton({ onImported, onStatus, className = btn, label = 'Importar sesión (JSON/GPX)' }) {
  const input = useRef(null);
  const [busy, setBusy] = useState(false);
  return (
    <>
      <button type="button" className={className} disabled={busy} onClick={() => input.current?.click()}>
        <span aria-hidden>⬆</span> {busy ? 'Importando…' : label}
      </button>
      <input
        ref={input}
        type="file"
        accept=".json,.gpx,application/json,application/gpx+xml,application/xml,text/xml"
        className="hidden"
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          try {
            const s = await importSessionFile(file);
            onStatus?.({ ok: true, text: `Importada: ${s.laps.length} vuelta${s.laps.length === 1 ? '' : 's'}` });
            onImported?.(s);
          } catch (err) {
            onStatus?.({ ok: false, text: err.message || 'No se pudo importar el archivo' });
          } finally {
            setBusy(false);
          }
        }}
      />
    </>
  );
}

export default function ExportImportPanel({ session, circuit, model, lap, onImported }) {
  const [status, setStatus] = useState(null);
  const base = (suffix, ext) => exportFilename(circuit?.id ?? session.circuitId, session.createdAt, suffix, ext);
  const lapName = `${circuit?.short ?? session.circuitId} · Vuelta ${lap?.number}`;

  return (
    <div className="rounded-2xl border border-edge bg-panel p-3">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-zinc-400">Exportar / importar</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="button"
          className={btn}
          disabled={!lap}
          onClick={() => downloadText(base(`v${lap.number}`, 'gpx'), lapToGPX(lap, model.proj, { name: lapName }), 'application/gpx+xml')}
        >
          Exportar GPX
        </button>
        <button
          type="button"
          className={btn}
          disabled={!lap}
          onClick={() => downloadText(base(`v${lap.number}`, 'csv'), lapToCSV(lap.stats, model.proj, lap.startT), 'text/csv')}
        >
          Exportar CSV
        </button>
        <button
          type="button"
          className={`${btn} col-span-2`}
          onClick={() => downloadText(base('', 'json'), sessionToJSON(session), 'application/json')}
        >
          Exportar sesión (JSON)
        </button>
        <div className="col-span-2 grid">
          <ImportButton onImported={onImported} onStatus={setStatus} />
        </div>
      </div>
      <p className="mt-2 text-[10px] leading-snug text-zinc-500">GPX y CSV de la vuelta {lap?.number} seleccionada. Un GPX importado se cronometra y se asigna al circuito más cercano.</p>
      {status && (
        <p role="status" className={`mt-1.5 text-xs ${status.ok ? 'text-ideal' : 'text-red-300'}`}>
          {status.text}
        </p>
      )}
    </div>
  );
}
