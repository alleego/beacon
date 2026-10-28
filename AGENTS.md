# Beacon development

Preserve ordinary multi-chat behavior and the original installation's data.
Keep the generic application free of organization-specific modules, endpoints,
instructions, credentials, personal paths and customer evidence.

Modules live outside this source tree. Package only the explicit build inputs.
Do not publish or create a remote repository without the user's instruction.

Keep credentials and investigation data OS-encrypted in the main process.
Renderer networking remains denied. Provider network access is narrowly pinned.
Module workers require explicit trust at import and an independently configured
SSH identity; model output must never become arbitrary shell commands.

Respect the user's preference for proportionate, hidden checks. Run focused unit
checks for changed behavior and the chat check for conversation/persistence
changes. Use synthetic model replies; never spend real tokens for automated
tests. Do not open test windows on the user's desktop.

Keep macOS and Windows paths portable. Preserve source timestamps and sampling
limits in evidence, and never present a historical snapshot as live status.
