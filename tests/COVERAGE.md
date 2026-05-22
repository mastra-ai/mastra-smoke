# API Smoke Test Coverage

> 362 tests across 68 test files — last updated 2026-05-22

**Test runner:** Vitest
**Test dir:** `tests/`

> **Legend:** &ensp; ✅ Tested &ensp; ⬜ Not tested &ensp; 🔒 Requires setup

---

## Summary

| Section          | Tests | Status |
|------------------|-------|--------|
| Workflows        | 68    | Complete |
| Agents           | 35    | Complete (+4 extras: instructions enhance, model set/reset, models reorder, clone gating); voice/speakers ⚠️ partial — 5 shape-only tests against a no-voice agent, real speak/listen paths untested |
| Datasets         | 19    | Complete |
| Workspace        | 27    | Complete (+3 skills-sh registry: search/popular/preview) |
| MCP              | 17    | Complete |
| Processors       | 17    | Complete |
| Tools            | 15    | Complete |
| Memory           | 20    | Complete (+4 extras: thread clone, search, observational-memory gating, buffer-status gating) |
| Scores           | 11    | Complete |
| Observability    | 47    | Complete (+4 extras: branches, traces/light gating, trajectory, span scores; +10 discovery; +16 aggregations; +7 feedback/scores ingest/read; +3 logs; +7 traces); traces/score ⚠️ partial — only 400/500 negative cases, happy path untested (no registered trace-scorer) |
| Editor builder   | 7     | ⚠️ Partial — 7 tests covering 3 of 7 routes (registries/settings/infrastructure); popular/search/preview/install untested (need `skills-sh` registry enabled in fixture) |
| Stored entities  | 41    | Agents full versions/compare diff; skills/mcp-clients/prompt-blocks/scorers ⚠️ partial — only 400 (missing params) and 404 (unknown UUID) probes, no real v1→v2 diff lifecycle |
| Schedules        | 6     | list + empty-shape sanity + lifecycle |
| Background tasks | 3     | list shape + create/get |
| System           | 5     | `/system/api-schema` + `/system/packages` + channels gated |
| Auth             | 2     | `/auth/capabilities` + `/auth/me` gated shape |
| Providers        | 5     | tool-providers/processor-providers gated, platforms empty |
| OpenAI compat    | 10    | NEW — `/api/v1/conversations` + `/api/v1/responses` |
| A2A              | 5     | NEW — agent card + `/api/a2a/:agentId` JSON-RPC message/send |
| Embedders        | 1     | NEW — `/api/embedders` registry shape |
| Vectors          | 1     | NEW — `/api/vectors` empty-registry shape |
| Vector Store     | 0/7   | 🔒 Needs embedder + vector config (per-index endpoints) |
| Logs             | 0/3   | 🔒 Needs logger transports |
| **Total**        | **362** |      |

### Coverage by `/api/*` route group (cross-reference)

| Route prefix | Test files |
|---|---|
| `/api/workflows/*` | `tests/workflows/*` |
| `/api/agents/*` | `tests/agents/*`, `tests/agents/agent-management.test.ts` (extras) |
| `/api/memory/*` | `tests/memory/*`, `tests/memory/extras.test.ts` |
| `/api/observability/*` | `tests/observability/*`, `tests/observability/extras.test.ts` |
| `/api/datasets/*` | `tests/datasets/*` |
| `/api/workspaces/*` | `tests/workspaces/*`, `tests/workspaces/skills-registry.test.ts` |
| `/api/stored/*` | `tests/stored/*` (8 files) |
| `/api/schedules/*` | `tests/schedules/schedules.test.ts` |
| `/api/background-tasks/*` | `tests/background-tasks/background-tasks.test.ts` |
| `/api/system/*` | `tests/system/system.test.ts` |
| `/api/auth/*` | `tests/auth/capabilities.test.ts` |
| `/api/tool-providers/*`, `/api/processor-providers/*` | `tests/providers/*` |
| `/api/channels/*` | `tests/system/channels.test.ts` |
| `/api/scores/*` | `tests/scores/*` |
| `/api/mcp/*` | `tests/mcp/*` |
| `/api/processors/*` | `tests/processors/*` |
| `/api/tools/*` | `tests/tools/*` |
| `/api/v1/conversations/*`, `/api/v1/responses/*` | `tests/v1/openai-compat.test.ts` |
| `/api/a2a/:agentId`, `/.well-known/agent-card.json` | `tests/a2a/a2a.test.ts` |
| `/api/embedders` | `tests/embedders/embedders.test.ts` |
| `/api/vectors` | `tests/vectors/vectors.test.ts` |
| `/api/editor/builder/*` | `tests/editor/builder.test.ts` |

