from __future__ import annotations

import os

os.environ["ENVIRONMENT"] = "test"
os.environ["DATABASE_URL"] = os.environ.get("INTEGRATION_DATABASE_URL", "sqlite://")
os.environ["AUTH_REQUIRED"] = "false"
os.environ["LLM_PROVIDER"] = "none"

from app.db.session import initialize_local_database  # noqa: E402

initialize_local_database()
