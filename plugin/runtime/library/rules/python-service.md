---
title: Python web services
department: engineering
stacks: [fastapi, django, flask]
paths:
  - "app/**/*.py"
  - "src/**/*.py"
  - "api/**/*.py"
  - "server/**/*.py"
  - "**/views.py"
  - "**/routers/**/*.py"
---
- Check the installed framework and Pydantic versions first; Pydantic 2 and Django majors renamed common APIs.
- Validate input with the framework's schemas (Pydantic, DRF serializers, forms); declare response models so nothing extra leaks.
- FastAPI: an `async def` endpoint must not call blocking libraries; use an async client or make the endpoint a plain `def`.
- Inject the database session, current user and settings through the framework; one session per request, always closed.
- Authenticate every endpoint that needs it and check object-level access (this user may touch this record), not just login.
- Use the ORM or parameterised queries (`cursor.execute(sql, params)`); never format SQL with f-strings or `%`.
- Django: avoid N+1 queries with `select_related` and `prefetch_related`, and assert query counts in tests for hot views.
- Django settings: `DEBUG` off in production, `ALLOWED_HOSTS` and `SECRET_KEY` from the environment, CSRF on for cookie sessions.
- Load settings from the environment and validate them at startup (pydantic-settings, django-environ or the project's choice).
- Every outbound HTTP call sets a timeout; `requests` has none by default.
- Return one consistent error shape with correct status codes and no tracebacks; log the error with a request id.
- Paginate list endpoints; long work goes to the project's task queue, not into the request.
- CORS is an explicit allowlist; rate-limit login, signup and expensive endpoints.
- Model changes ship with a generated, reviewed migration in the same change.
- Run behind a production server (Gunicorn, Uvicorn workers or the platform's own), never the development server.
- Test through the framework's test client against a test database, with factories for the data.
