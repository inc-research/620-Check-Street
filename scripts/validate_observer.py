"""
validate_observer.py — check any folder against OBSERVER Format 0.1.
 
This is a conformance checker, not a replication checker. It answers "is this a
well-formed OBSERVER Folder?", never "are these numbers right?" — only the
published formulas, run over the raw rows, can answer that, and how far to
carry that replication is the consumer's decision (§14).
 
    python3 validate_observer.py path/to/OBSERVER/
    python3 validate_observer.py path/to/OBSERVER/ --quiet   # failures and warnings only
 
It knows nothing about any particular analysis, touches no network, and needs
only Python 3.10+ and PyYAML. Every check names the section of the spec it comes
from, so a failure tells you what to read.
 
It reads the raw data only as far as each file's header row. It never reads the
full data set: that is reserved, by the raw data reading notice (§3.4.4), for
verification a user or workflow explicitly asks for. The rules this leaves
unchecked are listed at the end of every run.
 
Exit status is 0 when every rule passes, 1 otherwise. A warning never fails the
run: it marks something the spec recommends (SHOULD) rather than requires.
"""
from __future__ import annotations
 
import argparse
import ast
import csv
import os
import re
import sys
 
import yaml
 
INDEX, LOG = "1.0_INDEX.md", "1.1_LOG.md"
VALENCE, PERCEPTION = "2.0_VALENCE.md", "3.0_PERCEPTION.md"
ENTRY_FILES = ("README.md", "AGENTS.md", "CLAUDE.md")
REFERENCES = "references"
 
TYPES = {INDEX: "OBSERVER Index", LOG: "OBSERVER Log", VALENCE: "OBSERVER Valence",
         PERCEPTION: "OBSERVER Perception"}
 
# Two fixed phrases from the §3.4.4 notice. Every copy of the notice must also
# carry the file's path and its "<rows> rows × <columns> columns".
NOTICE_MARK = "Trust verification with select columns and rows only."
NOTICE_TAIL = "programmatically mandated by the assigned workflow."
 
DISCLOSURES = ("open", "proprietary")
 
INDEX_REQUIRED = ["type", "navigation", "observer_version", "observer_id", "title",
                  "purpose", "report_date", "transparency", "raw_data", "metrics", "valence"]
FILE_REQUIRED = ["path", "format", "rows", "key", "columns"]
METRIC_REQUIRED = ["metric", "description", "formula", "disclosure", "utility", "inputs"]
REL_OB_REQUIRED = ["id", "name", "comparison", "population", "formula", "disclosure"]
REL_VALUE_REQUIRED = ["description", "formula", "disclosure"]
ELEVATION_REQUIRED = ["rule", "order"]
OBJECT_REQUIRED = ["id", "metric", "report_date", "value", "unit", "observations",
                   "relative_value", "trust", "verify"]
 
NOT_CHECKED = """\
What this check can and cannot tell you
 
  Passing here means the folder is well formed: every file, field and link is
  where the specification says it should be. A few rules can't be confirmed
  from a single snapshot of the folder, so they aren't counted above. They are
  still worth knowing about:
 
  - Contract changes are logged (§6, §15.8). This checker sees the contract
    as it is today, not as it was at the last report, so it can't tell whether
    a formula, a relative observation or the elevation rule has changed. If the
    folder lives in git, a diff of 1.0_INDEX.md against the previous report
    shows every change that needs a **Contract** entry in 1.1_LOG.md.
 
  - The numbers are right. Values, relative observations and elevation
    decisions are confirmed by running the published formulas over the raw
    rows each verify field names: a replication check, which a consumer runs
    to whatever depth their task calls for (§14).
 
  - Row-level facts about the raw data: that the key columns identify every
    row uniquely (§10.2), that the row counts in the reading notice are exact,
    and that the rows a temporal comparison reaches back over are retained
    (§7.4). Confirming them means reading the full data set, which the reading
    notice reserves for verification a user or workflow asks for. A
    replication check covers them as a matter of course."""
 
 
class Report:
    """One line per rule, so a failure says which rule and which section."""
 
    def __init__(self):
        self.rows = []
 
    def check(self, ok, rule, section, detail=""):
        self.rows.append(("PASS" if ok else "FAIL", rule, section, "" if ok else detail))
        return ok
 
    def warn(self, ok, rule, section, detail=""):
        self.rows.append(("PASS" if ok else "WARN", rule, section, "" if ok else detail))
        return ok
 
    @property
    def failures(self):
        return [r for r in self.rows if r[0] == "FAIL"]
 
    @property
    def warnings(self):
        return [r for r in self.rows if r[0] == "WARN"]
 
    def print(self, quiet=False):
        width = max((len(r[1]) for r in self.rows), default=0)
        for status, rule, section, detail in self.rows:
            if quiet and status == "PASS":
                continue
            line = f"  {status}  {rule:<{width}}  {section}"
            print(line if not detail else f"{line}\n        {detail}")
 
 
