/*
 * Adaptado de web-katrain (https://github.com/Sir-Teo/web-katrain), commit 7a0a487, licencia MIT.
 * Origen: src/utils/analysisSmoothing.ts. Licencia completa en apps/web/THIRD-PARTY-LICENSES.
 * Verbatim, sin cambios: no tiene dependencias externas ni usa tipos de web-katrain.
 * Cambios de tengen y procedimiento de re-sync: docs/research/fase-engine/adaptaciones-upstream.md
 */
export function smoothAnalysisGraphValues(values: readonly number[]): number[] {
  return values.map((value, index) => {
    const previous = index > 0 ? values[index - 1] : undefined
    if (!Number.isFinite(value) || typeof previous !== 'number' || !Number.isFinite(previous)) return value
    return (previous + value) / 2
  })
}
