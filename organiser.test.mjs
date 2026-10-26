import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {zipSync,strToU8,unzipSync,strFromU8} from 'fflate';
import {regional,validOrganiser,checkAllocations,reportingStatus} from './clubs.mjs';
import {parseCSV,parseXLSX,allocationPreview} from './allocation-import.mjs';
import {association,createShow,importAllocations,dashboardData} from './organiser-store.mjs';
import {saveSubmission} from './storage.mjs';
import {validate} from './validation.mjs';
import {VERSION} from './statistics.mjs';
import {workbookBytes} from './exports.mjs';
import worker from './worker.mjs';
import breeds from './breeds.json' with {type:'json'};
const root=new URL('./',import.meta.url);
const schema=await readFile(new URL('schema.sql',root),'utf8')+await readFile(new URL('organiser-schema.sql',root),'utf8');
function env(){const db=new DatabaseSync(':memory:');db.exec(schema);const prepare=sql=>({bind(...args){return {async first(){return db.prepare(sql).get(...args)||null;},async all(){return {results:db.prepare(sql).all(...args)};},async run(){const r=db.prepare(sql).run(...args);return {meta:{changes:Number(r.changes)}};}};},async all(){return {results:db.prepare(sql).all()};}});return {DB:{raw:db,prepare,async batch(items){db.exec('BEGIN');try{const out=[];for(const item of items)out.push(await item.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}}}};}
const manager={role:'manager',email:'manager@example.invalid'};
const viewer=(club='stockholm',role='viewer')=>({role:'organiser',email:'organiser@example.invalid',clubs:[{id:club,role}]});
const newShow=(clubId='stockholm')=>({clubId,name:'Example Show',date:'2026-10-26',country:'Sweden'});
const report=(changes={})=>{const b=breeds[35];return {schema:'bsi-prototype-3',source:'Synthetic test',bsiVersion:VERSION,organisingClub:{type:'regional',id:'stockholm'},ring:'1',show:'Example Show',date:'2026-10-26',judge:'Example Judge',country:'Sweden',breed:b.name,group:b.group,total:2,risks:b.risks.map(risk=>({risk,none:2,mild:0,clear:0,severe:0,na:0})),other:[],positive:'CONFIDENTIAL positive text',quality:0,placing:0,comments:'CONFIDENTIAL report text',...changes};};
const body=p=>({report:p,sendCopy:true,email:'private-judge@example.invalid',submissionKey:crypto.randomUUID().replaceAll('-',''),receiptKey:crypto.randomUUID().replaceAll('-','')});
const filters={start:'2026-01-01',end:'2026-12-31',club:'',show:'',judge:''};
function recipient(e){e.DB.raw.prepare('INSERT INTO recipients VALUES (?,?,1,?)').run('recipient','skk@example.invalid','2026-01-01');}
const rows=[{ring:'1',judge:'Example Judge',breed:'Pug'},{ring:'1',judge:'Example Judge',breed:'English Bulldog'},{ring:'2',judge:'Example Judge',breed:'Labrador Retriever',confirmedUnlisted:true}];
test('Official club IDs and regional/free-text report validation',()=>{
 assert.equal(regional.length,24);assert.equal(new Set(regional.map(c=>c.id)).size,24);
 assert.ok(validate({report:report(),sendCopy:false}));assert.ok(validate({report:report({organisingClub:{type:'speciality',name:'A breed club'}}),sendCopy:false}));
 for(const changes of [{organisingClub:{type:'regional',id:'forged'}},{organisingClub:{type:'speciality',name:''}},{ring:''},{organisingClub:null}])assert.equal(validate({report:report(changes),sendCopy:false}),false);
});
test('CSV quoting and Excel text/shared-string imports, multiple worksheets, formulas and review',()=>{
 const matrix=parseCSV('\ufeffRing;Judge;Breed\r\n1;"Example, Judge";Pug\r\n1;"Example, Judge";English Bulldog\r\n2;Another Judge;Labrador Retriever');
 const preview=allocationPreview(matrix);assert.equal(preview[0].judge,'Example, Judge');assert.equal(preview[0].recognised,true);assert.equal(preview[2].recognised,false);assert.throws(()=>checkAllocations(preview));
 preview[2].confirmedUnlisted=true;assert.equal(checkAllocations(preview).filter(r=>r.required).length,2);
 const bytes=workbookBytes([{name:'Allocations',rows:matrix},{name:'Second sheet',rows:[['Ring','Judge','Breed'],['2','Another Judge','Pug']]}]);
 const parsed=parseXLSX(bytes);assert.equal(parsed.length,2);assert.equal(parsed[0].rows[1][1],'Example, Judge');assert.equal(allocationPreview(parsed[1].rows)[0].breed,'Pug');
 const zip=unzipSync(bytes);zip['xl/worksheets/sheet1.xml']=strToU8(strFromU8(zip['xl/worksheets/sheet1.xml']).replace('<c r="A2"','<c r="A2"').replace('<is><t xml:space="preserve">1</t></is>','<f>1+0</f><v>1</v>'));
 assert.throws(()=>parseXLSX(zipSync(zip)),/Formula/);
 const sharedZip=unzipSync(bytes);sharedZip['xl/sharedStrings.xml']=strToU8('<sst><si><t>Example &amp; Judge</t></si></sst>');sharedZip['xl/worksheets/sheet1.xml']=strToU8(strFromU8(sharedZip['xl/worksheets/sheet1.xml']).replace(/<c r="B2"[^>]*>.*?<\/c>/,'<c r="B2" t="s"><v>0</v></c>'));
 assert.equal(parseXLSX(zipSync(sharedZip))[0].rows[1][1],'Example & Judge');
 assert.throws(()=>parseCSV('Ring,Judge,Breed\n1,"bad,Pug'),/unclosed/);
 assert.throws(()=>allocationPreview([['Wrong'],['1']]));assert.throws(()=>checkAllocations([rows[0],rows[0]]),/duplicate/);
});
test('Expected breeds and ring completion: partial, completed, not-required and extra reports',()=>{
 const shows=[{id:'s',club_id:'stockholm',club_name:'Stockholm',name:'Show',date:'2026-10-26'}],allocations=rows.map(r=>({...r,show_id:'s',required:r.breed!=='Labrador Retriever'}));
 const links=[{id:'r1',show_id:'s',ring:'1',judge:'Example Judge',breed:'Pug',submitted_at:'2026-10-26T09:00:00Z'},{id:'other',show_id:'s',ring:'9',judge:'Another Judge',breed:'Other breed',submitted_at:'2026-10-26T09:00:00Z'}];
 let data=reportingStatus(shows,allocations,links);assert.equal(data.summary.completion,50);assert.equal(data.rings.find(r=>r.ring==='1').status,'missing');assert.equal(data.rings.find(r=>r.ring==='2').status,'not_required');assert.equal(data.unplanned.length,1);
 links.push({...links[0],id:'r2',breed:'English Bulldog'});data=reportingStatus(shows,allocations,links);assert.equal(data.summary.completion,100);assert.equal(data.rings[0].status,'submitted');
 links.push({...links[0],id:'duplicate'});assert.equal(reportingStatus(shows,allocations,links).summary.submitted,2);
 assert.equal(reportingStatus(shows,allocations.filter(r=>!r.required),links).summary.completion,null);
});
test('Existing report transaction updates status automatically and exposes metadata only',async()=>{
 const e=env();recipient(e);const show=await createShow(e,manager,newShow());await importAllocations(e,manager,show.id,0,rows);
 const before=await dashboardData(e,viewer(),filters);assert.equal(before.summary.submitted,0);
 const b=body(report({showId:show.id})),saved=await saveSubmission(e,b);const after=await dashboardData(e,viewer(),filters);
 assert.equal(after.summary.submitted,1);assert.equal(after.summary.missing,1);assert.ok(after.rows[0].submittedAt);
 const unlisted=report({group:'Not BSI-listed',risks:[],breed:'English Bulldog'});await saveSubmission(e,body(unlisted));assert.equal((await dashboardData(e,viewer(),filters)).summary.submitted,1);
 const text=JSON.stringify(after);assert.ok(!text.includes('CONFIDENTIAL'));assert.ok(!text.includes('private-judge'));assert.ok(!text.includes('receipt_hash'));
 await saveSubmission(e,b);assert.equal((await dashboardData(e,viewer(),filters)).summary.submitted,1);
 assert.equal(e.DB.raw.prepare('SELECT COUNT(*) n FROM submissions').get().n,2);assert.equal(e.DB.raw.prepare('SELECT COUNT(*) n FROM deliveries').get().n,4);
});
test('Club isolation, viewer permissions, revision conflicts and preserved import history',async()=>{
 const e=env();recipient(e);const a=await createShow(e,manager,newShow()),b=await createShow(e,manager,newShow('uppsala'));
 await importAllocations(e,viewer('stockholm','editor'),a.id,0,rows);
 await assert.rejects(()=>importAllocations(e,viewer(),a.id,1,rows),{status:403});await assert.rejects(()=>importAllocations(e,viewer('stockholm','editor'),b.id,0,rows),{status:403});
 await assert.rejects(()=>dashboardData(e,viewer(),{...filters,club:'uppsala'}),{status:403});assert.equal((await dashboardData(e,viewer(),filters)).shows.length,1);
 await assert.rejects(()=>importAllocations(e,manager,a.id,0,rows),{status:409});assert.equal(e.DB.raw.prepare('SELECT COUNT(*) n FROM ring_imports').get().n,1);
 await saveSubmission(e,body(report()));
 await importAllocations(e,manager,a.id,1,[{ring:'3',judge:'Changed Judge',breed:'Pug'}]);
 const data=await dashboardData(e,viewer(),filters);assert.equal(data.summary.submitted,0);assert.equal(data.summary.missing,1);assert.equal(data.unplanned.length,1);assert.equal(e.DB.raw.prepare('SELECT COUNT(*) n FROM ring_imports').get().n,2);assert.equal(e.DB.raw.prepare('SELECT COUNT(*) n FROM ring_allocations WHERE active=0').get().n,3);
});
test('Failed report transactions roll back club/show links and the existing report together',async()=>{
 const e=env();recipient(e);e.DB.raw.exec("CREATE TRIGGER stop_assessment BEFORE INSERT ON assessments BEGIN SELECT RAISE(ABORT,'test failure'); END");
 await assert.rejects(()=>saveSubmission(e,body(report({organisingClub:{type:'speciality',name:'Rollback Club'}}))));
 assert.equal(e.DB.raw.prepare('SELECT COUNT(*) n FROM submissions').get().n,0);assert.equal(e.DB.raw.prepare('SELECT COUNT(*) n FROM report_links').get().n,0);assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM organising_clubs WHERE type='speciality'").get().n,0);assert.equal(e.DB.raw.prepare('SELECT COUNT(*) n FROM organiser_shows').get().n,0);
});
test('Signed regional sessions, live API isolation, revoked access, SKK corrections and club aliases',async()=>{
 const e=env();recipient(e);const original=globalThis.fetch;
 e.ACCESS_TEAM_DOMAIN='organiser-test.cloudflareaccess.com';e.ACCESS_AUD='test-organiser';e.MANAGER_EMAILS=manager.email;
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='organiser-key';jwk.alg='RS256';
 const sign=email=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:jwk.kid}).setIssuer('https://'+e.ACCESS_TEAM_DOMAIN).setAudience(e.ACCESS_AUD).setExpirationTime('10m').sign(privateKey);
 const managerToken=await sign(manager.email),clubToken=await sign('club@example.invalid');
 const req=(path,token,body)=>new Request('https://backend.test'+path,{method:body?'POST':'GET',headers:{'Cf-Access-Jwt-Assertion':token,Origin:'https://backend.test','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
 try{globalThis.fetch=async()=>Response.json({keys:[jwk]});
 const grant={clubId:'stockholm',email:'club@example.invalid',role:'editor',active:true};assert.equal((await worker.fetch(req('/api/organiser/access',managerToken,grant),e)).status,200);
 const s=await createShow(e,manager,newShow());await createShow(e,manager,newShow('uppsala'));await importAllocations(e,manager,s.id,0,rows);
 let r=await worker.fetch(req('/api/organiser/status?start=2026-01-01&end=2026-12-31',clubToken),e);assert.equal(r.status,200);assert.equal((await r.json()).shows.length,1);
 assert.equal((await worker.fetch(req('/api/organiser/status?club=uppsala&start=2026-01-01&end=2026-12-31',clubToken),e)).status,403);
 assert.equal((await worker.fetch(req('/api/admin/statistics?start=2026-01-01&end=2026-12-31',clubToken),e)).status,403);
 assert.equal((await worker.fetch(req('/api/organiser/access',clubToken),e)).status,403);
 const saved=await saveSubmission(e,body(report({ring:'9'})));
 assert.equal((await worker.fetch(req('/api/organiser/correct-link',clubToken,{reportId:saved.id,showId:s.id,ring:'1'}),e)).status,403);
 assert.equal((await worker.fetch(req('/api/organiser/correct-link',managerToken,{reportId:saved.id,showId:s.id,ring:'1'}),e)).status,200);
 assert.equal((await dashboardData(e,viewer(),filters)).summary.submitted,1);assert.equal(JSON.parse(e.DB.raw.prepare('SELECT report_json FROM submissions WHERE id=?').get(saved.id).report_json).ring,'9');
 e.DB.raw.prepare('DELETE FROM report_links WHERE report_id=?').run(saved.id);
 const unlinkedResponse=await worker.fetch(req('/api/organiser/unlinked',managerToken),e);assert.equal(unlinkedResponse.status,200);const unlinked=await unlinkedResponse.json();assert.equal(unlinked[0].id,saved.id);assert.ok(!JSON.stringify(unlinked).includes('CONFIDENTIAL'));
 assert.equal((await worker.fetch(req('/api/organiser/correct-link',managerToken,{reportId:saved.id,showId:s.id,ring:'1'}),e)).status,200);
 const special=await saveSubmission(e,body(report({organisingClub:{type:'speciality',name:'Example Breed Club'}})));
 const link=e.DB.raw.prepare('SELECT club_id FROM report_links WHERE report_id=?').get(special.id);
 assert.equal((await worker.fetch(req('/api/organiser/clubs',managerToken,{clubId:link.club_id,name:'Canonical Breed Club',aliases:['Example BC']}),e)).status,200);
 await saveSubmission(e,body(report({organisingClub:{type:'speciality',name:'Example BC'}})));
 assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM organising_clubs WHERE type='speciality'").get().n,1);
 assert.equal((await worker.fetch(req('/api/organiser/access',managerToken,{...grant,active:false}),e)).status,200);
 assert.equal((await worker.fetch(req('/api/organiser/session',clubToken),e)).status,403);
 const publicResponse=await worker.fetch(new Request('https://backend.test/public/shows?club=stockholm&date=2026-10-26'),e);assert.equal(publicResponse.status,200);const publicText=await publicResponse.text();assert.ok(!publicText.includes('judge'));assert.ok(!publicText.includes('submitted'));
 }finally{globalThis.fetch=original;}
});
test('CSV and XLSX template fixtures are usable by the same production importer',async()=>{
 const matrix=[['Ring','Judge','Breed'],['1','Example Judge','Pug'],['1','Example Judge','English Bulldog'],['2','Another Judge','Labrador Retriever']];
 await mkdir(new URL('.test-output/',root),{recursive:true});const bytes=workbookBytes([{name:'Allocations',rows:matrix}]);await writeFile(new URL('.test-output/allocations.xlsx',root),bytes);await writeFile(new URL('.test-output/allocations.csv',root),matrix.map(r=>r.join(',')).join('\r\n'));
 assert.equal(allocationPreview(parseXLSX(bytes)[0].rows).length,3);
});
