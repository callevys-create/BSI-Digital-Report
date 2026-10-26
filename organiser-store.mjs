import {hash} from './validation.mjs';
import {normalise,regional,checkAllocations,reportingStatus} from './clubs.mjs';
import {showKey} from './statistics.mjs';
const err=(s,status=400)=>{throw Object.assign(new Error(s),{status});};
export async function showID(club,p){return 'show_'+await hash(JSON.stringify([club,showKey(p)]));}
export async function association(env,p) {
 let club,statements=[];
 if(p.organisingClub.type==='regional')club=regional.find(c=>c.id===p.organisingClub.id);
 else {
  const key=normalise(p.organisingClub.name),existing=await env.DB.prepare('SELECT c.id,c.name FROM club_aliases a JOIN organising_clubs c ON c.id=a.club_id WHERE a.alias_key=?').bind(key).first();
  club=existing||{id:'special_'+await hash(key),name:p.organisingClub.name.trim()};
  statements.push(env.DB.prepare("INSERT OR IGNORE INTO organising_clubs (id,type,name) VALUES (?,'speciality',?)").bind(club.id,club.name));
  statements.push(env.DB.prepare('INSERT OR IGNORE INTO club_aliases (alias_key,club_id) VALUES (?,?)').bind(key,club.id));
 }
 let show;
 if(p.showId){show=await env.DB.prepare('SELECT * FROM organiser_shows WHERE id=?').bind(p.showId).first();if(!show||show.club_id!==club.id||show.show_key!==showKey(p))err('Selected show does not match the organising club, name, date and country.');}
 else show={id:await showID(club.id,p),name:p.show.trim(),date:p.date,country:p.country.trim()};
 statements.push(env.DB.prepare('INSERT OR IGNORE INTO organiser_shows (id,club_id,name,date,country,show_key) VALUES (?,?,?,?,?,?)').bind(show.id,club.id,show.name,show.date,show.country,showKey(p)));
 return {before:statements,link:id=>env.DB.prepare('INSERT INTO report_links (report_id,club_id,show_id,ring,judge,breed,listed,updated_at) VALUES (?,?,?,?,?,?,?,?)').bind(id,club.id,show.id,p.ring.trim(),p.judge.trim(),p.breed,p.group==='Not BSI-listed'?0:1,new Date().toISOString())};
}
export function authoriseClub(user,clubId,write=false) {
 if(user.role==='manager'||user.role==='analyst'&&!write)return;
 const grant=user.clubs?.find(c=>c.id===clubId);
 if(!grant||write&&grant.role!=='editor')err('You do not have permission for this club.',403);
}
export async function createShow(env,user,p) {
 authoriseClub(user,p.clubId,true);
 const club=await env.DB.prepare('SELECT id FROM organising_clubs WHERE id=?').bind(p.clubId).first();if(!club)err('Club not found.',404);
 const id=await showID(p.clubId,{show:p.name,date:p.date,country:p.country});
 await env.DB.batch([
  env.DB.prepare('INSERT OR IGNORE INTO organiser_shows (id,club_id,name,date,country,show_key) VALUES (?,?,?,?,?,?)').bind(id,p.clubId,p.name.trim(),p.date,p.country.trim(),showKey({show:p.name,date:p.date,country:p.country})),
  auditStatement(env,user.email,'show_saved',id)
 ]);return {id};
}
export function auditStatement(env,actor,action,target){return env.DB.prepare('INSERT INTO audit_log (id,actor,action,target,created_at) VALUES (?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,target,new Date().toISOString());}
export async function importAllocations(env,user,showId,revision,rows) {
 const show=await env.DB.prepare('SELECT * FROM organiser_shows WHERE id=?').bind(showId).first();if(!show)err('Show not found.',404);authoriseClub(user,show.club_id,true);
 if(!Number.isInteger(revision)||revision<0)err('A valid allocation revision is required.');
 const checked=checkAllocations(rows),token=crypto.randomUUID(),now=new Date().toISOString();
 const payload=JSON.stringify(checked.map(r=>({...r,id:crypto.randomUUID()})));
 // All writes are conditional on this request winning the revision update.
 const result=await env.DB.batch([
  env.DB.prepare('UPDATE organiser_shows SET revision=revision+1,allocation_token=? WHERE id=? AND revision=?').bind(token,showId,revision),
  env.DB.prepare('UPDATE ring_allocations SET active=0 WHERE show_id=? AND EXISTS (SELECT 1 FROM organiser_shows WHERE id=? AND allocation_token=?)').bind(showId,showId,token),
  env.DB.prepare("INSERT INTO ring_allocations (id,show_id,revision,ring,judge,breed,required,active) SELECT json_extract(value,'$.id'),?, ?,json_extract(value,'$.ring'),json_extract(value,'$.judge'),json_extract(value,'$.breed'),json_extract(value,'$.required'),1 FROM json_each(?) WHERE EXISTS (SELECT 1 FROM organiser_shows WHERE id=? AND allocation_token=?)").bind(showId,revision+1,payload,showId,token),
  env.DB.prepare('INSERT INTO ring_imports (id,show_id,revision,actor,created_at,allocation_json) SELECT ?,?,?,?,?,? WHERE EXISTS (SELECT 1 FROM organiser_shows WHERE id=? AND allocation_token=?)').bind(token,showId,revision+1,user.email,now,payload,showId,token),
  env.DB.prepare('INSERT INTO audit_log (id,actor,action,target,created_at) SELECT ?,?,?,?,? WHERE EXISTS (SELECT 1 FROM organiser_shows WHERE id=? AND allocation_token=?)').bind(crypto.randomUUID(),user.email,'allocations_imported',showId,now,showId,token)
 ]);
 if(!result[0].meta.changes)err('Allocations changed since you loaded this show. Refresh and review the new revision before importing.',409);
 return {revision:revision+1,rows:checked.length,expected:checked.filter(r=>r.required).length};
}
export async function dashboardData(env,user,filters) {
 if(filters.club)authoriseClub(user,filters.club);
 const scope=user.role==='manager'||user.role==='analyst'?null:user.clubs.map(c=>c.id);
 if(scope?.length===0)return reportingStatus([],[],[],filters);
 const where=scope?` AND s.club_id IN (${scope.map(()=>'?').join(',')})`:'';
 const params=[filters.start,filters.end,filters.club||'',filters.club||'',...(scope||[])];
 const shows=(await env.DB.prepare(`SELECT s.id,s.club_id,s.name,s.date,s.country,s.revision,c.name AS club_name FROM organiser_shows s JOIN organising_clubs c ON c.id=s.club_id WHERE s.date>=? AND s.date<=? AND (?='' OR s.club_id=?)${where} ORDER BY s.date,s.name LIMIT 501`).bind(...params).all()).results;
 if(shows.length>500)err('Select a smaller date range or one club (maximum 500 shows per view).',422);
 if(!shows.length)return reportingStatus([],[],[],filters);
 // Scope every status query through the authorised show IDs; never load confidential report JSON.
 const ids=JSON.stringify(shows.map(s=>s.id));
 const allocations=(await env.DB.prepare('SELECT show_id,ring,judge,breed,required,active FROM ring_allocations WHERE active=1 AND show_id IN (SELECT value FROM json_each(?)) LIMIT 50001').bind(ids).all()).results;
 const links=(await env.DB.prepare('SELECT l.report_id AS id,l.show_id,l.ring,l.judge,l.breed,l.listed,s.created_at AS submitted_at FROM report_links l JOIN submissions s ON s.id=l.report_id WHERE l.show_id IN (SELECT value FROM json_each(?)) LIMIT 50001').bind(ids).all()).results;
 if(allocations.length>50000||links.length>50000)err('Select a smaller date range, one show or one club (maximum 50,000 allocation/status records per view).',422);
 return reportingStatus(shows,allocations,links,filters);
}
