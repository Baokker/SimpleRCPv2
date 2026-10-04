// ******************************************************************************
// Copyright 2026 TypeFox GmbH
// This program and the accompanying materials are made available under the
// terms of the MIT License, which is available in the project root.
// ******************************************************************************

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import type { DraftRunRow } from './capture-quality-benchmark.js';

export async function writeCaptureQualityArtifacts(outputDir: string, data: { triggerSummary: unknown[]; draftRows: DraftRunRow[]; draftSummary: unknown[]; manifest: Record<string, unknown> }): Promise<void> {
    await fs.mkdir(outputDir, { recursive: true });
    const triggerSummary = data.triggerSummary as any[];
    const draftSummary = data.draftSummary as any[];
    await Promise.all([
        fs.writeFile(path.join(outputDir, 'trigger-summary.json'), JSON.stringify(data.triggerSummary, undefined, 2) + '\n'),
        fs.writeFile(path.join(outputDir, 'draft-runs.jsonl'), data.draftRows.map(row => JSON.stringify(row)).join('\n') + '\n'),
        fs.writeFile(path.join(outputDir, 'draft-summary.json'), JSON.stringify(data.draftSummary, undefined, 2) + '\n'),
        fs.writeFile(path.join(outputDir, 'summary.md'), markdown(triggerSummary, draftSummary)),
        fs.writeFile(path.join(outputDir, 'figure-capture-draft-quality.svg'), chart(draftSummary)),
        fs.writeFile(path.join(outputDir, 'validation_report.md'), validationReport(triggerSummary, draftSummary, data.manifest)),
        fs.writeFile(path.join(outputDir, 'run-manifest.json'), JSON.stringify(data.manifest, undefined, 2) + '\n')
    ]);
}

function markdown(trigger: any[], draft: any[]): string {
    const lines = ['# Capture Trigger and Draft Quality Benchmark', '', '## Trigger policy boundary replay', '', '| Trigger | Cases | Precision | Recall | F1 |', '|---|---:|---:|---:|---:|'];
    for (const row of trigger) lines.push(`| ${row.triggerType} | ${row.cases} | ${row.precision.toFixed(3)} | ${row.recall.toFixed(3)} | ${row.f1.toFixed(3)} |`);
    lines.push('', '## LLM draft quality', '', '| Trigger | Runs | Structure | Type | Citations | Evidence token | Grounded pass | Avg tokens | p50 | p95 |', '|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|');
    for (const row of draft) lines.push(`| ${row.triggerType} | ${row.runs} | ${pct(row.validStructureRate)} | ${pct(row.acceptedTypeRate)} | ${pct(row.validCitationRate)} | ${pct(row.mustMentionRate)} | ${pct(row.groundedPassRate)} | ${row.averageTokens.toFixed(1)} | ${row.medianLatencyMs.toFixed(0)} ms | ${row.p95LatencyMs.toFixed(0)} ms |`);
    lines.push('', 'Trigger results measure frozen policy boundaries, not natural-event precision. Draft grounding is checked through valid evidence paths and required evidence tokens; it is not a human semantic-quality score.', '');
    return lines.join('\n');
}

function pct(value: number): string { return `${(value * 100).toFixed(1)}%`; }

