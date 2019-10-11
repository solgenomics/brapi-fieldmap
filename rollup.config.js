// rollup.config.js
export default {
  input: 'index',
  output: {
    file: 'dist/BrAPIFieldmap.js',
    format: 'umd',
    name: 'BrAPIFieldmap',
    globals: {
      'd3':'d3',
      '@turf/turf':'turf',
      '@solgenomics/brapijs':'BrAPI',
      'leaflet':'L',
    }
  }
};
