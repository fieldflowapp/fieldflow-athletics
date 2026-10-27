-- Additive Craighouse-only module. Official competition tables are read, never rewritten.
create table public.athletics_class_sessions (
 id uuid primary key default gen_random_uuid(),
 tournament_id uuid not null references public.tournaments(id),
 template_event_id uuid not null references public.athletics_events(id),
 title text not null check(length(trim(title)) between 1 and 160),
 session_date date not null,
 source text not null default 'class' check(source in ('class','training','external')),
 category text not null default 'All',
 gender text not null default 'All' check(gender in ('All','F','M')),
 conditions text not null default '' check(length(conditions)<=500),
 created_by uuid not null default auth.uid() references auth.users(id),
 created_at timestamptz not null default now()
);
create index athletics_class_sessions_tournament_date on public.athletics_class_sessions(tournament_id,session_date desc);
create index athletics_class_sessions_event on public.athletics_class_sessions(template_event_id);
create index athletics_class_sessions_creator on public.athletics_class_sessions(created_by);
alter table public.athletics_class_sessions enable row level security;
create policy class_sessions_read on public.athletics_class_sessions for select to authenticated
 using(public.is_athletics_admin(tournament_id));
create policy class_sessions_insert on public.athletics_class_sessions for insert to authenticated
 with check(created_by=(select auth.uid()) and public.is_athletics_admin(tournament_id)
 and exists(select 1 from public.tournaments t where t.id=tournament_id and t.slug='intercolour-athletics-2026')
 and exists(select 1 from public.athletics_events e where e.id=template_event_id and e.tournament_id=athletics_class_sessions.tournament_id and e.discipline in ('track','field')));

create table public.athletics_class_marks (
 id uuid primary key default gen_random_uuid(),
 session_id uuid not null references public.athletics_class_sessions(id),
 athlete_id uuid not null references public.athletics_athletes(id),
 attempt_no integer not null check(attempt_no>0),
 mark numeric check(mark>0 and mark<1000000),
 status text not null check(status in ('valid','foul','dns','dnf','dq','pass')),
 category text not null,
 gender text not null check(gender in ('M','F')),
 notes text not null default '' check(length(notes)<=500),
 created_at timestamptz not null default now(),
 unique(session_id,athlete_id,attempt_no),
 check((status='valid' and mark is not null) or (status<>'valid' and mark is null))
);
create index athletics_class_marks_athlete on public.athletics_class_marks(athlete_id,created_at);
alter table public.athletics_class_marks enable row level security;
create policy class_marks_read on public.athletics_class_marks for select to authenticated
 using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)));
create policy class_marks_insert on public.athletics_class_marks for insert to authenticated
 with check(exists(select 1 from public.athletics_class_sessions s join public.athletics_athletes a on a.tournament_id=s.tournament_id
 where s.id=session_id and a.id=athlete_id and a.active and public.is_athletics_admin(s.tournament_id)
 and (s.gender='All' or s.gender=a.gender) and (s.category='All' or s.category=a.level)
 and athletics_class_marks.category=a.level and athletics_class_marks.gender=a.gender));
create policy class_marks_update on public.athletics_class_marks for update to authenticated
 using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)))
 with check(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)));
revoke all on public.athletics_class_sessions,public.athletics_class_marks from anon,authenticated;
grant select,insert on public.athletics_class_sessions,public.athletics_class_marks to authenticated;
grant update(mark,status,notes) on public.athletics_class_marks to authenticated;

create function public.athletics_save_class_marks(p_session_id uuid,p_attempt integer,p_marks jsonb)
returns setof public.athletics_class_marks language plpgsql security invoker set search_path=public as $$
begin
 if auth.uid() is null or not exists(select 1 from athletics_class_sessions s where s.id=p_session_id and is_athletics_admin(s.tournament_id)) then
  raise exception 'Not authorized for this class session';
 end if;
 if jsonb_typeof(p_marks)<>'array' or jsonb_array_length(p_marks)=0 or jsonb_array_length(p_marks)>1000 then raise exception 'Provide between 1 and 1000 results'; end if;
 if exists(select 1 from jsonb_array_elements(p_marks) x where not exists(select 1 from athletics_athletes a where a.id=(x->>'athlete_id')::uuid)) then raise exception 'Unknown athlete'; end if;
 return query
 insert into athletics_class_marks(session_id,athlete_id,attempt_no,mark,status,category,gender,notes)
 select p_session_id,a.id,p_attempt,(x->>'mark')::numeric,x->>'status',a.level,a.gender,coalesce(x->>'notes','')
 from jsonb_array_elements(p_marks) x join athletics_athletes a on a.id=(x->>'athlete_id')::uuid
 on conflict(session_id,athlete_id,attempt_no) do update set mark=excluded.mark,status=excluded.status,notes=excluded.notes
 returning *;
end $$;
revoke all on function public.athletics_save_class_marks(uuid,integer,jsonb) from public,anon;
grant execute on function public.athletics_save_class_marks(uuid,integer,jsonb) to authenticated;

-- A live union retains the source record identity: official edits appear immediately,
-- reloading does not import copies, and class marks never reach points/scoreboard views.
create view public.athletics_craighouse_history with(security_invoker=true) as select * from (
 select 'class:'||m.id as record_id,m.athlete_id,s.tournament_id,e.name as event_name,e.discipline,
 case when e.discipline='track' then 's' else 'm' end as unit,
 m.category,m.gender,s.session_date as performance_date,m.created_at as recorded_at,
 s.source,s.title as source_label,m.attempt_no,m.mark,m.status,s.conditions,m.notes
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
