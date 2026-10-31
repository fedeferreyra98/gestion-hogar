"""Tests de scripts/check_secrets.py. Correr con: make test-hooks

Los "secretos" se construyen en tiempo de ejecución (concatenación/cálculo) para que este
archivo no dispare el propio escáner.
"""
import os
import random
import string
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import check_secrets as cs  # noqa: E402


def rand_alnum(n, seed=1):
    rng = random.Random(seed)
    alphabet = string.ascii_letters + string.digits
    return "".join(rng.choice(alphabet) for _ in range(n))


def make_cuit(prefix="20", body="12345678"):
    d = prefix + body
    weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    s = sum(int(a) * w for a, w in zip(d, weights))
    dv = 11 - (s % 11)
    dv = 0 if dv == 11 else dv
    assert dv != 10
    return d + str(dv)


def make_cbu(seed="1234567" + "123456789012"):
    b1 = seed[:7]
    d1 = (10 - sum(int(a) * w for a, w in zip(b1, [7, 1, 3, 9, 7, 1, 3])) % 10) % 10
    b2 = "9876543210123"
    d2 = (10 - sum(int(a) * w for a, w in zip(b2, [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3])) % 10) % 10
    return b1 + str(d1) + b2 + str(d2)


def make_card(prefix="453201511283036"):
    # calcula dígito Luhn para un número de 16 dígitos
    for check in range(10):
        n = prefix + str(check)
        if cs.luhn_ok(n):
            return n
    raise AssertionError


def rules(line, path="src/App.kt"):
    return {f.rule for f in cs.scan_line(path, 1, line)}


class ProviderKeys(unittest.TestCase):
    def test_aws_key_detected(self):
        self.assertIn("aws-access-key", rules("key = " + "AKIA" + rand_alnum(16).upper()))

    def test_aws_documented_example_is_mock(self):
        self.assertNotIn("aws-access-key", rules("key = " + "AKIAIOSFODNN7" + "EXAMPLE"))

    def test_github_token(self):
        self.assertIn("github-token", rules("x " + "ghp_" + rand_alnum(36)))

    def test_llm_key(self):
        self.assertIn("llm-api-key", rules("k " + "sk-" + "ant-" + rand_alnum(40)))

    def test_private_key_header(self):
        self.assertIn("private-key", rules("-----BEGIN " + "RSA PRIVATE KEY-----"))

    def test_jwt(self):
        tok = "eyJ" + rand_alnum(20) + ".eyJ" + rand_alnum(20) + "." + rand_alnum(20)
        self.assertIn("jwt", rules("t = " + tok))


class Assignments(unittest.TestCase):
    def test_literal_password_flagged(self):
        self.assertIn("secret-assignment", rules('val password = "' + rand_alnum(12) + '"'))

    def test_env_style_flagged(self):
        self.assertIn("secret-assignment", rules("API_KEY=" + rand_alnum(24)))

    def test_mock_value_allowed(self):
        self.assertEqual(set(), rules("JWT_SECRET=dev-only-secret-change-me"))
        self.assertEqual(set(), rules('password: "mock-password-123"'))

    def test_env_references_allowed(self):
        self.assertEqual(set(), rules("password: ${DB_PASSWORD}"))
        self.assertEqual(set(), rules("val secret = System.getenv(\"JWT_SECRET\")"))
        self.assertEqual(set(), rules("val token = config.jwt.secretValue"))

    def test_short_values_ignored(self):
        self.assertEqual(set(), rules("DB_PASSWORD=hogar"))

    def test_url_credentials(self):
        self.assertIn("url-credentials", rules("u = postgres" + "ql://app:" + rand_alnum(14) + "@db.prod.internal/x"))

    def test_url_credentials_localhost_ok(self):
        self.assertEqual(set(), rules("u = postgres" + "ql://hogar:hogarpass1@localhost:5432/hogar"))


