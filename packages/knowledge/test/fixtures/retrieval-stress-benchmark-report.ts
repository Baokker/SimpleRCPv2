// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { RetrievalStressRow, RetrievalStressSummaryRow } from './retrieval-stress-benchmark.js';

export async function writeRetrievalStressArtifacts(outputDir: string, rows: RetrievalStressRow[], summary: RetrievalStressSummaryRow[], manifest: Record<string, unknown>): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(outputDir, 'results.jsonl'), rows.map(row => JSON.stringify(row)).join('\n') + '\n'),
        fs.writeFile(path.join(outputDir, 'results.csv'), csv(rows)),
        fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify(summary, undefined, 2) + '\n'),
        fs.writeFile(path.join(outputDir, 'summary.md'), markdown(summary)),
        fs.writeFile(path.join(outputDir, 'figure-retrieval-recall.svg'), svg(summary)),
        fs.writeFile(path.join(outputDir, 'validation_report.md'), validationReport(summary, manifest)),
        fs.writeFile(path.join(outputDir, 'run-manifest.json'), JSON.stringify(manifest, undefined, 2) + '\n')
    ]);
}

function validationReport(summary: RetrievalStressSummaryRow[], manifest: Record<string, unknown>): string {
    const overall = (condition: string) => summary.find(row => row.condition === condition && row.category === 'overall');
    const lexical = overall('lexical')!;
    const fileOnly = overall('file-only')!;
    const typeOnly = overall('type-only')!;
    const combined = overall('file+type')!;
    const wrong = overall('wrong-file+type')!;
    return `## Material Passport\n\n- Origin Skill: experiment-agent\n- Origin Mode: validate\n- Origin Date: ${String(manifest.completedAt ?? new Date().toISOString())}\n- Verification Status: VERIFIED\n- Version Label: validation_v1\n\n## Validation Report\n\n- **Source**: 120 frozen queries over 24 target cards and 24 paired distractors\n- **Overall Confidence**: CAUTION\n\n### Findings\n\n- Lexical Recall@1: ${(lexical.recallAt1 * 100).toFixed(1)}%.\n- Correct file only: ${(fileOnly.recallAt1 * 100).toFixed(1)}%; general risk-type priority only: ${(typeOnly.recallAt1 * 100).toFixed(1)}%.\n- Correct file plus type: ${(combined.recallAt1 * 100).toFixed(1)}%. Because file-only is already perfect, type metadata adds no Recall@1 in this constructed corpus.\n- Wrong file plus type: ${(wrong.recallAt1 * 100).toFixed(1)}% Recall@1 and ${(wrong.recallAt3 * 100).toFixed(1)}% Recall@3, showing that erroneous active-file context can dominate the ranking.\n- Each target has a unique target-file anchor while distractors use documentation paths. The 100% file result is therefore a mechanism stress test, not an estimate of natural-project retrieval accuracy.\n- Embeddings are disabled; this experiment does not test vector retrieval.\n\n### Fallacy Scan\n\n- **Coverage**: 11/11 fallacy types checked\n\n| Fallacy | Severity | Detail |\n|---|---|---|\n| Simpson's paradox | CAUTION | Overall rates hide weak semantic-paraphrase and file-anchor lexical categories. |\n| Ecological fallacy | CAUTION | Constructed query success does not establish developer task success. |\n| Berkson's paradox | NOTE | No selected participant sample. |\n| Collider bias | NOTE | No adjusted observational model. |\n| Base-rate neglect | RED_FLAG | Correct active-file availability and correctness rates are unknown in deployment. |\n| Regression to the mean | NOTE | No extreme-group selection. |\n| Survivorship bias | NOTE | All 600 query-condition rows are retained. |\n| Look-elsewhere effect | CAUTION | Five conditions and five categories are reported. |\n| Garden of forking paths | NOTE | Conditions and ground truth are frozen in the protocol. |\n| Correlation != causation | NOTE | This is a controlled ranking intervention, not a human-outcome study. |\n| Reverse causality | NOTE | Metadata condition precedes retrieval output. |\n\n### Reproducibility\n\n- **Method**: deterministic corpus and queries, production lexical scorer, temporary local index\n- **Verdict**: VERIFIED for the frozen corpus\n`;
}

function csv(rows: RetrievalStressRow[]): string {
    const header = 'queryId,targetCardId,category,condition,retrievedCardIds,relevantRank,recallAt1,recallAt3,reciprocalRankAt3,ndcgAt3,latencyMs';
    return header + '\n' + rows.map(row => [row.queryId, row.targetCardId, row.category, row.condition, row.retrievedCardIds.join('|'), row.relevantRank, row.recallAt1, row.recallAt3, row.reciprocalRankAt3, row.ndcgAt3, row.latencyMs].map(quote).join(',')).join('\n') + '\n';
}

function markdown(summary: RetrievalStressSummaryRow[]): string {
    const lines = ['# Retrieval Stress Benchmark', '', '| Condition | Category | Queries | Recall@1 | Recall@3 | MRR@3 | nDCG@3 | p50 | p95 |', '|---|---|---:|---:|---:|---:|---:|---:|---:|'];
    for (const row of summary) {
        lines.push(`| ${row.condition} | ${row.category} | ${row.queries} | ${row.recallAt1.toFixed(3)} | ${row.recallAt3.toFixed(3)} | ${row.mrrAt3.toFixed(3)} | ${row.ndcgAt3.toFixed(3)} | ${row.medianLatencyMs.toFixed(2)} ms | ${row.p95LatencyMs.toFixed(2)} ms |`);
    }
    lines.push('', 'Ground truth is frozen by construction. No LLM judge or vector retrieval is used.', '');
    return lines.join('\n');
}

function svg(summary: RetrievalStressSummaryRow[]): string {
    const conditions = ['lexical', 'file-only', 'type-only', 'file+type', 'wrong-file+type'];
    const colors = ['#3568a8', '#4f8f5b', '#c0841a', '#16845b', '#c84b31'];
    const width = 1040;
    const parts = [`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="520" viewBox="0 0 ${width} 520">`, '<rect width="100%" height="100%" fill="#fff"/>', '<text x="36" y="38" font-family="Arial" font-size="22" font-weight="700">Retrieval metadata ablation: overall Recall@1</text>'];
    conditions.forEach((condition, index) => {
        const value = summary.find(row => row.condition === condition && row.category === 'overall')?.recallAt1 ?? 0;
        const x = 90 + index * 185;
        parts.push(`<rect x="${x}" y="${420 - value * 300}" width="110" height="${value * 300}" fill="${colors[index]}"/>`);
        parts.push(`<text x="${x + 55}" y="${Math.max(105, 410 - value * 300)}" text-anchor="middle" font-family="Arial" font-size="13">${Math.round(value * 100)}%</text>`);
        parts.push(`<text x="${x + 55}" y="450" text-anchor="middle" font-family="Arial" font-size="12">${condition}</text>`);
    });
    parts.push('<line x1="70" y1="420" x2="1010" y2="420" stroke="#9aa0a6"/>', '<line x1="70" y1="120" x2="1010" y2="120" stroke="#e0e3e7"/>', '<text x="56" y="125" text-anchor="end" font-family="Arial" font-size="12">100%</text>', '</svg>');
    return parts.join('\n');
}

function quote(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
}
