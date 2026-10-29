const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
function page() {
  class Input {
    constructor(id) { Object.assign(this, { id, name: id, type: 'password', labels: [], readOnly: false, value: '', events: [] }); }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getClientRects() { return [1]; }
    getAttribute() { return null; }
    dispatchEvent(event) { this.events.push(event.type); }
  }
  let listener, tick, locked = false, takeover = false, lockBeforeSubmit = false;
  const calls = { otp: 0, login: 0, steps: 0, cancel: 0, submitted: 0 };
  const credentials = { username: 'TEST123', password: 'Dummy123!', securityQuestions: [{ question: 'Favorite food?', answer: 'Pizza' }] };
  const nodes = { loginForm: {}, user_id: new Input('user_id'), password: new Input('password'), answer: new Input('answer'),
    email_otp1: new Input('email_otp1'), question: { textContent: 'Favorite food?' }, 'kgp-login-status': { textContent: '' },
    getotp: { disabled: false, click() { calls.otp++; nodes.email_otp1.readOnly = false; this.disabled = true; } },
    loginFormSubmitButton: { disabled: false, click() { calls.login++; } } };
  for (const id of ['user_id', 'password', 'answer', 'email_otp1', 'getotp', 'loginFormSubmitButton']) nodes[id].form = nodes.loginForm;
  for (const [id, value] of [['user_id', credentials.username], ['password', credentials.password], ['answer', 'Pizza']]) nodes[id].value = value;
  nodes.email_otp1.readOnly = true;
  const events = {};
  const document = { hidden: false, getElementById: id => nodes[id], querySelector: () => null,
    querySelectorAll: () => ['user_id', 'password', 'answer', 'email_otp1'].map(id => nodes[id]),
    addEventListener(type, fn) { events[type] = fn; } };
  for (const id of ['user_id', 'password', 'answer', 'email_otp1']) nodes[id].ownerDocument = document;
  const context = vm.createContext({ document, HTMLInputElement: Input, Event,
    setInterval(fn) { tick = fn; }, chrome: { runtime: { id: 'test',
      onMessage: { addListener(fn) { listener = fn; } },
      async sendMessage(message) {
        if (message.type === 'GET_LOGIN') return locked ? { error: 'locked' } : { credentials, autoEnabled: true };
        if (message.type === 'CANCEL_AUTOMATION') { calls.cancel++; return {}; }
        if (message.type === 'AUTO_SUBMITTED') { calls.submitted++; return {}; }
        if (message.type === 'AUTO_STEP') {
          calls.steps++;
          if (calls.steps === 1) return { action: 'requestOtp', jobId: 'attempt', message: 'Requesting OTP' };
          if (takeover) events.input({ isTrusted: true, target: nodes.email_otp1 });
          if (lockBeforeSubmit) locked = true;
          return { action: 'submit', jobId: 'attempt', otp: '654321', message: 'Submitting' };
        }
        throw new Error('Unexpected message');
      }
    } }
  });
  for (const file of ['form-helper.js', 'auto-content.js', 'content.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { nodes, calls, hide: () => { document.hidden = true; }, settle, tick: async () => { tick(); await settle(); }, takeover: () => { takeover = true; }, lockBeforeSubmit: () => { lockBeforeSubmit = true; } };
}

test('page requests OTP once, enters retrieved code, and submits login exactly once', async () => {
  const p = page(); await p.settle(); // credential blur / question load phase
  await p.tick();
  assert.equal(p.calls.otp, 1);
  assert.equal(p.calls.login, 0);
  await p.tick();
  assert.equal(p.nodes.email_otp1.value, '654321');
  assert.equal(p.calls.login, 1);
  assert.deepEqual(p.nodes.email_otp1.events, ['input', 'change']);
  assert.equal(p.calls.submitted, 1);
  await p.tick(); await p.tick();
  assert.equal(p.calls.otp, 1); assert.equal(p.calls.login, 1);
});

test('manual takeover while waiting prevents code entry and submission', async () => {
  const p = page(); await p.settle(); await p.tick(); p.takeover(); await p.tick();
  assert.equal(p.calls.cancel, 1); assert.equal(p.calls.login, 0);
  assert.equal(p.nodes.email_otp1.value, '');
});

test('lock between OTP delivery and page action prevents submission', async () => {
  const p = page(); await p.settle(); await p.tick(); p.lockBeforeSubmit(); await p.tick();
  assert.equal(p.calls.cancel, 1); assert.equal(p.calls.login, 0);
  assert.equal(p.nodes.email_otp1.value, '');
});


test('an OTP attempt keeps polling after switching to a background tab', async () => {
  const p = page(); await p.settle(); await p.tick();
  assert.equal(p.calls.otp, 1);
  p.hide();
  await p.tick();
  assert.equal(p.calls.login, 1);
});
