# Detection regression corpus (T029)

A committed corpus of synthetic documents plus golden outputs captured from
the engine as it is today. It is the hard evidence for the "no behavior
drift" gate around refactors (T010) and a permanent safety net afterwards:
unit tests move with the code, so only this fixed external corpus can catch
drift introduced by moving the code.

## Layout

- `corpus/*.json` - inputs and goldens. Each file holds cases with:
  - `input` - the document text (synthetic PII only, generator-style values;
    checksummed identifiers such as PESEL, NIP, IBAN and Luhn card numbers
    are valid per their check digit but fabricated).
  - `settings` - pipeline knobs: `regexEnabled`, `regexRegion`, `threshold`,
    `mode` (`labeled` or `blanked`) and placeholder `renames`.
  - `mlEntities` - the fixed entity list the stubbed ML provider returns for
    this case (`value` + `occurrence`, spans are resolved at runtime so the
    JSON never contains hand-maintained offsets).
  - `expected` - the golden: final detected entities (span, type, confidence
    rounded to 4 decimals, detector id), anonymized text, text after label
    renames (if any), restored text and the replacement table. Never edit
    this by hand; it is machine-captured (see below).
- `regression.test.ts` - the replay runner. Runs in CI on every `npm test`.
- `real-model.test.ts` - optional end-to-end suite against the real GLiNER
  model. Skipped by default.
- `harness.ts` / `capture.ts` - shared plumbing and the golden writer.

## What the deterministic runner does

`regression.test.ts` imports the real detection worker module and the real
`AnonymizationSession`. Only the two ML provider classes are replaced (via
`vi.mock`) with a stub that returns each case's `mlEntities`, filtered by the
confidence threshold exactly like the real providers. Everything else is the
production pipeline: regex rules for all 18 regions, overlap resolution,
false-positive filtering, propagation, placeholder generation, blanked mode,
label renames and restore.

Because the providers are mocked at module level, `@huggingface/transformers`
and `onnxruntime-web` are never imported and no model is downloaded. On top
of that the suite stubs `fetch` to throw, so any accidental network access
fails the run.

The comparison is a single deep equality against the golden: ANY diff in
span, type, rounded confidence, detector id, placeholder text, restored text
or replacement table fails the case. A coverage suite additionally fails if
the corpus ever stops producing all 14 entity types, detections from all 18
regex regions, the four checksum validators (PESEL, NIP, IBAN, Luhn) or
propagation.

## Running

```sh
npm test                                        # full suite, corpus included
npm test -- tests/regression/regression.test.ts # corpus only
```

## Re-capturing goldens (intentional changes only)

If you have deliberately changed detection or anonymization behavior,
re-capture the goldens with this single command and then REVIEW THE DIFF
like any other code change:

```sh
DOCCLOAK_CAPTURE=1 npm test -- tests/regression/regression.test.ts
```

The capture path runs the exact same pipeline and overwrites the `expected`
blocks with whatever the engine actually produced. Goldens are therefore
always engine-captured, never hand-written. Do not recapture to silence an
unexplained failure; an unexplained failure is the corpus doing its job.

## Optional: real-model end-to-end run (T010 manual gate)

```sh
DOCCLOAK_REAL_MODEL=1 npm test -- tests/regression/real-model.test.ts
```

Downloads the ~65 MB quantized GLiNER model on first run and needs network
access, so it is skipped by default and in CI. It asserts structural
invariants (exact regex spans, model-tagged detections, span consistency)
rather than byte-exact goldens, because model output may legitimately shift
between model or runtime versions. Run it on both sides of a refactor and
compare the outputs manually.

## Adding cases

1. Add a case to an existing `corpus/*.json` file (or a new file) with
   `"expected": null`. Use ONLY synthetic PII; checksummed values must pass
   their validators or the regex rules will drop them.
2. Run the capture command above.
3. Review the newly written `expected` block: it must match what you intended
   the engine to do.
4. Run `npm test` and commit the JSON together with your review.