---

## ✅ What's Tested

### Workflows (68 tests, 17 files)

#### Basic Execution — `basic.test.ts` (7 tests)

| Test | Status |
|------|--------|
| Sequential steps — chain 3 steps, produce combined message | ✅ |
| Schema validation — valid input accepted | ✅ |
| Schema validation — value too high rejected | ✅ |
| Schema validation — wrong type rejected | ✅ |
| Schema validation — boundary value 0 (minimum) | ✅ |
| Schema validation — boundary value 100 (maximum) | ✅ |
| Schema validation — below minimum rejected | ✅ |
| Map between steps — fullName to displayName mapping | ✅ |

#### Control Flow — `control-flow.test.ts` (9 tests)

| Test | Status |
|------|--------|
| Branch — positive branch for positive values | ✅ |
| Branch — negative branch for negative values | ✅ |
| Branch — boundary value 0 (positive per >= 0) | ✅ |
| Parallel — 3 concurrent steps with collected results | ✅ |
| Do-while — loop until count reaches 5 | ✅ |
| Do-while — executes at least once at threshold | ✅ |
| Do-until — accumulate until total reaches 50 | ✅ |
| Do-until — executes at least once at threshold | ✅ |
| Foreach — process each item in array | ✅ |

#### Suspend/Resume — `suspend-resume.test.ts` (5 tests)

| Test | Status |
|------|--------|
| Basic suspend — returns suspend payload | ✅ |
| Basic suspend — resume with data and complete | ✅ |
| Basic suspend — handle rejection on resume | ✅ |
| Parallel suspend — suspend both parallel branches | ✅ |
| Parallel suspend — resume individual branches by step ID | ✅ |
| Loop suspend — suspend on each loop iteration and resume | ✅ |
| Loop suspend — execute once and stop at threshold | ✅ |

#### State Management — `state.test.ts` (2 tests)

| Test | Status |
|------|--------|
| Stateful workflow — accumulate state across steps | ✅ |
| Initial state — start with provided initialState | ✅ |

#### State + Suspend — `state-suspend.test.ts` (4 tests)

| Test | Status |
|------|--------|
| State persist across suspend/resume cycle | ✅ |
| State persist across suspend/resume with rejection | ✅ |
| State accumulation inside do-while loop | ✅ |
| State access in parallel branches | ✅ |

#### Nested Workflows — `nested.test.ts` (1 test) + `nested-advanced.test.ts` (2 tests)

| Test | Status |
|------|--------|
| Inner workflow as a step — pass data through | ✅ |
| Deep nesting — 2 levels of nesting | ✅ |
| Nested suspend — suspend inside nested workflow and resume | ✅ |

#### Error Handling — `error-handling.test.ts` (2 tests)

| Test | Status |
|------|--------|
| Retry workflow — succeed after retries | ✅ |
| Failure workflow — report failed status with exact error shape | ✅ |

#### Foreach Errors — `foreach-errors.test.ts` (3 tests)

| Test | Status |
|------|--------|
| Foreach item throws — workflow fails with exact error | ✅ |
| Foreach no items throw — workflow succeeds | ✅ |
| Foreach flaky item with retry — succeeds after retries | ✅ |

#### Sleep — `sleep.test.ts` (1 test)

| Test | Status |
|------|--------|
| 2s sleep completes and reports elapsed time within bounds | ✅ |

#### Streaming — `streaming.test.ts` (2 tests) + `streaming-advanced.test.ts` (3 tests)

| Test | Status |
|------|--------|
| Stream sequential-steps with proper chunk types | ✅ |
| Stream suspend then stream resume with proper events | ✅ |
| Stream failed workflow with error event and step-level error | ✅ |
| Stream workflow that retries and eventually succeeds | ✅ |
| Stream parallel suspend events for multiple branches + resume both | ✅ |

#### Concurrent Suspend — `concurrent-suspend.test.ts` (2 tests)

| Test | Status |
|------|--------|
| Resume both parallel branches simultaneously | ✅ |
| Independent suspend/resume across concurrent runs | ✅ |

#### Cancel — `cancel-suspended.test.ts` (2 tests)

| Test | Status |
|------|--------|
| Cancel a workflow in suspended state | ✅ |
| Not resumable after cancellation | ✅ |

#### Run Management — `run-management.test.ts` (7 tests)

