> `event-log.md` Template
# EVENT LOG

## Metadata
| Field | Value |
|-------|-------|
| **Project ID** | `[PROJECT-YYYY-MM-XXX]` |
| **Log Start Date** | `YYYY-MM-DD HH:MM UTC` |
| **Last Updated** | `YYYY-MM-DD HH:MM UTC` |
| **Total Entries** | `[COUNT]` |

---

## Log Format
Each entry follows this structure:
```text
**Time:** [YYYY-MM-DD HH:MM UTC]
**Agent:** [AGENT_NAME/ID]
**Session:** [SESSION_ID]
**Action:** [What was attempted]
**Phase:** [SPEC|RESEARCH|PLAN|TODO|IMPLEMENTATION]
**Status:** [SUCCESS | FAILED | MISALIGNED | SKIPPED | BLOCKED]
**Details:** [One-line reason or error message]
**Next Action:** [What should happen next session]
**Document Version:** [Related spec/research/plan/todo version]
**Commit Hash:** [Git commit if applicable]
```

---

## Entries

### [YYYY-MM-DD] Day Summary
**Total Sessions:** `[X]`  
**Successful Actions:** `[Y]`  
**Failed Actions:** `[Z]`  
**Current Phase:** `[PHASE]`

#### Entry [N]
**Time:** `[TIMESTAMP]`  
**Agent:** `[AGENT]`  
**Session:** `[SESSION_ID]`  
**Action:** `[ACTION]`  
**Phase:** `[PHASE]`  
**Status:** `[STATUS]`  
**Details:** `[DETAILS]`  
**Next Action:** `[NEXT_ACTION]`  
**Document Version:** `[VERSION]`  
**Commit Hash:** `[COMMIT_HASH_OR_NONE]`

---

## Statistics
| Metric | Count |
|--------|-------|
| Total Sessions | `[X]` |
| Successful Actions | `[Y]` |
| Failed Actions | `[Z]` |
| Misalignment Detections | `[A]` |
| Rollbacks Executed | `[B]` |
| Average Session Duration | `[C] minutes` |

## Active Issues
| Issue ID | First Detected | Status | Assigned To |
|----------|----------------|--------|-------------|
| `[ISSUE-001]` | `[DATE]` | `OPEN` | `[AGENT_NAME]` |
| `[ISSUE-002]` | `[DATE]` | `RESOLVED` | `[AGENT_NAME]` |

---

## Audit Trail
This log is automatically maintained by the Agent Orchestrator. Do not edit manually.
```
