// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import {
    ANCHOR_BENCHMARK_EDIT_TYPES,
    ANCHOR_BENCHMARK_METHODS,
    type AnchorBenchmarkCase,
    type AnchorBenchmarkEditSummary,
    type AnchorBenchmarkResult,
    type AnchorBenchmarkSummary,
    type FrozenAnchorSample
} from './anchor-benchmark.js';

export interface AnchorBenchmarkManifest {
    benchmarkVersion: string;
    nodeVersion: string;
    timingIterations: number;
    [key: string]: string | number | boolean | null;
}

export interface AnchorBenchmarkArtifacts {
    corpus: FrozenAnchorSample[];
    cases: AnchorBenchmarkCase[];
    results: AnchorBenchmarkResult[];
    summary: AnchorBenchmarkSummary;
    manifest: AnchorBenchmarkManifest;
}

const OUTCOME_COLORS = {
    correct: '#1f7a4d',
    wrong: '#b42318',
    'review-needed': '#d97706',
    unresolved: '#667085'
} as const;

export function writeAnchorBenchmarkArtifacts(outputDir: string, artifacts: AnchorBenchmarkArtifacts): void {
    mkdirSync(outputDir, { recursive: true });
    const outcomesFigure = renderOutcomeFigure(artifacts.summary);
    const heatmapFigure = renderEditHeatmap(artifacts.summary);
    const latencyFigure = renderLatencyFigure(artifacts.summary);

    write(outputDir, 'corpus.json', json(artifacts.corpus));
    write(outputDir, 'cases.csv', casesCsv(artifacts.cases));
    write(outputDir, 'results.csv', resultsCsv(artifacts.results));
    write(outputDir, 'wrong-cases.csv', resultsCsv(artifacts.results.filter(item => item.outcome === 'wrong')));
    write(outputDir, 'summary.json', json(artifacts.summary));
    write(outputDir, 'summary.md', summaryMarkdown(artifacts));
    write(outputDir, 'figure-anchor-outcomes.svg', outcomesFigure);
    write(outputDir, 'figure-anchor-edit-heatmap.svg', heatmapFigure);
    write(outputDir, 'figure-anchor-latency.svg', latencyFigure);
    write(outputDir, 'report.html', reportHtml(artifacts, outcomesFigure, heatmapFigure, latencyFigure));
    write(outputDir, 'run-manifest.json', json(artifacts.manifest));
}

function casesCsv(cases: AnchorBenchmarkCase[]): string {
    const header = [
        'case_id', 'sample_id', 'category', 'language', 'source_file', 'edit_type', 'expected_action',
        'expected_start', 'expected_end', 'original_length', 'updated_length'
    ];
    const rows = cases.map(item => [
        item.id,
        item.sampleId,
        item.category,
        item.language,
        item.sourceFile,
        item.editType,
        item.expectation.kind,
        item.expectation.kind === 'locate' ? item.expectation.startOffset : '',
        item.expectation.kind === 'locate' ? item.expectation.endOffset : '',
        item.originalText.length,
        item.updatedText.length
    ]);
    return csv([header, ...rows]);
}

function resultsCsv(results: AnchorBenchmarkResult[]): string {
    const header = [
        'case_id', 'sample_id', 'category', 'language', 'source_file', 'edit_type', 'method',
        'expected_action', 'outcome', 'start_offset', 'end_offset', 'confidence', 'duration_us'
    ];
    const rows = results.map(item => [
        item.caseId,
        item.sampleId,
        item.category,
        item.language,
        item.sourceFile,
        item.editType,
        item.method,
        item.expectedAction,
        item.outcome,
        item.startOffset ?? '',
        item.endOffset ?? '',
        item.confidence ?? '',
        item.durationUs.toFixed(6)
    ]);
    return csv([header, ...rows]);
}

