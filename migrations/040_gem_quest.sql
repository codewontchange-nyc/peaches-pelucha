-- Gem Quest 💎: journey progress — one row per player per level cleared.
-- unique(player_id, level) doubles as the hearts double-award guard later.
create table if not exists gem_progress (
  id          uuid primary key default gen_random_uuid(),
  player_id   uuid references players(id) on delete cascade,
  level       int not null,
  stars       int not null default 0,
  best_score  int not null default 0,
  updated_at  timestamptz not null default now(),
  unique (player_id, level)
);
create index if not exists gem_progress_by_player on gem_progress (player_id, level desc);
alter table gem_progress enable row level security;
drop policy if exists anon_all on gem_progress;
create policy anon_all on gem_progress for all to anon, authenticated using (true) with check (true);
do $$ begin alter publication supabase_realtime add table gem_progress; exception when duplicate_object then null; end $$;
