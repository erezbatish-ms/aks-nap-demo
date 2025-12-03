# CPU Stress Workload Container
# Lightweight Python container for CPU-intensive operations

FROM python:3.11-slim

# Labels for container registry
LABEL org.opencontainers.image.title="NAP Demo CPU Stress Workload"
LABEL org.opencontainers.image.description="CPU-intensive workload for AKS NAP demo"
LABEL org.opencontainers.image.source="https://github.com/Azure-Samples/aks-nap-demo"

# Set working directory
WORKDIR /app

# Copy application code
COPY stress.py .

# Create non-root user for security
RUN useradd --create-home --shell /bin/bash appuser
USER appuser

# Expose health check port
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8080/health')" || exit 1

# Run the stress workload
CMD ["python", "-u", "stress.py"]
