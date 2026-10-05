create extension if not exists pgcrypto;
create table if not exists duty_imports(id text primary key,filename text not null,imported_at timestamptz not null default now(),page_count integer not null default 0,raw_text text not null,record_count integer not null default 0,source_url text not null);
create table if not exists vehicles(id text primary key,registration text unique not null,capacity integer,operator text,vehicle_description text,active boolean not null default true);
create table if not exists duties(
 id text primary key,import_id text not null references duty_imports(id) on delete cascade,sort_order integer not null,
 driver_name text,vehicle_id text,vehicle_type text,vehicle_capacity integer,seats integer,start_time text,pickup_time text,leave_time text,arrival_time text,finish_time text,
 origin text,destination text,stay boolean,back boolean,raw_text text not null,
 capacity_status text not null default 'WARN',data_quality_status text not null default 'WARN',overall_status text not null default 'WARN',
 issues jsonb not null default '[]'::jsonb,hours_status text not null default 'WARN',duty_minutes integer,driving_minutes integer,break_minutes integer default 0,hours_issues jsonb not null default '[]'::jsonb,
 wtd_status text not null default 'WARN',wtd_minutes integer,wtd_issues jsonb not null default '[]'::jsonb,
 arrival_estimated boolean not null default false,finish_estimated boolean not null default false,route_status text not null default 'NOT_RUN',route_error text,outbound_route_minutes integer,return_route_minutes integer
);
create index if not exists duties_import_idx on duties(import_id,sort_order);
create index if not exists duties_driver_idx on duties(import_id,driver_name);
create index if not exists duties_vehicle_idx on duties(vehicle_id);
