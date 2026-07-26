// Worker de un solo uso para la pantalla de diagnóstico: sondea WebGPU DENTRO de un worker y postea el
// resultado. Vive y muere en un sondeo.
//
// Por qué un worker propio y no el del motor: `session.ts` cachea su configuración de ORT en un flag de
// módulo (`ortConfigured`) e instala el adapter en `ort.env.webgpu.adapter`. Sondear desde ahí
// contaminaría ese estado —o lo leería ya contaminado—, y el diagnóstico dejaría de medir el arranque en
// frío, que es exactamente lo que hay que medir. Por la misma razón este archivo NO importa
// `@tengen/engine`: sólo `gpuProbe`, que no toca ORT.
import { currentProbeEnv, errorText, probeGpu } from './gpuProbe'
import type { ProbeWorkerMessage } from './gpuProbe'

// `self` está tipado como Window (lib DOM); su postMessage tiene otra firma. Mismo cast que
// `engine.worker.ts`.
const scope = self as unknown as { postMessage(message: ProbeWorkerMessage): void }

// Postea al arrancar, sin esperar un mensaje: el worker existe para una sola cosa y así el hilo
// principal no necesita coordinar un handshake que podría quedar a medias en un aparato roto.
void probeGpu(currentProbeEnv('worker')).then(
  (probe) => scope.postMessage({ ok: true, probe }),
  // `probeGpu` está escrito para no lanzar nunca; esta rama existe para que un bug ahí se reporte como
  // dato en vez de convertirse en un worker mudo indistinguible de un cuelgue.
  (err: unknown) => scope.postMessage({ ok: false, error: errorText(err) }),
)
