'use strict';
// Presentation only: session, attendance, series and saved mark identities are unchanged.
function syncWorkspace(){
 const active=!!S.session&&!S.sessionHome;
 document.body.classList.toggle('session-open',active);
 document.body.classList.toggle('heat-focus',active&&S.step==='record'&&eventForSession()?.discipline==='track'&&!!S.selectedHeat);
 $('sessionWorkspace').hidden=!active;
 $('sessionsBack').hidden=!S.session;
 $('eventSettingsBtn').hidden=S.step==='summary';
 if(active){$('sessionSetup').open=false;}
}
function seriesForRound(){return S.heats.filter(h=>h.round_no===S.round)}
function selectSeries(id,scroll=true){
 // Drafts stay in memory when moving between series. Leaving the activity still prompts.
 S.selectedHeat=id;renderSeriesNavigation();
 if(scroll)requestAnimationFrame(()=>{const target=id?$('class-heat-'+id):$('seriesDirectory');target?.scrollIntoView({block:'start',behavior:'instant'});target?.focus({preventScroll:true})});
}
function renderSeriesNavigation(){
 const heats=seriesForRound(),key=S.session.id+':'+S.round;
 if(S.heatViewKey!==key){S.heatViewKey=key;S.selectedHeat=null}
 if(!heats.some(h=>h.id===S.selectedHeat))S.selectedHeat=null;
 $('roundSetup').open=!S.heats.length;
 const selected=heats.find(h=>h.id===S.selectedHeat),index=heats.indexOf(selected);
 syncWorkspace();
 $('trackControls').classList.toggle('series-open',!!selected);
 $('seriesDirectory').hidden=!!selected;
 $('seriesDirectory').tabIndex=-1;
 $('seriesDirectory').innerHTML=heats.length?`<div class="directory-heading"><h2>${heats.length} series</h2><span>Round ${S.round}</span></div>`+heats.map(h=>{
  const entries=S.series.filter(e=>e.heat_id===h.id),saved=entries.filter(e=>e.status!=='scheduled').length;
  const gender=h.gender==='All'?'Mixed':h.gender==='F'?'Female':'Male';
  return `<button class="series-tile" data-open-series="${h.id}"><span class="series-number">${h.heat_number}</span><span><b>Series ${h.heat_number} · ${gender}</b><small>${entries.length} runners · ${saved}/${entries.length} recorded</small></span><span class="series-state">${h.status==='completed'?'Complete ✓':saved?'In progress':'Pending'} ›</span></button>`;
 }).join(''):'';
 $('seriesNavigator').hidden=!selected;
 $('seriesNavigator').innerHTML=selected?`<button id="allSeries">‹ All series</button><span>${esc(eventForSession().name)} · Round ${S.round} · ${index+1}/${heats.length}</span><div class="series-switch"><button id="previousSeries" ${index===0?'hidden':''}>‹ Previous</button><button id="nextSeries" ${index===heats.length-1?'hidden':''}>Next series ›</button></div>`:'';
 document.querySelectorAll('#heatList .heat-card').forEach(card=>{
  card.hidden=card.id!=='class-heat-'+S.selectedHeat;
  const actions=card.querySelector('.filters'),photo=card.querySelector('.photo-link');
  actions?.classList.add('series-actions');if(photo&&actions)actions.prepend(photo);
 });
 if(selected){$('allSeries').onclick=()=>selectSeries(null);$('previousSeries').onclick=()=>selectSeries(heats[index-1]?.id||null);$('nextSeries').onclick=()=>selectSeries(heats[index+1]?.id||null)}
 document.querySelectorAll('[data-open-series]').forEach(button=>button.onclick=()=>selectSeries(button.dataset.openSeries));
}
$('sessionsBack').onclick=()=>{if(!proceed())return;clearClassDrafts();S.sessionHome=true;syncWorkspace();window.scrollTo(0,0)};
$('eventSettingsBtn').onclick=()=>{const open=!document.body.classList.contains('event-options');document.body.classList.toggle('event-options',open);$('eventSettingsBtn').setAttribute('aria-expanded',String(open))};
// Keep event configuration out of the normal recording route on a phone.
const originalRenderActivityControls=renderActivityControls;
renderActivityControls=function(){originalRenderActivityControls();document.body.classList.remove('event-options');$('eventSettingsBtn').setAttribute('aria-expanded','false')};
$('attendanceStepBtn').textContent='Attendance';$('recordStepBtn').textContent='Record';$('summaryStepBtn').textContent='Summary';
$('classTab').textContent='Classes';$('databaseTab').textContent='Athletes';$('rankTab').textContent='Rankings';
syncWorkspace();run(boot);
