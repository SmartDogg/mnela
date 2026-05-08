// `cytoscape-cose-bilkent` ships no type declarations. We declare it as an
// untyped module here (consumed once via dynamic import in MnelaGraph.tsx)
// rather than augmenting at the import site — the augmentation form requires
// pre-existing types that this package doesn't have.
declare module 'cytoscape-cose-bilkent';
