-- V3: one class / shared attendance / many activities. Legacy session IDs and marks remain intact.
alter table public.athletics_class_sessions add column parent_session_id uuid references public.athletics_class_sessions(id);
create index class_sessions_parent on public.athletics_class_sessions(parent_session_id);
alter table public.athletics_class_sessions add column closed_at timestamptz;
alter table public.athletics_class_sessions add column timing_method text not null default 'unspecified' check(timing_method in ('unspecified','manual','photo_finish','not_applicable'));
alter table public.athletics_class_sessions add column implement_kg numeric check(implement_kg>0 and implement_kg<=100);
grant update(closed_at,timing_method,implement_kg,conditions) on public.athletics_class_sessions to authenticated;
alter table public.athletics_class_attendance add column available boolean not null default true;
update public.athletics_class_attendance set available=present;
grant update(available) on public.athletics_class_attendance to authenticated;
alter table public.athletics_class_marks add column timing_method text not null default 'unspecified' check(timing_method in ('unspecified','manual','photo_finish','not_applicable'));
alter table public.athletics_class_marks add column implement_kg numeric check(implement_kg>0 and implement_kg<=100);
alter table public.athletics_class_marks add column conditions text not null default '' check(length(conditions)<=500);
update public.athletics_class_marks m set conditions=s.conditions from public.athletics_class_sessions s where s.id=m.session_id;
grant update(timing_method,implement_kg,conditions) on public.athletics_class_marks to authenticated;

-- A root session contains the first activity; children contain additional activities.
-- An invoker helper checks access and serializes mutations across the entire session.
create function public.athletics_class_lock(p_session_id uuid,p_allow_closed boolean default false) returns uuid
language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions; r athletics_class_sessions; root_id uuid;
begin
 select * into s from athletics_class_sessions where id=p_session_id;
 if auth.uid() is null or s.id is null or not is_athletics_admin(s.tournament_id) then raise exception 'Not authorized';end if;
 root_id:=coalesce(s.parent_session_id,s.id);
 perform pg_advisory_xact_lock(hashtextextended(root_id::text,0));
 select * into r from athletics_class_sessions where id=root_id;
 if r.id is null or r.parent_session_id is not null then raise exception 'Invalid parent session';end if;
 if not p_allow_closed and r.closed_at is not null then raise exception 'Session closed. Reopen it before making changes.';end if;
 return root_id;
end $$;
revoke all on function public.athletics_class_lock(uuid,boolean) from public,anon;
grant execute on function public.athletics_class_lock(uuid,boolean) to authenticated;

create function public.athletics_class_session_guard() returns trigger language plpgsql security invoker set search_path=public as $$
declare r athletics_class_sessions;
begin
 if tg_op='INSERT' and new.parent_session_id is not null then
  perform athletics_class_lock(new.parent_session_id);
  select * into r from athletics_class_sessions where id=new.parent_session_id;
  if r.parent_session_id is not null or new.tournament_id<>r.tournament_id or new.session_date<>r.session_date or new.categories is distinct from r.categories or new.category<>r.category or new.source<>r.source or (r.gender<>'All' and new.gender<>r.gender) then raise exception 'Activity must share its parent session settings';end if;
 elsif tg_op='UPDATE' then
  perform athletics_class_lock(new.id,true);
  if new.parent_session_id is not null and new.closed_at is distinct from old.closed_at then raise exception 'Close the whole session from its summary';end if;
  if new.closed_at is not distinct from old.closed_at then perform athletics_class_lock(new.id);end if;
 end if;
 return new;
end $$;
revoke all on function public.athletics_class_session_guard() from public,anon;
create trigger class_session_guard before insert or update on public.athletics_class_sessions for each row execute function public.athletics_class_session_guard();

create or replace function public.athletics_class_attendance_guard() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 perform athletics_class_lock(new.session_id);
 -- "present" is historical attendance; "available" controls future rounds.
 if tg_op='UPDATE' and old.present and not new.present then raise exception 'Attendance history cannot be erased; set available to false';end if;
 if new.available and not new.present then raise exception 'An available athlete must have attended';end if;
 return new;
end $$;

