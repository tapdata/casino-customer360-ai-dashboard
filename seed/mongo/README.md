# Optional Mongo seed

The local Mongo service is used for AI-panel persistence (`ai_action_events`,
demo upgrade journeys, and an optional snapshot fallback). MDM collections are
normally populated by TapData APIs, not by a second hidden fixture.

If a demo needs an offline fallback, add small synthetic JSON fixtures here and
load them through a reviewed seed command. Never place production customer data
or credentials in this directory.

