-- Run in a transaction after loading database/craighouse-extra-events.sql.
do $$
declare tid uuid; uid uuid; ids uuid[]; e athletics_events; sid uuid; team uuid; n integer;
begin
 select id into tid from tournaments where slug='intercolour-athletics-2026';select user_id into uid from system_admins limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);execute 'set local role authenticated';
 select array_agg(id) into ids from (select id from athletics_athletes where tournament_id=tid and active and gender='M' and level='Y7' limit 5) a;
 if cardinality(ids)<>5 then raise exception 'Need five test runners';end if;
 for e in select * from athletics_events where tournament_id=tid and class_only loop
  insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,e.id,'ROLLBACK new catalog',current_date,'Y7',array['Y7'],'M') returning id into sid;
  perform athletics_save_class_attendance(sid,ids);
  if e.discipline='relay' then
   n:=coalesce(e.relay_legs,4);
   perform athletics_configure_class_relay(sid,1,jsonb_build_array(jsonb_build_object('name','Test team','athletes',to_jsonb(ids[1:n]))));
   select id into team from athletics_class_relay_teams where session_id=sid;
   perform athletics_save_class_relay(team,252.34,'valid','manual');
   if (select count(*) from athletics_class_marks where session_id=sid and mark=252.34)<>n then raise exception 'Relay result missing';end if;
  else
   if e.discipline='track' then perform athletics_generate_class_heats(sid,'mixed',8,0,ids);end if;
   perform athletics_save_class_marks(sid,1,jsonb_build_array(jsonb_build_object('athlete_id',ids[1],'mark',case when e.discipline='field' then 18.75 else 12.34 end,'status','valid')));
   if not exists(select 1 from athletics_craighouse_history where athlete_id=ids[1] and event_name=e.name and source='class') then raise exception 'History missing';end if;
  end if;
 end loop;
 if (select count(*) from athletics_events where tournament_id=tid and class_only)<>6 then raise exception 'Expected six templates';end if;
end $$;
