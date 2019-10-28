export default function (FieldMap) {
  FieldMap.prototype.defaultPlot = function (row, col, plotWidth, plotLength) {
    plotWidth = plotWidth || this.opts.defaultPlotWidth;
    plotLength = plotLength || this.opts.defaultPlotWidth;
    var o = turf.point(this.opts.defaultPos);
    var tl = turf.destination(
      turf.destination(
        o,
        plotWidth*col,
        90,
        {'units': 'kilometers'}
      ),
      plotLength*row,
      180,
      {'units': 'kilometers'}
    );
    var br = turf.destination(
      turf.destination(
        tl,
        plotWidth,
        90,
        {'units': 'kilometers'}
      ),
      plotLength,
      180,
      {'units': 'kilometers'}
    );
    var tr = turf.point([tl.geometry.coordinates[0], br.geometry.coordinates[1]]);
    var bl = turf.point([br.geometry.coordinates[0], tl.geometry.coordinates[1]]);
    return turf.polygon([
      [tl, tr, br, bl, tl].map(turf.getCoord)
    ], {});
  }
}
