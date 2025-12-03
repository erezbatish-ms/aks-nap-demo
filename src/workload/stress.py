"""
CPU Stress Workload for AKS NAP Demo
Performs CPU-intensive prime number calculations to trigger HPA scaling
"""
import os
import time
import signal
import threading
from http.server import HTTPServer, BaseHTTPRequestHandler
from typing import List
import json
import logging

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Environment configuration
CPU_INTENSITY = os.environ.get('CPU_INTENSITY', 'high')
POD_NAME = os.environ.get('POD_NAME', 'unknown')
NODE_NAME = os.environ.get('NODE_NAME', 'unknown')

# Intensity mapping (higher = more CPU usage)
INTENSITY_MAP = {
    'low': 50000,
    'medium': 100000,
    'high': 200000,
    'extreme': 500000
}

# Global state
is_running = True
stats = {
    'primes_found': 0,
    'calculations': 0,
    'start_time': time.time()
}


def is_prime(n: int) -> bool:
    """Check if a number is prime."""
    if n < 2:
        return False
    if n == 2:
        return True
    if n % 2 == 0:
        return False
    for i in range(3, int(n ** 0.5) + 1, 2):
        if n % i == 0:
            return False
    return True


def find_primes(limit: int) -> List[int]:
    """Find all prime numbers up to limit."""
    primes = []
    for n in range(2, limit):
        if is_prime(n):
            primes.append(n)
    return primes


def cpu_stress_loop():
    """Main CPU stress loop - runs continuously."""
    global is_running, stats
    
    limit = INTENSITY_MAP.get(CPU_INTENSITY, INTENSITY_MAP['high'])
    logger.info(f"Starting CPU stress with intensity: {CPU_INTENSITY} (limit: {limit})")
    logger.info(f"Pod: {POD_NAME}, Node: {NODE_NAME}")
    
    while is_running:
        try:
            primes = find_primes(limit)
            stats['primes_found'] = len(primes)
            stats['calculations'] += 1
            
            if stats['calculations'] % 10 == 0:
                elapsed = time.time() - stats['start_time']
                logger.info(
                    f"Calculation #{stats['calculations']}: "
                    f"Found {len(primes)} primes, "
                    f"Running for {elapsed:.0f}s"
                )
            
            # Small sleep to prevent 100% CPU when not needed
            time.sleep(0.1)
            
        except Exception as e:
            logger.error(f"Error in stress loop: {e}")
            time.sleep(1)


class HealthHandler(BaseHTTPRequestHandler):
    """HTTP handler for health checks and metrics."""
    
    def log_message(self, format, *args):
        """Suppress default HTTP logging."""
        pass
    
    def do_GET(self):
        """Handle GET requests."""
        if self.path == '/health':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'healthy')
            
        elif self.path == '/ready':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'ready')
            
        elif self.path == '/metrics':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            elapsed = time.time() - stats['start_time']
            metrics = {
                'pod_name': POD_NAME,
                'node_name': NODE_NAME,
                'intensity': CPU_INTENSITY,
                'primes_found': stats['primes_found'],
                'calculations': stats['calculations'],
                'uptime_seconds': elapsed,
                'calculations_per_minute': stats['calculations'] / (elapsed / 60) if elapsed > 0 else 0
            }
            self.wfile.write(json.dumps(metrics).encode())
            
        elif self.path == '/':
            self.send_response(200)
            self.send_header('Content-Type', 'text/html')
            self.end_headers()
            html = f"""
            <html>
            <head><title>CPU Stress Workload</title></head>
            <body>
                <h1>CPU Stress Workload</h1>
                <p><strong>Pod:</strong> {POD_NAME}</p>
                <p><strong>Node:</strong> {NODE_NAME}</p>
                <p><strong>Intensity:</strong> {CPU_INTENSITY}</p>
                <p><strong>Calculations:</strong> {stats['calculations']}</p>
                <p><strong>Primes Found:</strong> {stats['primes_found']}</p>
                <hr>
                <p><a href="/health">Health Check</a> | 
                   <a href="/ready">Readiness Check</a> | 
                   <a href="/metrics">Metrics (JSON)</a></p>
            </body>
            </html>
            """
            self.wfile.write(html.encode())
            
        else:
            self.send_response(404)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(b'Not Found')


def run_http_server():
    """Run the HTTP server for health checks."""
    server = HTTPServer(('0.0.0.0', 8080), HealthHandler)
    logger.info("HTTP server started on port 8080")
    server.serve_forever()


def signal_handler(signum, frame):
    """Handle shutdown signals gracefully."""
    global is_running
    logger.info(f"Received signal {signum}, shutting down...")
    is_running = False


def main():
    """Main entry point."""
    # Register signal handlers
    signal.signal(signal.SIGTERM, signal_handler)
    signal.signal(signal.SIGINT, signal_handler)
    
    logger.info("=" * 50)
    logger.info("AKS NAP Demo - CPU Stress Workload")
    logger.info("=" * 50)
    logger.info(f"Pod Name: {POD_NAME}")
    logger.info(f"Node Name: {NODE_NAME}")
    logger.info(f"CPU Intensity: {CPU_INTENSITY}")
    logger.info("=" * 50)
    
    # Start HTTP server in background thread
    http_thread = threading.Thread(target=run_http_server, daemon=True)
    http_thread.start()
    
    # Run CPU stress in main thread
    cpu_stress_loop()
    
    logger.info("Workload shutdown complete")


if __name__ == '__main__':
    main()
