# Tools used

- **ChatGPT:** architecture discussion, debugging, evaluation reasoning, trade-off discussion, and review of submission requirements.
- **Codex:** repository inspection, implementation and editing, lint/type/build checks, targeted reliability fixes, evaluation tooling, and documentation drafting.

# What was delegated

AI assisted with implementation scaffolding and targeted code changes, including deterministic pipeline integration, strict structured-output validation, atomic checkpoint/resume behavior, dashboard implementation and polish, the evaluation script, failure reporting, and submission-document drafting.

# What I stayed responsible for

I remained responsible for interpreting the assignment, choosing and limiting scope, manually labeling evaluation examples, deciding the taxonomy and trade-offs, reviewing generated code and outputs, running and inspecting evaluation results, and deciding what shipped. AI output was treated as a draft or implementation proposal that required verification rather than as an authority.

# Example prompts

1. “Build a conservative deterministic cleaning and cross-source deduplication pipeline before sending reviews to the LLM.”
2. “Add strict structured-output validation with atomic checkpoint/resume so failed batches never corrupt progress.”
3. “Evaluate predictions against manually labeled reviews and report sentiment accuracy, issue precision/recall/F1, severity agreement, and observed failure categories.”

# Where AI got it wrong

The initial LLM output contract asked the model to reproduce review IDs. During the full run, Groq repeatedly returned an unexpected, hallucinated ID for the same batch. Retries could not correct the deterministic failure. Strict validation did its job: it rejected the entire response and prevented invalid results from reaching the checkpoint. The contract was then changed so the model returns one ID-free result per input review in order, and the application attaches trusted IDs locally after validating the complete batch.

An earlier batch size was also too large: the model returned fewer results than requested. Strict count validation rejected that response, and the batch size was reduced to five. Both incidents reinforced the need to constrain and verify model output rather than trusting syntactically valid JSON.
