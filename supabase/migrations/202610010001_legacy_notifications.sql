-- Compatibilité entre les comptes legacy de l’interface GTA et le modèle
-- moderne qui référence public.gta_profiles.
alter table public.gta_notifications
  add column if not exists legacy_recipient_id uuid references public.gta_users(id) on delete cascade;

create index if not exists gta_notifications_legacy_recipient_idx
  on public.gta_notifications(legacy_recipient_id, is_read, created_at desc);
