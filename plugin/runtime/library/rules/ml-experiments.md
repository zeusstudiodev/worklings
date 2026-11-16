---
title: ML experiments and notebooks
department: data
stacks: [pytorch, tensorflow, sklearn, pandas, jupyter]
paths:
  - "notebooks/**"
  - "**/*.ipynb"
  - "experiments/**"
  - "training/**"
  - "pipelines/**"
  - "configs/**"
  - "src/**/*.py"
---
- Split the data before fitting anything; scalers, encoders, vocabularies and feature selection fit on the training split only.
- Split by the unit that matters (user, session, group, time) when rows are related; forecasts split by time, never at random.
- Tune on validation; touch the held-out test set once, for the number you report.
- Start from a baseline (majority class, linear model, last value, the current production model) and report gains against it.
- Pick the metric that matches the goal (PR-AUC or F1 for rare classes, not accuracy) and report it for every important slice.
- Seed every source of randomness and note what stays nondeterministic (GPU kernels, data-loader order).
- Every run records the git commit, config, data version or hash, seed, environment and metrics in the project's tracker.
- Experiments read their settings from config files, not from constants edited inside a notebook.
- Report variance with several seeds or confidence intervals; don't claim a gain that sits inside the noise.
- Compare models on the same data version, split and metric code; changing the evaluation code starts a new baseline.
- Validate input data where the pipeline starts (schema, ranges, nulls, duplicates) and fail loudly on surprises.
- Notebooks explore; reusable code moves into tested modules. A notebook must run top to bottom in a fresh kernel.
- Strip notebook outputs before committing unless the outputs are the record; never commit datasets or weights to git.
- pandas: vectorise, set dtypes on load, avoid chained assignment, and check row counts after every join.
- Training checkpoints regularly and can resume; evaluation runs in eval mode with gradients off.
- Run a smoke test on a tiny subset before any long or paid job, and estimate its time and cost.
- Personal data in datasets is minimised and pseudonymised, and its use matches the project's data policy.
