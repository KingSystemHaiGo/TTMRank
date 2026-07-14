import os
import unittest
from unittest.mock import patch

from app import server


class ServerSecurityTests(unittest.TestCase):
    def test_default_bind_is_loopback_and_public_mode_disables_mutations(self):
        with patch.dict(os.environ, {}, clear=True):
            config = server.load_security_config()
        self.assertEqual(config.bind_host, "127.0.0.1")
        self.assertFalse(config.public_mode)
        self.assertTrue(config.allow_refresh)

        with patch.dict(os.environ, {"TTMRANK_PUBLIC": "1"}, clear=True):
            public = server.load_security_config()
        self.assertEqual(public.bind_host, "0.0.0.0")
        self.assertFalse(public.allow_refresh)
        self.assertFalse(public.allow_llm)

    def test_llm_url_and_model_are_allowlisted(self):
        with patch.dict(
            os.environ,
            {
                "TTMRANK_LLM_URLS": "https://api.deepseek.com/chat/completions",
                "TTMRANK_LLM_MODELS": "deepseek-chat",
            },
            clear=True,
        ):
            config = server.load_security_config()
        self.assertTrue(config.is_llm_request_allowed("https://api.deepseek.com/chat/completions", "deepseek-chat"))
        self.assertFalse(config.is_llm_request_allowed("http://127.0.0.1:8080/secrets", "deepseek-chat"))
        self.assertFalse(config.is_llm_request_allowed("https://api.deepseek.com/chat/completions", "other-model"))

    def test_cors_only_echoes_configured_origin(self):
        with patch.dict(os.environ, {"TTMRANK_ALLOWED_ORIGINS": "https://example.com"}, clear=True):
            config = server.load_security_config()
        self.assertEqual(config.cors_origin("https://example.com"), "https://example.com")
        self.assertIsNone(config.cors_origin("https://evil.example"))


if __name__ == "__main__":
    unittest.main()
