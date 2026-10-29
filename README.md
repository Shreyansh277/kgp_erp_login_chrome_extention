# KGP ERP Login Helper · v1.3.1

A dependency-free Chrome Manifest V3 extension for IIT Kharagpur ERP. It saves your credentials and three security-question answers in an encrypted local vault. It supports manual OTP login and optional automatic OTP retrieval/login using the **primary Google account signed into this Chrome profile**.

## Update / install

1. Open `chrome://extensions`, enable **Developer mode**, and choose **Load unpacked** → this `kgp_login` folder. If already installed, click **Reload** instead. Chrome may ask you to approve the added identity/Gmail host permissions.
2. Reload the ERP login tab as well; its old content scripts must be replaced.
3. Open the extension. Confirm **v1.3.1**, then unlock your existing vault. Existing credentials and security answers remain compatible.
4. For first-time setup, enter your ERP ID, password, all three exact security questions/answers, and a separate vault passphrase of at least 12 characters. Save & unlock.

Automatic OTP is **off by default**. Without OAuth configuration, the existing manual OTP flow continues to work.

## Manual OTP

Open https://erp.iitkgp.ac.in/ and proceed to login. The extension autofills credentials, triggers ERP's security-question lookup, then fills the matching answer. Click **Get OTP**, enter the code, and click **Log In** yourself. On an already open page, use **Fill ERP form** if needed.

## Automatic OTP & login

Google requires a one-time OAuth application setup. Installing an extension does **not** automatically authorize email access. Open **Automatic OTP setup** in the extension for a guide that displays your extension ID and the required Chrome-profile email.

1. Enable **Gmail API** in your Google Cloud project.
2. Configure your Google Auth Platform consent/audience and add your own Google account as a test user for a personal test app. Add `https://www.googleapis.com/auth/gmail.readonly` under Data Access.
3. Create an OAuth client of type **Chrome Extension**, using this extension's ID as its **Item ID**. Do not use a Web or Desktop client.
4. Configure its public client ID from this folder:

   ```sh
   python3 configure-oauth.py YOUR_CLIENT_ID.apps.googleusercontent.com
   ```

   No email password, app password, or OAuth client secret is needed. The script adds the `oauth2` section to `manifest.json`. Keep the folder in the same location so the unpacked extension ID remains the same. If publishing or moving to other machines, configure a stable manifest public key and matching OAuth client first.

5. Reload the extension and ERP tab; unlock the vault.
6. Click **Connect this profile's Gmail** and authorize read-only Gmail access. Both displayed email addresses must match. The extension verifies the actual Gmail API mailbox against the Chrome primary profile, rather than using whichever Gmail tab happens to be open.
7. Turn on **Automatically request OTP & log in**, then open/reload ERP. Once the OTP request starts, polling continues even if you switch tabs.

ERP must already deliver OTP to that same Gmail/Google Workspace mailbox. The extension does not change your ERP email or forward OTPs from other accounts. Signed-out Chrome profiles and non-Google mailboxes use manual OTP.

Once enabled and the vault is unlocked, the extension fills credentials/security answer, requests one OTP, waits for ERP's successful request to unlock its OTP input, queries recent ERP OTP emails, fills a fresh six-digit code, and clicks Log In once. Google authorization happens only from the Connect button; background polls never open Google sign-in prompts.

## Stop, errors, and retries

- Use **Stop automatic login** on the ERP page, turn the setting off, lock the vault, or disconnect Gmail to stop automation. Typing your own OTP or manually clicking Get OTP / Log In also takes over.
- One ERP page owns an OTP attempt at a time, across tabs and worker restarts. A competing page stops and asks you to finish on the original page or wait two minutes and reload.
- A two-minute timeout, unknown question, missing Gmail grant, mismatched account, ambiguous code, or ERP error leaves manual OTP available. The extension never repeatedly resends OTP or repeatedly submits login. After a failed attempt, reload ERP deliberately to retry.
- Google sign-in changes disable automatic login and clear the mailbox connection. Reconnect before enabling it again.
- If ERP reports incorrect credentials/security answers, correct them under **Edit credentials & questions**, save, then reload ERP.
- An external Google OAuth app in testing may require periodic reconnection. Workspace administrators can block Gmail API grants; check policy if authorization is denied.

## Vault and privacy

