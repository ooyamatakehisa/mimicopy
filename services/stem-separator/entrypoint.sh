#!/usr/bin/env bash

set -euo pipefail

readonly model_url="https://huggingface.co/elicwhite/bs-roformer-sw-6stem-onnx/resolve/main/bs_roformer_sw_6stem_fp16.onnx"
readonly model_sha256="d3d2bac77a7023282cb5f35a5807179e34076b60589867b572275f1a8ec36444"
readonly model_path="${MIMICOPY_STEM_MODEL_PATH:-/data/models/bs_roformer_sw_6stem_fp16.onnx}"

mkdir -p \
  "$(dirname "${model_path}")" \
  "${MIMICOPY_MEDIA_DIR:-/data/media}" \
  "${MIMICOPY_STEM_OPENVINO_CACHE_DIR:-/data/openvino-cache}"

if [[ ! -f "${model_path}" ]]; then
  echo "Downloading BS-RoFormer SW 6-stem FP16 ONNX model..."
  curl --fail --location --retry 3 "${model_url}" --output "${model_path}.partial"
  mv "${model_path}.partial" "${model_path}"
fi

echo "${model_sha256}  ${model_path}" | sha256sum --check

exec "$@"
