"""Routing-level tests for media folders endpoints.

These tests ensure that static subpaths (like /assets/bulk) are not shadowed by
dynamic UUID routes (like /assets/{asset_id}).
"""

from uuid import uuid4

from starlette.routing import Match

from app.main import app


def _first_full_match(path: str, method: str):
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "method": method.upper(),
        "path": path,
        "raw_path": path.encode("ascii", "ignore"),
        "query_string": b"",
        "headers": [],
        "client": ("testclient", 123),
        "server": ("testserver", 80),
        "scheme": "http",
        "root_path": "",
    }

    for route in app.router.routes:
        match, _ = route.matches(scope)
        if match == Match.FULL:
            return route
    return None


def test_bulk_assets_route_is_not_shadowed_by_asset_uuid_route():
    folder_id = uuid4()
    path = f"/api/media-folders/{folder_id}/assets/bulk"

    route = _first_full_match(path, "POST")
    assert route is not None, "Expected a matching route for bulk asset move endpoint"
    assert route.endpoint.__name__ == "bulk_move_assets_to_folder"
