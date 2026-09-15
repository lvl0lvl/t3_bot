import type { Context } from "effect";
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

// Which members may be `unstubbed` is asked of Layer.mock's own type
// rather than restated: PartialEffectful makes exactly the members
// Layer.mock treats as optional optional, so a key it leaves omittable is
// the key this stub may leave unstubbed. `-?` then makes every member,
// optional in the shape or not, one the stub has to name.
export type TotalStub<Shape extends object> = {
  readonly [K in keyof Shape]-?: K extends keyof Layer.PartialEffectful<Shape>
    ? {} extends Pick<Layer.PartialEffectful<Shape>, K>
      ? Shape[K] | Unstubbed
      : Shape[K]
    : Shape[K];
};

// By the brand, not by identity: a second instance of this module (a
// duplicated copy under a different resolved path) mints a second
// `unstubbed` object, and an identity comparison forwards it to Layer.mock,
// which hands the caller an object where an Effect was expected.
const isUnstubbed = (member: unknown): member is Unstubbed =>
  typeof member === "object" && member !== null && UnstubbedId in member;

export const mockService =
  <Id, Shape extends object>(service: Context.Key<Id, Shape>) =>
  (stub: TotalStub<Shape>): Layer.Layer<Id> => {
    // Reflect.ownKeys, not Object.entries: a symbol-keyed member with a real
    // implementation is dropped by Object.entries and dies as unimplemented.
    const rest = { ...stub } as Record<PropertyKey, unknown>;
    for (const key of Reflect.ownKeys(rest)) {
      if (isUnstubbed(rest[key])) delete rest[key];
    }
    return Layer.mock(service)(rest as Layer.PartialEffectful<Shape>);
  };
