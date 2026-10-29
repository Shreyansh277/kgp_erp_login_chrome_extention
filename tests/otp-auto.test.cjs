const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { webcrypto } = require('node:crypto');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
function mail({ id = 'new', time = 1000000, body = 'Your OTP is 123456.', from = 'ERP <erpkgp@adm.iitkgp.ac.in>', subject = 'ERP OTP', mimeType = 'text/plain' } = {}) {
  return { id, internalDate: String(time), payload: { mimeType, headers: [{ name: 'From', value: from }, { name: 'Subject', value: subject }], body: { data: Buffer.from(body).toString('base64url') } } };
}
function worker() {
  const data = { local: { gmailConnection: { id: 'gaia-profile', email: 'profile@example.com' }, automationEnabled: true },
    session: { credentials: { username: 'TEST123', password: 'Dummy123!' } } };
  let profile = { id: 'gaia-profile', email: 'profile@example.com' }, mailbox = profile.email;
  let now = 1000000, listener, signIn, context;
  let messages = [], grantedScopes = [SCOPE], authError = false;
  const calls = [], tokens = [];
  const area = name => ({
    async get(keys) { return structuredClone(Object.fromEntries((Array.isArray(keys) ? keys : [keys]).map(key => [key, data[name][key]]))); },
    async set(values) { Object.assign(data[name], structuredClone(values)); },
    async remove(key) { delete data[name][key]; }
  });
  const chrome = { storage: { local: area('local'), session: area('session') },
    runtime: { id: 'test-extension', getURL: file => 'chrome-extension://test-extension/' + file,
      getManifest: () => ({ oauth2: { client_id: '123-example.apps.googleusercontent.com' } }),
      onMessage: { addListener(fn) { listener = fn; } } },
    identity: {
      async getProfileUserInfo(options) { assert.equal(options.accountStatus, 'ANY'); return { ...profile }; },
      async getAuthToken(options) { tokens.push(options); if (authError) throw new Error('token error'); return { token: 'test-token', grantedScopes }; },
      async removeCachedAuthToken() {}, async clearAllCachedAuthTokens() {},
      onSignInChanged: { addListener(fn) { signIn = fn; } }
    }
  };
  let onBodyFetch = null;
  const fetchMock = async (url, options) => {
    calls.push(url);
    assert.equal(options.headers.Authorization, 'Bearer test-token');
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    const parsed = new URL(url);
    assert.equal(parsed.origin, 'https://gmail.googleapis.com');
    let body;
    if (parsed.pathname.endsWith('/profile')) body = { emailAddress: mailbox };
    else if (parsed.pathname.endsWith('/messages')) {
      assert.match(parsed.searchParams.get('q'), /from:erpkgp@adm\.iitkgp\.ac\.in/);
      body = { messages: messages.map(message => ({ id: message.id })) };
    } else {
      if (onBodyFetch) onBodyFetch();
      body = messages.find(message => parsed.pathname.endsWith('/' + message.id));
      assert.ok(body);
    }
    return { ok: true, json: async () => structuredClone(body) };
  };
  const globals = { chrome, URL, URLSearchParams, TextEncoder, TextDecoder, Uint8Array, atob, AbortSignal,
    crypto: webcrypto, fetch: fetchMock, Date: class extends Date { static now() { return now; } },
    importScripts(...files) { for (const file of files) vm.runInContext(source(file), context); }
  };
  function boot() { context = vm.createContext({ ...globals }); vm.runInContext(source('background.js'), context); }
  boot();
  const url = 'https://erp.iitkgp.ac.in/SSOAdministration/login.htm?sessionToken=dummy';
  const sender = { id: 'test-extension', frameId: 0, documentId: 'doc-one', url, tab: { id: 1, url } };
  const popup = { id: 'test-extension', url: chrome.runtime.getURL('popup.html') };
  const send = (message, from = sender) => new Promise(resolve => { if (listener(message, from, resolve) !== true) resolve(undefined); });
  const step = (page = {}, from = sender) => send({ type: 'AUTO_STEP', page: { ready: true, otpEditable: false, ...page } }, from);
  return { context, data, sender, popup, calls, tokens, send, step,
    restart: boot, advance: ms => { now += ms; }, setMessages: value => { messages = value; },
    setProfile: value => { profile = value; }, setMailbox: value => { mailbox = value; },
    setScopes: value => { grantedScopes = value; }, setAuthError: value => { authError = value; },
    onBody: callback => { onBodyFetch = callback; }, signIn: () => signIn({}, true) };
}

