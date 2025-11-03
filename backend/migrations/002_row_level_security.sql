-- Row Level Security (RLS) Policies
-- Ensures users can only access their own data

-- Enable RLS on all tables
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlists ENABLE ROW LEVEL SECURITY;
ALTER TABLE playlist_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE streams ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_destinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE stream_events ENABLE ROW LEVEL SECURITY;

-- Projects policies
CREATE POLICY "Users can view own projects"
    ON projects FOR SELECT
    USING (auth.uid() = user_id);

CREATE POLICY "Users can create own projects"
    ON projects FOR INSERT
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own projects"
    ON projects FOR UPDATE
    USING (auth.uid() = user_id)
    WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own projects"
    ON projects FOR DELETE
    USING (auth.uid() = user_id);

-- Assets policies
CREATE POLICY "Users can view own assets"
    ON assets FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = assets.project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create assets in own projects"
    ON assets FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own assets"
    ON assets FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = assets.project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own assets"
    ON assets FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = assets.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- Playlists policies
CREATE POLICY "Users can view own playlists"
    ON playlists FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = playlists.project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create playlists in own projects"
    ON playlists FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own playlists"
    ON playlists FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = playlists.project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own playlists"
    ON playlists FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = playlists.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- Playlist items policies
CREATE POLICY "Users can view own playlist items"
    ON playlist_items FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM playlists
            JOIN projects ON projects.id = playlists.project_id
            WHERE playlists.id = playlist_items.playlist_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage own playlist items"
    ON playlist_items FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM playlists
            JOIN projects ON projects.id = playlists.project_id
            WHERE playlists.id = playlist_items.playlist_id
            AND projects.user_id = auth.uid()
        )
    );

-- Destinations policies
CREATE POLICY "Users can view own destinations"
    ON destinations FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = destinations.project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create destinations in own projects"
    ON destinations FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own destinations"
    ON destinations FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = destinations.project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own destinations"
    ON destinations FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = destinations.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- Streams policies
CREATE POLICY "Users can view own streams"
    ON streams FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = streams.project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can create streams in own projects"
    ON streams FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can update own streams"
    ON streams FOR UPDATE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = streams.project_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can delete own streams"
    ON streams FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM projects
            WHERE projects.id = streams.project_id
            AND projects.user_id = auth.uid()
        )
    );

-- Stream destinations policies
CREATE POLICY "Users can view own stream destinations"
    ON stream_destinations FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM streams
            JOIN projects ON projects.id = streams.project_id
            WHERE streams.id = stream_destinations.stream_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can manage own stream destinations"
    ON stream_destinations FOR ALL
    USING (
        EXISTS (
            SELECT 1 FROM streams
            JOIN projects ON projects.id = streams.project_id
            WHERE streams.id = stream_destinations.stream_id
            AND projects.user_id = auth.uid()
        )
    );

-- Stream events policies
CREATE POLICY "Users can view own stream events"
    ON stream_events FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM streams
            JOIN projects ON projects.id = streams.project_id
            WHERE streams.id = stream_events.stream_id
            AND projects.user_id = auth.uid()
        )
    );

CREATE POLICY "Users can insert stream events for own streams"
    ON stream_events FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM streams
            JOIN projects ON projects.id = streams.project_id
            WHERE streams.id = stream_id
            AND projects.user_id = auth.uid()
        )
    );

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated;
