"""Package an independently verifiable offline delivery as a reproducible, public ZIP."""
import hashlib
import json
import os
import sys
import tempfile
from pathlib import Path
from zipfile import ZIP_STORED, ZipFile, ZipInfo


def package(folder, target):
    manifest = json.loads((folder / "manifest.json").read_bytes())
    expected = manifest["files"]
    names = sorted(["manifest.json", *expected])
    if sorted(p.name for p in folder.iterdir()) != names or any(Path(n).name != n for n in names):
        raise ValueError("El contenido de la entrega difiere del manifiesto")
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent) as temporary:
        with ZipFile(temporary, "w") as archive:
            for name in names:
                path = folder / name
                if path.is_symlink() or not path.is_file():
                    raise ValueError("Se requiere un archivo regular")
                data = path.read_bytes()
                if name in expected and hashlib.sha256(data).hexdigest() != expected[name]:
                    raise ValueError("Huella distinta del manifiesto: " + name)
                info = ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = ZIP_STORED
                archive.writestr(info, data)
        temporary.flush()
        os.link(temporary.name, target)
    return hashlib.sha256(target.read_bytes()).hexdigest()


if __name__ == "__main__":
    print(package(Path(sys.argv[1]), Path(sys.argv[2])))
