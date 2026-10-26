(() => {
  const config = window.BSI_SERVICE || {};
  const email = document.getElementById('judgeEmail');
  const copy = document.getElementById('sendCopy');
  const button = document.getElementById('submitReport');
  const status = document.getElementById('submissionStatus');
  let token = '', widget;
  copy.onchange = () => { email.required = copy.checked; };
  // Fail closed until all public configuration has been supplied.
  if (!config.endpoint || !config.turnstileSiteKey || !config.privacyUrl) return;
  try {
    if (![config.endpoint, config.privacyUrl].every(url => new URL(url).protocol === 'https:')) return;
  } catch { return; }
  const notice = document.getElementById('serviceStatus');
  notice.textContent = 'Connected submission: your completed report is stored by the report service. If requested, your email and report are passed to the email provider for a copy. Provider acceptance does not guarantee inbox delivery. ';
  const privacy = document.createElement('a');
  privacy.href = config.privacyUrl; privacy.textContent = 'Privacy and retention information';
  notice.appendChild(privacy);
  window.bsiCaptchaReady = () => {
    widget = window.turnstile.render('#captcha', {
      sitekey: config.turnstileSiteKey, action: 'bsi-submit',
      callback: value => { token = value; button.disabled = false; },
      'expired-callback': () => { token = ''; button.disabled = true; },
      'error-callback': () => { token = ''; button.disabled = true; }
    });
  };
  const script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=bsiCaptchaReady&render=explicit';
  script.async = true;
  script.onerror = () => { status.textContent = 'Verification could not load. Export your report instead.'; };
  document.head.appendChild(script);
  button.onclick = async () => {
    if (!check(true)) return;
    email.required = copy.checked;
    if (copy.checked && !email.reportValidity()) return;
    if (!token) return;
    const report = payload();
    button.disabled = true; status.textContent = 'Submitting report…';
    try {
      const response = await fetch(config.endpoint, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ report, sendCopy: copy.checked, email: copy.checked ? email.value.trim() : '', token }),
        signal: AbortSignal.timeout(25000)
      });
      const result = await response.json();
      if (!response.ok || result.submitted !== true || !result.id) throw new Error('not-confirmed');
      status.textContent = `Report stored. Reference: ${result.id}. ` + (result.email === 'accepted'
        ? 'Your copy was accepted by the email provider; inbox delivery is not yet confirmed.'
        : result.email === 'failed' ? 'The email copy could not be confirmed. Save JSON or Print / PDF; do not resubmit just for email.'
        : 'No email copy requested.');
    } catch {
      status.textContent = 'Submission could not be confirmed. The report may have reached the service. Save JSON or Print / PDF before retrying.';
    } finally {
      token = ''; window.turnstile.reset(widget);
    }
  };
})();
