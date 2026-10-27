"""PlanLab's Python worker: runs your Python functions (the Python tab) in this Python.

The PlanLab VS Code extension starts it with the Python selected in VS Code (Python: Select Interpreter), so a
virtual environment's packages are available to your functions. It talks to the extension only, through its
standard input and output: one JSON request per line in, one JSON answer per line out. No network port is used.

Requests:
    {"id": 1, "op": "status"}                    which Python this is
    {"id": 2, "op": "load", "source": "...", "folder": "..."}   runs the Python tab in a fresh namespace → {functions}
                                                 or {error}; modules in folder (python/ in your PlanLab folder) can be imported
    {"id": 3, "op": "start", "seed": 177}        a run starts: seeds Python's random module, so runs can be repeated
    {"id": 4, "op": "call", "name": "f", "args": [...]}   calls one of your functions → {result, output} or {error, output}

Values travel as JSON. Points are {"$point": [x, y], "$h": handle}; trees, graphs, sets, maps and queues are
{"$handle": n}, which your function can pass back unchanged; ∞ is {"$inf": 1}; failure is {"$failure": true}.
What your functions print() is sent back as "output" and shown in PlanLab's Output tab.
"""
import contextlib
import io
import json
import math
import os
import platform
import random
import signal
import sys
import traceback

FILENAME = "<python tab>"                         # how tracebacks name the code from the Python tab
CALL_TIME_LIMIT = float(os.environ.get("PLANLAB_CALL_LIMIT", 10))   # seconds one call may take (where the OS allows it)


# ---------------------------------------------------------------- what your functions get

class Point:
    """A point (x, y), as in the pseudocode: p.x, p.y, x, y = p, and + - between points, * / by a number."""
    __slots__ = ("x", "y", "_h")

    def __init__(self, x, y, _h=None):
        self.x, self.y, self._h = x, y, _h

    def __iter__(self):
        yield self.x
        yield self.y

    def __getitem__(self, i):
        return (self.x, self.y)[i]

    def __len__(self):
        return 2

    def __add__(self, o):
        return Point(self.x + o[0], self.y + o[1])

    __radd__ = __add__

    def __sub__(self, o):
        return Point(self.x - o[0], self.y - o[1])

    def __rsub__(self, o):
        return Point(o[0] - self.x, o[1] - self.y)

    def __mul__(self, k):
        return Point(self.x * k, self.y * k)

    __rmul__ = __mul__

    def __truediv__(self, k):
        return Point(self.x / k, self.y / k)

    def __neg__(self):
        return Point(-self.x, -self.y)

    def __eq__(self, o):
        try:
            return len(o) == 2 and self.x == o[0] and self.y == o[1]
        except TypeError:
            return False

    def __hash__(self):
        return hash((self.x, self.y))

    def __repr__(self):
        return f"({self.x:g}, {self.y:g})"


class Handle:
    """A tree, graph, set, map or queue from the pseudocode. Pass it back unchanged; it can't be looked into."""
    __slots__ = ("n", "kind")

    def __init__(self, n, kind):
        self.n, self.kind = n, kind

    def __repr__(self):
        return f"<{self.kind} from the pseudocode>"


class Failure:
    def __repr__(self):
        return "failure"

    def __bool__(self):
        return False


failure = Failure()


def dist(a, b):
    """Straight-line distance between two points."""
    return math.hypot(a[0] - b[0], a[1] - b[1])


def norm(p):
    """Length of the vector p."""
    return math.hypot(p[0], p[1])


def steer(a, b, step):
    """The point at most step away from a, heading toward b (b itself if it is closer)."""
    d = dist(a, b)
    if d <= step:
        return Point(b[0], b[1])
    return Point(a[0] + (b[0] - a[0]) * step / d, a[1] + (b[1] - a[1]) * step / d)


HELPERS = {"Point": Point, "failure": failure, "inf": math.inf, "dist": dist, "norm": norm, "steer": steer}


# ---------------------------------------------------------------- values in and out

def from_json(v):
    if isinstance(v, list):
        return [from_json(x) for x in v]
    if isinstance(v, dict):
        if "$point" in v:
            return Point(v["$point"][0], v["$point"][1], v.get("$h"))
        if "$handle" in v:
            return Handle(v["$handle"], v.get("kind", "value"))
        if "$inf" in v:
            return math.inf if v["$inf"] > 0 else -math.inf
        if "$failure" in v:
            return failure
        if "$region" in v:
            return dict(v["$region"])
    return v


