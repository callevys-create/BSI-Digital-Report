(() => {
 const $=id=>document.getElementById(id), config=window.BSI_SERVICE||{};
 const email=$('judgeEmail'),copy=$('sendCopy'),button=$('submitReport'),status=$('submissionStatus');
 let token='',widget,busy=false,currentReceipt=null;
 const fields=['show','date','judge','country'];
 copy.onchange=()=>{email.required=copy.checked;};
 const complete=()=>{
  if(!check(true))return false;
  const missing=fields.filter(k=>!$(k).value.trim());
  if(missing.length){$('message').textContent='Complete these details: '+missing.join(', ');return false;}
  return true;
 };
 const randomKey=()=>crypto.randomUUID().replaceAll('-','')+crypto.randomUUID().replaceAll('-','');
 const digest=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s)))).map(x=>x.toString(16).padStart(2,'0')).join('');
 const envelope=()=>({report:payload(),sendCopy:copy.checked,email:copy.checked?email.value.trim():''});
 const receiptURL=id=>new URL(`/receipts/${id}`,config.endpoint).href;
 const download=(bytes,name,type)=>{const a=document.createElement('a'),url=URL.createObjectURL(new Blob([bytes],{type}));a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 $('downloadPDF').onclick=async()=>{
  if(!check(true))return;
  try{
   $('downloadPDF').disabled=true;
   if(currentReceipt&&currentReceipt.fingerprint===await digest(JSON.stringify(envelope()))){
    const response=await fetch(receiptURL(currentReceipt.id)+'/pdf',{headers:{Authorization:`Bearer ${currentReceipt.receiptKey}`}});
    if(!response.ok)throw new Error('Saved PDF is not available yet. Please try again.');
    download(await response.arrayBuffer(),`BSI-${currentReceipt.id}.pdf`,'application/pdf');
   } else {
    const [{reportPDF},font]=await Promise.all([import('./exports-client.js'),fetch('./NotoSans-Regular.ttf').then(r=>{if(!r.ok)throw new Error('font');return r.arrayBuffer();})]);
    download(await reportPDF(payload(),'DRAFT - not submitted',new Uint8Array(font)),'BSI-draft-report.pdf','application/pdf');
    status.textContent='Draft PDF downloaded. This does not submit the report.';
   }
  }catch{status.textContent='PDF download could not complete. Try again or use Print / PDF.';}finally{$('downloadPDF').disabled=false;}
 };
 const disconnected=()=>{button.textContent='Submission not connected';button.disabled=true;};
 disconnected();
 if(!config.endpoint||!config.turnstileSiteKey||!config.privacyUrl)return;
 try{if(![config.endpoint,config.privacyUrl].every(u=>new URL(u).protocol==='https:'))return;}catch{return;}
 $('serviceStatus').textContent='Connected service: the report is saved centrally and distributed automatically to configured SKK recipients. Request a copy to receive the same complete PDF by email. Email delivery is tracked separately from submission. ';
 const a=document.createElement('a');a.href=config.privacyUrl;a.textContent='Privacy and retention information';$('serviceStatus').appendChild(a);
 button.textContent='Submit report';
 const receiptButton=$('checkDelivery');
 const refresh=async()=>{
  if(!currentReceipt)return;
  try{
   const response=await fetch(receiptURL(currentReceipt.id),{headers:{Authorization:`Bearer ${currentReceipt.receiptKey}`}});
   if(!response.ok)throw new Error();const r=await response.json();
   status.textContent=`Report saved. ID: ${r.id}. Distribution: `+r.deliveries.map(d=>`${d.purpose}: ${d.status}`).join('; ')+'. Accepted means the provider accepted the email; delivered means the recipient mail server accepted it.';
  }catch{status.textContent='Delivery status unavailable. Your saved report is not deleted.';}
 };
 receiptButton.onclick=refresh;
 window.bsiCaptchaReady=()=>{
  widget=window.turnstile.render('#captcha',{sitekey:config.turnstileSiteKey,action:'bsi-submit',callback:value=>{token=value;if(!busy)button.disabled=false;},'expired-callback':()=>{token='';button.disabled=true;},'error-callback':()=>{token='';button.disabled=true;}});
 };
 const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?onload=bsiCaptchaReady&render=explicit';script.async=true;script.onerror=()=>{status.textContent='Verification could not load. Download your report instead.';};document.head.appendChild(script);
 button.onclick=async()=>{
  if(busy||!complete())return;
  email.required=copy.checked;if(copy.checked&&!email.reportValidity())return;if(!token)return;
  busy=true;button.disabled=true;
  try {
   const body=envelope(),fingerprint=await digest(JSON.stringify(body));
   let attempt;try{attempt=JSON.parse(localStorage.getItem('bsi-submission-attempt'));}catch{}
   if(attempt?.fingerprint!==fingerprint)attempt={fingerprint,submissionKey:randomKey(),receiptKey:randomKey()};
   // Store only capability keys and a content hash, never report details or email.
   localStorage.setItem('bsi-submission-attempt',JSON.stringify(attempt));
   status.textContent='Saving report…';
   const response=await fetch(config.endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,token,submissionKey:attempt.submissionKey,receiptKey:attempt.receiptKey}),signal:AbortSignal.timeout(25000)});
   const result=await response.json();if(!response.ok||!result.submitted)throw new Error(result.error||'Submission not confirmed');
   currentReceipt={...attempt,id:result.id};
   localStorage.setItem('bsi-submission-attempt',JSON.stringify(currentReceipt));receiptButton.hidden=false;
   status.textContent=`Report saved. ID: ${result.id}. ${result.duplicate?'Your earlier submission was found; no duplicate report was created.':'PDF copies are queued for SKK and, if requested, the judge.'} You can download the saved PDF or check delivery status.`;
  }catch(error){status.textContent=`${error.message}. If the connection was interrupted, the report may already be saved. Retry with the unchanged form to recover the same report, or download a draft PDF.`;}
  finally{busy=false;token='';window.turnstile.reset(widget);button.disabled=true;}
 };
})();
