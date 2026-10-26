import regional from './regional-clubs.json' with {type:'json'};
import breeds from './breeds.json' with {type:'json'};
export {regional};
export const normalise=s=>String(s??'').normalize('NFKC').trim().toLocaleLowerCase('en').replace(/\s+/g,' ');
export const clubFor=id=>regional.find(c=>c.id===id);
export function validOrganiser(p) {
 const c=p?.organisingClub;
 return c && ((c.type==='regional' && Boolean(clubFor(c.id))) || (c.type==='speciality' && typeof c.name==='string' && c.name.trim().length>1 && c.name.length<=200)) && typeof p.ring==='string' && p.ring.trim().length>0 && p.ring.length<=30 && (!p.showId || typeof p.showId==='string' && /^[a-zA-Z0-9_-]{1,100}$/.test(p.showId));
}
const aliases=new Map([
 ['bulldog','English Bulldog'],['mops','Pug'],['rough collie','Collie (Rough and Smooth)'],['smooth collie','Collie (Rough and Smooth)'],['collie rough','Collie (Rough and Smooth)'],['collie smooth','Collie (Rough and Smooth)'],['german shepherd','German Shepherd Dog'],['fransk bulldogg','French Bulldog'],['engelsk bulldogg','English Bulldog']
]);
export function identifyBreed(name) {
 const key=normalise(name);
 return breeds.find(b=>normalise(b.name)===key)?.name || aliases.get(key) || null;
}
export const normaliseRing=s=>/^\d+$/.test(normalise(s))?normalise(s).replace(/^0+(?=\d)/,''):normalise(s);
export function allocationKey(r){return JSON.stringify([normaliseRing(r.ring),normalise(r.judge),normalise(r.breed)]);}
export function checkAllocations(rows) {
 if(!Array.isArray(rows)||rows.length<1||rows.length>2000)throw new Error('Import between 1 and 2,000 allocation rows.');
 const seen=new Set();return rows.map((r,i)=>{
  if(!r || !['ring','judge','breed'].every(k=>typeof r[k]==='string'&&r[k].trim()&&r[k].length<=(k==='ring'?30:250)))throw new Error(`Row ${i+1}: ring, judge and breed are required.`);
  const breed=identifyBreed(r.breed);
  if(!breed && r.confirmedUnlisted!==true)throw new Error(`Row ${i+1}: review the unrecognised breed and confirm it is not BSI-listed.`);
  const out={ring:r.ring.trim(),judge:r.judge.trim(),breed:breed||r.breed.trim(),required:Boolean(breed)};
  const key=allocationKey(out);if(seen.has(key))throw new Error(`Row ${i+1}: duplicate ring / judge / breed allocation.`);seen.add(key);return out;
 });
}
// Inputs are status metadata only: never pass report contents or contact details here.
export function reportingStatus(shows,allocations,links,filters={}) {
 const selected=shows.filter(s=>(!filters.club||s.club_id===filters.club)&&(!filters.start||s.date>=filters.start)&&(!filters.end||s.date<=filters.end)&&(!filters.show||normalise(s.name).includes(normalise(filters.show))));
 const detail=[],extra=[],rings=[],showRows=[];
 const grouped=list=>{const map=new Map();for(const item of list){if(!map.has(item.show_id))map.set(item.show_id,[]);map.get(item.show_id).push(item);}return map;};
 const showReports=grouped(links),showAllocations=grouped(allocations);
 for(const show of selected){
  const reports=showReports.get(show.id)||[],used=new Set(),byAllocation=new Map();
  for(const r of reports){const key=allocationKey(r);if(!byAllocation.has(key))byAllocation.set(key,[]);byAllocation.get(key).push(r);}
  const rows=(showAllocations.get(show.id)||[]).filter(a=>a.active!==0).map(a=>{
   const matched=(byAllocation.get(allocationKey(a))||[]).filter(r=>!a.required||r.listed!==0);matched.forEach(r=>used.add(r.id));
   return {clubId:show.club_id,club:show.club_name,showId:show.id,show:show.name,date:show.date,ring:a.ring,judge:a.judge,breed:a.breed,required:Boolean(a.required),status:!a.required?'not_required':matched.length?'submitted':'missing',submittedAt:matched.map(r=>r.submitted_at).sort()[0]||null,reportCount:matched.length};
  });
  const filtered=rows.filter(r=>!filters.judge||normalise(r.judge).includes(normalise(filters.judge)));detail.push(...filtered);
  for(const report of reports.filter(r=>!used.has(r.id)&&(!filters.judge||normalise(r.judge).includes(normalise(filters.judge)))))extra.push({id:report.id,club:show.club_name,showId:show.id,show:show.name,date:show.date,ring:report.ring,judge:report.judge,breed:report.breed,submittedAt:report.submitted_at,status:'unplanned'});
  const count=items=>{const expected=items.filter(r=>r.required).length,submitted=items.filter(r=>r.required&&r.status==='submitted').length;return {expected,submitted,missing:expected-submitted,completion:expected?100*submitted/expected:null,status:!expected?'not_required':submitted===expected?'submitted':'missing'};};
  for(const ring of new Set(filtered.map(r=>normaliseRing(r.ring))))rings.push({club:show.club_name,show:show.name,date:show.date,showId:show.id,ring,...count(filtered.filter(r=>normaliseRing(r.ring)===ring))});
  if(!filters.judge || filtered.length || extra.some(r=>r.showId===show.id))showRows.push({...show,...count(filtered),allocationRows:filtered.length,hasAllocations:rows.length>0});
 }
 const expected=detail.filter(r=>r.required).length,submitted=detail.filter(r=>r.required&&r.status==='submitted').length;
 return {generatedAt:new Date().toISOString(),filters,shows:showRows,rings,rows:detail,unplanned:extra,summary:{shows:showRows.length,expected,submitted,missing:expected-submitted,completion:expected?100*submitted/expected:null,unconfiguredShows:showRows.filter(s=>!s.hasAllocations).length},definition:'One expected report per active show / ring / judge / BSI breed allocation. Additional or non-BSI reports do not increase completion. Not required is excluded from the completion denominator. Search filters apply to counts and completion. Shows without imported allocations have undefined requirements. Judge names must match the allocation; changed assignments are reviewed explicitly.'};
}
export function statusTable(data){return {name:'Reporting status',rows:[['Club','Show','Date','Ring','Judge','Breed','Requirement','Status','Submitted at (UTC)','Matching reports'],...data.rows.map(r=>[r.club,r.show,r.date,r.ring,r.judge,r.breed,r.required?'Required':'Not required',r.status,r.submittedAt||'',r.reportCount]),...data.unplanned.map(r=>[r.club,r.show,r.date,r.ring,r.judge,r.breed,'Additional report','unplanned',r.submittedAt,1])]};}