# ── reading ─────────────────────────────────────────────────────────
def split_front(text):
    """Return (frontmatter dict or None, body). Line endings are already \\n."""
    if not text.startswith("---\n") or "\n---\n" not in text:
        return None, text
    front, body = text.split("\n---\n", 1)
    try:
        data = yaml.safe_load(front[4:])
    except yaml.YAMLError:
        return None, body
    return (data if isinstance(data, dict) else None), body
 
 
def read(folder, name):
    path = os.path.join(folder, name)
    if not os.path.isfile(path):
        return None, None, None
    with open(path, encoding="utf-8", newline="") as f:
        text = f.read().replace("\r\n", "\n")
    front, body = split_front(text)
    return text, front, body
 
 
def yaml_blocks(body):
    """Every fenced YAML block in a body, parsed. Returns (objects, errors)."""
    objects, errors = [], []
    for block in re.findall(r"```yaml\n(.*?)```", body or "", re.S):
        try:
            data = yaml.safe_load(block)
        except yaml.YAMLError as e:
            errors.append(str(e).splitlines()[0])
            continue
        if isinstance(data, dict):
            objects.append(data)
    return objects, errors
 
 
def csv_header(path):
    """The header row only; the rest of the file is never read."""
    try:
        with open(path, newline="", encoding="utf-8-sig") as f:
            return next(csv.reader(f))
    except (OSError, StopIteration, UnicodeDecodeError, csv.Error):
        return []
 
 
def norm(text):
    """Collapse whitespace and drop markdown backticks, so a notice folded by
    YAML or wrapped in a markdown list compares equal to the contract's copy."""
    return re.sub(r"\s+", " ", str(text or "").replace("`", "")).strip()
 
 
def present(d, key):
    return key in d and d[key] not in (None, "", [], {})
 
 
def is_number(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool)
 
 
def order_key(v):
    """relative_value descending, nulls last."""
    return (0, -v) if is_number(v) else (1, 0)
 
 
# ── the rules ───────────────────────────────────────────────────────
def proprietary_citation(r, label, entry, section):
    """§5.2/§11.3: citation is optional for an open formula, but a proprietary
    one must be citable, as `proprietary, citable as "<name>"`."""
    if entry.get("disclosure") == "proprietary":
        r.check("proprietary" in str(entry.get("citation") or ""),
                f"{label} proprietary citation", section,
                'a proprietary formula needs citation: proprietary, citable as "<name>"')
 
 
def formula_rules(r, label, entry, name):
    """§4.5: an open formula is runnable Python. It must parse, and it should
    define a function named after the metric or rule it computes, so that an
    agent replicating the value knows which function to call."""
    formula = entry.get("formula")
    if entry.get("disclosure") != "open" or not isinstance(formula, str):
        return
    try:
        tree = ast.parse(formula)
    except SyntaxError as e:
        r.check(False, f"{label} formula parses as Python", "§4.5", f"line {e.lineno}: {e.msg}")
        return
    r.check(True, f"{label} formula parses as Python", "§4.5")
    defined = sorted(n.name for n in tree.body
                     if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)))
    r.warn(name in defined, f"{label} formula defines {name}()", "§4.5",
           f"top-level functions: {defined or 'none'}")
 
 
def formula_params(formula, name):
    """The argument names of the function a formula defines: the one named
    after its metric, or the only one there is. None when that can't be told."""
    try:
        tree = ast.parse(formula)
    except (SyntaxError, TypeError, ValueError):
        return None
    funcs = [n for n in tree.body if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]
    fn = next((f for f in funcs if f.name == name), funcs[0] if len(funcs) == 1 else None)
    if fn is None:
        return None
    a = fn.args
    return [x.arg for x in a.posonlyargs + a.args + a.kwonlyargs]
 
 
def selects_many(value):
    """A selector value that can match more than one row: a range, or a list of
    more than one value."""
    return isinstance(value, dict) or (isinstance(value, list) and len(value) > 1)
 
 
