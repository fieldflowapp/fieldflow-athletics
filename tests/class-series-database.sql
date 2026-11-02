begin;
do $$
declare tid uuid;uid uuid;eid uuid;relay uuid;sid uuid;late_sid uuid;locked_sid uuid;relay_sid uuid;ids uuid[];males uuid[];categories text[];h uuid;report jsonb;before_rows jsonb;before_marks jsonb;payload jsonb;teams jsonb;expected integer[];actual integer[];old_ids uuid[];team uuid;outcome boolean;
begin
 select id into tid from tournaments where slug='intercolour-athletics-2026';select user_id into uid from system_admins limit 1;
 select id into eid from athletics_events where tournament_id=tid and discipline='track' order by id limit 1;
 select id into relay from athletics_events where tournament_id=tid and discipline='relay' order by id limit 1;
 select array_agg(id order by id) into ids from (select id from athletics_athletes where tournament_id=tid and active order by id limit 20) a;
 select array_agg(id order by id) into males from (select id from athletics_athletes where tournament_id=tid and active and gender='M' order by id limit 40) a;
 select array_agg(distinct level) into categories from athletics_athletes where tournament_id=tid and active;
 if cardinality(ids)<20 or cardinality(males)<40 then raise exception 'Not enough fixture athletes';end if;
 perform set_config('request.jwt.claim.sub',uid::text,true);execute 'set local role authenticated';
 -- Initial automatic sizes, real selected lane numbers, and old result preservation.
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,eid,'ROLLBACK automatic series',current_date,'All',categories,'All') returning id into sid;
 perform athletics_save_class_roster_and_series(sid,ids[1:17]);perform athletics_create_class_round(sid,array[1,2,3,4,5,6,7,8],'mixed',ids[1:17]);
 select array_agg(n order by heat_number) into actual from (select h.heat_number,count(*)::integer n from athletics_class_heats h join athletics_class_heat_entries e on e.heat_id=h.id where h.session_id=sid and h.round_no=1 group by h.heat_number) t;
 if actual<>array[8,7,2] then raise exception 'Wrong 17/8 split: %',actual;end if;
 select jsonb_agg(to_jsonb(e) order by id) into before_rows from athletics_class_heat_entries e where session_id=sid;
 perform athletics_save_class_marks(sid,1,jsonb_build_array(jsonb_build_object('athlete_id',ids[1],'mark',12.34,'status','valid')));
 select jsonb_agg(to_jsonb(m) order by id) into before_marks from athletics_class_marks m where session_id=sid;
 perform athletics_create_class_round(sid,array[2,4,7],'gender',ids[1:17]);
 if exists(select 1 from athletics_class_heat_entries e join athletics_class_heats h on h.id=e.heat_id join athletics_athletes a on a.id=e.athlete_id where e.session_id=sid and e.round_no=2 and (not e.lane=any(array[2,4,7]) or h.gender<>a.gender)) then raise exception 'Lane or gender mismatch';end if;
 if (select count(*) from athletics_class_heat_entries where session_id=sid and round_no=2)<>17 then raise exception 'Missing/duplicated participants';end if;
 if before_rows is distinct from (select jsonb_agg(to_jsonb(e) order by id) from athletics_class_heat_entries e where session_id=sid and round_no=1) or before_marks is distinct from (select jsonb_agg(to_jsonb(m) order by id) from athletics_class_marks m where session_id=sid) then raise exception 'Earlier results or assignments changed';end if;
 -- A ninth late runner: keep this round, add a companion, never exceed eight lanes.
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,eid,'ROLLBACK late runner',current_date,'All',categories,'All') returning id into late_sid;
 perform athletics_save_class_roster_and_series(late_sid,ids[1:8]);perform athletics_create_class_round(late_sid,array[1,2,3,4,5,6,7,8],'mixed',ids[1:8]);
 select array_agg(id) into old_ids from athletics_class_heat_entries where session_id=late_sid;
 report:=athletics_save_class_roster_and_series(late_sid,ids[1:9]);
 if (report->>'added')::integer<>1 or (select max(round_no) from athletics_class_heats where session_id=late_sid)<>1 then raise exception 'Late runner created a new round';end if;
 select array_agg(n order by heat_number) into actual from (select h.heat_number,count(*)::integer n from athletics_class_heats h join athletics_class_heat_entries e on e.heat_id=h.id where h.session_id=late_sid group by h.heat_number) t;
 if actual<>array[7,2] or (select count(*) from athletics_class_heat_entries where id=any(old_ids))<>8 then raise exception 'Late runner / companion assignment wrong';end if;
 report:=athletics_save_class_roster_and_series(late_sid,ids[1:9]);if (report->>'added')::integer<>0 then raise exception 'Retry duplicated a late runner';end if;
 -- Once recorded, the donor series is immutable; retain a pending solo series with feedback.
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,eid,'ROLLBACK locked series',current_date,'All',categories,'All') returning id into locked_sid;
 perform athletics_save_class_roster_and_series(locked_sid,ids[1:8]);perform athletics_create_class_round(locked_sid,array[1,2,3,4,5,6,7,8],'mixed',ids[1:8]);
 select id into h from athletics_class_heats where session_id=locked_sid;
 select jsonb_agg(jsonb_build_object('id',id,'official_time',13.12,'status','finished')) into payload from athletics_class_heat_entries where heat_id=h;
 perform athletics_save_class_heat(h,payload,true);
 select jsonb_agg(to_jsonb(e) order by id) into before_rows from athletics_class_heat_entries e where heat_id=h;
 select jsonb_agg(to_jsonb(m) order by id) into before_marks from athletics_class_marks m where session_id=locked_sid;
 report:=athletics_save_class_roster_and_series(locked_sid,ids[1:9]);
 if (report->>'singletons')::integer<>1 or before_rows is distinct from (select jsonb_agg(to_jsonb(e) order by id) from athletics_class_heat_entries e where heat_id=h) or before_marks is distinct from (select jsonb_agg(to_jsonb(m) order by id) from athletics_class_marks m where session_id=locked_sid) then raise exception 'Recorded series moved or marks changed';end if;
 -- Bad lane requests and forged/off-roster participants reject atomically.
 outcome:=false;begin perform athletics_create_class_round(sid,array[1,1],'mixed',ids[1:4]);exception when others then outcome:=true;end;if not outcome then raise exception 'Duplicate lanes admitted';end if;
 outcome:=false;begin perform athletics_create_class_round(sid,array[9],'mixed',ids[1:4]);exception when others then outcome:=true;end;if not outcome then raise exception 'Invalid lane admitted';end if;
 outcome:=false;begin perform athletics_create_class_round(sid,array[1,2],'mixed',ids[18:19]);exception when others then outcome:=true;end;if not outcome then raise exception 'Absent participants admitted';end if;
 -- Complete relay teams occupy one lane; team IDs, leg order and saved times survive late teams.
 insert into athletics_class_sessions(tournament_id,template_event_id,title,session_date,category,categories,gender) values(tid,relay,'ROLLBACK relay series',current_date,'All',categories,'M') returning id into relay_sid;
 perform athletics_save_class_roster_and_series(relay_sid,males);
 select jsonb_agg(jsonb_build_object('name','Team '||lpad(i::text,2,'0'),'athletes',to_jsonb(males[(i-1)*4+1:i*4])) order by i) into teams from generate_series(1,9) i;
 perform athletics_plan_class_relay(relay_sid,1,array[1,2,3,4,5,6,7,8],teams);
 select array_agg(n order by heat_number) into actual from (select heat_number,count(*)::integer n from athletics_class_relay_teams where session_id=relay_sid group by heat_number) t;
 if actual<>array[7,2] or exists(select 1 from athletics_class_relay_teams t where t.session_id=relay_sid and (select count(*) from athletics_class_relay_legs where team_id=t.id)<>4) then raise exception 'Relay team split or wrong series sizes';end if;
 select id into team from athletics_class_relay_teams where session_id=relay_sid order by heat_number,lane limit 1;perform athletics_save_class_relay(team,62.34,'valid','manual');
 select jsonb_agg(to_jsonb(m) order by id) into before_marks from athletics_class_marks m where session_id=relay_sid;
 select jsonb_agg(jsonb_build_object('id',t.id,'name',t.name,'athletes',(select jsonb_agg(athlete_id order by leg_order) from athletics_class_relay_legs where team_id=t.id)) order by t.heat_number,t.lane) into teams from athletics_class_relay_teams t where t.session_id=relay_sid;
 perform athletics_save_class_roster_and_series(relay_sid,males[2:40]);
 teams:=teams||jsonb_build_array(jsonb_build_object('name','Team 10','athletes',to_jsonb(males[37:40])));
 perform athletics_plan_class_relay(relay_sid,1,array[1,2,3,4,5,6,7,8],teams);
 if (select count(*) from athletics_class_relay_teams where session_id=relay_sid)<>10 or before_marks is distinct from (select jsonb_agg(to_jsonb(m) order by id) from athletics_class_marks m where session_id=relay_sid) then raise exception 'Late team changed recorded marks';end if;
 if not exists(select 1 from athletics_class_relay_teams where session_id=relay_sid and name='Team 10' and heat_number=2 and lane=3) then raise exception 'Late relay team not appended to last pending series';end if;
 perform athletics_save_class_roster_and_series(relay_sid,males);
 perform athletics_plan_class_relay(relay_sid,2,array[2,4,7],teams);
 if exists(select 1 from athletics_class_relay_teams where session_id=relay_sid and attempt_no=2 and not lane=any(array[2,4,7])) or (select count(*) from athletics_class_relay_legs where session_id=relay_sid and attempt_no=2)<>40 then raise exception 'Next relay round lost teams or used wrong lanes';end if;
 if before_marks is distinct from (select jsonb_agg(to_jsonb(m) order by id) from athletics_class_marks m where session_id=relay_sid) then raise exception 'Next relay round overwrote times';end if;
 -- No anonymous or unrelated user may create a round.
 perform set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000000',true);outcome:=false;begin perform athletics_create_class_round(sid,array[1,2],'mixed',ids[1:4]);exception when others then outcome:=true;end;if not outcome then raise exception 'Unauthorized creator admitted';end if;
end $$;
rollback;
select 'PASS automatic sizes, selected lanes, sex isolation, late pairing, retry safety, locked results, complete relay teams and next rounds. All fixture writes rolled back.' as result;
