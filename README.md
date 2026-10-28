# Beacon

A desktop client for Claude on Google Vertex AI, with multiple chats, projects,
and optional modules.

## Install

The packaged application targets Intel Macs (x64).

1. Open the Beacon `.dmg`.
2. Drag Beacon into Applications.
3. Open Beacon and follow the setup prompts.

The current build is unsigned and has not been notarized by Apple. First launch
may require approval in macOS security settings.

## Connect

Import your Google service-account JSON in Settings → Connection. The account
must have access to the configured Claude model on Vertex AI. Credentials and
chat history are stored locally using operating-system encryption. Prompts and
selected context are sent to Vertex AI when you use the model.

## Modules

Use Settings → Modules to import a `.beacon-module` file. Encrypted modules
require a password supplied separately by their author. Review the module's
permissions before enabling it.

Modules can add tools and coordinated investigation chats. They are distributed
separately; no modules, credentials or connection profiles are bundled with Beacon.
Only import modules from authors you trust. Remote workers run with the access
of your configured SSH account.

## Development

Requires Node.js 24 or later.

```sh
npm ci
npm run build
npm start
```

Build the Intel Mac installer on macOS:

```sh
npm run package:mac
```

Run unit checks with `npm test`.
