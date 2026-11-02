-- Additive Class Mode series planning. Existing rounds, marks and Photo Finish IDs stay intact.
create function public.athletics_class_lane_list(p_lanes integer[]) returns integer[]
language plpgsql immutable security invoker set search_path=public as $$
declare lanes integer[];
begin
 if p_lanes is null or cardinality(p_lanes) not between 1 and 8 or array_position(p_lanes,null) is not null or exists(select 1 from unnest(p_lanes) x where x not between 1 and 8) then raise exception 'Select lanes between 1 and 8';end if;
 select array_agg(x order by x) into lanes from (select distinct unnest(p_lanes) x) t;
 if cardinality(lanes)<>cardinality(p_lanes) then raise exception 'Duplicate lane';end if;
 return lanes;
end $$;
create function public.athletics_class_series_sizes(p_count integer,p_capacity integer) returns integer[]
language plpgsql immutable security invoker set search_path=public as $$
declare sizes integer[]:='{}';remaining integer:=p_count;n integer;
begin
 if p_count is null or p_count<0 or p_capacity is null or p_capacity not between 1 and 8 then raise exception 'Invalid series size';end if;
 while remaining>0 loop sizes:=array_append(sizes,least(remaining,p_capacity));remaining:=remaining-p_capacity;end loop;
 n:=cardinality(sizes);
 if n>1 and sizes[n]=1 and sizes[n-1]>2 then sizes[n]:=2;sizes[n-1]:=sizes[n-1]-1;end if;
 return sizes;
end $$;

create table public.athletics_class_round_settings(
 session_id uuid not null references public.athletics_class_sessions(id),round_no integer not null check(round_no>0),
 kind text not null check(kind in ('track','relay')),mode text not null check(mode in ('mixed','gender')),
 lanes integer[] not null check(lanes=public.athletics_class_lane_list(lanes)),primary key(session_id,round_no)
);
alter table public.athletics_class_round_settings enable row level security;
create policy class_round_settings_admin on public.athletics_class_round_settings for all to authenticated
 using(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)))
 with check(exists(select 1 from public.athletics_class_sessions s where s.id=session_id and public.is_athletics_admin(s.tournament_id)));
revoke all on public.athletics_class_round_settings from public,anon,authenticated;
grant select,insert,update on public.athletics_class_round_settings to authenticated;
create function public.athletics_class_round_guard() returns trigger language plpgsql security invoker set search_path=public as $$
begin
 perform athletics_class_lock(new.session_id);
 if tg_op='UPDATE' and row(new.session_id,new.round_no,new.kind,new.mode,new.lanes) is distinct from row(old.session_id,old.round_no,old.kind,old.mode,old.lanes) and (new.session_id<>old.session_id or new.round_no<>old.round_no or new.kind<>old.kind or exists(select 1 from athletics_class_marks where session_id=old.session_id and attempt_no=old.round_no)) then raise exception 'Use Next round to change recorded series settings';end if;
 return new;
end $$;
create trigger class_round_settings_guard before insert or update on public.athletics_class_round_settings for each row execute function public.athletics_class_round_guard();

create function public.athletics_create_class_round(p_session_id uuid,p_lanes integer[],p_mode text default 'mixed',p_athletes uuid[] default null)
returns setof public.athletics_class_heats language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions;lanes integer[];ids uuid[];sizes integer[];g text;r integer;size integer;offset_no integer;h uuid;heatno integer:=0;
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
  sizes:=athletics_class_series_sizes(coalesce(cardinality(ids),0),cardinality(lanes));offset_no:=0;
  foreach size in array sizes loop
   heatno:=heatno+1;insert into athletics_class_heats(session_id,round_no,heat_number,gender) values(p_session_id,r,heatno,g) returning id into h;
   for i in 1..size loop insert into athletics_class_heat_entries(heat_id,session_id,round_no,athlete_id,lane) values(h,p_session_id,r,ids[offset_no+i],lanes[i]);end loop;
   offset_no:=offset_no+size;
  end loop;
 end loop;
 return query select * from athletics_class_heats where session_id=p_session_id and round_no=r order by heat_number;
end $$;

create function public.athletics_append_class_runners(p_session_id uuid,p_athletes uuid[]) returns jsonb
language plpgsql security invoker set search_path=public as $$
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
    and (select count(*) from athletics_class_heat_entries where heat_id=other.id)>2
    and not exists(select 1 from athletics_class_series_sheet where heat_id=other.id and status<>'scheduled')
   order by other.heat_number desc,en.lane desc limit 1;
   if found then update athletics_class_heat_entries set heat_id=h.id,lane=cfg.lanes[2] where id=donor.id;end if;
  end if;
 end loop;
 select count(*) into singletons from (select counted.id from athletics_class_heats counted join athletics_class_heat_entries e on e.heat_id=counted.id where counted.session_id=p_session_id and counted.round_no=cfg.round_no group by counted.id having count(*)=1) t;
 return jsonb_build_object('added',added,'deferred',deferred,'singletons',singletons);