| Test | Status |
|------|--------|
| List all registered workflows | ✅ |
| Get single workflow metadata | ✅ |
| List runs after starting a workflow (with snapshot shape) | ✅ |
| Get run details by ID | ✅ |
| Delete a run (+ verify 404) | ✅ |
| Cancel a running workflow (via poll + cancel) | ✅ |
| Time-travel — re-execute from a specific step | ✅ |
| Restart an active workflow run | ✅ |

#### API Endpoint Variants — `api-endpoints.test.ts` (4 tests)

| Test | Status |
|------|--------|
| Sync /start (fire-and-forget) + poll for completion | ✅ |
| Sync /resume (fire-and-forget) + poll for completion | ✅ |
| /create-run — pre-create and verify | ✅ |
| /time-travel-stream — stream time-travel re-execution | ✅ |

#### Edge Cases — `edge-cases.test.ts` (5 tests)

| Test | Status |
|------|--------|
| 404 for non-existent workflow | ✅ |
| 404 for non-existent run | ✅ |
| 404 for non-existent workflow metadata | ✅ |
| 500 when resuming a completed (non-suspended) run | ✅ |
| 500 when time-traveling to non-existent step | ✅ |
| Foreach with empty array | ✅ |
| Foreach with single item | ✅ |
| Multiple concurrent runs of the same workflow | ✅ |

---

### Agents (35 tests, 10 files)

#### Discovery — `agents.test.ts` (4 tests)

| Test | Status |
|------|--------|
| List all registered agents | ✅ |
| Get agent metadata by ID (name, instructions, source, description) | ✅ |
| Agent tools included in metadata (keys, ids, descriptions) | ✅ |
| 404 for non-existent agent | ✅ |

#### Generate — `generate.test.ts` (6 tests)

| Test | Status |
|------|--------|
| Simple text generation (response text, finishReason) | ✅ |
| Usage information (inputTokens, outputTokens) | ✅ |
| Tool use — calculator (multiply 7x6, verify tool result = 42) | ✅ |
| Tool use — string-transform (uppercase, verify exact result) | ✅ |
| Multi-turn with memory — recall fact across thread turns | ✅ |
| 404 for non-existent agent | ✅ |

#### Stream — `stream.test.ts` (3 tests)

| Test | Status |
|------|--------|
| Text streaming — event sequence (start > text-delta > step-finish > finish), usage info | ✅ |
| Tool use streaming — tool-call + tool-result events with exact result | ✅ |
| 404 for non-existent agent | ✅ |

#### Structured Output — `structured-output.test.ts` (2 tests)

| Test | Status |
|------|--------|
| Generate with structuredOutput — JSON response matching schema | ✅ |
| Stream with structuredOutput — text deltas form valid structured JSON | ✅ |

#### Stream with Memory — `stream-memory.test.ts` (1 test)

| Test | Status |
|------|--------|
| Multi-turn recall across thread turns via stream endpoint | ✅ |

#### Tool Approval — `tool-approval.test.ts` (2 tests)

| Test | Status |
|------|--------|
| Approve tool call — pause on tool-call-approval, resume with tool result | ✅ |
| Decline tool call — pause on tool-call-approval, resume with rejection message | ✅ |

#### Providers — `providers.test.ts` (2 tests)

| Test | Status |
|------|--------|
| List available providers with expected shape (id, name, connected) | ✅ |
| OpenAI listed as a connected provider | ✅ |

#### Agent-Scoped Tools — `agent-tools.test.ts` (6 tests)

| Test | Status |
|------|--------|
| Get calculator tool metadata through agent endpoint | ✅ |
| Get string-transform tool metadata through agent endpoint | ✅ |
| 404 for tool not assigned to agent (always-fails) | ✅ |
| Execute calculator through agent endpoint (exact result) | ✅ |
| Execute string-transform through agent endpoint (exact result) | ✅ |
| 404 when executing tool not assigned to agent | ✅ |

---

### Tools (15 tests, 1 file)

#### Discovery — `tools.test.ts`

| Test | Status |
|------|--------|
| List all registered tools (verify by tool ID) | ✅ |
| Get tool by ID with schema (inputSchema, outputSchema via superjson) | ✅ |
| 404 for non-existent tool | ✅ |

#### Execution — `tools.test.ts`

| Test | Status |
|------|--------|
| Calculator — addition (10 + 32 = 42) | ✅ |
| Calculator — multiplication (7 x 6 = 42) | ✅ |
| Calculator — subtraction (100 - 58 = 42) | ✅ |
| Calculator — division (84 / 2 = 42) | ✅ |
| String-transform — uppercase | ✅ |
| String-transform — reverse | ✅ |
| String-transform — length | ✅ |
| Timestamp — no input, returns timestamp + ISO string | ✅ |
| 500 when executing tool that throws | ✅ |
| 500 when dividing by zero | ✅ |
| Validation error for missing required fields (200 with error shape) | ✅ |
| 404 when executing non-existent tool | ✅ |

