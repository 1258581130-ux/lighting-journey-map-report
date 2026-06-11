create extension if not exists pgcrypto;

create table if not exists public.lighting_journeys (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  journey_id text not null,
  person_id text,
  person_name text,
  persona_role text,
  sample_type text,
  experience_date date,
  tags text[] default '{}',
  journey_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_code, journey_id)
);

create table if not exists public.lighting_evidence_files (
  id uuid primary key default gen_random_uuid(),
  project_code text not null,
  journey_id text not null,
  stage_id integer not null,
  evidence_id text not null,
  name text,
  type text,
  category text,
  size bigint default 0,
  note text,
  storage_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_code, journey_id, evidence_id)
);

alter table public.lighting_journeys enable row level security;
alter table public.lighting_evidence_files enable row level security;

drop policy if exists "lighting journeys public read" on public.lighting_journeys;
drop policy if exists "lighting journeys public insert" on public.lighting_journeys;
drop policy if exists "lighting journeys public update" on public.lighting_journeys;
drop policy if exists "lighting evidence public read" on public.lighting_evidence_files;
drop policy if exists "lighting evidence public insert" on public.lighting_evidence_files;
drop policy if exists "lighting evidence public update" on public.lighting_evidence_files;

create policy "lighting journeys public read"
on public.lighting_journeys for select
to anon
using (true);

create policy "lighting journeys public insert"
on public.lighting_journeys for insert
to anon
with check (project_code is not null and journey_id is not null);

create policy "lighting journeys public update"
on public.lighting_journeys for update
to anon
using (true)
with check (project_code is not null and journey_id is not null);

create policy "lighting evidence public read"
on public.lighting_evidence_files for select
to anon
using (true);

create policy "lighting evidence public insert"
on public.lighting_evidence_files for insert
to anon
with check (project_code is not null and journey_id is not null and evidence_id is not null);

create policy "lighting evidence public update"
on public.lighting_evidence_files for update
to anon
using (true)
with check (project_code is not null and journey_id is not null and evidence_id is not null);

insert into storage.buckets (id, name, public)
values ('lighting-evidence', 'lighting-evidence', false)
on conflict (id) do nothing;

drop policy if exists "lighting evidence files public read" on storage.objects;
drop policy if exists "lighting evidence files public insert" on storage.objects;
drop policy if exists "lighting evidence files public update" on storage.objects;

create policy "lighting evidence files public read"
on storage.objects for select
to anon
using (bucket_id = 'lighting-evidence');

create policy "lighting evidence files public insert"
on storage.objects for insert
to anon
with check (bucket_id = 'lighting-evidence');

create policy "lighting evidence files public update"
on storage.objects for update
to anon
using (bucket_id = 'lighting-evidence')
with check (bucket_id = 'lighting-evidence');

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'lighting_journeys'
  ) then
    alter publication supabase_realtime add table public.lighting_journeys;
  end if;
end $$;
