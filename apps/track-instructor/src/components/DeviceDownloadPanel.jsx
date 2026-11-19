// «Descargar del GPS (WiFi)»: trae las sesiones grabadas por un GPS /
// data-logger externo que las comparte por WiFi (servidor web o volcado TCP).

import React, { useState } from 'react';
import {
  downloadDeviceFile,
  isNative,
  listDeviceFiles,
  loadDownloadConfig,
  saveDownloadConfig,
  tcpDump,
} from '../telemetry/deviceDownload.js';
import { sessionFromText } from '../utils/exportImport.js';
import { saveSession } from '../storage/sessions.js';

const btn =
  'flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-edge bg-panel2 px-3 text-sm font-medium text-zinc-200 transition hover:bg-white/[0.06] active:bg-white/[0.1] disabled:opacity-40';
const input =
  'h-11 w-full rounded-lg border border-edge bg-panel2 px-3 font-mono text-sm text-zinc-100 focus:border-zinc-400 focus:outline-none';

const fmtSize = (b) => (b == null ? '' : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} kB`);

export default function DeviceDownloadPanel({ onImported, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const [cfg, setCfg] = useState(loadDownloadConfig);
  const [files, setFiles] = useState(null);
  const [picked, setPicked] = useState(() => new Set());
  const [busy, setBusy] = useState(null); // texto de progreso
  const [log, setLog] = useState([]); // [{ok, text}]
  const native = isNative();
  const set = (patch) => setCfg((c) => ({ ...c, ...patch }));

  const importText = async (name, text) => {
    const s = sessionFromText(name, text, { source: 'device' });
    await saveSession(s);
    return s;
  };

  const search = async () => {
    setLog([]);
    setFiles(null);
    setBusy('Buscando sesiones en el GPS…');
    try {
      saveDownloadConfig(cfg);
      const list = await listDeviceFiles(cfg.url);
      setFiles(list);
      setPicked(new Set(list.map((f) => f.url)));
    } catch (e) {
      setLog([{ ok: false, text: e.message }]);
    } finally {
      setBusy(null);
    }
  };

  const importPicked = async () => {
    const chosen = files.filter((f) => picked.has(f.url));
    const out = [];
    let last = null;
    for (let i = 0; i < chosen.length; i++) {
      const f = chosen[i];
      setBusy(`Descargando ${i + 1}/${chosen.length}: ${f.name}`);
      try {
        const s = await importText(f.name, await downloadDeviceFile(f));
        last = s;
        out.push({ ok: true, text: `${f.name}: ${s.laps.length} vuelta${s.laps.length === 1 ? '' : 's'}` });
      } catch (e) {
        out.push({ ok: false, text: `${f.name}: ${e.message}` });
      }
      setLog([...out]);
    }
    setBusy(null);
    if (last) onImported?.(last);
  };

  const dump = async () => {
    setLog([]);
    setBusy('Conectando con el GPS…');
    try {
      saveDownloadConfig(cfg);
      const text = await tcpDump({
        host: cfg.host,
        port: cfg.port,
        onProgress: (n) => setBusy(`Recibiendo datos… ${fmtSize(n)}`),
      });
      const s = await importText(`GPS ${cfg.host}.nmea`, text);
      setLog([{ ok: true, text: `Importada: ${s.laps.length} vuelta${s.laps.length === 1 ? '' : 's'}` }]);
      onImported?.(s);
    } catch (e) {
      setLog([{ ok: false, text: e.message }]);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="rounded-2xl border border-edge bg-panel p-3 text-left">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex min-h-[40px] w-full items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-zinc-400"
      >
        <span>Descargar del GPS (WiFi)</span>
        <span aria-hidden className="text-base">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-xs text-zinc-400">
          <p className="text-zinc-500">
            Conecta el móvil a la WiFi de tu GPS o data-logger y trae las sesiones que ha grabado. Se cronometran y se asignan al circuito automáticamente.
          </p>
          {!native && (
            <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-amber-200">
              Desde el navegador casi ningún GPS permite la descarga. Funciona en la app de iPhone; aquí puedes importar el archivo exportado desde el GPS.
            </p>
          )}
          <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-black/40 p-1">
            {[
              ['http', 'Servidor web'],
              ['tcp', 'Volcado TCP'],
            ].map(([m, label]) => (
              <button
                key={m}
                type="button"
                onClick={() => set({ method: m })}
                className={`min-h-[40px] rounded-lg text-sm font-semibold transition ${cfg.method === m ? 'bg-zinc-100 text-black' : 'text-zinc-400'}`}
              >
                {label}
              </button>
            ))}
          </div>

          {cfg.method === 'http' ? (
            <>
              <label className="flex flex-col gap-1">
                Dirección del GPS
                <input
                  id="dl-url"
                  className={input}
                  inputMode="url"
                  autoComplete="off"
                  autoCapitalize="off"
                  spellCheck="false"
                  placeholder="http://192.168.4.1/"
                  value={cfg.url}
                  onChange={(e) => set({ url: e.target.value })}
                />
              </label>
              <button type="button" className={`${btn} w-full`} disabled={!!busy} onClick={search}>
                Buscar sesiones
              </button>
              {files && (
                <div className="space-y-1">
                  <div className="flex items-center justify-between">
                    <span>{files.length} archivo{files.length === 1 ? '' : 's'}</span>
                    <button
                      type="button"
                      className="min-h-[32px] px-1 text-zinc-300 underline-offset-2 hover:underline"
                      onClick={() => setPicked(picked.size === files.length ? new Set() : new Set(files.map((f) => f.url)))}
                    >
                      {picked.size === files.length ? 'Ninguno' : 'Todos'}
                    </button>
                  </div>
                  <ul className="max-h-56 overflow-y-auto rounded-lg border border-edge">
                    {files.map((f) => (
                      <li key={f.url} className="border-b border-edge/60 last:border-0">
                        <label className="flex min-h-[44px] cursor-pointer items-center gap-2 px-2">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-[#22c55e]"
                            checked={picked.has(f.url)}
                            onChange={(e) => {
                              const n = new Set(picked);
                              e.target.checked ? n.add(f.url) : n.delete(f.url);
                              setPicked(n);
                            }}
                          />
                          <span className="min-w-0 flex-1 truncate font-mono text-zinc-200">{f.name}</span>
                          <span className="shrink-0 font-mono text-[10px] text-zinc-500">{[f.date, fmtSize(f.size)].filter(Boolean).join(' · ')}</span>
                        </label>
                      </li>
                    ))}
                  </ul>
                  <button type="button" className={`${btn} w-full border-ideal/40 text-ideal`} disabled={!!busy || !picked.size} onClick={importPicked}>
                    Descargar e importar ({picked.size})
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="flex items-end gap-2">
                <label className="flex min-w-0 flex-1 flex-col gap-1">
                  IP del GPS
                  <input
                    id="dl-host"
                    className={input}
                    inputMode="decimal"
                    autoComplete="off"
                    autoCapitalize="off"
                    spellCheck="false"
                    placeholder="192.168.4.1"
                    value={cfg.host}
                    onChange={(e) => set({ host: e.target.value })}
                  />
                </label>
                <label className="flex w-24 flex-col gap-1">
                  Puerto
                  <input
                    id="dl-port"
                    className={input}
                    inputMode="numeric"
                    value={cfg.port}
                    onChange={(e) => set({ port: e.target.value.replace(/\D/g, '').slice(0, 5) })}
                  />
                </label>
              </div>
              <button type="button" className={`${btn} w-full`} disabled={!!busy || !native} onClick={dump}>
                Descargar registro
              </button>
            </>
          )}

          {busy && (
            <p role="status" className="font-mono text-zinc-300">
              {busy}
            </p>
          )}
          {log.length > 0 && (
            <ul role="status" className="space-y-0.5">
              {log.map((l, i) => (
                <li key={i} className={l.ok ? 'text-ideal' : 'text-red-300'}>
                  {l.ok ? '✓' : '✕'} {l.text}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