---

### MCP (17 tests, 2 files)

#### REST API — `rest.test.ts` (11 tests)

| Test | Status |
|------|--------|
| List registered MCP servers (name, version, is_latest) | ✅ |
| Get server details by ID | ✅ |
| 404 for non-existent server | ✅ |
| List tools on MCP server (calculator, string-transform) | ✅ |
| Get tool details with input schema | ✅ |
| 404 for non-existent tool on valid server | ✅ |
| 404 for tool on non-existent server | ✅ |
| Execute calculator via MCP REST endpoint (exact result) | ✅ |
| Execute string-transform via MCP REST endpoint (exact result) | ✅ |
| 500 when executing non-existent tool | ✅ |
| Validation error for missing required fields (200 with error shape) | ✅ |

#### Client Transport — `client.test.ts` (6 tests)

| Test | Status |
|------|--------|
| Connect and list tools via Streamable HTTP transport | ✅ |
| Execute calculator tool via Streamable HTTP | ✅ |
| Execute string-transform tool via Streamable HTTP | ✅ |
| Connect and list tools via SSE fallback transport | ✅ |
| Execute calculator tool via SSE transport | ✅ |
| Execute string-transform tool via SSE transport | ✅ |

---

### Observability (47 tests, 6 files)

#### Traces — `traces.test.ts` (7 tests)

| Test | Status |
|------|--------|
| List spans with pagination (total, page, perPage, hasMore) | ✅ |
| Span shape — traceId (hex32), spanId (hex16), name, spanType, startedAt | ✅ |
| Workflow spans present — entityType, entityId, name pattern | ✅ |
| Successful workflow spans with timing (startedAt <= endedAt) | ✅ |
| Pagination — page 0 and page 1 return distinct spans | ✅ |
| Get trace by ID — all spans share traceId, span shape verified | ✅ |
| 404 for non-existent trace | ✅ |

#### Discovery — `discovery.test.ts` (10 tests)

| Test | Status |
|------|--------|
| GET `/observability/environments` returns array | ✅ |
| GET `/observability/entity-types` returns array | ✅ |
| GET `/observability/entity-names` returns array | ✅ |
| GET `/observability/service-names` returns array | ✅ |
| GET `/observability/tags` returns object | ✅ |
| GET `/observability/metric-names` returns array | ✅ |
| GET `/observability/metric-label-keys` (200 with valid metricName, 400 without) | ✅ |
| GET `/observability/metric-label-values` (200 with valid metricName+labelKey, 400 without) | ✅ |

#### Aggregations — `aggregations.test.ts` (16 tests, score/feedback/metric aggregate/breakdown/percentiles/timeseries)

| Test | Status |
|------|--------|
| POST `/scores/aggregate` empty-store null, 400 on missing scorerId | ✅ |
| POST `/scores/breakdown` empty groups, 400 on missing groupBy | ✅ |
| POST `/scores/percentiles` one series per requested percentile, empty points | ✅ |
| POST `/scores/timeseries` series named after scorerId, empty points | ✅ |
| POST `/feedback/aggregate` empty-store value=0, 400 on missing feedbackType | ✅ |
| POST `/feedback/breakdown` empty groups | ✅ |
| POST `/feedback/percentiles` one series per requested percentile, empty points | ✅ |
| POST `/feedback/timeseries` series named after feedbackType, empty points | ✅ |
| POST `/metrics/aggregate` empty-store null + costUnit/estimatedCost null, 400 on missing name | ✅ |
| POST `/metrics/breakdown` empty groups | ✅ |
| POST `/metrics/percentiles` one series per requested percentile, empty points | ✅ |
| POST `/metrics/timeseries` one series per name, costUnit field, empty points | ✅ |

#### Feedback + Scores ingest — `feedback.test.ts` (7 tests)

| Test | Status |
|------|--------|
| POST `/observability/feedback` rejects missing body with 400 | ✅ |
| POST `/observability/feedback` persists row that appears in GET `/feedback` | ✅ |
| POST `/observability/scores` rejects missing body with 400 | ✅ |
| POST `/observability/scores` persists row that appears in GET `/scores` | ✅ |
| GET `/observability/scores/:id` returns `{ score: null }` for unknown id | ✅ |
| POST `/observability/traces/score` rejects missing scorerName+targets with 400 | ✅ |
| POST `/observability/traces/score` errors with scorer name in message when scorer not registered | 🔒 negative-only |
| POST `/observability/traces/score` — happy path with a registered trace-scorer | ⬜ untested (no scorer fixture) |

