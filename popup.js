const $ = id => document.getElementById(id);
const status = message => { $('status').textContent = message; };

async function refresh() {
  const [{ vault }, { credentials }] = await Promise.all([
    chrome.storage.local.get('vault'), chrome.storage.session.get('credentials')
  ]);
  $('setup').hidden = !!vault;
  $('unlock').hidden = !vault || !!credentials;
  $('ready').hidden = !vault || !credentials;
  $('forget').hidden = !vault;
}

async function busy(form, action) {
  const button = form.querySelector('button');
  button.disabled = true;
  try { await action(); } catch { status('Could not save or read extension storage. Please try again.'); }
  finally { button.disabled = false; }
}

$('setup').addEventListener('submit', event => {
  event.preventDefault();
  void busy(event.currentTarget, async () => {
    const passphrase = $('new-passphrase').value;
    if (passphrase !== $('confirm').value) return status('Vault passphrases do not match.');
    const credentials = { username: $('username').value.trim(), password: $('password').value };
    credentials.securityQuestions = [1, 2, 3].map(index => ({ question: $(`question${index}`).value.trim(), answer: $(`answer${index}`).value }));
    if (credentials.securityQuestions.some(pair => !pair.question || !pair.answer)) return status('Enter all three questions and answers.');
    const normalized = credentials.securityQuestions.map(pair => pair.question.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim());
    if (new Set(normalized).size !== 3 || normalized.some(question => !question)) return status('Enter three different security questions.');
    if (!credentials.username || !credentials.password || passphrase.length < 12) return status('Complete all fields. Use at least 12 characters for the vault passphrase.');
    const vault = await ERPVault.encrypt(credentials, passphrase);
    await chrome.storage.local.set({ vault });
    await chrome.storage.session.set({ credentials });
    await chrome.runtime.sendMessage({ type: 'CANCEL_AUTOMATION' }).catch(() => {});
    $('setup').reset();
    await refresh();
    status('Saved and unlocked. Open ERP, or click Fill ERP form on an existing login tab.');
  });
});

$('edit').addEventListener('click', async () => {
  try {
    const { credentials } = await chrome.storage.session.get('credentials');
    if (!credentials) return status('Unlock your vault first.');
    $('username').value = credentials.username;
    $('password').value = credentials.password;
    for (let index = 1; index <= 3; index++) {
      const pair = credentials.securityQuestions?.[index - 1];
      $(`question${index}`).value = pair?.question || '';
      $(`answer${index}`).value = pair?.answer || '';
    }
    $('setup').hidden = false;
    $('ready').hidden = true;
    status('Add or update all three questions. Enter and confirm your vault passphrase to save the updated vault.');
  } catch { status('Could not read saved credentials. Try again.'); }
});

$('unlock').addEventListener('submit', event => {
  event.preventDefault();
  void busy(event.currentTarget, async () => {
    const { vault } = await chrome.storage.local.get('vault');
    let credentials;
    try { credentials = await ERPVault.decrypt(vault, $('passphrase').value); }
    catch { return status('Incorrect vault passphrase, or saved vault is damaged.'); }
    await chrome.storage.session.set({ credentials });
    $('unlock').reset();
    await refresh();
    status('Unlocked. Click Fill ERP form if the login page is already open.');
  });
});

$('fill').addEventListener('click', async () => {
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url || 'about:blank');
    if (url.origin !== 'https://erp.iitkgp.ac.in' || url.pathname !== '/SSOAdministration/login.htm') {
      return status('Open the ERP login page in this tab, then try again.');
    }
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'FILL_LOGIN' }, { frameId: 0 });
    status(result?.message || 'Reload the ERP login page, then try again.');
  } catch { status('Reload the ERP login page, then try again.'); }
});

$('lock').addEventListener('click', async () => {
  try {
    await chrome.storage.session.remove('credentials');
    await chrome.runtime.sendMessage({ type: 'CANCEL_AUTOMATION' }).catch(() => {});
    await refresh();
    status('Locked. Credentials already filled in ERP remain in that page.');
  } catch { status('Could not lock the vault. Try again.'); }
});

$('forget').addEventListener('click', async () => {
  if (!confirm('Remove the saved vault and unlocked credentials from this extension?')) return;
  try {
    await chrome.storage.session.remove('credentials');
    await chrome.runtime.sendMessage({ type: 'CANCEL_AUTOMATION' }).catch(() => {});
    await chrome.storage.local.remove('vault');
    await refresh();
    status('Saved credentials removed.');
  } catch { status('Could not remove the vault. Try again.'); }
});

refresh().catch(() => status('Could not read extension storage. Reopen the extension to try again.'));

async function refreshMailbox() {
  const state = await chrome.runtime.sendMessage({ type: 'ACCOUNT_STATUS' });
  if (!state || state.error) throw new Error(state?.error || 'Could not read Gmail connection status.');
  $('profile-email').textContent = state.profile ? `Chrome profile: ${state.profile.email}` : 'Chrome profile: sign in to Chrome with your OTP Google account.';
  const matched = state.connection && state.profile && state.connection.id === state.profile.id && state.connection.email === state.profile.email;
  $('mailbox-email').textContent = matched ? `Connected OTP mailbox: ${state.connection.email}` : state.connection ? 'Connected mailbox differs from this Chrome profile. Reconnect Gmail.' : 'Gmail is not connected.';
  $('connect').disabled = !state.configured || !state.profile;
  $('connect').textContent = matched ? 'Reconnect profile Gmail' : 'Connect this profile’s Gmail';
  $('disconnect').hidden = !state.connection;
  $('automatic').checked = !!state.enabled;
  $('automatic').disabled = !matched || !state.configured;
  $('automation-status').textContent = !state.configured ? 'One-time Google OAuth setup is required. Open the setup guide below.' : state.status;
}

$('connect').addEventListener('click', async () => {
  $('connect').disabled = true;
  $('automation-status').textContent = 'Opening Google authorization for this Chrome profile…';
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CONNECT_GMAIL' });
    if (response?.error) throw new Error(response.error);
    await refreshMailbox();
    $('automation-status').textContent = response.message;
  } catch (error) { $('automation-status').textContent = error.message; }
  finally { $('connect').disabled = false; }
});

$('automatic').addEventListener('change', async () => {
  const enabled = $('automatic').checked;
  $('automatic').disabled = true;
  try {
    // Turning off must take effect even if a Gmail fetch is currently in flight.
    if (!enabled) await chrome.storage.local.set({ automationEnabled: false });
    const response = await chrome.runtime.sendMessage({ type: 'SET_AUTOMATION', enabled });
    if (response?.error) throw new Error(response.error);
    await refreshMailbox();
    $('automation-status').textContent = response.message;
  } catch (error) {
    $('automatic').checked = false;
    $('automation-status').textContent = error.message;
  } finally { $('automatic').disabled = false; }
});

$('disconnect').addEventListener('click', async () => {
  $('disconnect').disabled = true;
  try {
    await chrome.storage.local.set({ automationEnabled: false });
    const response = await chrome.runtime.sendMessage({ type: 'DISCONNECT_GMAIL' });
    if (response?.error) throw new Error(response.error);
    await refreshMailbox();
    $('automation-status').textContent = response.message;
  } catch (error) { $('automation-status').textContent = error.message; }
  finally { $('disconnect').disabled = false; }
});

refreshMailbox().catch(error => { $('automation-status').textContent = error.message; });
