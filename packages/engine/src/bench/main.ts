import { MODELS } from './registry'
import { runBench, type BenchResult } from './runner'

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T
function log(msg: string): void {
  const el = $('#log')
  el.textContent ??= ''
  el.textContent += msg + '\n'
}
const results: BenchResult[] = []

async function available(): Promise<typeof MODELS> {
  const out: typeof MODELS = []
  for (const m of MODELS) {
    const res = await fetch(`/models/${m.id}`, { method: 'HEAD' }).catch(() => null)
    if (res?.ok) out.push(m)
    else log(`(saltando ${m.id}: no está en models/)`)
  }
  return out
}

function render(r: BenchResult) {
  const row = document.createElement('tr')
  const s = r.stats
  row.innerHTML =
    `<td>${r.model}</td><td>${r.ep}</td><td>${s.batchSize}</td>` +
    `<td>${s.medianMs.toFixed(1)}</td><td>${s.p10Ms.toFixed(1)}</td><td>${s.p90Ms.toFixed(1)}</td>` +
    `<td><b>${s.infPerSec.toFixed(2)}</b></td><td>${r.sanity.join('; ') || 'ok'}</td>`
  $('#results tbody').appendChild(row)
}

$('#env').textContent = `crossOriginIsolated=${self.crossOriginIsolated} · threads=${navigator.hardwareConcurrency} · UA=${navigator.userAgent}`

$('#run').addEventListener('click', async () => {
  ;($('#run') as HTMLButtonElement).disabled = true
  const models = await available()
  for (const model of models) {
    for (const ep of ['webgpu', 'wasm'] as const) {
      if (ep === 'webgpu' && !navigator.gpu) continue
      for (const batch of [1, 8]) {
        log(`corriendo ${model.id} · ${ep} · batch ${batch}…`)
        try {
          const r = await runBench(model, { ep, batch, warmup: 5, runs: 30, size: 19 })
          results.push(r)
          render(r)
        } catch (e) {
          log(`  ERROR: ${(e as Error).message}`)
        }
      }
    }
  }
  ;($('#export') as HTMLButtonElement).disabled = false
  log(`listo: ${results.length} mediciones · adapter: ${results[0]?.adapter ?? '?'}`)
})

$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({ ua: navigator.userAgent, results }, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = 'fase0-resultados.json'
  a.click()
})