create or replace function public.athletics_save_class_attendance(p_session_id uuid,p_present uuid[]) returns integer language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions; root_id uuid;
begin
 root_id:=athletics_class_lock(p_session_id);
 select * into s from athletics_class_sessions where id=root_id;
 if p_present is null or array_position(p_present,null) is not null then raise exception 'Invalid attendance';end if;
 if exists(select 1 from unnest(p_present) x(id) where not exists(select 1 from athletics_athletes a where a.id=x.id and a.tournament_id=s.tournament_id and a.active and (s.gender='All' or a.gender=s.gender) and (case when s.categories is not null then a.level=any(s.categories) else s.category='All' or a.level=s.category end))) then raise exception 'An athlete does not belong to the selected categories / gender';end if;
 -- Keep departed participants and all of their marks. Apply availability to every activity.
 update athletics_class_attendance att set available=false from athletics_class_sessions act where act.id=att.session_id and (act.id=root_id or act.parent_session_id=root_id);
 insert into athletics_class_attendance(session_id,athlete_id,present,available)
 select act.id,a.id,true,true from athletics_class_sessions act join athletics_athletes a on a.tournament_id=act.tournament_id
 where (act.id=root_id or act.parent_session_id=root_id) and a.id=any(p_present) and (act.gender='All' or act.gender=a.gender)
 on conflict(session_id,athlete_id) do update set present=true,available=true;
 update athletics_class_sessions set attendance_recorded=true where id=root_id or parent_session_id=root_id;
 return cardinality(p_present);
end $$;

create function public.athletics_add_class_activity(p_session_id uuid,p_event_id uuid,p_gender text,p_conditions text default '',p_timing text default 'unspecified',p_implement numeric default null)
returns public.athletics_class_sessions language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions; child athletics_class_sessions; root_id uuid;
begin
 root_id:=athletics_class_lock(p_session_id);select * into s from athletics_class_sessions where id=root_id;
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,source,category,categories,gender,conditions,parent_session_id,attendance_recorded,timing_method,implement_kg)
 values(s.tournament_id,p_event_id,s.title,s.session_date,s.source,s.category,s.categories,p_gender,p_conditions,s.id,s.attendance_recorded,p_timing,p_implement) returning * into child;
 insert into athletics_class_attendance(session_id,athlete_id,present,available)
 select child.id,att.athlete_id,att.present,att.available from athletics_class_attendance att join athletics_athletes a on a.id=att.athlete_id where att.session_id=root_id and (p_gender='All' or p_gender=a.gender);
 return child;
end $$;
revoke all on function public.athletics_add_class_activity(uuid,uuid,text,text,text,numeric) from public,anon;
grant execute on function public.athletics_add_class_activity(uuid,uuid,text,text,text,numeric) to authenticated;

-- Corrections are append-only. Only this private trigger may write the audit log.
create table public.athletics_class_mark_audit(
 id uuid primary key default gen_random_uuid(),mark_id uuid not null references public.athletics_class_marks(id),session_id uuid not null references public.athletics_class_sessions(id),
 athlete_id uuid not null references public.athletics_athletes(id),changed_at timestamptz not null default clock_timestamp(),changed_by uuid not null,actor_label text not null,
 before_value jsonb not null,after_value jsonb not null
);
create index class_mark_audit_session on public.athletics_class_mark_audit(session_id,changed_at);
create index class_mark_audit_mark on public.athletics_class_mark_audit(mark_id);
create index class_mark_audit_athlete on public.athletics_class_mark_audit(athlete_id);
alter table public.athletics_class_mark_audit enable row level security;
create policy class_mark_audit_read on public.athletics_class_mark_audit for select to authenticated using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)));
revoke all on public.athletics_class_mark_audit from public,anon,authenticated;
grant select on public.athletics_class_mark_audit to authenticated;
create schema if not exists fieldflow_private;
revoke all on schema fieldflow_private from public,anon,authenticated;
create function fieldflow_private.audit_class_mark() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.uid() is null or not exists(select 1 from public.athletics_class_sessions s where s.id=new.session_id and public.is_athletics_admin(s.tournament_id)) then raise exception 'Not authorized';end if;
 if row(old.mark,old.status,old.notes,old.timing_method,old.implement_kg,old.conditions) is distinct from row(new.mark,new.status,new.notes,new.timing_method,new.implement_kg,new.conditions) then
 insert into public.athletics_class_mark_audit(mark_id,session_id,athlete_id,changed_by,actor_label,before_value,after_value)
 values(new.id,new.session_id,new.athlete_id,auth.uid(),coalesce(auth.jwt()->>'email',auth.uid()::text),to_jsonb(old),to_jsonb(new));end if;
 return new;
