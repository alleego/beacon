# Beacon

A desktop client for Claude on Google Vertex AI, with multiple chats, projects,
and optional modules.

Version 0.4.0 adds Notes, configurable Enter behavior, an optional quick start,
local usage reporting, and setup guidance for optional local modules.

## Install

Download the installer from [Releases](https://github.com/alleego/beacon/releases).
Mac builds target Intel Macs (x64). Linux RPM builds target RHEL 9 desktops on
Intel/AMD processors (x86_64); native RHEL runtime validation is pending.

1. Open the Beacon `.dmg`.
2. Drag Beacon into Applications.
3. Open Beacon and follow the setup prompts.

The current build is unsigned and has not been notarized by Apple. First launch
may require approval in macOS security settings.

On RHEL 9, install the downloaded RPM with:

```sh
sudo dnf install ./Beacon-0.4.0-linux-x86_64.rpm
```

Use a graphical desktop session with an available, unlocked keyring. Beacon
requires secure OS credential storage and does not fall back to plaintext.
Do not run the application as root or disable its sandbox.

## Upgrading

Quit Beacon before replacing the application or updating its RPM. On the same
computer and OS account, Beacon reuses its existing profile, chats, settings,
credentials and imported modules. Do not delete the profile during an upgrade.
OS permission prompts may reappear. Browser sessions and VPN sign-in are managed
separately. Moving to a different computer is not an automatic data migration.

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
of your configured SSH account. Local workers run with your OS account's access;
they are not sandboxed. Local modules may require a particular operating system
and show their own setup checklist. No module is installed or enabled automatically.

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
