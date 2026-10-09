# 数据采集与标注

## 采集字段

- participantGroup、round、taskId、condition
- knowledgeSuggestionId、triggerType、shownAt、decision、editedChars
- cardId、scope、status、confirmedBy
- agentRunId、injectedCardIds、injectionChars、injectionTokens、toolCalls
- taskStartedAt、taskFinishedAt、functional、trapAvoided

## 标注规则

- 确认：成员保存或确认卡片，并保持有效状态。
- 修改确认：成员改变标题、正文或适用范围后保存并确认。
- 丢弃：成员明确拒绝建议或归档草稿。
- Agent 使用：`knowledge_injected.cards` 或 `knowledge_tool_call.resultIds` 中出现卡片 id。
- 复犯：判定器认定陷阱仍存在；只在功能通过时计算联合成功。

每条记录由两名标注者独立填写，分歧通过讨论解决；保留原始字段和修改理由。