class Pii(unittest.TestCase):
    def test_valid_cuit_flagged(self):
        c = make_cuit()
        self.assertIn("cuit-cuil", rules("cuit " + c))
        self.assertIn("cuit-cuil", rules("cuit " + c[:2] + "-" + c[2:10] + "-" + c[10]))

    def test_invalid_cuit_ok(self):
        c = make_cuit()
        bad = c[:10] + str((int(c[10]) + 1) % 10)
        self.assertNotIn("cuit-cuil", rules("cuit " + bad))

    def test_cbu(self):
        cbu = make_cbu()
        self.assertTrue(cs.cbu_ok(cbu))
        self.assertIn("cbu", rules("cbu: " + cbu))
        self.assertNotIn("cbu", rules("cbu: " + "0" * 22))

    def test_card(self):
        self.assertIn("card-number", rules("tarjeta " + make_card()))
        self.assertNotIn("card-number", rules("tarjeta 4111 1111 1111 1111"))  # número de prueba conocido

    def test_timestamp_not_card(self):
        self.assertNotIn("card-number", rules("ts=1730000000000"))

    def test_dni(self):
        self.assertIn("dni", rules("DNI: 30.123.457"))  # allow-secret: fixture del test
        self.assertNotIn("dni", rules("DNI: 11111111"))

    def test_email_domains(self):
        self.assertIn("email", rules("contacto: juan.perez@gmail.com"))  # allow-secret: fixture del test
        self.assertNotIn("email", rules("owner@hogar.local"))
        self.assertNotIn("email", rules("user@example.com"))
        self.assertNotIn("email", rules("implementation 'lodash@4.17.21'"))

    def test_phone_ar(self):
        self.assertIn("phone-ar", rules("tel +54 9 11 5555 1234"))  # allow-secret: fixture del test


class EntropyAndMarkers(unittest.TestCase):
    def test_high_entropy_quoted(self):
        self.assertIn("high-entropy", rules('val x = "' + rand_alnum(40, seed=7) + '"'))

    def test_hash_not_flagged(self):
        self.assertEqual(set(), rules('sha = "' + "a1b2c3d4e5f6" * 4 + '"'))

    def test_lockfile_skipped(self):
        found = cs.scan_line("frontend/package-lock.json", 1, '"integrity": "' + rand_alnum(60, seed=3) + '"')
        self.assertEqual([], found)

    def test_inline_allow_marker(self):
        self.assertEqual(set(), rules("API_KEY=" + rand_alnum(24) + "  # allow-secret: valor mock de ejemplo"))

    def test_allowlist_regex(self):
        allow = cs.Allow([], [cs.re.compile("FIXTURE_KEY")])
        self.assertEqual([], cs.scan_line("a.kt", 1, "FIXTURE_KEY=" + rand_alnum(24), allow))

    def test_snippet_is_redacted(self):
        secret = rand_alnum(24)
        f = cs.scan_line("a.env", 1, "API_KEY=" + secret)[0]
        self.assertNotIn(secret, f.snippet)


class FilesAndDiff(unittest.TestCase):
    def test_blocked_files(self):
        for p in [".env", "backend/.env.local", "certs/server.pem", "db/dump_prod.sql", "x/id_rsa", "credentials.json"]:
            self.assertIsNotNone(cs.blocked_file(p), p)

    def test_allowed_files(self):
        for p in [".env.example", "docs/README.md", "backend/src/Main.kt", "db/migration/V1__init.sql"]:
            self.assertIsNone(cs.blocked_file(p), p)

    def test_parse_diff_line_numbers(self):
        diff = (
            "diff --git a/a.txt b/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1,0 +5,2 @@\n+uno\n+++dos\n"
            "diff --git a/b.txt b/b.txt\n--- /dev/null\n+++ b/b.txt\n@@ -0,0 +1 @@\n+x\n"
        )
        self.assertEqual(list(cs.parse_diff(diff)), [("a.txt", 5, "uno"), ("a.txt", 6, "++dos"), ("b.txt", 1, "x")])


if __name__ == "__main__":
    unittest.main()
