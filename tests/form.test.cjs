const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const context = vm.createContext({});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../form-helper.js'), 'utf8'), context);
const helper = context.ERPForm;
function input(id, type, placeholder = '') {
  return { id, type, name: id, placeholder, value: '', labels: [], form: null,
    getClientRects: () => [1], getAttribute: () => null };
}
function documentFor(inputs) { return { querySelectorAll: () => inputs }; }
test('masked user ID, password, security answer, and OTP are distinguished', () => {
  const user = input('userId', 'password');
  const password = input('password', 'password');
  const answer = input('answer', 'password', 'Answer to Security Question');
  const otp = input('otp', 'password', 'Enter OTP');
  const form = documentFor([user, password, answer, otp]);
  const fields = helper.fields(form);
  assert.equal(fields.username, user);
  assert.equal(fields.password, password);
  assert.equal(fields.answer, answer);
  user.type = password.type = answer.type = otp.type = 'text';
  assert.equal(helper.fields(form).password, password);
});
test('new-password autocomplete must not disqualify the user-ID field', () => {
  const user = input('user_id', 'password');
  user.autocomplete = 'new-password';
  const fields = helper.fields(documentFor([user, input('password', 'password')]));
  assert.equal(fields.username, user);
});
test('ambiguous username fields fail safely', () => {
  assert.equal(helper.fields(documentFor([input('userId', 'password'), input('loginId', 'text'), input('password', 'password')])), null);
});
test('dynamic question matches only one stored answer and preserves answer case', () => {
  const answer = input('answer', 'password', 'Answer to Security Question');
  let question = 'Favorite food?';
  answer.parentElement = { tagName: 'DIV', parentElement: null,
    querySelectorAll: () => [{ textContent: question }] };
  const pairs = [{ question: 'favorite food', answer: 'Pizza' }, { question: 'First School?', answer: 'ABC School' }, { question: 'Birth place?', answer: 'Kolkata' }];
  assert.equal(helper.matchAnswer(answer, pairs), 'Pizza');
  question = 'FIRST SCHOOL :';
  assert.equal(helper.matchAnswer(answer, pairs), 'ABC School');
  question = 'Unknown question';
  assert.equal(helper.matchAnswer(answer, pairs), null);
  question = 'Favorite food?';
  assert.equal(helper.matchAnswer(answer, [...pairs, { question: 'favorite food', answer: 'Another answer' }]), null);
});
