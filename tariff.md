# Streaming Tariffs Specification

This document describes the commercial tiers, feature limits, and technical thresholds that must be enforced in the application and database. Values below derive from the current product copy (EN/UA/RU) and should be treated as the single source of truth until replaced by a dedicated billing service.

## Shared Constraints

* Video is forwarded without transcoding; clients must upload content within the exact limits documented here.
* AAC audio is acceptable for all tiers; we do not advertise AC-3/5.1 support.
* Each plan defines:
  * `max_active_streams`: number of concurrent live pipelines.
  * `max_resolution_height` and `max_fps`: ceiling for pass-through assets.
  * `storage_quota_gb`: total circular storage available for uploads.
  * `daily_streaming_limit_hours`: total daily output per workspace. `24/7` means no cap.
  * `destinations_limit`: simultaneous destinations per stream.

All Full HD plans allow lower resolutions (720p, etc.). All 4K plans allow output down to Full HD, but must not exceed 2160p.

## Plan Matrix

| Plan key       | Display name  | Price (USD/mo) | Max streams | Max resolution | Max FPS | Storage (GB) | Daily output limit | Destinations |
|---------------|----------------|----------------|-------------|----------------|---------|---------------|--------------------|--------------|
| `free`        | Free           | $0             | 1           | 1080p          | 30      | 3             | 8 hours/day        | 1            |
| `fhd_start`   | FHD Start      | $10            | 1           | 1080p          | 30      | 50            | 24 hours/day       | 3            |
| `fhd_flow`    | FHD Flow       | $20            | 2           | 1080p          | 60      | 100           | 24/7               | 6            |
| `fhd_boost`   | FHD Boost      | $35            | 4           | 1080p          | 60      | 200           | 24/7               | 10           |
| `uhd_start`   | 4K Start       | $69            | 1           | 2160p          | 60      | 200           | 24/7               | 4            |
| `uhd_flow`    | 4K Flow        | $109           | 2           | 2160p          | 60      | 400           | 24/7               | 8            |
| `uhd_boost`   | 4K Boost       | $159           | 4           | 2160p          | 60      | 800           | 24/7               | 12           |

### Additional Feature Flags

| Plan key     | Calendar & scheduling | Custom on-stream branding | Automation / playlists | Priority support | Dedicated manager |
|--------------|-----------------------|---------------------------|------------------------|------------------|-------------------|
| free         | No                    | No                        | No                     | Community only   | No                |
| fhd_start    | No                    | No                        | No                     | Standard email   | No                |
| fhd_flow     | Yes                   | Yes                       | No                     | Priority email   | No                |
| fhd_boost    | Yes                   | Yes                       | Yes                    | Priority email   | No                |
| uhd_start    | Yes                   | Yes                       | No                     | Email (<24h)     | No                |
| uhd_flow     | Yes                   | Yes                       | Yes                    | Same-day email   | No                |
| uhd_boost    | Yes                   | Yes                       | Yes                    | Same-day email   | Yes               |

### Codec Expectations

* Full HD plans require uploads encoded as H.264 video with AAC audio. Bitrate guidance (not enforced server-side): 3–10 Mbps for 1080p@30, 6–12 Mbps for 1080p@60.
* 4K plans accept H.264 or HEVC video with AAC audio. Recommended bitrate 15–30 Mbps for single-stream 4K60.

### Pricing Notes

Pricing strings ($10, $20, etc.) are currently hard-coded in localization files. Database seeding should write numeric values in cents (e.g., `price_cents = 1000` for $10) to simplify later integration with billing providers.

## Pending Implementation Tasks

1. Seed a `subscription_plans` table with the attributes above (internal key, name, price, limits, feature flags).
2. Update quota checks to read from that table instead of static config.
3. Extend onboarding flows to map workspaces to the correct plan.
4. Provide admin tooling for future adjustments (storage bumps, promotional trials).

Keeping the spec here ensures future engineering tasks start from an agreed baseline.
