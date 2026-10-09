import { expect } from "bun:test"

/** Checks the answer a content-only client receives on every exercised path. */
export function withContentParity<Args extends unknown[], Result>(
  name: string,
  handler: (...args: Args) => Promise<Result>
): (...args: Args) => Promise<Result> {
  return async (...args) => {
    const result = await handler(...args)
    if (typeof result !== "object" || result === null) return result
    if (!("structuredContent" in result)) return result

    const content = "content" in result ? result.content : undefined
    expect(Array.isArray(content), `${name}: missing content`).toBe(true)
    const blocks = content as { type: string; text?: string }[]
    const payloads = blocks.flatMap((block) => {
      if (block.type !== "text" || block.text === undefined) return []
      try {
        return [JSON.parse(block.text)]
      } catch {
        return []
      }
    })
    expect(
      payloads,
      `${name}: content lost structured result fields`
    ).toContainEqual(JSON.parse(JSON.stringify(result.structuredContent)))
    return result
  }
}