def to_json(v, name):
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, (int, float)):
        if math.isinf(v):
            return {"$inf": 1 if v > 0 else -1}
        if math.isnan(v):
            raise ValueError(f"{name}() returned NaN (not a number)")
        return v
    if v is failure:
        return {"$failure": True}
    if isinstance(v, Point):
        out = {"$point": [v.x, v.y]}
        if v._h is not None:
            out["$h"] = v._h
        return out
    if isinstance(v, Handle):
        return {"$handle": v.n}
    if isinstance(v, tuple) and len(v) == 2 and all(isinstance(c, (int, float)) and not isinstance(c, bool) for c in v):
        return {"$point": [v[0], v[1]]}                      # (x, y) is a point, as in the pseudocode
    if isinstance(v, (list, tuple)):
        return [to_json(x, name) for x in v]
    try:                                                      # numpy numbers and arrays, if numpy is used
        import numpy
        if isinstance(v, numpy.generic):
            return to_json(v.item(), name)
        if isinstance(v, numpy.ndarray):
            return to_json(v.tolist(), name)
    except ImportError:
        pass
    raise TypeError(f"{name}() returned a {type(v).__name__}, which the pseudocode can't use. "
                    "Return numbers, true/false, text, points, (x, y), lists, or failure.")


# ---------------------------------------------------------------- your code

namespace = {}


def error_info(exc):
    """{message, line}: the line is in the Python tab, from the innermost frame that is there."""
    line = None
    if isinstance(exc, SyntaxError) and exc.filename == FILENAME:
        line = exc.lineno
    else:
        for frame in traceback.extract_tb(exc.__traceback__):
            if frame.filename == FILENAME:
                line = frame.lineno
    message = f"{type(exc).__name__}: {exc}" if str(exc) else type(exc).__name__
    return {"message": message, "line": line}


@contextlib.contextmanager
def time_limit(seconds):
    """Stops a call that runs too long (a loop that never ends), where the system has SIGALRM."""
    if not hasattr(signal, "setitimer"):
        yield
        return

    def stop(signum, frame):
        raise TimeoutError(f"stopped after {seconds} s: does a loop never end?")
    old = signal.signal(signal.SIGALRM, stop)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, old)


def load(source):
    global namespace
    fresh = {"__name__": "planlab_python", **HELPERS}
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out), time_limit(CALL_TIME_LIMIT):
            exec(compile(source, FILENAME, "exec"), fresh)
    except BaseException as exc:                              # a syntax error, or an error at the top level
        return {"error": error_info(exc), "output": out.getvalue()}
    namespace = fresh
    functions = [n for n, f in fresh.items() if callable(f) and getattr(f, "__code__", None) is not None
                 and f.__code__.co_filename == FILENAME]
    return {"functions": functions, "output": out.getvalue()}


def call(name, args):
    fn = namespace.get(name)
    if not callable(fn):
        return {"error": {"message": f"there is no Python function called {name}(). Is the Python tab loaded?", "line": None}}
    out = io.StringIO()
    try:
        with contextlib.redirect_stdout(out), time_limit(CALL_TIME_LIMIT):
            result = fn(*[from_json(a) for a in args])
        return {"result": to_json(result, name), "output": out.getvalue()}
    except BaseException as exc:
        return {"error": error_info(exc), "output": out.getvalue()}


def status():
    return {"python": platform.python_version(), "executable": sys.executable,
            "venv": sys.prefix != getattr(sys, "base_prefix", sys.prefix), "prefix": sys.prefix}


# ---------------------------------------------------------------- talking to the extension

def answer(request):
    op = request.get("op")
    if op == "status":
        return status()
    if op == "load":
        folder = request.get("folder")   # the folder of python/functions.py: its other modules can be imported
        if folder and folder not in sys.path:
            sys.path.insert(0, folder)
        return load(str(request.get("source", "")))
    if op == "start":
        random.seed(request.get("seed"))
        return {"ok": True}
    if op == "call":
        return call(str(request.get("name")), request.get("args") or [])
    return {"error": {"message": f"unknown request {op!r}", "line": None}}


def main():
    # Answers go out on a copy of the standard output; anything else that writes to it (a C library, say)
    # goes to standard error instead, so it can't break the answers.
    replies = os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8")
    os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            reply = answer(request)
        except Exception as exc:                              # a request it couldn't read
            request, reply = {}, {"error": {"message": f"PlanLab's Python worker: {exc}", "line": None}}
        reply["id"] = request.get("id")
        replies.write(json.dumps(reply) + "\n")
        replies.flush()


if __name__ == "__main__":
    main()