test('OTP parser accepts fresh plain/HTML/multipart codes and rejects stale, wrong-sender, ambiguous and attachment content', () => {
  const context = vm.createContext({ atob, TextDecoder, Uint8Array });
  vm.runInContext(source('otp.js'), context);
  const extract = message => context.ERPOTP.extract(message, { requestedAt: 1000000, now: 1001000, baseline: ['old'] });
  assert.equal(extract(mail()), '123456');
  assert.equal(extract(mail({ mimeType: 'text/html', body: '<p>Your OTP is <strong>123456</strong></p>' })), '123456');
  const multipart = mail(); multipart.payload = { ...multipart.payload, mimeType: 'multipart/alternative', body: {}, parts: [mail().payload, mail({ body: '<b>123456</b>', mimeType: 'text/html' }).payload] };
  assert.equal(extract(multipart), '123456');
  for (const message of [mail({ id: 'old' }), mail({ time: 800000 }), mail({ from: 'Fake <evil@example.com>' }),
    mail({ body: '123456 and 987654' }), mail({ subject: 'Receipt' }), mail({ body: '1234567' }),
    mail({ time: 2000000 })]) assert.equal(extract(message), null);
  const attached = mail(); attached.payload.filename = 'otp.txt';
  assert.equal(extract(attached), null);
});

test('profile-bound automatic flow requests once, survives worker restart, excludes old mail and delivers OTP once', async () => {
  const w = worker();
  w.setMessages([mail({ id: 'old' })]);
  assert.equal((await w.step()).action, 'requestOtp');
  assert.equal(w.tokens[0].account.id, 'gaia-profile');
  assert.equal(w.tokens[0].interactive, false);
  assert.equal(w.data.session.automationJob.phase, 'requestIssued');
  w.restart();
  assert.equal((await w.step()).action, 'waiting');
  w.advance(1000);
  w.setMessages([mail({ id: 'old' }), mail({ id: 'fresh', time: 1001000 })]);
  const result = await w.step({ otpEditable: true });
  assert.equal(result.action, 'submit'); assert.equal(result.otp, '123456');
  assert.equal(w.data.session.automationJob.phase, 'codeIssued');
  assert.ok(!JSON.stringify(w.data.session.automationJob).includes('123456'));
  assert.equal((await w.step({ otpEditable: true })).action, 'stopped');
  await w.send({ type: 'AUTO_SUBMITTED', jobId: result.jobId });
  assert.equal(w.data.session.automationJob.phase, 'submitted');
});

test('mismatched authorized mailbox is rejected before listing or reading email', async () => {
  const w = worker(); w.setMailbox('other@example.com');
  const result = await w.step();
  assert.equal(result.action, 'stopped'); assert.match(result.message, /does not match/);
  assert.equal(w.calls.filter(url => url.includes('/messages')).length, 0);
});

test('second ERP tab cannot request another code or receive the first tab OTP', async () => {
  const w = worker(); await w.step();
  const second = { ...w.sender, documentId: 'doc-two', tab: { ...w.sender.tab, id: 2 } };
  const result = await w.step({ otpEditable: true }, second);
  assert.equal(result.action, 'stopped'); assert.match(result.message, /Another ERP page/);
  assert.equal(result.otp, undefined);
});

test('disabled, locked, signed-out and changed-profile states do not access Gmail', async () => {
  for (const mutate of [
    w => { w.data.local.automationEnabled = false; },
    w => { delete w.data.session.credentials; },
    w => w.setProfile({ id: '', email: '' }),
    w => w.setProfile({ id: 'other', email: 'other@example.com' })
  ]) {
    const w = worker(); mutate(w);
    assert.equal((await w.step()).action, 'stopped');
    assert.equal(w.calls.length, 0);
  }
});

