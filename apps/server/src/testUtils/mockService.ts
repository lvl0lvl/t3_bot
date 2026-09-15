import type { Channel, Context, Effect, Stream } from "effect";
import { Layer } from "effect";

// A stub that names every member of the shape. A member the test does not
// exercise is written as `unstubbed`, so adding a method to a service shape
// is a typecheck failure at every stub of that shape, not a runtime death.
//
// The verbosity is the price: a test that names twelve members once, with
// tsc writing the list, is the price of "adding a method to a shape is a
// compile error at every stub of it"; the alternative was the incident
// (t3_bot-wto: a method added to a shape, tsc 0 errors, 29 tests dead at
// runtime, because Layer.mock takes a partial and the type opted out).
//
// Layer.mock stays underneath: `unstubbed` members are dropped before the
// layer is built, so calling one still dies with Layer.mock's own
// `<service key>: Unimplemented method "<name>"`. A plain-value member (one
// that is not an Effect, Stream, Channel or a function returning one) cannot
// be `unstubbed`: Layer.mock's proxy hands back a defect object on a plain
// read instead of a dying Effect, so the type refuses it and the stub must
// carry the value, as PartialEffectful already requires.
const UnstubbedId: unique symbol = Symbol.for("t3/testUtils/unstubbed");
export interface Unstubbed {
  readonly [UnstubbedId]: true;
}
// An object, not a bare symbol: a `unique symbol` widens to `symbol` in an
// object-literal property that is not contextually typed, and two of the
// migrated stubs sit in that position (measured: 32 TS2322 at the symbol
// form, 0 at this one).
export const unstubbed: Unstubbed = { [UnstubbedId]: true };

// Mirrors the members Layer.mock treats as optional (effect Layer.d.ts,
// `AnyEffectOrStream`, not exported).
type EffectfulMember =
  | Effect.Effect<any, any, any>
  | Stream.Stream<any, any, any>
  | Channel.Channel<any, any, any, any, any, any, any>
  | ((...args: any) => Effect.Effect<any, any, any>)
  | ((...args: any) => Stream.Stream<any, any, any>)
  | ((...args: any) => Channel.Channel<any, any, any, any, any, any, any>);

export type TotalStub<Shape> = {
  readonly [K in keyof Shape]: Shape[K] extends EffectfulMember ? Shape[K] | Unstubbed : Shape[K];
};

export const mockService =
  <Id, Shape extends object>(service: Context.Key<Id, Shape>) =>
  (stub: TotalStub<Shape>): Layer.Layer<Id> =>
    Layer.mock(service)(
      Object.fromEntries(
        Object.entries(stub).filter(([, member]) => member !== unstubbed),
      ) as Layer.PartialEffectful<Shape>,
    );
