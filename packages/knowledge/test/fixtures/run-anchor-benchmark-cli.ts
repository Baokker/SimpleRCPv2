// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
    collectFrozenAnchorCorpus,
    compareAnchorBenchmarkResults,
    createAnchorBenchmarkCases,
    runAnchorBenchmarkCases,
    summarizeAnchorBenchmark,
    type FrozenAnchorSample
} from './anchor-benchmark.js';
import { writeAnchorBenchmarkArtifacts } from './anchor-benchmark-report.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const args = parseArgs(process.argv.slice(2));
const outputRoot = path.resolve(repoRoot, args.output ?? 'packages/knowledge/bench/results/anchor-cli');
const timingIterations = args.iterations ? Number(args.iterations) : 200;
const corpusPath = path.join(outputRoot, 'corpus.json');
const corpusMode = args.corpus ?? 'frozen';
if (corpusMode !== 'frozen' && corpusMode !== 'current') {
    throw new Error(`--corpus must be frozen or current, received ${corpusMode}`);
}

if (!Number.isInteger(timingIterations) || timingIterations < 1) {
    throw new Error(`--iterations must be a positive integer, received ${args.iterations}`);
}

mkdirSync(outputRoot, { recursive: true });
const corpus = loadOrFreezeCorpus(corpusPath, args.refreshCorpus === 'true', corpusMode);
const cases = createAnchorBenchmarkCases(corpus);
if (cases.length < 300) {
    throw new Error(`Formal benchmark requires at least 300 cases; generated ${cases.length}`);
}

const sharedManifest = {
    benchmarkVersion: 'anchor-benchmark-v1',
    nodeVersion: process.version,
    npmUserAgent: process.env.npm_config_user_agent ?? 'unknown',
    platform: `${process.platform}-${process.arch}`,
    osRelease: os.release(),
    cpu: os.cpus()[0]?.model ?? 'unknown',
    timingIterations,
    warmupIterations: 20,
    frozenAnchorCount: corpus.length,
    pairedCaseCount: cases.length,
    corpusSha256: sha256(JSON.stringify(corpus)),
    gitCommit: git(['rev-parse', 'HEAD']),
    gitDirty: gitDirty()
};

const primaryResults = runAnchorBenchmarkCases(cases, { timingIterations, warmupIterations: 20 });
const primarySummary = summarizeAnchorBenchmark(cases, primaryResults);
writeAnchorBenchmarkArtifacts(outputRoot, {
    corpus,
    cases,
    results: primaryResults,
    summary: primarySummary,
    manifest: { ...sharedManifest, run: 'primary', generatedAt: new Date().toISOString() }
});

const rerunResults = runAnchorBenchmarkCases(cases, { timingIterations, warmupIterations: 20 });
const rerunSummary = summarizeAnchorBenchmark(cases, rerunResults);
writeAnchorBenchmarkArtifacts(path.join(outputRoot, 'rerun'), {
    corpus,
    cases,
    results: rerunResults,
    summary: rerunSummary,
    manifest: { ...sharedManifest, run: 'rerun', generatedAt: new Date().toISOString() }
});

const reproducibility = compareAnchorBenchmarkResults(primaryResults, rerunResults);
writeFileSync(path.join(outputRoot, 'reproducibility.json'), `${JSON.stringify(reproducibility, null, 2)}\n`, 'utf8');
writeFileSync(path.join(outputRoot, 'reproducibility_report.md'), reproducibilityMarkdown(reproducibility), 'utf8');

process.stdout.write([
    `Anchor benchmark completed: ${cases.length} paired cases x 3 methods`,
    `Output: ${outputRoot}`,
    `Reproducibility: ${reproducibility.verdict}`,
    ...primarySummary.methods.map(method =>
        `${method.method}: correct=${(method.correctRate * 100).toFixed(1)}%, wrong=${(method.wrongRate * 100).toFixed(1)}%, p95=${method.latencyP95Us.toFixed(2)}us`
    )
].join('\n') + '\n');

if (reproducibility.verdict !== 'REPRODUCIBLE') {
    process.exitCode = 1;
}

function loadOrFreezeCorpus(file: string, refresh: boolean, mode: 'frozen' | 'current'): FrozenAnchorSample[] {
    if (!refresh && existsSync(file)) {
        const parsed = JSON.parse(readFileSync(file, 'utf8')) as FrozenAnchorSample[];
        if (parsed.length !== 48) {
            throw new Error(`Frozen corpus must contain 48 anchors; found ${parsed.length}`);
        }
        const isFrozen = parsed.every(sample => sample.sourceFile.startsWith('packages/open-collaboration-') || sample.sourceFile === 'package.json');
        if ((mode === 'frozen' && isFrozen) || (mode === 'current' && !isFrozen)) return parsed;
    }
    if (mode === 'frozen') return collectFrozenAnchorCorpus(repoRoot, { fixtureRoot: path.join(repoRoot, 'packages/knowledge/bench/fixtures/anchor-corpus-0869b7a') });
    return collectFrozenAnchorCorpus(repoRoot);
}

function parseArgs(values: string[]): Record<string, string> {
    const parsed: Record<string, string> = {};
    for (let index = 0; index < values.length; index++) {
        const value = values[index];
        if (!value.startsWith('--')) {
            continue;
        }
        const key = value.slice(2).replace(/-([a-z])/g, (_, char: string) => char.toUpperCase());
        const next = values[index + 1];
        if (!next || next.startsWith('--')) {
            parsed[key] = 'true';
        } else {
            parsed[key] = next;
            index++;
        }
    }
    return parsed;
}

function git(arguments_: string[]): string {
    try {
        return execFileSync('git', arguments_, { cwd: repoRoot, encoding: 'utf8' }).trim();
    } catch {
        return 'unknown';
    }
}

function gitDirty(): boolean {
    try {
        execFileSync('git', ['diff', '--quiet'], { cwd: repoRoot });
        execFileSync('git', ['diff', '--cached', '--quiet'], { cwd: repoRoot });
        return git(['ls-files', '--others', '--exclude-standard']).length > 0;
    } catch {
        return true;
    }
}

function sha256(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function reproducibilityMarkdown(result: ReturnType<typeof compareAnchorBenchmarkResults>): string {
    const mismatchRows = result.mismatches.length
        ? result.mismatches.map(item => `| ${item.key} | ${item.field} | ${item.first ?? ''} | ${item.second ?? ''} |`).join('\n')
        : '| - | - | - | - |';
    return `## Material Passport

- Origin Skill: academic-research-suite / experiment-agent
- Origin Mode: validate
- Verification Status: VERIFIED
- Version Label: anchor_benchmark_reproducibility_v1

## Reproducibility Report

- Method: deterministic logical rerun; timing excluded as environment-sensitive
- Verdict: **${result.verdict}**
- Compared rows: ${result.comparedRows}
- Logical mismatches: ${result.mismatches.length}

| Case and method | Field | Primary | Rerun |
|---|---|---|---|
${mismatchRows}
`;
}
