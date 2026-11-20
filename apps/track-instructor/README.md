# Track Instructor — telemetría de trazada para moto en circuito

PWA (React + Vite + Tailwind) para comparar tu trazada GPS (**rojo `#ef4444`**) con la
trazada ideal (**verde `#22c55e`**) en circuitos de velocidad de España.

Publicada en GitHub Pages en `/contratos-web/track-instructor/` (el build se escribe en `../../track-instructor`).

## Uso

```bash
npm install
npm run dev          # desarrollo (http://localhost:5173)
npm test             # tests del motor (meta, simulador, métricas)
npm run build        # genera ../../track-instructor
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

## GPS externo por WiFi

En la app de iPhone, «2. Pista → GPS WiFi» recibe la posición de un receptor GPS externo que emita
**NMEA 0183** por WiFi (pasarelas ESP32 + u-blox, receptores náuticos, data-loggers…):

- **TCP** (lo habitual): la app se conecta a la IP y el puerto del receptor (p. ej. `192.168.4.1:10110`).
- **UDP**: la app escucha en un puerto y el receptor envía a la IP del iPhone (unicast; recibir
  broadcast en iOS requiere un permiso especial de Apple).
- Frases: RMC (principal), GGA (satélites, HDOP), GST (error en metros), VTG. Cualquier talker
  (GP, GN, GL…) y cualquier frecuencia (1–25 Hz). La hora de cada punto es la UTC del receptor, así
  que la latencia de la WiFi no afecta al cronometraje.
- Reconexión automática, pantalla siempre encendida durante la tanda y la inclinación se sigue
  midiendo con el giroscopio del iPhone.

Piezas: `src/telemetry/nmea.js` (lector NMEA), `src/telemetry/externalGpsSource.js` (fuente de datos)
y el plugin nativo `plugins/nmea-socket/` (Swift, Network.framework). En el navegador esta opción no
está disponible: los navegadores no pueden abrir conexiones TCP/UDP.

**Probar sin receptor**: con el ordenador y el iPhone en la misma WiFi,
`npm run nmea-sim -- --circuit jerez --hz 10` emite vueltas simuladas por TCP en el puerto 10110;
conecta la app a la IP del ordenador. Con `--udp <ip del iPhone>` las envía por UDP.

## Trazada de referencia

La línea verde es, por defecto, una trazada calculada por mínima curvatura (orientativa). No hay
trazadas GPS de pilotos profesionales publicadas, así que en «3. Análisis → Trazada de referencia»
puedes sustituirla, por circuito, por una vuelta real: una tuya, la vuelta rápida de la sesión o una
importada (GPX, NMEA, VBO, CSV) de un instructor o un piloto más rápido. Se usa en el mapa, en vivo y
para medir la desviación.

## Tiempo de uso

«3. Análisis → Tiempo de uso» suma las horas en pista (solo en movimiento, a más de 10 km/h), las
vueltas y los kilómetros de las sesiones reales, con desglose por circuito. Las simuladas no cuentan.
Incluye contadores reiniciables (neumáticos, aceite y los que añadas) para saber el uso desde el
último cambio. Cada sesión guarda su `durationMs` (tiempo en movimiento, vueltas de salida y entrada
incluidas) y su `distanceM`; en sesiones antiguas se calculan a partir de las vueltas.

## Descargar sesiones del GPS de la moto (WiFi)

«3. Análisis → Descargar del GPS (WiFi)» trae las sesiones que ha grabado un GPS o data-logger
externo que las comparte por WiFi:

- **Servidor web**: el GPS sirve una página o un JSON con sus archivos (`http://192.168.4.1/`). La app
  los lista, descargas los que elijas y se cronometran y asignan al circuito automáticamente.
- **Volcado TCP**: al conectarse a IP:puerto, el GPS envía su registro (NMEA) y la app lo importa.
- Formatos: GPX, NMEA (.nmea/.log/.txt), VBO (Racelogic), CSV (RaceChrono o genérico con
  latitud/longitud/tiempo) y sesiones JSON. Los mismos formatos se pueden importar como archivo.

En la app de iPhone las descargas van por la capa nativa (sin las restricciones de CORS del
navegador). Dispositivos con protocolo propio y cerrado (AiM, Starlane…) no exponen sus datos así:
exporta el archivo con su programa e impórtalo.

## App iOS y TestFlight

La app iOS envuelve la PWA con [Capacitor](https://capacitorjs.com) (`ios/`, bundle id
`com.kamagabike.trackinstructor`). El GPS usa `navigator.geolocation` dentro de la app y la
inclinación, el giroscopio (permisos en `ios/App/App/Info.plist`).

El workflow `.github/workflows/track-instructor-testflight.yml` compila en un Mac de GitHub Actions,
firma con firma automática en la nube y sube el build a TestFlight en cada push a `main` que toque
`apps/track-instructor/`, o a mano desde la pestaña Actions («Run workflow»).

Configuración, una sola vez:
1. En App Store Connect → Apps → «+» → Nueva app: plataforma iOS, nombre «Track Instructor» (o el que
   esté libre), bundle id `com.kamagabike.trackinstructor` (regístralo antes en developer.apple.com →
   Identifiers si no aparece) y un SKU cualquiera.
2. En App Store Connect → Usuarios y acceso → Integraciones → Claves de API de App Store Connect:
   genera una clave con rol **Admin** y descarga el `.p8` (solo se puede descargar una vez).
3. En GitHub → Settings → Secrets and variables → Actions, crea: `APPLE_TEAM_ID`, `ASC_KEY_ID`,
   `ASC_ISSUER_ID` y `ASC_KEY_P8` (el contenido del `.p8`, tal cual).
4. Lanza el workflow. El build aparece en TestFlight tras el procesado de Apple; añade testers
   internos en App Store Connect → TestFlight.

En local (macOS con Xcode): `npm run build && npx cap sync ios && npx cap open ios`.
