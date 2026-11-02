create or replace function public.athletics_create_class_round(p_session_id uuid,p_lanes integer[],p_mode text default 'mixed',p_athletes uuid[] default null)
returns setof public.athletics_class_heats language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions;lanes integer[];ids uuid[];g text;r integer;size integer;offset_no integer;h uuid;heatno integer:=0;
begin
 perform athletics_class_lock(p_session_id);select * into s from athletics_class_sessions where id=p_session_id;
 lanes:=athletics_class_lane_list(p_lanes);
 if not s.attendance_recorded then raise exception 'Save attendance first';end if;
 if not exists(select 1 from athletics_events where id=s.template_event_id and discipline='track') then raise exception 'Individual track events only';end if;
 if p_mode is null or p_mode not in ('mixed','gender') then raise exception 'Choose mixed or separate Male / Female';end if;
 if p_athletes is null or cardinality(p_athletes)=0 or array_position(p_athletes,null) is not null or cardinality(p_athletes)<>(select count(distinct x) from unnest(p_athletes) x) or exists(select 1 from unnest(p_athletes) x where not exists(select 1 from athletics_class_attendance att join athletics_athletes a on a.id=att.athlete_id where att.session_id=p_session_id and att.athlete_id=x and att.present and att.available and a.active)) then raise exception 'Select available participants for this round';end if;
 r:=greatest(coalesce((select max(round_no) from athletics_class_heats where session_id=p_session_id),0),coalesce((select max(attempt_no) from athletics_class_marks where session_id=p_session_id),0),coalesce((select max(round_no) from athletics_class_round_settings where session_id=p_session_id),0))+1;
 insert into athletics_class_round_settings values(p_session_id,r,'track',p_mode,lanes);
 for g in select unnest(case when s.gender<>'All' then array[s.gender] when p_mode='mixed' then array['All'] else array['F','M'] end) loop
  select array_agg(a.id order by previous.heat_number nulls last,previous.lane nulls last,a.last_name,a.first_name,a.id) into ids
  from athletics_athletes a left join lateral(select h.heat_number,e.lane from athletics_class_heat_entries e join athletics_class_heats h on h.id=e.heat_id where e.session_id=p_session_id and e.athlete_id=a.id order by e.round_no desc limit 1) previous on true
  where a.id=any(p_athletes) and (g='All' or a.gender=g);
  offset_no:=0;
  while offset_no < coalesce(cardinality(ids),0) loop
   size:=least(cardinality(lanes),cardinality(ids)-offset_no);
   heatno:=heatno+1;insert into athletics_class_heats(session_id,round_no,heat_number,gender) values(p_session_id,r,heatno,g) returning id into h;
   for i in 1..size loop insert into athletics_class_heat_entries(heat_id,session_id,round_no,athlete_id,lane) values(h,p_session_id,r,ids[offset_no+i],lanes[i]);end loop;
   offset_no:=offset_no+size;
  end loop;
 end loop;
 return query select * from athletics_class_heats where session_id=p_session_id and round_no=r order by heat_number;
end $$;
