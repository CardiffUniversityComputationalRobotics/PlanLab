"""Packs PlanLab as a VS Code extension: dist/planlab.vsix.

    python3 tools/build_vsix.py

Install it in VS Code: Extensions view → ⋯ (Views and More Actions) → Install from VSIX… → dist/planlab.vsix
(or: code --install-extension dist/planlab.vsix). After changing PlanLab's files, build and install it again.

A .vsix is a zip: [Content_Types].xml, extension.vsixmanifest, and the extension's files under extension/.
Only the standard library is used, so no Node.js or npm is needed.
"""
import json
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent.parent
OUTPUT = ROOT / "dist" / "planlab.vsix"

# What the extension needs: its manifest and code, the app, and the Python worker. Not the tests or builds.
FILES = ["package.json", "README.md", "index.html", "vscode/extension.js", "tools/python_worker.py"]
FOLDERS = ["css", "js", "media"]

TYPES = {".json": "application/json", ".js": "application/javascript", ".css": "text/css", ".html": "text/html",
         ".md": "text/markdown", ".py": "text/x-python", ".svg": "image/svg+xml", ".vsixmanifest": "text/xml"}


def manifest(package):
    return f"""<?xml version="1.0" encoding="utf-8"?>
<PackageManifest Version="2.0.0" xmlns="http://schemas.microsoft.com/developer/vsx-schema/2011" xmlns:d="http://schemas.microsoft.com/developer/vsx-schema-design/2011">
  <Metadata>
    <Identity Language="en-US" Id="{escape(package['name'])}" Version="{escape(package['version'])}" Publisher="{escape(package['publisher'])}" />
    <DisplayName>{escape(package['displayName'])}</DisplayName>
    <Description xml:space="preserve">{escape(package['description'])}</Description>
    <Tags></Tags>
    <Categories>{escape(','.join(package.get('categories', [])))}</Categories>
    <GalleryFlags>Public</GalleryFlags>
    <Properties>
      <Property Id="Microsoft.VisualStudio.Code.Engine" Value="{escape(package['engines']['vscode'])}" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionDependencies" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionPack" Value="" />
      <Property Id="Microsoft.VisualStudio.Code.ExtensionKind" Value="workspace" />
      <Property Id="Microsoft.VisualStudio.Code.LocalizedLanguages" Value="" />
      <Property Id="Microsoft.VisualStudio.Services.GitHubFlavoredMarkdown" Value="true" />
    </Properties>
  </Metadata>
  <Installation>
    <InstallationTarget Id="Microsoft.VisualStudio.Code"/>
  </Installation>
  <Dependencies/>
  <Assets>
    <Asset Type="Microsoft.VisualStudio.Code.Manifest" Path="extension/package.json" Addressable="true" />
    <Asset Type="Microsoft.VisualStudio.Services.Content.Details" Path="extension/README.md" Addressable="true" />
  </Assets>
</PackageManifest>
"""


def main():
    package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
    files = [ROOT / f for f in FILES]
    for folder in FOLDERS:
        files += sorted(p for p in (ROOT / folder).rglob("*") if p.is_file())
    content_types = "".join(f'<Default Extension="{ext}" ContentType="{kind}"/>' for ext, kind in TYPES.items())
    OUTPUT.parent.mkdir(exist_ok=True)
    with zipfile.ZipFile(OUTPUT, "w", zipfile.ZIP_DEFLATED) as vsix:
        vsix.writestr("[Content_Types].xml", f'<?xml version="1.0" encoding="utf-8"?>\n'
                      f'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">{content_types}</Types>\n')
        vsix.writestr("extension.vsixmanifest", manifest(package))
        for f in files:
            if f.suffix not in TYPES:
                raise SystemExit(f"{f.relative_to(ROOT)}: add its type to TYPES in build_vsix.py")
            vsix.write(f, "extension/" + f.relative_to(ROOT).as_posix())
    print(f"Wrote {OUTPUT.relative_to(ROOT)} ({OUTPUT.stat().st_size // 1024} KB, {len(files)} files). "
          "Install it: Extensions view → ⋯ → Install from VSIX…")


if __name__ == "__main__":
    main()