end $$;
revoke all on function fieldflow_private.audit_class_mark() from public,anon,authenticated;
create trigger class_mark_audit after update on public.athletics_class_marks for each row execute function fieldflow_private.audit_class_mark();

create function public.athletics_class_write_guard() returns trigger language plpgsql security invoker set search_path=public as $$
begin perform athletics_class_lock(new.session_id);return new;end $$;
revoke all on function public.athletics_class_write_guard() from public,anon;
create trigger class_marks_open before insert or update on public.athletics_class_marks for each row execute function public.athletics_class_write_guard();
create trigger class_heats_open before insert or update on public.athletics_class_heats for each row execute function public.athletics_class_write_guard();

create or replace function public.athletics_save_class_marks(p_session_id uuid,p_attempt integer,p_marks jsonb)
returns setof public.athletics_class_marks language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions;
begin
 perform athletics_class_lock(p_session_id);
 select * into s from athletics_class_sessions where id=p_session_id;
 if auth.uid() is null or not exists(select 1 from athletics_class_sessions authorized where authorized.id=p_session_id and is_athletics_admin(authorized.tournament_id)) then
  raise exception 'Not authorized for this class session';
 end if;
 if jsonb_typeof(p_marks)<>'array' or jsonb_array_length(p_marks)=0 or jsonb_array_length(p_marks)>1000 then raise exception 'Provide between 1 and 1000 results'; end if;
 if exists(select 1 from jsonb_array_elements(p_marks) x where not exists(select 1 from athletics_athletes a where a.id=(x->>'athlete_id')::uuid)) then raise exception 'Unknown athlete'; end if;
 return query
 insert into athletics_class_marks(session_id,athlete_id,attempt_no,mark,status,category,gender,notes,timing_method,implement_kg,conditions)
 select p_session_id,a.id,p_attempt,(x->>'mark')::numeric,x->>'status',a.level,a.gender,coalesce(x->>'notes',''),coalesce(x->>'timing_method',previous.timing_method,s.timing_method),case when x ? 'implement_kg' then (x->>'implement_kg')::numeric else case when previous.id is not null then previous.implement_kg else s.implement_kg end end,coalesce(x->>'conditions',previous.conditions,s.conditions)
 from jsonb_array_elements(p_marks) x join athletics_athletes a on a.id=(x->>'athlete_id')::uuid
 left join athletics_class_marks previous on previous.session_id=p_session_id and previous.athlete_id=a.id and previous.attempt_no=p_attempt
 on conflict(session_id,athlete_id,attempt_no) do update set mark=excluded.mark,status=excluded.status,notes=excluded.notes,timing_method=excluded.timing_method,implement_kg=excluded.implement_kg,conditions=excluded.conditions
 returning *;
end $$;
revoke all on function public.athletics_save_class_marks(uuid,integer,jsonb) from public,anon;
grant execute on function public.athletics_save_class_marks(uuid,integer,jsonb) to authenticated;

