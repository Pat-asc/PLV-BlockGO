import importlib
import sys
import types
import unittest
from unittest.mock import patch


class Value:
    def __init__(self, **values):
        self.__dict__.update(values)


class Response(Value):
    def json(self):
        if isinstance(self.body, Exception):
            raise self.body
        return self.body


def load_hooks():
    fake_schemathesis = types.SimpleNamespace(hook=lambda function: function)
    with patch.dict(sys.modules, {"schemathesis": fake_schemathesis}):
        sys.modules.pop("security.schemathesis_hooks", None)
        return importlib.import_module("security.schemathesis_hooks")


class SchemathesisHookTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hooks = load_hooks()

    def call(self, *, method="POST", path="/api/reset-password", code="ST202",
             checks=("positive_data_acceptance",), status=400, body=None):
        body = body if body is not None else dict(self.hooks.INVALID_OR_EXPIRED_CODE_RESPONSE)
        return self.hooks.filter_failure(
            None,
            Value(code=code, checks=checks),
            Value(method=method, path=path),
            Response(status_code=status, body=body),
        )

    def test_filters_only_the_exact_nonexistent_code_business_rejection(self):
        self.assertFalse(self.call())

    def test_keeps_other_methods_paths_failure_codes_statuses_and_bodies(self):
        variants = [
            {"method": "GET"},
            {"path": "/api/forgot-password"},
            {"code": "ST201"},
            {"checks": ("not_a_server_error",)},
            {"status": 422},
            {"body": {"error": "A different validation error."}},
            {"body": {**self.hooks.INVALID_OR_EXPIRED_CODE_RESPONSE, "extra": True}},
        ]
        for variant in variants:
            with self.subTest(variant=variant):
                self.assertTrue(self.call(**variant))

    def test_keeps_non_json_responses(self):
        self.assertTrue(self.call(body=ValueError("not json")))


if __name__ == "__main__":
    unittest.main()
