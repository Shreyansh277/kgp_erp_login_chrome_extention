globalThis.ERPLoginAuto = (() => {
  let stopped = false, issued = false, submitted = false, started = false, expectedQuestion = '';
  function status(message) {
    const form = document.getElementById('loginForm');
    if (!form) return;
    let note = document.getElementById('kgp-login-status');
    if (!note) {
      const section = document.createElement('div');
      section.style.cssText = 'margin-top:16px;padding:12px;border:1px solid #ccd7e8;border-radius:8px;background:#f4f7fc;color:#203b65;font:13px/1.5 system-ui';
      note = document.createElement('p'); note.id = 'kgp-login-status';
      note.setAttribute('role', 'status'); note.style.margin = '0';
      const stop = document.createElement('button'); stop.type = 'button';
      stop.textContent = 'Stop automatic login';
      stop.style.cssText = 'margin-top:8px;padding:4px 8px;background:white;border:1px solid #a8b7ce;border-radius:4px;color:#203b65;cursor:pointer';
      stop.addEventListener('click', () => void cancel());
      section.append(note, stop); form.append(section);
    }
    note.textContent = 'ERP Helper · ' + message;
  }
  async function cancel(message = 'Stopped. You can enter the OTP and log in manually.') {
    stopped = true;
    status(message);
    try { await chrome.runtime.sendMessage({ type: 'CANCEL_AUTOMATION' }); } catch { /* Page may be navigating. */ }
  }
  function controls(credentials) {
    const fields = ERPForm.fields(document);
    const otp = document.getElementById('email_otp1');
    const button = document.getElementById('getotp');
    const login = document.getElementById('loginFormSubmitButton');
    const question = ERPForm.normalize(document.getElementById('question')?.textContent);
    const answer = fields?.answer && ERPForm.matchAnswer(fields.answer, credentials.securityQuestions);
    if (!fields || !otp || !button || !login || !fields.answer || !answer ||
        fields.username.value !== credentials.username || fields.password.value !== credentials.password ||
        fields.answer.value !== answer || [otp, button, login].some(element => element.form !== fields.username.form)) return null;
    return { ...fields, otp, button, login, question };
  }
  async function run(credentials) {
    if (stopped || submitted) return null;
    const current = controls(credentials);
    if (!current) return null;
    if (started && expectedQuestion !== current.question) {
      await cancel('Security question changed during this attempt. Complete login manually or reload ERP.');
      return null;
    }
    const failed = !!document.querySelector('.swal2-icon-error') || /unable|invalid|incorrect|failed|error/i.test(document.querySelector('.swal2-title')?.textContent || '');
    const response = await chrome.runtime.sendMessage({ type: 'AUTO_STEP', page: {
      ready: !current.button.disabled && !current.otp.value,
      otpEditable: !current.otp.readOnly && !current.otp.disabled,
      otpPresent: !!current.otp.value, failed
    } });
    if (!response) return null;
    if (stopped) return null;
    status(response.message || 'Checking automatic login…');
    if (response.action === 'stopped') { stopped = true; return response; }
    if (response.action === 'requestOtp') {
      if (issued) return cancel('An OTP has already been requested. Complete login manually.');
      const verified = controls(credentials);
      if (!verified || verified.button.disabled || !verified.otp.readOnly || verified.otp.value) return cancel('The form changed before requesting OTP. Complete login manually.');
      // Recheck the vault/setting immediately before each consequential page action.
      const state = await chrome.runtime.sendMessage({ type: 'GET_LOGIN' });
      if (!state?.autoEnabled || !state.credentials || state.credentials.username !== credentials.username || state.credentials.password !== credentials.password || stopped) return cancel('Automatic login paused or vault locked.');
      const latest = controls(state.credentials);
      if (!latest || latest.button.disabled || !latest.otp.readOnly || latest.otp.value) return cancel('The form changed before requesting OTP.');
      expectedQuestion = latest.question; started = true; issued = true;
      latest.button.click();
    }
    if (response.action === 'submit') {
      const state = await chrome.runtime.sendMessage({ type: 'GET_LOGIN' });
      if (!state?.autoEnabled || !state.credentials || stopped || state.credentials.username !== credentials.username || state.credentials.password !== credentials.password) return cancel('Automatic login paused or vault locked.');
      const verified = controls(state.credentials);
      if (!verified || verified.question !== expectedQuestion || verified.otp.readOnly || verified.otp.disabled || verified.otp.value || verified.login.disabled || !/^\d{6}$/.test(response.otp || '')) {
        return cancel('The login form changed. Complete OTP manually.');
      }
      // ERP shows a success modal after requesting OTP. Dismiss only that specific notice.
      const title = document.querySelector('.swal2-title')?.textContent || '';
      if (/^otp sent!?$/i.test(title.trim())) document.querySelector('.swal2-confirm')?.click();
      submitted = true;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(verified.otp, response.otp);
      verified.otp.dispatchEvent(new Event('input', { bubbles: true }));
      verified.otp.dispatchEvent(new Event('change', { bubbles: true }));
      verified.login.click();
      status('Login submitted once. ERP will show the result.');
      void chrome.runtime.sendMessage({ type: 'AUTO_SUBMITTED', jobId: response.jobId }).catch(() => {});
    }
    return response;
  }
  // A person's own OTP entry or login-button click takes priority over automation.
  document.addEventListener('input', event => {
    if (event.isTrusted && event.target?.id === 'email_otp1') void cancel('Manual OTP entry detected. Automatic login stopped.');
  }, true);
  document.addEventListener('click', event => {
    if (event.isTrusted && event.target?.closest?.('#getotp, #loginFormSubmitButton')) void cancel('You took over login. Automatic OTP stopped.');
  }, true);
  return { run, active: () => started && !submitted && !stopped,
    paused() { if (started && !submitted && !stopped) void cancel('Automatic login paused or vault locked. Complete manually or reload ERP after unlocking.'); } };
})();
