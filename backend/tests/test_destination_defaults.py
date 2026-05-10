from app.core.defaults import YOUTUBE_DEFAULT_RTMPS_URL
from app.models.database import Destination
from app.schemas.api import DestinationBase


def test_destination_defaults_use_youtube_recommended_rtmps_ingest() -> None:
    assert (
        DestinationBase.model_fields["rtmps_url"].default == YOUTUBE_DEFAULT_RTMPS_URL
    )
    assert Destination.__table__.c.rtmps_url.default is not None
    assert Destination.__table__.c.rtmps_url.default.arg == YOUTUBE_DEFAULT_RTMPS_URL
