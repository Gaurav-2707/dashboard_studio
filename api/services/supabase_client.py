"""
Dashify — Shared Supabase Client Provider
Singleton instance to prevent client recreation overhead and reuse TCP connection pools.
"""

import logging
from supabase import create_client, Client

logger = logging.getLogger(__name__)

# Monkeypatch postgrest SyncPostgrestClient to disable HTTP/2.
# Under Python 3.14 on Windows, HTTP/2 connections to Supabase often throw
# [WinError 10035] "A non-blocking socket operation could not be completed immediately".
try:
    from postgrest import SyncPostgrestClient
    from httpx import Client as SyncClient

    def patched_create_session(
        self,
        base_url: str,
        headers: dict,
        timeout: any,
        verify: bool = True,
        proxy: any = None,
    ) -> SyncClient:
        return SyncClient(
            base_url=base_url,
            headers=headers,
            timeout=timeout,
            verify=verify,
            proxy=proxy,
            follow_redirects=True,
            http2=False,  # Force HTTP/1.1 to fix WinError 10035 socket issues
        )

    SyncPostgrestClient.create_session = patched_create_session
    logger.info("Successfully monkeypatched SyncPostgrestClient to disable HTTP/2.")
except Exception as patch_err:
    logger.error(f"Failed to monkeypatch SyncPostgrestClient: {patch_err}")

_supabase_client: Client | None = None

def get_supabase_client(supabase_url: str, supabase_key: str) -> Client:
    """Get or instantiate the global Supabase client."""
    global _supabase_client
    if _supabase_client is None:
        logger.info("Initializing global Supabase client singleton instance.")
        _supabase_client = create_client(supabase_url, supabase_key)
    return _supabase_client

