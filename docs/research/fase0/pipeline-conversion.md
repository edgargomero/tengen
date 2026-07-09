RESUMEN: El pipeline real NO es .bin.gz → ONNX sino checkpoint PyTorch (.ckpt) → ONNX. El repo kaya-go/katago-onnx (https://github.com/kaya-go/katago-onnx, AGPL-3.0, autor Hadrien Mary) existe y es la herramienta que generó los ONNX de HuggingFace kaya-go/kaya. CLI: `pixi install` + `pixi run katago-onnx convert ./artifacts/ -n <red>`; descarga el zip del checkpoint torch desde media.katagotraining.org, carga el modelo con código de entrenamiento de KataGo v1.16.4 vendorizado, y exporta SIEMPRE tres variantes (.fp32.onnx, .fp16.onnx, .uint8.onnx) con opset 17, ejes dinámicos (batch/height/width) y las 9 salidas principales completas (policy, value, miscvalue, moremiscvalue, ownership, scoring, futurepos, seki, scorebelief). Soporta macOS Apple Silicon nativamente (pixi platforms: osx-arm64). Para kata1-b18c384nbt funciona tal cual (checkpoint torch verificado en katagotraining.org, p.ej. kata1-b18c384nbt-s9996604416-d4316597426, 214 MB). Para b18-humanv0 el checkpoint torch existe (b18c384nbt-humanv0.ckpt, 323 MB, en el release v1.15.0 de KataGo) y el código de modelo vendorizado soporta el metadata encoder de HumanSL, PERO convert.py solo pasa 2 inputs y el forward hace `assert input_meta is not None`: requiere un parche pequeño (tercer input meta_input de forma [1,192]). Para b10c128 el pipeline kaya NO sirve: los zips de kata1-b10c128 contienen un saved_model de TensorFlow + model.txt.gz, sin model.ckpt (verificado descargando el zip); las vías serían isty2e/KataGoONNX (convierte .bin de model version 8, proyecto de 2020 SIN licencia) o tf2onnx sobre el saved_model (no verificado). El repo oficial de KataGo NO tiene exportador ONNX (export_model_pytorch.py exporta al formato .bin propio). Alternativas comunitarias: yehu3d/katago_onnx (MIT, ckpt2onnx.py pero CUDA-only, 19x19 fijo, poda a 5 salidas y tiene un bug args.input/--i_ckpt), justmaker/katago-onnx-mobile (plugin Flutter de inferencia, no conversor), YH7916/KataGo_onnx_convert (solo b6). En HuggingFace solo existen los ONNX b28 de kaya; nadie ha publicado b18 ni humanv0 en ONNX. Discrepancia a vigilar: el código actual de conversión FP16 pone I/O en float16, pero la model card de HF dice que la I/O queda en FP32 — verificar los dtypes reales de los tensores al cargar en el harness.

HALLAZGOS:
- El repo kaya-go/katago-onnx existe: https://github.com/kaya-go/katago-onnx, descripción 'Convert KataGo models to ONNX', creado 2025-11-23, último push 2026-04-12, rama main, 7 stars. El LICENSE es el texto íntegro de GNU AGPL v3 (la API de GitHub lo marca NOASSERTION, pero el archivo y el README dicen AGPL-3.0). Autor: Hadrien Mary (hadrien.mary@gmail.com, pyproject.toml). [alta] (https://api.github.com/repos/kaya-go/katago-onnx + https://raw.githubusercontent.com/kaya-go/katago-onnx/main/LICENSE + README.md + pyproject.toml)
- El pipeline de kaya NO parte de .bin.gz: download.py descarga https://media.katagotraining.org/uploaded/networks/zips/kata1/{network_name}.zip, extrae model.ckpt (checkpoint PyTorch de entrenamiento) y convert.py lo carga con load_model del código de KataGo vendorizado. Si el zip no contiene model.ckpt lanza FileNotFoundError. [alta] (https://raw.githubusercontent.com/kaya-go/katago-onnx/main/src/katago_onnx/download.py y convert.py)
- Comando exacto de conversión: `pixi install` y luego `pixi run katago-onnx convert ./artifacts/ --networks <nombre>` (alias -n; sin -n convierte los defaults kata1-b28c512nbt-adam-s11165M-d5387M y kata1-b28c512nbt-s12043015936-d5616446734). Subida a HF: `pixi run katago-onnx upload ./artifacts/ --repo-id kaya-go/kaya`. CLI implementada con typer en src/katago_onnx/cli.py. [alta] (https://raw.githubusercontent.com/kaya-go/katago-onnx/main/src/katago_onnx/cli.py + README.md)
- Requisitos (pixi.toml, canal conda-forge): Python >=3.13.11, pytorch >=2.9.1, onnxruntime >=1.22.2, onnxscript >=0.5.6, httpx, typer, tqdm, huggingface_hub, pandas; pypi: sgfmill. Plataformas declaradas: osx-arm64 y linux-64 — macOS Apple Silicon soportado explícitamente. [alta] (https://raw.githubusercontent.com/kaya-go/katago-onnx/main/pixi.toml)
- La conversión (convert_katago_torch_to_onnx) siempre genera TRES archivos sin flag para elegir: .fp32.onnx (torch.onnx.export, opset 17, dynamo=False, ejes dinámicos batch/height/width), .fp16.onnx (conversor nativo propio _convert_to_fp16_native que pasa pesos, Cast, Constant e I/O a float16), y .uint8.onnx (onnxruntime quantize_dynamic con QUInt8 tras quant_pre_process). Inputs: bin_input [batch,22,H,W] y global_input [batch,19]. [alta] (https://raw.githubusercontent.com/kaya-go/katago-onnx/main/src/katago_onnx/convert.py)
- La conversión de kaya preserva las 9 salidas principales del modelo: policy, value, miscvalue, moremiscvalue, ownership, scoring, futurepos, seki, scorebelief (output_names en convert.py; shapes documentadas en la model card: policy [batch,2,moves], value [batch,3], ownership [batch,1,H,W], scoring [batch,1,H,W], futurepos [batch,2,H,W], seki [batch,4,H,W]). Es decir: policy, value, score (miscvalue índice 2 = lead, más scorebelief) y ownership están TODOS presentes. Caveat: si el checkpoint tiene intermediate head, esas salidas extra quedarían fuera de los 9 nombres (el b28 publicado tiene exactamente estas 9). [alta] (https://raw.githubusercontent.com/kaya-go/katago-onnx/main/src/katago_onnx/convert.py + HF_MODEL_CARD.md)
- El código de KataGo vendorizado en kaya-go/katago-onnx es de la versión v1.16.4 (commit 4b8de63bea2bd8790db96cd6f8daf86dc87be6f7 de lightvector/KataGo), por lo que soporta las configs de modelo actuales, incluidas redes con metadata_encoder (HumanSL, meta_encoder_version 1, 192 features de entrada). [alta] (https://raw.githubusercontent.com/kaya-go/katago-onnx/main/src/katago/VENDOR_INFO.txt + src/katago/train/model_pytorch.py líneas 1636-1700)
- LIMITACIÓN HumanSL: Model.forward(input_spatial, input_global, input_meta=None, ...) hace `assert input_meta is not None` cuando la red tiene metadata_encoder, y convert.py solo pasa (bin_input, global_input). Convertir b18c384nbt-humanv0 con el script tal cual falla; requiere parche que añada un tercer input meta_input de forma [1,192] (SGFMetadata.METADATA_INPUT_NUM_CHANNELS = 192, codifica rango/fuente/fecha; ver src/katago/game/sgfmetadata.py). [alta] (https://raw.githubusercontent.com/kaya-go/katago-onnx/main/src/katago/train/model_pytorch.py líneas 1996-2020 + src/katago/game/sgfmetadata.py línea 54)
- El checkpoint PyTorch de b18-humanv0 existe: b18c384nbt-humanv0.ckpt, 323.752.318 bytes, en el release v1.15.0 'New Human-like Play and Analysis' de KataGo: https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.ckpt (junto al b18c384nbt-humanv0.bin.gz de 99.066.230 bytes). [alta] (https://api.github.com/repos/lightvector/KataGo/releases/tags/v1.15.0)
- Checkpoints torch de b18c384nbt existen en katagotraining.org: verificado HTTP 200 con content-length 214.501.963 para https://media.katagotraining.org/uploaded/networks/zips/kata1/kata1-b18c384nbt-s9996604416-d4316597426.zip (nombre tomado de https://katagotraining.org/networks/, que lista series b18c384nbt hasta s9996604416). El zip del b28 de kaya (kata1-b28c512nbt-s12043015936-d5616446734) también verificado: 545.066.393 bytes. [alta] (HEAD a https://media.katagotraining.org/uploaded/networks/zips/kata1/... + https://katagotraining.org/networks/)
- b10c128 NO es convertible con el pipeline de kaya: el zip kata1-b10c128-s1141046784-d204142634.zip (25,6 MB, descargado y listado) contiene saved_model/ de TensorFlow (variables.data, variables.index), model.config.json y model.txt.gz — no hay model.ckpt de PyTorch. Las redes pequeñas de la era temprana de kata1/g170 se entrenaron con TensorFlow. Vías alternativas: tf2onnx sobre el saved_model (no verificado) o isty2e/KataGoONNX sobre el .bin de model version 8. [alta] (descarga y unzip -l de https://media.katagotraining.org/uploaded/networks/zips/kata1/kata1-b10c128-s1141046784-d204142634.zip)
- El repo oficial lightvector/KataGo NO tiene exportador a ONNX: el listado completo de python/ no contiene ningún script onnx; export_model_pytorch.py exporta al formato .bin propio de KataGo (línea 91: extension = '.bin'), con flags export_14_as_15 y export_15_or_16_as_17 que confirman model versions 14/15/16/17 en checkpoints actuales. [alta] (https://api.github.com/repos/lightvector/KataGo/contents/python + https://raw.githubusercontent.com/lightvector/KataGo/master/python/export_model_pytorch.py)
- Alternativa histórica isty2e/KataGoONNX (https://github.com/isty2e/KataGoONNX, 2020, 15 stars, SIN archivo de licencia — todos los derechos reservados por defecto): convierte model.bin + model.config.json (de los zips g170 en https://d3dndmfyhecmj0.cloudfront.net/g170/neuralnets/index.html) con `python convert.py --model BIN --model-config JSON --output OUT` y FP16 opcional con quantize.py (requiere PyTorch + ONNXMLTools). SOLO soporta model version 8 (redes g170 >b10). Salidas reducidas a 4: output_policy (-1, y*x+1), output_value (-1,3), output_miscvalue (-1,4), output_ownership — pierde moremiscvalue, scoring, futurepos, seki y scorebelief. Opset 10, NCHW. No soporta v14/v15 ni HumanSL. [alta] (https://raw.githubusercontent.com/isty2e/KataGoONNX/master/README.md + https://api.github.com/repos/isty2e/KataGoONNX)
- Alternativa yehu3d/katago_onnx (https://github.com/yehu3d/katago_onnx, MIT, basado en KataGo 1.14.1): ckpt2onnx.py convierte ckpt→ONNX (`python ckpt2onnx.py --i_ckpt 28bnbt.ckpt --o_onnx 28bnbt.onnx`) pero con device='cuda' hardcodeado (no funciona en Mac sin editar), solo 19x19 (sin ejes dinámicos de tamaño), opset 19, y poda a 5 salidas (out_policy, out_value, out_miscvalue, out_moremiscvalue, out_ownership — pierde scoring/futurepos/seki/scorebelief). Tiene además un bug: usa args.input/args.output cuando los flags son --i_ckpt/--o_onnx. Incluye backend TensorRT C++ para el engine, no orientado a web. Pre-HumanSL (1.14.1). [alta] (https://raw.githubusercontent.com/yehu3d/katago_onnx/main/ckpt2onnx.py + README)
- Otros repos encontrados no son conversores útiles: justmaker/katago-onnx-mobile es un plugin Flutter de inferencia móvil (no convierte), YH7916/KataGo_onnx_convert solo soporta modelos b6 pequeños. En HuggingFace, la búsqueda 'katago' solo devuelve kaya-go/kaya (ONNX b28 en fp32/fp16/uint8, únicos 2 modelos: adam-s11165M y s12043015936), Paolo626/KataGo (binarios katago windows + .bin.gz) y Jinqi-T/katago (un model.bin.gz). NADIE ha publicado b18c384nbt ni b18-humanv0 en ONNX: habrá que convertirlos nosotros. [alta] (https://api.github.com/search/repositories?q=katago+onnx + https://huggingface.co/api/models?search=katago + https://huggingface.co/api/models/kaya-go/kaya)
- Discrepancia de licencia y de FP16 a vigilar: la HF model card (HF_MODEL_CARD.md) declara license: mit para los modelos convertidos y dice que en FP16 'la I/O permanece FP32', pero el repo katago-onnx es AGPL-3.0 y el código actual _convert_to_fp16_native convierte los inputs y outputs del grafo a float16. Los .fp16.onnx publicados en HF pudieron generarse con una versión anterior del conversor: el harness debe leer los dtypes reales de session.inputMetadata en lugar de asumir float32. [alta] (https://raw.githubusercontent.com/kaya-go/katago-onnx/main/HF_MODEL_CARD.md vs convert.py (_convert_to_fp16_native))
- Datos útiles para el harness: nombres de tensores de entrada de los ONNX de kaya: 'bin_input' [batch,22,height,width] y 'global_input' [batch,19] (float32 en fp32/uint8). Las 22 planas binarias y 19 features globales corresponden al feature set de model version >=10 de KataGo. Conversión hecha con dynamo=False porque dynamo=True falla con 'No ONNX function found for aten.sym_size.int' en shapes dinámicas. [alta] (https://raw.githubusercontent.com/kaya-go/katago-onnx/main/src/katago_onnx/convert.py (comentarios del código) + HF_MODEL_CARD.md)
- La conversión adaptada para humanv0 propuesta en code_snippets (añadir meta_input [1,192] al export) NO fue ejecutada end-to-end en esta investigación; se deriva de leer el forward del modelo vendorizado. Riesgo residual: shapes de salida del head de policy de humanv0 pueden diferir (más canales de policy en v15); el harness debe leer las shapes de la sesión ONNX. [media] (inferencia a partir de model_pytorch.py + sgfmetadata.py (no ejecutado))

SNIPPETS:
### A) Convertir kata1-b18c384nbt a ONNX (fp32+fp16+uint8) en Mac — pipeline kaya tal cual
# Fuente de comandos: README.md y cli.py de https://github.com/kaya-go/katago-onnx
brew install pixi        # o: curl -fsSL https://pixi.sh/install.sh | sh
git clone https://github.com/kaya-go/katago-onnx.git
cd katago-onnx
pixi install
pixi run katago-onnx convert ./artifacts/ -n kata1-b18c384nbt-s9996604416-d4316597426
# Descarga https://media.katagotraining.org/uploaded/networks/zips/kata1/kata1-b18c384nbt-s9996604416-d4316597426.zip (214 MB, verificado HTTP 200)
# Salida (siempre las 3 variantes, no hay flag para elegir solo fp16):
#   ./artifacts/kata1-b18c384nbt-s9996604416-d4316597426/kata1-b18c384nbt-s9996604416-d4316597426.fp32.onnx
#   ./artifacts/kata1-b18c384nbt-s9996604416-d4316597426/kata1-b18c384nbt-s9996604416-d4316597426.fp16.onnx
#   ./artifacts/kata1-b18c384nbt-s9996604416-d4316597426/kata1-b18c384nbt-s9996604416-d4316597426.uint8.onnx

### B) Convertir b18-humanv0 (requiere adaptación: metadata encoder → tercer input [1,192])
# El ckpt NO está en katagotraining: se baja del release v1.15.0 de KataGo (verificado, 323.752.318 bytes)
cd katago-onnx && mkdir -p artifacts
curl -L -o artifacts/b18c384nbt-humanv0.ckpt \
  https://github.com/lightvector/KataGo/releases/download/v1.15.0/b18c384nbt-humanv0.ckpt
pixi run python - <<'EOF'
# Adaptación de convert_katago_torch_to_onnx (src/katago_onnx/convert.py) para redes HumanSL.
# Motivo del parche: Model.forward hace `assert input_meta is not None` si hay metadata_encoder
# (src/katago/train/model_pytorch.py) y convert.py solo pasa 2 inputs.
import onnx, torch
from katago_onnx.utils import load_model
from katago_onnx.convert import _convert_to_fp16_native

model = load_model("artifacts/b18c384nbt-humanv0.ckpt", device="cpu")
assert model.get_has_metadata_encoder()   # humanv0: meta encoder v1, 192 features

bin_input    = torch.randn(1, 22, 19, 19, dtype=torch.float32)
global_input = torch.randn(1, 19, dtype=torch.float32)
meta_input   = torch.randn(1, 192, dtype=torch.float32)  # SGFMetadata.METADATA_INPUT_NUM_CHANNELS = 192

output_names = ["policy","value","miscvalue","moremiscvalue","ownership",
                "scoring","futurepos","seki","scorebelief"]
dynamic_axes = {
    "bin_input": {0:"batch_size", 2:"height", 3:"width"},
    "global_input": {0:"batch_size"},
    "meta_input": {0:"batch_size"},
    "policy": {0:"batch_size", 2:"moves"}, "value": {0:"batch_size"},
    "miscvalue": {0:"batch_size"}, "moremiscvalue": {0:"batch_size"},
    "ownership": {0:"batch_size", 2:"height", 3:"width"},
    "scoring": {0:"batch_size", 2:"height", 3:"width"},
    "futurepos": {0:"batch_size", 2:"height", 3:"width"},
    "seki": {0:"batch_size", 2:"height", 3:"width"},
    "scorebelief": {0:"batch_size"},
}
torch.onnx.export(model, (bin_input, global_input, meta_input),
    "artifacts/b18c384nbt-humanv0.fp32.onnx",
    input_names=["bin_input","global_input","meta_input"],
    output_names=output_names, dynamic_axes=dynamic_axes,
    opset_version=17, dynamo=False)

m = onnx.load("artifacts/b18c384nbt-humanv0.fp32.onnx")
onnx.save(_convert_to_fp16_native(m), "artifacts/b18c384nbt-humanv0.fp16.onnx")
EOF
# NOTA: snippet derivado del código fuente, no ejecutado end-to-end en esta investigación.
# En inferencia, meta_input debe rellenarse con la codificación SGFMetadata (rango objetivo, fuente, fecha)
# — ver src/katago/game/sgfmetadata.py del repo katago-onnx (vendorizado de KataGo v1.16.4).

### C) b10c128 — el pipeline kaya NO funciona (zip = TensorFlow saved_model, sin model.ckpt; verificado):
# unzip -l kata1-b10c128-s1141046784-d204142634.zip →
#   b10c128-.../saved_model/variables/variables.data-00000-of-00001, model.config.json, model.txt.gz
# Alternativas (ambas sin verificar end-to-end):
#  1) isty2e/KataGoONNX (solo model version 8, SIN licencia): python convert.py --model model.bin --model-config model.config.json --output b10.onnx
#     + FP16: python quantize.py --input b10.onnx --output b10.fp16.onnx   (requiere PyTorch + ONNXMLTools)
#  2) tf2onnx sobre el saved_model del zip: python -m tf2onnx.convert --saved-model saved_model/ --output b10.onnx

### Referencia: firma del forward que obliga al parche HumanSL (model_pytorch.py, vendored KataGo v1.16.4)
def forward(self, input_spatial, input_global, input_meta=None, extra_outputs=None):
    ...
    if self.metadata_encoder is not None:
        assert input_meta is not None
        x_meta = self.metadata_encoder.forward(input_meta, extra_outputs)
        out = out + x_meta.unsqueeze(-1).unsqueeze(-1)