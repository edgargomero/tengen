# Informe de decisión: motor KataGo para app web gratuita de Go — (A) Cloudflare Container CPU vs (B) 100% client-side vs (C) híbrido

Convenciones: **[medido]** = cifra de fuente primaria verificada adversarialmente; **[extrapolación]** = derivada, no medida en ninguna fuente; **[anecdótico]** = testimonio sin benchmark reproducible; **[refutada]** = afirmación que la verificación adversarial tumbó; **[sin dato]** = buscado explícitamente y no existe.

## 1. TL;DR

**Recomendación: B — 100% client-side (red KataGo en ONNX/TF.js vía WebGPU con fallback WASM + MCTS reimplementado en el worker), con C como extensión futura opcional, no como punto de partida.** El costo marginal por usuario de B es ~$0 (R2 tiene egress $0) mientras que A cuesta ~$0.10-0.19 por hora-jugador concurrente y escala linealmente con el uso de un producto gratuito, y —la asimetría decisiva— el servidor que pagarías NO es más fuerte que el cliente: Cloudflare no ofrece GPU (tope 4 vCPU CPU-only, donde la red estándar b18 rinde ~3-8 visitas/s [extrapolación]), mientras una iGPU de cliente ya medida hace ~10 inferencias/s con esa misma red vía WebGPU. La factibilidad de B está demostrada en producción (Kaya, kayago.app, corre la red b28c512nbt con MCTS en TypeScript en el navegador desde mayo 2026; web-katrain, MIT, hace lo propio con TF.js), y la fuerza a pocas visitas sobra para cualquier amateur — lo único que un prototipo debe validar es el rendimiento en hardware de usuario típico y móvil.

## 2. Tabla comparativa

| Dimensión | A: Container CPU (Eigen) | B: Client-side (WebGPU/WASM) | C: Híbrido |
|---|---|---|---|
| **Fuerza jugable** | Con b18c384nbt: INVIABLE (~3-8 v/s en 2-4 vCPU **[extrapolación, posiblemente optimista]**; medido: 51.7 v/s con 20 núcleos desktop, songyp.com). Con b10/b15: viable, "pro-level-and-beyond" a 50-200 visitas en ~0.5-5 s **[derivado de benchmark M1: b10 = 78-176 v/s a 4 threads]** | b18 vía WebGPU: ~10 inf/s ≈ 5-10 visitas/s **[medido, pero hardware de gama alta y auto-reportado por Kaya]**; a 8 playouts la red grande ya es top-500 mundial y ≥128 sobrehumana (arXiv 2211.00241, cifras para b40c256). Redes b6/b10: presumiblemente decenas-cientos de evals/s **[extrapolación — sin benchmark publicado en navegador]** | La del cliente para jugar; el servidor no añade fuerza (sin GPU, mismo techo CPU que A) |
| **Fuerza análisis** | Análisis serio con b18 descartado en CPU (necesita 5-10x el cómputo de jugar **[anecdótico, hexahedron]**); solo análisis ligero con redes pequeñas | 50 visitas/posición ("gana a muchos pros", tier gratis de AI Sensei) ≈ 5-10 s/posición con b18/WebGPU en el hardware medido; 500 visitas (estándar KaTrain) es lento → análisis progresivo/bajo demanda | Cliente para análisis ligero + servidor para trabajos batch profundos (única ventaja real de C, y aun así limitada por CPU-only) |
| **Latencia por jugada** | 0.5-5 s (b10, 50-200 visitas) + cold start 1-3 s oficial / 3-15 s comunidad + ~2 s de carga de pesos (disco 100% efímero) | ~0.1-1 s en niveles débiles (~1-40 evals); segundos en niveles fuertes; descarga inicial única de 5-98 MB según red | Como B, con red de seguridad server |
| **Costo marginal** | ~$0.19/h por contenedor standard-3 activo al 80%, piso $0.076/h despierto aunque nadie piense **[medido, pricing oficial]**; ~$0.00002-0.0004 de CPU por jugada **[derivado]** | ~$0. R2: egress $0 incondicional; free tier 10 GB storage / 10M lecturas Class B **[medido]** | El componente servidor cuesta como A por hora activa |
| **Costo fijo** | $5/mes Workers Paid obligatorio | $0 (b6 = 4.97 MB y b10 = 14.5 MB caben como static assets <25 MiB; b18+ va a R2) | $5/mes + operación del contenedor |
| **Complejidad** | Baja-media: binarios eigen/eigenavx2 oficiales precompilados linux-x64, Analysis Engine JSON oficial, wrappers open-source (goban-app/katago-server, Rust) | Media-alta: no hay build WASM oficial de KataGo; hay que convertir la red (pipeline kaya-go/katago-onnx reutilizable) y reimplementar MCTS en TS (referencias: Kaya AGPL-3.0, web-katrain MIT) | La suma de ambas + protocolo de decisión cliente/servidor |
| **Riesgo principal** | Costo lineal con horas-jugador sin techo; rendimiento real del vCPU de CF Containers **[sin dato — no existe ningún benchmark público]**; AVX2 inferido de la flota EPYC, no documentado | Rendimiento en hardware modesto/móvil sin medir; WebGPU ~83.6% de cobertura (Firefox desactivado por defecto) → fallback WASM multihilo obligatorio con COOP/COEP; fp16 crashea en WASM/CPU | Doble superficie de mantenimiento; incentivo a empujar carga al servidor "porque está ahí" |
| **Precedente en producción** | Todos los servicios establecidos (AI Sensei, OGS, ZBaduk) son server-side pero **con GPU**, capando profundidad en el tier gratis; el único precedente CPU-only serverless (Heroku, hauensteina) se degradó a red 10b/1 thread/8 playouts — aunque ese caso NO es cota de un container de 4 vCPU **[framing "cota directa" corregido en verificación]** | Kaya (kayago.app): producto web gratuito en producción con red b28 ONNX + MCTS TS. La afirmación "ningún producto web corre KataGo client-side" fue **[refutada]** | Ninguno conocido con KataGo |

