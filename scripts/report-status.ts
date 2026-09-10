export interface SuiteStats {
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  total: number;
}

export interface SuiteStatus {
  status: 'passed' | 'flaky' | 'failed' | 'infrastructure failure' | 'not run' | 'interrupted' | 'unverified' | 'skipped';
  reason?: string;
}

export function validateStats(stats: SuiteStats): void {
  if (Object.values(stats).some(value => !Number.isInteger(value) || value < 0)) {
    throw new Error('Report contains invalid test counts');
  }
  if (stats.passed + stats.failed + stats.skipped + stats.flaky !== stats.total) {
    throw new Error('Report test counts do not add up to the total');
  }
}

export function classifySuite(
  outcome: string | undefined,
  stats: SuiteStats | undefined,
  reportError?: string,
  runnerError?: string,
): SuiteStatus {
  if (outcome === 'skipped') return { status: 'not run', reason: 'Runner step was skipped' };
  if (outcome === 'cancelled') return { status: 'interrupted', reason: 'Runner step was cancelled' };
  if (outcome !== 'success' && outcome !== 'failure') {
    return { status: 'unverified', reason: `Runner outcome ${outcome ? `is invalid (${outcome})` : 'was not supplied'}` };
  }
  if (reportError || !stats) {
    return { status: 'infrastructure failure', reason: reportError || 'Report is missing' };
  }
  if (stats.failed > 0) return { status: 'failed', reason: runnerError };
  if (runnerError) return { status: 'infrastructure failure', reason: runnerError };
  if (outcome === 'failure') {
    return { status: 'infrastructure failure', reason: 'Runner failed without recorded test failures' };
  }
  if (stats.total === 0) return { status: 'infrastructure failure', reason: 'Report contains no tests' };
  if (stats.skipped === stats.total) return { status: 'skipped', reason: 'No tests executed' };
  return { status: stats.flaky > 0 ? 'flaky' : 'passed' };
}

export function suitePassed(suite: SuiteStatus): boolean {
  return suite.status === 'passed' || suite.status === 'flaky';
}

export function formatSuiteStatus(name: string, suite: SuiteStatus, stats?: SuiteStats): string {
  if (!stats || !['passed', 'flaky', 'failed'].includes(suite.status)) {
    return `${name}: ${suite.status}${suite.reason ? ` — ${suite.reason}` : ''}`;
  }
  const details = [`${stats.passed + stats.flaky}/${stats.total} passed`];
  if (stats.failed) details.push(`${stats.failed} failed`);
  if (stats.flaky) details.push(`${stats.flaky} passed on retry`);
  if (stats.skipped) details.push(`${stats.skipped} skipped`);
  if (suite.reason) details.push(suite.reason);
  return `${name}: ${details.join(', ')}`;
}