drop function public.athletics_generate_class_heats(uuid,text,integer,integer);
create function public.athletics_generate_class_heats(p_session_id uuid,p_mode text default 'mixed',p_capacity integer default 8,p_heat_count integer default 0,p_athletes uuid[] default null)
returns setof public.athletics_class_heats language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions; r integer; g text; ids uuid[]; n integer; c integer; h uuid; j integer; k integer; heatno integer:=0;
begin
 perform athletics_class_lock(p_session_id);
 select * into s from athletics_class_sessions where id=p_session_id;
 if s.id is null or not is_athletics_admin(s.tournament_id) then raise exception 'Not authorized'; end if;
 if not s.attendance_recorded then raise exception 'Save attendance first'; end if;
 if not exists(select 1 from athletics_events where id=s.template_event_id and discipline='track') then raise exception 'Individual track events only'; end if;
 if p_mode is null or p_mode not in ('mixed','gender') or p_capacity is null or p_capacity<1 or p_capacity>1000 or p_heat_count is null or p_heat_count<0 then raise exception 'Invalid series settings'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session_id::text,0));
 select greatest(coalesce((select max(round_no) from athletics_class_heats where session_id=p_session_id),0),coalesce((select max(attempt_no) from athletics_class_marks where session_id=p_session_id),0))+1 into r;
 if p_athletes is not null and (cardinality(p_athletes)=0 or array_position(p_athletes,null) is not null or exists(select 1 from unnest(p_athletes) x(id) where not exists(select 1 from athletics_class_attendance att where att.session_id=p_session_id and att.athlete_id=x.id and att.present and att.available))) then raise exception 'Select available participants for this round';end if;
 for g in select unnest(case when p_mode='mixed' then array[s.gender] else case when s.gender='All' then array['F','M'] else array[s.gender] end end) loop
  select array_agg(a.id order by random()) into ids from athletics_class_attendance att join athletics_athletes a on a.id=att.athlete_id where att.session_id=p_session_id and att.present and att.available and a.active and (p_athletes is null or a.id=any(p_athletes)) and (g='All' or a.gender=g);
  n:=coalesce(cardinality(ids),0);if n=0 then continue;end if;
  c:=case when p_heat_count=0 then ceil(n::numeric/p_capacity)::integer else p_heat_count end;
  if c>n or c*p_capacity<n then raise exception 'Choose enough series for the capacity, without creating empty series'; end if;
  for j in 1..c loop
   heatno:=heatno+1;
   insert into athletics_class_heats(session_id,round_no,heat_number,gender) values(p_session_id,r,heatno,g) returning id into h;
   k:=0;
   for i in 1..n loop
    if (i-1)%c=j-1 then k:=k+1;insert into athletics_class_heat_entries(heat_id,session_id,round_no,athlete_id,lane) values(h,p_session_id,r,ids[i],k);end if;
   end loop;
  end loop;
 end loop;
 if heatno=0 then raise exception 'Select at least one present athlete'; end if;
 return query select * from athletics_class_heats where session_id=p_session_id and round_no=r order by heat_number;
end $$;
revoke all on function public.athletics_generate_class_heats(uuid,text,integer,integer,uuid[]) from public,anon;
grant execute on function public.athletics_generate_class_heats(uuid,text,integer,integer,uuid[]) to authenticated;

create or replace function public.athletics_save_class_heat(p_heat_id uuid,p_results jsonb,p_complete boolean default false)
returns setof public.athletics_class_series_sheet language plpgsql security invoker set search_path=public as $$
declare h athletics_class_heats; payload jsonb;
begin
 select * into h from athletics_class_heats where id=p_heat_id;
 if h.id is null or not exists(select 1 from athletics_class_sessions where id=h.session_id and is_athletics_admin(tournament_id)) then raise exception 'Not authorized'; end if;
 perform athletics_class_lock(h.session_id);
 if jsonb_typeof(p_results) is distinct from 'array' then raise exception 'Invalid results';end if;
 if exists(select 1 from jsonb_array_elements(p_results) r where not exists(select 1 from athletics_class_heat_entries x where x.id=(r->>'id')::uuid and x.heat_id=p_heat_id)) then raise exception 'Result does not belong to this class heat';end if;
 if jsonb_array_length(p_results)>0 then
  select jsonb_agg(jsonb_build_object('athlete_id',x.athlete_id,'mark',r->'official_time','status',case when r->>'status'='finished' then 'valid' else r->>'status' end,'notes',coalesce(r->>'notes','Class heat'),'timing_method',coalesce(r->>'timing_method','manual')))
  into payload from jsonb_array_elements(p_results) r join athletics_class_heat_entries x on x.id=(r->>'id')::uuid;
  perform athletics_save_class_marks(h.session_id,h.round_no,payload);
 end if;
 if p_complete and exists(select 1 from athletics_class_series_sheet where heat_id=p_heat_id and status='scheduled') then raise exception 'Enter a time or DNS / DNF / DQ for every runner before completing';end if;
 update athletics_class_heats set status=case when p_complete then 'completed' else 'scheduled' end where id=p_heat_id;
 return query select * from athletics_class_series_sheet where heat_id=p_heat_id order by lane;
