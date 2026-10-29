(() => {
  if (globalThis.kgpLoginHelperLoaded) return;
  globalThis.kgpLoginHelperLoaded = true;
  function setInput(input, value) {
    if (input.value === value) return;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
  let busy = false;
  const filledAnswers = new WeakMap();
  const requestedQuestions = new WeakMap();
  async function fill(manual = false) {
    if (busy) return { ok: false, message: 'Please try again in a moment.' };
    busy = true;
    try {
      let target = ERPForm.fields(document);
      if (!target) return { ok: false, message: 'Cannot identify the ERP login fields safely. Ensure the login form is visible.' };
      const result = await chrome.runtime.sendMessage({ type: 'GET_LOGIN' });
      if (!result?.credentials) {
        globalThis.ERPLoginAuto?.paused();
        return { ok: false, message: 'Open the extension and unlock your vault first.' };
      }
      if (!result.autoEnabled) globalThis.ERPLoginAuto?.paused();
      const credentials = result.credentials;
      target = ERPForm.fields(document);
      if (!target) return { ok: false, message: 'The form changed. Try again.' };
      if (manual || !target.username.value) setInput(target.username, credentials.username);
      // User-ID blur can trigger the security-question request and rerender the form.
      target = ERPForm.fields(document);
      if (!target || target.username.value !== credentials.username) return { ok: false, message: 'Existing user ID left unchanged. Click Fill ERP form to replace it.' };
      if (manual || !target.password.value) setInput(target.password, credentials.password);
      if (target.password.value !== credentials.password) return { ok: false, message: 'Existing password left unchanged. Click Fill ERP form to replace it.' };
      // ERP registers a direct jQuery blur handler on #user_id. Dispatch it ONCE
      // per username, including when a password manager filled the ID already.
      // Dispatching both blur and focusout can trigger duplicate jQuery lookups.
      if (requestedQuestions.get(target.username) !== credentials.username) {
        requestedQuestions.set(target.username, credentials.username);
        target.username.dispatchEvent(new Event('blur'));
        return { ok: true, message: 'Credentials filled. ERP is loading your security question; its matching answer will fill automatically.' };
      }
      const answer = target.answer && ERPForm.matchAnswer(target.answer, credentials.securityQuestions);
      if (answer && target.answer && (manual || !target.answer.value || filledAnswers.get(target.answer) === target.answer.value)) {
        setInput(target.answer, answer);
        filledAnswers.set(target.answer, answer);
      }
      if (result.autoEnabled && answer && target.answer?.value === answer) {
        const automatic = await globalThis.ERPLoginAuto?.run(credentials);
        if (automatic?.message) return { ok: automatic.action !== 'stopped', message: automatic.message };
      }
      return { ok: true, message: answer ? 'Credentials and security answer filled. Request your OTP on ERP.' :
        'Credentials filled. Waiting for a matching security question. Save all three question/answer pairs in the extension; OTP stays manual.' };
    } catch { return { ok: false, message: 'Reload the ERP page, then try again.' }; }
    finally { busy = false; }
  }
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'FILL_LOGIN') return;
    fill(true).then(respond);
    return true;
  });
  // ERP reveals/changes its question asynchronously. Recheck without caching secrets,
  // so locking the vault takes effect and unlocking works on an already open page.
  void fill();
  setInterval(() => { if (!document.hidden || globalThis.ERPLoginAuto?.active()) void fill(); }, 1000);
})();
