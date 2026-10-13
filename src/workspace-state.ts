import { validateConnection } from "./domain";
export interface ConfigValue {
  concurrency: number;
  timeout: number;
  profile: string;
  revision: number;
}
export interface ConfigDraft {
  concurrency: string;
  timeout: string;
  profile: string;
  revision: number;
}
export type FieldErrors = Record<string, string>;
export const configDefault: ConfigValue = {
  concurrency: 4,
  timeout: 90,
  profile: "balanced",
  revision: 1,
};
export const configDraft = (value: ConfigValue): ConfigDraft => ({
  ...value,
  concurrency: String(value.concurrency),
  timeout: String(value.timeout),
});
export function validateConfig(draft: ConfigDraft): FieldErrors {
  const errors: FieldErrors = {};
  for (const [name, label, min, max] of [
    ["concurrency", "并发上限", 1, 16],
    ["timeout", "请求超时", 10, 600],
  ] as const) {
    const input = draft[name].trim(),
      value = Number(input);
    if (!input) errors[name] = `请填写${label}。`;
    else if (!Number.isInteger(value) || value < min || value > max)
      errors[name] = `请输入 ${min}–${max} 之间的整数。`;
  }
  return errors;
}
export const parseConfig = (draft: ConfigDraft): ConfigValue | null =>
  Object.keys(validateConfig(draft)).length
    ? null
    : {
        ...draft,
        concurrency: Number(draft.concurrency),
        timeout: Number(draft.timeout),
      };
export function configChanged(draft: ConfigDraft, value: ConfigValue) {
  const parsed = parseConfig(draft);
  return parsed
    ? parsed.concurrency !== value.concurrency ||
        parsed.timeout !== value.timeout ||
        parsed.profile !== value.profile
    : draft.concurrency !== String(value.concurrency) ||
        draft.timeout !== String(value.timeout) ||
        draft.profile !== value.profile;
}
export function validateConnect(
  value: { name: string; ref: string; credential: string },
  step: number,
): FieldErrors {
  const errors: FieldErrors = {};
  if (!value.name.trim()) errors.name = "请填写实例名称。";
  if (step >= 1) {
    if (validateConnection(value.ref, "credentialctl://team/check"))
      errors.ref = "使用 connection:// 连接引用，不输入网址或密钥。";
    if (validateConnection("connection://lan/check", value.credential))
      errors.credential =
        "使用 credentialctl:// 凭据引用，不输入 Key、Token 或密码。";
  }
  return errors;
}
