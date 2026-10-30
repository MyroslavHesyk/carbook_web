-- CarBook v2 — clean initial schema for a NEW Supabase project.
-- Run this once in Supabase Dashboard -> SQL Editor -> New query.
-- This script does not import or modify data from the previous Telegram bot.

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Cars
-- user_id is assigned by Postgres from the authenticated session, not trusted
-- from browser input. Row Level Security below enforces ownership.
-- -----------------------------------------------------------------------------
create table if not exists public.cars (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  make varchar(60) not null check (length(trim(make)) between 1 and 60),
  model varchar(60) not null check (length(trim(model)) between 1 and 60),
  year integer not null check (year between 1886 and 2100),
  fuel_type varchar(24) not null,
  current_odometer integer check (current_odometer is null or current_odometer >= 0),
  purchase_date date,
  purchase_odometer integer check (purchase_odometer is null or purchase_odometer >= 0),
  estimated_value_usd numeric(12, 2) check (estimated_value_usd is null or estimated_value_usd >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Fuel records
-- Consumption is calculated in the browser only from full-tank-to-full-tank
-- intervals. It is intentionally not stored as a guessed value in the database.
-- -----------------------------------------------------------------------------
create table if not exists public.fuel_entries (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  date date not null default current_date,
  odometer integer not null check (odometer >= 0),
  liters numeric(10, 2) not null check (liters > 0 and liters <= 5000),
  total_cost numeric(12, 2) not null check (total_cost >= 0),
  station varchar(120),
  fuel_type varchar(24),
  full_tank boolean not null default false,
  note text,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Other expenses
-- -----------------------------------------------------------------------------
create table if not exists public.expenses (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  date date not null default current_date,
  category varchar(60) not null,
  description text,
  amount numeric(12, 2) not null check (amount >= 0),
  odometer integer check (odometer is null or odometer >= 0),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Service history
-- -----------------------------------------------------------------------------
create table if not exists public.service_records (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  date date not null default current_date,
  odometer integer not null check (odometer >= 0),
  work_done text not null check (length(trim(work_done)) > 0),
  details text,
  cost numeric(12, 2) check (cost is null or cost >= 0),
  next_odometer integer check (next_odometer is null or next_odometer >= 0),
  next_date date,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Reminders
-- A reminder may be date-based, mileage-based, or both.
-- -----------------------------------------------------------------------------
create table if not exists public.reminders (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  title varchar(200) not null check (length(trim(title)) between 1 and 200),
  description text,
  due_odometer integer check (due_odometer is null or due_odometer >= 0),
  due_date date,
  is_done boolean not null default false,
  created_at timestamptz not null default now(),
  notified_at timestamptz
);

-- -----------------------------------------------------------------------------
-- Notes
-- -----------------------------------------------------------------------------
create table if not exists public.notes (
  id uuid primary key default gen_random_uuid(),
  car_id uuid not null references public.cars(id) on delete cascade,
  date date not null default current_date,
  content text not null check (length(trim(content)) > 0),
  created_at timestamptz not null default now()
);

-- Indexes used by the app's car/date filters and ordering.
create index if not exists cars_user_created_idx on public.cars(user_id, created_at desc);
create index if not exists fuel_entries_car_date_idx on public.fuel_entries(car_id, date desc, id);
create index if not exists expenses_car_date_idx on public.expenses(car_id, date desc, id);
create index if not exists service_records_car_date_idx on public.service_records(car_id, date desc, id);
create index if not exists reminders_car_due_idx on public.reminders(car_id, due_date asc, created_at desc);
create index if not exists notes_car_date_idx on public.notes(car_id, date desc, id);

-- Keep cars.updated_at current when car details are edited.
create or replace function public.carbook_set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists cars_set_updated_at on public.cars;
create trigger cars_set_updated_at
before update on public.cars
for each row execute function public.carbook_set_updated_at();

-- -----------------------------------------------------------------------------
-- Row Level Security
-- -----------------------------------------------------------------------------
alter table public.cars enable row level security;
alter table public.fuel_entries enable row level security;
alter table public.expenses enable row level security;
alter table public.service_records enable row level security;
alter table public.reminders enable row level security;
alter table public.notes enable row level security;

drop policy if exists cars_owner_all on public.cars;
create policy cars_owner_all
on public.cars
for all
to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'fuel_entries', 'expenses', 'service_records', 'reminders', 'notes'
  ] loop
    execute format('drop policy if exists %I on public.%I', table_name || '_owner_all', table_name);
    execute format(
      'create policy %I on public.%I for all to authenticated ' ||
      'using (exists (select 1 from public.cars c where c.id = car_id and c.user_id = (select auth.uid()))) ' ||
      'with check (exists (select 1 from public.cars c where c.id = car_id and c.user_id = (select auth.uid())))',
      table_name || '_owner_all', table_name
    );
  end loop;
end;
$$;

-- Supabase projects normally grant these privileges by default. Declaring them
-- explicitly makes the intended browser role clear; RLS still restricts rows.
grant usage on schema public to authenticated;
grant select, insert, update, delete on
  public.cars,
  public.fuel_entries,
  public.expenses,
  public.service_records,
  public.reminders,
  public.notes
  to authenticated;

comment on table public.cars is 'CarBook: vehicles owned by the authenticated user';
comment on table public.fuel_entries is 'CarBook: fuel fill-ups and odometer readings';
comment on table public.expenses is 'CarBook: non-fuel vehicle expenses';
comment on table public.service_records is 'CarBook: maintenance and repair history';
comment on table public.reminders is 'CarBook: date- or odometer-based reminders';
comment on table public.notes is 'CarBook: private notes attached to a vehicle';
