(function(root){
 'use strict';
 const eligible=(a,s)=>a.active&&(Array.isArray(s.categories)?s.categories.includes(a.level):(s.category==='All'||a.level===s.category))&&(s.gender==='All'||a.gender===s.gender);
 const attendanceMatches=(a,s,{query='',gender='All',color='All'}={})=>eligible(a,s)&&(gender==='All'||a.gender===gender)&&(color==='All'||a.color===color)&&(!query||`${a.last_name}, ${a.first_name} ${a.external_code} ${a.level}`.toLowerCase().includes(query.trim().toLowerCase()));
 function parseMark(value){if(String(value).trim()==='')return null;const n=Number(String(value).trim().replace(',','.'));if(!Number.isFinite(n)||n<=0||n>=1000000)throw Error('Marks must be positive numbers below 1,000,000. Enter time in seconds.');return n}
 const comparisonKey=r=>JSON.stringify([r.event_name,r.category,r.gender,r.conditions||'']);
 const better=(a,b)=>a.unit==='s'?Number(a.mark)<Number(b.mark):Number(a.mark)>Number(b.mark);
 function bestMarks(rows){const map=new Map();for(const r of rows){if(r.status!=='valid'||r.mark==null||!Number.isFinite(Number(r.mark)))continue;const k=r.athlete_id+'|'+comparisonKey(r);if(!map.has(k)||better(r,map.get(k)))map.set(k,r)}return [...map.values()]}
 const api={eligible,attendanceMatches,parseMark,comparisonKey,better,bestMarks};
 if(typeof module!=='undefined')module.exports=api;else root.ClassLogic=api;
})(typeof window!=='undefined'?window:globalThis);
