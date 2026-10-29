#!/usr/bin/env python3
"""Set a public Chrome Extension OAuth client ID. No client secret is needed."""
import json
from pathlib import Path
import re
import sys

if len(sys.argv) != 2 or not re.fullmatch(r'[0-9]+-[a-zA-Z0-9_-]+\.apps\.googleusercontent\.com', sys.argv[1]):
    sys.exit('Usage: python3 configure-oauth.py YOUR_CHROME_EXTENSION_CLIENT_ID.apps.googleusercontent.com')
manifest_path = Path(__file__).resolve().parent / 'manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['oauth2'] = {'client_id': sys.argv[1], 'scopes': ['https://www.googleapis.com/auth/gmail.readonly']}
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
print('OAuth client configured. Reload the extension and ERP tab, then connect profile Gmail from the popup.')
