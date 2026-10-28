begin;
do $$
declare tid uuid; uid uuid; eid uuid; sid uuid; sid2 uuid; ids uuid[]; newcomers uuid[]; late uuid; original jsonb; before_marks jsonb; target integer; person uuid;
begin
 select id into tid from tournaments where slug='intercolour-athletics-2026';select user_id into uid from system_admins limit 1;
 perform set_config('request.jwt.claim.sub',uid::text,true);execute 'set local role authenticated';
 select id into eid from athletics_events where tournament_id=tid and discipline='track' limit 1;
 select array_agg(id order by gender,id) into ids from ((select id,gender from athletics_athletes where tournament_id=tid and active and gender='F' and level='Y7' order by id limit 2) union all (select id,gender from athletics_athletes where tournament_id=tid and active and gender='M' and level='Y8' order by id limit 2)) x;
 select array_agg(id) into newcomers from ((select id from athletics_athletes where tournament_id=tid and active and gender='F' and level='Y7' and not id=any(ids) limit 1) union all (select id from athletics_athletes where tournament_id=tid and active and gender='M' and level='Y8' and not id=any(ids) limit 1)) x;
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,eid,'ROLLBACK stable rounds',current_date,'All',array['Y7','Y8'],'All') returning id into sid;
 perform athletics_save_class_attendance(sid,ids);perform athletics_generate_class_heats(sid,'gender',1,0,ids);
 select jsonb_agg(jsonb_build_array(e.athlete_id,h.heat_number,e.lane) order by e.athlete_id) into original from athletics_class_heat_entries e join athletics_class_heats h on h.id=e.heat_id where e.session_id=sid and e.round_no=1;
 perform athletics_save_class_marks(sid,1,jsonb_build_array(jsonb_build_object('athlete_id',ids[1],'status','valid','mark',12.34)));
 select jsonb_agg(to_jsonb(m) order by id) into before_marks from athletics_class_marks m where session_id=sid;
 perform athletics_save_class_attendance(sid,ids||newcomers);
 perform athletics_generate_class_heats(sid,'mixed',99,1,ids||newcomers);
 if original is distinct from (select jsonb_agg(jsonb_build_array(e.athlete_id,h.heat_number,e.lane) order by e.athlete_id) from athletics_class_heat_entries e join athletics_class_heats h on h.id=e.heat_id where e.session_id=sid and e.round_no=2 and e.athlete_id=any(ids)) then raise exception 'Round one assignments changed';end if;
 foreach person in array newcomers loop
  select max(h.heat_number) into target from athletics_class_heats h join athletics_athletes a on a.id=person where h.session_id=sid and h.round_no=1 and h.gender=a.gender;
  if not exists(select 1 from athletics_class_heat_entries e join athletics_class_heats h on h.id=e.heat_id where e.session_id=sid and e.round_no=2 and e.athlete_id=person and h.heat_number=target and e.lane=2) then raise exception 'New athlete not appended to last gender heat';end if;
 end loop;
 perform athletics_generate_class_heats(sid,'mixed',1,0,newcomers);
 if (select count(*) from athletics_class_heats where session_id=sid and round_no=3)<>4 then raise exception 'Empty series numbering was lost';end if;
 if (select count(*) from athletics_class_heat_entries where session_id=sid and round_no=3)<>2 then raise exception 'Unselected athlete included';end if;
 perform athletics_generate_class_heats(sid,'gender',1,0,ids||newcomers);
 if exists(select 1 from athletics_class_heat_entries e join athletics_class_heats h on h.id=e.heat_id join athletics_class_heat_entries prev on prev.session_id=e.session_id and prev.athlete_id=e.athlete_id and prev.round_no=2 join athletics_class_heats ph on ph.id=prev.heat_id where e.session_id=sid and e.round_no=4 and (h.heat_number<>ph.heat_number or e.lane<>prev.lane)) then raise exception 'Returning athletes lost their lanes';end if;
 if before_marks is distinct from (select jsonb_agg(to_jsonb(m) order by id) from athletics_class_marks m where session_id=sid) then raise exception 'Old marks changed';end if;
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,eid,'ROLLBACK mixed stable',current_date,'All',array['Y7','Y8'],'All') returning id into sid2;
 perform athletics_save_class_attendance(sid2,ids);perform athletics_generate_class_heats(sid2,'mixed',2,0,ids);
 perform athletics_save_class_attendance(sid2,ids||newcomers);perform athletics_generate_class_heats(sid2,'gender',1,0,ids||newcomers);
 if exists(select 1 from athletics_class_heat_entries e join athletics_class_heats h on h.id=e.heat_id where e.session_id=sid2 and e.round_no=2 and e.athlete_id=any(newcomers) and (h.heat_number<>2 or h.gender<>'All' or e.lane<3)) then raise exception 'New mixed athletes not appended';end if;
 if (select count(*) from athletics_class_heats where session_id=sid2 and round_no=2)<>2 then raise exception 'Mixed heat count changed';end if;
end $$;
rollback;
select 'PASS: stable mixed/gender series and lanes, newcomers appended, selected subsets, returning athletes, old results preserved. Rolled back.' as result;
