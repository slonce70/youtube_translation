# Media Library Flow Notes

## Current Background Video Journey

### 1. Upload → Asset Creation
1. The dashboard uses Uppy with the tus protocol to upload background videos. When tusd reports completion, the frontend expects the backend webhook at `POST /api/assets/upload-complete` to validate the file and create the asset record. 【F:frontend/src/app/dashboard/library/page.tsx†L6-L28】【F:backend/app/api/routes/assets.py†L282-L432】
2. During validation the backend inspects the file with FFprobe, stores codec/bitrate metadata, and records whether the asset is safe for stream-copy playback. Any derived warnings and compatibility flags are persisted on the asset for later UX hints. 【F:backend/app/api/routes/assets.py†L32-L121】【F:backend/app/api/routes/assets.py†L332-L420】
3. Once saved, assets are listed for the user through `GET /api/assets/`, which simply filters by `user_id` and returns all stored videos. There is no additional grouping beyond the flat list. 【F:backend/app/api/routes/assets.py†L97-L167】

### 2. Asset → Playlist Assembly
1. The dashboard library page fetches assets and playlists together, allowing users to drag assets into playlist drafts. Playlist persistence relies on `POST /api/playlists/` and `PUT /api/playlists/{id}`. 【F:frontend/src/app/dashboard/library/page.tsx†L603-L688】
2. The playlist API enforces ownership, re-validates that every referenced asset belongs to the user, and materializes ordered `PlaylistItem` rows. Validation utilities can be invoked via `POST /api/playlists/{id}/validate` to ensure stream compatibility. 【F:backend/app/api/routes/playlists.py†L38-L207】【F:backend/app/api/routes/playlists.py†L274-L360】
3. Streams that run off playlists bind to them by storing the `playlist_id`. When starting a stream, the backend loads playlist items, expands them into FFmpeg concat inputs, and respects the loop flag when repeating assets. 【F:backend/app/api/routes/streams.py†L26-L111】

### 3. Playlist → Stream Scheduling
1. A stream can either point to a playlist (`source_type="playlist"`) or to an ordered list of standalone assets. Stream creation checks the requested playlist or the supplied asset IDs before writing the configuration. 【F:backend/app/api/routes/streams.py†L69-L164】
2. When a stream is deleted, the system stops any running FFmpeg process, removes its working directory, and deletes the configuration row. There is no cascade back to playlists or assets beyond releasing the reference. 【F:backend/app/api/routes/streams.py†L528-L604】

## Identified Gaps

### Dedicated Audio Playlists
- All playlist operations assume `PlaylistItem` rows refer to video assets validated for stream-copy playback. There is no schema or routing distinction for audio-only collections, so creating or selecting a playlist always yields video-focused metadata and validation rules. 【F:backend/app/api/routes/playlists.py†L38-L207】【F:frontend/src/app/dashboard/library/page.tsx†L521-L688】
- Stream assembly treats playlist assets as video backgrounds and exposes only a `source_type` switch between playlist and raw asset lists. Dedicated audio beds would need new metadata (duration alignment, cross-fade rules) and separate routing or flags to avoid conflicting with the existing validation expectations. 【F:backend/app/api/routes/streams.py†L26-L111】

### Virtual Folder Organization
- Asset listing returns a flat collection keyed by owner; the frontend likewise presents every asset in a single grid with optional filters but no hierarchical grouping. Implementing folders would require additional fields or lookup tables because neither the API nor the UI maintains folder identifiers today. 【F:backend/app/api/routes/assets.py†L97-L167】【F:frontend/src/app/dashboard/library/page.tsx†L421-L552】
- Without folder concepts, playlists double as the only organizational tool. Introducing virtual folders would necessitate new routes for folder CRUD plus updated queries in both assets and playlists to surface folder context during selection. 【F:backend/app/api/routes/assets.py†L97-L167】【F:frontend/src/app/dashboard/library/page.tsx†L603-L688】

## Deletion Behaviors and Required Prompts

### Current State
- Asset deletion is irreversible: `DELETE /api/assets/{id}` removes the file and database row without checking whether the asset participates in playlists or manual stream asset lists. The dashboard surfaces only a `confirm()` prompt before invoking the mutation. 【F:backend/app/api/routes/assets.py†L636-L705】【F:frontend/src/app/dashboard/library/page.tsx†L706-L734】
- Playlist deletion first verifies ownership and then blocks removal if any stream still references the playlist, returning HTTP 409. The dashboard again only shows a bare confirmation dialog before calling the API. 【F:backend/app/api/routes/playlists.py†L209-L271】【F:frontend/src/app/dashboard/library/page.tsx†L820-L840】

### Recommended UX Warnings
1. **Asset used in Playlists** – warn that the asset will disappear from specific playlists and list their names before allowing deletion. Back-end support could be added by joining `PlaylistItem` to surface dependents.
2. **Asset linked directly to Streams** – if a stream references the asset as a direct source, inform the user that those streams will fail to start until updated. This requires checking `StreamAsset` relations.
3. **Playlist powering Streams** – expand the existing 409 error into a pre-flight check that enumerates affected streams and offers a guided unlink workflow rather than a hard block.
4. **Shared Audio vs. Video Assets** – once audio playlists exist, clarify whether deletion affects both audio beds and video backgrounds to avoid silent cross-media impacts.

By codifying these prompts and backend guards, the media library can evolve toward richer organization (audio playlists, folders) without surprising destructive actions.
