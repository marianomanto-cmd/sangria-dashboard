-- ════════════════════════════════════════════════════════════════════════════
-- Usuarios y roles (sección Configuración → Usuarios y roles).
--
-- Crea la capa de la app sobre Supabase Auth: NO guarda contraseñas ni crea
-- cuentas. Sólo dice a quién conocemos, con qué rol y si está activo.
--
-- La tabla se auto-puebla: en cada request autenticado la app hace upsert por
-- email del usuario logueado. El seed de abajo deja a los dos aprobadores
-- actuales como admin para que la sección no arranque vacía y no se pierda el
-- permiso de aprobar planes.
--
-- Idempotente: se puede correr las veces que haga falta.
-- ════════════════════════════════════════════════════════════════════════════

-- 1) Enum de roles (create type no acepta "if not exists")
do $$
begin
  if not exists (select 1 from pg_type where typname = 'app_user_role') then
    create type app_user_role as enum (
      'admin', 'approver', 'media_planner', 'account_manager', 'finance', 'viewer'
    );
  end if;
end $$;

-- 2) Tabla
create table if not exists app_users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  name          text,
  role          app_user_role not null default 'viewer',
  active        boolean not null default true,
  auth_user_id  uuid,
  last_seen_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_app_users_role on app_users (role);

-- 3) RLS, como toda tabla de public (la app conecta como owner y la bypassa)
alter table public.app_users enable row level security;

-- 4) Seed: los aprobadores que hoy están hardcodeados en lib/permissions.ts.
--    on conflict do nothing => correrlo de nuevo no pisa un rol ya editado.
insert into app_users (email, name, role)
values
  ('mariano.mantovani@sangria.agency', 'Mariano Mantovani', 'admin'),
  ('herman.grabosky@sangria.agency',   'Herman Grabosky',   'admin')
on conflict (email) do nothing;
