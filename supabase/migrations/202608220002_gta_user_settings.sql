create table if not exists public.gta_user_settings (
  user_id uuid primary key references public.gta_users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  username text,
  avatar_path text,
  preferences jsonb not null default '{"soundEnabled":false,"compactMode":false,"confirmDelete":true}'::jsonb,
  updated_at timestamptz not null default now()
);

create index if not exists gta_user_settings_username_idx on public.gta_user_settings(username);

drop trigger if exists gta_user_settings_updated_at on public.gta_user_settings;
create trigger gta_user_settings_updated_at before update on public.gta_user_settings for each row execute function public.gta_set_updated_at();

alter table public.gta_user_settings enable row level security;
