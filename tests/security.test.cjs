const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const { webcrypto } = require('node:crypto');
const path = require('node:path');
const source = name => fs.readFileSync(path.join(__dirname, '..', name), 'utf8');

test('vault roundtrip, unique encryption, wrong passphrase, and tampering', async () => {
  const context = vm.createContext({ crypto: webcrypto, TextEncoder, TextDecoder, Uint8Array, btoa, atob });
  vm.runInContext(source('vault.js'), context);
  const credentials = { username: 'TEST123', password: 'dummy-password-🔐' };
  const passphrase = 'a separate vault passphrase';
  const a = await context.ERPVault.encrypt(credentials, passphrase);
  const b = await context.ERPVault.encrypt(credentials, passphrase);
  assert.notEqual(a.salt, b.salt);
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(JSON.stringify(await context.ERPVault.decrypt(a, passphrase)), JSON.stringify(credentials));
  assert.ok(!JSON.stringify(a).includes(credentials.password));
  await assert.rejects(context.ERPVault.decrypt(a, 'incorrect passphrase'));
  const bytes = Buffer.from(a.ciphertext, 'base64');
  bytes[0] ^= 1;
  await assert.rejects(context.ERPVault.decrypt({ ...a, ciphertext: bytes.toString('base64') }, passphrase));
});

test('service worker releases credentials only to the top-level ERP login', async () => {
  let listener;
  let reads = 0;
  const context = vm.createContext({ URL, importScripts() {}, chrome: {
    identity: { onSignInChanged: { addListener() {} } },
    runtime: { id: 'test-extension', getURL: path => 'chrome-extension://test-extension/' + path, onMessage: { addListener(fn) { listener = fn; } } },
    storage: { local: { async get() { return {}; } }, session: { async get() { reads++; return { credentials: { username: 'test', password: 'dummy' } }; } } }
  } });
  vm.runInContext(source('background.js'), context);
  const url = 'https://erp.iitkgp.ac.in/SSOAdministration/login.htm?requestedUrl=example';
  const sender = { id: 'test-extension', frameId: 0, url, tab: { url } };
  for (const invalid of [
    { ...sender, id: 'another-extension' },
    { ...sender, frameId: 1 },
    { ...sender, url: 'https://evil.example/SSOAdministration/login.htm' },
    { ...sender, url: 'http://erp.iitkgp.ac.in/SSOAdministration/login.htm' },
    { ...sender, tab: { url: 'https://evil.example/' } },
    { ...sender, url: 'https://erp.iitkgp.ac.in/SSOAdministration/forgot.htm' }
  ]) assert.equal(listener({ type: 'GET_LOGIN' }, invalid, () => assert.fail('must not respond')), undefined);
  assert.equal(reads, 0);
  const response = await new Promise(resolve => assert.equal(listener({ type: 'GET_LOGIN' }, sender, resolve), true));
  assert.equal(response.credentials.username, 'test');
  assert.equal(reads, 1);
});

test('manifest limits automatic access to ERP login', () => {
  const manifest = JSON.parse(source('manifest.json'));
  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions, ['storage', 'activeTab', 'identity', 'identity.email']);
  assert.deepEqual(manifest.content_scripts[0].matches, ['https://erp.iitkgp.ac.in/SSOAdministration/login.htm*']);
  assert.deepEqual(manifest.host_permissions, ['https://gmail.googleapis.com/*']);
});
