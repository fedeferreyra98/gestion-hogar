#!/usr/bin/env python3
"""Genera issues de GitHub a partir de docs/05-backlog.md. Solo biblioteca estándar + `gh`.

Por defecto es DRY-RUN: no crea ni modifica nada en GitHub.

Uso:
  backlog_issues.py                      # tabla resumen de lo que se crearía
  backlog_issues.py --show BL-108        # cuerpo completo de un issue
  backlog_issues.py --only BL-001,BL-002 # limita a ciertas tareas
  backlog_issues.py --apply              # crea labels, milestones e issues (idempotente)
  backlog_issues.py --refresh-ready          # dry-run: qué issues pasarían a `ready`
  backlog_issues.py --refresh-ready --apply  # aplica el label `ready` a los desbloqueados

Idempotencia: un issue ya existente (título que empieza con "BL-xxx:") se saltea.
El label `ready` indica que todas las dependencias están cerradas y la tarea se puede tomar.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

BACKLOG = "docs/05-backlog.md"

MILESTONES = {
    0: ("Fase 0 — Fundaciones", "Scaffolding, CI, contrato OpenAPI y piezas base."),
    1: ("Fase 1 — MVP", "Listas de compra, histórico de gastos y stock con vencimientos."),
    2: ("Fase 2 — Gastos compartidos y contribución", "Splits, % de contribución por sueldo, balances y liquidaciones."),
    3: ("Fase 3 — Extras", "Multimoneda, notificaciones, tiempo real, cloud."),
}

LABELS = {  # nombre: (color, descripción)
    "backlog": ("5319e7", "Tarea del backlog (docs/05-backlog.md)"),
    "ready": ("0e8a16", "Dependencias cerradas: se puede tomar"),
    "fase:0": ("c5def5", "Fase 0 — Fundaciones"),
    "fase:1": ("bfd4f2", "Fase 1 — MVP"),
    "fase:2": ("d4c5f9", "Fase 2 — Gastos compartidos"),
    "fase:3": ("fef2c0", "Fase 3 — Extras"),
    "size:S": ("c2e0c6", "Modelo barato alcanza"),
    "size:M": ("fbca04", "Modelo intermedio"),
    "size:L": ("d93f0b", "Modelo capaz / revisar con cuidado"),
    "area:backend": ("1d76db", "Kotlin / Spring Boot"),
    "area:frontend": ("0052cc", "React / TypeScript"),
    "area:infra": ("5319e7", "Tooling, CI, Docker"),
    "area:api": ("006b75", "Contrato OpenAPI"),
}

FRONTEND_WORDS = re.compile(r"\bUI\b|Frontend|PWA|Dashboard|Cliente API", re.I)
INFRA_WORDS = re.compile(r"Scaffolding|Localdev|\bCI\b|docker|compose|Despliegue", re.I)

DOC_FILES = {
    "uc": "docs/01-use-cases.md",
    "adr": "docs/02-architecture-decisions.md",
    "dm": "docs/03-domain-model.md",
    "api": "docs/04-api-interfaces.md",
}

HEADER_RX = re.compile(r"^\*\*(BL-\d+) · (.+?) \[([SML])\](?: · (.+?))?\*\* · `(TODO|WIP|DONE)`(.*)$")


@dataclass
class Task:
    id: str
    title: str
    size: str
    deps_raw: str
    status: str
    phase: int
    heading: str
    description: str = ""
    criteria: str = ""
    deps: List[str] = field(default_factory=list)
    needs_mvp: bool = False

    @property
    def area(self) -> str:
        if self.title.lower().startswith("openapi"):
            return "api"
        if INFRA_WORDS.search(self.title):
            return "infra"
        if FRONTEND_WORDS.search(self.title) or "Frontend" in self.heading:
            return "frontend"
        return "backend"

    @property
    def labels(self) -> List[str]:
        return ["backlog", f"fase:{self.phase}", f"size:{self.size}", f"area:{self.area}"] + \
            ([] if self.deps or self.needs_mvp else ["ready"])

    @property
    def issue_title(self) -> str:
        return f"{self.id}: {self.title}"

    @property
    def slug(self) -> str:
        s = unicodedata.normalize("NFKD", self.title).encode("ascii", "ignore").decode()
        return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:40]


# --------------------------------------------------------------------------- parsing
def parse_backlog(text: str) -> List[Task]:
    tasks: List[Task] = []
    phase: Optional[int] = None
    heading = ""
    current: Optional[Task] = None
    body: List[str] = []

    def close() -> None:
        nonlocal current, body
        if current is not None:
            lines = [l.rstrip() for l in body]
            while lines and not lines[0]:
                lines.pop(0)
            while lines and not lines[-1]:
                lines.pop()
            ca_idx = next((i for i, l in enumerate(lines) if l.startswith("CA:")), None)
            desc = lines if ca_idx is None else lines[:ca_idx]
            current.description = "\n".join(desc).strip()
            if ca_idx is not None:
                ca = "\n".join(lines[ca_idx:]).replace("CA:", "", 1).strip()
                current.criteria = ca[:1].upper() + ca[1:]
            tasks.append(current)
        current, body = None, []

    for raw in text.splitlines():
        if raw.startswith("## "):
            close()
            heading = raw[3:].strip()
            m = re.search(r"Fase (\d)", heading)
            phase = int(m.group(1)) if m else None
            continue
        m = HEADER_RX.match(raw)
        if m and phase is not None:
            close()
            current = Task(m.group(1), m.group(2).strip(), m.group(3), (m.group(4) or "").strip(),
                           m.group(5), phase, heading)
            tail = m.group(6).strip()
            if tail.startswith("—"):
                body.append(tail.lstrip("— ").strip())
            continue
        if current is not None:
            if raw.startswith("---") or raw.startswith(">"):
                close()
            else:
                body.append(raw)
    close()

    ids = [t.id for t in tasks]
    for t in tasks:
        t.needs_mvp = bool(re.search(r"\bMVP\b", t.deps_raw)) or t.phase >= 2
        deps: List[str] = []
        for a, b in re.findall(r"(BL-\d+)\.\.(BL-\d+)", t.deps_raw):
            lo, hi = int(a[3:]), int(b[3:])
            deps += [i for i in ids if lo <= int(i[3:]) <= hi]
        plain = re.sub(r"BL-\d+\.\.BL-\d+", "", t.deps_raw)
        deps += re.findall(r"BL-\d+", plain)
        t.deps = [d for i, d in enumerate(deps) if d in ids and d != t.id and d not in deps[:i]]
    return tasks


def topo_order(tasks: List[Task]) -> List[Task]:
    by_id = {t.id: t for t in tasks}
    done: Dict[str, bool] = {}
    out: List[Task] = []

    def visit(t: Task, stack: Tuple[str, ...] = ()) -> None:
        if t.id in done:
            return
        if t.id in stack:
            raise ValueError(f"Ciclo de dependencias: {' -> '.join(stack + (t.id,))}")
        for d in t.deps:
            visit(by_id[d], stack + (t.id,))
        done[t.id] = True
        out.append(t)

    for t in tasks:
        visit(t)
    return out


# --------------------------------------------------------------------------- body
def docs_to_read(t: Task) -> List[str]:
    text = f"{t.description}\n{t.criteria}"
    docs = ["`CLAUDE.md` y `docs/README.md` (convenciones y flujo de trabajo)"]
    ucs = sorted(set(re.findall(r"UC-\d+", text)))
    adrs = sorted(set(re.findall(r"ADR-\d+", text)))
    if ucs:
        docs.append(f"`{DOC_FILES['uc']}` — {', '.join(ucs)}")
    if adrs or t.area == "backend":
        docs.append(f"`{DOC_FILES['adr']}`" + (f" — {', '.join(adrs)}" if adrs else ""))
    if re.search(r"\bDM\b|03-domain", text) or t.area == "backend":
        docs.append(f"`{DOC_FILES['dm']}`")
    if re.search(r"\bAPI\b|04-api", text) or t.area in ("backend", "frontend", "api"):
        docs.append(f"`{DOC_FILES['api']}`")
    docs.append("`docs/06-local-dev.md` (cómo validar) y `docs/07-sensitive-data.md` (datos mock, sin secretos)")
    return docs


def build_body(t: Task, numbers: Dict[str, int]) -> str:
    deps_lines = []
    if t.deps:
        refs = ", ".join(f"#{numbers[d]} ({d})" if d in numbers else d for d in t.deps)
        deps_lines.append(f"Depende de: {refs}.")
    if t.needs_mvp:
        deps_lines.append("Requiere el **MVP completo** (milestone «Fase 1 — MVP» cerrado).")
    if deps_lines:
        deps = " ".join(deps_lines) + " Tomá este issue cuando todo esté cerrado (el label `ready` lo indica)."
    else:
        deps = "Sin dependencias: lista para tomar."
    dep_nums = ",".join(str(numbers[d]) for d in t.deps if d in numbers)
    parts = [
        f"> Tarea **{t.id}** de [`{BACKLOG}`](../blob/main/{BACKLOG}) · {MILESTONES[t.phase][0]} · "
        f"tamaño **{t.size}** · área **{t.area}**",
        "## Descripción\n" + (t.description or "_Ver backlog._"),
        "## Criterios de aceptación\n" + (t.criteria or "_Ver backlog._"),
        "## Dependencias\n" + deps,
        "## Leé antes de empezar\n" + "\n".join(f"- {d}" for d in docs_to_read(t)),
        "## Definition of Done\n"
        "- [ ] Criterios de aceptación cumplidos\n"
        "- [ ] `make verify` en verde (incluye escaneo de secretos); `make smoke` si toca endpoints\n"
        "- [ ] Docs/contrato actualizados si cambió algo (`docs/04-api-interfaces.md`, `api/openapi.yaml`)\n"
        "- [ ] Datos de prueba mock, sin credenciales ni datos reales\n"
        "- [ ] PR con reporte de validación (formato en `docs/06-local-dev.md`) que referencia este issue con `Closes #<número>`",
        f"Rama sugerida: `feature/{t.id}-{t.slug}`",
        f"<!-- backlog-id: {t.id} -->\n<!-- deps: {dep_nums} -->\n<!-- needs-mvp: {int(t.needs_mvp)} -->",
    ]
    return "\n\n".join(parts) + "\n"


# --------------------------------------------------------------------------- gh
def gh(*args: str, input: Optional[str] = None) -> str:
    res = subprocess.run(["gh", *args], input=input, capture_output=True, text=True)
    if res.returncode != 0:
        raise RuntimeError(f"gh {' '.join(args[:3])}… falló: {res.stderr.strip()}")
    return res.stdout


def repo_name(explicit: Optional[str]) -> str:
    return explicit or gh("repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner").strip()


def existing_issues(repo: str) -> Dict[str, int]:
    data = json.loads(gh("issue", "list", "-R", repo, "--state", "all", "--limit", "1000",
                         "--json", "number,title"))
    out: Dict[str, int] = {}
    for i in data:
        m = re.match(r"(BL-\d+):", i["title"])
        if m:
            out[m.group(1)] = i["number"]
    return out


def ensure_labels_and_milestones(repo: str) -> None:
    for name, (color, desc) in LABELS.items():
        gh("label", "create", name, "-R", repo, "--color", color, "--description", desc, "--force")
    have = set(gh("api", f"repos/{repo}/milestones?state=all&per_page=100", "--jq", ".[].title").split("\n"))
    for title, desc in MILESTONES.values():
        if title not in have:
            gh("api", f"repos/{repo}/milestones", "-f", f"title={title}", "-f", f"description={desc}")


def apply_create(tasks: List[Task], repo: str, only: Optional[set]) -> None:
    ensure_labels_and_milestones(repo)
    numbers = existing_issues(repo)
    for t in topo_order(tasks):
        if only and t.id not in only:
            continue
        if t.id in numbers:
            print(f"= {t.id} ya existe (#{numbers[t.id]}), se saltea")
            continue
        url = gh("issue", "create", "-R", repo, "--title", t.issue_title, "--body-file", "-",
                 "--label", ",".join(t.labels), "--milestone", MILESTONES[t.phase][0],
                 input=build_body(t, numbers)).strip()
        numbers[t.id] = int(url.rsplit("/", 1)[1])
        print(f"+ {t.id} -> {url}")


def refresh_ready(repo: str, apply: bool) -> None:
    data = json.loads(gh("issue", "list", "-R", repo, "--state", "all", "--limit", "1000",
                         "--json", "number,state,labels,body,title,milestone"))
    state = {i["number"]: i["state"] for i in data}
    mvp_title = MILESTONES[1][0]
    mvp_done = not any(i["state"] == "OPEN" and (i.get("milestone") or {}).get("title") == mvp_title for i in data)
    changed = 0
    for i in data:
        labels = {l["name"] for l in i["labels"]}
        if i["state"] != "OPEN" or "backlog" not in labels or "ready" in labels:
            continue
        m = re.search(r"<!-- deps: ([\d,]*) -->", i["body"] or "")
        if not m:
            continue
        needs_mvp = "<!-- needs-mvp: 1 -->" in (i["body"] or "")
        deps = [int(x) for x in m.group(1).split(",") if x]
        if all(state.get(d) == "CLOSED" for d in deps) and (mvp_done or not needs_mvp):
            changed += 1
            print(f"{'+' if apply else '~'} #{i['number']} {i['title']} -> ready")
            if apply:
                gh("issue", "edit", str(i["number"]), "-R", repo, "--add-label", "ready")
    print(f"{changed} issue(s) {'marcados' if apply else 'pasarían'} a ready")


# --------------------------------------------------------------------------- cli
def print_table(tasks: List[Task], existing: Dict[str, int]) -> None:
    print(f"{'ID':8} {'Fase':4} {'Sz':2} {'Área':9} {'Ready':5} {'Deps':30} Título")
    for t in tasks:
        deps = ",".join(d[3:] for d in t.deps) or "-"
        deps += "+MVP" if t.needs_mvp else ""
        mark = f" (existe #{existing[t.id]})" if t.id in existing else ""
        print(f"{t.id:8} {t.phase:<4} {t.size:2} {t.area:9} {'sí' if 'ready' in t.labels else '':5} "
              f"{deps[:30]:30} {t.title}{mark}")
    ready = sum("ready" in t.labels for t in tasks)
    print(f"\n{len(tasks)} tareas · {ready} listas para tomar · "
          f"{len(LABELS)} labels · {len(MILESTONES)} milestones")


def main(argv: Optional[List[str]] = None) -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--apply", action="store_true", help="ejecuta los cambios en GitHub (sin esto: dry-run)")
    ap.add_argument("--show", metavar="BL-xxx", help="imprime el issue completo de una tarea")
    ap.add_argument("--only", help="lista de IDs separados por coma")
    ap.add_argument("--repo", help="owner/repo (por defecto el del directorio actual)")
    ap.add_argument("--refresh-ready", action="store_true", help="marca `ready` los issues con dependencias cerradas")
    ap.add_argument("--backlog", default=BACKLOG)
    args = ap.parse_args(argv)

    root = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
    with open(os.path.join(root or ".", args.backlog), encoding="utf-8") as fh:
        tasks = parse_backlog(fh.read())
    topo_order(tasks)  # valida ciclos
    only = set(args.only.split(",")) if args.only else None
    selected = [t for t in tasks if not only or t.id in only]

    if args.refresh_ready:
        refresh_ready(repo_name(args.repo), args.apply)
        return 0
    if args.show:
        t = next((t for t in tasks if t.id == args.show), None)
        if not t:
            print(f"No existe {args.show}", file=sys.stderr)
            return 1
        print(f"TÍTULO: {t.issue_title}\nLABELS: {', '.join(t.labels)}\nMILESTONE: {MILESTONES[t.phase][0]}\n(los números #NNN de dependencias son ilustrativos en este preview)\n")
        print(build_body(t, {d: 100 + int(d[3:]) % 100 for d in t.deps}))
        return 0
    if args.apply:
        apply_create(selected, repo_name(args.repo), only)
        return 0

    try:
        existing = existing_issues(repo_name(args.repo))
    except Exception:  # sin gh o sin red: el dry-run sigue funcionando
        existing = {}
    print("DRY-RUN (agregá --apply para crear en GitHub)\n")
    print_table(selected, existing)
    return 0


if __name__ == "__main__":
    sys.exit(main())
