#!/usr/bin/env python3
"""Detecta credenciales, API keys y datos personales reales antes de commitear/pushear.

Solo usa la biblioteca estándar. Ver docs/07-sensitive-data.md.

Modos:
  --staged          líneas agregadas en el índice (pre-commit)
  --range BASE HEAD líneas agregadas entre dos commits (pre-push)
  --all             todos los archivos trackeados (CI / make check-secrets)

Convenciones de datos mock (lo que NO se reporta):
  - Valores con un token mock: dev, mock, fake, example, dummy, test, sample, placeholder, ...
  - Emails en dominios reservados: example.com/.org/.net, *.local, *.test, *.invalid
  - Líneas con el marcador `allow-secret` (con motivo) o que matcheen `regex:` en .secrets-allow
Nunca imprime el valor completo del secreto detectado.
"""
from __future__ import annotations

import argparse
import fnmatch
import math
import os
import re
import subprocess
import sys
from collections import Counter
from dataclasses import dataclass
from typing import Callable, Iterable, Iterator, List, Optional, Tuple

MAX_FILE_BYTES = 1_000_000
ALLOW_MARK = "allow-secret"
ALLOW_FILE = ".secrets-allow"

MOCK_TOKENS = {
    "dev", "mock", "fake", "example", "dummy", "changeme", "change", "placeholder",
    "test", "sample", "redacted", "replace", "your", "xxx", "local", "localhost",
}

ALLOWED_EMAIL_DOMAINS = {
    "example.com", "example.org", "example.net",
    "users.noreply.github.com", "noreply.github.com", "anthropic.com",
}
ALLOWED_EMAIL_SUFFIXES = (".local", ".test", ".invalid", ".example", ".localhost")

LOCAL_HOSTS = {"localhost", "127.0.0.1", "0.0.0.0", "postgres", "db", "host.docker.internal"}

# Archivos donde la heurística de entropía genera ruido (hashes de integridad, etc.)
ENTROPY_SKIP_GLOBS = (
    "*package-lock.json", "*pnpm-lock.yaml", "*yarn.lock", "*.lock", "*.lockfile",
    "*.svg", "*.min.js", "*.map", "gradle/*", "*gradle.lockfile",
)


# --------------------------------------------------------------------------- helpers
def is_mock(value: str) -> bool:
    for tok in re.split(r"[^A-Za-z0-9]+", value.lower()):
        if not tok:
            continue
        if tok in MOCK_TOKENS or tok.endswith("example"):
            return True
        if re.fullmatch(r"x{3,}|0+", tok):
            return True
    return False


def redact(value: str) -> str:
    value = value.strip()
    return f"{value[:3]}… ({len(value)} chars)" if len(value) > 6 else "***"


def shannon_entropy(s: str) -> float:
    counts = Counter(s)
    n = len(s)
    return -sum(c / n * math.log2(c / n) for c in counts.values())


def all_same_or_sequential(digits: str) -> bool:
    if len(set(digits)) == 1:
        return True
    return digits in "01234567890123456789" or digits in "98765432109876543210"


def luhn_ok(digits: str) -> bool:
    total, alt = 0, False
    for ch in reversed(digits):
        d = int(ch)
        if alt:
            d *= 2
            if d > 9:
                d -= 9
        total += d
        alt = not alt
    return total % 10 == 0


KNOWN_TEST_CARDS = {
    "4111111111111111", "4242424242424242", "4012888888881881", "5555555555554444",
    "5105105105105100", "378282246310005", "371449635398431", "6011111111111117",
    "3530111333300000", "30569309025904", "4000056655665556",
}


def cuit_ok(raw: str) -> bool:
    d = re.sub(r"\D", "", raw)
    if len(d) != 11 or d[:2] not in {"20", "23", "24", "27", "30", "33", "34"}:
        return False
    if all_same_or_sequential(d):
        return False
    weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
    s = sum(int(a) * w for a, w in zip(d[:10], weights))
    dv = 11 - (s % 11)
    dv = 0 if dv == 11 else dv
    return dv != 10 and dv == int(d[10])


def cbu_ok(raw: str) -> bool:
    d = re.sub(r"\D", "", raw)
    if len(d) != 22 or all_same_or_sequential(d):
        return False

    def dv(block: str, weights: List[int]) -> int:
        s = sum(int(a) * w for a, w in zip(block, weights))
        return (10 - (s % 10)) % 10

    b1, b2 = d[:8], d[8:]
    return dv(b1[:7], [7, 1, 3, 9, 7, 1, 3]) == int(b1[7]) and \
        dv(b2[:13], [3, 9, 7, 1, 3, 9, 7, 1, 3, 9, 7, 1, 3]) == int(b2[13])