function chart(rows: any[]): string {
    const categories = rows.filter(row => row.triggerType !== 'overall');
    const width = 1120;
    const height = 540;
    const left = 90;
    const top = 72;
    const chartHeight = 340;
    const groupWidth = (width - left - 60) / categories.length;
    const barWidth = 44;
    const parts = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="LLM draft quality by capture trigger">`,
        '<rect width="100%" height="100%" fill="#ffffff"/>',
        '<text x="38" y="36" font-family="Arial, sans-serif" font-size="22" font-weight="700" fill="#202124">LLM draft quality by capture trigger</text>',
        '<text x="38" y="58" font-family="Arial, sans-serif" font-size="13" fill="#5f6368">DeepSeek Flash, 10 frozen evidence fixtures per trigger type.</text>'
    ];
    for (let tick = 0; tick <= 4; tick++) {
        const value = tick / 4;
        const y = top + chartHeight - value * chartHeight;
        parts.push(`<line x1="${left}" y1="${y}" x2="${width - 40}" y2="${y}" stroke="#d9dde3"/>`);
        parts.push(`<text x="74" y="${y + 5}" text-anchor="end" font-family="Arial, sans-serif" font-size="13" fill="#5f6368">${Math.round(value * 100)}%</text>`);
    }
    categories.forEach((row, index) => {
        const baseX = left + index * groupWidth + (groupWidth - barWidth * 2 - 14) / 2;
        const values = [
            { value: row.acceptedTypeRate, color: '#c0841a' },
            { value: row.groundedPassRate, color: '#16845b' }
        ];
        values.forEach((metric, metricIndex) => {
            const x = baseX + metricIndex * (barWidth + 14);
            const barHeight = metric.value * chartHeight;
            const y = top + chartHeight - barHeight;
            parts.push(`<rect x="${x}" y="${y}" width="${barWidth}" height="${barHeight}" fill="${metric.color}"/>`);
            parts.push(`<text x="${x + barWidth / 2}" y="${Math.max(top + 14, y - 7)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="12" fill="#202124">${Math.round(metric.value * 100)}%</text>`);
        });
        parts.push(`<text x="${baseX + barWidth + 7}" y="${top + chartHeight + 27}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11" font-weight="700" fill="#202124">${shortLabel(row.triggerType)}</text>`);
    });
    parts.push('<rect x="390" y="478" width="14" height="14" fill="#c0841a"/><text x="411" y="490" font-family="Arial, sans-serif" font-size="13" fill="#3c4043">Accepted card type</text>');
    parts.push('<rect x="590" y="478" width="14" height="14" fill="#16845b"/><text x="611" y="490" font-family="Arial, sans-serif" font-size="13" fill="#3c4043">Grounded pass</text>');
    parts.push('</svg>');
    return parts.join('\n');
}

