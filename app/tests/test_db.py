"""Unit tests for the database probe — success path against real SQLite and failure path for bad URLs."""

from app.db import DatabaseStatus, make_engine, ping_database


class TestPingDatabaseSuccess:
    def test_returns_connected_true_against_real_sqlite(self):
        engine = make_engine("sqlite:///:memory:")

        result = ping_database(engine)

        assert result.connected is True
        assert result.error is None

    def test_latency_is_non_negative_float_on_success(self):
        engine = make_engine("sqlite:///:memory:")

        result = ping_database(engine)

        assert isinstance(result.latency_ms, float)
        assert result.latency_ms >= 0.0

    def test_latency_is_rounded_to_two_decimals(self):
        engine = make_engine("sqlite:///:memory:")

        result = ping_database(engine)

        assert result.latency_ms is not None
        rendered = f"{result.latency_ms:.10f}".rstrip("0").rstrip(".")
        decimals = rendered.split(".")[1] if "." in rendered else ""
        assert len(decimals) <= 2


class TestPingDatabaseFailure:
    def test_returns_connected_false_when_driver_cannot_open(self):
        engine = make_engine("sqlite:////nonexistent/definitely/not/a/real/path.db")

        result = ping_database(engine)

        assert result.connected is False
        assert result.latency_ms is None
        assert result.error is not None
        assert len(result.error) > 0

    def test_failure_returns_plain_dataclass(self):
        engine = make_engine("sqlite:////nonexistent/definitely/not/a/real/path.db")

        result = ping_database(engine)

        assert isinstance(result, DatabaseStatus)


class TestDatabaseStatusDataclass:
    def test_is_frozen(self):
        status = DatabaseStatus(connected=True, latency_ms=1.0, error=None)

        try:
            status.connected = False  # type: ignore[misc]
        except Exception:
            return

        raise AssertionError("DatabaseStatus should be frozen/immutable")

    def test_equality_by_value(self):
        a = DatabaseStatus(connected=True, latency_ms=1.5, error=None)
        b = DatabaseStatus(connected=True, latency_ms=1.5, error=None)
        c = DatabaseStatus(connected=False, latency_ms=None, error="x")

        assert a == b
        assert a != c
