"""
掃描使用者的 Claude Code skill 目錄（~/.agents/skills/），
列出可用的 skill 名稱、描述與子資源。
"""
from pathlib import Path
from typing import Optional
import re
import ast
import json


SKILLS_ROOT = Path.home() / ".agents" / "skills"

# Python 內建模組（不需要 pip install）— 動態用 sys.stdlib_module_names 取得，
# 相容 Python 3.10+；失敗時 fallback 到寫死清單
try:
    import sys as _sys
    _STDLIB_MODULES = set(_sys.stdlib_module_names)  # Python 3.10+
except AttributeError:
    _STDLIB_MODULES = {
        "os", "sys", "re", "json", "math", "random", "time", "datetime", "pathlib",
        "subprocess", "shutil", "glob", "io", "csv", "hashlib", "urllib", "http",
        "collections", "itertools", "functools", "typing", "dataclasses", "enum",
        "abc", "argparse", "asyncio", "logging", "traceback", "threading", "queue",
        "multiprocessing", "concurrent", "socket", "struct", "copy", "pickle",
        "base64", "uuid", "tempfile", "warnings", "inspect", "textwrap", "string",
        "unicodedata", "zipfile", "tarfile", "gzip", "bz2", "sqlite3", "xml", "html",
        "email", "mimetypes", "platform", "operator", "contextlib", "types",
        "weakref", "gc", "atexit", "signal", "fnmatch", "select", "webbrowser",
    }

# 常見 import 名稱 → pip 套件名稱的對應（名稱不一致的情況）
_PIP_NAME_MAP = {
    "PIL": "Pillow",
    "cv2": "opencv-python",
    "bs4": "beautifulsoup4",
    "sklearn": "scikit-learn",
    "yaml": "PyYAML",
    "dotenv": "python-dotenv",
    "docx": "python-docx",
    "pptx": "python-pptx",
    "magic": "python-magic",
    "fitz": "PyMuPDF",
    "win32gui": "pywin32",
    "win32con": "pywin32",
    "win32api": "pywin32",
}


def _parse_frontmatter(skill_md_path: Path) -> dict:
    """從 SKILL.md 讀取 YAML frontmatter 的 name / description。"""
    result = {"name": "", "description": ""}
    try:
        text = skill_md_path.read_text(encoding="utf-8")
    except Exception:
        return result
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.DOTALL)
    if not m:
        return result
    fm = m.group(1)
    # 優先用 PyYAML 解析（穩，能處理 block scalar / 引號）
    try:
        import yaml as _yaml
        parsed = _yaml.safe_load(fm) or {}
        if isinstance(parsed, dict):
            result["name"] = str(parsed.get("name", "")).strip()
            desc = str(parsed.get("description", "")).strip()
            # 多行描述壓成單行
            desc = re.sub(r"\s+", " ", desc)
            result["description"] = desc
            return result
    except Exception:
        pass
    # Fallback：regex（YAML 不可用時的備援）
    name_m = re.search(r"^name:\s*(.+)$", fm, re.MULTILINE)
    desc_m = re.search(r"^description:\s*(.+?)(?=\n[a-zA-Z_]+:|\Z)", fm, re.MULTILINE | re.DOTALL)
    if name_m:
        result["name"] = name_m.group(1).strip().strip('"\'')
    if desc_m:
        desc = desc_m.group(1).strip().strip('"\'')
        desc = re.sub(r"\s+", " ", desc)
        result["description"] = desc
    return result


def list_available_skills() -> list[dict]:
    """
    掃 ~/.agents/skills/ 下每個子資料夾，回傳 skill 清單。

    每筆格式：
    {
        "name": "skill-creator",
        "display_name": "Skill Creator",
        "description": "Create new skills...",
        "path": "C:/Users/.../skill-creator",
        "has_scripts": True,
        "has_references": True,
        "has_assets": False,
    }
    """
    if not SKILLS_ROOT.exists():
        return []

    skills = []
    for entry in sorted(SKILLS_ROOT.iterdir()):
        if not entry.is_dir():
            continue
        skill_md = entry / "SKILL.md"
        if not skill_md.exists():
            continue
        meta = _parse_frontmatter(skill_md)
        skills.append({
            "name": meta["name"] or entry.name,
            "display_name": entry.name,
            "description": meta["description"],
            "path": str(entry.absolute()),
            "has_scripts": (entry / "scripts").is_dir(),
            "has_references": (entry / "references").is_dir(),
            "has_assets": (entry / "assets").is_dir(),
            "has_package_json": (entry / "package.json").is_file(),
            "has_requirements": (entry / "requirements.txt").is_file(),
        })
    return skills


def _resolve_skill_dir(skill_name: str) -> Optional[Path]:
    """從 skill_name（資料夾名或 frontmatter 的 name）找到 skill 資料夾。"""
    if not SKILLS_ROOT.exists():
        return None
    for entry in SKILLS_ROOT.iterdir():
        if not entry.is_dir():
            continue
        if entry.name == skill_name:
            return entry
    for entry in SKILLS_ROOT.iterdir():
        if not entry.is_dir():
            continue
        meta = _parse_frontmatter(entry / "SKILL.md")
        if meta["name"] == skill_name:
            return entry
    return None


def _extract_py_imports(py_file: Path) -> set[str]:
    """用 AST 解析 .py 檔抽出所有 top-level import 模組名。"""
    names: set[str] = set()
    try:
        src = py_file.read_text(encoding="utf-8")
    except Exception:
        return names
    try:
        tree = ast.parse(src)
    except Exception:
        return names
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                names.add(a.name.split(".")[0])
        elif isinstance(node, ast.ImportFrom):
            if node.module and node.level == 0:
                names.add(node.module.split(".")[0])
    return names