test('turning automation off or locking during Gmail fetch prevents OTP delivery', async () => {
  for (const mutate of [w => { w.data.local.automationEnabled = false; }, w => { delete w.data.session.credentials; }]) {
    const w = worker(); await w.step(); w.advance(1000);
    w.setMessages([mail({ time: 1001000 })]); w.onBody(() => mutate(w));
    const result = await w.step({ otpEditable: true });
    assert.equal(result.action, 'stopped'); assert.equal(result.otp, undefined);
    assert.equal(w.data.session.automationJob.phase, 'error');
  }
});

test('two-minute timeout, manual OTP and ERP errors stop without another request', async () => {
  const timeout = worker(); await timeout.step(); timeout.advance(120001);
  assert.match((await timeout.step({ otpEditable: true })).message, /timed out/);
  for (const page of [{ otpPresent: true }, { failed: true }]) {
    const w = worker(); await w.step();
    const result = await w.step(page);
    assert.equal(result.action, 'stopped');
    assert.equal(w.data.session.automationJob.phase, 'error');
  }
});

test('stale email never delivers a code, even if returned by Gmail search', async () => {
  const w = worker(); await w.step();
  w.setMessages([mail({ time: 800000 })]);
  assert.equal((await w.step({ otpEditable: true })).action, 'waiting');
});

test('missing Gmail scope and expired grant stop before reading mail', async () => {
  for (const mutate of [w => w.setScopes([]), w => w.setAuthError(true)]) {
    const w = worker(); mutate(w);
    const result = await w.step();
    assert.equal(result.action, 'stopped');
    assert.equal(w.calls.length, 0);
  }
});

test('mailbox authorization is available only to the extension popup, never a webpage', async () => {
  const w = worker();
  assert.equal(await w.send({ type: 'CONNECT_GMAIL' }), undefined);
  assert.equal(await w.send({ type: 'CONNECT_GMAIL' }, { ...w.popup, id: 'evil' }), undefined);
  const state = await w.send({ type: 'ACCOUNT_STATUS' }, w.popup);
  assert.equal(state.profile.email, 'profile@example.com');
  assert.equal(w.tokens.length, 0);
  const response = await w.send({ type: 'CONNECT_GMAIL' }, w.popup);
  assert.equal(response.ok, true);
  assert.equal(w.tokens[0].interactive, true);
});

test('a password change during mailbox retrieval cancels the pending OTP', async () => {
  const w = worker(); await w.step(); w.advance(1000);
  w.setMessages([mail({ time: 1001000 })]);
  w.onBody(() => { w.data.session.credentials.password = 'Changed123!'; });
  const result = await w.step({ otpEditable: true });
  assert.equal(result.action, 'stopped'); assert.match(result.message, /credentials changed/);
  assert.equal(result.otp, undefined);
});

test('simultaneous requests from two ERP pages create only one attempt', async () => {
  const w = worker();
  const second = { ...w.sender, documentId: 'doc-two', tab: { ...w.sender.tab, id: 2 } };
  const results = await Promise.all([w.step(), w.step({}, second)]);
  assert.equal(results.filter(result => result.action === 'requestOtp').length, 1);
  assert.equal(results.filter(result => result.action === 'stopped').length, 1);
});

test('live ERP regression: Gmail authored timestamp 6.89 seconds before request still delivers a NEW OTP', async () => {
  const w = worker();
  // An old message within clock tolerance must still be rejected by its snapshot ID.
  w.setMessages([mail({ id: 'old-recent', time: 990000 })]);
  await w.step();
  w.setMessages([mail({ id: 'old-recent', time: 990000 }), mail({ id: 'new-skewed', time: 993110 })]);
  const result = await w.step({ otpEditable: true });
  assert.equal(result.action, 'submit');
  assert.equal(result.otp, '123456');
  assert.equal(w.data.session.automationJob.messageId, 'new-skewed');
});