function summaryMarkdown(artifacts: AnchorBenchmarkArtifacts): string {
    const { summary, manifest } = artifacts;
    const methodRows = summary.methods.map(method =>
        `| ${method.method} | ${method.outcomes.correct} | ${method.outcomes.wrong} | ${method.outcomes['review-needed']} | ${method.outcomes.unresolved} | ${pct(method.correctRate)} (${pct(method.correctRate95Ci[0])}-${pct(method.correctRate95Ci[1])}) | ${pct(method.wrongRate)} | ${method.latencyP50Us.toFixed(2)} | ${method.latencyP95Us.toFixed(2)} |`
    ).join('\n');
    const mcnemarRows = summary.pairwiseMcNemar.map(test =>
        `| ${test.methodA} vs ${test.methodB} | ${test.aCorrectBWrong} | ${test.aWrongBCorrect} | ${(test.correctRateDifference * 100).toFixed(1)} pp | ${formatP(test.pValue)} |`
    ).join('\n');
    return `## Material Passport

- Origin Skill: academic-research-suite / experiment-agent
- Origin Mode: run + validate
- Verification Status: UNVERIFIED until independent rerun comparison
- Version Label: ${manifest.benchmarkVersion}

## Anchor Robustness Benchmark

- Frozen anchors: ${artifacts.corpus.length}
- Paired edit cases: ${summary.caseCount}
- Locatable cases: ${summary.locatableCaseCount}
- Review-expected deletion cases: ${summary.reviewExpectedCaseCount}
- Methods: ${ANCHOR_BENCHMARK_METHODS.join(', ')}

### Method Results

| Method | Correct | Wrong | Review-needed | Unresolved | Correct rate on locatable cases (95% CI) | Wrong rate, all cases | p50 us | p95 us |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
${methodRows}

### Paired Tests

- Cochran's Q(${summary.cochranQ.df}) = ${summary.cochranQ.statistic.toFixed(3)}, p ${formatP(summary.cochranQ.pValue)}.

| Comparison | A correct / B not | A not / B correct | Correct-rate difference | Exact McNemar p |
|---|---:|---:|---:|---:|
${mcnemarRows}

### Interpretation Boundary

The corpus is a deterministic micro-benchmark derived from one repository snapshot. Confidence intervals and paired tests describe this benchmark corpus; they do not establish general performance across all languages, repositories, or edit histories. Timing is environment-sensitive and should be compared descriptively.
`;
}

function renderOutcomeFigure(summary: AnchorBenchmarkSummary): string {
    const width = 960;
    const height = 540;
    const plot = { left: 105, top: 90, width: 760, height: 330 };
    const barWidth = 130;
    const gap = 105;
    const parts = svgStart(width, height, 'Anchor outcomes by strategy');
    parts.push(textNode(40, 42, 'Anchor relocation outcomes by strategy', 24, '#101828', '700'));
    parts.push(textNode(40, 70, `${summary.caseCount} paired cases; correct rate is evaluated on ${summary.locatableCaseCount} locatable cases`, 14, '#475467'));
    for (let tick = 0; tick <= 4; tick++) {
        const ratio = tick / 4;
        const y = plot.top + plot.height * (1 - ratio);
        parts.push(`<line x1="${plot.left}" y1="${y}" x2="${plot.left + plot.width}" y2="${y}" stroke="#e4e7ec"/>`);
        parts.push(textNode(plot.left - 14, y + 5, `${Math.round(ratio * 100)}%`, 12, '#667085', '400', 'end'));
    }
    summary.methods.forEach((method, index) => {
        const x = plot.left + 70 + index * (barWidth + gap);
        let y = plot.top + plot.height;
        for (const outcome of ['correct', 'wrong', 'review-needed', 'unresolved'] as const) {
            const count = method.outcomes[outcome];
            const segmentHeight = method.total ? plot.height * count / method.total : 0;
            y -= segmentHeight;
            parts.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${segmentHeight}" fill="${OUTCOME_COLORS[outcome]}"/>`);
            if (segmentHeight >= 24) {
                parts.push(textNode(x + barWidth / 2, y + segmentHeight / 2 + 5, `${count} (${pct(count / method.total)})`, 12, '#ffffff', '700', 'middle'));
            }
        }
        parts.push(textNode(x + barWidth / 2, plot.top + plot.height + 28, method.method, 14, '#344054', '600', 'middle'));
    });
    const legendY = 488;
    (['correct', 'wrong', 'review-needed', 'unresolved'] as const).forEach((outcome, index) => {
        const x = 190 + index * 155;
        parts.push(`<rect x="${x}" y="${legendY - 13}" width="16" height="16" fill="${OUTCOME_COLORS[outcome]}"/>`);
        parts.push(textNode(x + 24, legendY, outcome, 13, '#344054'));
    });
    return parts.join('') + '</svg>\n';
}

function renderEditHeatmap(summary: AnchorBenchmarkSummary): string {
    const width = 1040;
    const height = 620;
    const left = 260;
    const top = 105;
    const cellWidth = 220;
    const cellHeight = 62;
    const parts = svgStart(width, height, 'Anchor correctness by edit type');
    parts.push(textNode(40, 42, 'Correct relocation rate by edit type', 24, '#101828', '700'));
    parts.push(textNode(40, 70, 'Deletion cells report review-needed or wrong outcomes instead of a relocation rate', 14, '#475467'));
    ANCHOR_BENCHMARK_METHODS.forEach((method, column) => {
        parts.push(textNode(left + column * cellWidth + cellWidth / 2, top - 22, method, 14, '#344054', '600', 'middle'));
    });
    ANCHOR_BENCHMARK_EDIT_TYPES.forEach((editType, row) => {
        const y = top + row * cellHeight;
        parts.push(textNode(left - 18, y + cellHeight / 2 + 5, editType, 14, '#344054', '500', 'end'));
        ANCHOR_BENCHMARK_METHODS.forEach((method, column) => {
            const cell = summary.byEditType.find(item => item.editType === editType && item.method === method);
            const x = left + column * cellWidth;
            const display = heatmapDisplay(cell);
            parts.push(`<rect x="${x + 2}" y="${y + 2}" width="${cellWidth - 4}" height="${cellHeight - 4}" rx="4" fill="${display.color}"/>`);
            parts.push(textNode(x + cellWidth / 2, y + cellHeight / 2 + 5, display.label, 13, display.textColor, '700', 'middle'));
        });
    });
    return parts.join('') + '</svg>\n';
}