def scan_skill_dependencies(skill_name: str) -> dict:
    """
    掃描指定 skill 的依賴，回傳：
    {
        "skill_name": "...",
        "found": true,
        "python": {
            "requirements_txt": ["pandas>=1.0", ...],       # requirements.txt 原文
            "imports_detected": ["pandas", "openpyxl", ...], # 從 .py 檔靜態分析
            "suggested_pip": ["pandas", "openpyxl", ...],    # 推薦安裝的 pip 套件（排除 stdlib）
        },
        "node": {
            "package_json": {"dependencies": {...}, "devDependencies": {...}} or null,
            "needs_npm_install": true/false,
        },
    }
    """
    skill_dir = _resolve_skill_dir(skill_name)
    if skill_dir is None:
        return {"skill_name": skill_name, "found": False}

    # ── Python 依賴 ──────────────────────────────────────
    requirements_txt: list[str] = []
    req_file = skill_dir / "requirements.txt"
    if req_file.is_file():
        try:
            for line in req_file.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line and not line.startswith("#"):
                    requirements_txt.append(line)
        except Exception:
            pass

    # 靜態分析所有 .py 檔的 import
    imports_detected: set[str] = set()
    for py_file in skill_dir.rglob("*.py"):
        imports_detected.update(_extract_py_imports(py_file))

    # 排除 stdlib + skill 自家模組（檔名 + skill 底下的子資料夾名）
    local_module_names = {f.stem for f in skill_dir.rglob("*.py")}
    local_module_names.update(
        d.name for d in skill_dir.iterdir() if d.is_dir() and not d.name.startswith(".")
    )
    third_party = sorted(
        imp for imp in imports_detected
        if imp not in _STDLIB_MODULES and imp not in local_module_names and not imp.startswith("_")
    )
    suggested_pip = [_PIP_NAME_MAP.get(m, m) for m in third_party]

    # ── Node.js 依賴 ─────────────────────────────────────
    package_json = None
    pkg_file = skill_dir / "package.json"
    if pkg_file.is_file():
        try:
            package_json = json.loads(pkg_file.read_text(encoding="utf-8"))
        except Exception:
            package_json = None

    return {
        "skill_name": skill_name,
        "found": True,
        "path": str(skill_dir.absolute()),
        "python": {
            "requirements_txt": requirements_txt,
            "imports_detected": sorted(imports_detected),
            "suggested_pip": suggested_pip,
        },
        "node": {
            "package_json": package_json,
            "needs_npm_install": package_json is not None,
        },
    }


def get_skill_prompt_injection(skill_name: str) -> Optional[str]:
    """
    給定 skill 名稱（資料夾名），回傳要注入 LLM system prompt 的文字：
    - SKILL.md 全文
    - 子資源清單（scripts/references/assets）

    找不到則回 None。
    """
    skill_dir = _resolve_skill_dir(skill_name)
    if skill_dir is None:
        return None

    skill_md = skill_dir / "SKILL.md"
    if not skill_md.exists():
        return None

    md_text = skill_md.read_text(encoding="utf-8")

    # 列出可用腳本
    scripts_lines: list[str] = []
    scripts_dir = skill_dir / "scripts"
    if scripts_dir.is_dir():
        for f in sorted(scripts_dir.iterdir()):
            if f.is_file() and f.suffix in (".py", ".sh"):
                scripts_lines.append(f"  - scripts/{f.name}")

    references_lines: list[str] = []
    ref_dir = skill_dir / "references"
    if ref_dir.is_dir():
        for f in sorted(ref_dir.iterdir()):
            if f.is_file():
                references_lines.append(f"  - references/{f.name}")

    assets_lines: list[str] = []
    assets_dir = skill_dir / "assets"
    if assets_dir.is_dir():
        for f in sorted(assets_dir.iterdir()):
            if f.is_file():
                assets_lines.append(f"  - assets/{f.name}")

    # 用 forward slash 讓 LLM 寫 Python 時不用處理 Windows escape
    abs_path = str(skill_dir.absolute()).replace("\\", "/")

    parts = [
        f"\n\n【掛載 Skill：{skill_name}】",
        f"以下為 SKILL.md 全文內容，描述此 skill 的目的、用法與注意事項。",
        f"**Skill 根目錄**：`{abs_path}`",
        f"存取子資源時請使用絕對路徑（上方根目錄 + 子路徑）。",
    ]
    if scripts_lines:
        parts.append(f"\n**可執行腳本（scripts/）**：\n" + "\n".join(scripts_lines))
        parts.append(
            "你可以用 `subprocess.run([sys.executable, \"<scripts 絕對路徑>\", args...])` 呼叫這些腳本，\n"
            "或用 `sys.path.insert(0, \"<scripts 絕對路徑>\")` 然後 import 使用。"
        )
    if references_lines:
        parts.append(f"\n**參考文件（references/）**：\n" + "\n".join(references_lines))
        parts.append("需要更多資訊時，可用 read_file 工具讀取這些文件。")
    if assets_lines:
        parts.append(f"\n**資源檔案（assets/）**：\n" + "\n".join(assets_lines))

    parts.append(f"\n--- SKILL.md 內容開始 ---\n{md_text}\n--- SKILL.md 內容結束 ---")
    parts.append(
        "請依照 SKILL.md 的指示執行任務。如果 skill 提供了可用腳本，優先考慮呼叫腳本而非自己重寫。"
    )

    return "\n".join(parts)
