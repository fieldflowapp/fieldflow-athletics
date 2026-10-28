'use strict';
function hjTrials(id){return S.hjDraft.get(id)?.trials||S.hjCards.find(c=>c.athlete_id===id)?.trials||{}}
function renderHighJump(){
 if(!S.hjHeights.some(h=>h.id===S.hjHeight))S.hjHeight=S.hjHeights.at(-1)?.id||null;
 const height=S.hjHeights.find(h=>h.id===S.hjHeight);
 const athletes=S.athletes.filter(a=>S.attendance.some(x=>x.athlete_id===a.id&&x.present&&x.available!==false)||S.hjCards.some(c=>c.athlete_id===a.id));
 $('highJumpControls').innerHTML=`<div class="hj-top"><label>Current height<select id="hjHeightPicker">${S.hjHeights.map(h=>option(h.id,Number(h.height_m).toFixed(2)+' m')).join('')}</select></label><details ${height?'':'open'}><summary>Add height</summary><div class="filters"><label>Height (m)<input id="hjNewHeight" inputmode="decimal" placeholder="1.20"></label><button id="hjAddHeight">Add height</button></div></details></div><p class="muted">O = clear · X = miss · – = pass on attempt 1. Three X at the same height = eliminated. Best cleared height is saved automatically with the attempts.</p><div id="hjAthletes">${height?athletes.map(a=>{
 const trials=hjTrials(a.id),state=L.highJumpState(S.hjHeights,trials),values=trials[height.id]||['','',''];const closed=state.eliminatedAt!==null&&height.sequence_no>state.eliminatedAt;
 const saved=S.hjCards.find(c=>c.athlete_id===a.id);
 return `<article class="hj-athlete" data-hj-athlete="${a.id}"><div class="hj-athlete-heading"><div><b>${esc(name(a))}</b><small>${esc(a.level)} · ${a.gender==='F'?'Female':'Male'} · ${esc(a.color)}</small></div><span class="hj-best">Best ${state.best==null?'—':state.best.toFixed(2)+' m'}<small>${S.hjDraft.has(a.id)?'Unsaved':'Saved'}</small></span></div>${closed?'<p class="hj-eliminated">Closed · eliminated at an earlier height</p>':`<div class="hj-attempts">${values.map((value,i)=>{
 const done=i>0&&values.slice(0,i).some(v=>['O','-'].includes(v)),waiting=i>0&&values[i-1]!=='X';
 return `<div><span class="hj-attempt-label">Attempt ${i+1}</span>${done?'<p class="muted">Done</p>':waiting?'<p class="muted">Waiting</p>':`<div class="hj-buttons">${['O','X',...(i===0?['-']:[])].map(v=>`<button data-hj-index="${i}" data-hj-value="${v}" aria-label="Attempt ${i+1}: ${v==='O'?'clear':v==='X'?'miss':'pass'}" aria-pressed="${value===v}" class="${value===v?'chosen-'+(v==='O'?'clear':v==='X'?'miss':'pass'):''}">${v==='-'?'–':v}</button>`).join('')}</div>${value?`<button class="hj-undo" data-hj-index="${i}" data-hj-value="">Undo</button>`:''}`}</div>`;
 }).join('')}</div>${values.every(v=>v==='X')?'<p class="hj-eliminated">Eliminated · three misses at this height</p>':''}`}</article>`;
 }).join(''):'<p>Add the first height to begin.</p>'}</div><div class="hj-savebar"><span id="hjSaveState">${S.hjDraft.size?S.hjDraft.size+' athlete(s) with unsaved changes':'All attempts saved'}</span><button id="hjSave" class="primary">Save high jump</button><button id="hjRefresh">Refresh</button></div>`;
 $('hjHeightPicker').value=S.hjHeight||'';
 $('hjHeightPicker').onchange=()=>{S.hjHeight=$('hjHeightPicker').value;renderHighJump()};
 $('hjAddHeight').onclick=()=>run(async()=>{if(S.hjDraft.size)throw Error('Save high jump attempts before adding a height.');const value=L.parseMark($('hjNewHeight').value);if(value==null||value<0.5||value>3||Math.abs(value*100-Math.round(value*100))>1e-7)throw Error('Enter a height from 0.50 to 3.00 m, with at most two decimals.');const row=await checked(sb.from('athletics_class_hj_heights').insert({session_id:S.session.id,height_m:value,sequence_no:S.hjHeights.length+1}).select().single());S.hjHeight=row.id;await loadSessionData();renderHighJump();notice('Height added. Record up to three attempts per athlete.','success')});
 $('hjSave').onclick=saveHighJump;
 $('hjRefresh').onclick=()=>{if(proceed())run(async()=>{S.hjDraft.clear();await loadSessionData();setDirty();renderHighJump()})};
 document.querySelectorAll('[data-hj-value]').forEach(button=>button.onclick=()=>{
 const id=button.closest('[data-hj-athlete]').dataset.hjAthlete,index=Number(button.dataset.hjIndex),value=button.dataset.hjValue;
 const previous=S.hjDraft.get(id),saved=S.hjCards.find(c=>c.athlete_id===id);
 S.hjDraft.set(id,{version:previous?.version??saved?.version??0,trials:L.highJumpEdit(hjTrials(id),S.hjHeight,index,value)});setDirty();
 const y=window.scrollY;renderHighJump();window.scrollTo(0,y);
 });
}
async function saveHighJump(){await run(async()=>{
 if(!S.hjDraft.size){notice('No unsaved high jump attempts.');return}
 for(const [id,draft] of [...S.hjDraft]){
  const saved=await checked(sb.rpc('athletics_save_class_hj',{p_session_id:S.session.id,p_athlete_id:id,p_trials:draft.trials,p_version:draft.version}));
  const expected=L.highJumpState(S.hjHeights,draft.trials).best;
  if(saved.version!==draft.version+1||String(saved.best_height??'')!==String(expected??'')||Object.keys(draft.trials).some(h=>JSON.stringify(saved.trials[h])!==JSON.stringify(draft.trials[h])))throw Error('Could not verify high jump attempts. Refresh to check the saved sheet.');
  S.hjCards=S.hjCards.filter(c=>c.athlete_id!==id).concat(saved);S.hjDraft.delete(id);setDirty();
 }
 await loadSessionData();renderHighJump();notice('High jump saved. Best cleared heights updated in individual histories.','success');
})}