function renderLatencyFigure(summary: AnchorBenchmarkSummary): string {
    const width = 960;
    const height = 520;
    const plot = { left: 105, top: 95, width: 760, height: 300 };
    const maxValue = Math.max(1, ...summary.methods.flatMap(item => [item.latencyP50Us, item.latencyP95Us]));
    const parts = svgStart(width, height, 'Anchor strategy latency');
    parts.push(textNode(40, 42, 'Resolver latency by strategy', 24, '#101828', '700'));
    parts.push(textNode(40, 70, 'Microseconds per call; environment-sensitive descriptive measurement', 14, '#475467'));
    for (let tick = 0; tick <= 4; tick++) {
        const ratio = tick / 4;
        const y = plot.top + plot.height * (1 - ratio);
        parts.push(`<line x1="${plot.left}" y1="${y}" x2="${plot.left + plot.width}" y2="${y}" stroke="#e4e7ec"/>`);
        parts.push(textNode(plot.left - 14, y + 5, (maxValue * ratio).toFixed(1), 12, '#667085', '400', 'end'));
    }
    summary.methods.forEach((method, index) => {
        const groupX = plot.left + 100 + index * 235;
        const bars = [
            { label: 'p50', value: method.latencyP50Us, color: '#175cd3' },
            { label: 'p95', value: method.latencyP95Us, color: '#e04f16' }
        ];
        bars.forEach((bar, barIndex) => {
            const barHeight = plot.height * bar.value / maxValue;
            const x = groupX + barIndex * 66;
            const y = plot.top + plot.height - barHeight;
            parts.push(`<rect x="${x}" y="${y}" width="52" height="${barHeight}" fill="${bar.color}"/>`);
            parts.push(textNode(x + 26, Math.max(plot.top + 13, y - 8), bar.value.toFixed(2), 11, '#344054', '600', 'middle'));
        });
        parts.push(textNode(groupX + 59, plot.top + plot.height + 30, method.method, 14, '#344054', '600', 'middle'));
    });
    parts.push(`<rect x="350" y="458" width="16" height="16" fill="#175cd3"/>${textNode(374, 471, 'p50', 13, '#344054')}`);
    parts.push(`<rect x="480" y="458" width="16" height="16" fill="#e04f16"/>${textNode(504, 471, 'p95', 13, '#344054')}`);
    return parts.join('') + '</svg>\n';
}

