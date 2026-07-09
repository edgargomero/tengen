export type ModelSpec = {
  id: string
  url: string
  bytes: number
  dtype: 'float32' | 'float16'
  inputNames: { bin: string; global: string; meta?: string } | 'introspect'
  notes: string
}

const KAYA = 'https://huggingface.co/kaya-go/kaya/resolve/main/kata1-b28c512nbt-s12043015936-d5616446734'

/** Catálogo de la fase 0. bytes verificados el 2026-07-08
 *  (docs/research/fase0/inventario-onnx.md). url='' → conversión local
 *  (Task 7/8), no la toca download-models.sh; bytes son reales una vez
 *  convertido (0 hasta entonces). */
export const MODELS: ModelSpec[] = [
  {
    id: 'b28c512nbt-kaya.fp16.onnx',
    url: `${KAYA}/kata1-b28c512nbt-s12043015936-d5616446734.fp16.onnx`,
    bytes: 146963282,
    dtype: 'float16',
    inputNames: { bin: 'bin_input', global: 'global_input' },
    notes: 'control: el modelo que kaya usa en producción (MIT); I/O float16',
  },
  {
    id: 'b28c512nbt-kaya.fp32.onnx',
    url: `${KAYA}/kata1-b28c512nbt-s12043015936-d5616446734.fp32.onnx`,
    bytes: 293099607,
    dtype: 'float32',
    inputNames: { bin: 'bin_input', global: 'global_input' },
    notes: 'control fp32 (para GPUs sin shader-f16)',
  },
  {
    id: 'b18c384-weiqiplayground.fp32.onnx',
    url: 'https://huggingface.co/WeiqiPlayground/b18c384/resolve/main/model.onnx',
    bytes: 118065568,
    dtype: 'float32',
    inputNames: { bin: 'bin_inputs', global: 'global_inputs' },
    notes: 'b18 fp32 de terceros; checkpoint sin documentar — solo para velocidad (misma arquitectura)',
  },
  {
    id: 'b18c384nbt-humanv0-misopa.uint8.onnx',
    url: 'https://huggingface.co/Misopa/baduk-human-sl/resolve/main/b18c384nbt-humanv0.uint8.onnx',
    bytes: 28418918,
    dtype: 'float32',
    inputNames: 'introspect',
    notes: 'Human SL uint8 de terceros, sin model card; inputs desconocidos → introspección',
  },
  {
    id: 'b18c384nbt-kata1.fp16.onnx',
    url: '',
    bytes: 58207341,
    dtype: 'float16',
    inputNames: { bin: 'bin_input', global: 'global_input' },
    notes: 'conversión propia con katago-onnx (Task 7) desde kata1-b18c384nbt-s9996604416',
  },
  {
    id: 'b18c384nbt-kata1.fp32.onnx',
    url: '',
    bytes: 115800125,
    dtype: 'float32',
    inputNames: { bin: 'bin_input', global: 'global_input' },
    notes: 'conversión propia fp32 (fallback GPUs sin shader-f16)',
  },
  {
    id: 'b18c384nbt-humanv0.fp16.onnx',
    url: '',
    bytes: 54294241,
    dtype: 'float16',
    inputNames: { bin: 'bin_input', global: 'global_input', meta: 'meta_input' },
    notes: 'conversión propia parcheada (Task 8); tercer input meta [1,192]',
  },
]
