import { expect, it } from "@effect/vitest";
import { Tool } from "effect/unstable/ai";

import { CommsToolkit, MAX_MENTIONS, MAX_POST_BODY_CHARS, MAX_READ_LIMIT } from "./tools.ts";

const schemaHasDescription = (schema: unknown): boolean => {
  if (!schema || typeof schema !== "object") return false;
  const record = schema as Record<string, unknown>;
  if (typeof record.description === "string" && record.description.length > 0) return true;
  return [record.anyOf, record.oneOf, record.allOf]
    .filter(Array.isArray)
    .some((members) => members.some(schemaHasDescription));
};

const findConstraint = (schema: unknown, key: string): unknown => {
  if (!schema || typeof schema !== "object") return undefined;
  const record = schema as Record<string, unknown>;
  if (record[key] !== undefined) return record[key];
  for (const branch of [record.anyOf, record.oneOf, record.allOf].filter(Array.isArray)) {
    for (const member of branch) {
      const found = findConstraint(member, key);
      if (found !== undefined) return found;
    }
  }
  return undefined;
};

const parameters = (name: keyof typeof CommsToolkit.tools) => {
  const schema = Tool.getJsonSchema(CommsToolkit.tools[name]) as {
    readonly type?: unknown;
    readonly properties?: Readonly<Record<string, unknown>>;
    readonly anyOf?: unknown;
    readonly oneOf?: unknown;
  };
  return schema;
};

/**
 * The published schema is the only thing an agent sees. An annotation applied
 * to a transformation (`TrimmedNonEmptyString` is `TrimmedString.check(...)`)
 * is dropped from the encoded side along with its constraint, so a description
 * can read perfectly in the source and never reach the agent.
 */
it("exports provider-compatible object schemas with described parameters", () => {
  for (const tool of Object.values(CommsToolkit.tools)) {
    const schema = Tool.getJsonSchema(tool) as {
      readonly type?: unknown;
      readonly properties?: Readonly<Record<string, unknown>>;
      readonly anyOf?: unknown;
      readonly oneOf?: unknown;
    };
    expect(
      tool.description?.length ?? 0,
      `${tool.name} should have a useful description`,
    ).toBeGreaterThan(40);
    expect(schema.type, `${tool.name} must export a top-level object schema`).toBe("object");
    expect(schema.anyOf, `${tool.name} must not export a root anyOf`).toBeUndefined();
    expect(schema.oneOf, `${tool.name} must not export a root oneOf`).toBeUndefined();
    for (const [name, property] of Object.entries(schema.properties ?? {})) {
      expect(
        schemaHasDescription(property),
        `${tool.name}.${name} should explain what data the agent must pass`,
      ).toBe(true);
    }
  }
});

it("publishes the tool names the agent is told to call", () => {
  expect(
    Object.values(CommsToolkit.tools)
      .map((tool) => tool.name)
      .sort(),
  ).toEqual(["comms_post", "comms_read_channel", "comms_reply"]);
});

it("publishes the input bounds, so an agent can stay inside them without guessing", () => {
  const post = parameters("comms_post");
  expect(findConstraint(post.properties?.body, "maxLength")).toBe(MAX_POST_BODY_CHARS);
  expect(findConstraint(post.properties?.body, "minLength")).toBe(1);
  expect(findConstraint(post.properties?.mentions, "maxItems")).toBe(MAX_MENTIONS);

  const read = parameters("comms_read_channel");
  expect(findConstraint(read.properties?.limit, "maximum")).toBe(MAX_READ_LIMIT);
  expect(findConstraint(read.properties?.limit, "minimum")).toBe(1);
});
