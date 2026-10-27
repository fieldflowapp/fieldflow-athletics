-- Additive update: multiple categories, attendance, class heats and Photo Finish.
alter table public.athletics_class_sessions add column categories text[];
alter table public.athletics_class_sessions add column attendance_recorded boolean not null default false;
alter table public.athletics_class_sessions add constraint class_categories_nonempty check(categories is null or (cardinality(categories)>0 and array_position(categories,null) is null));
alter policy class_sessions_insert on public.athletics_class_sessions with check(
 created_by=(select auth.uid()) and public.is_athletics_admin(tournament_id)
 and exists(select 1 from public.tournaments t where t.id=tournament_id and t.slug='intercolour-athletics-2026')
 and exists(select 1 from public.athletics_events e where e.id=template_event_id and e.tournament_id=athletics_class_sessions.tournament_id
 and (e.discipline in ('track','field') or (e.discipline='relay' and athletics_class_sessions.gender in ('M','F')))));
create policy class_sessions_attendance_update on public.athletics_class_sessions for update to authenticated using(public.is_athletics_admin(tournament_id)) with check(public.is_athletics_admin(tournament_id));
grant update(attendance_recorded) on public.athletics_class_sessions to authenticated;

create table public.athletics_class_attendance(
 session_id uuid not null references public.athletics_class_sessions(id),
 athlete_id uuid not null references public.athletics_athletes(id),
 present boolean not null default false,
 primary key(session_id,athlete_id)
);
create index class_attendance_athlete on public.athletics_class_attendance(athlete_id);
alter table public.athletics_class_attendance enable row level security;
create policy class_attendance_read on public.athletics_class_attendance for select to authenticated using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)));
create policy class_attendance_write on public.athletics_class_attendance for all to authenticated
 using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)))
 with check(exists(select 1 from public.athletics_class_sessions s join public.athletics_athletes a on a.tournament_id=s.tournament_id where s.id=session_id and a.id=athlete_id and public.is_athletics_admin(s.tournament_id)
 and (not athletics_class_attendance.present or (a.active and (s.gender='All' or s.gender=a.gender) and (case when s.categories is not null then a.level=any(s.categories) else s.category='All' or s.category=a.level end)))));
revoke all on public.athletics_class_attendance from anon,authenticated;
grant select,insert on public.athletics_class_attendance to authenticated;
grant update(present) on public.athletics_class_attendance to authenticated;

create table public.athletics_class_heats(
 id uuid primary key default gen_random_uuid(),session_id uuid not null references public.athletics_class_sessions(id),
 round_no integer not null check(round_no>0),heat_number integer not null check(heat_number>0),
 gender text not null check(gender in ('All','M','F')),status text not null default 'scheduled' check(status in ('scheduled','completed')),
 unique(session_id,round_no,heat_number),unique(id,session_id,round_no)
);
create table public.athletics_class_heat_entries(
 id uuid primary key default gen_random_uuid(),heat_id uuid not null,session_id uuid not null,round_no integer not null,
 athlete_id uuid not null references public.athletics_athletes(id),lane integer not null check(lane>0),
 foreign key(heat_id,session_id,round_no) references public.athletics_class_heats(id,session_id,round_no),
 unique(session_id,round_no,athlete_id),unique(heat_id,lane)
);
create index class_heat_entries_athlete on public.athletics_class_heat_entries(athlete_id);
alter table public.athletics_class_heats enable row level security;
alter table public.athletics_class_heat_entries enable row level security;
create policy class_heats_admin on public.athletics_class_heats for all to authenticated
 using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)))
 with check(exists(select 1 from public.athletics_class_sessions s join public.athletics_events e on e.id=s.template_event_id where s.id=session_id and e.discipline='track' and public.is_athletics_admin(s.tournament_id) and (s.gender='All' or s.gender=athletics_class_heats.gender)));
create policy class_heat_entries_admin on public.athletics_class_heat_entries for all to authenticated
 using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)))
 with check(exists(select 1 from public.athletics_class_sessions s join public.athletics_class_heats h on h.session_id=s.id join public.athletics_class_attendance att on att.session_id=s.id join public.athletics_athletes a on a.id=att.athlete_id
 where s.id=athletics_class_heat_entries.session_id and h.id=heat_id and att.athlete_id=athletics_class_heat_entries.athlete_id and att.present and (h.gender='All' or h.gender=a.gender) and public.is_athletics_admin(s.tournament_id)));
