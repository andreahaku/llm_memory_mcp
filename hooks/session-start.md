---
name: session-start-autolearn
description: Auto-learning session initialization
trigger: session-start
enabled: true
---

# LLM-MEMORY-AUTO-LEARNING
# Session Start Hook - Auto-Learning Integration

When starting a new session, automatically:

1. Check if auto-learning system is active
2. Process any queued auto-learning events from git commits
3. Surface recently captured knowledge

Use the dev-memory-manager agent to:
- Process the auto-learning queue
- Present captured knowledge from recent commits
- Check hook installation status
- Install hooks if not present
