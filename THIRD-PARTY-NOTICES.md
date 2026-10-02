# Third-party software

Helix is free software under the GNU General Public License, version 3 or later
(see [LICENSE](LICENSE)). It is built on the open-source work below. Each keeps its own
license; the full texts come with each package's source.

## Shipped inside the app

| Software | Version | License | Used for |
| --- | --- | --- | --- |
| [R](https://www.r-project.org) | 4.5.1 | GPL-2 or GPL-3 | Every statistical test |
| [webR](https://github.com/r-wasm/webr) | 0.5.9 | Binaries: GPL-3; JavaScript: MIT | Runs R inside the app (R compiled to WebAssembly) |
| [Plotly.js](https://github.com/plotly/plotly.js) | 4.1.1 | MIT | Drawing the graphs |
| [React](https://react.dev) and React DOM | 19.2.6 | MIT | The interface |
| [Tauri](https://tauri.app) (with its dialog and window-state plugins) | 2.11 | MIT or Apache-2.0 | The native macOS app around the interface |
| [objc2](https://github.com/madsmtm/objc2) | 0.6.4 | MIT | Talking to macOS from the native side |
| [percent-encoding](https://github.com/servo/rust-url) | 2.3.2 | MIT or Apache-2.0 | Passing file paths to the native side |
| [serde](https://serde.rs) | 1.0.229 | MIT or Apache-2.0 | Passing data between the windows and the native side |
| [Phosphor Icons](https://phosphoricons.com) | 2.1.10 | MIT | Icons |
| [Tailwind CSS](https://tailwindcss.com) | 4.2.4 | MIT | Styles (compiled into the app's stylesheet) |

The webR binaries bundle further open-source software, each under its own license
(listed in webR's `LICENSE.md`): PCRE2 (BSD), XZ Utils (public domain), libgfortran
(GPL), LLVM Flang (Apache-2.0).

The Rust and JavaScript libraries these depend on are listed with their versions in
`src-tauri/Cargo.lock` and `package-lock.json`; all are under open-source licenses.

## Color palettes

A graph's palettes (`src/lib/palettes.ts`) are the authors' colors, in their order:

| Palettes | Authors | Source | License |
| --- | --- | --- | --- |
| Okabe-Ito | Masataka Okabe and Kei Ito | [Color Universal Design](https://jfly.uni-koeln.de/color/) (2008) | Free to use |
| Tol Bright, Tol Muted | Paul Tol, SRON | [Colour schemes](https://personal.sron.nl/~pault/) (2021) | BSD 3-Clause, © 2022 Paul Tol |
| Tableau 10 | Tableau Software | [d3-scale-chromatic](https://github.com/d3/d3-scale-chromatic) | ISC, © 2010-2024 Mike Bostock |
| Viridis, Magma, Cividis | Stéfan van der Walt and Nathaniel Smith; Jamie Nuñez et al. (Cividis) | [Matplotlib](https://matplotlib.org) | CC0 (Viridis, Magma); Matplotlib license (Cividis) |
| Batlow, Vik | Fabio Crameri | [Scientific colour maps 8.0.1](https://doi.org/10.5281/zenodo.1243862) | MIT, © Fabio Crameri |
| Coolwarm, Fast | Kenneth Moreland | [Color advice](https://www.kennethmoreland.com/color-advice/) | CC0 |
| vlag | Michael Waskom | [Seaborn](https://seaborn.pydata.org) | BSD 3-Clause, © 2012-2023 Michael L. Waskom |
| RdBu | Cynthia Brewer, Mark Harrower, The Pennsylvania State University | [ColorBrewer](https://colorbrewer2.org) | Apache 2.0, © 2002 |

## Source code

Helix's source code is at <https://github.com/mickaphd/Helix>. The source code of R is at
<https://cran.r-project.org/sources.html>, and that of webR (including how its binaries are
built) at <https://github.com/r-wasm/webr>.
