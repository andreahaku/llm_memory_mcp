---
name: pre-response-autolearn
description: Auto-learning knowledge retrieval
trigger: pre-response
enabled: true
---

# LLM-MEMORY-AUTO-LEARNING
# Pre-Response Hook - Auto-Learning Integration

Before responding to user queries:

1. Check if there's unprocessed auto-learning queue
2. For development tasks, search for relevant captured knowledge
3. Surface auto-learned patterns and insights

Use the dev-memory-manager agent to:
- Proactively retrieve relevant auto-learned knowledge
- Suggest related patterns from past commits
- Present debugging insights from previous sessions
- Link current work to captured knowledge
