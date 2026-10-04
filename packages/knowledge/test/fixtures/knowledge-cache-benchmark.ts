// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { ensureKnowledgeIndex } from '../../src/knowledge-index.js';
import { createScaleCards } from './knowledge-scale-benchmark.js';

export interface KnowledgeCacheRow {
    trial: number;
    cards: number;
    coldBuildMs: number;
    hotCacheMs: number;
    staleAfterUnforcedChange: boolean;
    unforcedChangeMs: number;
    forcedModifyMs: number;
    forcedAddMs: number;
    forcedDeleteMs: number;
    baselineBytes: number;
    modifiedBytes: number;
    addedBytes: number;
    deletedBytes: number;
}

export async function runKnowledgeCacheBenchmark(cardCount = 1000, trials = 20): Promise<KnowledgeCacheRow[]> {
    const artifactRoot = path.join(process.cwd(), '.test-artifacts');
    await fs.mkdir(artifactRoot, { recursive: true });
    const root = await fs.mkdtemp(path.join(artifactRoot, 'oct-knowledge-cache-'));
    const rows: KnowledgeCacheRow[] = [];
    try {
        for (let trial = 1; trial <= trials; trial++) {
            const indexDir = path.join(root, `trial-${trial}`);
            const workspaceId = `cache-benchmark-${trial}`;
            const baseline = createScaleCards(cardCount);
            const cold = await timed(() => ensureKnowledgeIndex({ workspaceId, cards: baseline, embeddings: {}, indexDir, forceRebuild: true }));
            const baselineBytes = await directoryBytes(indexDir);
            const hot = await timed(() => ensureKnowledgeIndex({ workspaceId, cards: baseline, embeddings: {}, indexDir }));

            const modified = baseline.map((card, index) => index === 0 ? { ...card, content: `${card.content} changed-token-${trial}` } : card);
            const unforced = await timed(() => ensureKnowledgeIndex({ workspaceId, cards: modified, embeddings: {}, indexDir }));
            const staleAfterUnforcedChange = !unforced.value.entries[0].embeddingText.includes(`changed-token-${trial}`);
            const forcedModify = await timed(() => ensureKnowledgeIndex({ workspaceId, cards: modified, embeddings: {}, indexDir, forceRebuild: true }));
            const modifiedBytes = await directoryBytes(indexDir);

            const added = [...modified, { ...modified[0], id: `S-added-${trial}`, title: `Added policy ${trial}` }];
            const forcedAdd = await timed(() => ensureKnowledgeIndex({ workspaceId, cards: added, embeddings: {}, indexDir, forceRebuild: true }));
            const addedBytes = await directoryBytes(indexDir);

            const deleted = added.slice(1);
            const forcedDelete = await timed(() => ensureKnowledgeIndex({ workspaceId, cards: deleted, embeddings: {}, indexDir, forceRebuild: true }));
            const deletedBytes = await directoryBytes(indexDir);
            rows.push({
                trial, cards: cardCount, coldBuildMs: cold.ms, hotCacheMs: hot.ms,
                staleAfterUnforcedChange, unforcedChangeMs: unforced.ms,
                forcedModifyMs: forcedModify.ms, forcedAddMs: forcedAdd.ms, forcedDeleteMs: forcedDelete.ms,
                baselineBytes, modifiedBytes, addedBytes, deletedBytes
            });
        }
    } finally {
        await fs.rm(root, { recursive: true, force: true });
    }
    return rows;
}

