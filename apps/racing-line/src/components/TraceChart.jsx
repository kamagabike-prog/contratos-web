// Gráfica de una serie a lo largo de la distancia de vuelta, con cruceta
// sincronizada con el marcador del mapa.

import React, { useEffect, useMemo, useRef, useState } from 'react';

const M = { top: 10, right: 12, bottom: 20, left: 40 };

export default function TraceChart({
  trace,
  value, // (d) => número
  title,
  unit,
  color,
  symmetric = false, // eje centrado en 0 (desviación)
  hoverIndex,
  onHover,
  format = (v) => v.toFixed(0),
  height = 130,
}) {
  const ref = useRef(null);
  const [w, setW] = useState(320);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, []);

  const iw = w - M.left - M.right;
  const ih = height - M.top - M.bottom;

  const { path, area, yTicks, sx, sy, maxS } = useMemo(() => {
    const maxS = trace.length ? trace[trace.length - 1].s : 1;
    const vals = trace.map(value);
    let lo = Math.min(0, ...vals);
    let hi = Math.max(...vals, 1);
    if (symmetric) {
      const m = Math.max(Math.abs(lo), Math.abs(hi), 2);
      lo = -m;
      hi = m;
    } else {
      hi = niceCeil(hi);
    }
    const sx = (s) => (s / maxS) * iw;
    const sy = (v) => ih - ((v - lo) / (hi - lo)) * ih;
    let path = '';
    trace.forEach((d, i) => {
      path += `${i ? 'L' : 'M'}${sx(d.s).toFixed(1)} ${sy(vals[i]).toFixed(1)}`;
    });
    const area = symmetric && trace.length ? `${path}L${sx(maxS)} ${sy(0)}L0 ${sy(0)}Z` : '';
    const yTicks = symmetric ? [lo, 0, hi] : [0, hi / 2, hi];
    return { path, area, yTicks, sx, sy, maxS };
  }, [trace, value, iw, ih, symmetric]);

  const handle = (e) => {
    const r = ref.current.getBoundingClientRect();
    const x = e.clientX - r.left - M.left;
    const s = Math.max(0, Math.min(maxS, (x / iw) * maxS));
    // búsqueda binaria del punto más cercano
    let lo = 0;
    let hi = trace.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (trace[mid].s < s) lo = mid;
      else hi = mid;
    }
    onHover?.(Math.abs(trace[lo].s - s) < Math.abs(trace[hi].s - s) ? lo : hi);
  };

  const hd = hoverIndex != null ? trace[hoverIndex] : null;

  return (
    <div ref={ref} className="w-full">
      <div className="mb-1 flex items-baseline justify-between px-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-zinc-400">
          {title} <span className="font-normal text-zinc-500">({unit})</span>
        </span>
        {hd && (
          <span className="font-mono text-xs tabular text-zinc-200">
            {format(value(hd))} {unit} · {(hd.s / 1000).toFixed(2)} km
          </span>
        )}
      </div>
      <svg
        width={w}
        height={height}
        className="touch-none"
        onPointerMove={handle}
        onPointerDown={handle}
        onPointerLeave={() => onHover?.(null)}
        role="img"
        aria-label={`${title} a lo largo de la vuelta`}
      >
        <g transform={`translate(${M.left},${M.top})`}>
          {yTicks.map((t) => (
            <g key={t}>
              <line x1={0} x2={iw} y1={sy(t)} y2={sy(t)} stroke={t === 0 && symmetric ? '#3f3f46' : '#1f242b'} />
              <text x={-6} y={sy(t)} dy="0.32em" textAnchor="end" className="fill-zinc-500 font-mono text-[10px]">
                {format(t)}
              </text>
            </g>
          ))}
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <text key={f} x={f * iw} y={ih + 14} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} className="fill-zinc-500 font-mono text-[10px]">
              {((f * maxS) / 1000).toFixed(1)} km
            </text>
          ))}
          {area && <path d={area} fill={color} fillOpacity="0.12" />}
          <path d={path} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
          {hd && (
            <g>
              <line x1={sx(hd.s)} x2={sx(hd.s)} y1={0} y2={ih} stroke="#a1a1aa" strokeDasharray="3 3" />
              <circle cx={sx(hd.s)} cy={sy(value(hd))} r="4.5" fill={color} stroke="#0a0c0f" strokeWidth="2" />
            </g>
          )}
        </g>
      </svg>
    </div>
  );
}

function niceCeil(v) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
}
