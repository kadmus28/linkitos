create table public.linkitos_projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  description text check (description is null or char_length(description) <= 1000),
  cover_path text check (cover_path is null or char_length(cover_path) <= 512),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkitos_projects_id_user_id_key unique (id, user_id)
);

create table public.linkitos_project_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  project_id uuid not null,
  kind text not null check (kind in ('idea', 'link', 'image')),
  title text not null check (char_length(btrim(title)) between 1 and 160),
  body text check (body is null or char_length(body) <= 2000),
  url text check (url is null or char_length(url) <= 2048),
  image_path text check (image_path is null or char_length(image_path) <= 512),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkitos_project_entries_project_owner_fkey
    foreign key (project_id, user_id)
    references public.linkitos_projects (id, user_id)
    on delete cascade,
  constraint linkitos_project_entries_content_check check (
    (kind = 'idea' and url is null and image_path is null)
    or (kind = 'link' and url is not null and image_path is null)
    or (kind = 'image' and url is null and image_path is not null)
  )
);

create index linkitos_projects_user_updated_idx
  on public.linkitos_projects (user_id, updated_at desc);
create index linkitos_project_entries_user_created_idx
  on public.linkitos_project_entries (user_id, created_at desc);
create index linkitos_project_entries_project_idx
  on public.linkitos_project_entries (project_id, user_id, created_at desc);

alter table public.linkitos_projects enable row level security;
alter table public.linkitos_project_entries enable row level security;

create policy "Users can read their Linkitos projects"
  on public.linkitos_projects for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their Linkitos projects"
  on public.linkitos_projects for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their Linkitos projects"
  on public.linkitos_projects for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their Linkitos projects"
  on public.linkitos_projects for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Linkitos project entries"
  on public.linkitos_project_entries for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their Linkitos project entries"
  on public.linkitos_project_entries for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their Linkitos project entries"
  on public.linkitos_project_entries for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their Linkitos project entries"
  on public.linkitos_project_entries for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.linkitos_projects to authenticated;
grant select, insert, update, delete on public.linkitos_project_entries to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'linkitos-project-assets',
  'linkitos-project-assets',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp', 'image/gif']::text[]
)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy "Users can read their Linkitos project images"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'linkitos-project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users can upload their Linkitos project images"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'linkitos-project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
create policy "Users can delete their Linkitos project images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'linkitos-project-assets'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'linkitos_projects'
    ) then
      alter publication supabase_realtime add table public.linkitos_projects;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'linkitos_project_entries'
    ) then
      alter publication supabase_realtime add table public.linkitos_project_entries;
    end if;
  end if;
end
$$;
