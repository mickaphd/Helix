// File names from paths, as Helix shows them (window titles, Open Recent, alerts).

/** "/a/b/Tumor.hlx" → "Tumor.hlx" */
export const fileName = (path: string) => path.slice(path.lastIndexOf("/") + 1);

/** "/a/b/Tumor.hlx" → "Tumor" */
export const fileTitle = (path: string) => fileName(path).replace(/\.[^.]+$/, "");
