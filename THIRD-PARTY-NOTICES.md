# Third-party software

Helix is free software under the GNU General Public License, version 3 or later
(see [LICENSE](LICENSE)). It is built on the open-source work below. Each keeps its own
license; the full texts come with each package's source.

## Shipped inside the app

| Software | Version | License | Used for |
| --- | --- | --- | --- |
| [R](https://www.r-project.org) | 4.5.1 | GPL-2 or GPL-3 | Every statistical test |
| [webR](https://github.com/r-wasm/webr) | 0.5.9 | Binaries: GPL-3; JavaScript: MIT | Runs R inside the app (R compiled to WebAssembly) |
| [Plotly.js](https://github.com/plotly/plotly.js) | 3.7.0 | MIT | Drawing the graphs |
| [React](https://react.dev) and React DOM | 19.2.6 | MIT | The interface |
| [Tauri](https://tauri.app) (with its dialog and window-state plugins) | 2.11 | MIT or Apache-2.0 | The native macOS app around the interface |
| [objc2](https://github.com/madsmtm/objc2) | 0.6.4 | MIT | Talking to macOS from the native side |
| [percent-encoding](https://github.com/servo/rust-url) | 2.3.2 | MIT or Apache-2.0 | Passing file paths to the native side |
| [Lucide](https://lucide.dev) | 0.542.0 | ISC | Icons |
| [Tailwind CSS](https://tailwindcss.com) | 4.2.4 | MIT | Styles (compiled into the app's stylesheet) |

The webR binaries bundle further open-source software, each under its own license
(listed in webR's `LICENSE.md`): PCRE2 (BSD), XZ Utils (public domain), libgfortran
(GPL), LLVM Flang (Apache-2.0).

The Rust and JavaScript libraries these depend on are listed with their versions in
`src-tauri/Cargo.lock` and `package-lock.json`; all are under open-source licenses.

## Source code

Helix's source code is at <https://github.com/mickaphd/Helix>. The source code of R is at
<https://cran.r-project.org/sources.html>, and that of webR (including how its binaries are
built) at <https://github.com/r-wasm/webr>.