def narrows(child, parent):
    """§7.4: does an args selector value lie within the verify.rows value for the
    same key? Answered from the selectors alone; where that would need the data
    (a range inside a list), it is not judged."""
    def values(v):
        return v if isinstance(v, list) else [v]
 
    def in_range(x, lo, hi):
        try:
            return (lo is None or lo <= x) and (hi is None or x <= hi)
        except TypeError:
            return True
    if isinstance(parent, dict):
        lo, hi = parent.get("from"), parent.get("to")
        if isinstance(child, dict):
            clo, chi = child.get("from"), child.get("to")
            return ((clo is not None or lo is None) and (chi is not None or hi is None)
                    and all(in_range(x, lo, hi) for x in (clo, chi) if x is not None))
        return all(in_range(x, lo, hi) for x in values(child))
    if isinstance(child, dict):
        return True
    return all(x in values(parent) for x in values(child))
 
 
def navigation_ok(front, name, raw_present, folder):
    """§3.4.2: every .md carries layer, entry, note, and the links its position
    implies. 1.1_LOG.md has no `down`; entry files point down to 1.0_INDEX.md;
    references/*.md point up to 1.0_INDEX.md; 3.0_PERCEPTION.md needs a `down`
    only when raw data is present below it. Every file named must exist."""
    nav = (front or {}).get("navigation")
    if not isinstance(nav, dict):
        return False, "no navigation block"
    problems = [f"no {k}" for k in ("layer", "entry", "note") if not nav.get(k)]
    if nav.get("entry") and nav.get("entry") != INDEX:
        problems.append("entry must be 1.0_INDEX.md")
    for link in ("entry", "up", "down"):
        target = nav.get(link)
        if target and not os.path.exists(os.path.join(folder, str(target))):
            problems.append(f"{link} names {target}, which is not in the folder")
    if name in ENTRY_FILES:
        if str(nav.get("layer")) != "entry":
            problems.append("layer must be entry")
        if nav.get("down") != INDEX:
            problems.append("down must be 1.0_INDEX.md")
    elif name.startswith(REFERENCES + "/"):
        if str(nav.get("layer")) != "reference":
            problems.append("layer must be reference")
        if nav.get("up") != INDEX:
            problems.append("up must be 1.0_INDEX.md")
        if nav.get("down"):
            problems.append("a reference file has no down")
    else:
        if name != INDEX and not nav.get("up"):
            problems.append("no up")
        needs_down = name in (INDEX, VALENCE) or (name == PERCEPTION and raw_present)
        if needs_down and not nav.get("down"):
            problems.append("no down")
    return not problems, ", ".join(problems)
 
 
def type_then_navigation(front):
    """§3.4.2: navigation sits immediately after type."""
    return list(front or {})[:2] == ["type", "navigation"]
 
 
