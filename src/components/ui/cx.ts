export type ClassValue = string | false | null | undefined | 0;

export function cx(...values: ClassValue[]) {
  return values.filter(Boolean).join(" ");
}