---

### Memory (14 tests, 3 files)

#### Threads — `threads.test.ts` (6 tests)

| Test | Status |
|------|--------|
| Create a thread (with metadata and timestamps) | ✅ |
| Get thread by ID | ✅ |
| List threads with pagination metadata | ✅ |
| Update thread metadata | ✅ |
| Delete a thread (+ verify 404) | ✅ |
| 404 for non-existent thread | ✅ |

#### Messages — `messages.test.ts` (4 tests)

| Test | Status |
|------|--------|
| Save messages and verify content structure (content.parts shape) | ✅ |
| List messages with pagination metadata | ✅ |
| Preserve message content and roles across save/list | ✅ |
| Delete specific messages | ✅ |

#### Status & Working Memory — `status.test.ts` (4 tests)

| Test | Status |
|------|--------|
| Memory status endpoint | ✅ |
| Memory config with exact shape (workingMemory template) | ✅ |
| Working memory GET — null for fresh thread (+ source, threadExists, template) | ✅ |
| Working memory POST — update and retrieve (resourceId in body) | ✅ |

---

### Workspace (22 tests, 3 files)

#### Metadata — `metadata.test.ts` (3 tests)

| Test | Status |
|------|--------|
| List all workspaces with capabilities (hasFilesystem, hasSkills, readOnly) | ✅ |
| Get workspace details — status, filesystem provider, capabilities | ✅ |
| Non-existent workspace returns isWorkspaceConfigured: false | ✅ |

#### Filesystem — `filesystem.test.ts` (13 tests)

| Test | Status |
|------|--------|
| List root directory entries (file type, size, directory type) | ✅ |
| List subdirectory entries | ✅ |
| 404 for non-existent directory | ✅ |
| Read file content (exact content match) | ✅ |
| 404 for non-existent file | ✅ |
| Stat file metadata (type, size derived from fixture) | ✅ |
| Stat directory metadata | ✅ |
| 404 for non-existent stat path | ✅ |
| Write file and read back | ✅ |
| Write with recursive directory creation | ✅ |
| Create directory (+ verify via stat) | ✅ |
| Create nested directories with recursive | ✅ |
| Delete file (+ verify 404 after) | ✅ |
| Delete directory recursively (+ verify 404 after) | ✅ |
| 404 when deleting non-existent path | ✅ |

#### Skills — `skills.test.ts` (6 tests)

| Test | Status |
|------|--------|
| List discovered skills (name, description, path) | ✅ |
| Get skill details — instructions, source, references, scripts, assets | ✅ |
| 404 for non-existent skill | ✅ |
| List skill reference files | ✅ |
| Get reference file content (exact content match) | ✅ |
| 404 for non-existent reference | ✅ |

---

### Processors (17 tests, 1 file)

| Test | Status |
|------|--------|
| List all registered processors (shape, phases, isWorkflow) | ✅ |
| Get processor details by ID (phases, configurations) | ✅ |
| Get suffix processor — verify both input and outputResult phases | ✅ |
| 404 for non-existent processor | ✅ |
| Execute uppercase processor on input phase (exact text transform) | ✅ |
| Execute suffix processor on input phase (append suffix) | ✅ |
| Execute suffix processor on outputResult phase (append suffix) | ✅ |
| Process multiple messages at once (batch transform) | ✅ |
| Preserve non-text parts while transforming text parts (mixed part types) | ✅ |
| Trigger tripwire with metadata when message contains BLOCK | ✅ |
| Pass through when tripwire is not triggered | ✅ |
| Compose input and outputResult phases independently (chained execution) | ✅ |
| Handle empty messages array | ✅ |
| 400 when phase is missing | ✅ |
| 400 when messages is missing | ✅ |
| 400 for unsupported phase on processor | ✅ |
| 404 for non-existent processor (execute) | ✅ |

---

### Scores (11 tests, 1 file)

| Test | Status |
|------|--------|
| List registered scorers (config shape, isRegistered flag) | ✅ |
| Get scorer details by ID (config, isRegistered) | ✅ |
| Non-existent scorer returns null (200) | ✅ |
| Save a score record (scorerId, entityId, score, reason round-trip) | ✅ |
| Save a second score for the same run | ✅ |
| List scores by run ID (exact pagination total, both scorerIds present) | ✅ |
| Empty scores for unknown run | ✅ |
| List scores by scorer ID (exact pagination total, score value) | ✅ |
| Empty scores for unknown scorer | ✅ |
| List scores by entity (exact pagination total, all entityIds match) | ✅ |
| 404 for unknown entity | ✅ |

