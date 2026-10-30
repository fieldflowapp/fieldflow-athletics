-- Class-only catalog. Run after official selectors support the class_only flag.
-- Class activity selection supplies categories/gender independently of the template.
insert into public.athletics_events(tournament_id,code,name,discipline,category,gender,distance_m,relay_legs,relay_leg_distance_m,attempt_limit,start_mode,sort_order,class_only,status,source_note)
select t.id,x.code,x.name,x.discipline,'Senior','M',x.distance_m,x.legs,x.leg_distance,x.attempts,x.start_mode,1000+x.ord,true,'disabled','Class Mode only · all levels; gender selected per activity'
from public.tournaments t cross join (values
 ('CLASS_4X400','Relay 4x400 m','relay',1600,4,400,null::integer,null::text,1),
 ('CLASS_5X300','Relay 5x300 m','relay',1500,5,300,null,null,2),
 ('CLASS_INGLESA','Relay Inglesa','relay',null,null,null,null,null,3),
 ('CLASS_60H','Hurdles 60 m','track',60,null,null,null,'lanes',4),
 ('CLASS_80H','Hurdles 80 m','track',80,null,null,null,'lanes',5),
 ('CLASS_DISCUS','Discus Throw','field',null,null,null,3,null,6)
) x(code,name,discipline,distance_m,legs,leg_distance,attempts,start_mode,ord)
where t.slug='intercolour-athletics-2026'
on conflict(tournament_id,code,category,gender) do nothing;
