# Racing Line — telemetría de trazada para moto en circuito

PWA (React + Vite + Tailwind) para comparar tu trazada GPS (**rojo `#ef4444`**) con la
trazada ideal (**verde `#22c55e`**) en circuitos de velocidad de España.

Publicada en GitHub Pages en `/contratos-web/racing/` (el build se escribe en `../../racing`).

## Uso

```bash
npm install
npm run dev          # desarrollo (http://localhost:5173)
npm test             # tests del motor (meta, simulador, métricas)
npm run build        # genera ../../racing
npm run gen:circuits # regenera src/data/trackGeometry.js
```

Pestañas: **Circuito** (selector) → **Grabación** (GPS real o «Simular vuelta GPS», ×1/×4/×10)
→ **Análisis** (vueltas, vuelta rápida, mapa con zoom/paneo, velocidad y desviación).

## Estructura

| Ruta | Qué hace |
|---|---|
| `src/data/circuits.js` | Base de datos de circuitos + modelo de pista (bordes, pianos, meta, trazada ideal) |
| `src/data/trackGeometry.js` | Líneas centrales GPS `[lat, lon]` y línea de meta (generado) |
| `scripts/build-circuits.mjs` | Generador de geometría |
| `src/geo/projection.js` | Proyección lat/lon ↔ metros locales |
| `src/geo/geometry.js` | Intersección de segmentos, distancias, splines Catmull-Rom, normales, curvatura |
| `src/geo/racingLine.js` | Trazada ideal por mínima curvatura (relajación multiescala acotada al ancho de pista) |
| `src/telemetry/lapTimer.js` | Detección de paso por meta con interpolación del instante exacto |
| `src/telemetry/simulator.js` | Simulador GPS (perfil de velocidad físico, desviaciones, errores en curva, ruido) |
| `src/telemetry/gpsSource.js` | `watchPosition` con `enableHighAccuracy` + Wake Lock |
| `src/telemetry/analysis.js` | Vel. máxima, desviación media/máxima respecto a la ideal |
| `src/storage/sessions.js` | Sesiones en IndexedDB (respaldo en localStorage) |
| `src/components/TrackMap.jsx` | Mapa SVG con pan/zoom (rueda, pellizco, botones, seguir piloto) |

## Datos de circuitos

- **Montmeló**: trazado GPS real de [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT).
- **Jerez y Cheste**: aproximaciones (coordenadas, longitud oficial y sentido de giro reales; forma
  aproximada). Para precisión real, sustituye los puntos de control en `scripts/build-circuits.mjs`
  por una vuelta GPS grabada o un export de OpenStreetMap (`highway=raceway`) y ejecuta `npm run gen:circuits`.
- Aragón, Navarra, Albacete y Almería aparecen en el selector sin geometría todavía.

La trazada ideal es una aproximación de mínima curvatura (exterior–ápice–exterior); no modela
frenada tardía ni ápices retrasados específicos de moto.
