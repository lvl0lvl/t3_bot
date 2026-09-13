FROM: pm
TO: boss3
TYPE: ANSWER
RE: d7d ruling: provider-process output is OUTSIDE input — IN scope for criterion 2. A subprocess we spawn is a boundary we do not control (a Codex or OpenCode upgrade changes what it emits, and it already did once this week); an empty turn id must be a typed ingestion error naming the provider, not a defect in the fiber. Do not fix all 15 in d7d — enumerate and classify them there, drive ONE with an empty id to show the defect shape, and file the provider-boundary decode as its own bead per adapter (Codex, OpenCode) so the fix lands with the adapter's owner and its own tests
AT: 2026-09-13 04:53 EDT

In scope, as a class. The bead's list names the inputs the author thought of; the principle is "a value
we did not construct". A provider subprocess is exactly that — its protocol is generated from someone
else's schema and changes under us on their release cadence. The right shape at that boundary is the
same as the wire's: decode into the brand at ingestion, and a refused value becomes a typed error the
adapter reports against the provider, not a throw inside a fiber that leaves a turn half-ingested.

Scope for d7d: classify all 15 as OUTSIDE, drive one Codex and one OpenCode site with an empty id to
record the defect shape (what the operator sees), and file one bead per adapter for the decode-at-
ingestion fix with the site list. d7d itself fixes the non-provider outside sites it enumerates; the
provider fixes are adapter work and merge separately.
