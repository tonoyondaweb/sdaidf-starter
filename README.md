# 🏗️ SDAIDF Starter Template

**Spec-Driven AI Development Framework (SDAIDF) v2.1** - A structured, autonomous framework for Snowflake data pipeline development.

## 🚀 Quick Start

```bash
# Clone and initialize
git clone <this-repository> my-project
cd my-project
./setup.sh

# Or use directly
./setup.sh my-snowflake-project
cd my-snowflake-project
```

## 📁 Structure

```
sdaidf-starter/
├── agent/                    # Specification & orchestration
│   ├── spec/               # Specification documents
│   ├── research/           # Research documents  
│   ├── plan/              # Implementation plans
│   ├── todo/              # Task lists
│   ├── templates/         # Additional templates
│   ├── logs/             # Event logs
│   └── cli/              # Agent configuration
├── src/                   # Snowflake code
│   ├── raw/              # Landing zone
│   ├── transformation/    # Cleaned data
│   └── consumption/      # Business objects
└── tests/                # Test suites
```

## 🔄 Workflow

```
Pitch → Spec(Approved) → Research(Approved) → Plan(Approved) → Todo → Implementation
```

## 🤖 Agent Integration

Designed for AI agents like:
- **Snowflake Cortex Code CLI** (Claude Opus 4.5)
- **Claude Code**
- **Qwen Code**

See `agent/agent-orchestrator.md` for execution flow.

## 🛠️ Getting Started

1. Edit `agent/pitch.md` with project details
2. Configure `agent/cli/config.yaml` with Snowflake connection
3. Run AI agent with orchestrator instructions
4. Approve documents as they reach REVIEW status

## 📚 Documentation

- **Orchestrator**: `agent/agent-orchestrator.md`
- **Templates**: Each template includes instructions
- **Framework**: See template headers for usage

---

**Ready to start?** Run `./setup.sh` and begin! 🚀
