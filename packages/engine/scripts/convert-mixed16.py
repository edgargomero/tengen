#!/usr/bin/env python3
"""Convierte un ONNX de KataGo de fp32 a PRECISIÓN MIXTA (pesos fp16, I/O fp32, gpool en fp32).

Herramienta local, NO parte del producto. Requiere `onnx` y `onnxconverter-common`:

    python3 -m venv .venv && .venv/bin/pip install onnx onnxconverter-common
    .venv/bin/python packages/engine/scripts/convert-mixed16.py <entrada.fp32.onnx> <salida.mixed16.onnx>

Gate obligatorio después de convertir (los 10 vectores de KataGo desktop):

    TENGEN_NN_MODEL=<ruta absoluta a la salida> npm run -w @tengen/engine test:nn

── Por qué existe, y por qué NO se usa el conversor de katago-onnx ──────────────────────────────
El pipeline de katago-onnx genera su fp16 con `_convert_to_fp16_native`, que hace
`arr.astype(np.float16)` sobre todos los pesos: sin saturación, sin exclusiones y sin insertar los
`Cast` de frontera. Su propio docstring admite que reemplaza a `onnxconverter_common`. El resultado
son modelos que CARGAN pero producen **policy NaN** con entradas reales — medido: 325 NaN de 361 con
los features V7 del fixture `empty-19`, mientras el fp32 sale limpio. Con un input casi vacío el bug
no aparece, que es por qué sobrevivió sin detectarse.

── Las tres decisiones de esta conversión ───────────────────────────────────────────────────────
1. `keep_io_types=True` — entradas y salidas siguen en fp32. Además de simplificar el borde, evita
   que `OnnxEvaluator` tenga que convertir f32→f16 en cada inferencia.
2. `node_block_list` con TODO el subgrafo `gpool` — el global pooling de KataGo mezcla reducciones,
   divisiones por constantes y concatenaciones. Bloquear operadores de a uno movía el error al
   siguiente nodo del mismo bloque (Cast → Div → Concat): convertirlo a medias siempre deja una
   frontera mal tipada. Dejarlo entero en fp32 cuesta poquísimo tamaño (229 nodos) y es lo que hace
   que el modelo cargue.
3. Vaciar `graph.value_info` — guarda los tipos de los tensores INTERMEDIOS, declarados cuando el
   grafo era fp32. La conversión no los reescribe todos, así que ORT encuentra un nodo que produce
   fp16 donde el grafo promete fp32 y se niega a crear la sesión. Sin ellos, ORT infiere los reales.
"""
import os
import sys

import onnx
from onnxconverter_common import float16


def convert(src: str, dst: str) -> None:
    model = onnx.load(src)
    gpool_nodes = [n.name for n in model.graph.node if "gpool" in n.name]
    print(f"nodos del gpool que se quedan en fp32: {len(gpool_nodes)}")

    mixed = float16.convert_float_to_float16(
        model, keep_io_types=True, node_block_list=gpool_nodes
    )
    del mixed.graph.value_info[:]
    onnx.save(mixed, dst)

    before = os.path.getsize(src) / 1e6
    after = os.path.getsize(dst) / 1e6
    print(f"{before:.1f} MB → {after:.1f} MB ({after / before:.0%})")
    print(f"guardado: {dst}")
    print("\nAhora el gate, que es lo único que decide si sirve:")
    print(f"  TENGEN_NN_MODEL={os.path.abspath(dst)} npm run -w @tengen/engine test:nn")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        print(__doc__)
        sys.exit(1)
    convert(sys.argv[1], sys.argv[2])
