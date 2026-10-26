import {sameOrigin} from './auth.mjs';
import {readJSON,emailValid} from './validation.mjs';
import {validDate,csv} from './statistics.mjs';
import {dashboardData,createShow,importAllocations,auditStatement} from './organiser-store.mjs';
import {normalise,statusTable} from './clubs.mjs';
import {workbookBytes,textPDF} from './exports.mjs';
import {fontBytes} from './delivery.mjs';
const fail=(message,status=400)=>{throw Object.assign(new Error(message),{status});};
const json=value=>Response.json(value,{headers:{'Cache-Control':'no-store'}});
const text=(s,max=250)=>typeof s==='string'&&s.trim().length>0&&s.length<=max;
export async function organiserAPI(request,env,url,user){
 const path=url.pathname;
 if(request.method!=='GET')sameOrigin(request);
 const manager=()=>{if(user.role!=='manager')fail('SKK manager permission is required.',403);};
 if(path==='/api/organiser/session'&&request.method==='GET'){
  const clubs=user.clubs||(await env.DB.prepare('SELECT id,name,type FROM organising_clubs ORDER BY name').all()).results;
  return json({role:user.role,clubs});
 }
 if(path==='/api/organiser/status'&&request.method==='GET'){
  const filters=Object.fromEntries(['club','start','end','show','judge'].map(k=>[k,url.searchParams.get(k)||'']));
  if(!validDate(filters.start)||!validDate(filters.end)||filters.start>filters.end||filters.show.length>250||filters.judge.length>250)fail('Select a valid date range and search fields.');
  const data=await dashboardData(env,user,filters),format=url.searchParams.get('format');
  if(['csv','xlsx','pdf'].includes(format)){
   const table=statusTable(data);
   const bytes=format==='csv'?csv(table.rows):format==='xlsx'?workbookBytes([table]):await textPDF('BSI - Organiser reporting status',[
    {title:'Selection',lines:[`${filters.start} to ${filters.end}`,`Shows: ${data.summary.shows} | Expected: ${data.summary.expected} | Submitted: ${data.summary.submitted} | Missing: ${data.summary.missing}`,data.definition]},
    ...data.rows.map(r=>({title:`${r.show} - ${r.date} - Ring ${r.ring}`,lines:[`${r.club} | ${r.judge} | ${r.breed}`,`Status: ${r.status} | Submitted: ${r.submittedAt||'Not submitted'}`]})),
    ...data.unplanned.map(r=>({title:'Additional / unplanned submission',lines:[`${r.club} | ${r.show} | ${r.date} | Ring ${r.ring}`,`${r.judge} | ${r.breed} | ${r.submittedAt}`]}))
   ],await fontBytes(env));
   await auditStatement(env,user.email,'reporting_status_export',format).run();
   return new Response(bytes,{headers:{'Content-Type':format==='csv'?'text/csv;charset=utf-8':format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':`attachment; filename="BSI-reporting-status.${format}"`,'Cache-Control':'no-store'}});
  }
  return json(data);
 }
 if(path==='/api/organiser/shows'&&request.method==='POST'){
  const p=await readJSON(request,4096);
  if(!text(p.name)||!text(p.country,100)||!validDate(p.date)||!text(p.clubId,100))fail('Show name, date, country and club are required.');
  return json(await createShow(env,user,p));
 }
 if(path==='/api/organiser/import'&&request.method==='POST'){
  const b=await readJSON(request,768000);return json(await importAllocations(env,user,b.showId,b.revision,b.rows));
 }
 if(path==='/api/organiser/access'){
  manager();
  if(request.method==='GET')return json((await env.DB.prepare('SELECT a.email,a.club_id,a.role,a.active,c.name AS club FROM club_access a JOIN organising_clubs c ON c.id=a.club_id ORDER BY c.name,a.email').all()).results);
  if(request.method==='POST'){
   const b=await readJSON(request,2048),email=b.email?.trim().toLowerCase();
   if(!emailValid(email)||!['viewer','editor'].includes(b.role)||typeof b.active!=='boolean')fail('Valid email, viewer/editor permission and active status are required.');
   const club=await env.DB.prepare("SELECT id FROM organising_clubs WHERE id=? AND type='regional'").bind(b.clubId).first();if(!club)fail('Access can only be granted for a regional kennel club.');
   await env.DB.batch([env.DB.prepare('INSERT INTO club_access (email,club_id,role,active) VALUES (?,?,?,?) ON CONFLICT(email,club_id) DO UPDATE SET role=excluded.role,active=excluded.active').bind(email,club.id,b.role,b.active?1:0),auditStatement(env,user.email,b.active?'club_access_saved':'club_access_revoked',club.id+':'+email)]);return json({saved:true});
  }
 }
 if(path==='/api/organiser/unlinked'&&request.method==='GET'){
  manager();return json((await env.DB.prepare("SELECT s.id,s.show_date AS date,s.breed,json_extract(s.report_json,'$.show') AS show_name,json_extract(s.report_json,'$.judge') AS judge,json_extract(s.report_json,'$.ring') AS ring FROM submissions s LEFT JOIN report_links l ON l.report_id=s.id WHERE l.report_id IS NULL ORDER BY s.created_at DESC LIMIT 200").all()).results);
 }
 if(path==='/api/organiser/correct-link'&&request.method==='POST'){
  manager();const b=await readJSON(request,4096);
  if(!text(b.reportId,100)||!text(b.showId,100)||!text(b.ring,30))fail('Report ID, target show and ring are required.');
  const source=await env.DB.prepare("SELECT COALESCE(l.judge,json_extract(s.report_json,'$.judge')) AS judge,s.breed,CASE WHEN json_extract(s.report_json,'$.group')='Not BSI-listed' THEN 0 ELSE 1 END AS listed FROM submissions s LEFT JOIN report_links l ON l.report_id=s.id WHERE s.id=?").bind(b.reportId).first();
  const target=await env.DB.prepare('SELECT id,club_id FROM organiser_shows WHERE id=?').bind(b.showId).first();if(!source||!target)fail('Report link or target show not found.',404);
  const judge=b.judge||source.judge;if(!text(judge))fail('Judge name is required.');
  await env.DB.batch([env.DB.prepare('INSERT INTO report_links (report_id,club_id,show_id,ring,judge,breed,listed,updated_at) VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(report_id) DO UPDATE SET club_id=excluded.club_id,show_id=excluded.show_id,ring=excluded.ring,judge=excluded.judge,updated_at=excluded.updated_at').bind(b.reportId,target.club_id,target.id,b.ring.trim(),judge.trim(),source.breed,source.listed,new Date().toISOString()),auditStatement(env,user.email,'report_association_corrected',JSON.stringify({reportId:b.reportId,showId:b.showId,ring:b.ring}))]);return json({corrected:true});
 }
 if(path==='/api/organiser/clubs'&&request.method==='POST'){
  manager();const b=await readJSON(request,8192);
  if(!text(b.name,200)||!Array.isArray(b.aliases)||b.aliases.length>20||!b.aliases.every(a=>text(a,200)))fail('Provide a club name and up to 20 alias names.');
  const club=await env.DB.prepare("SELECT id,name FROM organising_clubs WHERE id=? AND type='speciality'").bind(b.clubId).first();if(!club)fail('Only breed / speciality club names can be standardised.');
  const names=[...new Set([club.name,b.name,...b.aliases].map(normalise))];
  for(const name of names){const other=await env.DB.prepare('SELECT club_id FROM club_aliases WHERE alias_key=?').bind(name).first();if(other&&other.club_id!==club.id)fail('An alias already belongs to a different club; correct its report associations separately.',409);}
  await env.DB.batch([env.DB.prepare('UPDATE organising_clubs SET name=? WHERE id=?').bind(b.name.trim(),club.id),...names.map(name=>env.DB.prepare('INSERT OR IGNORE INTO club_aliases (alias_key,club_id) VALUES (?,?)').bind(name,club.id)),auditStatement(env,user.email,'club_name_standardised',club.id)]);return json({standardised:true});
 }
 fail('Not found',404);
}
