'use strict';
// Class Mode event-first navigation; existing saved sessions remain the storage identity.
(function(){
 const route=$('eventRoute'),chooser=$('eventChooser'),setup=$('eventSetupRoute'),previous=$('previousRoute');
 let selectedEvent=null,discipline='track';
 const routeTo=(page,addHistory=true)=>{
  if(page!=='workspace'&&!proceed())return;
  chooser.hidden=page!=='choose';setup.hidden=page!=='setup';previous.hidden=page!=='previous';
  route.hidden=page==='workspace';
  $('sessionHome').hidden=true;
  $('sessionWorkspace').hidden=page!=='workspace';
  document.body.classList.toggle('class-event-home',page!=='workspace');
  document.body.classList.toggle('class-event-workspace',page==='workspace');
  if(page!=='workspace'){S.sessionHome=true;document.body.classList.remove('session-open','heat-focus');}
  if(addHistory){const url=new URL(location.href);url.searchParams.delete('session');url.searchParams.delete('focusHeat');url.searchParams.set('classRoute',page);history.pushState({classRoute:page},'',url);}
  window.scrollTo(0,0);
 };
 const groups=()=>[...new Map(S.events.map(e=>[e.name,e])).values()];
 const renderEvents=()=>{
  document.querySelectorAll('.class-event-tabs button').forEach(b=>b.classList.toggle('active',b.dataset.discipline===discipline));
  $('eventTiles').innerHTML=groups().filter(e=>e.discipline===discipline).map(e=>'<button type="button" class="class-event-tile" data-event="'+esc(e.id)+'"><span><b>'+esc(e.name)+'</b><small>'+esc(e.discipline==='field'?'Distance / height':e.discipline==='relay'?'Team time':'Running times')+'</small></span><span>›</span></button>').join('')||'<p>No events available.</p>';
  $('eventTiles').querySelectorAll('[data-event]').forEach(b=>b.onclick=()=>selectEvent(b.dataset.event));
 };
 const selectEvent=id=>{
  selectedEvent=S.events.find(e=>e.id===id);if(!selectedEvent)return;
  $('event').value=id;updateGenderOptions();
  $('chosenEventTitle').textContent=selectedEvent.name;
  const years=[...document.querySelectorAll('#categoryChoices input')].map(x=>x.value);
  $('quickYears').innerHTML=years.map(l=>'<label><input type="checkbox" value="'+esc(l)+'">'+esc(l)+'</label>').join('');
  $('quickGender').value=selectedEvent.discipline==='relay'?'M':'All';
  $('quickGender').querySelector('option[value="All"]').disabled=selectedEvent.discipline==='relay';
  $('quickDate').value=$('date').value;
  $('routeHeading').textContent='Set up event';$('routeHint').textContent='Choose the Years, then add athletes.';
  routeTo('setup');
 };
 const renderPrevious=()=>{
  const q=$('previousSearch').value.trim().toLowerCase();
  $('previousTiles').innerHTML=S.sessions.filter(s=>!s.parent_session_id).filter(s=>[s.title,s.session_date,s.category,...(s.categories||[])].join(' ').toLowerCase().includes(q)).map(s=>'<button type="button" class="class-event-tile" data-old="'+esc(s.id)+'"><span><b>'+esc(S.events.find(e=>e.id===s.template_event_id)?.name||s.title)+'</b><small>'+esc(s.session_date+' · '+(s.categories?.join(', ')||s.category)+' · '+(s.gender==='F'?'Girls':s.gender==='M'?'Boys':'All'))+'</small></span><span>›</span></button>').join('')||'<p>No matching saved events.</p>';
  $('previousTiles').querySelectorAll('[data-old]').forEach(b=>b.onclick=()=>{const session=S.sessions.find(s=>s.id===b.dataset.old);if(session&&proceed())run(()=>openSession(session));});
 };
 document.querySelectorAll('.class-event-tabs button').forEach(b=>b.onclick=()=>{discipline=b.dataset.discipline;renderEvents();});
 $('previousEvents').onclick=()=>{renderPrevious();$('routeHeading').textContent='Previous events';$('routeHint').textContent='Reopen an event and add late results.';routeTo('previous');};
 $('previousSearch').oninput=renderPrevious;
 const home=()=>{if(!proceed())return;S.session=null;S.sessionHome=true;selectedEvent=null;$('routeHeading').textContent='Select event';$('routeHint').textContent='Choose a discipline to record a class performance.';renderEvents();routeTo('choose');};
 $('backToEvents').onclick=home;$('backFromPrevious').onclick=home;
 $('quickEventForm').onsubmit=e=>{
  e.preventDefault();
  if(!selectedEvent)return;
  const years=[...$('quickYears').querySelectorAll('input:checked')].map(x=>x.value);
  if(!years.length){notice('Choose at least one Year.','error');return;}
  document.querySelectorAll('#categoryChoices input').forEach(x=>x.checked=years.includes(x.value));
  $('gender').value=$('quickGender').value;$('date').value=$('quickDate').value;
  $('title').value=selectedEvent.name+' · '+years.join(' + ')+' · '+($('gender').value==='F'?'Girls':$('gender').value==='M'?'Boys':'Mixed');
  $('source').value='class';$('conditions').value='';
  $('sessionForm').requestSubmit();
 };
 const originalOpen=openSession;
 openSession=async function(session){await originalOpen(session);routeTo('workspace',false);const u=new URL(location.href);u.searchParams.delete('classRoute');u.searchParams.set('session',session.id);history.replaceState({classRoute:'workspace'},'',u);};
 $('sessionsBack').onclick=home;
 const originalSync=syncWorkspace;
 syncWorkspace=function(){originalSync();if(S.session&&!S.sessionHome){route.hidden=true;$('sessionHome').hidden=true;$('sessionWorkspace').hidden=false;}else{$('sessionWorkspace').hidden=true;$('sessionHome').hidden=true;}};
 window.addEventListener('popstate',()=>{if(S.dirty)return;const url=new URL(location.href),page=url.searchParams.get('classRoute');if(page==='previous'){renderPrevious();routeTo('previous',false)}else if(page==='setup'&&selectedEvent)routeTo('setup',false);else if(page==='choose'||!url.searchParams.has('session')){renderEvents();routeTo('choose',false)}});
 const initialize=()=>{
  if($('app').hidden||!S.tournament)return false;
  renderEvents();
  if(!S.session){routeTo('choose',false);}else{routeTo('workspace',false);}
  return true;
 };
 if(!initialize()){const observer=new MutationObserver(()=>{if(initialize())observer.disconnect()});observer.observe($('app'),{attributes:true,attributeFilter:['hidden']});}
})();