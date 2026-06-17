"""
Dashify Flask API — Environment Configuration
All secrets loaded from environment variables. Never hardcoded.
"""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Config:
    """Immutable configuration loaded from environment."""

    # Supabase
    SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_JWT_SECRET: str = os.environ.get("SUPABASE_JWT_SECRET", "")

    # CORS — restrict to the frontend origin in production
    ALLOWED_ORIGINS: list[str] = None  # type: ignore[assignment]

    # Upload limits
    MAX_CONTENT_LENGTH: int = 50 * 1024 * 1024  # 50 MB

    def __post_init__(self):
        # Parse comma-separated origins from env
        origins_raw = os.environ.get("ALLOWED_ORIGINS", "http://localhost:3000")
        object.__setattr__(self, "ALLOWED_ORIGINS", [o.strip() for o in origins_raw.split(",")])

    def validate(self) -> list[str]:
        """Return list of missing required env vars."""
        required = {
            "SUPABASE_URL": self.SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": self.SUPABASE_SERVICE_ROLE_KEY,
            "SUPABASE_JWT_SECRET": self.SUPABASE_JWT_SECRET,
        }
        return [k for k, v in required.items() if not v]
