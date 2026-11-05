"""Repository-owned Schemathesis exceptions for stateful business rejections."""

import schemathesis


RESET_PASSWORD_PATH = "/api/reset-password"
INVALID_OR_EXPIRED_CODE_RESPONSE = {
    "error": "The verification code is invalid or expired."
}


def is_expected_nonexistent_reset_code_rejection(failure, case, response):
    """Match only the known ST202 caused by a schema-valid but unissued reset code.

    JSON Schema validates the six-digit shape, but cannot establish token existence,
    account ownership, expiration, or whether the token was already used.
    """
    if (
        str(case.method).upper() != "POST"
        or case.path != RESET_PASSWORD_PATH
        or getattr(failure, "code", None) != "ST202"
        or "positive_data_acceptance" not in getattr(failure, "checks", ())
        or response.status_code != 400
    ):
        return False
    try:
        return response.json() == INVALID_OR_EXPIRED_CODE_RESPONSE
    except (UnicodeDecodeError, ValueError, TypeError):
        return False


@schemathesis.hook
def filter_failure(ctx, failure, case, response):
    del ctx
    return not is_expected_nonexistent_reset_code_rejection(failure, case, response)
