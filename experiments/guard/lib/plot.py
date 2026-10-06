import pathlib
import runpy
import sys

project = pathlib.Path(__file__).resolve().parents[3]
script = pathlib.Path("/Users/baokker/Work/毕业论文/projects/02-点一_共享终端/资料/实验记录/figures/generate_round3.py")
sys.argv = [str(script), str(project / "experiments/guard/results")]
runpy.run_path(str(script), run_name="__main__")
