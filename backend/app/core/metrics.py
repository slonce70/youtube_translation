"""
Application metrics collection and monitoring

Provides metrics for:
- Stream operations (start, stop, errors)
- API requests
- Quota usage
- System health

Can be integrated with Prometheus, Grafana, or other monitoring systems.
"""

import time
import logging
from typing import Dict, Optional
from collections import defaultdict
from threading import RLock
from enum import Enum

logger = logging.getLogger(__name__)


class MetricType(Enum):
    """Types of metrics"""
    COUNTER = "counter"
    GAUGE = "gauge"
    HISTOGRAM = "histogram"


class Metric:
    """Base metric class"""
    
    def __init__(self, name: str, description: str, labels: Optional[Dict[str, str]] = None):
        self.name = name
        self.description = description
        self.labels = labels or {}
        self.created_at = time.time()


class Counter(Metric):
    """Counter metric (monotonically increasing)"""
    
    def __init__(self, name: str, description: str, labels: Optional[Dict[str, str]] = None):
        super().__init__(name, description, labels)
        self.value = 0
        self.lock = RLock()
    
    def inc(self, amount: float = 1.0):
        """Increment counter"""
        with self.lock:
            self.value += amount
    
    def get(self) -> float:
        """Get current value"""
        with self.lock:
            return self.value
    
    def reset(self):
        """Reset counter (for testing)"""
        with self.lock:
            self.value = 0


class Gauge(Metric):
    """Gauge metric (can go up or down)"""
    
    def __init__(self, name: str, description: str, labels: Optional[Dict[str, str]] = None):
        super().__init__(name, description, labels)
        self.value = 0
        self.lock = RLock()
    
    def set(self, value: float):
        """Set gauge value"""
        with self.lock:
            self.value = value
    
    def inc(self, amount: float = 1.0):
        """Increment gauge"""
        with self.lock:
            self.value += amount
    
    def dec(self, amount: float = 1.0):
        """Decrement gauge"""
        with self.lock:
            self.value -= amount
    
    def get(self) -> float:
        """Get current value"""
        with self.lock:
            return self.value


