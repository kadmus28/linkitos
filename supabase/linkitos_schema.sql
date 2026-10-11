-- Applied to the existing Media Tracker Supabase project as migration
-- linkitos_initial_schema. These tables are isolated from Media Tracker data.
create table public.linkitos_categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 40),
  created_at timestamptz not null default now(),
  constraint linkitos_categories_user_name_key unique (user_id, name),
  constraint linkitos_categories_id_user_id_key unique (id, user_id)
);

create table public.linkitos_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  category_id uuid not null,
  title text not null check (char_length(btrim(title)) between 1 and 180),
  url text not null check (char_length(url) <= 2048),
  image_url text check (image_url is null or char_length(image_url) <= 2048),
  price numeric(10, 2) check (price is null or price >= 0),
  notes text check (notes is null or char_length(notes) <= 1000),
  favorite boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint linkitos_items_category_owner_fkey
    foreign key (category_id, user_id)
    references public.linkitos_categories (id, user_id)
    on delete cascade
);

create index linkitos_categories_user_created_idx
  on public.linkitos_categories (user_id, created_at);
create index linkitos_items_user_created_idx
  on public.linkitos_items (user_id, created_at desc);
create index linkitos_items_category_idx
  on public.linkitos_items (user_id, category_id);
create index linkitos_items_category_owner_idx
  on public.linkitos_items (category_id, user_id);

alter table public.linkitos_categories enable row level security;
alter table public.linkitos_items enable row level security;

create policy "Users can read their Linkitos categories"
  on public.linkitos_categories for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their Linkitos categories"
  on public.linkitos_categories for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their Linkitos categories"
  on public.linkitos_categories for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their Linkitos categories"
  on public.linkitos_categories for delete to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users can read their Linkitos items"
  on public.linkitos_items for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "Users can create their Linkitos items"
  on public.linkitos_items for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "Users can update their Linkitos items"
  on public.linkitos_items for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "Users can delete their Linkitos items"
  on public.linkitos_items for delete to authenticated
  using ((select auth.uid()) = user_id);

grant select, insert, update, delete on public.linkitos_categories to authenticated;
grant select, insert, update, delete on public.linkitos_items to authenticated;

-- Enable instant cross-device refresh through Supabase Realtime.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'linkitos_categories'
    ) then
      alter publication supabase_realtime add table public.linkitos_categories;
    end if;
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'linkitos_items'
    ) then
      alter publication supabase_realtime add table public.linkitos_items;
    end if;
  end if;
end
$$;
