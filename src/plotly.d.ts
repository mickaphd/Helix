// Plotly's prebuilt bundle has no types. Helix builds plain figure objects
// (views/graphs), so an untyped module is enough. It is the full bundle: the
// volcano needs its WebGL trace (scattergl).
declare module "plotly.js-dist-min";