---

### Datasets (19 tests, 1 file)

| Test | Status |
|------|--------|
| Create a dataset (name, description, metadata, version 0) | ✅ |
| List datasets with pagination | ✅ |
| Get dataset by ID | ✅ |
| 404 for non-existent dataset | ✅ |
| Update dataset metadata (PATCH) | ✅ |
| Add item to dataset (input, groundTruth, metadata) | ✅ |
| Add a second item | ✅ |
| List items with exact pagination total | ✅ |
| Get item by ID | ✅ |
| Update item (PATCH groundTruth) | ✅ |
| SCD-2 item history after update (>= 2 versions) | ✅ |
| Get item at specific dataset version | ✅ |
| 404 for item at non-existent version | ✅ |
| Batch insert items (2 items, single version) | ✅ |
| Batch delete items (verify removal) | ✅ |
| Delete single item (verify absent from list) | ✅ |
| List dataset versions with shape assertions | ✅ |
| List experiments (empty initially) | ✅ |
| Delete dataset (+ verify 404 after) | ✅ |

---

### OpenAI Compat — `tests/v1/openai-compat.test.ts` (10 tests)

| Test | Status |
|------|--------|
| `POST /v1/conversations` rejects body without `agent_id` (400 + `issues[field=agent_id]`) | ✅ |
| `POST /v1/conversations` creates a conversation (`object=conversation`, `thread.id===id`) | ✅ |
| `GET /v1/conversations/:id` round-trips the conversation shape | ✅ |
| `GET /v1/conversations/:id/items` returns `object=list`, empty `data`, `has_more=false` | ✅ |
| `DELETE /v1/conversations/:id` returns `object=conversation.deleted`, then GET 404s | ✅ |
| `GET /v1/conversations/:id` returns 404 with the id in the error message | ✅ |
| `POST /v1/responses` rejects body without `input` (400 + `issues[field=input]`) | ✅ |
| `POST /v1/responses` returns a completed response with `output_text` + balanced token usage | ✅ |
| `GET /v1/responses/:id` returns 404 for an unknown id | ✅ |
| `DELETE /v1/responses/:id` returns 404 for an unknown id | ✅ |

> Note: the fixture does not persist Responses by default, so the suite covers the POST shape exhaustively rather than a GET-after-create round-trip.

### A2A — `tests/a2a/a2a.test.ts` (5 tests)

| Test | Status |
|------|--------|
| `GET /.well-known/:agentId/agent-card.json` exposes the card with calculator + string-transform skills | ✅ |
| `GET /.well-known/:agentId/agent-card.json` returns 404 with the agent id in the error | ✅ |
| `POST /api/a2a/:agentId` `message/send` returns `result.status.state === 'completed'` with text artifacts + history | ✅ |
| `POST /api/a2a/:agentId` rejects unknown JSON-RPC `method` (400 + `issues[field=method]`) | ✅ |
| `POST /api/a2a/:agentId` returns 404 with the unknown agent ID in the error | ✅ |

### Embedders / Vectors — `tests/embedders/`, `tests/vectors/` (2 tests)

| Test | Status |
|------|--------|
| `GET /embedders` returns a non-empty registry with id/provider/dimensions | ✅ |
| `GET /vectors` returns an empty registry in the smoke fixture | ✅ |

---

### Editor Builder — `tests/editor/builder.test.ts` (3 routes covered + 4 disabled-gating probes)

> ⚠️ **Partial coverage.** Only `registries`, `settings`, and `infrastructure` are
> exercised against their real implementation. `popular`, `search`, `preview`,
> and `install` are reachable but only tested in the *disabled* state because
> the fixture has `skills-sh` registry `enabled: false`. The actual feature
> code paths (registry lookup, GitHub proxy, install flow) are untested.

| Test | Status |
|------|--------|
| `GET /editor/builder/registries` lists skills-sh as disabled | ✅ |
| `GET /editor/builder/settings` reflects disabled model policy | ✅ |
| `GET /editor/builder/infrastructure` reports smoke-stub channel + unregistered browser/workspace | ✅ |
| `GET /editor/builder/registries/skills-sh/popular` returns 404 "Registry not found" when disabled | 🔒 disabled-only |
| `GET /editor/builder/registries/skills-sh/search` returns 404 "Registry not found" when disabled | 🔒 disabled-only |
| `GET /editor/builder/registries/skills-sh/preview` rejects missing owner/repo with structured 400 | 🔒 disabled-only |
| `POST /editor/builder/registries/skills-sh/install` rejects missing body with structured 400 | 🔒 disabled-only |

