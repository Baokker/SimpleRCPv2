import { en } from "./en";
import { zh } from "./zh";

export const defaultLocale = "zh-CN";
export type Locale = typeof defaultLocale | "en";
export type MessageKey = keyof typeof zh;
type Value = string | number;
type ParametersIn<Text extends string> =
  Text extends `${string}{${infer Name}}${infer Rest}` ? Name | ParametersIn<Rest> : never;
type MessageArgs<Key extends MessageKey> = [ParametersIn<(typeof zh)[Key]>] extends [never]
  ? []
  : [values: Record<ParametersIn<(typeof zh)[Key]>, Value>];
type PlainMessageKey = { [Key in MessageKey]: MessageArgs<Key> extends [] ? Key : never }[MessageKey];
export type Translate = <Key extends MessageKey>(key: Key, ...args: MessageArgs<Key>) => string;

const dictionaries = { [defaultLocale]: zh, en };
const placeholder = /\{(\w+)\}/g;

export function translator(locale: Locale): Translate {
  return (key, ...args) => dictionaries[locale][key].replace(placeholder, (_, name: string) => {
    const values: Record<string, Value> | undefined = args[0];
    const value = values?.[name];
    if (value === undefined) throw new Error(`Missing message parameter ${name} for ${key}`);
    return String(value);
  });
}

export function richParts<T>(locale: Locale, key: MessageKey, values: Record<string, T>) {
  return dictionaries[locale][key].split(placeholder).map((part, index) =>
    index % 2 ? values[part] : part
  );
}

export function messageError<Key extends MessageKey>(key: Key, ...args: MessageArgs<Key>) {
  return new LocalizedError((translate) => translate(key, ...args));
}

class LocalizedError extends Error {
  constructor(readonly translate: (t: Translate) => string) {
    super(translate(translator(defaultLocale)));
  }
}

export function errorText(t: Translate, error: unknown, fallback: string): string {
  if (error instanceof LocalizedError) return error.translate(t);
  return error instanceof Error && error.message ? serverText(t, error.message) : fallback;
}

export function captureError(error: unknown, fallback: Error) {
  return error instanceof Error && error.message ? error : fallback;
}

const fixedServerText = new Map<string, PlainMessageKey>([
  ["Project not found", "projectNotFound"],
  ["A ZIP archive is required", "chooseZip"],
  ["Demo project cannot be deleted", "demoDeleteForbidden"],
  ["Target path already exists", "pathExists"],
  ["Cannot rename workspace root", "renameRootForbidden"],
  ["Cannot delete workspace root", "deleteRootForbidden"],
  ["Path is excluded from browser access", "pathExcluded"],
  ["Agent is disabled", "agentDisabled"],
  ["DEEPSEEK_API_KEY is required", "missingDeepSeekKey"],
  ["Agent prompt is required", "promptRequired"],
  ["Agent session not found", "sessionNotFound"],
  ["Agent session has been deleted", "sessionDeleted"],
  ["Agent run not found", "runNotFound"],
  ["Team Agent not found", "teamAgentNotFound"],
  ["Project membership is required", "membershipRequired"],
  ["Member identity is required", "identityRequired"],
  ["Only the task initiator can retry", "initiatorRetryOnly"],
  ["Only the task initiator can answer", "initiatorAnswerOnly"],
  ["This task cannot be retried", "taskCannotRetry"],
  ["当前任务无法重试", "taskCannotRetry"],
  ["OpenCode returned an empty response", "openCodeEmptyResponse"],
  ["Invalid terminal message", "invalidTerminalMessage"],
  ["Terminal input exceeds the 10000 character limit", "terminalInputLimit"],
  ["正在准备工具参数", "preparingToolArguments"],
  ["请检查服务配置与错误详情后重新发起任务。", "failureCheckConfiguration"],
  ["网络请求未完成，可以保留已有文件修改并重新发起任务。", "failureRetryNetwork"],
  ["HTTP 客户端禁止使用当前端口，请修改 SIMPLERCP_OPENCODE_PORT 后重启服务。", "failureInvalidPort"],
  ["认证失败，请检查 API key 是否有效，以及 DEEPSEEK_BASE_URL 是否属于提供该 key 的服务。", "failureAuthentication"],
  ["请求配置无法使用，请检查 DEEPSEEK_MODEL 与 DEEPSEEK_BASE_URL。", "failureRequestConfiguration"],
  ["服务端重启中断了任务。", "failureRestarted"],
  ["服务重启中断了任务，已完成的文件修改继续保留，可以重试。", "failureRetryRestarted"],
  ["该问题已经处理", "questionAlreadyHandled"],
  ["请回答所有问题", "answerAllQuestions"],
  ["请选择提供的选项", "selectProvidedOption"],
  ["请提供回答", "provideAnswer"]
]);

export function serverText(t: Translate, message: string): string {
  const key = fixedServerText.get(message);
  return key ? t(key) : message;
}
