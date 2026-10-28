import { expect, test } from "bun:test"
import { parseStoryFeatures } from "./features"

test("old, absent and malformed feature columns read with every feature off", () => {
  for (const json of [
    null,
    "",
    "null",
    "invalid",
    '{"world":{"enabled":"yes"}}',
  ])
    expect(parseStoryFeatures(json)).toEqual({})
  expect(parseStoryFeatures('{"world":{"enabled":true}}')).toEqual({
    world: { enabled: true, pacing: "" },
  })
})