end $$;
revoke all on function public.athletics_save_class_heat(uuid,jsonb,boolean) from public,anon;
grant execute on function public.athletics_save_class_heat(uuid,jsonb,boolean) to authenticated;


-- Entries can move only before either the source or target heat has saved results.
-- Deferrable lane uniqueness makes swaps atomic; IDs remain stable for Photo Finish.
alter table public.athletics_class_heat_entries drop constraint athletics_class_heat_entries_heat_id_lane_key;
alter table public.athletics_class_heat_entries add constraint class_heat_lane_unique unique(heat_id,lane) deferrable initially immediate;
grant update(heat_id,lane) on public.athletics_class_heat_entries to authenticated;
create function public.athletics_class_entry_guard() returns trigger language plpgsql security invoker set search_path=public as $$
declare h athletics_class_heats;
begin
 perform athletics_class_lock(new.session_id);
 if tg_op='UPDATE' then
  if exists(select 1 from athletics_class_heats where id in(old.heat_id,new.heat_id) and status='completed') or exists(select 1 from athletics_class_series_sheet where heat_id in(old.heat_id,new.heat_id) and status<>'scheduled') then raise exception 'A series with saved results cannot be rearranged';end if;
 end if;
 return new;
end $$;
revoke all on function public.athletics_class_entry_guard() from public,anon;
create trigger class_entry_guard before insert or update on public.athletics_class_heat_entries for each row execute function public.athletics_class_entry_guard();
create function public.athletics_edit_class_series(p_session_id uuid,p_round integer,p_entries jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare x jsonb; oldentry athletics_class_heat_entries; h athletics_class_heats;
begin
 perform athletics_class_lock(p_session_id);
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)=0 then raise exception 'Choose series assignments';end if;
 if (select count(*) from jsonb_array_elements(p_entries))<>(select count(distinct item->>'id') from jsonb_array_elements(p_entries) item) then raise exception 'Duplicate runner';end if;
 set constraints class_heat_lane_unique deferred;
 for x in select * from jsonb_array_elements(p_entries) loop
  select * into oldentry from athletics_class_heat_entries where id=(x->>'id')::uuid and session_id=p_session_id and round_no=p_round;
  select * into h from athletics_class_heats where id=(x->>'heat_id')::uuid and session_id=p_session_id and round_no=p_round;
  if oldentry.id is null or h.id is null then raise exception 'Series must belong to this round';end if;
  if oldentry.heat_id is distinct from h.id or oldentry.lane is distinct from (x->>'lane')::integer then
   update athletics_class_heat_entries set heat_id=h.id,lane=(x->>'lane')::integer where id=oldentry.id;
  end if;
 end loop;
 set constraints class_heat_lane_unique immediate;
end $$;
revoke all on function public.athletics_edit_class_series(uuid,integer,jsonb) from public,anon;
grant execute on function public.athletics_edit_class_series(uuid,integer,jsonb) to authenticated;

