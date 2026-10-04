from pathlib import Path
from bs4 import BeautifulSoup

root = Path(__file__).resolve().parents[1]
document = BeautifulSoup((root / "results/deepseek-pricing-20261005.html").read_text(), "html.parser")
print(document.get_text("\n", strip=True))
