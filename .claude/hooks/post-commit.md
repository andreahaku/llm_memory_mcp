---
name: post-commit-autolearn
description: Auto-learning commit capture
trigger: post-commit
enabled: true
---

# LLM-MEMORY-AUTO-LEARNING
# Post-Commit Hook - Auto-Learning Integration

When user makes a git commit during the session:

1. Check if commit message contains #kb tag
2. If yes, notify user that knowledge will be captured
3. Suggest processing the queue or continue working

Use the dev-memory-manager agent to:
- Recognize commit moments
- Suggest adding #kb tag for important commits
- Process captured commits immediately if user wants
- Explain auto-learning workflow