def card_ok(raw: str) -> bool:
    d = re.sub(r"\D", "", raw)
    if not 13 <= len(d) <= 19 or d[0] not in "3456":
        return False
    if all_same_or_sequential(d) or d in KNOWN_TEST_CARDS:
        return False
    return luhn_ok(d)


def email_domain_ok(email: str) -> bool:
    domain = email.rsplit("@", 1)[1].lower()
    return domain in ALLOWED_EMAIL_DOMAINS or domain.endswith(ALLOWED_EMAIL_SUFFIXES)


# --------------------------------------------------------------------------- rules
@dataclass
class Rule:
    id: str
    desc: str
    rx: "re.Pattern[str]"
    group: int = 0
    mockable: bool = True
    validator: Optional[Callable[[str], bool]] = None
    skip: Optional[Callable[[str, str, "re.Match[str]"], bool]] = None


def _skip_assignment(value: str, line: str, m: "re.Match[str]") -> bool:
    quote = m.group(2)
    if value[0] in "$<{%@[" or "${" in value:
        return True
    if not quote:
        # identificadores / cadenas de propiedades (config.jwt.secret) o prosa en minúsculas
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)+", value):
            return True
        if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", value) and line[m.end(3):m.end(3) + 1] == "(":
            return True
        if re.fullmatch(r"[a-z]+", value):
            return True
    return False


def _skip_url_creds(value: str, line: str, m: "re.Match[str]") -> bool:
    host = m.group(2).split(":")[0].lower()
    return value[0] in "$<{%" or "${" in value or host in LOCAL_HOSTS or host.endswith(".local")


RULES: List[Rule] = [
    Rule("private-key", "Clave privada", re.compile(r"-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP |ENCRYPTED )?PRIVATE KEY(?: BLOCK)?-----"), mockable=False),
    Rule("aws-access-key", "AWS access key", re.compile(r"\b(?:AKIA|ASIA|AGPA|AIDA|AROA)[A-Z0-9]{16}\b")),
    Rule("github-token", "Token de GitHub", re.compile(r"\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{50,})\b")),
    Rule("slack-token", "Token de Slack", re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}\b")),
    Rule("slack-webhook", "Webhook de Slack", re.compile(r"https://hooks\.slack\.com/services/[A-Za-z0-9/]{20,}"), mockable=False),
    Rule("google-api-key", "API key de Google", re.compile(r"\bAIza[0-9A-Za-z_\-]{35}\b")),
    Rule("stripe-key", "Clave de Stripe", re.compile(r"\b[sr]k_(?:live|test)_[0-9a-zA-Z]{16,}\b")),
    Rule("llm-api-key", "API key de proveedor LLM (sk-...)", re.compile(r"\bsk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}\b")),
    Rule("jwt", "JWT embebido", re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b")),
    Rule("url-credentials", "Credenciales dentro de una URL",
         re.compile(r"\b[a-z][a-z0-9+.-]*://[^\s:/@'\"]+:([^\s@/'\"]+)@([^\s/'\"]+)"), group=1, skip=_skip_url_creds),
    Rule("bearer-token", "Bearer token literal", re.compile(r"(?i)\bbearer\s+([A-Za-z0-9_\-\.=]{20,})"), group=1),
    Rule("secret-assignment", "Asignación de password/secret/token/api key con valor literal",
         re.compile(r"(?i)\b([A-Za-z0-9_.-]*(?:password|passwd|pwd|secret|token|api[_-]?key|apikey|private[_-]?key|access[_-]?key|credential)[A-Za-z0-9_.-]*)[\"']?\s*(?::-|:=|[:=])\s*([\"']?)([^\s\"'`,;(){}\[\]<>]{8,})"),
         group=3, skip=_skip_assignment),
    # --- datos personales (Argentina y genéricos)
    Rule("cuit-cuil", "CUIT/CUIL con dígito verificador válido",
         re.compile(r"(?<![\d-])(?:20|23|24|27|30|33|34)-?\d{8}-?\d(?![\d-])"), validator=cuit_ok, mockable=False),
    Rule("cbu", "CBU con dígitos verificadores válidos", re.compile(r"(?<!\d)\d{22}(?!\d)"), validator=cbu_ok, mockable=False),
    Rule("card-number", "Número de tarjeta (Luhn válido)", re.compile(r"(?<![\d.\-])(?:\d[ -]?){13,19}(?![\d.\-])"), validator=card_ok, mockable=False),
    Rule("dni", "DNI", re.compile(r"(?i)\b(?:dni|documento)\W{0,6}(\d{1,2}\.?\d{3}\.?\d{3})\b"), group=1, mockable=False,
         validator=lambda v: not all_same_or_sequential(re.sub(r"\D", "", v))),
    Rule("phone-ar", "Teléfono argentino",
         re.compile(r"(?<!\d)(?:\+|00)54[\s-]?(?:9[\s-]?)?\d{2,4}[\s-]?\d{2,4}[\s-]?\d{4}(?!\d)"), mockable=False),
    Rule("email", "Email fuera de dominios mock",
         re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)*\.[A-Za-z]{2,}"),
         validator=lambda v: not email_domain_ok(v), mockable=False),
]

ENTROPY_RX = re.compile(r"""(?:(?<=["'])|(?<==)|(?<=: ))([A-Za-z0-9+/_\-=]{32,})(?=["'\s,;]|$)""")

BLOCKED_FILES: List[Tuple["re.Pattern[str]", str]] = [
    (re.compile(r"\.(pem|key|p12|pfx|jks|keystore|ppk|kdbx)$", re.I), "archivo de claves/certificados"),
    (re.compile(r"(^|/)id_(rsa|dsa|ecdsa|ed25519)$"), "clave SSH privada"),
    (re.compile(r"(^|/)(credentials|secrets?)\.(json|ya?ml|properties|toml)$", re.I), "archivo de credenciales"),
    (re.compile(r"(^|/)(\.npmrc|\.netrc|\.pgpass|\.git-credentials)$"), "archivo de credenciales de herramienta"),
    (re.compile(r"\.(dump|sqlite3?|db|bak|tfstate)$", re.I), "dump/base de datos/estado (puede tener datos reales)"),
    (re.compile(r"(^|/)(dump|backup)[^/]*\.sql$", re.I), "dump SQL (puede tener datos reales)"),
]


def blocked_file(path: str) -> Optional[str]:
    base = os.path.basename(path)
    if re.fullmatch(r"\.env(\..+)?", base) and not base.endswith((".example", ".sample", ".template")):
        return "archivo .env real (solo se permite .env.example)"
    for rx, why in BLOCKED_FILES:
        if rx.search(path):
            return why
    return None


# --------------------------------------------------------------------------- allowlist
@dataclass
class Allow:
    path_globs: List[str]
    line_regexes: List["re.Pattern[str]"]


def load_allow(root: str) -> Allow:
    globs: List[str] = []
    regexes: List["re.Pattern[str]"] = []
    try:
        with open(os.path.join(root, ALLOW_FILE), encoding="utf-8") as fh:
            for raw in fh:
                line = raw.strip()
                if not line or line.startswith("#"):
                    continue
                if line.startswith("path:"):
                    globs.append(line[5:].strip())
                elif line.startswith("regex:"):
                    regexes.append(re.compile(line[6:].strip()))
    except FileNotFoundError:
        pass
    return Allow(globs, regexes)


# --------------------------------------------------------------------------- scanning
@dataclass
class Finding:
    path: str
    line: int
    rule: str
    desc: str
    snippet: str


def scan_line(path: str, lineno: int, line: str, allow: Optional[Allow] = None) -> List[Finding]:
    if ALLOW_MARK in line:
        return []
    if allow and any(rx.search(line) for rx in allow.line_regexes):
        return []
    out: List[Finding] = []
    for rule in RULES:
        for m in rule.rx.finditer(line):
            value = m.group(rule.group)
            if rule.mockable and is_mock(value):
                continue
            if rule.validator and not rule.validator(value):
                continue
            if rule.skip and rule.skip(value, line, m):
                continue
            out.append(Finding(path, lineno, rule.id, rule.desc, redact(value)))
    if not any(fnmatch.fnmatch(path, g) for g in ENTROPY_SKIP_GLOBS):
        for m in ENTROPY_RX.finditer(line):
            v = m.group(1)
            if (re.search(r"[a-z]", v) and re.search(r"[A-Z]", v) and re.search(r"\d", v)
                    and shannon_entropy(v) >= 4.3 and not is_mock(v)):
                out.append(Finding(path, lineno, "high-entropy", "Cadena de alta entropía (posible secreto)", redact(v)))
    return out


def scan_path_name(path: str, allow: Optional[Allow] = None) -> List[Finding]:
    why = blocked_file(path)
    return [Finding(path, 0, "blocked-file", why, os.path.basename(path))] if why else []


def scan_added_lines(items: Iterable[Tuple[str, int, str]], allow: Allow) -> List[Finding]:
    findings: List[Finding] = []
    for path, lineno, text in items:
        if any(fnmatch.fnmatch(path, g) for g in allow.path_globs):
            continue
        findings.extend(scan_line(path, lineno, text, allow))
    return findings


def parse_diff(diff_text: str) -> Iterator[Tuple[str, int, str]]:
    """Genera (path, nro_de_línea, texto) por cada línea agregada de un diff -U0."""
    path: Optional[str] = None
    lineno = 0
    in_header = False
    for raw in diff_text.splitlines():
        if raw.startswith("diff --git"):
            in_header, path = True, None
        elif in_header and raw.startswith("+++ "):
            p = raw[4:].split("\t")[0]
            path = None if p == "/dev/null" else (p[2:] if p.startswith("b/") else p)
        elif raw.startswith("@@"):
            in_header = False
            m = re.search(r"\+(\d+)", raw)
            lineno = int(m.group(1)) if m else 0
        elif not in_header and raw.startswith("+"):
            if path:
                yield path, lineno, raw[1:]
            lineno += 1


def git(*args: str, root: Optional[str] = None) -> str:
    res = subprocess.run(["git", "-c", "core.quotepath=false", *args], cwd=root, capture_output=True,
                         text=True, encoding="utf-8", errors="replace")
    if res.returncode != 0:
        raise RuntimeError(f"git {' '.join(args)} falló: {res.stderr.strip()}")
    return res.stdout


def names(*args: str, root: str) -> List[str]:
    return [n for n in git(*args, "-z", root=root).split("\0") if n]


def run_scan(mode: str, root: str, base: str = "", head: str = "") -> List[Finding]:
    allow = load_allow(root)
    findings: List[Finding] = []
    if mode == "all":
        paths = names("ls-files", root=root)
        findings += [f for p in paths if not any(fnmatch.fnmatch(p, g) for g in allow.path_globs)
                     for f in scan_path_name(p)]
        items: List[Tuple[str, int, str]] = []
        for p in paths:
            full = os.path.join(root, p)
            try:
                if not os.path.isfile(full) or os.path.getsize(full) > MAX_FILE_BYTES:
                    continue
                with open(full, "rb") as fh:
                    data = fh.read()
            except OSError:
                continue
            if b"\0" in data:
                continue
            for i, text in enumerate(data.decode("utf-8", errors="replace").splitlines(), 1):
                items.append((p, i, text))
        findings += scan_added_lines(items, allow)
        return findings
    if mode == "staged":
        diff_args = ["--cached"]
    else:
        diff_args = [base, head]
    paths = names("diff", "--name-only", "--diff-filter=ACMR", *diff_args, root=root)
    findings += [f for p in paths if not any(fnmatch.fnmatch(p, g) for g in allow.path_globs)
                 for f in scan_path_name(p)]
    diff = git("diff", "-U0", "--no-color", "--diff-filter=ACMR", *diff_args, root=root)
    findings += scan_added_lines(parse_diff(diff), allow)
    return findings


HELP_TEXT = """
✘ Se detectaron posibles secretos o datos sensibles reales (arriba, valores redactados).

Qué hacer:
  • Credenciales: sacalas del código y leelas de variables de entorno (.env, que no se commitea).
    Si ya estuvo en un commit pusheado, ROTALA: borrarla del historial no alcanza.
  • Datos de prueba: usá valores mock según docs/07-sensitive-data.md
    (tokens dev/mock/fake/example/test en el valor, emails @example.com o @hogar.local,
     CUIT/CBU/tarjetas inválidos o de prueba conocidos).
  • Falso positivo puntual: agregá `allow-secret: <motivo>` en un comentario de esa línea,
    o una regla `path:`/`regex:` en .secrets-allow (se revisa en el PR).
  • No uses --no-verify: el pre-push y el CI repiten este chequeo.
"""


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    g = ap.add_mutually_exclusive_group(required=True)
    g.add_argument("--staged", action="store_true")
    g.add_argument("--all", action="store_true")
    g.add_argument("--range", nargs=2, metavar=("BASE", "HEAD"))
    args = ap.parse_args(argv)

    root = git("rev-parse", "--show-toplevel").strip()
    if args.staged:
        findings = run_scan("staged", root)
    elif args.all:
        findings = run_scan("all", root)
    else:
        findings = run_scan("range", root, *args.range)

    if not findings:
        print("✔ check-secrets: sin hallazgos")
        return 0
    for f in sorted(findings, key=lambda x: (x.path, x.line, x.rule)):
        loc = f"{f.path}:{f.line}" if f.line else f.path
        print(f"  {loc}  [{f.rule}] {f.desc}  → {f.snippet}", file=sys.stderr)
    print(HELP_TEXT, file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