---

### Stored Agents — versions/compare — `tests/stored/versions-compare.test.ts` (4 tests)

> ⚠️ **Only stored *agents* has a real v1→v2 lifecycle test.** The
> `versions/compare` routes on `/stored/skills/*`, `/stored/mcp-clients/*`,
> `/stored/prompt-blocks/*`, and `/stored/scorers/*` are *not* covered here.
> Probing them requires a valid create payload per entity type (skills runtime
> spec, scorer judge config, mcp-client transport URL, prompt-block body); the
> existing per-type CRUD specs cover create/update but not diffing.

| Test | Status |
|------|--------|
| Creates v1, patches to produce a distinct v2 | ✅ |
| `GET /stored/agents/:id/versions/compare` rejects missing from/to with structured 400 | ✅ |
| Returns 404 with "Version with id … not found" for unknown version id | ✅ |
| Returns a diff with `instructions` field and from/to version metadata | ✅ |

---

### Agents — voice — `tests/agents/voice.test.ts` (5 tests)

> ⚠️ **Shape-only smoke against a no-voice agent.** Every assertion is "empty
> array" or `{ enabled: false }` because the fixture agent has no voice
> provider configured. The actual `speak`/`listen` code paths in
> `@mastra/voice-*` are untested. Treat this row as 🔒 — real coverage needs
> an `OpenAIVoice` (or similar) provider wired in `src/mastra/` plus an API
> key in the smoke env.

| Test | Status |
|------|--------|
| `GET /agents/:id/speakers` returns `[]` when no voice provider is configured | 🔒 empty-provider |
| `GET /agents/:id/voice/speakers` returns `[]` when no voice provider is configured | 🔒 empty-provider |
| `GET /agents/:id/voice/listener` returns `{ enabled: false }` | 🔒 empty-provider |
| `POST /agents/:id/voice/listen` rejects empty body with 400 "Audio data is required" | ✅ |
| `GET /agents/:id/speakers` returns 404 for an unknown agent (error names the id) | ✅ |

---

## ⬜ What's Not Tested

### Vector Store — 🔒 Needs embedder + vector config

`GET /vectors` and `GET /embedders` are covered as empty/registry shape checks
in `tests/vectors/` and `tests/embedders/`. The per-index CRUD endpoints below
still require a real vector store to be wired up in the smoke fixture.

| Endpoint | Priority |
|----------|----------|
| `POST /vector/:name/create-index` — Create vector index | High |
| `GET /vector/:name/indexes` — List indexes | High |
| `GET /vector/:name/indexes/:indexName` — Get index details | High |
| `POST /vector/:name/upsert` — Upsert vectors | High |
| `POST /vector/:name/query` — Query vectors | High |
| `DELETE /vector/:name/indexes/:indexName` — Delete index | High |

### Logs — 🔒 Needs logger transports

| Endpoint | Priority |
|----------|----------|
| `GET /logs/transports` — List log transports | Medium |
| `GET /logs` — List logs | Medium |
| `GET /logs/:runId` — Get logs for a run | Medium |

### Agents — Untested Endpoints

| Endpoint | Why | Priority |
|----------|-----|----------|
| `POST /agents/:agentId/generate-legacy` | Deprecated | Low |
| `POST /agents/:agentId/stream-legacy` | Deprecated | Low |
| `POST /agents/:agentId/clone` | Stored agent feature | Low |
| `POST /agents/:agentId/instructions/enhance` | Non-deterministic LLM output | Low |
| `POST /agents/:agentId/model` (update/get/reset) | Requires stored agents | Low |
| `GET /agents/:agentId/skills/:skillName` | Requires workspace/skills setup | Low |
| `POST /agents/:agentId/voice/speak` — real speak path | Needs an `OpenAIVoice` (or similar) provider + API key in fixture | Medium |
| `POST /agents/:agentId/voice/listen` — real listen path (with audio) | Needs voice provider + API key + audio fixture | Medium |
| `GET /agents/:agentId/voice/speakers` — non-empty speakers | Needs voice provider configured | Medium |

### Observability — Untested Endpoints

| Endpoint | Priority |
|----------|----------|
| `POST /observability/traces/score` — End-to-end happy path (needs a registered scorer fixture in `src/mastra/`; current tests only assert 400/500 negatives) | Medium |
| `GET /observability/feedback/:feedbackId` — fetch by id | Low |
| `DELETE /observability/feedback/:feedbackId` — delete by id | Low |
| `GET /observability/scores/:scoreId/scoring-trace` — scoring trace by score id | Low |
| `GET /observability/scoring-traces/:scoringTraceId` — scoring trace by id | Low |

