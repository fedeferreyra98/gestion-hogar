"""Tests de scripts/backlog_issues.py (parseo y generación; no usan GitHub)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
import backlog_issues as bi  # noqa: E402

SAMPLE = """\
## Fase 0 — Fundaciones

**BL-001 · Scaffolding del monorepo [S] · —** · `TODO`
Crear estructura.
CA: estructura creada.

**BL-002 · Backend base [S] · BL-001** · `TODO`
Gradle y Spring (ver ADR-003, UC-01).
CA: build pasa.

---

## Fase 1 (MVP) — Frontend

**BL-150 · Auth UI [M] · BL-001, BL-002** · `TODO`
Pantallas.
CA: tests.

**BL-151 · Listas UI [M] · BL-150..BL-150** · `TODO`
Listas.

**BL-152 · Pulido [M] · BL-150..BL-151** · `TODO`
Rango.

---

## Fase 2 — Compartidos

**BL-201 · Migración splits [M] · MVP** · `TODO`
Tablas.
CA: constraints.

**BL-301 · Diseño [M]** · `TODO` — ADR nuevo.

> **Nota**: ignorada

## Orden sugerido

**BL-999 · No debe parsearse [S]** · `TODO`
"""


class Parse(unittest.TestCase):
    def setUp(self):
        self.tasks = {t.id: t for t in bi.parse_backlog(SAMPLE)}

    def test_all_tasks_found_and_orphan_ignored(self):
        self.assertEqual(set(self.tasks), {"BL-001", "BL-002", "BL-150", "BL-151", "BL-152", "BL-201", "BL-301"})

    def test_fields(self):
        t = self.tasks["BL-002"]
        self.assertEqual((t.size, t.phase, t.deps), ("S", 0, ["BL-001"]))
        self.assertEqual(t.criteria, "Build pasa.")
        self.assertIn("Gradle", t.description)

    def test_dash_means_no_deps(self):
        self.assertEqual(self.tasks["BL-001"].deps, [])

    def test_ranges_expand(self):
        self.assertEqual(self.tasks["BL-152"].deps, ["BL-150", "BL-151"])

    def test_inline_description_after_header(self):
        self.assertEqual(self.tasks["BL-301"].description, "ADR nuevo.")

    def test_mvp_gating(self):
        self.assertTrue(self.tasks["BL-201"].needs_mvp)
        self.assertTrue(self.tasks["BL-301"].needs_mvp)  # fase >= 2
        self.assertFalse(self.tasks["BL-150"].needs_mvp)

    def test_ready_label_only_without_deps(self):
        self.assertIn("ready", self.tasks["BL-001"].labels)
        self.assertNotIn("ready", self.tasks["BL-002"].labels)
        self.assertNotIn("ready", self.tasks["BL-201"].labels)

    def test_area(self):
        self.assertEqual(self.tasks["BL-150"].area, "frontend")
        self.assertEqual(self.tasks["BL-001"].area, "infra")
        self.assertEqual(self.tasks["BL-002"].area, "backend")


class OrderAndBody(unittest.TestCase):
    def test_topo_order_respects_deps(self):
        order = [t.id for t in bi.topo_order(bi.parse_backlog(SAMPLE))]
        for t in bi.parse_backlog(SAMPLE):
            for d in t.deps:
                self.assertLess(order.index(d), order.index(t.id))

    def test_cycle_detected(self):
        a = bi.Task("BL-1", "a", "S", "", "TODO", 0, "h", deps=["BL-2"])
        b = bi.Task("BL-2", "b", "S", "", "TODO", 0, "h", deps=["BL-1"])
        with self.assertRaises(ValueError):
            bi.topo_order([a, b])

    def test_body_has_required_sections_and_markers(self):
        t = {t.id: t for t in bi.parse_backlog(SAMPLE)}["BL-150"]
        body = bi.build_body(t, {"BL-001": 1, "BL-002": 2})
        for s in ["## Descripción", "## Criterios de aceptación", "## Dependencias", "## Definition of Done",
                  "#1 (BL-001), #2 (BL-002)", "<!-- backlog-id: BL-150 -->", "<!-- deps: 1,2 -->"]:
            self.assertIn(s, body)

    def test_multiline_blocks_and_bullet_criteria(self):
        text = ("## Fase 1 — X\n\n**BL-010 · Tarea [S] · —** · `TODO`\n**Objetivo.** Algo (UC-13).\n\n"
                "**Alcance.**\n- uno\n- dos\n\nCA:\n- primero\n- segundo\n")
        t = bi.parse_backlog(text)[0]
        self.assertEqual(t.criteria, "- primero\n- segundo")
        self.assertTrue(t.description.endswith("- dos"))
        self.assertIn("UC-13", "\n".join(bi.docs_to_read(t)))

    def test_sync_plan(self):
        t = {t.id: t for t in bi.parse_backlog(SAMPLE)}["BL-150"]
        numbers = {"BL-001": 1, "BL-002": 2}
        fresh = {"title": t.issue_title, "body": bi.build_body(t, numbers).replace("\n", "\r\n"),
                 "labels": [{"name": l} for l in t.labels + ["ready"]]}
        self.assertEqual(bi.sync_plan(t, fresh, numbers), {})
        stale = {"title": "BL-150: viejo", "body": "viejo",
                 "labels": [{"name": "size:L"}, {"name": "ready"}, {"name": "backlog"}]}
        plan = bi.sync_plan(t, stale, numbers)
        self.assertEqual(plan["title"], t.issue_title)
        self.assertIn("<!-- deps: 1,2 -->", plan["body"])
        self.assertEqual(plan["remove"], ["size:L"])
        self.assertNotIn("ready", plan["add"])
        self.assertIn(f"size:{t.size}", plan["add"])

    def test_real_backlog_parses_and_is_acyclic(self):
        root = os.path.join(os.path.dirname(__file__), "..", "..")
        with open(os.path.join(root, bi.BACKLOG), encoding="utf-8") as fh:
            tasks = bi.parse_backlog(fh.read())
        bi.topo_order(tasks)
        ids = [t.id for t in tasks]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreater(len(ids), 40)
        for t in tasks:
            self.assertTrue(t.criteria or t.description, t.id)
            self.assertIn(t.phase, bi.MILESTONES)


if __name__ == "__main__":
    unittest.main()
