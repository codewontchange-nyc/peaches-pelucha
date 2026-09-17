-- Gem Duel ⚔️ online: one live match row, Phase-10 style — state jsonb +
-- version int, optimistic version-guarded commits, realtime UPDATE sync.
-- state = { mode:'duel', seed, p0, p1 (player ids; p0 = ● solids), turn,
--           actions:[{t:'shot',a,ammo?,by}|{t:'swap',by}...], scores,
--           status:'playing'|'duelend', winner, hash }
-- The BOARD is never stored: both phones derive it by replaying actions
-- through the deterministic engine (gems.js replayDuel); `hash` is the
-- desync tripwire.
create table if not exists gem_matches (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'playing',   -- 'playing' | 'finished'
  state       jsonb not null,
  version     int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists gem_matches_live on gem_matches (status, created_at desc);
alter table gem_matches enable row level security;
drop policy if exists anon_all on gem_matches;
create policy anon_all on gem_matches for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table gem_matches; exception when duplicate_object then null; end $$;
