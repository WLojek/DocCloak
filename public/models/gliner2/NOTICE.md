# model_q8_dynlabels.onnx

A modified file of **okasi/gliner2-privacy-filter-pii-multi-onnx** (commit
`9b451660064ee7e4e8367642633e9d390ea31465`, `model_q8.onnx`), an ONNX export of
**fastino/gliner2-privacy-filter-PII-multi** by Fastino Labs. Both are licensed under the
Apache License 2.0: https://www.apache.org/licenses/LICENSE-2.0

**Change made by DocCloak (2026-11):** the positions of the 7 labels baked into the graph were turned
into an input (`schema_positions`), so the model can be asked for other labels. The weights are not
changed or redistributed: DocCloak downloads `model_q8.onnx.data` from okasi's repository at the commit
above and checks its SHA-256.

SHA-256 of this file: `0e01699516d6ea4d616087dba83b004afb5a20d35494e4cc7b13a8ae2a6a222d` (1,009,556 bytes).
See documentation/model-provenance.md and documentation/model-licenses.md in the DocCloak workspace.
