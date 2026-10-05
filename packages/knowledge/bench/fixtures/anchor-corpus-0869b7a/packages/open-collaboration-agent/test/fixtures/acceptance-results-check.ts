// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { access, readFile } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';

export interface AcceptanceRow {
    id: string;
    scenario: string;
    status: string;
    artifact: string;
    notes: string;
}

export interface MissingAcceptanceArtifact {
    id: string;
    status: string;
    artifact: string;
}

export interface AcceptanceResultsCheck {
    rows: AcceptanceRow[];
    missingArtifacts: MissingAcceptanceArtifact[];
    unresolvedRows: AcceptanceRow[];
    readyForTodoCompletion: boolean;
}

export interface EvidenceLedgerConflict {
    id: string;
    acceptanceStatus: string;
    logStatus: string;
}

export interface EvidenceLedgerConsistency {
    conflicts: EvidenceLedgerConflict[];
    isConsistent: boolean;
}

export interface DefaultAcceptancePaths {
    workspaceRoot: string;
    resultsPath: string;
    logPath: string;
    artifactRoot: string;
}

export interface ManualEvidenceReadiness {
    acceptance: AcceptanceResultsCheck;
    consistency: EvidenceLedgerConsistency;
    readyForTodoCompletion: boolean;
}

export interface ReadinessReportOptions {
    strict: boolean;
}

export interface ReadinessReport {
    lines: string[];
    exitCode: number;
}

const evidenceStatuses = new Set(['captured', 'headless-only']);
const unresolvedStatuses = new Set(['pending', 'failed', 'skipped', 'not captured']);

export async function checkAcceptanceResults(resultsPath: string, artifactRoot: string): Promise<AcceptanceResultsCheck> {
    const content = await readFile(resultsPath, 'utf-8');
    const rows = parseAcceptanceRows(content);
    const rowsNeedingArtifacts = rows.filter(row => evidenceStatuses.has(row.status));
    const missingArtifacts: MissingAcceptanceArtifact[] = [];

    for (const row of rowsNeedingArtifacts) {
        if (!(await fileExists(resolveArtifactPath(row.artifact, artifactRoot)))) {
            missingArtifacts.push({
                id: row.id,
                status: row.status,
                artifact: row.artifact
            });
        }
    }

    const unresolvedRows = rows.filter(row => unresolvedStatuses.has(row.status));

    return {
        rows,
        missingArtifacts,
        unresolvedRows,
        readyForTodoCompletion: missingArtifacts.length === 0 && unresolvedRows.length === 0
    };
}

export function parseAcceptanceRows(content: string): AcceptanceRow[] {
    return content
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.startsWith('|') && !line.includes('---'))
        .map(line => line.slice(1, -1).split('|').map(cell => cell.trim()))
        .filter(cells => cells.length >= 5 && cells[0] !== 'ID')
        .map(([id, scenario, status, artifact, notes]) => ({
            id,
            scenario,
            status: normalizeStatus(status),
            artifact: stripMarkdownCode(artifact),
            notes
        }));
}

export async function checkEvidenceLedgerConsistency(
    acceptanceResultsPath: string,
    functionalValidationLogPath: string
): Promise<EvidenceLedgerConsistency> {
    const acceptanceRows = parseAcceptanceRows(await readFile(acceptanceResultsPath, 'utf-8'));
    const logRows = parseAcceptanceRows(await readFile(functionalValidationLogPath, 'utf-8'));
    const logRowsById = new Map(logRows.map(row => [row.id, row]));
    const conflicts: EvidenceLedgerConflict[] = [];

    for (const acceptanceRow of acceptanceRows) {
        const logRow = logRowsById.get(acceptanceRow.id);
        if (logRow && isStatusConflict(acceptanceRow.status, logRow.status)) {
            conflicts.push({
                id: acceptanceRow.id,
                acceptanceStatus: acceptanceRow.status,
                logStatus: logRow.status
            });
        }
    }

    return {
        conflicts,
        isConsistent: conflicts.length === 0
    };
}

export async function checkManualEvidenceReadiness(
    acceptanceResultsPath: string,
    functionalValidationLogPath: string,
    artifactRoot: string
): Promise<ManualEvidenceReadiness> {
    const acceptance = await checkAcceptanceResults(acceptanceResultsPath, artifactRoot);
    const consistency = await checkEvidenceLedgerConsistency(acceptanceResultsPath, functionalValidationLogPath);

    return {
        acceptance,
        consistency,
        readyForTodoCompletion: acceptance.readyForTodoCompletion && consistency.isConsistent
    };
}

export function formatReadinessReport(
    result: ManualEvidenceReadiness,
    options: ReadinessReportOptions
): ReadinessReport {
    const lines: string[] = [
        `Acceptance rows: ${result.acceptance.rows.length}`,
        `Missing evidence artifacts: ${result.acceptance.missingArtifacts.length}`
    ];

    for (const row of result.acceptance.missingArtifacts) {
        lines.push(`- ${row.id} (${row.status}): ${row.artifact}`);
    }

    lines.push(`Unresolved rows: ${result.acceptance.unresolvedRows.length}`);
    for (const row of result.acceptance.unresolvedRows) {
        lines.push(`- ${row.id} (${row.status}): ${row.scenario}`);
    }

    lines.push(`Evidence ledger conflicts: ${result.consistency.conflicts.length}`);
    for (const conflict of result.consistency.conflicts) {
        lines.push(`- ${conflict.id}: acceptance=${conflict.acceptanceStatus}, log=${conflict.logStatus}`);
    }

    lines.push(`Ready for To Do completion: ${result.readyForTodoCompletion ? 'yes' : 'no'}`);

    return {
        lines,
        exitCode: options.strict && !result.readyForTodoCompletion ? 1 : 0
    };
}

export function resolveDefaultAcceptancePaths(cwd: string): DefaultAcceptancePaths {
    const workspaceRoot = basename(cwd) === 'collaboration-tools' ? join(cwd, '..') : cwd;
    return {
        workspaceRoot,
        resultsPath: join(workspaceRoot, 'experiment_artifacts', 'extension_host_acceptance_results.md'),
        logPath: join(workspaceRoot, 'experiment_artifacts', 'functional_validation_log.md'),
        artifactRoot: workspaceRoot
    };
}

function isStatusConflict(acceptanceStatus: string, logStatus: string): boolean {
    if (!evidenceStatuses.has(acceptanceStatus)) {
        return false;
    }
    return !evidenceStatuses.has(logStatus);
}

async function fileExists(path: string): Promise<boolean> {
    try {
        await access(path);
        return true;
    } catch {
        return false;
    }
}

function resolveArtifactPath(artifact: string, artifactRoot: string): string {
    if (isAbsolute(artifact)) {
        return artifact;
    }
    return join(artifactRoot, artifact);
}

function normalizeStatus(status: string): string {
    return stripMarkdownCode(status).toLowerCase();
}

function stripMarkdownCode(value: string): string {
    return value.replace(/^`|`$/g, '').trim();
}
