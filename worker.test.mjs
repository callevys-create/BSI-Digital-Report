import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {generateKeyPair,exportJWK,SignJWT} from 'jose';
import {Webhook} from 'svix';
import worker from './worker.mjs';
import {validate} from './validation.mjs';
import {saveSubmission,receiptReport} from './storage.mjs';
import {processOutbox} from './delivery.mjs';
import {VERSION,statistics,csv} from './statistics.mjs';
import {reportPDF,excelBytes,statisticsPDF} from './exports.mjs';
import breeds from './breeds.json' with {type:'json'};
const schema=await readFile(new URL('./schema.sql',import.meta.url),'utf8')+await readFile(new URL('./organiser-schema.sql',import.meta.url),'utf8');
const font=await readFile(new URL('./NotoSans-Regular.ttf',import.meta.url));
const report=(b=breeds[4],year=2026)=>({schema:'bsi-prototype-3',organisingClub:{type:'regional',id:'stockholm'},ring:'1',source:'Test working summaries',bsiVersion:VERSION,show:'Example Show',date:`${year}-06-01`,judge:'Synthetic Judge Åsa',country:'Sweden',breed:b.name,group:b.group,total:10,risks:b.risks.map(risk=>({risk,none:5,mild:2,clear:1,severe:1,na:1})),other:[{problem:'Test other concern',count:1}],positive:'Comfortable movement',quality:2,placing:1,comments:'Complete comments'});
const body=()=>({report:report(),sendCopy:true,email:'judge@example.org',submissionKey:crypto.randomUUID().replaceAll('-',''),receiptKey:crypto.randomUUID().replaceAll('-',''),token:'test'});
function database(){
 const db=new DatabaseSync(':memory:');db.exec(schema);
 const prepare=sql=>({bind(...values){return {async first(){return db.prepare(sql).get(...values)||null;},async all(){return {results:db.prepare(sql).all(...values)};},async run(){const r=db.prepare(sql).run(...values);return {meta:{changes:Number(r.changes)}};}};},async all(){return {results:db.prepare(sql).all()};},async first(){return db.prepare(sql).get()||null;}});
 return {prepare,async batch(statements){db.exec('BEGIN');try{const out=[];for(const s of statements)out.push(await s.run());db.exec('COMMIT');return out;}catch(e){db.exec('ROLLBACK');throw e;}},raw:db};
}
function environment(){
 const DB=database(),objects=new Map();
 DB.raw.prepare('INSERT INTO recipients VALUES (?,?,1,?)').run('recipient-one','skk-one@example.org','2026-01-01');
 DB.raw.prepare('INSERT INTO recipients VALUES (?,?,1,?)').run('recipient-two','skk-two@example.org','2026-01-01');
 return {DB,PDFS:{async get(k){const b=objects.get(k);return b?{arrayBuffer:async()=>b}:null;},async put(k,b){objects.set(k,b);}},objects,ASSETS:{async fetch(){return new Response(font);}},ALLOWED_ORIGIN:'https://callevys-create.github.io',ALLOWED_HOSTNAME:'callevys-create.github.io',TURNSTILE_SECRET:'test',RESEND_API_KEY:'test',MAIL_FROM:'reports@example.org',RATE_LIMITER:{limit:async()=>({success:true})}};
}
test('All breeds validate; bad dates, metadata, totals and missing consent email are rejected',()=>{
 assert.equal(breeds.length,38);for(const b of breeds)assert.ok(validate({...body(),report:report(b)}));
 assert.ok(validate({...body(),report:report({name:'Other breed',group:'Not BSI-listed',risks:[]})}));
 for(const change of [{total:0},{date:'2026-02-30'},{date:'2026-13-01'},{judge:''},{show:''},{bsiVersion:'wrong'},{quality:11},{risks:[null]}])assert.equal(validate({...body(),report:{...report(),...change}}),false);
 assert.equal(validate({...body(),email:'invalid'}),false);assert.equal(validate({...body(),sendCopy:false,email:''}),true);
});
test('Atomic storage, multiple recipients, idempotency, conflict and private receipts',async()=>{
 const env=environment(),b=body(),first=await saveSubmission(env,b),second=await saveSubmission(env,b);
 assert.equal(first.id,second.id);assert.equal(second.duplicate,true);
 assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM submissions').get().n,1);
 assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM deliveries').get().n,3);
 assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM assessments').get().n,4);
 assert.ok(await receiptReport(env,first.id,b.receiptKey));assert.equal(await receiptReport(env,first.id,'wrong'),null);
 await assert.rejects(()=>saveSubmission(env,{...b,report:{...b.report,total:12}}),{status:409});
 const noCopy=await saveSubmission(env,{...body(),sendCopy:false});assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM deliveries WHERE report_id=?').get(noCopy.id).n,2);
 env.DB.raw.exec('UPDATE recipients SET active=0');await assert.rejects(()=>saveSubmission(env,body()),{status:503});
});
test('Identical complete PDFs go to SKK and judge; retries never duplicate reports',async()=>{
 const env=environment(),saved=await saveSubmission(env,body()),original=globalThis.fetch,copies=[];let fail=true;
 try{globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');const mail=JSON.parse(options.body);copies.push(mail);if(mail.to[0]==='skk-one@example.org'&&fail)return new Response('',{status:503});return Response.json({id:'provider-'+mail.to[0]});};
 await processOutbox(env,10);assert.equal(copies.length,3);assert.equal(new Set(copies.map(c=>c.attachments[0].content)).size,1);
 assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='retry'").get().n,1);
 fail=false;env.DB.raw.exec('UPDATE deliveries SET next_attempt=0');await processOutbox(env,10);assert.equal(copies.length,4);
 assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='accepted'").get().n,3);
 await processOutbox(env,10);assert.equal(copies.length,4);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM submissions').get().n,1);
 assert.ok(env.objects.has(`reports/${saved.id}.pdf`));assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM delivery_events').get().n,4);
 }finally{globalThis.fetch=original;}
});
test('Delivery leases prevent concurrent claims and expired retry windows require review',async()=>{
 const env=environment();await saveSubmission(env,body());const original=globalThis.fetch;let calls=0;
 try{globalThis.fetch=async()=>{const id=++calls;await new Promise(r=>setTimeout(r,5));return Response.json({id:'unique-'+id});};await Promise.all([processOutbox(env,10),processOutbox(env,10)]);assert.equal(calls,3);
 env.DB.raw.exec("UPDATE deliveries SET status='retry',first_attempt=1,next_attempt=0,lease_until=0");await processOutbox(env,10);assert.equal(calls,3);assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM deliveries WHERE status='uncertain'").get().n,3);
 }finally{globalThis.fetch=original;}
});
test('Date boundaries, annual comparisons, assessed denominator and BSI versions',()=>{
 const p=report(),q=report(breeds[4],2027);q.risks=q.risks.map(r=>({...r,none:7,mild:0}));const filters={start:'2026-06-01',end:'2027-06-01',breed:p.breed};
 const s=statistics([p,q],filters);assert.equal(s.summary.reports,2);assert.equal(s.summary.dogs,20);assert.equal(s.summary.uniqueDogs,null);
 assert.equal(s.areas[0].assessed,9);assert.equal(s.areas[0].concernPct,400/9);assert.ok(s.areas[1].changePP<0);
 const zero=report();zero.risks=zero.risks.map(r=>({...r,none:0,mild:0,clear:0,severe:0,na:10}));assert.equal(statistics([zero],{start:'2026-01-01',end:'2026-12-31'}).areas[0].concernPct,null);
 q.bsiVersion='changed-definition';assert.equal(statistics([p,q],filters).areas.find(r=>r.year==='2027').changePP,null);
 assert.equal(statistics([p],{start:'2027-01-01',end:'2028-12-31'}).summary.reports,0);assert.throws(()=>statistics([],{start:'invalid',end:'2026-01-01'}));assert.ok(csv([['=HYPERLINK("bad")']]).includes("'=HYPERLINK"));
});
test('Signed delivery webhooks, replay and bounced status',async()=>{
 const env=environment();await saveSubmission(env,body());env.RESEND_WEBHOOK_SECRET='whsec_'+Buffer.from('synthetic-webhook-secret-32-chars').toString('base64');
 const d=env.DB.raw.prepare('SELECT id FROM deliveries LIMIT 1').get();env.DB.raw.prepare("UPDATE deliveries SET provider_id='provider-123',status='accepted' WHERE id=?").run(d.id);
 const text=JSON.stringify({type:'email.bounced',created_at:new Date().toISOString(),data:{email_id:'provider-123'}}),id='msg_test',now=new Date(),signature=new Webhook(env.RESEND_WEBHOOK_SECRET).sign(id,now,text);
 const req=()=>new Request('https://backend.test/webhooks/resend',{method:'POST',headers:{'svix-id':id,'svix-timestamp':String(Math.floor(now.getTime()/1000)),'svix-signature':signature},body:text});
 assert.equal((await worker.fetch(req(),env)).status,200);assert.equal((await worker.fetch(req(),env)).status,200);assert.equal(env.DB.raw.prepare('SELECT status FROM deliveries WHERE id=?').get(d.id).status,'bounced');assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM provider_events').get().n,1);
 assert.equal((await worker.fetch(new Request('https://backend.test/webhooks/resend',{method:'POST',body:text}),env)).status,401);
});
test('API stores verified submissions; origins and unconfigured admin fail closed',async()=>{
 const env=environment(),b=body(),original=globalThis.fetch;
 try{globalThis.fetch=async()=>Response.json({success:true,hostname:env.ALLOWED_HOSTNAME,action:'bsi-submit'});
 const request=()=>new Request('https://backend.test/reports',{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify(b)});
 let r=await worker.fetch(request(),env);assert.equal(r.status,201);const first=await r.json();r=await worker.fetch(request(),env);assert.equal(r.status,200);assert.equal((await r.json()).id,first.id);
 assert.equal((await worker.fetch(new Request('https://backend.test/reports',{method:'POST'}),env)).status,403);
 assert.equal((await worker.fetch(new Request('https://backend.test/api/admin/statistics'),env)).status,503);
 assert.equal((await worker.fetch(new Request(`https://backend.test/receipts/${first.id}`),env)).status,404);
 assert.equal((await worker.fetch(new Request(`https://backend.test/receipts/${first.id}`,{headers:{Authorization:`Bearer ${b.receiptKey}`}}),env)).status,200);
 }finally{globalThis.fetch=original;}
});
test('Signed administrator sessions, analyst permissions, forged tokens and CSRF',async()=>{
 const env=environment(),original=globalThis.fetch;env.ACCESS_TEAM_DOMAIN='bsi-unit-test.cloudflareaccess.com';env.ACCESS_AUD='audience';env.MANAGER_EMAILS='manager@example.org';env.ANALYST_EMAILS='analyst@example.org';
 const {privateKey,publicKey}=await generateKeyPair('RS256'),jwk=await exportJWK(publicKey);jwk.kid='test';jwk.alg='RS256';
 const sign=email=>new SignJWT({email}).setProtectedHeader({alg:'RS256',kid:'test'}).setIssuer('https://'+env.ACCESS_TEAM_DOMAIN).setAudience(env.ACCESS_AUD).setExpirationTime('5m').sign(privateKey);
 try{globalThis.fetch=async()=>Response.json({keys:[jwk]});const token=await sign('analyst@example.org'),headers={'Cf-Access-Jwt-Assertion':token};
 assert.equal((await worker.fetch(new Request('https://backend.test/api/admin/session',{headers}),env)).status,200);
 assert.equal((await worker.fetch(new Request('https://backend.test/api/admin/recipients',{headers}),env)).status,403);
 assert.equal((await worker.fetch(new Request('https://backend.test/api/admin/session',{headers:{'Cf-Access-Jwt-Assertion':'forged'}}),env)).status,401);
 const h={'Cf-Access-Jwt-Assertion':await sign('manager@example.org'),'Content-Type':'application/json'};
 const req=origin=>new Request('https://backend.test/api/admin/recipients',{method:'POST',headers:{...h,Origin:origin},body:JSON.stringify({email:'new@example.org'})});
 assert.equal((await worker.fetch(req('https://attacker.test'),env)).status,403);assert.equal((await worker.fetch(req('https://backend.test'),env)).status,200);assert.equal(env.DB.raw.prepare('SELECT COUNT(*) n FROM audit_log').get().n,1);
 const recipient=env.DB.raw.prepare("SELECT id FROM recipients WHERE email='new@example.org'").get();
 const remove=()=>new Request('https://backend.test/api/admin/recipients/'+recipient.id,{method:'DELETE',headers:{...h,Origin:'https://backend.test'}});
 assert.equal((await worker.fetch(remove(),env)).status,200);
 assert.equal((await worker.fetch(req('https://backend.test'),env)).status,200);
 assert.equal(env.DB.raw.prepare("SELECT active FROM recipients WHERE email='new@example.org'").get().active,1);
 assert.equal(env.DB.raw.prepare("SELECT COUNT(*) n FROM recipients WHERE email='new@example.org'").get().n,1);
 }finally{globalThis.fetch=original;}
});
test('Generate real PDF and Excel fixtures from the same statistics engine',async()=>{
 const p=report();p.comments='Unicode preserved: Åsa, ögon, français, 日本語. '+('Long comment with all details. '.repeat(100));
 const s=statistics([p,report(breeds[4],2027)],{start:'2026-01-01',end:'2030-12-31',breed:p.breed});
 await mkdir(new URL('./.test-output/',import.meta.url),{recursive:true});
 const pdf=await reportPDF(p,'TEST-REPORT-001',font);assert.equal(Buffer.from(pdf).subarray(0,4).toString(),'%PDF');const xlsx=excelBytes(s);assert.equal(Buffer.from(xlsx).subarray(0,2).toString(),'PK');
 await writeFile(new URL('./.test-output/report.pdf',import.meta.url),pdf);await writeFile(new URL('./.test-output/statistics.pdf',import.meta.url),await statisticsPDF(s,font));await writeFile(new URL('./.test-output/statistics.xlsx',import.meta.url),xlsx);
});