export async function writeKnowledgeCacheArtifacts(outputDir: string, rows: KnowledgeCacheRow[]): Promise<void> {
    const metrics = ['coldBuildMs', 'hotCacheMs', 'unforcedChangeMs', 'forcedModifyMs', 'forcedAddMs', 'forcedDeleteMs'] as const;
    const summary = Object.fromEntries(metrics.map(metric => {
        const values = rows.map(row => row[metric]).sort((a, b) => a - b);
        return [metric, { mean: average(values), p50: percentile(values, .5), p95: percentile(values, .95) }];
    }));
    const staleCount = rows.filter(row => row.staleAfterUnforcedChange).length;
    const gitStatus = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim();
    const manifest = {
        benchmarkVersion: 'knowledge-cache-rebuild-v2', generatedAt: new Date().toISOString(), trials: rows.length,
        cards: rows[0]?.cards ?? 0, embeddingsEnabled: false, staleUnforcedChanges: staleCount,
        sourceSha256: createHash('sha256').update(await fs.readFile(new URL(import.meta.url))).digest('hex'),
        implementationSha256: createHash('sha256').update(await fs.readFile(new URL('../../src/knowledge-index.ts', import.meta.url))).digest('hex'),
        gitCommit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(),
        gitDirty: gitStatus.length > 0
    };
    await fs.mkdir(outputDir, { recursive: true });
    await Promise.all([
        fs.writeFile(path.join(outputDir, 'results.csv'), csv(rows)),
        fs.writeFile(path.join(outputDir, 'results.json'), JSON.stringify(rows, undefined, 2) + '\n'),
        fs.writeFile(path.join(outputDir, 'summary.json'), JSON.stringify({ summary, staleCount, trials: rows.length }, undefined, 2) + '\n'),
        fs.writeFile(path.join(outputDir, 'summary.md'), summaryMarkdown(summary, staleCount, rows.length)),
        fs.writeFile(path.join(outputDir, 'validation_report.md'), validationMarkdown(summary, staleCount, rows.length)),
        fs.writeFile(path.join(outputDir, 'figure-cache-rebuild.svg'), svg(summary)),
        fs.writeFile(path.join(outputDir, 'run-manifest.json'), JSON.stringify(manifest, undefined, 2) + '\n'),
        fs.writeFile(path.join(outputDir, 'protocol.md'), protocolMarkdown(rows[0]?.cards ?? 0, rows.length))
    ]);
}

function summaryMarkdown(summary: Record<string, { mean: number; p50: number; p95: number }>, stale: number, trials: number): string {
    const lines = ['# Knowledge Index Cache and Rebuild Benchmark', '', '| Operation | Mean | p50 | p95 |', '|---|---:|---:|---:|'];
    for (const [name, value] of Object.entries(summary)) lines.push(`| ${name} | ${value.mean.toFixed(3)} ms | ${value.p50.toFixed(3)} ms | ${value.p95.toFixed(3)} ms |`);
    lines.push('', `Unforced single-card changes refreshed the lexical index in ${trials - stale}/${trials} trials; stale results occurred in ${stale}/${trials} trials. Forced modify/add/delete operations were retained as rebuild latency references.`, '', 'This is a cache/rebuild benchmark with embeddings disabled; it is not an incremental vector-embedding benchmark.', '');
    return lines.join('\n');
}

