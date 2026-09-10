import { basename, isAbsolute, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { registerApiRoute } from '@mastra/core/server';
import { Mastra } from '@mastra/core/mastra';
import { MastraCompositeStore } from '@mastra/core/storage';
import { Workspace, LocalFilesystem } from '@mastra/core/workspace';
import { DuckDBStore } from '@mastra/duckdb';
import { LibSQLStore } from '@mastra/libsql';
import { Observability, DefaultExporter } from '@mastra/observability';

import { smokeLogger } from './logger.js';
import {
  testAgent,
  approvalAgent,
  helperAgent,
  networkAgent,
  workflowAgent,
  observationalAgent,
} from './agents/index.js';
import { calculatorTool, stringTool, failingTool, noInputTool, approvalTool } from './tools/index.js';
import { sequentialSteps, schemaValidation, mapBetweenSteps } from './workflows/basic.js';
import {
  branchWorkflow,
  parallelWorkflow,
  dowhileWorkflow,
  dountilWorkflow,
  foreachWorkflow,
} from './workflows/control-flow.js';
import { basicSuspend, parallelSuspend, loopSuspend } from './workflows/suspend-resume.js';
import { statefulWorkflow, initialStateWorkflow } from './workflows/state.js';
import { innerWorkflow, outerWorkflow } from './workflows/nested.js';
import { retryWorkflow, failureWorkflow, cancelableWorkflow } from './workflows/error-handling.js';
import { sleepWorkflow } from './workflows/sleep.js';
import { stateSuspendWorkflow, stateLoopWorkflow, stateParallelWorkflow } from './workflows/state-suspend.js';
import {
  deepInnerWorkflow,
  deepMiddleWorkflow,
  deepNestedWorkflow,
  nestedSuspendInner,
  nestedSuspendWorkflow,
} from './workflows/nested-advanced.js';
import { foreachErrorWorkflow, foreachRetryWorkflow } from './workflows/foreach-errors.js';
import { scoredWorkflow } from './workflows/scored.js';
import { scheduledHeartbeatWorkflow, scheduledTickWorkflow } from './workflows/scheduled.js';
import { testMcpServer } from './mcp/index.js';
import { uppercaseProcessor, suffixProcessor, tripwireProcessor } from './processors/index.js';
import { completenessScorer, lengthScorer } from './scorers/index.js';
import { smokeChannel } from './channels/index.js';

// Harness runs supply an absolute, private root. Manual dev keeps its local defaults.
const runDir = process.env.SMOKE_RUN_DIR;
if (runDir && !isAbsolute(runDir)) throw new Error('SMOKE_RUN_DIR must be absolute');
const workspacePath = runDir ? join(runDir, 'data', 'test-workspace') : './test-workspace';
const libsqlUrl = runDir ? pathToFileURL(join(runDir, 'data', 'test.db')).href : 'file:test.db';
const duckdbPath = runDir ? join(runDir, 'data', 'mastra.duckdb') : 'mastra.duckdb';

const testWorkspace = new Workspace({
  id: 'test-workspace',
  name: 'Test Workspace',
  filesystem: new LocalFilesystem({ basePath: workspacePath }),
  skills: ['skills'],
});

// Initialize the workspace so filesystem and skills are ready.
// Wrapped in try/catch so a missing basePath doesn't crash the entire server.
try {
  await testWorkspace.init();
} catch (err) {
  console.error('[workspace] Failed to initialize:', err);
  if (runDir) throw err;
}

export const mastra = new Mastra({
  server: {
    apiRoutes: [registerApiRoute('/smoke/health', {
      method: 'GET',
      handler: c => c.json({ runId: runDir ? basename(runDir) : null, runDir: runDir ?? null }),
    })],
  },
  logger: smokeLogger,
  workspace: testWorkspace,
  agents: {
    'test-agent': testAgent,
    'approval-agent': approvalAgent,
    'helper-agent': helperAgent,
    'network-agent': networkAgent,
    'workflow-agent': workflowAgent,
    'observational-agent': observationalAgent,
  },
  mcpServers: {
    'test-mcp': testMcpServer,
  },
  tools: {
    calculator: calculatorTool,
    'string-transform': stringTool,
    'always-fails': failingTool,
    timestamp: noInputTool,
    'needs-approval': approvalTool,
  },
  workflows: {
    'sequential-steps': sequentialSteps,
    'schema-validation': schemaValidation,
    'map-between-steps': mapBetweenSteps,
    'branch-workflow': branchWorkflow,
    'parallel-workflow': parallelWorkflow,
    'dowhile-workflow': dowhileWorkflow,
    'dountil-workflow': dountilWorkflow,
    'foreach-workflow': foreachWorkflow,
    'basic-suspend': basicSuspend,
    'parallel-suspend': parallelSuspend,
    'loop-suspend': loopSuspend,
    'stateful-workflow': statefulWorkflow,
    'initial-state': initialStateWorkflow,
    'inner-workflow': innerWorkflow,
    'outer-workflow': outerWorkflow,
    'retry-workflow': retryWorkflow,
    'failure-workflow': failureWorkflow,
    'cancelable-workflow': cancelableWorkflow,
    'sleep-workflow': sleepWorkflow,
    'state-suspend-workflow': stateSuspendWorkflow,
    'state-loop-workflow': stateLoopWorkflow,
    'state-parallel-workflow': stateParallelWorkflow,
    'deep-inner-workflow': deepInnerWorkflow,
    'deep-middle-workflow': deepMiddleWorkflow,
    'deep-nested-workflow': deepNestedWorkflow,
    'nested-suspend-inner': nestedSuspendInner,
    'nested-suspend-workflow': nestedSuspendWorkflow,
    'foreach-error-workflow': foreachErrorWorkflow,
    'foreach-retry-workflow': foreachRetryWorkflow,
    'scored-workflow': scoredWorkflow,
    'scheduled-heartbeat': scheduledHeartbeatWorkflow,
    'scheduled-tick': scheduledTickWorkflow,
  },
  scheduler: {
    enabled: true,
    // 5s tick keeps the end-to-end "scheduler actually fires" assertion fast
    // (schedules.test.ts polls for up to 15s) without hammering the LibSQL
    // workflow-snapshot table once per second. Under CI's slower disk the
    // every-second cadence starved tool-registry lookups → tool calls
    // returned 500s ("Tool not found") in unrelated agent/MCP tests.
    tickIntervalMs: 5_000,
  },
  backgroundTasks: {
    enabled: true,
  },
  channels: {
    'smoke-stub': smokeChannel,
  },
  scorers: {
    completeness: completenessScorer,
    'length-check': lengthScorer,
  },
  processors: {
    uppercase: uppercaseProcessor,
    suffix: suffixProcessor,
    'tripwire-test': tripwireProcessor,
  },
  storage: new MastraCompositeStore({
    id: 'composite-storage',
    default: new LibSQLStore({
      id: 'smoke-test',
      url: libsqlUrl,
    }),
    domains: {
      observability: await new DuckDBStore({ path: duckdbPath }).getStore('observability'),
    },
  }),
  observability: new Observability({
    configs: {
      default: {
        serviceName: 'smoke-test',
        exporters: [new DefaultExporter()],
      },
    },
  }),
});

// Seed a completed background task so /background-tasks lists a real entry.
try {
  const storage = mastra.getStorage();
  const bgStore = await storage?.getStore?.('backgroundTasks');
  if (bgStore) {
    await bgStore.createTask({
      id: 'seed-background-task',
      status: 'completed',
      toolName: 'calculator',
      toolCallId: 'seed-tool-call',
      args: { operation: 'add', a: 1, b: 2 },
      agentId: 'test-agent',
      runId: 'seed-run',
      retryCount: 0,
      maxRetries: 0,
      timeoutMs: 30_000,
      createdAt: new Date(),
      startedAt: new Date(),
      completedAt: new Date(),
      result: { value: 3 },
    });
  }
} catch (err) {
  console.error('[background-tasks] Failed to seed task:', err);
}
