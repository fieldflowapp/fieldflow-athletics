-- 800 m open starts: no physical lanes, no limit of eight. Historical rounds/results stay intact.
create function public.athletics_class_open_event(p_event_id uuid) returns boolean
language sql stable security invoker set search_path=public as $$
 select exists(select 1 from athletics_events where id=p_event_id and discipline='track' and (upper(code)='800M' or name ~* '^800[[:space:]]*(m|metres|metros)([[:space:]]|$)'));
$$;
revoke all on function public.athletics_class_open_event(uuid) from public,anon;
grant execute on function public.athletics_class_open_event(uuid) to authenticated;
alter table public.athletics_class_round_settings add column start_mode text not null default 'lanes' check(start_mode in ('lanes','mass_start'));
alter table public.athletics_class_heat_entries alter column lane drop not null;
CREATE OR REPLACE FUNCTION public.athletics_class_round_guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
begin
 perform athletics_class_lock(new.session_id);
 if new.start_mode='mass_start' and (new.kind<>'track' or not exists(select 1 from athletics_class_sessions s where s.id=new.session_id and athletics_class_open_event(s.template_event_id))) then raise exception 'Open starts are for 800 m';end if;
 if tg_op='UPDATE' and row(new.session_id,new.round_no,new.kind,new.mode,new.lanes,new.start_mode) is distinct from row(old.session_id,old.round_no,old.kind,old.mode,old.lanes,old.start_mode) and (new.session_id<>old.session_id or new.round_no<>old.round_no or new.kind<>old.kind or exists(select 1 from athletics_class_marks where session_id=old.session_id and attempt_no=old.round_no)) then raise exception 'Use Next round to change recorded series settings';end if;
 return new;
end $function$;

create or replace function public.athletics_class_selected_lane_guard() returns trigger language plpgsql security invoker set search_path=public as $$
declare cfg athletics_class_round_settings;
begin
 select * into cfg from athletics_class_round_settings where session_id=new.session_id and round_no=new.round_no;
 if cfg.start_mode='mass_start' then
  if new.lane is not null then raise exception 'Open starts do not assign lanes';end if;
 elsif new.lane is null then raise exception 'Choose a lane for a lane-based event';
 elsif cfg.session_id is not null and not new.lane=any(cfg.lanes) then raise exception 'Use a selected lane for this round';end if;
 return new;
end $$;
CREATE OR REPLACE FUNCTION public.athletics_create_class_round(p_session_id uuid, p_lanes integer[], p_mode text DEFAULT 'mixed'::text, p_athletes uuid[] DEFAULT NULL::uuid[])
 RETURNS SETOF athletics_class_heats
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare s athletics_class_sessions;lanes integer[];ids uuid[];g text;r integer;size integer;offset_no integer;h uuid;heatno integer:=0;open_start boolean;
begin
 perform athletics_class_lock(p_session_id);select * into s from athletics_class_sessions where id=p_session_id;
 open_start:=athletics_class_open_event(s.template_event_id);
 lanes:=case when open_start then array[1,2,3,4,5,6,7,8] else athletics_class_lane_list(p_lanes) end;
 if not s.attendance_recorded then raise exception 'Save attendance first';end if;
 if not exists(select 1 from athletics_events where id=s.template_event_id and discipline='track') then raise exception 'Individual track events only';end if;
 if p_mode is null or p_mode not in ('mixed','gender') then raise exception 'Choose mixed or separate Male / Female';end if;
 if p_athletes is null or cardinality(p_athletes)=0 or array_position(p_athletes,null) is not null or cardinality(p_athletes)<>(select count(distinct x) from unnest(p_athletes) x) or exists(select 1 from unnest(p_athletes) x where not exists(select 1 from athletics_class_attendance att join athletics_athletes a on a.id=att.athlete_id where att.session_id=p_session_id and att.athlete_id=x and att.present and att.available and a.active)) then raise exception 'Select available participants for this round';end if;
 r:=greatest(coalesce((select max(round_no) from athletics_class_heats where session_id=p_session_id),0),coalesce((select max(attempt_no) from athletics_class_marks where session_id=p_session_id),0),coalesce((select max(round_no) from athletics_class_round_settings where session_id=p_session_id),0))+1;
 insert into athletics_class_round_settings(session_id,round_no,kind,mode,lanes,start_mode) values(p_session_id,r,'track',p_mode,lanes,case when open_start then 'mass_start' else 'lanes' end);
 for g in select unnest(case when s.gender<>'All' then array[s.gender] when p_mode='mixed' then array['All'] else array['F','M'] end) loop
  select array_agg(a.id order by previous.heat_number nulls last,previous.lane nulls last,a.last_name,a.first_name,a.id) into ids
  from athletics_athletes a left join lateral(select h.heat_number,e.lane from athletics_class_heat_entries e join athletics_class_heats h on h.id=e.heat_id where e.session_id=p_session_id and e.athlete_id=a.id order by e.round_no desc limit 1) previous on true
  where a.id=any(p_athletes) and (g='All' or a.gender=g);
  offset_no:=0;
  while offset_no < coalesce(cardinality(ids),0) loop
   size:=case when open_start then cardinality(ids)-offset_no else least(cardinality(lanes),cardinality(ids)-offset_no) end;
   heatno:=heatno+1;insert into athletics_class_heats(session_id,round_no,heat_number,gender) values(p_session_id,r,heatno,g) returning id into h;
   for i in 1..size loop insert into athletics_class_heat_entries(heat_id,session_id,round_no,athlete_id,lane) values(h,p_session_id,r,ids[offset_no+i],case when open_start then null else lanes[i] end);end loop;
   offset_no:=offset_no+size;
  end loop;
 end loop;
 return query select * from athletics_class_heats where session_id=p_session_id and round_no=r order by heat_number;
