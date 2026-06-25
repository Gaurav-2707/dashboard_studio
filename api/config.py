"""
Dashify Flask API — Environment Configuration
All secrets loaded from environment variables. Never hardcoded.
"""

import os
import re
from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class Config:
    """Immutable configuration loaded from environment."""

    # Supabase
    SUPABASE_URL: str = os.environ.get("SUPABASE_URL", "")
    SUPABASE_SERVICE_ROLE_KEY: str = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    SUPABASE_JWT_SECRET: str = os.environ.get("SUPABASE_JWT_SECRET", "")

    # CORS — restrict to the frontend origin in production
    ALLOWED_ORIGINS: list[Any] = None  # type: ignore[assignment]

    # Upload limits
    MAX_CONTENT_LENGTH: int = 50 * 1024 * 1024  # 50 MB

    def __post_init__(self):
        # Parse comma-separated origins from env, always including defaults for deployment convenience
        env_origins = os.environ.get("ALLOWED_ORIGINS", "")
        default_origins = "http://localhost:3000,http://localhost:3001,https://dashify-two.vercel.app,https://dashify-*.vercel.app"
        
        origins_raw = f"{env_origins},{default_origins}" if env_origins else default_origins
        
        parsed_origins = []
        for origin in origins_raw.split(","):
            origin_str = origin.strip()
            if not origin_str:
                continue
            if "*" in origin_str:
                # Convert glob wildcard to regex
                escaped = re.escape(origin_str).replace(r"\*", r".*")
                parsed_origins.append(re.compile(f"^{escaped}$"))
            else:
                parsed_origins.append(origin_str)

        object.__setattr__(self, "ALLOWED_ORIGINS", parsed_origins)

    def validate(self) -> list[str]:
        """Return list of missing required env vars."""
        required = {
            "SUPABASE_URL": self.SUPABASE_URL,
            "SUPABASE_SERVICE_ROLE_KEY": self.SUPABASE_SERVICE_ROLE_KEY,
            "SUPABASE_JWT_SECRET": self.SUPABASE_JWT_SECRET,
        }
        return [k for k, v in required.items() if not v]
