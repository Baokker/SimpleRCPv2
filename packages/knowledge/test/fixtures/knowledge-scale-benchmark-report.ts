// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { KnowledgeScaleRow } from './knowledge-scale-benchmark.js';

export async function writeKnowledgeScaleArtifacts(outputDir: string, rows: KnowledgeScaleRow[], manifest: Record<string, unknown>): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(outputDir, 'results.json'), JSON.stringify(rows, undefined, 2) + '\n'),
        fs.writeFile(path.join(outputDir, 'results.csv'), csv(rows)),
        fs.writeFile(path.join(outputDir, 'summary.md'), markdown(rows)),
        fs.writeFile(path.join(outputDir, 'figure-scale-latency.svg'), svg(rows)),
        fs.writeFile(path.join(outputDir, 'run-manifest.json'), JSON.stringify(manifest, undefined, 2) + '\n')
    ]);
}

function csv(rows: KnowledgeScaleRow[]): string {
    const columns: Array<keyof KnowledgeScaleRow> = ['cards', 'buildTrials', 'queries', 'buildP50Ms', 'buildP95Ms', 'searchP50Ms', 'searchP95Ms', 'recallAt1', 'indexBytes', 'heapDeltaBytes'];
    return columns.join(',') + '\n' + rows.map(row => columns.map(key => row[key]).join(',')).join('\n') + '\n';
}

function markdown(rows: KnowledgeScaleRow[]): string {
    const lines = ['# Knowledge Index Scale Benchmark', '', '| Cards | Build p50 | Build p95 | Search p50 | Search p95 | Recall@1 | Index size | Heap delta |', '|---:|---:|---:|---:|---:|---:|---:|---:|'];
    for (const row of rows) lines.push(`| ${row.cards} | ${row.buildP50Ms.toFixed(2)} ms | ${row.buildP95Ms.toFixed(2)} ms | ${row.searchP50Ms.toFixed(2)} ms | ${row.searchP95Ms.toFixed(2)} ms | ${(row.recallAt1 * 100).toFixed(1)}% | ${(row.indexBytes / 1024).toFixed(1)} KiB | ${(row.heapDeltaBytes / 1024 / 1024).toFixed(2)} MiB |`);
    lines.push('', 'Timing and heap deltas are local-machine measurements. The benchmark uses lexical retrieval without embeddings.', '');
    return lines.join('\n');
}

function svg(rows: KnowledgeScaleRow[]): string {
    const max = Math.max(...rows.map(row => row.searchP95Ms), 1);
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="900" height="500" viewBox="0 0 900 500">', '<rect width="100%" height="100%" fill="#fff"/>', '<text x="36" y="38" font-family="Arial" font-size="22" font-weight="700">Lexical retrieval p95 latency by card count</text>'];
    rows.forEach((row, index) => {
        const height = row.searchP95Ms / max * 320;
        const x = 110 + index * 150;
        parts.push(`<rect x="${x}" y="${410 - height}" width="72" height="${height}" fill="#2166ac"/>`);
        parts.push(`<text x="${x + 36}" y="${398 - height}" text-anchor="middle" font-family="Arial" font-size="12">${row.searchP95Ms.toFixed(2)} ms</text>`);
        parts.push(`<text x="${x + 36}" y="440" text-anchor="middle" font-family="Arial" font-size="13">${row.cards} cards</text>`);
    });
    parts.push('<line x1="80" y1="410" x2="850" y2="410" stroke="#9aa0a6"/>', '</svg>');
    return parts.join('\n');
}