Nota sobre unidades: la referencia "RTX 4070 = 6.500 visitas/s" mezcla visitas de búsqueda con caché de NN vs inferencias crudas del navegador; la brecha navegador↔GPU dedicada es de 2-3 órdenes de magnitud direccionales, no un ratio exacto.

Nota de coherencia del dossier: la dimensión "comparables" concluyó que ningún producto web ejecuta MCTS client-side (basándose en la declaración del autor de Kaya de dic-2025), pero la dimensión "wasm-browser" verificó a nivel de código (onnx-mcts.ts con PUCT, spec "MCTS-first" marcada shipped el 2026-05-04, presets 1/50/500/2500) que Kaya SÍ despacha MCTS en el navegador hoy. La evidencia posterior y a nivel de código prevalece: **MCTS en navegador tiene precedente en producción desde mayo 2026**.

## 3. Modelo de costos del contenedor (opción A)

Precios oficiales (developers.cloudflare.com/containers/pricing/, verificados): CPU $0.000020/vCPU-s **solo por uso activo** (desde 2025-11-21); memoria $0.0000025/GiB-s y disco $0.00000007/GB-s **por recursos APROVISIONADOS mientras el contenedor está despierto**. Requiere Workers Paid ($5/mes). Tope duro por instancia: standard-4 = 4 vCPU / 12 GiB / 20 GB (los custom instance types no lo superan).

Contenedor de referencia: standard-3 (2 vCPU / 8 GiB / 16 GB), suficiente para KataGo con redes pequeñas (RAM medida: 96-713 MiB según red).

| Concepto | Cifra (verificada/corregida) |
|---|---|
| Hora activa al 80% CPU | $0.1912/h ($0.1152 CPU + $0.072 RAM + $0.004 disco) |
| Piso por contenedor despierto OCIOSO | $0.076/h (RAM + disco se pagan igual) |
| 1 contenedor, 4 h/día | ≈ $23/mes + $5 plan |
| 1 contenedor, 12 h/día | ≈ $69/mes + $5 plan |
| 10 contenedores concurrentes, 8 h/día | ≈ $459/mes + $5 plan |
| CPU por jugada (b10, 50-200 visitas, 1-20 vCPU-s) | $0.00002-$0.0004 **[derivado, sin benchmark en CF]** |

