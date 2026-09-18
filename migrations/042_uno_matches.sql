-- UNO 🃏: one live match row, Phase-10 style — the WHOLE game state (hands,
-- deck, discard, turn, color) lives in state jsonb; version guards optimistic
-- commits; realtime UPDATE keeps both phones in sync. Winner takes 25 💗
-- (transactions + games rows written by the committer of the winning play).
create table if not exists uno_matches (
  id          uuid primary key default gen_random_uuid(),
  status      text not null default 'playing',   -- 'playing' | 'finished'
  state       jsonb not null,
  version     int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists uno_matches_live on uno_matches (status, created_at desc);
alter table uno_matches enable row level security;
drop policy if exists anon_all on uno_matches;
create policy anon_all on uno_matches for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table uno_matches; exception when duplicate_object then null; end $$;
