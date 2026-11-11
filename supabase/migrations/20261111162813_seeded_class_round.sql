alter table public.athletics_class_round_settings
 add column stage text check (stage in ('second','final'));

create function public.athletics_seed_class_round(
 p_session_id uuid, p_source_round integer, p_stage text, p_lanes integer[], p_entries jsonb
) returns setof public.athletics_class_heats
language plpgsql security invoker set search_path=public as $$
declare
 s athletics_class_sessions;
 lanes integer[];
 next_round integer;
 entry_count integer;
 series_count integer;
 series_no integer;
 heat uuid;
begin
 perform athletics_class_lock(p_session_id);
 select * into strict s from athletics_class_sessions where id=p_session_id;
 if not s.attendance_recorded or athletics_class_open_event(s.template_event_id)
    or not exists(select 1 from athletics_events where id=s.template_event_id and discipline='track') then
  raise exception 'Seeded rounds require an individual track event with lanes and saved attendance';
 end if;
 select max(round_no) into next_round from athletics_class_heats where session_id=p_session_id;
 if next_round is null or next_round is distinct from p_source_round or exists(
  select 1 from athletics_class_round_settings where session_id=p_session_id and round_no=p_source_round and stage='final'
 ) or exists(
  select 1 from athletics_class_heats where session_id=p_session_id
   and round_no=p_source_round and status<>'completed'
 ) then raise exception 'Finish the latest round and refresh before creating the next one'; end if;

 lanes:=athletics_class_lane_list(p_lanes);
 if p_stage is null or p_stage not in ('second','final') or jsonb_typeof(p_entries) is distinct from 'array' then
  raise exception 'Choose a round type and confirm the series';
 end if;
 entry_count:=jsonb_array_length(p_entries);
 series_count:=case when p_stage='final' then 1 else (entry_count+cardinality(lanes)-1)/cardinality(lanes) end;
 if entry_count=0 or (p_stage='final' and entry_count>cardinality(lanes)) or exists(
  select 1 from jsonb_to_recordset(p_entries) e(athlete_id uuid, series integer, lane integer, time numeric)
  where e.series is null or e.series not between 1 and series_count or e.lane is null or not (e.lane=any(lanes))
    or not exists(select 1 from athletics_class_series_sheet prior
      join athletics_class_attendance att on att.session_id=prior.session_id and att.athlete_id=prior.athlete_id
      join athletics_athletes a on a.id=prior.athlete_id
      where prior.session_id=p_session_id and prior.round_no=p_source_round and prior.athlete_id=e.athlete_id
      and prior.status='finished' and e.time>0 and prior.official_time=e.time and att.present and att.available and a.active)
 ) or exists(
  select 1 from jsonb_to_recordset(p_entries) e(athlete_id uuid, series integer, lane integer)
  group by e.athlete_id having count(*)>1
 ) or exists(
  select 1 from jsonb_to_recordset(p_entries) e(series integer, lane integer)
  group by e.series,e.lane having count(*)>1
 ) or series_count<>(select count(distinct series) from jsonb_to_recordset(p_entries) e(series integer))
 then raise exception 'The selected entries are invalid or the results changed. Refresh and review the series'; end if;

 next_round:=greatest(next_round,
  coalesce((select max(attempt_no) from athletics_class_marks where session_id=p_session_id),0),
  coalesce((select max(round_no) from athletics_class_round_settings where session_id=p_session_id),0))+1;
 insert into athletics_class_round_settings(session_id,round_no,kind,mode,lanes,start_mode,stage)
 values(p_session_id,next_round,'track','mixed',lanes,'lanes',p_stage);
 for series_no in 1..series_count loop
  insert into athletics_class_heats(session_id,round_no,heat_number,gender)
  values(p_session_id,next_round,series_no,s.gender) returning id into heat;
  insert into athletics_class_heat_entries(heat_id,session_id,round_no,athlete_id,lane)
  select heat,p_session_id,next_round,e.athlete_id,e.lane
  from jsonb_to_recordset(p_entries) e(athlete_id uuid, series integer, lane integer)
  where e.series=series_no;
 end loop;
 return query select * from athletics_class_heats where session_id=p_session_id and round_no=next_round order by heat_number;
end $$;

revoke execute on function public.athletics_seed_class_round(uuid,integer,text,integer[],jsonb) from public, anon;
grant execute on function public.athletics_seed_class_round(uuid,integer,text,integer[],jsonb) to authenticated;

create or replace function public.athletics_save_class_roster_and_series(p_session_id uuid,p_present uuid[]) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare newcomers uuid[];n integer;result jsonb;latest_stage text;
begin
 perform athletics_class_lock(p_session_id);
 select array_agg(x) into newcomers from unnest(p_present) x where not exists(
  select 1 from athletics_class_attendance att
   where att.session_id=p_session_id and att.athlete_id=x and att.present and att.available);
 n:=athletics_save_class_attendance(p_session_id,p_present);
 select stage into latest_stage from athletics_class_round_settings
  where session_id=p_session_id and kind='track' order by round_no desc limit 1;
 if latest_stage is null then
  result:=athletics_append_class_runners(p_session_id,coalesce(newcomers,'{}'));
 else
  result:=jsonb_build_object('added',0,'deferred',coalesce(cardinality(newcomers),0),'singletons',0);
 end if;
 return result||jsonb_build_object('available',n);
end $$;

notify pgrst,'reload schema';