Lecturas clave:
- El costo escala **linealmente con horas-contenedor despierto** (~$0.10-0.19 por hora-jugador concurrente si no amortizas varios jugadores por contenedor), sin techo natural en un producto gratuito. Las cuotas incluidas del plan (375 vCPU-min, 25 GiB-h, 200 GB-h/mes) valen ~$0.7/mes: despreciables.
- El costo dominante en sesiones de Go (el jugador piensa la mayor parte del tiempo) es la **RAM aprovisionada despierta**, no la CPU activa — el cambio de pricing de nov-2025 no arregla eso.
- Mitigaciones: sleepAfter corto (reintroduce cold starts de 1-15 s + recarga de pesos, disco efímero), multiplexar partidas por contenedor (WebSockets soportados con renovación automática del activity timeout), instancia menor (basic 1/4 vCPU / 1 GiB baja el piso a costa de latencia).
- **[sin dato]**: no existe ningún benchmark público de KataGo (ni del rendimiento de vCPU en general) en Cloudflare Containers, Cloud Run ni Fly.io; AVX2 es inferencia por la flota AMD EPYC, no documentación. Cualquier plan A exige medirlo antes.
- Comparable histórico: ZBaduk pagaba ~$100/mes por GPU de gama baja (2019) y sus costos superaron el presupuesto; AI Sensei y OGS sobreviven en gratis capando profundidad (50 playouts gratis vs 500-10.000 pagados; OGS da gratis solo "jugadas clave", supporters 400-12.000 playouts).

## 4. Qué es factible HOY client-side y con qué fuerza

**(i) Oponentes débiles/calibrados (el grueso del público 20k-5d): trivial, ~1 evaluación de red por jugada.** Los bots calibrados de KaTrain funcionan "identically with 1 visit" sobre la policy y midieron 17k→3d reales en OGS (5d con red 20b). El modelo oficial Human SL b18c384nbt-humanv0 (99 MB, KataGo v1.15.0) imita rangos 20k-9d con la policy humana cruda; su config de ejemplo gasta 40 visitas solo para pass/resign, reducible a ~1. Corre bien incluso en WASM sin WebGPU.

**(ii) Oponente fuerte: factible con red pequeña + búsqueda modesta.** La policy sola de una red grande es ~top-100 europeo (~2738 Elo goratings, arXiv 2211.00241); "1 visita mantuvo 8d en KGS" **[anecdótico]**; 8 playouts = top-500 mundial, ≥128 = sobrehumano (cifras para b40c256; con redes menores el Elo baja pero sigue aplastando a amateurs). Rendimiento medido en navegador: b18 = 160-176 ms/inferencia en WASM 8 hilos (~6 inf/s) y ~100 ms en WebGPU (10 inf/s) **[medido por Kaya en Radeon 8060S — gama muy alta, auto-reportado, sin réplica independiente; espera menos en hardware típico]**. Para b6c96 (4.97 MB) y b10c128 (14.5 MB) **no existe benchmark publicado en navegador**; que rindan decenas-cientos de evals/s es extrapolación por FLOPs.

**(iii) Análisis: útil pero acotado.** Ancla de mercado barata: 50 visitas/posición = tier gratis de AI Sensei ("debería ganar a muchos pros"); 500 = KaTrain por defecto / "sobrehumano". A ~10 inf/s son ~5-10 s por posición a 50 visitas: análisis de jugada bajo demanda funciona; el review completo a 500 visitas/jugada es lento client-side en hardware medio — diseñar como análisis progresivo/priorizado, no batch instantáneo.

