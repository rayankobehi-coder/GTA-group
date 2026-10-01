create extension if not exists "pgcrypto";

create table if not exists public.gta_users (
  id uuid primary key default gen_random_uuid(),
  username text not null unique,
  full_name text not null,
  email text,
  phone text,
  role text not null check (role in ('admin', 'parent', 'prof', 'eleve', 'staff')),
  password_hash text not null,
  permissions jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.gta_profiles (
  user_id uuid primary key references public.gta_users(id) on delete cascade,
  full_name text,
  email text,
  phone text,
  username text,
  avatar_path text,
  preferences jsonb not null default '{"soundEnabled":false,"compactMode":false,"confirmDelete":true}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.gta_documents (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  storage_path text not null unique,
  mime_type text,
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  uploaded_by uuid references public.gta_users(id) on delete set null,
  visibility text not null default 'shared' check (visibility in ('shared', 'private')),
  owner_id uuid references public.gta_users(id) on delete cascade,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gta_registrations (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  target_class text not null,
  phone text not null,
  email text,
  message text,
  status text not null default 'new' check (status in ('new', 'contacted', 'accepted', 'rejected')),
  telegram_sent boolean not null default false,
  telegram_error text,
  created_at timestamptz not null default now()
);

create table if not exists public.gta_activity (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.gta_users(id) on delete set null,
  action text not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.gta_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid references public.gta_users(id) on delete cascade,
  title text not null,
  message text not null,
  type text not null default 'info' check (type in ('info', 'success', 'warning', 'error')),
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists public.gta_suggestions (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null references public.gta_users(id) on delete cascade,
  subject text not null,
  message text not null,
  status text not null default 'new' check (status in ('new', 'read', 'processed')),
  created_at timestamptz not null default now()
);

create table if not exists public.gta_presence (
  user_id uuid primary key references public.gta_users(id) on delete cascade,
  last_seen_at timestamptz not null default now(),
  user_agent text,
  ip_hash text
);

create index if not exists gta_users_role_idx on public.gta_users(role);
create index if not exists gta_users_active_idx on public.gta_users(is_active);
create index if not exists gta_documents_uploaded_by_idx on public.gta_documents(uploaded_by);
create index if not exists gta_documents_owner_idx on public.gta_documents(owner_id);
create index if not exists gta_documents_created_at_idx on public.gta_documents(created_at desc);
create index if not exists gta_registrations_created_at_idx on public.gta_registrations(created_at desc);
create index if not exists gta_activity_created_at_idx on public.gta_activity(created_at desc);
create index if not exists gta_notifications_recipient_idx on public.gta_notifications(recipient_id, is_read, created_at desc);
create index if not exists gta_suggestions_author_idx on public.gta_suggestions(author_id, created_at desc);
create index if not exists gta_presence_last_seen_idx on public.gta_presence(last_seen_at desc);

create or replace function public.gta_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists gta_users_updated_at on public.gta_users;
create trigger gta_users_updated_at before update on public.gta_users for each row execute function public.gta_set_updated_at();
drop trigger if exists gta_profiles_updated_at on public.gta_profiles;
create trigger gta_profiles_updated_at before update on public.gta_profiles for each row execute function public.gta_set_updated_at();

alter table public.gta_users enable row level security;
alter table public.gta_profiles enable row level security;
alter table public.gta_documents enable row level security;
alter table public.gta_registrations enable row level security;
alter table public.gta_activity enable row level security;
alter table public.gta_notifications enable row level security;
alter table public.gta_suggestions enable row level security;
alter table public.gta_presence enable row level security;

insert into storage.buckets (id, name, public)
values ('gta-documents', 'gta-documents', false)
on conflict (id) do update set public = excluded.public;

insert into storage.buckets (id, name, public)
values ('gta-avatars', 'gta-avatars', false)
on conflict (id) do update set public = excluded.public;

comment on table public.gta_users is 'Comptes applicatifs GTA avec mots de passe hachés côté serveur.';
comment on table public.gta_documents is 'Métadonnées des fichiers conservés dans Supabase Storage.';
comment on table public.gta_registrations is 'Demandes publiques d’inscription envoyées à l’administration.';
comment on table public.gta_presence is 'Dernière présence connue pour calculer les utilisateurs actuellement en ligne.';
