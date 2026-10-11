alter table public.linkitos_project_entries
  add column category text check (category is null or char_length(category) <= 40),
  add column image_url text check (image_url is null or char_length(image_url) <= 2048),
  add column price numeric(10, 2) check (price is null or price >= 0);
