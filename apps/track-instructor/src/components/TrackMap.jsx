// Mapa SVG del circuito en coordenadas locales (metros) con pan/zoom.
//
//  · Asfalto (#1e293b): trazo de la línea central con ancho = ancho real de pista.
//  · Pianos rojo/blanco en las curvas, meta a cuadros y parciales T1/T2.
//  · La trazada del piloto se suaviza con Catmull-Rom (GPS a 1 Hz).
//  · Trazada ideal (verde #22c55e) y trazada del piloto (rojo #ef4444).
//  · Zoom con rueda / pellizco / botones, paneo arrastrando, modo "seguir".

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { bounds, smoothTrace } from '../geo/geometry.js';

const toPath = (pts, closed = false) => {
  if (!pts?.length) return '';
  let d = `M${pts[0].x.toFixed(2)} ${(-pts[0].y).toFixed(2)}`;
  for (let i = 1; i < pts.length; i++) d += `L${pts[i].x.toFixed(2)} ${(-pts[i].y).toFixed(2)}`;
  return closed ? d + 'Z' : d;
};

function fitBox(model, aspect) {
  const b = bounds([...model.leftEdge, ...model.rightEdge]);
  const pad = Math.max(b.w, b.h) * 0.06;
  let w = b.w + pad * 2;
  let h = b.h + pad * 2;
  if (w / h > aspect) h = w / aspect;
  else w = h * aspect;
  const cx = (b.minX + b.maxX) / 2;
  const cy = -(b.minY + b.maxY) / 2;
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

export default function TrackMap({
  model,
  riderPoints = null,
  smooth = true, // suavizar la trazada roja con Catmull-Rom
  marker = null, // {x,y}
  follow = false,
  showIdeal = true,
  className = '',
  compact = false,
  overlay = null,
  refPoints = null, // vuelta de referencia (violeta #a78bfa), ya suavizada
}) {
  const wrapRef = useRef(null);
  const [size, setSize] = useState({ w: 400, h: 300 });
  const [vb, setVb] = useState(null);
  const [following, setFollowing] = useState(follow);
  const pointers = useRef(new Map());
  const gesture = useRef(null);

  useEffect(() => setFollowing(follow), [follow]);

  // Tamaño del contenedor
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => {
      const { width, height } = e.contentRect;
      if (width > 0 && height > 0) setSize({ w: width, h: height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = size.w / size.h;
  const fit = useCallback(() => setVb(fitBox(model, aspect)), [model, aspect]);
  useEffect(() => {
    fit();
  }, [fit]);

  // Seguir al piloto manteniendo el zoom (zoom inicial ~350 m de ancho)
  useEffect(() => {
    if (!following || !marker) return;
    setVb((v) => {
      const base = v ?? fitBox(model, aspect);
      let w = base.w;
      let h = base.h;
      const full = fitBox(model, aspect);
      if (w > full.w * 0.6) {
        w = 350;
        h = 350 / aspect;
      }
      return { x: marker.x - w / 2, y: -marker.y - h / 2, w, h };
    });
  }, [following, marker, model, aspect]);

  const paths = useMemo(
    () => ({
      center: toPath(model.center, true),
      left: toPath(model.leftEdge, true),
      right: toPath(model.rightEdge, true),
      ideal: toPath(model.racingLine, true),
      kerbsIn: model.kerbs.map((k) => toPath(k.inner)).join(' '),
      kerbsOut: model.kerbs.map((k) => toPath(k.outer)).join(' '),
      finish: toPath(model.finish),
      sectors: model.sectorLines.slice(0, 2).map((l) => toPath(l)),
    }),
    [model]
  );
  const riderPath = useMemo(
    () => toPath(smooth && riderPoints?.length > 2 ? smoothTrace(riderPoints) : riderPoints || []),
    [riderPoints, smooth]
  );

  const refPath = useMemo(() => toPath(refPoints || []), [refPoints]);

  // ------------------------------------------------------------------ zoom/pan
  const zoomAt = useCallback(
    (factor, clientX, clientY) => {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setVb((v) => {
        if (!v) return v;
        const full = fitBox(model, aspect);
        const nw = Math.min(full.w * 1.5, Math.max(40, v.w * factor));
        const f = nw / v.w;
        const px = clientX == null ? 0.5 : (clientX - r.left) / r.width;
        const py = clientY == null ? 0.5 : (clientY - r.top) / r.height;
        const ax = v.x + v.w * px;
        const ay = v.y + v.h * py;
        return { x: ax - (ax - v.x) * f, y: ay - (ay - v.y) * f, w: v.w * f, h: v.h * f };
      });
    },
    [model, aspect]
  );

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e) => {
      e.preventDefault();
      zoomAt(Math.exp(e.deltaY * 0.0015), e.clientX, e.clientY);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  const onPointerDown = (e) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    gesture.current = null;
  };
  const onPointerMove = (e) => {
    const prev = pointers.current.get(e.pointerId);
    if (!prev) return;
    const pts = pointers.current;
    const el = wrapRef.current;
    const r = el.getBoundingClientRect();
    if (pts.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.abs(dx) + Math.abs(dy) > 0) setFollowing(false);
      setVb((v) => v && { ...v, x: v.x - (dx * v.w) / r.width, y: v.y - (dy * v.h) / r.height });
    } else if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      const other = a === prev ? b : a;
      const before = Math.hypot(prev.x - other.x, prev.y - other.y);
      const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
      if (before > 0 && after > 0) {
        zoomAt(before / after, (e.clientX + other.x) / 2, (e.clientY + other.y) / 2);
      }
    }
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
  };
  const onPointerUp = (e) => {
    pointers.current.delete(e.pointerId);
  };

  if (!vb) {
    return <div ref={wrapRef} className={`relative ${className}`} />;
  }

  const pxPerM = size.w / vb.w; // escala actual
  const markerR = 7 / pxPerM;

  return (
    <div ref={wrapRef} className={`relative overflow-hidden select-none touch-none ${className}`}>
      <svg
        className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
        viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(e) => zoomAt(0.5, e.clientX, e.clientY)}
        role="img"
        aria-label="Mapa del circuito con trazada ideal y trazada del piloto"
      >
        <defs>
          <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
            <path d="M100 0H0V100" fill="none" stroke="#18181b" strokeWidth={1 / pxPerM} />
          </pattern>
        </defs>
        <rect x={vb.x - vb.w} y={vb.y - vb.h} width={vb.w * 3} height={vb.h * 3} fill="url(#grid)" />

        {/* escapatorias / grava */}
        <path d={paths.center} fill="none" stroke="#111318" strokeWidth={model.width + 18} strokeLinejoin="round" />
        {/* asfalto */}
        <path d={paths.center} fill="none" stroke="#1e293b" strokeWidth={model.width} strokeLinejoin="round" />
        {/* líneas blancas de borde */}
        <path d={paths.left} fill="none" stroke="#cbd5e1" strokeOpacity="0.6" strokeWidth={Math.max(0.25, 0.8 / pxPerM)} />
        <path d={paths.right} fill="none" stroke="#cbd5e1" strokeOpacity="0.6" strokeWidth={Math.max(0.25, 0.8 / pxPerM)} />
        {/* pianos rojo/blanco */}
        <g strokeWidth={Math.max(1.2, 2.2 / pxPerM)} fill="none" strokeLinejoin="round">
          <path d={paths.kerbsIn} stroke="#f4f4f5" />
          <path d={paths.kerbsIn} stroke="#dc2626" strokeDasharray="2 2" />
          <path d={paths.kerbsOut} stroke="#f4f4f5" />
          <path d={paths.kerbsOut} stroke="#dc2626" strokeDasharray="2 2" />
        </g>
        {/* meta a cuadros */}
        <path d={paths.finish} stroke="#fafafa" strokeWidth={Math.max(2, 4 / pxPerM)} />
        <path d={paths.finish} stroke="#0a0a0a" strokeWidth={Math.max(2, 4 / pxPerM)} strokeDasharray="1.5 1.5" />

        {/* parciales T1 / T2 */}
        {paths.sectors.map((d, i) => (
          <g key={i}>
            <path d={d} stroke="#facc15" strokeWidth={Math.max(1.2, 2.5 / pxPerM)} strokeDasharray={`${3 / pxPerM} ${2 / pxPerM}`} />
            <text
              x={model.sectorLines[i][0].x}
              y={-model.sectorLines[i][0].y}
              fontSize={11 / pxPerM}
              dx={4 / pxPerM}
              className="fill-yellow-300 font-mono font-bold"
            >
              T{i + 1}
            </text>
          </g>
        ))}

        {/* trazada ideal */}
        {showIdeal && (
          <path
            d={paths.ideal}
            fill="none"
            stroke="#22c55e"
            strokeWidth={compact ? 2 : 2.5}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
            style={{ filter: 'drop-shadow(0 0 2px rgba(34,197,94,0.55))' }}
          />
        )}
        {/* vuelta de referencia (bajo la roja) */}
        {refPath && (
          <path
            d={refPath}
            fill="none"
            stroke="#a78bfa"
            strokeWidth={1.5}
            strokeOpacity={0.9}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {/* trazada del piloto */}
        {riderPath && (
          <path
            d={riderPath}
            fill="none"
            stroke="#ef4444"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        )}
        {marker && (
          <g>
            <circle cx={marker.x} cy={-marker.y} r={markerR * 1.8} fill="#ef4444" fillOpacity="0.2" />
            <circle cx={marker.x} cy={-marker.y} r={markerR} fill="#ef4444" stroke="#09090b" strokeWidth={2 / pxPerM} />
          </g>
        )}
      </svg>

      {/* escala */}
      {!compact && <ScaleBar pxPerM={pxPerM} />}

      {!compact && (
        <div className="absolute right-2 top-2 flex flex-col gap-1.5">
          <MapBtn label="Acercar" onClick={() => zoomAt(0.6)}>+</MapBtn>
          <MapBtn label="Alejar" onClick={() => zoomAt(1.6)}>−</MapBtn>
          <MapBtn label="Ver circuito completo" onClick={() => { setFollowing(false); fit(); }}>⤢</MapBtn>
          {marker && (
            <MapBtn label="Seguir al piloto" active={following} onClick={() => setFollowing((f) => !f)}>◎</MapBtn>
          )}
        </div>
      )}
      {overlay}
    </div>
  );
}

function MapBtn({ children, onClick, label, active }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className={`grid h-10 w-10 place-items-center rounded-lg border text-lg font-semibold backdrop-blur transition ${
        active ? 'border-rider/60 bg-rider/20 text-rider' : 'border-edge bg-black/60 text-zinc-200 hover:bg-black/80'
      }`}
    >
      {children}
    </button>
  );
}

function ScaleBar({ pxPerM }) {
  const target = 90 / pxPerM;
  const steps = [5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];
  const m = steps.find((s) => s >= target) ?? 1000;
  return (
    <div className="pointer-events-none absolute bottom-2 left-2 font-mono text-[10px] text-zinc-400">
      <div className="h-1.5 border-x border-b border-zinc-400" style={{ width: m * pxPerM }} />
      {m} m
    </div>
  );
}
