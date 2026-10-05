// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, test } from 'vitest';
import {
    checkAcceptanceResults,
    checkEvidenceLedgerConsistency,
    checkManualEvidenceReadiness,
    formatReadinessReport,
    resolveDefaultAcceptancePaths
} from './fixtures/acceptance-results-check.js';

describe('acceptance results checker', () => {
    test('reports missing artifacts for captured rows', async () => {
        const root = await makeFixtureRoot();
        await writeFile(join(root, 'acceptance.md'), [
            '| ID | Scenario | Status | Artifact | Notes |',
            '|---|---|---|---|---|',
            '| FV-6 | Sidebar | captured | `screenshots/fv6-cards-sidebar.png` | Needs screenshot. |',
            '| FV-10 | Agent RAG | headless-only | `functional_validation_headless_report.md` | Headless report. |',
        ].join('\n'));
        await writeFile(join(root, 'functional_validation_headless_report.md'), '# report\n');

        const result = await checkAcceptanceResults(join(root, 'acceptance.md'), root);

        expect(result.rows).toHaveLength(2);
        expect(result.missingArtifacts).toEqual([
            {
                id: 'FV-6',
                status: 'captured',
                artifact: 'screenshots/fv6-cards-sidebar.png'
            }
        ]);
        expect(result.readyForTodoCompletion).toBe(false);
    });

    test('accepts captured and headless rows when artifacts exist', async () => {
        const root = await makeFixtureRoot();
        await mkdir(join(root, 'screenshots'), { recursive: true });
        await writeFile(join(root, 'screenshots', 'fv6-cards-sidebar.png'), 'fake png');
        await writeFile(join(root, 'functional_validation_headless_report.md'), '# report\n');
        await writeFile(join(root, 'acceptance.md'), [
            '| ID | Scenario | Status | Artifact | Notes |',
            '|---|---|---|---|---|',
            '| FV-6 | Sidebar | captured | `screenshots/fv6-cards-sidebar.png` | Demo cards visible. |',
            '| FV-10 | Agent RAG | headless-only | `functional_validation_headless_report.md` | Headless report. |',
        ].join('\n'));

        const result = await checkAcceptanceResults(join(root, 'acceptance.md'), root);

        expect(result.missingArtifacts).toEqual([]);
        expect(result.unresolvedRows).toEqual([]);
        expect(result.readyForTodoCompletion).toBe(true);
    });

    test('resolves default acceptance paths from the prototype repository directory', () => {
        const paths = resolveDefaultAcceptancePaths('/workspace/project/collaboration-tools');

        expect(paths.workspaceRoot).toBe('/workspace/project');
        expect(paths.resultsPath).toBe('/workspace/project/experiment_artifacts/extension_host_acceptance_results.md');
        expect(paths.logPath).toBe('/workspace/project/experiment_artifacts/functional_validation_log.md');
        expect(paths.artifactRoot).toBe('/workspace/project');
    });

    test('resolves default acceptance paths from the workspace root directory', () => {
        const paths = resolveDefaultAcceptancePaths('/workspace/project');

        expect(paths.workspaceRoot).toBe('/workspace/project');
        expect(paths.resultsPath).toBe('/workspace/project/experiment_artifacts/extension_host_acceptance_results.md');
        expect(paths.logPath).toBe('/workspace/project/experiment_artifacts/functional_validation_log.md');
        expect(paths.artifactRoot).toBe('/workspace/project');
    });

    test('reports status conflicts between acceptance results and the functional validation log', async () => {
        const root = await makeFixtureRoot();
        const acceptancePath = join(root, 'acceptance.md');
        const logPath = join(root, 'functional_validation_log.md');
        await writeFile(acceptancePath, [
            '| ID | Scenario | Status | Artifact | Notes |',
            '|---|---|---|---|---|',
            '| FV-6 | Sidebar | captured | `screenshots/fv6-cards-sidebar.png` | Screenshot exists. |',
            '| FV-10 | Agent RAG | headless-only | `functional_validation_headless_report.md` | Headless report. |',
        ].join('\n'));
        await writeFile(logPath, [
            '| ID | Scenario | Status | Artifact | Observation notes |',
            '|---|---|---|---|---|',
            '| FV-6 | Cards sidebar | not captured | `screenshots/fv6-cards-sidebar.png` | Still pending. |',
            '| FV-10 | Agent RAG | headless-only | `functional_validation_headless_report.md` | Headless report. |',
        ].join('\n'));

        const consistency = await checkEvidenceLedgerConsistency(acceptancePath, logPath);

        expect(consistency.conflicts).toEqual([
            {
                id: 'FV-6',
                acceptanceStatus: 'captured',
                logStatus: 'not captured'
            }
        ]);
        expect(consistency.isConsistent).toBe(false);
    });

    test('does not report manual evidence as ready when ledgers conflict', async () => {
        const root = await makeFixtureRoot();
        const acceptancePath = join(root, 'acceptance.md');
        const logPath = join(root, 'functional_validation_log.md');
        await mkdir(join(root, 'screenshots'), { recursive: true });
        await writeFile(join(root, 'screenshots', 'fv6-cards-sidebar.png'), 'fake png');
        await writeFile(acceptancePath, [
            '| ID | Scenario | Status | Artifact | Notes |',
            '|---|---|---|---|---|',
            '| FV-6 | Sidebar | captured | `screenshots/fv6-cards-sidebar.png` | Screenshot exists. |',
        ].join('\n'));
        await writeFile(logPath, [
            '| ID | Scenario | Status | Artifact | Observation notes |',
            '|---|---|---|---|---|',
            '| FV-6 | Cards sidebar | not captured | `screenshots/fv6-cards-sidebar.png` | Still pending. |',
        ].join('\n'));

        const readiness = await checkManualEvidenceReadiness(acceptancePath, logPath, root);

        expect(readiness.acceptance.readyForTodoCompletion).toBe(true);
        expect(readiness.consistency.isConsistent).toBe(false);
        expect(readiness.readyForTodoCompletion).toBe(false);
    });

    test('strict report exits non-zero when manual evidence is not ready', async () => {
        const root = await makeFixtureRoot();
        const acceptancePath = join(root, 'acceptance.md');
        const logPath = join(root, 'functional_validation_log.md');
        await writeFile(acceptancePath, [
            '| ID | Scenario | Status | Artifact | Notes |',
            '|---|---|---|---|---|',
            '| FV-6 | Sidebar | pending | `screenshots/fv6-cards-sidebar.png` | Needs screenshot. |',
        ].join('\n'));
        await writeFile(logPath, [
            '| ID | Scenario | Status | Artifact | Observation notes |',
            '|---|---|---|---|---|',
            '| FV-6 | Cards sidebar | not captured | `screenshots/fv6-cards-sidebar.png` | Still pending. |',
        ].join('\n'));

        const readiness = await checkManualEvidenceReadiness(acceptancePath, logPath, root);
        const normal = formatReadinessReport(readiness, { strict: false });
        const strict = formatReadinessReport(readiness, { strict: true });

        expect(normal.exitCode).toBe(0);
        expect(strict.exitCode).toBe(1);
        expect(strict.lines).toContain('Ready for To Do completion: no');
    });
});

async function makeFixtureRoot(): Promise<string> {
    return await mkdtemp(join(tmpdir(), 'oct-acceptance-check-'));
}
