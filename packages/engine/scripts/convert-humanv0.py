# AVISO DE LICENCIA: este archivo es una adaptación de código de kaya-go/katago-onnx
# (AGPL-3.0) y queda licenciado AGPL-3.0. Es una herramienta LOCAL de desarrollo:
# no forma parte del producto tengen ni de sus distribuciones/deploys.
#
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
