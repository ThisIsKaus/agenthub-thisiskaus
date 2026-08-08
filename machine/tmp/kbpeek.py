import lancedb
from pathlib import Path

t = lancedb.connect(str(Path.home() / "AgentHub/kb")).open_table("kb_main")
df = t.to_pandas()

p = df[df["path"].str.contains("Payslip", case=False, na=False)]
print(f"  {len(p)} payslip chunks from {p['path'].nunique()} files\n")
for _, r in p.head(2).iterrows():
    print("  FILE:", Path(r["path"]).name)
    print("  TEXT:", repr(r["text"][:180]))
    print()

rm = df[df["path"].str.endswith("README.md")]
print(f"  {rm['path'].nunique()} distinct README.md files")
for x in list(rm["path"].unique())[:4]:
    print("   ", str(x).replace(str(Path.home()), "~"))
