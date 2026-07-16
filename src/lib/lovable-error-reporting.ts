export function reportLovableError(error: unknown, context?: Record<string, unknown>) {
  try {
    console.error("[lovable-error]", context ?? {}, error);
  } catch {
    // noop
  }
}