"""
Rate limiting middleware for FastAPI

Protects API endpoints from brute force attacks and abuse.
Uses in-memory storage for simplicity (consider Redis for production).
"""

import time
import logging
from collections import defaultdict, deque
from typing import Dict, Tuple
from threading import RLock
from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger(__name__)


class RateLimitEntry:
    """Track request history for a client"""
    
    def __init__(self, max_requests: int, window_seconds: int):
        self.max_requests = max_requests
        self.window_seconds = window_seconds
        self.requests: deque = deque()
    
    def is_allowed(self) -> bool:
        """Check if request is allowed within rate limit"""
        now = time.time()
        
        # Remove old requests outside the window
        while self.requests and self.requests[0] < now - self.window_seconds:
            self.requests.popleft()
        
        # Check if limit exceeded
        if len(self.requests) >= self.max_requests:
            return False
        
        # Add current request
        self.requests.append(now)
        return True
    
    def get_remaining(self) -> int:
        """Get remaining requests in current window"""
        now = time.time()
        
        # Clean old requests
        while self.requests and self.requests[0] < now - self.window_seconds:
            self.requests.popleft()
        
        return max(0, self.max_requests - len(self.requests))
    
    def get_reset_time(self) -> int:
        """Get time (seconds) until window resets"""
        if not self.requests:
            return 0
        
        now = time.time()
        oldest_request = self.requests[0]
        reset_time = oldest_request + self.window_seconds
        
        return max(0, int(reset_time - now))


class RateLimiter:
    """Rate limiter with configurable limits per route pattern"""
    
    def __init__(self):
        self.clients: Dict[str, RateLimitEntry] = {}
        self.lock = RLock()
        self.max_clients = 10000
        
        # Default limits (requests per minute)
        self.default_limit = 60
        self.default_window = 60
        
        # Endpoint-specific limits (requests per window)
        self.limits = {
            "/api/auth/login": (5, 60),                    # 5 login attempts per minute
            "/api/auth/logout": (20, 60),                  # 20 logout requests per minute
            "/api/auth/register": (3, 60),                 # 3 registration attempts per minute
            "/api/streams/start": (3, 120),                # 3 stream starts per 2 minutes
            "/api/streams/stop": (10, 60),                 # 10 stream stops per minute
            "/api/streams/status": (60, 60),               # status polling limit
            "/api/assets/upload": (30, 60),                # raw upload chunk notifications
            "/api/assets/upload-complete": (12, 60),       # finalization webhook handler
            "/api/admin/alerts": (8, 60),                  # alert triage calls
            "/api/admin/users": (12, 60),                  # admin user management
            "/api/admin": (20, 60),                        # general admin prefix fallback
        }
    
    def _get_client_key(self, request: Request) -> str:
        """Generate unique key for client (IP + endpoint)"""
        # Use forwarded IP if behind proxy
        forwarded = request.headers.get("X-Forwarded-For")
        client_ip = forwarded.split(",")[0] if forwarded else request.client.host
        
        # Include endpoint pattern for different limits per route
        endpoint = request.url.path
        
        return f"{client_ip}:{endpoint}"
    
    def _get_limits_for_endpoint(self, path: str) -> Tuple[int, int]:
        """Get rate limits for specific endpoint"""
        # Check for exact match
        if path in self.limits:
            return self.limits[path]
        
        # Check for prefix match
        for pattern, limits in self.limits.items():
            if path.startswith(pattern):
                return limits
        
        # Return default limits
        return (self.default_limit, self.default_window)
    
    def check_rate_limit(self, request: Request) -> Tuple[bool, RateLimitEntry]:
        """
        Check if request is within rate limit.
        
        Returns:
            Tuple of (allowed, rate_limit_entry)
        """
        client_key = self._get_client_key(request)
        max_requests, window = self._get_limits_for_endpoint(request.url.path)
        
        with self.lock:
            # Get or create rate limit entry
            if client_key not in self.clients:
                self.clients[client_key] = RateLimitEntry(max_requests, window)

            entry = self.clients[client_key]
            
            # Update limits if they changed
            if entry.max_requests != max_requests or entry.window_seconds != window:
                entry.max_requests = max_requests
                entry.window_seconds = window
            
            # Check if allowed
            allowed = entry.is_allowed()

            if len(self.clients) > self.max_clients:
                oldest_key = next(iter(self.clients))
                if oldest_key != client_key:
                    self.clients.pop(oldest_key, None)

            return allowed, entry
    
    def cleanup_old_entries(self):
        """Remove old client entries to prevent memory leak"""
        with self.lock:
            now = time.time()
            to_remove = []
            
            for key, entry in self.clients.items():
                # Remove entries with no recent requests
                if not entry.requests or entry.requests[-1] < now - entry.window_seconds * 2:
                    to_remove.append(key)
            
            for key in to_remove:
                del self.clients[key]
            
            if to_remove:
                logger.debug(f"Cleaned up {len(to_remove)} old rate limit entries")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """FastAPI middleware for rate limiting"""
    
    def __init__(self, app, rate_limiter: RateLimiter = None):
        super().__init__(app)
        self.rate_limiter = rate_limiter or RateLimiter()
        
        # Paths to exclude from rate limiting
        self.exclude_paths = [
            "/health",
            "/",
            "/docs",
            "/openapi.json",
            "/redoc",
        ]
    
    async def dispatch(self, request: Request, call_next):
        """Process request with rate limiting"""
        
        # Skip rate limiting for excluded paths
        if request.url.path in self.exclude_paths:
            return await call_next(request)
        
        # Check rate limit
        allowed, entry = self.rate_limiter.check_rate_limit(request)
        
        if not allowed:
            # Rate limit exceeded
            reset_time = entry.get_reset_time()
            
            logger.warning(
                f"Rate limit exceeded for {request.client.host} "
                f"on {request.url.path} - resets in {reset_time}s"
            )
            
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "error": "Rate limit exceeded",
                    "retry_after": reset_time
                },
                headers={
                    "Retry-After": str(reset_time),
                    "X-RateLimit-Limit": str(entry.max_requests),
                    "X-RateLimit-Remaining": "0",
                    "X-RateLimit-Reset": str(int(time.time() + reset_time))
                }
            )
        
        # Add rate limit headers to response
        response = await call_next(request)
        
        response.headers["X-RateLimit-Limit"] = str(entry.max_requests)
        response.headers["X-RateLimit-Remaining"] = str(entry.get_remaining())
        response.headers["X-RateLimit-Reset"] = str(int(time.time() + entry.get_reset_time()))
        
        return response


# Global rate limiter instance
global_rate_limiter = RateLimiter()
