-- Resync-Flag für Landing-Server Themes.
-- Admin setzt themes_resync_requested_at; Heartbeat liefert resync_needed=true,
-- bis der Agent mit { resync_done: true } meldet und themes_resync_done_at gesetzt wird.
ALTER TABLE public.landing_servers
  ADD COLUMN IF NOT EXISTS themes_resync_requested_at timestamptz,
  ADD COLUMN IF NOT EXISTS themes_resync_done_at timestamptz;
