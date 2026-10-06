import pathlib
from bs4 import BeautifulSoup

root = pathlib.Path(__file__).resolve().parents[3]
source = root / ".experiment-data/opencode-permissions.html"
content = BeautifulSoup(source.read_text(), "html.parser")
print(content.get_text("\n", strip=True))
