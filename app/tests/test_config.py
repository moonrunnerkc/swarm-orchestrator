"""Unit tests for environment-driven settings loader (app.config.load_settings)."""

import pytest

from app.config import Settings, load_settings


@pytest.fixture
def clean_env(monkeypatch):
    monkeypatch.delenv("DATABASE_URL", raising=False)
    monkeypatch.delenv("CORS_ORIGINS", raising=False)
    return monkeypatch


def test_defaults_are_applied_when_env_unset(clean_env):
    settings = load_settings()

    assert settings.database_url == "sqlite:////data/app.db"
    assert settings.cors_origins == ()


def test_database_url_is_read_from_env(clean_env):
    clean_env.setenv("DATABASE_URL", "postgresql://u:p@localhost/db")

    settings = load_settings()

    assert settings.database_url == "postgresql://u:p@localhost/db"


def test_single_cors_origin(clean_env):
    clean_env.setenv("CORS_ORIGINS", "https://example.com")

    settings = load_settings()

    assert settings.cors_origins == ("https://example.com",)


def test_multiple_cors_origins_are_split_on_comma(clean_env):
    clean_env.setenv("CORS_ORIGINS", "https://a.com,https://b.com,https://c.com")

    settings = load_settings()

    assert settings.cors_origins == (
        "https://a.com",
        "https://b.com",
        "https://c.com",
    )


def test_cors_origins_strips_whitespace(clean_env):
    clean_env.setenv("CORS_ORIGINS", "  https://a.com ,  https://b.com  ")

    settings = load_settings()

    assert settings.cors_origins == ("https://a.com", "https://b.com")


def test_cors_origins_filters_empty_entries(clean_env):
    clean_env.setenv("CORS_ORIGINS", ",,https://a.com,,")

    settings = load_settings()

    assert settings.cors_origins == ("https://a.com",)


def test_settings_is_frozen_dataclass():
    settings = Settings(database_url="sqlite://", cors_origins=())

    try:
        settings.database_url = "other"  # type: ignore[misc]
    except Exception:
        return

    raise AssertionError("Settings should be frozen/immutable")
