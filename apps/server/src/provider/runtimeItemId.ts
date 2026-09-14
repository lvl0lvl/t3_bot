import { RuntimeItemId, type ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

// The door every adapter's item id goes through on its way into a runtime
// event. The id keys a timeline row, and ingestion persists that key
// (`assistant:<itemId>`) into an orchestration event the store decodes on
// read through the brand's decoder, which trims: a raw " msg_1 " keys one row
// live and another after replay, then splits again on the next live delta. So
// the runtime event carries the DECODED value, and an id the decoder refuses
// ("", "  ", a null or a number from a broken provider) is dropped the way ""
// always was — the event goes out with no item — instead of throwing inside
// `.make` in the event pump. The adapters' own state stays keyed by the raw
// provider id (a tool result is matched to its tool_use by the string the
// provider sent), so only the emitted identity changes.
export const decodeRuntimeItemId = Schema.decodeUnknownOption(RuntimeItemId);

// A refused id is echoed into logs and error details that persist; a 1 MiB
// id would be copied whole into each. A null or an object is previewed too —
// reading `.length` off it is the Die the door exists to prevent.
const REFUSED_ID_PREVIEW_LENGTH = 64;
export const previewRefusedId = (id: unknown) => {
  if (typeof id === "string") {
    return id.length <= REFUSED_ID_PREVIEW_LENGTH
      ? JSON.stringify(id)
      : `${JSON.stringify(id.slice(0, REFUSED_ID_PREVIEW_LENGTH))}… (${id.length} chars)`;
  }
  const text = String(JSON.stringify(id) ?? id);
  return text.length <= REFUSED_ID_PREVIEW_LENGTH
    ? text
    : `${text.slice(0, REFUSED_ID_PREVIEW_LENGTH)}… (${text.length} chars)`;
};

/**
 * The `itemId` field of a runtime event: the decoded id when the brand admits `itemId`, nothing when
 * it is absent, and nothing plus one debug log (`<logKey>`, with a bounded preview) when it is refused.
 */
export const runtimeItemIdField = (input: {
  readonly logKey: string;
  readonly threadId: ThreadId;
  readonly itemId: unknown;
}): Effect.Effect<{ readonly itemId?: RuntimeItemId }> =>
  Effect.gen(function* () {
    if (input.itemId === undefined) {
      return {};
    }
    const decoded = decodeRuntimeItemId(input.itemId);
    if (Option.isNone(decoded)) {
      yield* Effect.logDebug(input.logKey, {
        threadId: input.threadId,
        itemId: previewRefusedId(input.itemId),
      });
      return {};
    }
    return { itemId: decoded.value };
  });
