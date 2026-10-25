FROM python:3.12-slim
WORKDIR /app
ENV PYTHONUNBUFFERED=1 MODEL_DIR=/app/models SEED_MODEL_DIR=/app/seed_models
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
# Train the initial model at build time. It is copied into the (persistent) models volume on first start.
RUN python generate_dataset.py && python train_model.py --seed
EXPOSE 8000
HEALTHCHECK --interval=15s --timeout=3s --start-period=30s --retries=5 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health')" || exit 1
# One worker: the active model lives in memory and retraining hot-swaps it. Threads give concurrency.
CMD ["gunicorn", "-w", "1", "--threads", "4", "-b", "0.0.0.0:8000", "--timeout", "180", "app:app"]