- AES-256-GCM encryption with random salt/IV and a PBKDF2-SHA-256 key derived using 600,000 iterations. Only the encrypted vault is saved in extension local storage. Unlocked credentials are in `chrome.storage.session`, restricted to trusted extension contexts by Chrome's default access policy.
- Unlock once per browser session. Chrome restart, extension reload/update/disable, or **Lock vault** clears the unlocked copy. This does not clear credentials already filled into a webpage or log out ERP.
- All three question/answer pairs are encrypted with the credentials. Questions match ignoring capitalization/punctuation; answers preserve exact case.
- **Forget saved credentials** removes the vault and unlocked credentials; it does not change your ERP password. A forgotten vault passphrase cannot be recovered. Gmail can be disconnected separately.
- Gmail's read-only OAuth scope permits reading mailbox contents; there is no ERP-only Gmail OAuth scope. This implementation restricts its searches to recent OTP messages from `erpkgp@adm.iitkgp.ac.in`, reads matching bodies locally, and gives the ERP content script only the extracted code. It never sends mail, deletes messages, marks mail read, or persists email bodies. Gmail permissions for a publicly distributed app may require Google's restricted-scope verification.
- Chrome Identity manages OAuth tokens; the extension does not save them in its own storage or expose them to content scripts. Connection email/account ID, the enabled setting, and the public OAuth client ID are not encryption secrets. Attempt metadata/message IDs are kept in session storage; OTP codes are not persisted there.
- Old message IDs present before requesting OTP are excluded. Sender, subject, bounded message time, and unique six-digit code are checked. ERP message timestamps allow two minutes of clock skew; pre-request message IDs exclude existing OTP emails. Attachments are ignored; multiple plausible codes/messages stop automation.
- The content script runs only on the HTTPS ERP login pathname. The worker validates extension ID, top frame, page URL, and tab URL. Authorization/connection commands are accepted only from this extension's popup. OTP attempts are bound to the originating tab, document, Chrome account, and a fingerprint of the unlocked ERP credentials.
- No backend, telemetry, sync, remote scripts, or external dependencies. Google receives authorized Gmail API calls; ERP receives your login credentials and OTP through its normal form. Credentials necessarily become readable by the ERP page when filled, as with normal typing.

Permissions: `storage` for vault/settings/session, `activeTab` for the popup's current ERP tab, `identity` for OAuth, `identity.email` for Chrome primary profile matching, and `https://gmail.googleapis.com/*` for Gmail API requests. There is no Gmail-page content script and no access to every website.

## Inspected ERP behavior

The live login HTML/JavaScript was inspected through Chrome's View Source on 2026-10-25. The extension uses `#loginForm`, `#user_id`, `#password`, `#question`, `#answer`, `#getotp`, `#email_otp1`, and `#loginFormSubmitButton`.

- The user ID is masked (`type=password`) and has `autocomplete=new-password`; field role is identified by its actual ID.
- ERP's direct jQuery `#user_id` blur handler posts to `getSecurityQues.htm`, writes the response into `#question`, and makes `#answer` editable.
- An input event on a nonempty answer enables Get OTP.
- Get OTP calls ERP's own `getEmailOTP('SI')`; a successful response unlocks the OTP field and starts a resend cooldown. The extension clicks this existing control once and does not bypass ERP's readonly/disabled state.
- The existing Log In button submits the existing form to `auth.htm`. Hidden sessionToken/requestedUrl inputs are not modified or hard-coded; any login query string is supported.

Manual credential/question autofill was confirmed working by the user. The connected profile mailbox and OTP retrieval were inspected live, and the corrected parser accepted the actual ERP email that the previous filter rejected. **A full login with v1.3.1 still needs extension reload, vault unlock, and a fresh ERP attempt.** If your ERP sender or OTP format differs, automatic retrieval will stop rather than guess.

## Validation

```sh
node --test tests/*.test.cjs
for file in *.js; do node --check "$file"; done
```

Tests cover vault roundtrip/tamper resistance, the inspected ERP form states, profile/mailbox mismatch, origin restrictions, old email rejection, one-time code delivery, service-worker restart, concurrent tabs, timeout, credential changes, locking/off during retrieval, and page-side manual takeover/one-time submission. Gmail and page interactions in tests are simulated; they are not a claim of live-account validation.

Official setup references: [Chrome OAuth](https://developer.chrome.com/docs/extensions/how-to/integrate/oauth), [Chrome Identity](https://developer.chrome.com/docs/extensions/reference/api/identity), [Gmail scopes](https://developers.google.com/workspace/gmail/api/auth/scopes).

## v1.3.1 fix

A live Gmail/ERP inspection found the new OTP message’s Gmail `internalDate` 6,890 ms earlier than the browser’s request time, despite actual email delivery occurring after the request. The previous three-second freshness window excluded that valid OTP. Both the Gmail search and parser now allow two minutes of clock skew, retaining the pre-request snapshot to reject already existing messages. Regression tests cover this exact offset and background-tab polling. OAuth client configuration and vault format are unchanged.
