"""Shared test helpers: FakeSupabase (chainable builder stub) and patch_auth (auth bypass)."""

from types import SimpleNamespace
from contextlib import contextmanager
from unittest.mock import patch


class FakeQuery:
    """Chainable query builder. Any method call returns self; .execute() returns data."""
    def __init__(self, data=None):
        self._data = data or []

    def select(self, *_a, **_k):   return self
    def insert(self, row, **_k):   self._data = [{**row, "id": "mock-id-123"}]; return self
    def upsert(self, row, **_k):   self._data = [{**row, "id": "mock-id-123"}]; return self
    def update(self, row, **_k):   self._data = [row]; return self
    def delete(self, **_k):        self._data = []; return self
    def eq(self, *_a, **_k):       return self
    def in_(self, *_a, **_k):      return self
    def order(self, *_a, **_k):    return self
    def limit(self, *_a, **_k):    return self

    def execute(self):
        return SimpleNamespace(data=self._data, error=None)


class FakeSupabase:
    """Stand-in for a Supabase client. Tests set .tables[name] = FakeQuery(data)."""
    def __init__(self):
        self.tables = {}

    def table(self, name):
        return self.tables.get(name, FakeQuery([]))


def make_fake_supabase(tables):
    """tables: {table_name: list_of_rows}. Returns a FakeSupabase pre-populated."""
    sb = FakeSupabase()
    for name, rows in tables.items():
        sb.tables[name] = FakeQuery(list(rows))
    return sb


@contextmanager
def patch_auth(user_id="test-user-uuid", user_email="test@example.com"):
    """Bypass the Supabase auth check in require_auth by short-circuiting get_user."""
    fake_user = SimpleNamespace(
        user=SimpleNamespace(id=user_id, email=user_email)
    )
    fake_client = SimpleNamespace(
        auth=SimpleNamespace(get_user=lambda _token: fake_user)
    )
    with patch("middleware.auth.create_client", return_value=fake_client):
        yield user_id