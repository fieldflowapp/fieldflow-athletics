begin;
do $$
declare tid uuid;uid uuid;event800 uuid;event400 uuid;sid uuid;legacy uuid;sprint uuid;ids uuid[];extra uuid;categories text[];snapshot jsonb;marks_before jsonb;heat uuid;entry uuid;report jsonb;rejected boolean;
begin
 select id into tid from tournaments where slug='intercolour-athletics-2026';select user_id into uid from system_admins limit 1;
 select id into event800 from athletics_events where tournament_id=tid and code='800M' limit 1;
 select id into event400 from athletics_events where tournament_id=tid and code='400M' limit 1;
 select array_agg(id order by gender,id) into ids from ((select id,gender from athletics_athletes where tournament_id=tid and active and gender='F' order by id limit 10) union all (select id,gender from athletics_athletes where tournament_id=tid and active and gender='M' order by id limit 10)) a;
 select id into extra from athletics_athletes where tournament_id=tid and active and not id=any(ids) limit 1;
 select array_agg(distinct level) into categories from athletics_athletes where tournament_id=tid and active;
 if cardinality(ids)<>20 or event800 is null or event400 is null or extra is null then raise exception 'Missing fixtures';end if;
 perform set_config('request.jwt.claim.sub',uid::text,true);execute 'set local role authenticated';
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,event800,'ROLLBACK 800 open',current_date,'All',categories,'All') returning id into sid;
 perform athletics_save_class_roster_and_series(sid,ids);
 perform athletics_create_class_round(sid,array[1,2,3,4,5,6,7,8],'mixed',ids);
 if (select count(*) from athletics_class_heats where session_id=sid and round_no=1)<>1 or (select count(*) from athletics_class_heat_entries where session_id=sid and round_no=1)<>20 or exists(select 1 from athletics_class_heat_entries where session_id=sid and lane is not null) then raise exception '800 m is capped at eight or has assigned lanes';end if;
 if not exists(select 1 from athletics_class_round_settings where session_id=sid and start_mode='mass_start') then raise exception 'Open start not persisted';end if;
 report:=athletics_save_class_roster_and_series(sid,ids||extra);
 if (report->>'added')::integer<>1 or (select count(*) from athletics_class_heats where session_id=sid)<>1 or (select count(*) from athletics_class_heat_entries where session_id=sid and lane is null)<>21 then raise exception 'Late runner split or assigned a lane';end if;
 select heat_id,id into heat,entry from athletics_class_heat_entries where session_id=sid and athlete_id=ids[1];
 perform athletics_save_class_heat(heat,jsonb_build_array(jsonb_build_object('id',entry,'status','finished','official_time',165.678,'timing_method','photo_finish')),false);
 select jsonb_agg(to_jsonb(m) order by id) into marks_before from athletics_class_marks m where session_id=sid;
 perform athletics_create_class_round(sid,array[1],'gender',ids);
 if (select count(*) from athletics_class_heats where session_id=sid and round_no=2)<>2 or (select count(*) from athletics_class_heat_entries where session_id=sid and round_no=2)<>20 then raise exception 'Separated open starts did not group all runners';end if;
 if exists(select 1 from athletics_class_heat_entries en join athletics_class_heats h on h.id=en.heat_id join athletics_athletes a on a.id=en.athlete_id where en.session_id=sid and en.round_no=2 and (en.lane is not null or h.gender<>a.gender)) then raise exception 'Gender group or unassigned lane incorrect';end if;
 if marks_before is distinct from (select jsonb_agg(to_jsonb(m) order by id) from athletics_class_marks m where session_id=sid) then raise exception 'Earlier 800 m result changed';end if;
 rejected:=false;begin update athletics_class_heat_entries set lane=1 where session_id=sid and round_no=2 and athlete_id=ids[2];exception when others then rejected:=true;end;if not rejected then raise exception 'Lane assigned in an open start';end if;
 -- Recorded lane-based legacy 800 m rounds survive; Next round is open.
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,event800,'ROLLBACK legacy 800',current_date,'All',categories,'All') returning id into legacy;
 perform athletics_save_class_attendance(legacy,ids);perform athletics_generate_class_heats(legacy,'mixed',8,0,ids);
 select jsonb_agg(to_jsonb(en) order by id) into snapshot from athletics_class_heat_entries en where session_id=legacy;
 perform athletics_save_class_marks(legacy,1,jsonb_build_array(jsonb_build_object('athlete_id',ids[1],'status','valid','mark',180.12)));
 perform athletics_create_class_round(legacy,array[1,2,3,4,5,6,7,8],'mixed',ids);
 if snapshot is distinct from (select jsonb_agg(to_jsonb(en) order by id) from athletics_class_heat_entries en where session_id=legacy and round_no=1) or (select count(*) from athletics_class_heats where session_id=legacy and round_no=2)<>1 then raise exception 'Legacy 800 m assignments modified';end if;
 -- 400 m remains lane-based, including validation and capacity.
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,event400,'ROLLBACK 400 lanes',current_date,'All',categories,'All') returning id into sprint;
 perform athletics_save_class_roster_and_series(sprint,ids);perform athletics_create_class_round(sprint,array[2,4,7],'mixed',ids);
 if (select count(*) from athletics_class_heats where session_id=sprint)<>7 or exists(select 1 from athletics_class_heat_entries where session_id=sprint and (lane is null or not lane=any(array[2,4,7]))) then raise exception '400 m lane behavior changed';end if;
 rejected:=false;begin update athletics_class_heat_entries set lane=null where session_id=sprint and athlete_id=ids[1];exception when others then rejected:=true;end;if not rejected then raise exception '400 m accepted an unassigned lane';end if;
end $$;
rollback;
select 'PASS: 20+ runners in one open 800 m start, late arrival without a lane, separate gender groups, Photo Finish-compatible save, old results preserved, 400 m lanes unchanged. All fixtures rolled back.' as result;
