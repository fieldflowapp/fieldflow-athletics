'use strict';
// Planning stays outside Photo Finish; persisted entry IDs remain its integration contract.
function lanePicker(title){return `<fieldset class="lane-picker"><legend>${title}</legend><div class="lane-options">${Array.from({length:8},(_,i)=>`<label><input type="checkbox" value="${i+1}" checked><span>${i+1}</span></label>`).join('')}</div><small class="muted">Select the lanes available, from 1 to 8.</small></fieldset>`}
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
 const open=L.isOpenTrack(eventForSession());
 $('trackLanes').hidden=open;$('trackCapacity').closest('label').hidden=open;$('trackLaneSummary').hidden=open;
 $('roundSetup').querySelector('summary').textContent=open?'Students for the next round':'Students & lanes for the next round';
 try{
  const lanes=open?[]:readLanes('trackLanes'),athletes=availableAthletes().filter(a=>S.roundSelection.has(a.id)),plan=open?L.planOpenSeries(athletes,$('heatMode').value):L.planSeries(athletes,lanes,$('heatMode').value);
  $('seriesPreview').textContent=plan.length?`${open?'Open start · ':''}${athletes.length} students · ${open?'no assigned lanes':lanes.length+' lanes'} · ${plan.length} series: `+plan.map(h=>`${h.gender==='All'?'Mixed':h.gender==='F'?'Female':'Male'} ${h.entries.length}`).join(' / '):'Select students for this round.';
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
$('trackLanes').innerHTML=lanePicker('Lanes to use');
$('relayLanes').innerHTML=lanePicker('Lanes to use · one complete team per lane');
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

function seedTrackSeries(qualified, lanes, stage){
 const seriesCount=stage==='final'?1:Math.ceil(qualified.length/lanes.length);
 const centre=(lanes[0]+lanes.at(-1))/2;
 const preferred=[...lanes].sort((a,b)=>Math.abs(a-centre)-Math.abs(b-centre)||a-b);
 return qualified.map((runner,index)=>{
  const group=Math.floor(index/seriesCount);
  const slot=index%seriesCount;
  return {...runner,series:1+(group%2?seriesCount-1-slot:slot),lane:preferred[group]};
 });
}

function renderSeededRoundControl(){
 const host=$('seededRoundControl');
 const event=eventForSession();
 if(!host||S.root.closed_at||event.discipline!=='track'||L.isOpenTrack(event)||!S.heats.length)return;
 const source=Math.max(...S.heats.map(h=>h.round_no));
 if(S.roundSettings.some(r=>r.round_no===source&&r.stage==='final'))return;
 const complete=S.heats.filter(h=>h.round_no===source).every(h=>h.status==='completed');
 const athletes=new Map(availableAthletes().map(a=>[a.id,a]));
 const ranked=S.series.filter(e=>e.round_no===source&&e.status==='finished'&&Number(e.official_time)>0&&athletes.has(e.athlete_id))
  .map(e=>({athlete_id:e.athlete_id,time:Number(e.official_time)})).sort((a,b)=>a.time-b.time);
 if(!complete||!ranked.length){
  host.textContent=complete?'No available students with valid times in the latest round.':'Complete every series in the latest round to qualify students by time.';
  return;
 }
 const sessionId=S.session.id;
 const formatTime=time=>fmt({mark:time,unit:'s',event_name:event.name});
 host.innerHTML=`<details><summary>Create next round by time</summary><p>${esc(event.name)} · Round ${source} · ${ranked.length} eligible</p>
 <label>Round type<select id="seededStage"><option value="final">Final</option><option value="second">Second stage</option></select></label>
 <div id="seededLanes">${lanePicker('Available lanes')}</div>
 <label>Number of qualifiers<input id="seededCount" type="number" min="1" max="${ranked.length}" step="1"></label>
 <div id="seededTie"></div><div id="seededPreview" aria-live="polite"></div><button id="saveSeededRound" class="primary">Confirm and open timing</button></details>`;
 const stage=$('seededStage'), count=$('seededCount'), tie=$('seededTie'), preview=$('seededPreview'), save=$('saveSeededRound');
 const previous=S.roundSettings.find(r=>r.round_no===source);
 if(previous?.lanes?.length)setLanes('seededLanes',previous.lanes);
 const selectedSeedLanes=()=>[...$('seededLanes').querySelectorAll('input:checked')].map(input=>Number(input.value));
 let plan=[];
 function render(resetTie=false){
  plan=[];
  save.disabled=true;
  if(resetTie)tie.replaceChildren();
  const lanes=selectedSeedLanes(), limit=Number(count.value);
  if(!lanes.length||!Number.isInteger(limit)||limit<1||limit>ranked.length||(stage.value==='final'&&limit>lanes.length)){
   preview.textContent='Choose available lanes and a valid number of qualifiers. A final must fit in one series.';
   return;
  }
  const cutoff=ranked[limit-1].time;
  const faster=ranked.filter(r=>r.time<cutoff);
  const tied=ranked.filter(r=>r.time===cutoff);
  const slots=limit-faster.length;
  let selected=tied;
  if(tied.length>slots){
   if(resetTie)tie.innerHTML=`<fieldset><legend>Tie at ${esc(formatTime(cutoff))}. Select ${slots} of ${tied.length} students.</legend>${tied.map(r=>`<label class="attendance-student"><input type="checkbox" value="${esc(r.athlete_id)}"> ${esc(name(athletes.get(r.athlete_id)))}</label>`).join('')}</fieldset>`;
   const checkedIds=new Set([...tie.querySelectorAll('input:checked')].map(input=>input.value));
   selected=tied.filter(r=>checkedIds.has(r.athlete_id));
   if(selected.length!==slots){preview.textContent='Resolve the tie to preview the series.';return}
  }
  plan=seedTrackSeries([...faster,...selected],lanes,stage.value);
  preview.innerHTML=Array.from({length:Math.max(...plan.map(r=>r.series))},(_,index)=>`<h4>Series ${index+1}</h4><ul>${plan.filter(r=>r.series===index+1).map(r=>`<li>Lane ${r.lane} · ${esc(name(athletes.get(r.athlete_id)))} · ${esc(formatTime(r.time))}</li>`).join('')}</ul>`).join('');
  save.disabled=false;
 }
 function resetCount(){
  const lanes=selectedSeedLanes();
  count.value=Math.min(ranked.length,lanes.length*(stage.value==='final'?1:2));
  render(true);
 }
 stage.onchange=resetCount;
 $('seededLanes').onchange=()=>render(true);
 count.oninput=()=>render(true);
 tie.onchange=()=>render();
 save.onclick=async()=>{
  if(!plan.length||S.busy||S.session.id!==sessionId||!proceed())return;
  save.disabled=true;
  await run(async()=>{
   const heats=await checked(sb.rpc('athletics_seed_class_round',{p_session_id:sessionId,p_source_round:source,p_stage:stage.value,p_lanes:selectedSeedLanes(),p_entries:plan}));
   if(!heats?.length)throw Error('Unable to verify the new round.');
   await loadSessionData();
   clearClassDrafts();S.round=heats[0].round_no;S.selectedHeat=null;S.sessionHome=false;
   showSessionStep('record');
   notice(`Round ${S.round} is ready for timing.`,'success');
  });
  if(save.isConnected)render();
 };
 resetCount();
}