-- Named relay teams and ordered legs, independently configured for every attempt.
create table public.athletics_class_relay_teams(
 id uuid primary key default gen_random_uuid(),session_id uuid not null references public.athletics_class_sessions(id),attempt_no integer not null check(attempt_no>0),name text not null check(length(trim(name)) between 1 and 80),
 unique(session_id,attempt_no,name),unique(id,session_id,attempt_no)
);
create table public.athletics_class_relay_legs(
 team_id uuid not null,session_id uuid not null,attempt_no integer not null,athlete_id uuid not null references public.athletics_athletes(id),leg_order integer not null check(leg_order between 1 and 20),
 primary key(team_id,leg_order),unique(session_id,attempt_no,athlete_id),foreign key(team_id,session_id,attempt_no) references public.athletics_class_relay_teams(id,session_id,attempt_no)
);
create index class_relay_legs_athlete on public.athletics_class_relay_legs(athlete_id);
alter table public.athletics_class_relay_teams enable row level security;
alter table public.athletics_class_relay_legs enable row level security;
create policy class_relay_teams_admin on public.athletics_class_relay_teams for all to authenticated using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id))) with check(exists(select 1 from public.athletics_class_sessions s join public.athletics_events e on e.id=s.template_event_id where s.id=session_id and s.gender in ('M','F') and e.discipline='relay' and public.is_athletics_admin(s.tournament_id)));
create policy class_relay_legs_admin on public.athletics_class_relay_legs for all to authenticated using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id))) with check(exists(select 1 from public.athletics_class_sessions s join public.athletics_class_attendance att on att.session_id=s.id join public.athletics_athletes a on a.id=att.athlete_id where s.id=athletics_class_relay_legs.session_id and a.id=athletics_class_relay_legs.athlete_id and att.present and att.available and a.gender=s.gender and public.is_athletics_admin(s.tournament_id)));
revoke all on public.athletics_class_relay_teams,public.athletics_class_relay_legs from public,anon,authenticated;
grant select,insert,delete on public.athletics_class_relay_teams,public.athletics_class_relay_legs to authenticated;
create function public.athletics_class_relay_guard() returns trigger language plpgsql security invoker set search_path=public as $$
declare sid uuid; n integer;
begin
 if tg_op='DELETE' then sid:=old.session_id;n:=old.attempt_no;else sid:=new.session_id;n:=new.attempt_no;end if;
 perform athletics_class_lock(sid);
 if exists(select 1 from athletics_class_marks where session_id=sid and attempt_no=n) then raise exception 'Relay membership is locked after results; create a new attempt';end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
