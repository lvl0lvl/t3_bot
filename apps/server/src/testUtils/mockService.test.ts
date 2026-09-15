import { assert, describe, it } from "@effect/vitest";
import { Cause, Context, Effect, Exit, Layer } from "effect";

import { mockService, unstubbed } from "./mockService.ts";

class Probe extends Context.Service<
  Probe,
  {
    readonly label: string;
    readonly ping: Effect.Effect<string>;
    readonly pong: (n: number) => Effect.Effect<number>;
  }
>()("t3/testUtils/mockService.test/Probe") {}

describe("mockService", () => {
  it.effect("a stubbed member answers and an unstubbed one dies with Layer.mock's message", () =>
    Effect.gen(function* () {
      const layer = mockService(Probe)({
        label: "probe",
        ping: Effect.succeed("pinged"),
        pong: unstubbed,
      });
      const pinged = yield* Effect.gen(function* () {
        const probe = yield* Probe;
        return `${probe.label}:${yield* probe.ping}`;
      }).pipe(Effect.provide(layer));
      assert.equal(pinged, "probe:pinged");

      // The sentinel is dropped, not forwarded: Layer.mock never sees `pong`,
      // so its own proxy produces the defect and its own message names the
      // service and the member. A helper that forwarded the symbol would
      // hand the caller a symbol where an Effect was expected.
      const exit = yield* Effect.gen(function* () {
        const probe = yield* Probe;
        return yield* probe.pong(1);
      }).pipe(Effect.provide(layer), Effect.exit);
      assert.isTrue(Exit.isFailure(exit));
      const defect = Exit.isFailure(exit) ? Cause.squash(exit.cause) : undefined;
      assert.instanceOf(defect, Error);
      assert.equal(defect.name, "UnimplementedError");
      assert.equal(
        defect.message,
        't3/testUtils/mockService.test/Probe: Unimplemented method "pong"',
      );
    }),
  );

  // Proven at typecheck, not at runtime: each `@ts-expect-error` below is
  // load-bearing. Loosen TotalStub to a partial and the first directive is
  // unused (TS2578), which is a typecheck failure; the Layer.mock line is
  // the base behaviour, an omitted member compiling clean, that the helper
  // exists to replace.
  it("names every member at typecheck, where Layer.mock does not", () => {
    // @ts-expect-error `pong` is missing: TotalStub names every member.
    const omitted = mockService(Probe)({ label: "probe", ping: Effect.succeed("") });
    // The same omission at Layer.mock compiles: PartialEffectful makes
    // effectful members optional, and nothing reports the gap.
    const partial = Layer.mock(Probe)({ label: "probe", ping: Effect.succeed("") });
    const plainValueUnstubbed = mockService(Probe)({
      // @ts-expect-error a plain-value member cannot be `unstubbed`.
      label: unstubbed,
      ping: Effect.succeed(""),
      pong: unstubbed,
    });
    assert.isTrue(
      Layer.isLayer(omitted) && Layer.isLayer(partial) && Layer.isLayer(plainValueUnstubbed),
    );
  });
});
