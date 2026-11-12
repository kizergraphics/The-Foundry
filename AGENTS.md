# The Foundry agent instructions

## Subagent model selection

All subagents, including reviewers, explorers, and workers, must use the same effective model as the main agent for the current task. Preserve this project's main-model choice. Prefer documented inheritance by omitting subagent model overrides; check role configuration, defaults, and explicit spawn arguments before delegation. If inheritance cannot be guaranteed, explicitly select the main agent's current model through supported controls. If a matching model is unavailable, incompatible, or cannot be verified, report the blocker and pause affected delegation; never silently substitute another model. Existing safety and acceptance checks remain in force.
