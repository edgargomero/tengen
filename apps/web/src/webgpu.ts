// Gate de WebGPU (Chrome-first, ver CLAUDE.md). No basta con que exista `navigator.gpu`: puede existir y
// no entregar adapter (GPU bloqueada, driver en lista negra, sin memoria), así que se pide el adapter
// real. La app sólo arranca el motor si esto pasa.
//
// Devuelve el MOTIVO además del veredicto. Antes era un booleano pelado con un `catch {}` vacío, y ese
// catch silencioso es exactamente por qué un iPhone que muestra "necesita WebGPU" no dice nada más: las
// cuatro causas posibles —no hay `navigator.gpu`, el adapter vino `null`, `requestAdapter()` lanzó, o no
// resolvió nunca— llegaban colapsadas en el mismo `false`.
//
// Lo que este gate deliberadamente NO hace es pedir un `device`. Es tentador (un adapter que se entrega
// con un device que falla es un modo de fallo real, típicamente móvil), pero pagarlo acá se lo cobra a
// TODOS: una creación de device antes de que se dibuje el menú, y un fallo transitorio dejaría afuera a
// alguien cuya app hoy funciona. El sondeo profundo —device, `device.lost`, límites, y lo mismo dentro
// del worker— vive en `diagnostics/gpuProbe.ts`, que corre sólo cuando se abre `/diagnostico`.
interface MinimalGpu {
  requestAdapter(): Promise<unknown | null>
}

export interface WebGpuDetection {
  ok: boolean
  /** Frase corta, mostrable al usuario, con la causa concreta. Vacía nunca. */
  reason: string
}

export async function detectWebGpu(): Promise<WebGpuDetection> {
  const gpu = (navigator as Navigator & { gpu?: MinimalGpu }).gpu
  if (!gpu) {
    return { ok: false, reason: 'Este navegador no expone navigator.gpu.' }
  }
  try {
    const adapter = await gpu.requestAdapter()
    if (adapter === null) {
      return { ok: false, reason: 'El navegador tiene WebGPU pero no entregó ningún adapter de GPU.' }
    }
    return { ok: true, reason: 'Adapter de GPU disponible.' }
  } catch (err) {
    return {
      ok: false,
      reason: `requestAdapter() falló: ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}`,
    }
  }
}
