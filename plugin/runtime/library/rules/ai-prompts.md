---
title: LLM prompts, tools and evals
department: data
stacks: [llm]
paths:
  - "prompts/**"
  - "evals/**"
  - "**/prompts/**"
  - "**/*prompt*.{ts,js,py,md,txt}"
  - "src/**/{ai,llm,agents}/**"
---
- Check the installed SDK version and the provider's current docs for model ids, parameters and features; they change often.
- Keep prompts in versioned files or named constants, not assembled across the codebase; a prompt change is a code change.
- Every prompt, model or parameter change runs the eval set and is compared with the baseline before it merges.
- Keep untrusted content (documents, user input, tool results) in delimited sections, never in the system prompt.
- Anything the model reads may carry instructions (pages, emails, files, tool output); limit what a hijacked run can do.
- Tools get least privilege: only those the task needs, narrow arguments, and confirmation before sending, paying or deleting.
- Treat model output as untrusted input: validate it against a schema; never pass it unescaped into HTML, SQL or a shell.
- Use structured outputs or tool schemas for anything code reads, not regexes over prose.
- Set max tokens and timeouts; retry rate-limit and overload errors with backoff and jitter.
- Check the stop reason on every response; truncated and refused answers need their own handling.
- Agent loops have step and spend limits, log every tool call, and return tool errors to the model as results.
- Stream long answers, show progress and let people cancel.
- Log tokens in and out per call, cache long stable prompt prefixes, and use the smallest model that passes the evals.
- API keys stay on the server; the client never calls a model provider with a secret.
- Don't log prompts or outputs that contain personal data unless the project's retention policy allows it; redact by default.
- Set sampling parameters on purpose and check which ones the chosen model accepts.
- Give the model what the task needs (context, examples, output format, today's date when it matters) and nothing else.
- When the model or provider fails, show a clear message and a retry, never a blank screen or a made-up answer.
- Evals use a frozen set of realistic and adversarial cases, graded by code where possible and by a model with a rubric where not.
