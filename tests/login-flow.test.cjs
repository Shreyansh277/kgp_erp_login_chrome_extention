const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Form IDs, attributes, and event dependencies transcribed from the live ERP
// source inspected through Chrome on 2026-10-25. No real credentials or tokens.
function fixture({ prefilled = false } = {}) {
  class Input {
    constructor(id, autocomplete) {
      Object.assign(this, { id, name: id, autocomplete, type: 'password', readOnly: false, disabled: false, labels: [], events: [] });
      this.value = '';
    }
    get value() { return this._value; }
    set value(value) { this._value = value; }
    getClientRects() { return [1]; }
    getAttribute() { return null; }
    dispatchEvent(event) {
      this.events.push(event.type);
      if (this.id === 'user_id' && event.type === 'blur') lookups++;
      if (this.id === 'answer' && event.type === 'input') nodes.getotp.disabled = !this.value.trim();
    }
  }
  let lookups = 0, listener, tick;
  const nodes = {
    loginForm: {}, user_id: new Input('user_id', 'new-password'),
    password: new Input('password', 'password'), answer: new Input('answer', 'answer'),
    email_otp1: new Input('email_otp1', 'email_otp'),
    question: { textContent: 'Security Question' }, getotp: { disabled: true },
    sessionToken: { value: 'dummy-token' }, requestedUrl: { value: 'dummy-destination' }
  };
  nodes.answer.readOnly = nodes.email_otp1.readOnly = true;
  const inputs = [nodes.user_id, nodes.password, nodes.answer, nodes.email_otp1];
  const document = { hidden: false, getElementById: id => nodes[id], querySelectorAll: () => inputs };
  for (const input of inputs) { input.form = nodes.loginForm; input.ownerDocument = document; }
  const credentials = { username: 'TEST123', password: 'Dummy123!', securityQuestions: [
    { question: 'favorite food?', answer: 'Pizza' }, { question: 'First school?', answer: 'ABC School' }, { question: 'Birth place?', answer: 'Kolkata' }
  ] };
  if (prefilled) { nodes.user_id.value = credentials.username; nodes.password.value = credentials.password; }
  let locked = false;
  const context = vm.createContext({ document, HTMLInputElement: Input, Event,
    setInterval(fn) { tick = fn; }, chrome: { runtime: {
      id: 'test', async sendMessage() { return locked ? { error: 'locked' } : { credentials }; },
      onMessage: { addListener(fn) { listener = fn; } }
    } } });
  for (const file of ['form-helper.js', 'content.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'), context);
  const settle = () => new Promise(resolve => setImmediate(resolve));
  return { nodes, settle, tick: async () => { tick(); await settle(); },
    lookupCount: () => lookups, lock: () => { locked = true; },
    manual: () => new Promise(resolve => listener({ type: 'FILL_LOGIN' }, { id: 'test' }, resolve)) };
}

test('actual ERP attributes: blur loads question; input enables OTP; OTP and session tokens stay untouched', async () => {
  const page = fixture();
  await page.settle();
  assert.equal(page.nodes.user_id.value, 'TEST123');
  assert.equal(page.nodes.password.value, 'Dummy123!');
  assert.equal(page.lookupCount(), 1);
  assert.equal(page.nodes.answer.value, '');
  assert.equal(page.nodes.getotp.disabled, true);
  // Emulate ERP getSecurityQues.htm response and readonly transition.
  page.nodes.question.textContent = 'Favorite food';
  page.nodes.answer.readOnly = false;
  await page.tick();
  assert.equal(page.nodes.answer.value, 'Pizza');
  assert.equal(page.nodes.getotp.disabled, false);
  await page.tick();
  assert.equal(page.lookupCount(), 1);
  assert.equal(page.nodes.answer.events.filter(event => event === 'input').length, 1);
  assert.equal(page.nodes.email_otp1.value, '');
  assert.deepEqual(page.nodes.email_otp1.events, []);
  assert.equal(page.nodes.sessionToken.value, 'dummy-token');
  assert.equal(page.nodes.requestedUrl.value, 'dummy-destination');
});

test('already filled credentials still trigger one question lookup', async () => {
  const page = fixture({ prefilled: true });
  await page.settle();
  assert.equal(page.lookupCount(), 1);
  await page.tick();
  assert.equal(page.lookupCount(), 1);
});

test('question changes update own answers; user edits and locked vault are respected', async () => {
  const page = fixture();
  await page.settle();
  page.nodes.answer.readOnly = false;
  page.nodes.question.textContent = 'Favorite food?';
  await page.tick();
  page.nodes.question.textContent = 'First School?';
  await page.tick();
  assert.equal(page.nodes.answer.value, 'ABC School');
  page.nodes.answer.value = 'my manual answer';
  page.nodes.question.textContent = 'Birth place?';
  await page.tick();
  assert.equal(page.nodes.answer.value, 'my manual answer');
  page.lock();
  const response = await page.manual();
  assert.match(response.message, /unlock/);
  assert.equal(page.nodes.answer.value, 'my manual answer');
});
