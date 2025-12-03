# NAP Dashboard Container
# Go application with embedded static files

# Build stage
FROM golang:1.21-alpine AS builder

WORKDIR /app

# Install dependencies
RUN apk add --no-cache git

# Copy go mod files
COPY go.mod go.sum ./
RUN go mod download

# Copy source code
COPY *.go ./
COPY static/ ./static/

# Build the application
RUN CGO_ENABLED=0 GOOS=linux go build -o dashboard .

# Runtime stage
FROM alpine:3.19

# Labels
LABEL org.opencontainers.image.title="NAP Demo Dashboard"
LABEL org.opencontainers.image.description="Real-time AKS NAP visualization dashboard"
LABEL org.opencontainers.image.source="https://github.com/Azure-Samples/aks-nap-demo"

# Install ca-certificates for HTTPS
RUN apk add --no-cache ca-certificates

WORKDIR /app

# Copy binary and static files from builder
COPY --from=builder /app/dashboard .
COPY --from=builder /app/static ./static

# Create non-root user
RUN adduser -D -g '' appuser
USER appuser

# Expose ports
EXPOSE 8080 8081

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:8080/health || exit 1

# Run the dashboard
CMD ["./dashboard"]
