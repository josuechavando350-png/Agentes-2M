import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { build, transform } from "esbuild";

export async function browserDelivery(root, directory) {
  const source = join(root, "src/sale/browser");
  const bundle = async (name) =>
    (
      await build({
        absWorkingDir: root,
        entryPoints: [join(source, name + ".mjs")],
        bundle: true,
        write: false,
        format: "iife",
        platform: "browser",
        target: "es2022",
        minify: true,
        legalComments: "none",
        charset: "utf8",
        alias: { "node:crypto": join(source, "sha256.mjs") },
      })
    ).outputFiles[0].text.replace(/<\/script/gi, "<\\/script");
  const example = {
    csv: readFileSync(join(directory, "ejemplo-turno.csv"), "utf8"),
    profile: JSON.parse(readFileSync(join(directory, "columnas.json"))),
  };
  const template = readFileSync(join(source, "auditor.html"), "utf8"),
    [worker, ui] = await Promise.all([bundle("worker"), bundle("ui")]);
  const style = await transform(
    readFileSync(join(source, "auditor.css"), "utf8"),
    { loader: "css", minify: true },
  );
  const values = {
    __STYLE__: style.code,
    __INITIAL__: JSON.stringify(example).replaceAll("<", "\\u003c"),
    __WORKER__: worker,
    __UI__: ui,
  };
  writeFileSync(
    join(directory, "auditor.html"),
    template.replace(
      /__INITIAL__|__WORKER__|__UI__|__STYLE__/g,
      (k) => values[k],
    ),
  );
}
