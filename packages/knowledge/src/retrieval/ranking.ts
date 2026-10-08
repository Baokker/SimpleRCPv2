import { searchKnowledgeCards, resultMatchesFiles, type KnowledgeSearchResult, type SearchKnowledgeCardsOptions } from "./index.js";

export interface KnowledgeRankingOptions {
  ranking: "legacy" | "bounded";
  useActiveFiles: boolean;
}

export function compareKnowledgeRanks(a: Pick<KnowledgeSearchResult, "type" | "score" | "cardId">, b: Pick<KnowledgeSearchResult, "type" | "score" | "cardId">, ranking: "legacy" | "bounded") {
  const priority = (type: string) => ["negative", "risk", "constraint"].includes(type) ? 0 : ["decision", "context"].includes(type) ? 1 : 2;
  return (ranking === "bounded" ? priority(a.type) - priority(b.type) : 0) || b.score - a.score || (a.cardId < b.cardId ? -1 : a.cardId > b.cardId ? 1 : 0);
}

export function rankKnowledgeResults(results: KnowledgeSearchResult[], activeFiles: string[], options: KnowledgeRankingOptions) {
  const maximum = Math.max(0, ...results.map(result => result.score));
  const cap = maximum > 0 ? maximum * 0.5 : 0.06;
  return results.map(result => {
    const boost = options.ranking === "bounded" && options.useActiveFiles && resultMatchesFiles(result, activeFiles) ? Math.min(0.06, cap) : 0;
    return {...result, lexical: result.score, boost, score: result.score + boost};
  }).sort((a, b) => compareKnowledgeRanks(a, b, options.ranking));
}

export async function searchRankedKnowledgeCards(options: SearchKnowledgeCardsOptions & KnowledgeRankingOptions) {
  const activeFiles = options.useActiveFiles ? options.activeFiles ?? [] : [];
  const results = await searchKnowledgeCards({...options, activeFiles: options.ranking === "legacy" ? activeFiles : [], candidateFiles: activeFiles, returnAll: true});
  return rankKnowledgeResults(results, activeFiles, options);
}
