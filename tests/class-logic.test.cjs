const {test}=require('node:test');const assert=require('node:assert/strict');const L=require('../craighouse/logic.js');
test('All Genders admits both sexes without altering individual gender',()=>{const s={category:'Y8',gender:'All'},f={active:true,level:'Y8',gender:'F'},m={active:true,level:'Y8',gender:'M'};assert.ok(L.eligible(f,s));assert.ok(L.eligible(m,s));assert.equal(f.gender,'F');assert.equal(m.gender,'M');assert.equal(L.eligible({...m,active:false},s),false);assert.equal(L.eligible(m,{...s,gender:'F'}),false)});
test('marks support decimal comma and reject invalid inputs',()=>{assert.equal(L.parseMark('12,45'),12.45);assert.equal(L.parseMark(''),null);for(const v of ['-2','0','Infinity','abc','1:20','1000000'])assert.throws(()=>L.parseMark(v))});
test('personal bests separate event, gender, category and equipment; lower time wins',()=>{const r={athlete_id:'a',event_name:'100 m',category:'Y8',gender:'M',conditions:'manual',unit:'s',status:'valid',mark:13};const rows=[r,{...r,mark:12},{...r,mark:11,status:'dq'},{...r,category:'Senior',mark:14},{...r,conditions:'electronic',mark:13.5}];const best=L.bestMarks(rows);assert.equal(best.length,3);assert.equal(best[0].mark,12)});
test('field personal best uses maximum and keeps different athletes',()=>{const r={athlete_id:'a',event_name:'Long Jump',category:'Y8',gender:'F',unit:'m',status:'valid',mark:4};const best=L.bestMarks([r,{...r,mark:4.5},{...r,athlete_id:'b',mark:4.3},{...r,mark:null}]);assert.equal(best.length,2);assert.equal(best[0].mark,4.5)});
test('multiple categories admit selected years only and preserve gender',()=>{const s={category:'All',categories:['Y7','Y8'],gender:'All'};assert.ok(L.eligible({active:true,level:'Y7',gender:'F'},s));assert.ok(L.eligible({active:true,level:'Y8',gender:'M'},s));assert.equal(L.eligible({active:true,level:'Senior',gender:'M'},s),false)});
test('Class Photo Finish saves only through the class RPC and verifies class sheet',async()=>{const adapter=require('../photo-finish/class-mode.js');const calls=[];const sb={rpc:async(n,p)=>{calls.push([n,p]);return {data:[]}},from:n=>{calls.push(n);assert.equal(n,'athletics_class_series_sheet');const q={select(){return q},eq(){return q},in(){return Promise.resolve({data:[{id:'entry',official_time:12.345,status:'finished'}]})}};return q}};const result=await adapter.create(sb,'class-heat').save([{entryId:'entry',sec:12.345}]);assert.equal(result[0].official_time,12.345);assert.equal(calls[0][0],'athletics_save_class_heat');assert.equal(calls[0][1].p_heat_id,'class-heat');assert.equal(calls[0][1].p_results[0].status,'finished')});
test('Class Photo Finish rejects a failed RPC before verification',async()=>{const adapter=require('../photo-finish/class-mode.js');await assert.rejects(adapter.create({rpc:async()=>({error:{message:'offline'}}),from:()=>{throw Error('must not verify a failed save')}},'heat').save([{entryId:'entry',sec:12}]),/offline/)});

