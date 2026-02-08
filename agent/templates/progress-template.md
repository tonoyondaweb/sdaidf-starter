> `progress.md` Template
# PROGRESS CHECKPOINT

## Session Context
| Field | Value |
|-------|-------|
| **Session ID** | `[SESSION_YYYYMMDD_HHMM]` |
| **Agent Name** | `[AGENT_NAME]` |
| **Start Time** | `YYYY-MM-DD HH:MM UTC` |
| **Context Usage** | `[X]%` |
| **Current Phase** | `[PHASE]` |
| **Parent Document** | `[DOCUMENT_TYPE]_v[VERSION].md` |

---

## Work Completed in This Session

### Actions Performed
1. **[TIMESTAMP]** `[ACTION_1]` - Status: `[SUCCESS/FAILED]`
2. **[TIMESTAMP]** `[ACTION_2]` - Status: `[SUCCESS/FAILED]`

### Files Created/Modified
| File Path | Action | Status | Notes |
|-----------|--------|--------|-------|
| `[PATH]` | `CREATE` | `SUCCESS` | `[NOTES]` |
| `[PATH]` | `MODIFY` | `SUCCESS` | `[NOTES]` |

### Snowflake Objects Created
```text
-- Objects created this session
[OBJECT_TYPE] [OBJECT_NAME] -- Status: [CREATED/UPDATED/DROPPED]
```

---

## Current State

### Active Document Versions
| Document | Version | Status |
|----------|---------|--------|
| Specification | `spec_v[X.Y.Z].md` | `[APPROVED/DRAFT]` |
| Research | `research_v[X.Y.Z].md` | `[APPROVED/DRAFT]` |
| Plan | `plan_v[X.Y.Z].md` | `[APPROVED/DRAFT]` |
| Todo | `todo_v[X.Y.Z].md` | `[ACTIVE/COMPLETE]` |

### Directory Structure Status
```text
[Current directory tree snapshot]
project-root/
├── src/raw/ → [OBJECT_COUNT] objects
├── src/transformation/ → [OBJECT_COUNT] objects
└── src/consumption/ → [OBJECT_COUNT] objects
```

### Next Todo Items
1. [ ] `[TODO_ITEM_1]` - Priority: `HIGH`
2. [ ] `[TODO_ITEM_2]` - Priority: `MEDIUM`
3. [ ] `[TODO_ITEM_3]` - Priority: `LOW`

---

## Session Summary

### Key Decisions Made
- `[DECISION_1]`
- `[DECISION_2]`

### Issues Encountered
- `[ISSUE_1]` → Resolution: `[RESOLUTION_OR_PENDING]`
- `[ISSUE_2]` → Resolution: `[RESOLUTION_OR_PENDING]`

### Context for Next Session
```
[Brief summary of where to resume. Include:
- Current todo item index
- Any special considerations
- Pending approvals
- Known issues to address]
```

---

## Performance Metrics
| Metric | Value | Threshold |
|--------|-------|-----------|
| Session Duration | `[X] minutes` | `< 30 min` |
| Context Usage | `[Y]%` | `< 40%` |
| Files Processed | `[Z]` | `N/A` |
| Success Rate | `[A]%` | `> 90%` |

---

**Note:** This file should be deleted after successful session resumption to avoid stale state.
