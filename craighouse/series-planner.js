'use strict';
// Planning stays outside Photo Finish; persisted entry IDs remain its integration contract.
function lanePicker(id,title){return `<fieldset class="lane-picker"><legend>${title}</legend><div class="lane-options">${Array.from({length:8},(_,i)=>`<label><input type="checkbox" value="${i+1}" checked><span>${i+1}</span></label>`).join('')}</div><small class="muted">Select the lanes available, from 1 to 8.</small></fieldset>`}
function readLanes(id){return L.selectedLanes([...$(id).querySelectorAll('input:checked')].map(x=>Number(x.value)))}
function setLanes(id,lanes){$(id).querySelectorAll('input').forEach(x=>x.checked=lanes.includes(Number(x.value)))}
// Count selects a contiguous track; individual checkboxes still support closed lanes.
function syncTrackCapacity(){
 const lanes=[...$('trackLanes').querySelectorAll('input:checked')].map(input=>input.value);
 $('trackCapacity').value=String(lanes.length);
 $('trackLaneSummary').textContent=lanes.length?'Active lanes: '+lanes.join(', '):'Select at least one lane.';
}
function restoreSeriesSettings(){
 const cfg=[...S.roundSettings].sort((a,b)=>b.round_no-a.round_no).find(x=>x.kind===eventForSession().discipline);
 const lanes=cfg?.lanes||[1,2,3,4,5,6,7,8];setLanes('trackLanes',lanes);setLanes('relayLanes',lanes);syncTrackCapacity();
 $('heatMode').value=cfg?.mode||(S.session.gender==='All'?'mixed':'gender');
}
function seriesPreview(){
 try{
  const lanes=readLanes('trackLanes'),athletes=availableAthletes().filter(a=>S.roundSelection.has(a.id)),plan=L.planSeries(athletes,lanes,$('heatMode').value);
  $('seriesPreview').textContent=plan.length?`${athletes.length} students · ${lanes.length} lanes · ${plan.length} series: `+plan.map(h=>`${h.gender==='All'?'Mixed':h.gender==='F'?'Female':'Male'} ${h.entries.length}`).join(' / '):'Select students for this round.';
  $('generateHeats').disabled=S.busy||!athletes.length;
 }catch(e){$('seriesPreview').textContent=e.message;$('generateHeats').disabled=true}
}
function relaySeriesPreview(){
 try{const lanes=readLanes('relayLanes'),count=($('teamCards')?.children.length||0)+relayGroups().filter(relaySeriesLocked).length;$('relaySeriesPreview').textContent=count?`${count} teams · ${lanes.length} lanes · ${L.seriesSizes(count,lanes.length).join(' + ')} teams per series`:'Choose the teams, then the lanes.'}catch(e){$('relaySeriesPreview').textContent=e.message}
}
function relaySeriesLocked(group){return S.marks.some(m=>m.attempt_no===S.attempt&&S.legs.some(l=>l.athlete_id===m.athlete_id&&S.teams.some(t=>t.id===l.team_id&&t.attempt_no===S.attempt&&t.heat_number===group.heat_number)))}
async function nextRelayRound(){
 if(!proceed())return;
 const groups=relayGroups(),available=new Set(availableAthletes().map(a=>a.id));
 if(!groups.length){notice('Save teams before creating the next round.','error');return}
 const teams=groups.filter(g=>g.athletes.length&&g.athletes.every(a=>available.has(a.id))).map(g=>({name:g.name,athletes:g.athletes.map(a=>a.id)}));
 if(!teams.length){notice('Select available team members before creating the next round.','error');return}
 await run(async()=>{
  const round=Math.max(0,...S.teams.map(t=>t.attempt_no),...S.marks.map(m=>m.attempt_no))+1;
  const saved=await checked(sb.rpc('athletics_plan_class_relay',{p_session_id:S.session.id,p_attempt:round,p_lanes:readLanes('relayLanes'),p_teams:teams}));
  if(saved.length!==teams.length)throw Error('Unable to verify every team in the new round.');
  S.attempt=round;$('relayAttempt').value=round;clearClassDrafts();await loadSessionData();renderRelay();notice(`Round ${round} created. Previous team times preserved.${teams.length<groups.length?' Teams with unavailable members were not copied; each remaining team stays complete.':''}`,'success');
 });
}
$('trackLanes').innerHTML=lanePicker('trackLanes','Lanes to use');
$('relayLanes').innerHTML=lanePicker('relayLanes','Lanes to use · one complete team per lane');
$('trackLanes').insertAdjacentHTML('beforebegin','<label>Number of available lanes<select id="trackCapacity"><option value="0" disabled>Choose lanes</option>'+Array.from({length:8},(_,i)=>option(i+1,(i+1)+' lanes')).join('')+'</select></label><p id="trackLaneSummary" aria-live="polite"></p>');
syncTrackCapacity();
$('trackCapacity').onchange=()=>{
 const count=Number($('trackCapacity').value);
 setLanes('trackLanes',Array.from({length:count},(_,i)=>i+1));
 syncTrackCapacity();
 seriesPreview();
};
$('trackLanes').onchange=()=>{syncTrackCapacity();seriesPreview()};$('heatMode').onchange=seriesPreview;
$('relayLanes').onchange=relaySeriesPreview;
$('roundParticipants').addEventListener('change',seriesPreview);
for(const id of ['allRound','noneRound'])$(id).addEventListener('click',seriesPreview);
$('nextRelayAttempt').textContent='Next round';$('nextRelayAttempt').onclick=nextRelayRound;