revoke all on function public.athletics_class_relay_guard() from public,anon;
create trigger class_relay_team_guard before insert or delete on public.athletics_class_relay_teams for each row execute function public.athletics_class_relay_guard();
create trigger class_relay_leg_guard before insert or delete on public.athletics_class_relay_legs for each row execute function public.athletics_class_relay_guard();
create function public.athletics_configure_class_relay(p_session_id uuid,p_attempt integer,p_teams jsonb) returns void language plpgsql security invoker set search_path=public as $$
declare t jsonb; member jsonb; team uuid; ordinal integer;
begin
 perform athletics_class_lock(p_session_id);
 if jsonb_typeof(p_teams) is distinct from 'array' or jsonb_array_length(p_teams)=0 then raise exception 'Create at least one team';end if;
 delete from athletics_class_relay_legs where session_id=p_session_id and attempt_no=p_attempt;
 delete from athletics_class_relay_teams where session_id=p_session_id and attempt_no=p_attempt;
 for t in select * from jsonb_array_elements(p_teams) loop
  if jsonb_typeof(t->'athletes') is distinct from 'array' or jsonb_array_length(t->'athletes') not between 1 and 20 then raise exception 'Each team needs 1–20 ordered runners';end if;
  insert into athletics_class_relay_teams(session_id,attempt_no,name) values(p_session_id,p_attempt,t->>'name') returning id into team;
  ordinal:=0;
  for member in select * from jsonb_array_elements(t->'athletes') loop
   ordinal:=ordinal+1;
   insert into athletics_class_relay_legs(team_id,session_id,attempt_no,athlete_id,leg_order) values(team,p_session_id,p_attempt,(member#>>'{}')::uuid,ordinal);
  end loop;
 end loop;
end $$;
revoke all on function public.athletics_configure_class_relay(uuid,integer,jsonb) from public,anon;
grant execute on function public.athletics_configure_class_relay(uuid,integer,jsonb) to authenticated;
create function public.athletics_save_class_relay(p_team_id uuid,p_mark numeric,p_status text,p_timing text default 'manual') returns setof public.athletics_class_marks language plpgsql security invoker set search_path=public as $$
declare t athletics_class_relay_teams; payload jsonb;
begin
 select * into t from athletics_class_relay_teams where id=p_team_id;
 perform athletics_class_lock(t.session_id);
 if p_status not in ('valid','dns','dnf','dq') then raise exception 'Invalid relay result';end if;
 select jsonb_agg(jsonb_build_object('athlete_id',athlete_id,'mark',p_mark,'status',p_status,'timing_method',p_timing,'notes','Relay '||t.name||' · Leg '||leg_order||' · Team time, not an individual split') order by leg_order) into payload from athletics_class_relay_legs where team_id=t.id;
 return query select * from athletics_save_class_marks(t.session_id,t.attempt_no,payload);
end $$;
revoke all on function public.athletics_save_class_relay(uuid,numeric,text,text) from public,anon;
grant execute on function public.athletics_save_class_relay(uuid,numeric,text,text) to authenticated;
create or replace view public.athletics_craighouse_history with(security_invoker=true) as select * from (
 select 'class:'||m.id as record_id,m.athlete_id,s.tournament_id,e.name as event_name,e.discipline,
 case when e.discipline in ('track','relay') then 's' else 'm' end as unit,
 m.category,m.gender,s.session_date as performance_date,m.created_at as recorded_at,
 s.source,s.title||case when e.discipline='relay' then ' · Team time (not individual split)' else '' end as source_label,m.attempt_no,m.mark,m.status,concat_ws(' · ',nullif(m.conditions,''),case when m.timing_method<>'not_applicable' then 'Timing: '||m.timing_method end,case when m.implement_kg is not null then 'Implement: '||m.implement_kg||' kg' end) as conditions,m.notes
 from public.athletics_class_marks m join public.athletics_class_sessions s on s.id=m.session_id
 join public.athletics_events e on e.id=s.template_event_id
 union all
 select 'track:'||x.id,r.athlete_id,x.tournament_id,e.name,e.discipline,'s',e.category,a.gender,
 (coalesce(h.scheduled_at,x.created_at) at time zone 'America/Santiago')::date,x.created_at,
 'official',t.name||' · '||h.stage||' '||h.heat_number,1,x.official_time,
 case when x.status='finished' then 'valid' else x.status end,'',''
 from public.athletics_track_entries x join public.athletics_track_heats h on h.id=x.heat_id
 join public.athletics_registrations r on r.id=x.registration_id join public.athletics_athletes a on a.id=r.athlete_id
 join public.athletics_events e on e.id=h.event_id join public.tournaments t on t.id=x.tournament_id
 where t.slug='intercolour-athletics-2026' and x.status<>'scheduled'
 union all
 select 'field:'||x.id,r.athlete_id,x.tournament_id,e.name,e.discipline,'m',e.category,a.gender,
 (x.created_at at time zone 'America/Santiago')::date,x.created_at,'official',t.name,x.attempt_no,x.mark_m,x.status,'',coalesce(x.notes,'')
 from public.athletics_field_attempts x join public.athletics_registrations r on r.id=x.registration_id
 join public.athletics_athletes a on a.id=r.athlete_id join public.athletics_events e on e.id=x.event_id
 join public.tournaments t on t.id=x.tournament_id where t.slug='intercolour-athletics-2026' and x.status<>'pending'
 union all
 select 'high:'||x.id,r.athlete_id,x.tournament_id,e.name,e.discipline,'m',e.category,a.gender,
 (x.created_at at time zone 'America/Santiago')::date,x.created_at,'official',t.name,x.attempt_no,
 case when x.result='clear' then h.height_m else null end,
 case when x.result='clear' then 'valid' when x.result='miss' then 'foul' else x.result end,'','Height: '||h.height_m||' m'
 from public.athletics_high_jump_attempts x join public.athletics_high_jump_heights h on h.id=x.height_id
 join public.athletics_registrations r on r.id=x.registration_id join public.athletics_athletes a on a.id=r.athlete_id
 join public.athletics_events e on e.id=x.event_id join public.tournaments t on t.id=x.tournament_id
 where t.slug='intercolour-athletics-2026'
 union all
 select 'relay:'||x.id||':'||a.id,a.id,x.tournament_id,e.name,'relay','s',e.category,a.gender,
 (x.created_at at time zone 'America/Santiago')::date,x.created_at,'official',t.name||' · Team time',1,x.official_time,
 case when x.status='finished' then 'valid' else x.status end,'','Team result, not an individual split'
 from public.athletics_relay_results x join public.athletics_relay_members rm on rm.relay_team_id=x.relay_team_id
 join public.athletics_athletes a on a.id=rm.athlete_id join public.athletics_events e on e.id=x.event_id
 join public.tournaments t on t.id=x.tournament_id where t.slug='intercolour-athletics-2026' and x.status<>'scheduled'
) history where public.is_athletics_admin(history.tournament_id);
revoke all on public.athletics_craighouse_history from anon,authenticated;
grant select on public.athletics_craighouse_history to authenticated;
