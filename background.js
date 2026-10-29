importScripts('otp.js', 'gmail.js', 'automation.js');

function isLogin(url) {
  try {
    const parsed = new URL(url);
    return parsed.origin === 'https://erp.iitkgp.ac.in' && parsed.pathname === '/SSOAdministration/login.htm';
  } catch { return false; }
}

// Serialize all mailbox/automation mutations, including concurrent ERP tabs.
let queue = Promise.resolve();
function serial(action) {
  const result = queue.then(action, action);
  queue = result.catch(() => {});
  return result;
}
async function popupAction(message) {
  if (message.type === 'CANCEL_AUTOMATION') return ERPAutomation.cancel();
  if (message.type === 'ACCOUNT_STATUS') {
    let profile = null;
    try { profile = await ERPGmail.primary(); } catch { /* Signed-out Chrome profile. */ }
    const { gmailConnection, automationEnabled } = await chrome.storage.local.get(['gmailConnection', 'automationEnabled']);
    const { automationJob } = await chrome.storage.session.get('automationJob');
    return { profile, connection: gmailConnection || null, enabled: !!automationEnabled,
      configured: ERPGmail.configured(), extensionId: chrome.runtime.id,
      status: automationJob?.status || '' };
  }
  if (message.type === 'CONNECT_GMAIL') {
    const client = await ERPGmail.client(true);
    await chrome.storage.local.set({ gmailConnection: client.profile });
    return { ok: true, message: 'Connected to this Chrome profile Gmail. Enable Automatic OTP & login when ready.' };
  }
  if (message.type === 'SET_AUTOMATION') {
    if (message.enabled === true) {
      const { gmailConnection } = await chrome.storage.local.get('gmailConnection');
      if (!gmailConnection) throw new Error('Connect profile Gmail first.');
      await ERPGmail.client(false, gmailConnection);
    }
    await chrome.storage.local.set({ automationEnabled: message.enabled === true });
    if (!message.enabled) await ERPAutomation.cancel();
    return { ok: true, message: message.enabled ? 'Automatic OTP and login enabled. Open or reload ERP to start.' : 'Automatic OTP off. Manual login remains available.' };
  }
  if (message.type === 'DISCONNECT_GMAIL') {
    await chrome.storage.local.set({ automationEnabled: false });
    await ERPAutomation.cancel();
    await chrome.identity.clearAllCachedAuthTokens();
    await chrome.storage.local.remove('gmailConnection');
    return { ok: true, message: 'Gmail disconnected and automatic login disabled. You can also remove the app grant in your Google Account permissions.' };
  }
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id) return;
  const popup = !sender.tab && sender.url === chrome.runtime.getURL('popup.html');
  const login = sender.frameId === 0 && isLogin(sender.url) && isLogin(sender.tab?.url);
  if (message?.type === 'GET_LOGIN' && login) {
    Promise.all([chrome.storage.session.get('credentials'), chrome.storage.local.get('automationEnabled')])
      .then(([{ credentials }, { automationEnabled }]) => respond(credentials ?
        { credentials, autoEnabled: !!automationEnabled } : { error: 'locked' }))
      .catch(() => respond({ error: 'storage' }));
    return true;
  }
  const popupTypes = ['ACCOUNT_STATUS', 'CONNECT_GMAIL', 'SET_AUTOMATION', 'DISCONNECT_GMAIL', 'CANCEL_AUTOMATION'];
  const loginTypes = ['AUTO_STEP', 'CANCEL_AUTOMATION', 'AUTO_SUBMITTED'];
  if (popup && popupTypes.includes(message?.type)) {
    serial(() => popupAction(message)).then(respond).catch(error => respond({ error: error.message }));
    return true;
  }
  if (login && loginTypes.includes(message?.type)) {
    serial(async () => {
      if (message.type === 'AUTO_STEP') return ERPAutomation.step({
        ready: message.page?.ready === true, otpEditable: message.page?.otpEditable === true,
        otpPresent: message.page?.otpPresent === true, failed: message.page?.failed === true
      }, sender);
      if (message.type === 'CANCEL_AUTOMATION') return ERPAutomation.cancel(sender);
      return ERPAutomation.submitted(message.jobId, sender);
    }).then(respond).catch(() => respond({ action: 'stopped', message: 'Automatic login could not continue. Complete OTP manually.' }));
    return true;
  }
});

chrome.identity.onSignInChanged.addListener(() => {
  // Gate checks also run on every OTP poll; this makes the setting explicit in UI.
  void chrome.storage.local.set({ automationEnabled: false }).then(() => serial(async () => {
    await ERPAutomation.cancel(null, 'Google sign-in changed. Reconnect Gmail before enabling automatic login.');
    await chrome.storage.local.remove('gmailConnection');
  })).catch(() => {});
});
