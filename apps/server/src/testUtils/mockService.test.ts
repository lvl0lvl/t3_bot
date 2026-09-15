import { assert, describe, it } from "@effect/vitest";
import type { Channel, Stream } from "effect";
import { Cause, Context, Effect, Exit, Layer } from "effect";

import { mockService, unstubbed } from "./mockService.ts";

class Probe extends Context.Service<
  Probe,
  {
    readonly label: string;
    readonly ping: Effect.Effect<string>;
    readonly pong: (n: number) => Effect.Effect<number>;
    readonly flow: Stream.Stream<string>;
    readonly duct: Channel.Channel<string>;
  }
>()("t3/testUtils/mockService.test/Probe") {}

const symMember: unique symbol = Symbol("t3/testUtils/mockService.test/symMember");

class SymProbe extends Context.Service<
  SymProbe,
  {
    readonly label: string;
    readonly [symMember]: Effect.Effect<string>;
  }
>()("t3/testUtils/mockService.test/SymProbe") {}

class OptProbe extends Context.Service<
  OptProbe,
  {
    readonly label: string;
    readonly maybe?: Effect.Effect<string>;
  }
>()("t3/testUtils/mockService.test/OptProbe") {}

describe("mockService", () => {
  it.effect("a stubbed member answers and an unstubbed one dies with Layer.mock's message", () =>
    Effect.gen(function* () {
      const layer = mockService(Probe)({
        label: "probe",
        ping: Effect.succeed("pinged"),
        pong: unstubbed,
        flow: unstubbed,
        duct: unstubbed,
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
  it.effect("an impostor object carrying the sentinel's brand is dropped, not forwarded", () =>
    Effect.gen(function* () {
      // What a second instance of mockService.ts hands a stub: a different
      // object with the same `Symbol.for` brand. Identity says "not the
      // sentinel" and forwards it, and the caller yields a plain object.
      const impostor = {
        [Symbol.for("t3/testUtils/unstubbed")]: true,
      } as unknown as typeof unstubbed;
      const layer = mockService(Probe)({
        label: "probe",
        ping: Effect.succeed("pinged"),
        pong: impostor,
        flow: unstubbed,
        duct: unstubbed,
      });
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

  it.effect("a symbol-keyed member with a real implementation answers", () =>
    Effect.gen(function* () {
      // Object.entries sees string keys only, so a stub built from it drops
      // this member and the read dies as unimplemented instead of answering.
      const layer = mockService(SymProbe)({
        label: "sym",
        [symMember]: Effect.succeed("symbolic"),
      });
      const answered = yield* Effect.gen(function* () {
        const probe = yield* SymProbe;
        return yield* probe[symMember];
      }).pipe(Effect.provide(layer));
      assert.equal(answered, "symbolic");
    }),
  );

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
      flow: unstubbed,
      duct: unstubbed,
    });
    // An OPTIONAL member of the shape: without `-?` on TotalStub it stays
    // omittable and this directive is unused (TS2578), which is the whole
    // property — "adding a method to a shape reds every stub" is false for
    // an optional method at every stub that leaves it out.
    // @ts-expect-error `maybe` is optional in the shape and still must be named.
    const optionalOmitted = mockService(OptProbe)({ label: "probe" });
    assert.isTrue(
      Layer.isLayer(omitted) &&
        Layer.isLayer(partial) &&
        Layer.isLayer(plainValueUnstubbed) &&
        Layer.isLayer(optionalOmitted),
    );
  });
});