test('attendance filters combine gender, colour and search within activity eligibility',()=>{
 const session={gender:'All',categories:['Y7','Y8']};const girl={active:true,gender:'F',color:'Blue',level:'Y7',first_name:'Ana',last_name:'Test',external_code:'C123'};
 assert.ok(L.attendanceMatches(girl,session,{gender:'F',color:'Blue',query:'c123'}));
 assert.equal(L.attendanceMatches(girl,session,{gender:'M',color:'Blue'}),false);
 assert.equal(L.attendanceMatches(girl,session,{gender:'F',color:'Red'}),false);
 assert.equal(L.attendanceMatches(girl,{...session,gender:'M'},{gender:'All',color:'All'}),false);
 assert.equal(L.attendanceMatches(girl,{...session,categories:['Y8']}),false);
 assert.ok(L.attendanceMatches(girl,session,{query:' ANA '}));
});
test('clock times convert to numeric seconds, accept decimal comma, and validate seconds/hundredths',()=>{
 assert.equal(L.parseTime('1:23.45'),83.45);assert.equal(L.parseTime('2:05,07'),125.07);assert.equal(L.parseTime('83.456'),83.456);assert.equal(L.parseTime(''),null);
 for(const value of ['1:60.00','1:99.12','1:2.34','1:23.456','-1:20.00','0:00.00','1:20:30'])assert.throws(()=>L.parseTime(value));
 assert.equal(L.formatTime(59.999),'1:00.00');assert.equal(L.formatTime(83.456),'1:23.46');assert.equal(L.formatTime(null),'');assert.equal(L.formatTime(125.07),'2:05.07');
});
test('400/600/800 and relays use clock display while short track and field keep existing units',()=>{
 for(const name of ['400 m','600m','800 mts'])assert.ok(L.usesClock({name,discipline:'track'}));assert.ok(L.usesClock({name:'4 x 100 m',discipline:'relay'}));
 assert.equal(L.usesClock({name:'100 m',discipline:'track'}),false);assert.equal(L.usesClock({name:'Long Jump',discipline:'field'}),false);
 const rows=[{athlete_id:'a',event_name:'800 m',category:'Y7',gender:'F',unit:'s',status:'valid',mark:L.parseTime('2:05.23')},{athlete_id:'a',event_name:'800 m',category:'Y7',gender:'F',unit:'s',status:'valid',mark:L.parseTime('1:59.99')}];assert.equal(L.bestMarks(rows)[0].mark,119.99);
});

test('high jump uses school competition rules and selects highest cleared height',()=>{
 const heights=[{id:'a',height_m:1.1,sequence_no:1},{id:'b',height_m:1.2,sequence_no:2},{id:'c',height_m:1.3,sequence_no:3}];
 assert.equal(L.isHighJump({code:'HJ'}),true);assert.equal(L.isHighJump({name:'High Jump'}),true);assert.equal(L.isHighJump({name:'Long Jump'}),false);
 assert.deepEqual(L.highJumpState(heights,{a:['X','X',''],b:['X','O','']}),{best:1.2,eliminatedAt:null});
 assert.deepEqual(L.highJumpState(heights,{a:['-','',''],b:['O','',''],c:['X','X','X']}),{best:1.2,eliminatedAt:3});
 assert.deepEqual(L.highJumpEdit({a:['X','X','O']},'a',0,'X'),{a:['X','X','O']});
 assert.deepEqual(L.highJumpEdit({a:['X','X','O']},'a',0,'O'),{a:['O','','']});
 assert.throws(()=>L.highJumpEdit({},'a',1,'O'));assert.throws(()=>L.highJumpEdit({a:['X','','']},'a',1,'-'));
});
test('relay slots follow the event, including five runners and configurable Inglesa',()=>{
 assert.equal(L.relaySize({name:'Relay 4x400 m',relay_legs:4}),4);
 assert.equal(L.relaySize({name:'Relay 5x300 m',relay_legs:5}),5);
 assert.equal(L.relaySize({name:'Relay 8x50 m'}),8);
 assert.equal(L.relaySize({name:'Relay Inglesa'}),4);
 for(const name of ['Relay 4x400 m','Relay 5x300 m','Relay Inglesa'])assert.equal(L.usesClock({name,discipline:'relay'}),true);
 for(const name of ['Hurdles 60 m','Hurdles 80 m'])assert.equal(L.usesClock({name,discipline:'track'}),false);
});
