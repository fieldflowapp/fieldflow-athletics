-- Independent attendance for each activity. Existing attendance and marks are not changed.
create or replace function public.athletics_save_class_attendance(p_session_id uuid,p_present uuid[]) returns integer language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions; root_id uuid;
begin
 root_id:=athletics_class_lock(p_session_id);
 select * into s from athletics_class_sessions where id=p_session_id;
 if p_present is null or array_position(p_present,null) is not null then raise exception 'Invalid attendance';end if;
 if exists(select 1 from unnest(p_present) x(id) where not exists(select 1 from athletics_athletes a where a.id=x.id and a.tournament_id=s.tournament_id and a.active and (s.gender='All' or a.gender=s.gender) and (case when s.categories is not null then a.level=any(s.categories) else s.category='All' or a.level=s.category end))) then raise exception 'An athlete does not belong to the selected categories / gender';end if;
 -- Attendance belongs to this activity only. Preserve historical attendance and results.
 update athletics_class_attendance set available=false where session_id=p_session_id;
 insert into athletics_class_attendance(session_id,athlete_id,present,available)
 select act.id,a.id,true,true from athletics_class_sessions act join athletics_athletes a on a.tournament_id=act.tournament_id
 where act.id=p_session_id and a.id=any(p_present) and (act.gender='All' or act.gender=a.gender)
 on conflict(session_id,athlete_id) do update set present=true,available=true;
 update athletics_class_sessions set attendance_recorded=true where id=p_session_id;
 return cardinality(p_present);
end $$;

create or replace function public.athletics_add_class_activity(p_session_id uuid,p_event_id uuid,p_gender text,p_conditions text default '',p_timing text default 'unspecified',p_implement numeric default null)
returns public.athletics_class_sessions language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions; child athletics_class_sessions; root_id uuid;
begin
 root_id:=athletics_class_lock(p_session_id);select * into s from athletics_class_sessions where id=root_id;
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,source,category,categories,gender,conditions,parent_session_id,attendance_recorded,timing_method,implement_kg)
 values(s.tournament_id,p_event_id,s.title,s.session_date,s.source,s.category,s.categories,p_gender,p_conditions,s.id,false,p_timing,p_implement) returning * into child;
 return child;
end $$;
revoke all on function public.athletics_add_class_activity(uuid,uuid,text,text,text,numeric) from public,anon;
grant execute on function public.athletics_add_class_activity(uuid,uuid,text,text,text,numeric) to authenticated;