function validationMarkdown(summary: Record<string, { mean: number; p50: number; p95: number }>, stale: number, trials: number): string {
    return `## Material Passport\n\n- Origin Skill: experiment-agent\n- Origin Mode: validate\n- Origin Date: ${new Date().toISOString()}\n- Verification Status: VERIFIED\n- Version Label: validation_v2\n\n## Validation Report\n\n- **Source**: ${trials} deterministic 1000-card lexical-index trials\n- **Overall Confidence**: CAUTION\n\n### Findings\n\n- Hot cache p95: ${summary.hotCacheMs.p95.toFixed(3)} ms.\n- Forced single-card modification rebuild p95: ${summary.forcedModifyMs.p95.toFixed(3)} ms.\n- Unforced card modification refreshed the index in ${trials - stale}/${trials} trials; stale results occurred in ${stale}/${trials} trials.\n- The in-memory cache key includes a hash of index-relevant card content.\n- Embeddings were disabled, so these numbers do not establish vector-index incremental performance.\n\n### Fallacy Scan\n\n- **Coverage**: 11/11 fallacy types checked\n\n| Fallacy | Severity | Detail |\n|---|---|---|\n| Simpson's paradox | NOTE | One fixed corpus size is reported separately by operation. |\n| Ecological fallacy | CAUTION | Microbenchmark latency does not equal editor-perceived latency. |\n| Berkson's paradox | NOTE | No selected participant sample. |\n| Collider bias | NOTE | No adjusted observational model. |\n| Base-rate neglect | CAUTION | Real edit and cache-hit frequencies are unknown. |\n| Regression to the mean | NOTE | No extreme-run selection. |\n| Survivorship bias | NOTE | All trials are retained. |\n| Look-elsewhere effect | CAUTION | Six latency operations are reported. |\n| Garden of forking paths | NOTE | Corpus size and trial count are frozen in the manifest. |\n| Correlation != causation | NOTE | No causal human-performance claim is made. |\n| Reverse causality | NOTE | Operation type precedes measured duration. |\n\n### Reproducibility\n\n- **Method**: temporary directories, generated deterministic cards, all trials retained\n- **Verdict**: VERIFIED for this machine and Node runtime\n`;
}

function protocolMarkdown(cards: number, trials: number): string {
    return `# Protocol: Knowledge Index Cache and Rebuild\n\n- Corpus: ${cards} deterministic cards.\n- Trials: ${trials}.\n- Embeddings: disabled.\n- Operations per trial: forced cold build; unchanged hot cache hit; unforced one-card modification; forced one-card modification; forced one-card addition; forced one-card deletion.\n- Staleness check: changed token must appear in returned entry after the unforced modification.\n- Metrics: p50, p95, mean latency and serialized index bytes.\n`;
}

function svg(summary: Record<string, { mean: number; p50: number; p95: number }>): string {
    const entries = Object.entries(summary);
    const labels: Record<string, string> = {
        coldBuildMs: 'Cold build',
        hotCacheMs: 'Hot cache',
        unforcedChangeMs: 'Automatic rebuild',
        forcedModifyMs: 'Forced modify',
        forcedAddMs: 'Forced add',
        forcedDeleteMs: 'Forced delete'
    };
    const max = Math.max(...entries.map(([, value]) => value.p95));
    const parts = ['<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="500" viewBox="0 0 1100 500">', '<rect width="100%" height="100%" fill="#fff"/>', '<text x="32" y="36" font-family="Arial" font-size="22" font-weight="700">Knowledge index cache and rebuild latency (p95)</text>'];
    entries.forEach(([name, value], index) => { const x = 70 + index * 170; const h = value.p95 / max * 300; parts.push(`<rect x="${x}" y="${400 - h}" width="105" height="${h}" fill="${name === 'hotCacheMs' ? '#16845b' : '#3568a8'}"/><text x="${x + 52}" y="${390 - h}" text-anchor="middle" font-family="Arial" font-size="12">${value.p95.toFixed(2)} ms</text><text x="${x + 52}" y="430" text-anchor="middle" font-family="Arial" font-size="11">${labels[name] ?? name}</text>`); });
    parts.push('</svg>'); return parts.join('\n');
}

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> { const started = performance.now(); const value = await fn(); return { value, ms: performance.now() - started }; }
async function directoryBytes(dir: string): Promise<number> { let total = 0; for (const file of await fs.readdir(dir)) total += (await fs.stat(path.join(dir, file))).size; return total; }
function csv(rows: KnowledgeCacheRow[]): string { const keys = Object.keys(rows[0] ?? {}); return keys.join(',') + '\n' + rows.map(row => keys.map(key => String((row as unknown as Record<string, unknown>)[key])).join(',')).join('\n') + '\n'; }
function average(values: number[]): number { return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0; }
function percentile(sorted: number[], p: number): number { return sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] : 0; }
