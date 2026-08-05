# Licencia de tengen y de lo que incorpora

**tengen es software libre bajo [AGPL-3.0-or-later](LICENSE)** (© 2026 Edgar Gomero y
contribuidores). La AGPL es deliberada y no incidental: tengen es una app *web* gratuita, y la
cláusula de red de la AGPL es lo que garantiza que cualquiera que despliegue una versión modificada
como servicio publique su código. Es la misma licencia que kaya, el otro cliente de Go
100% client-side.

## Lo que tengen incorpora, y bajo qué términos

Todo lo de abajo es compatible con AGPL-3.0 (MIT y Apache-2.0 son permisivas: se pueden combinar en
una obra AGPL conservando sus avisos, que es lo que hacen los `THIRD-PARTY-LICENSES`).

| Qué | Origen | Licencia |
| --- | --- | --- |
| Encoding V7, MCTS, postproceso (adaptados) | [web-katrain](https://github.com/Sir-Teo/web-katrain) commit `7a0a487` | MIT — cabecera por archivo + `packages/engine/THIRD-PARTY-LICENSES` |
| Tablero, reglas, SGF | `@sabaki/shudan`, `@sabaki/go-board`, `@sabaki/sgf` | MIT |
| Inferencia | onnxruntime-web | MIT |
| Auth, router, runtime | better-auth, preact-router, wrangler, TypeScript | MIT / Apache-2.0 |
| **Pesos de la red b18c384nbt** | [katagotraining.org](https://katagotraining.org/network_license/) | MIT redactada explícitamente para "neural net files or training weight files" (verificado y citado en `docs/research/fase0/resultados.md`) |
| Ejercicios de «Primeros pasos» | Originales de tengen | AGPL-3.0, como el resto del repo |

## La regla que gobierna el contenido de estudio

Adoptar AGPL amplía qué código y contenido podemos absorber (ahora también GPL/AGPL/CC BY-SA),
pero **no cambia el requisito de fondo: cadena de título**. Nadie puede licenciar —ni con MIT ni
con AGPL— una obra sobre la que no tiene derechos. Un repo con `LICENSE` permisivo que contiene
tsumegos escaneados de un libro con derechos vivos no los vuelve libres; solo declara una licencia
que su autor no podía otorgar.

Por eso todo dataset de ejercicios pasa por un veredicto escrito ANTES de empaquetarse:
`docs/research/fase-aprender/contenido-licencias.md`.
