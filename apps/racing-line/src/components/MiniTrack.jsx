import React, { useMemo } from 'react';
import { bounds } from '../geo/geometry.js';

/** Vista previa estática (no interactiva) del circuito para las tarjetas. */
export default function MiniTrack({ model, className = '' }) {
  const { d, ideal, box } = useMemo(() => {
    const path = (pts) => 'M' + pts.map((p) => `${p.x.toFixed(1)} ${(-p.y).toFixed(1)}`).join('L') + 'Z';
    const b = bounds(model.center);
    const pad = Math.max(b.w, b.h) * 0.08;
    return {
      d: path(model.center),
      ideal: path(model.racingLine),
      box: `${b.minX - pad} ${-b.maxY - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`,
    };
  }, [model]);
  return (
    <svg viewBox={box} className={className} aria-hidden="true">
      <path d={d} fill="none" stroke="#2b2f36" strokeWidth="7" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <path d={ideal} fill="none" stroke="#22c55e" strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
