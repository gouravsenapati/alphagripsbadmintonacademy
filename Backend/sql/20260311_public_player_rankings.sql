create table if not exists public.player_rankings (
  id bigserial primary key,
  academy_id integer,
  category_id integer,
  category text,
  player_id integer,
  player_name text,
  rank integer,
  points numeric,
  matches_played integer,
  updated_at timestamptz default now()
);

create index if not exists player_rankings_academy_id_idx on public.player_rankings (academy_id);
create index if not exists player_rankings_category_id_idx on public.player_rankings (category_id);