revoke all on public.athletics_class_heats,public.athletics_class_heat_entries from anon,authenticated;
grant select,insert on public.athletics_class_heats,public.athletics_class_heat_entries to authenticated;
grant update(status) on public.athletics_class_heats to authenticated;

-- Attendance cannot remove an athlete who already has a result or a scheduled heat.
create function public.athletics_class_attendance_guard() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(new.session_id::text,0));
 if not new.present and (exists(select 1 from athletics_class_marks where session_id=new.session_id and athlete_id=new.athlete_id)
 or exists(select 1 from athletics_class_heat_entries where session_id=new.session_id and athlete_id=new.athlete_id)) then
 raise exception 'An athlete with saved results or generated heats must remain present in this session'; end if;
 return new;
end $$;
revoke all on function public.athletics_class_attendance_guard() from public,anon;
create trigger class_attendance_protect_results before insert or update on public.athletics_class_attendance for each row execute function public.athletics_class_attendance_guard();

create function public.athletics_save_class_attendance(p_session_id uuid,p_present uuid[]) returns integer language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions; n integer;
begin
 select * into s from athletics_class_sessions where id=p_session_id;
 if s.id is null or not is_athletics_admin(s.tournament_id) then raise exception 'Not authorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session_id::text,0));
 if p_present is null or array_position(p_present,null) is not null then raise exception 'Invalid attendance'; end if;
 if exists(select 1 from unnest(p_present) selected(athlete_id) where not exists(select 1 from athletics_athletes a where a.id=selected.athlete_id and a.tournament_id=s.tournament_id and a.active and (s.gender='All' or a.gender=s.gender) and (case when s.categories is not null then a.level=any(s.categories) else s.category='All' or a.level=s.category end))) then raise exception 'An athlete does not belong to the selected categories / gender'; end if;
 update athletics_class_attendance set present=false where session_id=p_session_id and present and not athlete_id=any(p_present);
 insert into athletics_class_attendance(session_id,athlete_id,present)
 select p_session_id,a.id,a.id=any(p_present) from athletics_athletes a where a.tournament_id=s.tournament_id and a.active and (s.gender='All' or a.gender=s.gender) and (case when s.categories is not null then a.level=any(s.categories) else s.category='All' or a.level=s.category end)
 on conflict(session_id,athlete_id) do update set present=excluded.present;
 update athletics_class_sessions set attendance_recorded=true where id=p_session_id;
 select count(*) into n from athletics_class_attendance where session_id=p_session_id and present;return n;
end $$;
revoke all on function public.athletics_save_class_attendance(uuid,uuid[]) from public,anon;
grant execute on function public.athletics_save_class_attendance(uuid,uuid[]) to authenticated;

-- Qualify outer identifiers to keep the policy correlated to the actual mark.
alter policy class_marks_insert on public.athletics_class_marks with check(exists(
 select 1 from public.athletics_class_sessions s join public.athletics_athletes a on a.tournament_id=s.tournament_id
 join public.athletics_class_attendance att on att.session_id=s.id and att.athlete_id=a.id and att.present
 where s.id=athletics_class_marks.session_id and a.id=athletics_class_marks.athlete_id and s.attendance_recorded and a.active and public.is_athletics_admin(s.tournament_id)
 and (s.gender='All' or s.gender=a.gender) and (case when s.categories is not null then a.level=any(s.categories) else s.category='All' or s.category=a.level end)
 and athletics_class_marks.category=a.level and athletics_class_marks.gender=a.gender));

create function public.athletics_generate_class_heats(p_session_id uuid,p_mode text default 'mixed',p_capacity integer default 8,p_heat_count integer default 0)
returns setof public.athletics_class_heats language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions; r integer; g text; ids uuid[]; n integer; c integer; h uuid; j integer; k integer; heatno integer:=0;
begin
 select * into s from athletics_class_sessions where id=p_session_id;
 if s.id is null or not is_athletics_admin(s.tournament_id) then raise exception 'Not authorized'; end if;
 if not s.attendance_recorded then raise exception 'Save attendance first'; end if;
 if not exists(select 1 from athletics_events where id=s.template_event_id and discipline='track') then raise exception 'Individual track events only'; end if;
 if p_mode is null or p_mode not in ('mixed','gender') or p_capacity is null or p_capacity<1 or p_capacity>1000 or p_heat_count is null or p_heat_count<0 then raise exception 'Invalid series settings'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_session_id::text,0));
 select greatest(coalesce((select max(round_no) from athletics_class_heats where session_id=p_session_id),0),coalesce((select max(attempt_no) from athletics_class_marks where session_id=p_session_id),0))+1 into r;
 for g in select unnest(case when p_mode='mixed' then array[s.gender] else case when s.gender='All' then array['F','M'] else array[s.gender] end end) loop
  select array_agg(a.id order by random()) into ids from athletics_class_attendance att join athletics_athletes a on a.id=att.athlete_id where att.session_id=p_session_id and att.present and (g='All' or a.gender=g);
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
revoke all on function public.athletics_generate_class_heats(uuid,text,integer,integer) from public,anon;
grant execute on function public.athletics_generate_class_heats(uuid,text,integer,integer) to authenticated;

