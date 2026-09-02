// ---------------------------------------------------------------------------
// Sandboxed preview runtime.
//
// Builds the srcdoc HTML for the preview iframe. The iframe is rendered with
//   sandbox="allow-scripts"           (NO allow-same-origin)
// which gives it a UNIQUE NULL ORIGIN. Consequences, all intentional:
//   • cannot read/write our cookies or localStorage (SecurityError)
//   • cannot touch window.parent's DOM (cross-origin)
//   • cannot call our APIs with the user's session (no cookies attached)
//   • cannot read server env vars — they never reach the browser
//
// Compilation happens INSIDE the sandbox with Babel standalone. The server
// never evaluates generated code.
// ---------------------------------------------------------------------------

export interface PreviewFile {
  path: string;
  content: string;
}

const ESC = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");

/** Strip a closing script tag so file content can't break out of the <script>. */
const SAFE = (s: string) => ESC(s).replace(/<\/script/gi, "<\\/script");

export function buildPreviewHtml(files: PreviewFile[], entry: string): string {
  const modules = files
    .filter((f) => /\.(tsx|ts|jsx|js)$/.test(f.path))
    .map((f) => `  ${JSON.stringify(f.path)}: \`${SAFE(f.content)}\``)
    .join(",\n");

  const css = files
    .filter((f) => f.path.endsWith(".css"))
    .map((f) => f.content)
    .join("\n")
    .replace(/<\/style/gi, "<\\/style");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<script src="https://cdn.tailwindcss.com"></script>
<script crossorigin src="https://unpkg.com/react@18/umd/react.production.min.js"></script>
<script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.production.min.js"></script>
<script src="https://unpkg.com/@babel/standalone@7/babel.min.js"></script>
<style>
  html,body,#root{min-height:100%;margin:0}
  body{background:#fff;color:#111;font-family:ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  #__err{position:fixed;inset:0;display:none;padding:16px;background:#180d10;color:#ffb4b4;font:12px/1.6 ui-monospace,Menlo,monospace;white-space:pre-wrap;overflow:auto;z-index:2147483647}
</style>
${css ? `<style>\n${css}\n</style>` : ""}
</head>
<body>
<div id="root"></div>
<pre id="__err"></pre>
<script>
(function () {
  var SOURCES = {
${modules}
  };
  var ENTRY = ${JSON.stringify(entry)};

  function report(kind, message, stack) {
    var box = document.getElementById("__err");
    box.style.display = "block";
    box.textContent = kind + ": " + message + (stack ? "\\n\\n" + stack : "");
    try {
      parent.postMessage({ __auraPreview: true, type: "error", kind: kind, message: String(message).slice(0, 1200) }, "*");
    } catch (e) {}
  }

  window.addEventListener("error", function (e) {
    report("Runtime error", e.message, e.error && e.error.stack ? String(e.error.stack).slice(0, 800) : "");
  });
  window.addEventListener("unhandledrejection", function (e) {
    report("Unhandled promise rejection", (e.reason && e.reason.message) || String(e.reason), "");
  });

  // --- tiny CommonJS-style module registry over Babel-compiled sources ---
  var cache = {};
  function resolve(spec, from) {
    if (spec === "react" || spec === "react-dom" || spec === "react-dom/client") return spec;
    var base = from.split("/").slice(0, -1);
    var parts = spec.split("/");
    for (var i = 0; i < parts.length; i++) {
      if (parts[i] === "." || parts[i] === "") continue;
      if (parts[i] === "..") base.pop();
      else base.push(parts[i]);
    }
    var p = base.join("/");
    var candidates = [p, p + ".tsx", p + ".ts", p + ".jsx", p + ".js", p + "/index.tsx", p + "/index.ts", p + "/index.jsx", p + "/index.js"];
    for (var c = 0; c < candidates.length; c++) if (SOURCES[candidates[c]]) return candidates[c];
    return null;
  }

  function req(spec, from) {
    if (spec === "react") return window.React;
    if (spec === "react-dom" || spec === "react-dom/client") return window.ReactDOM;
    var path = resolve(spec, from);
    if (!path) throw new Error('Cannot resolve import "' + spec + '" from ' + from);
    if (cache[path]) return cache[path].exports;
    var mod = { exports: {} };
    cache[path] = mod;
    var code;
    try {
      code = Babel.transform(SOURCES[path], {
        filename: path,
        presets: [["react", { runtime: "classic" }], ["typescript", {}]],
        plugins: [["transform-modules-commonjs", { strictNamespace: false }]]
      }).code;
    } catch (err) {
      throw new Error("Compile error in " + path + ": " + err.message);
    }
    try {
      var fn = new Function("require", "module", "exports", "React", code);
      fn(function (s) { return req(s, path); }, mod, mod.exports, window.React);
    } catch (err) {
      throw new Error("Error while evaluating " + path + ": " + err.message);
    }
    return mod.exports;
  }

  try {
    if (!SOURCES[ENTRY]) throw new Error("Entry file not found: " + ENTRY);
    var entryModule = req(ENTRY, ENTRY);
    var App = entryModule && (entryModule.default || entryModule.App || entryModule);
    var container = document.getElementById("root");

    // entry may render itself (main.tsx style); only mount when it exports a component
    if (typeof App === "function") {
      var root = ReactDOM.createRoot(container);
      root.render(React.createElement(App));
    } else if (!container.hasChildNodes()) {
      throw new Error("Entry file did not export a React component or render anything.");
    }
    parent.postMessage({ __auraPreview: true, type: "ready" }, "*");
  } catch (err) {
    report("Preview failed to compile", err.message, err.stack ? String(err.stack).slice(0, 600) : "");
  }
})();
</script>
</body>
</html>`;
}
