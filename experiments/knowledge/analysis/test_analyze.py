import tempfile
import unittest
from pathlib import Path

import pandas as pd

from analyze import analyze_agent, analyze_ratings, majority_table, paired_tests


class AnalysisTests(unittest.TestCase):
    def setUp(self):
        workspace = Path(__file__).resolve().parents[1] / ".work"
        workspace.mkdir(exist_ok=True)
        self.temporary = tempfile.TemporaryDirectory(dir=workspace)
        self.directory = Path(self.temporary.name)

    def tearDown(self):
        self.temporary.cleanup()

    def test_exact_mcnemar(self):
        result = paired_tests([1] * 8, [0] * 8)
        self.assertEqual(result["mcnemar_p"], 2 / 256)
        self.assertEqual(result["difference"], -1)

    def test_tied_majorities_have_no_inference(self):
        frame = pd.DataFrame([
            {"task": "one", "condition": "C0", "functional": value, "trapAvoided": value, "jointSuccess": value, "usage": None}
            for value in [True, False]
        ])
        self.assertIsNone(majority_table(frame).iloc[0].jointSuccess)
        self.assertEqual(analyze_agent(frame, self.directory), [])

    def test_timing_variants_are_separate(self):
        frame = pd.DataFrame([
            {"task": "pair", "condition": "T0", "variant": variant, "functional": value, "trapAvoided": value, "jointSuccess": value, "usage": None}
            for variant, value in [("delayed", True), ("same-session", False)]
        ])
        rows = analyze_agent(frame, self.directory)
        success = {row["variant"]: row["mean"] for row in rows if row["metric"] == "jointSuccess"}
        self.assertEqual(success, {"delayed": 1, "same-session": 0})

    def test_rating_ids_must_match(self):
        first = pd.DataFrame([{"id": "first", "draft": "相同草稿"}])
        second = pd.DataFrame([{"id": "second", "draft": "相同草稿"}])
        a, b = self.directory / "a.csv", self.directory / "b.csv"
        first.to_csv(a, index=False); second.to_csv(b, index=False)
        with self.assertRaisesRegex(ValueError, "same draft ids"):
            analyze_ratings(a, b, self.directory)

    def test_rating_text_must_match(self):
        a, b = self.directory / "a.csv", self.directory / "b.csv"
        pd.DataFrame([{"id": "one", "draft": "第一份草稿"}]).to_csv(a, index=False)
        pd.DataFrame([{"id": "one", "draft": "第二份草稿"}]).to_csv(b, index=False)
        with self.assertRaisesRegex(ValueError, "identical draft text"):
            analyze_ratings(a, b, self.directory)


if __name__ == "__main__":
    unittest.main()
