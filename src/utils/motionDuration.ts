import { parseMtn } from "./parseMtn";

type Motion3Json = {
  Meta?: {
    Duration?: number;
  };
  Duration?: number;
};

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export function parseMotionDurationSeconds(filePath: string, content: string): number | undefined {
  if (/\.mtn$/i.test(filePath)) {
    const parsed = parseMtn(content);
    return parsed.durationMs > 0 ? parsed.durationMs / 1000 : undefined;
  }

  if (/\.motion3\.json$/i.test(filePath)) {
    try {
      const parsed = JSON.parse(content) as Motion3Json;
      if (isPositiveNumber(parsed.Meta?.Duration)) {
        return parsed.Meta.Duration;
      }
      if (isPositiveNumber(parsed.Duration)) {
        return parsed.Duration;
      }
    } catch {
      return undefined;
    }
  }

  return undefined;
}