function validationReport(trigger: any[], draft: any[], manifest: Record<string, unknown>): string {
    const overall = draft.find(row => row.triggerType === 'overall');
    const weakestTypes = draft
        .filter(row => row.triggerType !== 'overall')
        .sort((left, right) => left.acceptedTypeRate - right.acceptedTypeRate)
        .slice(0, 3)
        .map(row => `${shortLabel(row.triggerType)} ${pct(row.acceptedTypeRate)}`)
        .join(', ');
    const grounded = Math.round((overall?.groundedPassRate ?? 0) * (overall?.runs ?? 0));
    const acceptedType = Math.round((overall?.acceptedTypeRate ?? 0) * (overall?.runs ?? 0));
    const validStructure = Math.round((overall?.validStructureRate ?? 0) * (overall?.runs ?? 0));
    const validCitations = Math.round((overall?.validCitationRate ?? 0) * (overall?.runs ?? 0));
    const mustMention = Math.round((overall?.mustMentionRate ?? 0) * (overall?.runs ?? 0));
    const structureInterval = wilsonInterval(validStructure, overall?.runs ?? 0);
    const groundedInterval = wilsonInterval(grounded, overall?.runs ?? 0);
    const typeInterval = wilsonInterval(acceptedType, overall?.runs ?? 0);
    const citationInterval = wilsonInterval(validCitations, overall?.runs ?? 0);
    const mustMentionInterval = wilsonInterval(mustMention, overall?.runs ?? 0);
    return [
        '## Material Passport', '',
        '- Origin Skill: experiment-agent',
        '- Origin Mode: validate',
        `- Origin Date: ${String(manifest.completedAt ?? new Date().toISOString())}`,
        '- Verification Status: ANALYZED',
        '- Version Label: validation_v1', '',
        '## Validation Report', '',
        '- **Source**: capture trigger boundary replay and DeepSeek Flash draft generation benchmark',
        '- **Overall Confidence**: CAUTION', '',
        '### Statistical Findings', '',
        '| Metric | Value | 95% Wilson CI | Confidence |',
        '|---|---:|---:|---|',
        `| Production policy boundary F1 | ${trigger.reduce((sum, row) => sum + row.cases, 0)} cases; minimum class F1 = ${Math.min(...trigger.map(row => row.f1)).toFixed(3)} | N/A (deterministic production-policy replay) | SOLID for frozen signal boundaries |`,
        `| Valid draft structure | ${validStructure}/${overall?.runs ?? 0} (${pct(overall?.validStructureRate ?? 0)}) | ${pct(structureInterval[0])} to ${pct(structureInterval[1])} | SOLID |`,
        `| Valid evidence citations | ${validCitations}/${overall?.runs ?? 0} (${pct(overall?.validCitationRate ?? 0)}) | ${pct(citationInterval[0])} to ${pct(citationInterval[1])} | CAUTION |`,
        `| Required evidence coverage | ${mustMention}/${overall?.runs ?? 0} (${pct(overall?.mustMentionRate ?? 0)}) | ${pct(mustMentionInterval[0])} to ${pct(mustMentionInterval[1])} | CAUTION |`,
        `| Grounded pass | ${grounded}/${overall?.runs ?? 0} (${pct(overall?.groundedPassRate ?? 0)}) | ${pct(groundedInterval[0])} to ${pct(groundedInterval[1])} | CAUTION |`,
        `| Accepted card type | ${acceptedType}/${overall?.runs ?? 0} (${pct(overall?.acceptedTypeRate ?? 0)}) | ${pct(typeInterval[0])} to ${pct(typeInterval[1])} | RED_FLAG for full automation |`,
        '',
        '### Warnings', '',
        '| Type | Detail | Affected |',
        '|---|---|---|',
        '| Boundary replay | The replay calls the same pure threshold policy used by the production capture service, but does not exercise event collection, cooldown, host-only, workspace, first-observation, or notification state. | Deployment trigger claims |',
        '| Constructed fixtures | Draft inputs deliberately contain traceable evidence paths and required tokens. | Grounding generalization |',
        `| Type ambiguity | Overall accepted type is ${pct(overall?.acceptedTypeRate ?? 0)}; weakest groups are ${weakestTypes}. | Autonomous card acceptance |`,
        '| No human semantic rating | Structural and token-based grounding checks do not measure usefulness, clarity, or factual completeness. | Draft quality |',
        '| One model | Results cover DeepSeek Flash with one prompt and temperature setting. | Model generalization |',
        '',
        '### Fallacy Scan', '',
        '- **Coverage**: 11/11 fallacy types checked', '',
        '| Fallacy | Severity | Detail | Recommendation |',
        '|---|---|---|---|',
        '| Simpson\'s paradox | CAUTION | Overall type accuracy hides large trigger-family differences. | Report per-trigger rates. |',
        '| Ecological fallacy | NOTE | Fixture-level accuracy does not imply developer-level benefit. | Keep inference at fixture level. |',
        '| Berkson\'s paradox | NOTE | No filtered participant sample. | None. |',
        '| Collider bias | NOTE | No adjusted observational model. | None. |',
        '| Base-rate neglect | CAUTION | Natural trigger prevalence is unknown. | Do not interpret boundary F1 as deployment PPV. |',
        '| Regression to the mean | NOTE | No extreme-group pre-post design. | None. |',
        `| Survivorship bias | NOTE | All ${overall?.runs ?? 0} API calls are retained; infrastructure failures were ${overall?.infrastructureFailures ?? 0}. | Keep failures in denominator. |`,
        '| Look-elsewhere effect | CAUTION | Multiple draft metrics are reported. | Keep type accuracy as an explicit weak result. |',
        '| Garden of forking paths | CAUTION | Token rules are benchmark-specific. | Freeze scoring before future reruns. |',
        '| Correlation != causation | NOTE | This benchmark does not evaluate human outcomes. | Avoid productivity claims. |',
        '| Reverse causality | NOTE | Trigger evidence precedes draft generation. | None. |',
        '',
        '### Reproducibility', '',
        '- **Method**: deterministic trigger tests re-executed; model draft generation not repeated',
        '- **Verdict**: PARTIALLY_REPRODUCIBLE', '',
        'The trigger boundary component directly replays the production threshold policy and is covered by tests. The saved model responses are auditable, but the external API generation stage was not repeated during validation.', ''
    ].join('\n');
}

function wilsonInterval(successes: number, total: number): [number, number] {
    if (total === 0) return [0, 0];
    const z = 1.959963984540054;
    const proportion = successes / total;
    const denominator = 1 + z ** 2 / total;
    const center = (proportion + z ** 2 / (2 * total)) / denominator;
    const margin = z * Math.sqrt((proportion * (1 - proportion) + z ** 2 / (4 * total)) / total) / denominator;
    return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

function shortLabel(value: string): string {
    const labels: Record<string, string> = {
        'chat.dense': 'Chat',
        'todo.cleared': 'TODO',
        'magicNumber.added': 'Magic number',
        'packageJson.dependencySwitch': 'Dependency',
        'diagnostics.fixed': 'Diagnostics',
        'rollback.detected': 'Rollback'
    };
    return labels[value] ?? value;
}
