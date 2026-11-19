# Track Limit — telemetría de trazada para moto en circuito

PWA (React + Vite + Tailwind) para comparar tu trazada GPS (**rojo `#ef4444`**) con la
trazada ideal (**verde `#22c55e`**) en circuitos de velocidad de España.

Publicada en GitHub Pages en `/contratos-web/track-limit/` (el build se escribe en `../../track-limit`).

## Uso

```bash
npm install
npm run dev          # desarrollo (http://localhost:5173)
npm test             # tests del motor (meta, simulador, métricas)
npm run build        # genera ../../track-limit
npm run gen:circuits # regenera src/data/trackGeometry.js
```

Pestañas: **1. Circuitos** → **2. Pista** (GPS real o «Simular Tanda en Vivo» a 1/10 Hz, tiempo real/×4/×10)
→ **3. Análisis** (vueltas, parciales T1/T2/T3, vuelta rápida y mejores parciales en violeta, vuelta
ideal, mapa con zoom/paneo, velocidad, desviación e inclinación).

## Funciones clave

- **Cronometraje**: intersección 2D del vector de movimiento con la meta (A-B) y los parciales T1/T2,
  solo en sentido de marcha, con el instante interpolado entre fixes (preciso incluso a 1 Hz).
- **Suavizado**: la trazada roja se interpola con Catmull-Rom centrípeta (`smoothTrace`).
- **Desviación**: segmento verde más cercano a cada punto rojo + distancia Haversine.
- **Inclinación**: `DeviceOrientationEvent` (con permiso en iOS), cero calibrado al iniciar; orientativa.
- **Simulador**: 80 km/h en curva lenta → vmax en recta, lean = atan(v²κ/g), errores de trazada y ruido GPS.
- **Comparador**: vuelta elegida vs vuelta de referencia (violeta) y gráfica de delta de tiempo.
- **Exportar / importar**: GPX, CSV y sesión JSON; un GPX importado se cronometra automáticamente.
- **Robustez GPS**: descarta fixes duplicados, desordenados, imprecisos (> 30 m) o con saltos
  imposibles; antirrebote de meta por distancia (150 m); tolera pérdidas de señal sobre meta/parciales.
- **Persistencia**: `localStorage` (formato compacto, descarta sesiones antiguas si se llena).

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
| `src/storage/sessions.js` | Sesiones en localStorage |
| `src/telemetry/leanSensor.js` | Ángulo de inclinación por giroscopio |
| `src/components/TrackMap.jsx` | Mapa SVG con pan/zoom (rueda, pellizco, botones, seguir piloto) |

## Datos de circuitos

- **Montmeló**: trazado GPS real de [bacinger/f1-circuits](https://github.com/bacinger/f1-circuits) (MIT).
- **Jerez y Cheste**: aproximaciones (coordenadas, longitud oficial y sentido de giro reales; forma
  aproximada). Para precisión real, sustituye los puntos de control en `scripts/build-circuits.mjs`
  por una vuelta GPS grabada o un export de OpenStreetMap (`highway=raceway`) y ejecuta `npm run gen:circuits`.
- **Aragón, Navarra, Albacete, Almería y Cartagena**: trazados *representativos* (plantilla) con
  longitud y sentido aproximados, listos para rellenar con datos reales en `scripts/build-circuits.mjs`.
- Las líneas de meta y parciales se generan perpendiculares a la pista (meta en el punto 0; T1/T2 en
  el tramo más recto cerca de 1/3 y 2/3 de la vuelta). Con datos reales, ajusta sus coordenadas.

La trazada ideal es una aproximación de mínima curvatura (exterior–ápice–exterior); no modela
frenada tardía ni ápices retrasados específicos de moto.
