import { verdict, type ZoneRule } from "./context.js";

export const semanticInteractionUncertain: ZoneRule = (context) => verdict(context, "grey", "warn", "semantic-interaction-uncertain", "修改可能互相影响，需要进一步判断。");