Logística: b6/b10 caben como static assets de Workers (<25 MiB/archivo); b18 (97.9 MB .bin.gz) y los ONNX de b28 (fp16 147 MB / uint8 75 MB) van a R2 con egress $0. Cobertura WebGPU ~83.6% (caniuse jul-2026; Firefox desactivado por defecto) → fallback WASM multihilo obligatorio, que exige COOP/COEP (configurables en Cloudflare). No hay build WASM oficial del motor: la vía probada es red vía onnxruntime-web/TF.js + MCTS en TS (Kaya, web-katrain); el port emscripten de y-ich está congelado desde ene-2024.

## 5. Riesgos principales

**A (Container CPU):**
- Costo sin techo, lineal con adopción, para un producto sin ingresos; piso de $0.076/h por contenedor despierto ocioso.
- Rendimiento del vCPU **[sin dato]** — riesgo de que "~3-8 v/s con b18" resulte aún peor en vCPU compartidos (la verificación la calificó de "posiblemente optimista").
- Cero camino de mejora de fuerza: sin GPU para clientes a julio 2026 ni roadmap; Workers AI no acepta ONNX propios (BYO-model vía Replicate en preview cerrada).
- Cold start + disco efímero: cada despertar recarga pesos.

**B (Client-side):**
- Varianza de hardware: benchmarks existentes son de gama alta; móviles y laptops viejos sin medir; fp16 crashea en WASM/CPU y uint8 es 1.7x más lento que fp32 en CPU.
- Fragmentación: Firefox sin WebGPU por defecto; WASM multihilo requiere cross-origin isolation (COOP/COEP).
- Descarga inicial de 75-150 MB para redes fuertes (mitigable: 5-15 MB con redes pequeñas por defecto + red fuerte opcional cacheada).
- Ingeniería propia de MCTS en TS. Licencias: **Kaya es AGPL-3.0 (copiar su código contamina el producto); web-katrain es MIT (referencia segura)**; kaya-go/katago-onnx es reutilizable para convertir redes.
- La fuerza real de b6c96 a pocas visitas no está medida directamente en rango humano (solo acotada: ~6d amateur estimado, −1184 Elo en escala g170).

**C (Híbrido):**
- Hereda ambas complejidades y el costo fijo/marginal del servidor, para un beneficio acotado: el servidor CPU no juega mejor que un cliente WebGPU con b18, así que solo aporta (a) rescate de dispositivos muy débiles y (b) análisis batch offline — ambos implementables después sobre una base B sin re-arquitectura si el frontend habla con "un motor" detrás de una interfaz.

## 6. Preguntas abiertas que solo resuelve un prototipo

1. **inf/s reales de b6c96, b10c128 y b18 en navegador en hardware TÍPICO** (laptop medio, Android medio, iPhone), en WASM multihilo y WebGPU — el dossier solo tiene un punto de datos de gama alta y ningún benchmark de b6/b10 en navegador.
2. **Fuerza percibida de b6/b10 con 50-200 visitas** contra jugadores reales kyu/dan — solo acotada indirectamente.
3. **UX de descarga y caché de la red** (5-98 MB): tiempo hasta primera jugada, persistencia (Cache API/OPFS), comportamiento en móvil con poca RAM (¿cuándo forzar uint8 pese a su lentitud en CPU?).
4. **Fallback WASM en Firefox/Safari viejos**: single-thread vs multihilo, y fricción real de COOP/COEP con el resto de la app.
5. Solo si A/C sigue viva: **benchmark de KataGo Eigen en un Cloudflare Container real** (v/s por red, flags CPU vía /proc/cpuinfo, cold start con pesos en la imagen) — hoy es un vacío total de datos y es un experimento de un día con los binarios eigenavx2 precompilados.
6. **Latencia tolerable del análisis progresivo client-side**: ¿bastan las "jugadas clave" priorizadas (patrón OGS gratis) a 50 visitas/jugada?

Plan mínimo sugerido por los datos: prototipo B con web-katrain/Kaya como referencia (cuidando la AGPL), red b10 por defecto + b18/humanv0 opcionales desde R2, oponentes calibrados policy-only como modo estrella (~1 eval/jugada), y un benchmark de un día en un Container solo para cerrar la pregunta 5 con números en vez de extrapolaciones.