class Histogram(Metric):
    """Histogram metric (for tracking distributions)"""
    
    def __init__(self, name: str, description: str, labels: Optional[Dict[str, str]] = None):
        super().__init__(name, description, labels)
        self.values = []
        self.sum = 0
        self.count = 0
        self.lock = RLock()
    
    def observe(self, value: float):
        """Add observation"""
        with self.lock:
            self.values.append(value)
            self.sum += value
            self.count += 1
    
    def get_stats(self) -> Dict[str, float]:
        """Get histogram statistics"""
        with self.lock:
            if not self.values:
                return {"count": 0, "sum": 0, "avg": 0, "min": 0, "max": 0}
            
            sorted_values = sorted(self.values)
            return {
                "count": self.count,
                "sum": self.sum,
                "avg": self.sum / self.count,
                "min": sorted_values[0],
                "max": sorted_values[-1],
                "p50": sorted_values[len(sorted_values) // 2],
                "p95": sorted_values[int(len(sorted_values) * 0.95)],
                "p99": sorted_values[int(len(sorted_values) * 0.99)]
            }


class MetricsRegistry:
    """Registry for all application metrics"""
    
    def __init__(self):
        self.metrics: Dict[str, Metric] = {}
        self.lock = RLock()
    
    def counter(self, name: str, description: str, labels: Optional[Dict[str, str]] = None) -> Counter:
        """Get or create counter metric"""
        with self.lock:
            key = self._make_key(name, labels)
            if key not in self.metrics:
                self.metrics[key] = Counter(name, description, labels)
            return self.metrics[key]
    
    def gauge(self, name: str, description: str, labels: Optional[Dict[str, str]] = None) -> Gauge:
        """Get or create gauge metric"""
        with self.lock:
            key = self._make_key(name, labels)
            if key not in self.metrics:
                self.metrics[key] = Gauge(name, description, labels)
            return self.metrics[key]
    
    def histogram(self, name: str, description: str, labels: Optional[Dict[str, str]] = None) -> Histogram:
        """Get or create histogram metric"""
        with self.lock:
            key = self._make_key(name, labels)
            if key not in self.metrics:
                self.metrics[key] = Histogram(name, description, labels)
            return self.metrics[key]
    
    def _make_key(self, name: str, labels: Optional[Dict[str, str]]) -> str:
        """Create unique key for metric"""
        if not labels:
            return name
        label_str = ",".join(f"{k}={v}" for k, v in sorted(labels.items()))
        return f"{name}{{{label_str}}}"
    
    def get_all(self) -> Dict[str, Metric]:
        """Get all metrics"""
        with self.lock:
            return dict(self.metrics)
    
    def export_prometheus(self) -> str:
        """Export metrics in Prometheus format"""
        lines = []
        with self.lock:
            for key, metric in self.metrics.items():
                # Add help and type
                lines.append(f"# HELP {metric.name} {metric.description}")
                
                if isinstance(metric, Counter):
                    lines.append(f"# TYPE {metric.name} counter")
                    lines.append(f"{key} {metric.get()}")
                elif isinstance(metric, Gauge):
                    lines.append(f"# TYPE {metric.name} gauge")
                    lines.append(f"{key} {metric.get()}")
                elif isinstance(metric, Histogram):
                    lines.append(f"# TYPE {metric.name} histogram")
                    stats = metric.get_stats()
                    for stat_name, value in stats.items():
                        lines.append(f"{key}_{stat_name} {value}")
        
        return "\n".join(lines)


# Global metrics registry
metrics_registry = MetricsRegistry()


# Application metrics
class AppMetrics:
    """Predefined application metrics"""
    
    # Stream metrics
    stream_starts = metrics_registry.counter(
        "stream_starts_total",
        "Total number of stream starts"
    )
    
    stream_stops = metrics_registry.counter(
        "stream_stops_total",
        "Total number of stream stops"
    )
    
    stream_errors = metrics_registry.counter(
        "stream_errors_total",
        "Total number of stream errors"
    )
    
    active_streams = metrics_registry.gauge(
        "active_streams",
        "Number of currently active streams"
    )
    
    stream_duration = metrics_registry.histogram(
        "stream_duration_seconds",
        "Stream duration in seconds"
    )
    
    # API metrics
    api_requests = metrics_registry.counter(
        "api_requests_total",
        "Total number of API requests"
    )
    
    api_errors = metrics_registry.counter(
        "api_errors_total",
        "Total number of API errors"
    )
    
    api_latency = metrics_registry.histogram(
        "api_latency_seconds",
        "API request latency in seconds"
    )
    
    # Quota metrics
    quota_denied = metrics_registry.counter(
        "quota_denied_total",
        "Total number of quota denials"
    )
    
    storage_used = metrics_registry.gauge(
        "storage_used_bytes",
        "Total storage used in bytes"
    )
    
    # Upload metrics
    uploads_started = metrics_registry.counter(
        "uploads_started_total",
        "Total number of uploads started"
    )
    
    uploads_completed = metrics_registry.counter(
        "uploads_completed_total",
        "Total number of uploads completed"
    )
    
    uploads_failed = metrics_registry.counter(
        "uploads_failed_total",
        "Total number of uploads failed"
    )
    
    # Validation metrics
    validator_success = metrics_registry.counter(
        "validator_success_total",
        "Total number of successful validations"
    )
    
    validator_failed = metrics_registry.counter(
        "validator_failed_total",
        "Total number of failed validations"
    )
    
    # Admin metrics
    admin_actions = metrics_registry.counter(
        "admin_actions_total",
        "Total number of admin actions"
    )


def track_stream_start():
    """Track stream start"""
    AppMetrics.stream_starts.inc()
    AppMetrics.active_streams.inc()


def track_stream_stop(duration_seconds: Optional[float] = None):
    """Track stream stop"""
    AppMetrics.stream_stops.inc()
    AppMetrics.active_streams.dec()
    if duration_seconds:
        AppMetrics.stream_duration.observe(duration_seconds)


def track_stream_error():
    """Track stream error"""
    AppMetrics.stream_errors.inc()


def track_api_request(duration_seconds: float):
    """Track API request"""
    AppMetrics.api_requests.inc()
    AppMetrics.api_latency.observe(duration_seconds)


def track_api_error():
    """Track API error"""
    AppMetrics.api_errors.inc()


def track_quota_denied():
    """Track quota denial"""
    AppMetrics.quota_denied.inc()


def update_storage_used(bytes_used: int):
    """Update storage usage"""
    AppMetrics.storage_used.set(bytes_used)


def get_metrics_summary() -> Dict[str, any]:
    """Get summary of all metrics"""
    return {
        "streams": {
            "starts": AppMetrics.stream_starts.get(),
            "stops": AppMetrics.stream_stops.get(),
            "errors": AppMetrics.stream_errors.get(),
            "active": AppMetrics.active_streams.get(),
            "duration_stats": AppMetrics.stream_duration.get_stats()
        },
        "api": {
            "requests": AppMetrics.api_requests.get(),
            "errors": AppMetrics.api_errors.get(),
            "latency_stats": AppMetrics.api_latency.get_stats()
        },
        "quota": {
            "denied": AppMetrics.quota_denied.get(),
            "storage_used": AppMetrics.storage_used.get()
        },
        "uploads": {
            "started": AppMetrics.uploads_started.get(),
            "completed": AppMetrics.uploads_completed.get(),
            "failed": AppMetrics.uploads_failed.get()
        },
        "validation": {
            "success": AppMetrics.validator_success.get(),
            "failed": AppMetrics.validator_failed.get()
        }
    }