> Aggregation, discovery, and ingest paths are all covered as of 2026-05-21.

### Memory — Untested Endpoints

| Endpoint | Priority |
|----------|----------|
| `POST /memory/threads/:threadId/clone` — Clone a thread | Medium |
| `GET /memory/search` — Semantic search across threads | Medium |
| `POST /memory/observational-memory` — Observational memory features | Low |
| `POST /memory/observational-memory/buffer-status` — Buffer status | Low |

> Requires `semanticRecall` and observational memory config + embedder.

### MCP — Untested Endpoints

| Endpoint | Priority |
|----------|----------|
| `POST /mcp/:serverId/messages` — SSE message forwarding | Low |
| MCP resources (list, read, subscribe) | Medium |
| MCP prompts (list, get) | Medium |

### Editor Builder — Untested Endpoints

| Endpoint | Why | Priority |
|----------|-----|----------|
| `GET /editor/builder/registries/skills-sh/popular` — happy path | Fixture has `skills-sh` registry disabled; needs enabling | Medium |
| `GET /editor/builder/registries/skills-sh/search` — happy path | Same as above | Medium |
| `GET /editor/builder/registries/skills-sh/preview` — happy path | Same; also needs valid `owner`/`repo`/`path` GitHub target | Medium |
| `POST /editor/builder/registries/skills-sh/install` — happy path | Same; also needs a valid skill repo to install from | Medium |

### Stored Entities — Untested Endpoints

| Endpoint | Why | Priority |
|----------|-----|----------|
| `GET /stored/skills/:id/versions/compare` — v1→v2 diff | Needs valid skill create payload (runtime spec) | Medium |
| `GET /stored/mcp-clients/:id/versions/compare` — v1→v2 diff | Needs valid mcp-client create payload (transport URL) | Medium |
| `GET /stored/prompt-blocks/:id/versions/compare` — v1→v2 diff | Needs valid prompt-block create payload | Medium |
| `GET /stored/scorers/:id/versions/compare` — v1→v2 diff | Needs valid scorer create payload (judge config) | Medium |

### Workspace — Untested Endpoints

| Endpoint | Priority |
|----------|----------|
| `GET /workspaces/:id/search` — Requires vector store + embedder | Low |
| `POST /workspaces/:id/index` — Requires vector store + embedder | Low |
| `GET /workspaces/:id/skills/search` — Requires search configuration | Low |
| `GET /workspaces/:id/skills-sh/*` (6 routes) — External skills.sh API proxy | Low |

### Dataset Experiments — 🔒 Needs async agent/scorer execution

| Endpoint | Priority |
|----------|----------|
| `POST /datasets/:datasetId/experiments` — Trigger experiment | Medium |
| `GET /datasets/:datasetId/experiments/:experimentId` — Get details | Medium |
| `GET /datasets/:datasetId/experiments/:experimentId/results` — List results | Medium |
| `POST /datasets/:datasetId/compare` — Compare experiments | Medium |

### Other Untested Areas

| Area | Endpoints | Requires | Priority |
|------|-----------|----------|----------|
| Processor Providers | 2 routes | Editor config | Low |
| Auth | 4 routes | Auth provider | Low |
| System | 1 route | — | Low |
| Stored Agents | 13 routes | EE license | Low |
| Stored Workspaces | 5 routes | EE license | Low |
| Stored Prompt Blocks | 12 routes | EE license | Low |
| Stored Scorers | 12 routes | EE license | Low |
| Stored Skills | 6 routes | EE license | Low |
| Stored MCP Clients | 12 routes | EE license | Low |

---

## Recommended Next Priorities

1. **Vector Store** — Core RAG primitive, 8 endpoints, requires embedder + vector config
2. **Logs** — 3 endpoints, minimal setup, validates telemetry plumbing
3. **Memory search + clone** — 2 endpoints, extends existing memory coverage
4. **Memory Network** — `/memory/network/threads`, `/save-messages`, `/messages/delete`, `/status` — 4 untested routes
5. **Workflows event/restart** — `/workflows/events`, `/restart-all-active-workflow-runs(-async)`, `/runs/:runId/steps/execute` — 4 untested routes
6. **Tool-call approval generate** — `/agents/:id/approve-tool-call-generate`, `/decline-tool-call-generate` — 2 untested routes
7. **Dataset Experiments** — 4 endpoints, end-to-end eval pipeline
8. **MCP resources/prompts** — Extends MCP coverage with resource and prompt features