create view public.athletics_class_series_sheet with(security_invoker=true) as
 select x.id,x.heat_id,x.session_id,x.round_no,x.athlete_id,x.lane,a.first_name,a.last_name,a.gender,a.level,a.color,
 m.mark as official_time,case when m.status='valid' then 'finished' else coalesce(m.status,'scheduled') end as status,coalesce(m.notes,'') as notes
 from public.athletics_class_heat_entries x join public.athletics_athletes a on a.id=x.athlete_id
 left join public.athletics_class_marks m on m.session_id=x.session_id and m.athlete_id=x.athlete_id and m.attempt_no=x.round_no;
revoke all on public.athletics_class_series_sheet from anon,authenticated;
grant select on public.athletics_class_series_sheet to authenticated;

create function public.athletics_save_class_heat(p_heat_id uuid,p_results jsonb,p_complete boolean default false)
returns setof public.athletics_class_series_sheet language plpgsql security invoker set search_path=public as $$
declare h athletics_class_heats; payload jsonb;
begin
 select * into h from athletics_class_heats where id=p_heat_id;
 if h.id is null or not exists(select 1 from athletics_class_sessions where id=h.session_id and is_athletics_admin(tournament_id)) then raise exception 'Not authorized'; end if;
 perform pg_advisory_xact_lock(hashtextextended(h.session_id::text,0));
 if jsonb_typeof(p_results) is distinct from 'array' then raise exception 'Invalid results';end if;
 if exists(select 1 from jsonb_array_elements(p_results) r where not exists(select 1 from athletics_class_heat_entries x where x.id=(r->>'id')::uuid and x.heat_id=p_heat_id)) then raise exception 'Result does not belong to this class heat';end if;
 if jsonb_array_length(p_results)>0 then
  select jsonb_agg(jsonb_build_object('athlete_id',x.athlete_id,'mark',r->'official_time','status',case when r->>'status'='finished' then 'valid' else r->>'status' end,'notes',coalesce(r->>'notes','Photo Finish / class heat')))
  into payload from jsonb_array_elements(p_results) r join athletics_class_heat_entries x on x.id=(r->>'id')::uuid;
  perform athletics_save_class_marks(h.session_id,h.round_no,payload);
 end if;
 if p_complete and exists(select 1 from athletics_class_series_sheet where heat_id=p_heat_id and status='scheduled') then raise exception 'Enter a time or DNS / DNF / DQ for every runner before completing';end if;
 update athletics_class_heats set status=case when p_complete then 'completed' else 'scheduled' end where id=p_heat_id;
 return query select * from athletics_class_series_sheet where heat_id=p_heat_id order by lane;
end $$;
revoke all on function public.athletics_save_class_heat(uuid,jsonb,boolean) from public,anon;
grant execute on function public.athletics_save_class_heat(uuid,jsonb,boolean) to authenticated;

-- Keep already recorded class athletes present; no marks are changed.
insert into public.athletics_class_attendance(session_id,athlete_id,present) select distinct session_id,athlete_id,true from public.athletics_class_marks on conflict do nothing;
update public.athletics_class_sessions s set attendance_recorded=true where exists(select 1 from public.athletics_class_attendance a where a.session_id=s.id and a.present);

create or replace view public.athletics_craighouse_history with(security_invoker=true) as select * from (
 select 'class:'||m.id as record_id,m.athlete_id,s.tournament_id,e.name as event_name,e.discipline,
 case when e.discipline in ('track','relay') then 's' else 'm' end as unit,
 m.category,m.gender,s.session_date as performance_date,m.created_at as recorded_at,
 s.source,s.title||case when e.discipline='relay' then ' · Team time (not individual split)' else '' end as source_label,m.attempt_no,m.mark,m.status,s.conditions,m.notes
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