function reportHtml(
    artifacts: AnchorBenchmarkArtifacts,
    outcomesFigure: string,
    heatmapFigure: string,
    latencyFigure: string
): string {
    const methodRows = artifacts.summary.methods.map(method => `<tr>
        <td><code>${method.method}</code></td><td>${method.outcomes.correct}</td><td>${method.outcomes.wrong}</td>
        <td>${method.outcomes['review-needed']}</td><td>${method.outcomes.unresolved}</td>
        <td>${pct(method.correctRate)} <span class="muted">[${pct(method.correctRate95Ci[0])}, ${pct(method.correctRate95Ci[1])}]</span></td>
        <td>${pct(method.wrongRate)}</td><td>${method.latencyP50Us.toFixed(2)}</td><td>${method.latencyP95Us.toFixed(2)}</td>
    </tr>`).join('');
    return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Anchor Robustness Benchmark</title><style>
:root{color-scheme:light;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#101828;background:#f8fafc}*{box-sizing:border-box}body{margin:0}header{background:#fff;border-bottom:1px solid #d0d5dd;padding:34px max(24px,calc((100vw - 1180px)/2)) 30px}main{max-width:1180px;margin:0 auto;padding:28px 24px 60px}h1{font-size:32px;margin:0 0 10px;letter-spacing:0}h2{font-size:21px;margin:0 0 18px;letter-spacing:0}.lede{max-width:860px;color:#475467;margin:0;line-height:1.55}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border:1px solid #d0d5dd;background:#fff;margin:26px 0}.metric{padding:18px;border-right:1px solid #d0d5dd}.metric:last-child{border-right:0}.metric strong{display:block;font-size:28px}.metric span{color:#667085;font-size:13px}section{margin-top:34px}figure{margin:0;background:#fff;border:1px solid #d0d5dd;padding:16px;overflow:auto}figure svg{width:100%;min-width:760px;height:auto;display:block}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d0d5dd;font-size:13px}th,td{padding:11px 10px;border-bottom:1px solid #e4e7ec;text-align:right;white-space:nowrap}th:first-child,td:first-child{text-align:left}th{background:#f2f4f7;color:#344054}.muted{color:#667085}.note{border-left:4px solid #d97706;padding:12px 16px;background:#fffaeb;line-height:1.55;color:#7a2e0e}code{font-family:"SFMono-Regular",Consolas,monospace}@media(max-width:760px){.metrics{grid-template-columns:1fr 1fr}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid #d0d5dd}header{padding:24px}main{padding:20px 16px}.table-wrap{overflow:auto}}
</style></head><body><header><h1>Anchor Robustness Benchmark</h1><p class="lede">Deterministic paired micro-benchmark comparing fixed ranges, unique snapshots, and the prototype's lightweight multi-strategy resolver. The corpus is frozen from real repository files; ground truth is produced by controlled transformations rather than an AI judge.</p></header><main>
<div class="metrics"><div class="metric"><strong>${artifacts.corpus.length}</strong><span>frozen anchors</span></div><div class="metric"><strong>${artifacts.summary.caseCount}</strong><span>paired edit cases</span></div><div class="metric"><strong>7</strong><span>edit types</span></div><div class="metric"><strong>3</strong><span>strategies</span></div></div>
<section><h2>Overall outcomes</h2><figure>${outcomesFigure}</figure></section>
<section><h2>Per-edit correctness</h2><figure>${heatmapFigure}</figure></section>
<section><h2>Latency</h2><figure>${latencyFigure}</figure></section>
<section><h2>Method summary</h2><div class="table-wrap"><table><thead><tr><th>Method</th><th>Correct</th><th>Wrong</th><th>Review</th><th>Unresolved</th><th>Correct rate [95% CI]</th><th>Wrong rate</th><th>p50 us</th><th>p95 us</th></tr></thead><tbody>${methodRows}</tbody></table></div></section>
<section><h2>Statistical boundary</h2><p class="note">Cochran's Q and exact McNemar tests describe paired differences inside this constructed benchmark corpus. They must not be generalized to all repositories or programming languages. Timing values depend on the local machine and runtime.</p></section>
</main></body></html>\n`;
}

function heatmapDisplay(cell: AnchorBenchmarkEditSummary | undefined): { label: string; color: string; textColor: string } {
    if (!cell) {
        return { label: 'missing', color: '#eaecf0', textColor: '#475467' };
    }
    if (cell.correctRate === null) {
        const review = cell.outcomes['review-needed'];
        const wrong = cell.outcomes.wrong;
        return {
            label: review ? `review ${review}/${cell.total}` : wrong ? `wrong ${wrong}/${cell.total}` : `unresolved ${cell.outcomes.unresolved}/${cell.total}`,
            color: review ? '#f79009' : wrong ? '#d92d20' : '#98a2b3',
            textColor: '#ffffff'
        };
    }
    const rate = cell.correctRate;
    const color = rate >= 0.8 ? '#1f7a4d' : rate >= 0.6 ? '#66a96b' : rate >= 0.4 ? '#f3b61f' : rate >= 0.2 ? '#e97828' : '#b42318';
    return { label: pct(rate), color, textColor: rate >= 0.4 && rate < 0.6 ? '#3b2f05' : '#ffffff' };
}

function svgStart(width: number, height: number, label: string): string[] {
    return [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${xml(label)}"><rect width="${width}" height="${height}" fill="#ffffff"/>`];
}

function textNode(
    x: number,
    y: number,
    value: string,
    size: number,
    color: string,
    weight = '400',
    anchor: 'start' | 'middle' | 'end' = 'start'
): string {
    return `<text x="${x}" y="${y}" font-family="Inter, Arial, sans-serif" font-size="${size}" font-weight="${weight}" text-anchor="${anchor}" fill="${color}">${xml(value)}</text>`;
}

function write(outputDir: string, file: string, content: string): void {
    writeFileSync(path.join(outputDir, file), content, 'utf8');
}

function json(value: unknown): string {
    return `${JSON.stringify(value, null, 2)}\n`;
}

function csv(rows: Array<Array<string | number>>): string {
    return `${rows.map(row => row.map(csvCell).join(',')).join('\n')}\n`;
}

function csvCell(value: string | number): string {
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function pct(value: number): string {
    return `${(value * 100).toFixed(1)}%`;
}

function formatP(value: number): string {
    return value < 0.001 ? '< 0.001' : `= ${value.toFixed(3)}`;
}

function xml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}
