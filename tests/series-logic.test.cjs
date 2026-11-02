const {test}=require('node:test'),assert=require('node:assert/strict');
const L=require('../craighouse/logic.js');
test('full series leave at least two in the last series when possible',()=>{
 for(const [count,sizes] of [[0,[]],[1,[1]],[8,[8]],[9,[7,2]],[10,[8,2]],[17,[8,7,2]],[18,[8,8,2]],[19,[8,8,3]],[24,[8,8,8]]])assert.deepEqual(L.seriesSizes(count,8),sizes);
});
test('all participant counts and lane limits conserve runners without exceeding capacity',()=>{
 for(let capacity=1;capacity<=8;capacity++)for(let count=1;count<=160;count++){
  const sizes=L.seriesSizes(count,capacity);assert.equal(sizes.reduce((a,b)=>a+b,0),count);assert.equal(sizes.length,Math.ceil(count/capacity));assert.ok(sizes.every(n=>n>0&&n<=capacity));
  if(capacity>=3&&count>1)assert.ok(sizes.every(n=>n>=2));
 }
});
test('mixed and gender-separated plans use only the actual selected lanes',()=>{
 const athletes=Array.from({length:19},(_,i)=>({id:String(i),gender:i<10?'F':'M'}));
 for(const mode of ['mixed','gender']){
  const plan=L.planSeries(athletes,[2,4,7],mode),entries=plan.flatMap(h=>h.entries);assert.equal(entries.length,19);assert.equal(new Set(entries.map(e=>e.athlete_id)).size,19);
  for(const heat of plan){assert.ok(heat.entries.every(e=>[2,4,7].includes(e.lane)));assert.equal(new Set(heat.entries.map(e=>e.lane)).size,heat.entries.length);if(mode==='gender')assert.ok(heat.entries.every(e=>athletes.find(a=>a.id===e.athlete_id).gender===heat.gender));}
 }
 assert.deepEqual(L.planSeries(athletes,[1,2,3,4,5,6,7,8],'gender').map(h=>h.entries.length),[8,2,8,1]);
});
test('invalid/empty/duplicate lanes and duplicate participants are rejected',()=>{
 for(const lanes of [[],[0],[9],[1,1],[1.5],[NaN]])assert.throws(()=>L.selectedLanes(lanes));
 assert.throws(()=>L.planSeries([{id:'a'},{id:'a'}],[1]));assert.throws(()=>L.seriesSizes(-1,8));
});

test('six selected lanes fill each gender independently',()=>{
 const roster=Array.from({length:32},(_,i)=>({id:i,gender:i<14?'F':'M'}));
 const heats=L.planSeries(roster,[1,2,3,4,5,6],'gender');
 assert.deepEqual(heats.map(h=>[h.gender,h.entries.length]),[['F',6],['F',6],['F',2],['M',6],['M',6],['M',6]]);
});
