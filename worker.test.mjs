import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {validate} from './worker.mjs';
import breeds from './breeds.json' with {type:'json'};
const report = b => ({show:'Test',date:'2026-10-26',judge:'Test judge',country:'Sweden',breed:b.name,group:b.group,total:2,risks:b.risks.map(risk=>({risk,none:2,mild:0,clear:0,severe:0,na:0})),other:[],positive:'',quality:0,placing:0,comments:''});
test('All 38 breeds and unlisted breed validate; invalid totals rejected',()=>{
 assert.equal(breeds.length,38);
 for(const b of breeds) assert.ok(validate({report:report(b),sendCopy:false}));
 assert.ok(validate({report:report({name:'Other test',group:'Not BSI-listed',risks:[]}),sendCopy:false}));
 const p=report(breeds[0]);p.risks[0].none=3;
 assert.equal(validate({report:p,sendCopy:false}),false);
 assert.equal(validate({report:report(breeds[0]),sendCopy:true,email:'bad'}),false);
});
test('Store before mail; no opt-in means no mail; failure preserves submission',async()=>{
 const original=globalThis.fetch;
 try {
  for(const mode of ['none','accepted','failed']) {
   const calls=[];
   globalThis.fetch=async(url)=>{
    if(url.includes('siteverify'))return Response.json({success:true,hostname:'callevys-create.github.io',action:'bsi-submit'});
    calls.push('email');return mode==='accepted'?Response.json({id:'provider-id'}):new Response('',{status:500});
   };
   const env={ALLOWED_ORIGIN:'https://callevys-create.github.io',ALLOWED_HOSTNAME:'callevys-create.github.io',TURNSTILE_SECRET:'test',RESEND_API_KEY:'test',MAIL_FROM:'test@example.org',RATE_LIMITER:{limit:async()=>({success:true})},DB:{prepare:()=>({bind:()=>({run:async()=>{calls.push('stored');}})})}};
   const request=new Request('https://service.example/reports',{method:'POST',headers:{Origin:env.ALLOWED_ORIGIN,'Content-Type':'application/json'},body:JSON.stringify({report:report(breeds[0]),sendCopy:mode!=='none',email:'test@example.org',token:'test'})});
   const response=await worker.fetch(request,env);const result=await response.json();
   assert.equal(response.status,201);assert.equal(result.submitted,true);assert.equal(result.email,mode==='none'?'not_requested':mode);
   assert.deepEqual(calls,mode==='none'?['stored']:['stored','email']);
   const denied=await worker.fetch(new Request('https://service.example/reports'),env);assert.equal(denied.status,403);
  }
 } finally {globalThis.fetch=original;}
});
