// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { readFile } from 'node:fs/promises';

export interface PaperEvidenceCheck {
    unsafeResultClaims: string[];
    plannedValueCount: number;
    placeholderCount: number;
    hasPlaceholderDisclaimer: boolean;
    readyForSubmission: boolean;
}

export interface PaperEvidenceReportOptions {
    strict: boolean;
}

export interface PaperEvidenceReport {
    lines: string[];
    exitCode: number;
}

const unsafeResultPatterns = [
    'Results show',
    'substantially improves',
    'we evaluated',
    'we conducted',
    'Participants completed',
    'statistically significant',
    'significant improvement',
    'empirical results'
];

export async function checkPaperEvidenceFile(path: string): Promise<PaperEvidenceCheck> {
    return checkPaperEvidenceText(await readFile(path, 'utf-8'));
}

export function checkPaperEvidenceText(content: string): PaperEvidenceCheck {
    const unsafeResultClaims = unsafeResultPatterns.filter(pattern => content.includes(pattern));
    const plannedValueCount = countMatches(content, /\[planned\]/g);
    const placeholderCount = countMatches(content, /placeholder/gi);
    const hasPlaceholderDisclaimer =
        content.includes('Values are placeholders to be replaced by empirical data') ||
        content.includes('placeholder figures must be replaced by real data before submission');

    return {
        unsafeResultClaims,
        plannedValueCount,
        placeholderCount,
        hasPlaceholderDisclaimer,
        readyForSubmission: unsafeResultClaims.length === 0 && plannedValueCount === 0 && placeholderCount === 0
    };
}

export function formatPaperEvidenceReport(
    result: PaperEvidenceCheck,
    options: PaperEvidenceReportOptions = { strict: false }
): PaperEvidenceReport {
    const lines = [
        `Unsafe completed-result claims: ${result.unsafeResultClaims.length}`,
        `Planned value markers: ${result.plannedValueCount}`,
        `Placeholder mentions: ${result.placeholderCount}`,
        `Placeholder disclaimer present: ${result.hasPlaceholderDisclaimer ? 'yes' : 'no'}`,
        `Ready for submission: ${result.readyForSubmission ? 'yes' : 'no'}`
    ];

    for (const claim of result.unsafeResultClaims) {
        lines.push(`- ${claim}`);
    }

    return {
        lines,
        exitCode: result.unsafeResultClaims.length > 0 || (options.strict && !result.readyForSubmission) ? 1 : 0
    };
}

function countMatches(content: string, pattern: RegExp): number {
    return Array.from(content.matchAll(pattern)).length;
}
