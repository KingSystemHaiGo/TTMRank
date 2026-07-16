import json
import tempfile
import unittest
from pathlib import Path

from ttmrank.vendor_registry import build_vendor_registry, canonical_vendor_name, load_vendor_overrides


class VendorRegistryTests(unittest.TestCase):
    def test_curated_maker_identity_requires_an_explicit_official_source(self):
        overrides = load_vendor_overrides(Path(__file__).parents[1] / "config" / "vendor-overrides.json")

        profile = overrides["三颗柚工作室"]
        self.assertEqual(profile.scale, "solo")
        self.assertEqual(profile.account_role, "developer")
        self.assertEqual(profile.verification, "verified")
        self.assertEqual(profile.source, "https://www.taptap.cn/developer/165714")
        self.assertIn("FPS练枪房", profile.note)

    def test_every_vendor_is_recorded_without_guessing_unknown_identity(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "overrides.json"
            path.write_text(json.dumps({"vendors": [{"name": "专业厂商", "scale": "professional", "account_role": "publisher", "verification": "verified", "source": "https://example.com", "note": "已核实"}]}, ensure_ascii=False), encoding="utf-8")
            registry = build_vendor_registry(["个人甲", "专业厂商", "个人甲"], load_vendor_overrides(path))
        by_name = {row["name"]: row for row in registry}
        self.assertEqual(len(registry), 2)
        self.assertEqual(by_name["专业厂商"]["scale"], "professional")
        self.assertEqual(by_name["个人甲"]["verification"], "unverified")
        self.assertEqual(by_name["个人甲"]["account_role"], "unverified")

    def test_nfkc_and_whitespace_folding_are_traceable_without_identity_guessing(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "overrides.json"
            path.write_text(
                json.dumps(
                    {
                        "vendors": [
                            {
                                "name": "ＡＢＣ　发行",
                                "scale": "professional",
                                "account_role": "publisher",
                                "verification": "verified",
                                "source": "https://example.com/abc",
                                "note": "公开来源已核实",
                            }
                        ]
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            raw_aliases = ["  ABC\t发行  ", "ＡＢＣ　发行"]
            registry = build_vendor_registry(raw_aliases, load_vendor_overrides(path))

        self.assertEqual(canonical_vendor_name(raw_aliases[0]), "ABC 发行")
        self.assertEqual(len(registry), 1)
        vendor = registry[0]
        self.assertEqual(vendor["name"], "ABC 发行")
        self.assertEqual(vendor["canonical_name"], "ABC 发行")
        self.assertEqual(vendor["scale"], "professional")
        self.assertEqual(set(vendor["raw_aliases"]), set(raw_aliases))


if __name__ == "__main__":
    unittest.main()
