#!/bin/bash

# SDAIDF Starter Setup Script
# Usage: ./setup.sh <project-name>

set -e

PROJECT_NAME=${1:-"my-snowflake-project"}

echo "🚀 Setting up SDAIDF Project: $PROJECT_NAME"
echo "=========================================="

# Create project directory
mkdir -p "$PROJECT_NAME"
cd "$PROJECT_NAME"

# Create directory structure
mkdir -p src/{raw,transformation,consumption}/{tables,views,tasks,procedures}
mkdir -p tests/{unit/{raw,transformation,consumption},integration,validation}
mkdir -p agent/{spec,research,plan,todo,templates,logs,cli}

# Create README files in empty directories
find . -type d -empty -exec touch {}/README.md \;

# Create agent/README.md
cat > agent/README.md << 'END'
# Agent Directory

This directory contains all specification, research, plan, and todo documents.

## Structure
- `spec/`: Specification documents and template
- `research/`: Research documents and template  
- `plan/`: Implementation plans and template
- `todo/`: Task lists and template
- `templates/`: Additional templates
- `logs/`: Event and audit logs
- `cli/`: Agent CLI configuration

## Workflow
1. Start with `pitch.md` in this directory
2. Run agent (follows agent-orchestrator.md)
3. Approve documents as they reach REVIEW status
4. Agent progresses through phases automatically
END

# Create pitch template
cat > agent/pitch.md << 'END'
# Project Pitch Template

## Project Name
[Your Project Name]

## Business Context
[What problem are we solving? Why does it matter?]

## Goals
- [Goal 1]
- [Goal 2]

## Success Metrics
- [Metric 1: Target value]
- [Metric 2: Target value]

## Constraints
- Timeline: [Deadline]
- Budget: [Credits/Resources]
- Team: [Who's involved]

## Initial Thoughts
[Any initial technical considerations or approaches]
END

# Create empty logs
echo "# EVENT LOG" > agent/logs/event-log.md
echo "## Project: $PROJECT_NAME" >> agent/logs/event-log.md
echo "**Log Started:** $(date -u +'%Y-%m-%d %H:%M UTC')" >> agent/logs/event-log.md

echo "# PROGRESS CHECKPOINT" > agent/progress.md
echo "No progress yet." >> agent/progress.md

echo "# CENTRAL CHANGELOG" > agent/CHANGELOG.md
echo "## Project: $PROJECT_NAME" >> agent/CHANGELOG.md
echo "**Initialized:** $(date -u +'%Y-%m-%d %H:%M UTC')" >> agent/CHANGELOG.md

# Create minimal config
cat > agent/cli/config.yaml << 'END'
# SDAIDF Agent Configuration
agent:
  name: "claude-opus"
  context_limit_percentage: 40

project:
  name: "$PROJECT_NAME"
  default_structure: "snowflake"
  
snowflake:
  account: "[YOUR_ACCOUNT]"
  warehouse: "[YOUR_WAREHOUSE]"
  role: "[YOUR_ROLE]"
END

# Make setup executable
chmod +x setup.sh

echo ""
echo "✅ Setup complete!"
echo ""
echo "Next steps:"
echo "1. cd $PROJECT_NAME"
echo "2. Edit agent/pitch.md with your project details"
echo "3. Configure agent/cli/config.yaml with Snowflake details"
echo "4. Start development with your AI agent!"
echo ""
echo "Happy building! 🚀"
