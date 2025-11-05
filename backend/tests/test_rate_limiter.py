from app.middleware.rate_limiter import RateLimiter


def test_sensitive_route_limits():
    limiter = RateLimiter()

    assert limiter._get_limits_for_endpoint("/api/streams/start") == (3, 120)
    assert limiter._get_limits_for_endpoint("/api/assets/upload-complete") == (12, 60)
    assert limiter._get_limits_for_endpoint("/api/admin/users/summary") == (12, 60)
    assert limiter._get_limits_for_endpoint("/api/admin/alerts") == (8, 60)
    # Fallback to general admin limit when no specific match
    assert limiter._get_limits_for_endpoint("/api/admin/dashboard") == (20, 60)
