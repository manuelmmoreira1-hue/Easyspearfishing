create extension if not exists pgcrypto;

create table if not exists public.observations (
  id uuid primary key,
  spot text not null,
  visibility numeric not null,
  conditions integer not null,
  clarity integer not null,
  fish_activity integer not null,
  note text,
  author text,
  created_at timestamptz not null default now()
);

create index if not exists observations_spot_created_idx
  on public.observations (spot, created_at desc);

create table if not exists public.site_visits (
  id uuid primary key default gen_random_uuid(),
  visitor_id text not null,
  created_at timestamptz not null default now()
);

create index if not exists site_visits_created_idx
  on public.site_visits (created_at desc);
create index if not exists site_visits_visitor_idx
  on public.site_visits (visitor_id);

create or replace function public.easyspearfishing_stats()
returns json
language sql
security definer
set search_path = public
as $$
  select json_build_object(
    'totalVisits', (select count(*) from public.site_visits),
    'todayVisits', (select count(*) from public.site_visits where created_at >= current_date),
    'uniqueVisitors', (select count(distinct visitor_id) from public.site_visits),
    'observations', (select count(*) from public.observations),
    'spotsObserved', (select count(distinct spot) from public.observations),
    'lastObservation', (select max(created_at) from public.observations)
  );
$$;

grant execute on function public.easyspearfishing_stats() to service_role;
