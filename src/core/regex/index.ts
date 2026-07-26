/**
 * Migration shim (T004): the regex rules tree moved to @doccloak/core
 * (DocCloak.Core/src/regex/). T010 deletes this shim and rewires imports.
 */
export * from '@doccloak/core';