end $$;
create function public.athletics_save_class_roster_and_series(p_session_id uuid,p_present uuid[]) returns jsonb
language plpgsql security invoker set search_path=public as $$
declare newcomers uuid[];n integer;result jsonb;
begin
 perform athletics_class_lock(p_session_id);
 select array_agg(x) into newcomers from unnest(p_present) x where not exists(select 1 from athletics_class_attendance att where att.session_id=p_session_id and att.athlete_id=x and att.present and att.available);
 n:=athletics_save_class_attendance(p_session_id,p_present);
 result:=athletics_append_class_runners(p_session_id,coalesce(newcomers,'{}'));
 return result||jsonb_build_object('available',n);
end $$;
create function public.athletics_class_selected_lane_guard() returns trigger language plpgsql security invoker set search_path=public as $$
declare cfg athletics_class_round_settings;
begin
 select * into cfg from athletics_class_round_settings where session_id=new.session_id and round_no=new.round_no;
 if cfg.session_id is not null and not new.lane=any(cfg.lanes) then raise exception 'Use a selected lane for this round';end if;
 return new;
end $$;
create trigger class_selected_lane_guard before insert or update on public.athletics_class_heat_entries for each row execute function public.athletics_class_selected_lane_guard();

-- Relay series contain complete teams. Existing team times and ordered legs are reused.
alter table public.athletics_class_relay_teams add column heat_number integer check(heat_number>0),add column lane integer check(lane between 1 and 8);
alter table public.athletics_class_relay_teams add constraint class_relay_series_lane unique(session_id,attempt_no,heat_number,lane) deferrable initially immediate;
grant update(heat_number,lane) on public.athletics_class_relay_teams to authenticated;
create function public.athletics_class_relay_heat_locked(p_session_id uuid,p_attempt integer,p_heat integer) returns boolean
language sql stable security invoker set search_path=public as $$
 select exists(select 1 from athletics_class_relay_teams t join athletics_class_relay_legs l on l.team_id=t.id join athletics_class_marks m on m.session_id=t.session_id and m.attempt_no=t.attempt_no and m.athlete_id=l.athlete_id where t.session_id=p_session_id and t.attempt_no=p_attempt and (p_heat is null or t.heat_number=p_heat));
$$;
create or replace function public.athletics_class_relay_guard() returns trigger language plpgsql security invoker set search_path=public as $$
declare sid uuid;n integer;team uuid;cfg athletics_class_round_settings;
begin
 if tg_op='DELETE' then sid:=old.session_id;n:=old.attempt_no;else sid:=new.session_id;n:=new.attempt_no;end if;
 perform athletics_class_lock(sid);
 if tg_table_name='athletics_class_relay_teams' then
  if tg_op='UPDATE' then
   if row(new.heat_number,new.lane) is not distinct from row(old.heat_number,old.lane) then return new;end if;
   if (old.heat_number is not null and athletics_class_relay_heat_locked(sid,n,old.heat_number)) or (new.heat_number is not null and athletics_class_relay_heat_locked(sid,n,new.heat_number)) or exists(select 1 from athletics_class_relay_legs l join athletics_class_marks m on m.session_id=l.session_id and m.attempt_no=l.attempt_no and m.athlete_id=l.athlete_id where l.team_id=old.id) then raise exception 'A relay series with results cannot be rearranged';end if;
  elsif tg_op='DELETE' then
   if athletics_class_relay_heat_locked(sid,n,old.heat_number) then raise exception 'A relay series with results cannot be rearranged';end if;
  elsif new.heat_number is not null and athletics_class_relay_heat_locked(sid,n,new.heat_number) then raise exception 'Add the late team to a pending series';end if;
  if tg_op<>'DELETE' then
   select * into cfg from athletics_class_round_settings where session_id=sid and round_no=n and kind='relay';
   if new.lane is not null and (cfg.session_id is null or not new.lane=any(cfg.lanes)) then raise exception 'Use a selected relay lane';end if;
  end if;
 else
  if tg_op='DELETE' then team:=old.team_id;else team:=new.team_id;end if;
  if exists(select 1 from athletics_class_relay_legs l join athletics_class_marks m on m.session_id=l.session_id and m.attempt_no=l.attempt_no and m.athlete_id=l.athlete_id where l.team_id=team) then raise exception 'Recorded relay membership is locked';end if;
  if tg_op='INSERT' and exists(select 1 from athletics_class_marks where session_id=sid and attempt_no=n and athlete_id=new.athlete_id) then raise exception 'Runner already has a result in this round';end if;
 end if;
 if tg_op='DELETE' then return old;else return new;end if;
