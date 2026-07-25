FROM openvino/ubuntu24_dev:2026.2.0

USER root

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    curl \
    ffmpeg \
    libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt /opt/stem-separator/requirements.txt
RUN /opt/venv/bin/python -m pip install \
  --no-cache-dir \
  -r /opt/stem-separator/requirements.txt

COPY app /opt/stem-separator/app
COPY tests /opt/stem-separator/tests
COPY entrypoint.sh /opt/stem-separator/entrypoint.sh
RUN chmod -R a+rX /opt/stem-separator \
  && chmod 0755 /opt/stem-separator/entrypoint.sh

ENV HOME=/tmp \
    MIMICOPY_MEDIA_DIR=/data/media \
    MIMICOPY_STEM_DEVICE=GPU \
    MIMICOPY_STEM_INFERENCE_PRECISION=f16 \
    MIMICOPY_STEM_MODEL_PATH=/data/models/bs_roformer_sw_6stem_fp16.onnx \
    MIMICOPY_STEM_OPENVINO_CACHE_DIR=/data/openvino-cache \
    MIMICOPY_STEM_OVERLAP=0.25 \
    PYTHONPATH=/opt/stem-separator \
    XDG_CACHE_HOME=/data/cache \
    XDG_RUNTIME_DIR=/tmp

WORKDIR /opt/stem-separator

USER openvino

EXPOSE 8091

HEALTHCHECK --interval=30s --timeout=5s --start-period=180s --retries=5 \
  CMD curl --fail --silent http://127.0.0.1:8091/health >/dev/null || exit 1

ENTRYPOINT ["/opt/stem-separator/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8091"]