def validate(folder):
    r = Report()
    texts, fronts, bodies = {}, {}, {}
    for name in (INDEX, LOG, VALENCE, PERCEPTION):
        texts[name], fronts[name], bodies[name] = read(folder, name)
        if r.check(texts[name] is not None, f"{name} exists", "§15.1"):
            r.check(fronts[name] is not None, f"{name} frontmatter parses", "§4.1",
                    "no parseable YAML frontmatter at the top of the file")
    index = fronts.get(INDEX) or {}
 
    perception, perception_errors = yaml_blocks(bodies.get(PERCEPTION))
    valence, valence_errors = yaml_blocks(bodies.get(VALENCE))
    for name, errors in ((PERCEPTION, perception_errors), (VALENCE, valence_errors)):
        r.check(not errors, f"{name} object blocks parse", "§7.1", "; ".join(errors[:3]))
 
    # ── raw data: the files the objects actually point at ──
    raw_decl = index.get("raw_data") or {}
    availability = raw_decl.get("availability", "included")
    files = [f for f in (raw_decl.get("files") or []) if isinstance(f, dict)]
    by_path = {f.get("path"): f for f in files}
    def object_sources(o):
        v = o.get("verify") or {}
        found = {v.get("source")}
        if isinstance(v.get("args"), dict):
            found |= {e.get("source") for e in v["args"].values() if isinstance(e, dict)}
        return {str(s) for s in found if s}
    sources = sorted(set().union(*[object_sources(o) for o in perception + valence]))
    wanted = sources or sorted(p for p in by_path if p)
    raw_present, headers = False, {}
    if availability == "included":
        r.check(bool(wanted), "raw data file referenced", "§15.3",
                "no verify.source and no raw_data.files path")
        for s in wanted:
            path = os.path.join(folder, s)
            found = os.path.exists(path)
            raw_present = raw_present or found
            r.check(found, f"raw data {s} present", "§10.1/§15.3",
                    "named in verify.source or raw_data.files but not in the folder")
            if found and s.endswith(".csv"):
                headers[s] = csv_header(path)
 
    # ── 1. frontmatter: type and navigation on every .md ──
    for name in (INDEX, LOG, VALENCE, PERCEPTION):
        front = fronts.get(name)
        if front is None:
            continue
        r.check(front.get("type") == TYPES[name], f"{name} type", "§4.1",
                f"expected {TYPES[name]!r}")
        ok, why = navigation_ok(front, name, raw_present, folder)
        r.check(ok, f"{name} navigation", "§3.4.2", why)
        r.check(type_then_navigation(front), f"{name} navigation follows type", "§3.4.2",
                "navigation must be the key immediately after type")
 
    # ── 2. the contract ──
    for field in INDEX_REQUIRED:
        r.check(field in index, f"{INDEX} has {field}", "§5.1")
 
    r.check(bool(files), "raw_data.files declared", "§5.4")
    for f in files:
        path = f.get("path", "?")
        missing = [k for k in FILE_REQUIRED if not present(f, k)]
        r.check(not missing, f"raw_data file {path} has every required field", "§5.4",
                f"missing: {missing}")
        names = [c.get("name") for c in (f.get("columns") or []) if isinstance(c, dict)]
        header = headers.get(path)
        if header:
            only_decl = sorted(set(names) - set(header))
            only_file = sorted(set(header) - set(names))
            r.check(not only_decl and not only_file,
                    f"raw_data dictionary matches the {path} header", "§10.2",
                    f"declared but not in the file: {only_decl[:5]}; "
                    f"in the file but not declared: {only_file[:5]}")
            absent = [k for k in (f.get("key") or []) if k not in header]
            r.check(not absent, f"key columns exist in {path}", "§10.2",
                    f"not in the header: {absent}")
    if availability == "referenced":
        r.warn(all(f.get("sha256") for f in files), "referenced data checksums", "§10.3")
    elif availability == "withheld":
        r.check(bool(raw_decl.get("withheld_reason")), "withheld_reason given", "§10.3")
 
    # The reading notice (§3.4.4): required in the contract unless the data is
    # withheld; a directory of tables is described as a whole, each object's
    # verify.source identifying its own table.
    notice = norm(raw_decl.get("reading_notice"))
    directory = any(str(f.get("path", "")).startswith("4.0_RAW_DATA/") for f in files)
    if availability != "withheld":
        r.check(NOTICE_MARK in notice and NOTICE_TAIL in notice,
                "reading notice wording in the contract", "§3.4.4",
                "the standard notice text is incomplete")
        if directory:
            head = f"4.0_RAW_DATA/: {len(files)} file"  # "1 file" or "N files"
            r.check(head in notice, "reading notice describes the 4.0_RAW_DATA/ directory",
                    "§3.4.4", f"expected it to begin '{head}; ...'")
        else:
            for f in files:
                rows, cols = f.get("rows"), f.get("columns") or []
                if rows is None or not cols:
                    continue
                sizes = [f"{rows} rows {sep} {len(cols)} columns" for sep in ("×", "x")]
                r.check(str(f.get("path")) in notice and any(s in notice for s in sizes),
                        f"reading notice gives {f.get('path')} and its size", "§3.4.4",
                        f"expected '{f.get('path')}: {rows} rows × {len(cols)} columns', "
                        "matching raw_data.files")
 
    metrics = [m for m in (index.get("metrics") or []) if isinstance(m, dict)]
    declared = {m.get("metric"): m for m in metrics}
    for m in metrics:
        name = m.get("metric", "?")
        missing = [k for k in METRIC_REQUIRED if not present(m, k)]
        r.check(not missing, f"metric {name} has every required field", "§5.2",
                f"missing: {missing}")
        r.check(m.get("disclosure") in DISCLOSURES, f"metric {name} disclosure stated", "§5.2",
                "disclosure must be open or proprietary")
        formula_rules(r, f"metric {name}", m, name)
        proprietary_citation(r, f"metric {name}", m, "§5.2/§11.3")
 
    rules = index.get("valence") or {}
    rel_obs = [ro for ro in (rules.get("relative_obs") or []) if isinstance(ro, dict)]
    r.check(bool(rel_obs), "valence.relative_obs declared", "§5.3")
    for ro in rel_obs:
        missing = [k for k in REL_OB_REQUIRED if not present(ro, k)]
        r.check(not missing, f"relative_ob {ro.get('id', '?')} has every required field",
                "§5.3", f"missing: {missing}")
        r.check(ro.get("disclosure") in DISCLOSURES,
                f"relative_ob {ro.get('id', '?')} disclosure stated", "§5.3",
                "disclosure must be open or proprietary")
        formula_rules(r, f"relative_ob {ro.get('id', '?')}", ro, str(ro.get("id")))
        proprietary_citation(r, f"relative_ob {ro.get('id', '?')}", ro, "§5.2/§11.3")
    rel_value = rules.get("relative_value") or {}
    missing = [k for k in REL_VALUE_REQUIRED if not present(rel_value, k)]
    r.check(not missing, "valence.relative_value has every required field", "§5.3",
            f"missing: {missing}")
    r.check(rel_value.get("disclosure") in DISCLOSURES, "valence.relative_value disclosure stated",
            "§5.3", "disclosure must be open or proprietary")
    formula_rules(r, "valence.relative_value", rel_value, "relative_value")
    elevation = rules.get("elevation") or {}
    missing = [k for k in ELEVATION_REQUIRED if not present(elevation, k)]
    r.check(not missing, "valence.elevation has every required field", "§5.3",
            f"missing: {missing}")
    r.check(elevation.get("order") in ("descending", "ascending"), "valence.elevation.order",
            "§5.3", "order must be descending or ascending")
    cap = elevation.get("max_objects")
    declared_obs = [ro.get("id") for ro in rel_obs]
 
    # ── 3. observation objects ──
    def object_rules(o, layer, extra, ids):
        oid = o.get("id", "?")
        label = f"{layer} {oid}"
        metric = declared.get(o.get("metric"))
        missing = [k for k in OBJECT_REQUIRED + extra if k not in o]
        r.check(not missing, f"{label} has every required field", "§7.2", f"missing: {missing}")
        r.check(oid not in ids, f"{label} id unique in its file", "§7.2/§15.4", "duplicate id")
        ids.add(oid)
        r.check(metric is not None, f"{label} metric is declared", "§15.5",
                f"{o.get('metric')!r} is not in 1.0_INDEX.md metrics")
        rv = o.get("relative_value")
        r.check(rv is None or is_number(rv), f"{label} relative_value is a number or null",
                "§7.2", f"got {rv!r}")
 
        named = [ob.get("rel_ob") for ob in (o.get("observations") or []) if isinstance(ob, dict)]
        undeclared = [x for x in named if x not in declared_obs]
        absent = [x for x in declared_obs if x not in named]
        repeated = sorted({x for x in named if named.count(x) > 1})
        r.check(not (undeclared or absent or repeated),
                f"{label} has one observation per declared rel_ob", "§7.2/§15.5",
                f"undeclared: {undeclared}; missing: {absent}; repeated: {repeated}")
 
        trust = o.get("trust") or {}
        disclosure = trust.get("disclosure")
        if r.check(disclosure in DISCLOSURES, f"{label} trust.disclosure stated", "§7.3",
                   "disclosure must be open or proprietary"):
            if disclosure == "open":
                r.check(bool(trust.get("formula")), f"{label} trust.formula", "§7.3")
            else:
                r.check(bool(trust.get("statement")), f"{label} trust.statement", "§7.3/§11.3")
            if metric is not None:
                r.check(disclosure == metric.get("disclosure"),
                        f"{label} trust.disclosure matches the contract", "§11.3",
                        f"object says {disclosure}, contract says {metric.get('disclosure')}")
                if disclosure == "open" and metric.get("disclosure") == "open":
                    r.check(trust.get("formula") == metric.get("formula"),
                            f"{label} trust.formula matches the contract", "§5.2")
 
        verify = o.get("verify") or {}
        missing = [k for k in ("source", "rows", "columns") if k not in verify]
        r.check(not missing, f"{label} verify has source, rows, columns", "§7.4",
                f"missing: {missing}")
        source = verify.get("source")
        spec = by_path.get(source)
        if source is not None:
            r.check(spec is not None, f"{label} verify.source is declared", "§7.4",
                    f"{source!r} is not in raw_data.files")
        if spec is not None and isinstance(verify.get("rows"), dict):
            keys = spec.get("key") or []
            not_keys = [k for k in verify["rows"] if k not in keys]
            r.check(not not_keys, f"{label} verify.rows uses key columns", "§7.4",
                    f"not key columns: {not_keys}")
        columns = verify.get("columns") or []
        # every file this object reads: its source plus any joined in by args
        read_files = [source] + sorted({e.get("source") for e in (verify.get("args") or {}).values()
                                        if isinstance(e, dict) and e.get("source")}
                                       - {source}) if isinstance(verify.get("args"), dict) else [source]
 
        def dictionary(path):
            f = by_path.get(path) or {}
            return {c.get("name") for c in (f.get("columns") or []) if isinstance(c, dict)}
        names = set().union(*[dictionary(p) for p in read_files])
        if names:
            unknown = [c for c in columns if c not in names]
            elsewhere = sorted({p for p in by_path if p not in read_files
                                and any(c in dictionary(p) for c in unknown)})
            hint = (f"; found in {elsewhere} — name that file as the source of the argument "
                    "in verify.args (§7.4)" if elsewhere else "")
            r.check(not unknown, f"{label} verify.columns are declared", "§10.2",
                    f"not in the dictionary of {read_files}: {unknown[:5]}{hint}")
        known_headers = [headers[p] for p in read_files if headers.get(p)]
        if known_headers:
            seen_cols = set().union(*known_headers)
            unknown = [c for c in columns if c not in seen_cols]
            r.check(not unknown, f"{label} verify.columns exist in the raw data", "§10.2",
                    f"not in the header of {read_files}: {unknown[:5]}")
 
        # verify.args: which data feeds which formula argument (§7.4)
        rows = verify.get("rows") if isinstance(verify.get("rows"), dict) else {}
        params = (formula_params(trust.get("formula"), o.get("metric"))
                  if disclosure == "open" else None)
        args = verify.get("args")
        if args is not None:
            problems = []
            if not isinstance(args, dict):
                problems.append("args must map argument names to {column, rows}")
            else:
                for arg, entry in args.items():
                    if not isinstance(entry, dict) or not entry.get("column"):
                        problems.append(f"{arg}: no column")
                        continue
                    esource = entry.get("source", source)
                    espec = by_path.get(esource)
                    if espec is None:
                        problems.append(f"{arg}: source {esource!r} is not in raw_data.files")
                        continue
                    if entry["column"] not in columns:
                        problems.append(f"{arg}: column {entry['column']!r} not in verify.columns")
                    edict = dictionary(esource)
                    if edict and entry["column"] not in edict:
                        problems.append(f"{arg}: column {entry['column']!r} not in {esource}")
                    eheader = headers.get(esource)
                    if eheader and entry["column"] not in eheader:
                        problems.append(f"{arg}: column {entry['column']!r} not in the {esource} header")
                    keys = espec.get("key") or []
                    sel = entry.get("rows") or {}
                    if not isinstance(sel, dict):
                        problems.append(f"{arg}: rows must be a selector")
                        continue
                    for k, v in sel.items():
                        if keys and k not in keys:
                            problems.append(f"{arg}: {k!r} is not a key column of {esource}")
                        elif k in rows and not narrows(v, rows[k]):
                            problems.append(f"{arg}: {k}={v!r} lies outside verify.rows")
            r.check(not problems, f"{label} verify.args narrows verify", "§7.4",
                    "; ".join(problems[:4]))
            if params is not None and isinstance(args, dict):
                r.check(set(args) == set(params),
                        f"{label} verify.args names the formula's arguments", "§7.4",
                        f"formula takes {params}; args names {sorted(args)}")
        elif params is not None:
            not_columns = [p for p in params if p not in columns]
            many = [k for k, v in rows.items() if selects_many(v)]
            r.check(not not_columns and not many,
                    f"{label} verify.args given where the mapping is not evident", "§7.4",
                    (f"arguments not named after a column: {not_columns}; " if not_columns else "")
                    + (f"verify.rows selects several rows on: {many}" if many else ""))
        return disclosure
 
    r.check(bool(perception), f"{PERCEPTION} holds objects", "§7.1")
    disclosures, seen = set(), set()
    for o in perception:
        disclosures.add(object_rules(o, "perception", ["elevated"], seen))
    seen = set()
    for o in valence:
        disclosures.add(object_rules(o, "valence", ["rank", "perception_ref"], seen))
 
    for name in declared:
        r.check(any(o.get("metric") == name for o in perception),
                f"metric {name} has a perception object", "§9")
 
    # ── 4. valence against perception ──
    by_id = {o.get("id"): o for o in perception}
    for o in valence:
        label = f"valence {o.get('id', '?')}"
        p = by_id.get(o.get("perception_ref"))
        if not r.check(p is not None, f"{label} perception_ref resolves", "§8"):
            continue
        r.check(p.get("elevated") is True, f"{label} is elevated in {PERCEPTION}", "§8")
        differ = [k for k in ("value", "observations", "relative_value", "trust", "verify")
                  if p.get(k) != o.get(k)]
        r.check(not differ, f"{label} matches its perception object", "§8",
                f"differs in: {differ}")
 
    elevated = [o for o in perception if o.get("elevated") is True]
    refs = {o.get("perception_ref") for o in valence}
    vfront = fronts.get(VALENCE) or {}
    if cap is None:
        left_out = sorted(str(o.get("id")) for o in elevated if o.get("id") not in refs)
        r.check(not left_out, "every elevated object appears in valence", "§8",
                f"elevated but not in {VALENCE}: {left_out[:5]}")
    else:
        r.check(vfront.get("max_objects") == cap, f"{VALENCE} states max_objects", "§8",
                f"contract declares {cap}; frontmatter has {vfront.get('max_objects')!r}")
        r.check(vfront.get("elevated_count") == len(elevated),
                f"{VALENCE} states elevated_count", "§8",
                f"{PERCEPTION} has {len(elevated)} elevated objects; "
                f"frontmatter has {vfront.get('elevated_count')!r}")
        expected = min(cap, len(elevated)) if isinstance(cap, int) else None
        r.check(len(valence) == expected, f"{VALENCE} holds min(max_objects, elevated_count)",
                "§8", f"expected {expected}, file holds {len(valence)}")
        kept = [o for o in elevated if o.get("id") in refs]
        dropped = [o for o in elevated if o.get("id") not in refs]
        if kept and dropped:
            worst_kept = max(order_key(o.get("relative_value")) for o in kept)
            best_dropped = min(order_key(o.get("relative_value")) for o in dropped)
            r.check(worst_kept <= best_dropped, "valence keeps the highest-ranked elevated objects",
                    "§8", "an elevated object left out ranks above one that was kept")
 
    ranks = [o.get("rank") for o in valence]
    whole = all(isinstance(x, int) and not isinstance(x, bool) for x in ranks)
    r.check(whole and sorted(ranks) == list(range(1, len(valence) + 1)),
            "valence ranks are 1..n", "§8", f"ranks: {ranks}")
    if whole:
        r.check(ranks == sorted(ranks), "valence objects appear in rank order", "§8",
                f"file order: {ranks}")
        by_rank = [o.get("relative_value") for o in sorted(valence, key=lambda o: o["rank"])]
        r.warn([order_key(v) for v in by_rank] == sorted(order_key(v) for v in by_rank),
               "valence ranks follow relative_value, nulls last", "§8",
               f"relative_value by rank: {by_rank}")
    in_file = [order_key(o.get("relative_value")) for o in perception]
    r.warn(in_file == sorted(in_file), f"{PERCEPTION} ordered by relative_value, nulls last",
           "§9", "objects are not in one descending list across all metrics")
 
    r.check(present(vfront, "object_count") and vfront.get("object_count") == len(valence),
            f"{VALENCE} object_count", "§8",
            f"frontmatter says {vfront.get('object_count')!r}, file holds {len(valence)}")
    pfront = fronts.get(PERCEPTION) or {}
    stated = pfront.get("object_count")
    r.check(stated is None or stated == len(perception), f"{PERCEPTION} object_count", "§9",
            f"frontmatter says {stated}, file holds {len(perception)}")
    r.check(norm(vfront.get("elevation_rule")) == norm(elevation.get("rule"))
            and present(vfront, "elevation_rule"),
            f"{VALENCE} elevation_rule echoes the contract", "§8")
    for name in (VALENCE, PERCEPTION):
        front = fronts.get(name) or {}
        r.check(front.get("observer_id") == index.get("observer_id"),
                f"{name} observer_id matches the contract", "§8/§9")
        r.check(str(front.get("report_date")) == str(index.get("report_date")),
                f"{name} report_date matches the contract", "§8/§9",
                f"{front.get('report_date')!r} vs {index.get('report_date')!r}")
 
    # ── 5. transparency, the reading notice, the log, the entry files ──
    stated_disclosures = (disclosures | {m.get("disclosure") for m in metrics}
                          | {ro.get("disclosure") for ro in rel_obs}
                          | {rel_value.get("disclosure")})
    opaque = "proprietary" in stated_disclosures or availability == "withheld"
    r.check(index.get("transparency") == ("declared_opacity" if opaque else "open"),
            "transparency matches what is disclosed", "§11.4",
            "declared_opacity is required when any formula is proprietary or data is withheld")
 
    note = norm(((fronts.get(PERCEPTION) or {}).get("navigation") or {}).get("note"))
    if availability == "included":
        r.check(bool(notice) and notice in note,
                f"reading notice in {PERCEPTION} navigation matches the contract", "§3.4.4")
    else:
        r.warn("raw_data" in note, f"{PERCEPTION} note points to raw_data in the contract",
               "§3.4.2", "with no raw data in the folder, the note should say so and point "
               "to raw_data in 1.0_INDEX.md")
 
    # references/*.md: type and navigation, like every other .md file (§3.1)
    ref_root = os.path.join(folder, REFERENCES)
    for dirpath, _, names in sorted(os.walk(ref_root)):
        for fname in sorted(n for n in names if n.lower().endswith(".md")):
            rel = os.path.relpath(os.path.join(dirpath, fname), folder).replace(os.sep, "/")
            _, rfront, _ = read(folder, rel)
            r.check((rfront or {}).get("type") == "OBSERVER Reference", f"{rel} type",
                    "§3.1/§4.1", "expected 'OBSERVER Reference'")
            ok, why = navigation_ok(rfront, rel, raw_present, folder)
            r.check(ok, f"{rel} navigation", "§3.4.2", why)
            r.check(type_then_navigation(rfront), f"{rel} navigation follows type", "§3.4.2")
 
    log = bodies.get(LOG) or ""
    r.check(bool(re.search(r"^## \d{4}-\d{2}-\d{2}", log, re.M)), f"{LOG} has a dated entry", "§6")
    r.check(bool(re.search(r"\*\*(Report|Initialization|Contract|Data|Correction)\*\*", log)),
            f"{LOG} uses the entry keywords", "§6")
 
    entry = [f for f in ENTRY_FILES if os.path.isfile(os.path.join(folder, f))]
    r.warn(len(entry) >= 2, "two or more entry files present", "§3.4.3",
           f"found {entry or 'none'}; README.md with AGENTS.md or CLAUDE.md is recommended")
    if entry:
        blobs = {f: open(os.path.join(folder, f), "rb").read() for f in entry}
        r.check(len(set(blobs.values())) == 1, "entry files are byte-identical", "§3.4.3/§15.10",
                f"{len(set(blobs.values()))} distinct versions among {entry}")
        text = blobs[entry[0]].decode("utf-8", "replace").replace("\r\n", "\n")
        efront, _ = split_front(text)
        r.check((efront or {}).get("type") == "OBSERVER Entry", "entry file type", "§3.4.3")
        ok, why = navigation_ok(efront, entry[0], raw_present, folder)
        r.check(ok, "entry file navigation", "§3.4.3", why)
        r.check(type_then_navigation(efront), "entry file navigation follows type", "§3.4.2")
        if len(entry) >= 2:
            r.check("identical copies" in norm(text), "entry files say they are copies", "§3.4.3")
            unnamed = [f for f in entry if f not in text]
            r.check(not unnamed, "copies statement names every entry file present",
                    "§3.4.3/§3.4.5", f"not named: {unnamed}")
        if availability == "included":
            r.check(bool(notice) and notice in norm(text),
                    "reading notice in the entry files matches the contract", "§3.4.4")
        else:
            r.warn("raw_data" in text, "entry files point to raw_data in the contract",
                   "§3.4.3", "with no raw data in the folder, item 4 of the reading "
                   "order should say so and point to raw_data in 1.0_INDEX.md")
    return r
 
 
def main(argv=None):
    ap = argparse.ArgumentParser(description="Check a folder against OBSERVER Format 0.1.")
    ap.add_argument("folder", nargs="?", default="OBSERVER")
    ap.add_argument("--quiet", action="store_true", help="print only failures and warnings")
    a = ap.parse_args(argv)
    if not os.path.isdir(a.folder):
        print(f"{a.folder}: not a directory")
        return 2
    r = validate(a.folder)
    print(f"OBSERVER Format 0.1 conformance — {a.folder}\n")
    r.print(a.quiet)
    print()
    print(NOT_CHECKED)
    n, w = len(r.failures), len(r.warnings)
    verdict = ("well formed on every rule a snapshot of the folder can check"
               if n == 0 else "not yet conformant")
    print(f"\n{len(r.rows)} checks, {n} failure(s), {w} warning(s) — {verdict}")
    return 1 if n else 0
 
 
if __name__ == "__main__":
    sys.exit(main())
 