end $function$;

CREATE OR REPLACE FUNCTION public.athletics_append_class_runners(p_session_id uuid, p_athletes uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
declare cfg athletics_class_round_settings;s athletics_class_sessions;a record;h athletics_class_heats;donor record;lane_no integer;added integer:=0;deferred integer:=0;singletons integer;
begin
 perform athletics_class_lock(p_session_id);select * into s from athletics_class_sessions where id=p_session_id;
 select * into cfg from athletics_class_round_settings where session_id=p_session_id and kind='track' order by round_no desc limit 1;
 if cfg.session_id is null or cfg.round_no<>(select max(round_no) from athletics_class_heats where session_id=p_session_id) then return jsonb_build_object('added',0,'deferred',0,'singletons',0);end if;
 for a in select ath.* from athletics_athletes ath where ath.id=any(p_athletes) order by ath.last_name,ath.first_name,ath.id loop
  if exists(select 1 from athletics_class_heat_entries where session_id=p_session_id and round_no=cfg.round_no and athlete_id=a.id) then continue;end if;
  if not a.active or not exists(select 1 from athletics_class_attendance where session_id=p_session_id and athlete_id=a.id and present and available) then raise exception 'Late arrivals must be present and available';end if;
  if exists(select 1 from athletics_class_marks where session_id=p_session_id and attempt_no=cfg.round_no and athlete_id=a.id) then deferred:=deferred+1;continue;end if;
  select * into h from athletics_class_heats where session_id=p_session_id and round_no=cfg.round_no and gender=case when cfg.mode='mixed' and s.gender='All' then 'All' else a.gender end order by heat_number desc limit 1;
  if cfg.start_mode='mass_start' then
   if h.id is null or h.status<>'scheduled' or exists(select 1 from athletics_class_series_sheet where heat_id=h.id and status<>'scheduled') then
    insert into athletics_class_heats(session_id,round_no,heat_number,gender) values(p_session_id,cfg.round_no,(select coalesce(max(heat_number),0)+1 from athletics_class_heats where session_id=p_session_id and round_no=cfg.round_no),case when cfg.mode='mixed' and s.gender='All' then 'All' else a.gender end) returning * into h;
   end if;
   insert into athletics_class_heat_entries(heat_id,session_id,round_no,athlete_id,lane) values(h.id,p_session_id,cfg.round_no,a.id,null);added:=added+1;continue;
  end if;
  lane_no:=null;
  if h.id is not null and h.status='scheduled' and not exists(select 1 from athletics_class_series_sheet where heat_id=h.id and status<>'scheduled') then
   select x into lane_no from unnest(cfg.lanes) x where not exists(select 1 from athletics_class_heat_entries e where e.heat_id=h.id and e.lane=x) order by x limit 1;
  end if;
  if lane_no is null then
   insert into athletics_class_heats(session_id,round_no,heat_number,gender) values(p_session_id,cfg.round_no,(select coalesce(max(heat_number),0)+1 from athletics_class_heats where session_id=p_session_id and round_no=cfg.round_no),case when cfg.mode='mixed' and s.gender='All' then 'All' else a.gender end) returning * into h;
   lane_no:=cfg.lanes[1];
  end if;
  insert into athletics_class_heat_entries(heat_id,session_id,round_no,athlete_id,lane) values(h.id,p_session_id,cfg.round_no,a.id,lane_no);added:=added+1;
  if cardinality(cfg.lanes)>1 and (select count(*) from athletics_class_heat_entries where heat_id=h.id)=1 then
   select en.id into donor from athletics_class_heat_entries en join athletics_class_heats other on other.id=en.heat_id
   where other.session_id=p_session_id and other.round_no=cfg.round_no and other.gender=h.gender and other.heat_number<h.heat_number and other.status='scheduled'
    and exists(select 1 from athletics_class_attendance att join athletics_athletes active_runner on active_runner.id=att.athlete_id where att.session_id=p_session_id and att.athlete_id=en.athlete_id and att.present and att.available and active_runner.active)
    and (select count(*) from athletics_class_heat_entries where heat_id=other.id)>2
    and not exists(select 1 from athletics_class_series_sheet where heat_id=other.id and status<>'scheduled')
   order by other.heat_number desc,en.lane desc limit 1;
   if found then update athletics_class_heat_entries set heat_id=h.id,lane=cfg.lanes[2] where id=donor.id;end if;
  end if;
 end loop;
 select count(*) into singletons from (select counted.id from athletics_class_heats counted join athletics_class_heat_entries e on e.heat_id=counted.id where counted.session_id=p_session_id and counted.round_no=cfg.round_no group by counted.id having count(*)=1) t;
 return jsonb_build_object('added',added,'deferred',deferred,'singletons',singletons);
end $function$;

notify pgrst,'reload schema';