end $$;
create trigger class_relay_lane_guard before update on public.athletics_class_relay_teams for each row execute function public.athletics_class_relay_guard();

create function public.athletics_plan_class_relay(p_session_id uuid,p_attempt integer,p_lanes integer[],p_teams jsonb)
returns setof public.athletics_class_relay_teams language plpgsql security invoker set search_path=public as $$
declare s athletics_class_sessions;cfg athletics_class_round_settings;lanes integer[];item jsonb;team athletics_class_relay_teams;oldteam athletics_class_relay_teams;ids uuid[];members uuid[];sizes integer[];size integer;offset_no integer;heatno integer:=0;lane_no integer;donor uuid;recorded boolean;new_ids uuid[]:='{}';
begin
 perform athletics_class_lock(p_session_id);select * into s from athletics_class_sessions where id=p_session_id;
 lanes:=athletics_class_lane_list(p_lanes);
 if not s.attendance_recorded or s.gender not in ('M','F') or not exists(select 1 from athletics_events where id=s.template_event_id and discipline='relay') then raise exception 'Save attendance for a Male / Female relay first';end if;
 if p_attempt is null or p_attempt<1 or jsonb_typeof(p_teams) is distinct from 'array' or jsonb_array_length(p_teams) not between 1 and 1000 then raise exception 'Choose relay teams';end if;
 if exists(select 1 from jsonb_array_elements(p_teams) t where jsonb_typeof(t->'athletes') is distinct from 'array' or jsonb_array_length(t->'athletes') not between 1 and 20 or length(trim(coalesce(t->>'name',''))) not between 1 and 80) then raise exception 'Each team needs a name and 1-20 ordered runners';end if;
 select array_agg(x::uuid) into members from jsonb_array_elements(p_teams) t cross join lateral jsonb_array_elements_text(t->'athletes') x;
 if cardinality(members)<>(select count(distinct x) from unnest(members) x) then raise exception 'Select each available runner once';end if;
 for item in select * from jsonb_array_elements(p_teams) loop
  select * into oldteam from athletics_class_relay_teams where session_id=p_session_id and attempt_no=p_attempt and id=(item->>'id')::uuid;
  if found and oldteam.name=item->>'name' and (select array_agg(x::uuid order by ord) from jsonb_array_elements_text(item->'athletes') with ordinality t(x,ord))=(select array_agg(athlete_id order by leg_order) from athletics_class_relay_legs where team_id=oldteam.id) then continue;end if;
  if exists(select 1 from jsonb_array_elements_text(item->'athletes') member_id where not exists(select 1 from athletics_class_attendance att join athletics_athletes a on a.id=att.athlete_id where att.session_id=p_session_id and a.id=member_id::uuid and a.active and a.gender=s.gender and att.present and att.available)) then raise exception 'New teams need available runners';end if;
 end loop;
 recorded:=exists(select 1 from athletics_class_marks where session_id=p_session_id and attempt_no=p_attempt);
 select * into cfg from athletics_class_round_settings where session_id=p_session_id and round_no=p_attempt;
 if cfg.session_id is null then
  if recorded then raise exception 'Use Next round for a recorded legacy relay';end if;
  insert into athletics_class_round_settings values(p_session_id,p_attempt,'relay','gender',lanes);
 elsif cfg.kind<>'relay' or (recorded and cfg.lanes<>lanes) then raise exception 'Use Next round to change recorded relay lanes';
 else update athletics_class_round_settings set lanes=athletics_class_lane_list(p_lanes) where session_id=p_session_id and round_no=p_attempt;end if;
 -- Old teams may only be removed/edited if their series has no results. Others retain IDs and leg order.
 for oldteam in select * from athletics_class_relay_teams where session_id=p_session_id and attempt_no=p_attempt loop
  select t into item from jsonb_array_elements(p_teams) t where t->>'id'=oldteam.id::text;
  if item is null or item->>'name'<>oldteam.name or (select array_agg(x::uuid order by ord) from jsonb_array_elements_text(item->'athletes') with ordinality t(x,ord)) is distinct from (select array_agg(athlete_id order by leg_order) from athletics_class_relay_legs where team_id=oldteam.id) then
   if athletics_class_relay_heat_locked(p_session_id,p_attempt,oldteam.heat_number) then raise exception 'Keep recorded teams and their members; add a late team or use Next round';end if;
   delete from athletics_class_relay_legs where team_id=oldteam.id;delete from athletics_class_relay_teams where id=oldteam.id;
  end if;
 end loop;
 for item in select * from jsonb_array_elements(p_teams) loop
  if item->>'id' is not null and exists(select 1 from athletics_class_relay_teams where session_id=p_session_id and attempt_no=p_attempt and id=(item->>'id')::uuid) then continue;end if;
  insert into athletics_class_relay_teams(session_id,attempt_no,name) values(p_session_id,p_attempt,item->>'name') returning * into team;
  insert into athletics_class_relay_legs(team_id,session_id,attempt_no,athlete_id,leg_order) select team.id,p_session_id,p_attempt,x::uuid,ord::integer from jsonb_array_elements_text(item->'athletes') with ordinality t(x,ord);
  new_ids:=array_append(new_ids,team.id);
 end loop;
 if not recorded and (cfg.session_id is null or cfg.lanes<>lanes or not exists(select 1 from athletics_class_relay_teams where session_id=p_session_id and attempt_no=p_attempt and heat_number is not null)) then
  set constraints class_relay_series_lane deferred;
  select array_agg(id order by name,id) into ids from athletics_class_relay_teams where session_id=p_session_id and attempt_no=p_attempt;
  sizes:=athletics_class_series_sizes(cardinality(ids),cardinality(lanes));offset_no:=0;
  foreach size in array sizes loop
   heatno:=heatno+1;for i in 1..size loop update athletics_class_relay_teams set heat_number=heatno,lane=lanes[i] where id=ids[offset_no+i];end loop;offset_no:=offset_no+size;
  end loop;
  set constraints class_relay_series_lane immediate;
 else
  foreach donor in array new_ids loop
   select * into team from athletics_class_relay_teams where session_id=p_session_id and attempt_no=p_attempt and heat_number is not null order by heat_number desc,lane desc limit 1;
   heatno:=coalesce(team.heat_number,0);lane_no:=null;
   if heatno>0 and not athletics_class_relay_heat_locked(p_session_id,p_attempt,heatno) then select x into lane_no from unnest(lanes) x where not exists(select 1 from athletics_class_relay_teams t where t.session_id=p_session_id and t.attempt_no=p_attempt and t.heat_number=heatno and t.lane=x) order by x limit 1;end if;
   if lane_no is null then heatno:=heatno+1;lane_no:=lanes[1];end if;
   update athletics_class_relay_teams set heat_number=heatno,lane=lane_no where id=donor;
   if cardinality(lanes)>1 and (select count(*) from athletics_class_relay_teams where session_id=p_session_id and attempt_no=p_attempt and heat_number=heatno)=1 then
    select t.id into donor from athletics_class_relay_teams t where t.session_id=p_session_id and t.attempt_no=p_attempt and t.heat_number<heatno
     and not athletics_class_relay_heat_locked(p_session_id,p_attempt,t.heat_number)
     and (select count(*) from athletics_class_relay_teams x where x.session_id=p_session_id and x.attempt_no=p_attempt and x.heat_number=t.heat_number)>2 order by t.heat_number desc,t.lane desc limit 1;
    if found then update athletics_class_relay_teams set heat_number=heatno,lane=lanes[2] where id=donor;end if;
   end if;
  end loop;
 end if;
 return query select * from athletics_class_relay_teams where session_id=p_session_id and attempt_no=p_attempt order by heat_number,lane;
end $$;

revoke all on function public.athletics_class_lane_list(integer[]),public.athletics_class_series_sizes(integer,integer),public.athletics_class_round_guard(),public.athletics_create_class_round(uuid,integer[],text,uuid[]),public.athletics_append_class_runners(uuid,uuid[]),public.athletics_save_class_roster_and_series(uuid,uuid[]),public.athletics_class_selected_lane_guard(),public.athletics_class_relay_heat_locked(uuid,integer,integer),public.athletics_plan_class_relay(uuid,integer,integer[],jsonb) from public,anon;
grant execute on function public.athletics_class_lane_list(integer[]),public.athletics_class_series_sizes(integer,integer),public.athletics_class_round_guard(),public.athletics_create_class_round(uuid,integer[],text,uuid[]),public.athletics_append_class_runners(uuid,uuid[]),public.athletics_save_class_roster_and_series(uuid,uuid[]),public.athletics_class_selected_lane_guard(),public.athletics_class_relay_heat_locked(uuid,integer,integer),public.athletics_plan_class_relay(uuid,integer,integer[],jsonb) to authenticated;
notify pgrst,'reload schema';
