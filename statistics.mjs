export const CATEGORIES = ['none','mild','clear','severe','na'];
export const VERSION = 'BSI-2024-working-v1';
export const DEFINITIONS = 'Concern % = (mild + clear + severe) / assessed observations. Assessed = none + mild + clear + severe; not assessed is excluded. Totals are judging observations, not unique dogs. Dogs may overlap between areas and between grading and placing. Show counts use normalised name + date + country. Trends are descriptive, not significance tests. Working BSI summaries are not verified official wording.';
export function validDate(s) {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && Number(s.slice(0,4))>=1900 && Number(s.slice(0,4))<=2200 && Number.isFinite(Date.parse(s+'T00:00:00Z')) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
}
export function showKey(p) { return [p.show,p.date,p.country].map(x=>x.trim().toLowerCase().replace(/\s+/g,' ')).join('|'); }
export function filterReports(reports, {start,end,breed=''}) {
  if (!validDate(start) || !validDate(end) || start>end) throw new Error('Choose a valid start and end date.');
  return reports.filter(p=>p.date>=start && p.date<=end && (!breed || p.breed===breed));
}
export function statistics(reports, filters) {
  const selected=filterReports(reports,filters), totals=new Map(), areas=new Map();
  for(const p of selected) {
    const year=p.date.slice(0,4), version=p.bsiVersion || 'legacy-unversioned';
    const key=JSON.stringify([p.breed,year,version]);
    if(!totals.has(key)) totals.set(key,{breed:p.breed,year,version,reports:0,shows:new Set(),dogs:0,quality:0,placing:0});
    const t=totals.get(key);t.reports++;t.shows.add(p.showKey || showKey(p));t.dogs+=p.total;t.quality+=p.quality;t.placing+=p.placing;
    for(const r of p.risks) {
      const rk=JSON.stringify([p.breed,year,version,r.risk]);
      if(!areas.has(rk))areas.set(rk,{breed:p.breed,year,version,risk:r.risk,reports:0,none:0,mild:0,clear:0,severe:0,na:0});
      const a=areas.get(rk);a.reports++;for(const c of CATEGORIES)a[c]+=r[c];
    }
  }
  const pct=(n,d)=>d?100*n/d:null;
  const annual=[...totals.values()].map(t=>({...t,shows:t.shows.size,qualityPct:pct(t.quality,t.dogs),placingPct:pct(t.placing,t.dogs)})).sort((a,b)=>a.breed.localeCompare(b.breed)||a.version.localeCompare(b.version)||a.year.localeCompare(b.year));
  const riskRows=[...areas.values()].map(a=>{const assessed=a.none+a.mild+a.clear+a.severe,concerns=a.mild+a.clear+a.severe;return {...a,assessed,concerns,concernPct:pct(concerns,assessed),nonePct:pct(a.none,assessed),mildPct:pct(a.mild,assessed),clearPct:pct(a.clear,assessed),severePct:pct(a.severe,assessed),notAssessedPct:pct(a.na,assessed+a.na),changePP:null,relativeChangePct:null,trend:'No comparable previous year'};}).sort((a,b)=>a.breed.localeCompare(b.breed)||a.version.localeCompare(b.version)||a.risk.localeCompare(b.risk)||a.year.localeCompare(b.year));
  const prior=new Map();
  for(const r of riskRows) {
    const key=JSON.stringify([r.breed,r.version,r.risk]), p=prior.get(key);
    if(p && Number(r.year)===Number(p.year)+1 && p.concernPct!==null && r.concernPct!==null) {
      r.changePP=r.concernPct-p.concernPct;
      r.relativeChangePct=p.concernPct ? 100*(r.concernPct-p.concernPct)/p.concernPct:null;
      r.trend=Math.abs(r.changePP)<0.000001?'Unchanged observed rate':r.changePP<0?'Lower observed concern rate':'Higher observed concern rate';
    }
    prior.set(key,r);
  }
  const years=[]; for(let y=Number(filters.start.slice(0,4));y<=Number(filters.end.slice(0,4));y++) years.push({year:String(y),reports:selected.filter(p=>p.date.startsWith(String(y))).length});
  return {filters,definitions:DEFINITIONS,summary:{reports:selected.length,shows:new Set(selected.map(p=>p.showKey||showKey(p))).size,dogs:selected.reduce((n,p)=>n+p.total,0),uniqueDogs:null},annual,areas:riskRows,years,observations:selected.filter(p=>p.positive || p.other?.length).map(p=>({id:p.id||'',date:p.date,breed:p.breed,version:p.bsiVersion||'legacy-unversioned',positive:p.positive,other:p.other})),missing:{notAssessed:riskRows.reduce((n,r)=>n+r.na,0),legacyVersion:selected.filter(p=>!p.bsiVersion).length}};
}
export function csv(rows) {
  // Prevent spreadsheet formula injection in user-provided text.
  return '\ufeff'+rows.map(row=>row.map(value=>{
    let text=String(value??'');if(typeof value==='string' && /^[\s]*[=+@-]/.test(text))text="'"+text;
    return '"'+text.replaceAll('"','""')+'"';
  }).join(',')).join('\r\n');
}
export function statisticTables(s) {
 return [
  {name:'Summary',rows:[['BSI statistics'],['Start',s.filters.start],['End',s.filters.end],['Breed',s.filters.breed||'All breeds'],['Reports',s.summary.reports],['Shows',s.summary.shows],['Judging observations',s.summary.dogs],['Unique dogs','Not measured'],['Definitions',s.definitions]]},
  {name:'Annual totals',rows:[['Breed','Year','BSI version','Reports','Shows','Dogs judged','Quality affected','Placing affected','Quality %','Placing %'],...s.annual.map(t=>[t.breed,t.year,t.version,t.reports,t.shows,t.dogs,t.quality,t.placing,t.qualityPct,t.placingPct])]},
  {name:'Areas',rows:[['Breed','Year','BSI version','Area','Reports','Assessed','No concerns','Mild','Clear','Severe','Not assessed','With concerns','Concern %','No concern %','Mild %','Clear %','Severe %','Not assessed % of all','Change (percentage points)','Relative change %','Descriptive trend'],...s.areas.map(r=>[r.breed,r.year,r.version,r.risk,r.reports,r.assessed,r.none,r.mild,r.clear,r.severe,r.na,r.concerns,r.concernPct,r.nonePct,r.mildPct,r.clearPct,r.severePct,r.notAssessedPct,r.changePP,r.relativeChangePct,r.trend])]},
  {name:'Other observations',rows:[['Report ID','Date','Breed','BSI version','Positive observations','Other concern','Affected count'],...s.observations.flatMap(p=>(p.other?.length?p.other:[{problem:'',count:null}]).map(o=>[p.id,p.date,p.breed,p.version,p.positive,o.problem,o.count]))]},
  {name:'Data coverage',rows:[['Year','Reports'],...s.years.map(y=>[y.year,y.reports]),['Not assessed area observations',s.missing.notAssessed],['Unversioned reports',s.missing.legacyVersion]]}
 ];
}
