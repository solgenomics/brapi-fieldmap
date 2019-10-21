import d3 from "d3";
import L from "leaflet";
import "../lib/leaflet.tilelayer.fallback.js";
import "../lib/Leaflet.Editable";
import applyDefaultPlot from './defaultPlot.js';

const DEFAULT_OPTS = {
  brapi_auth: null,
  brapi_pageSize: 1000,
  defaultPos: [42.464292, -76.451431],
  gridSize: 500,
  defaultPlotWidth: 0.002,
  plotScaleFactor: 0.85,
};

export default class Fieldmap {
  constructor(map_container, brapi_endpoint, studyDbId, opts) {
    this.map_container = d3.select(map_container).style("background-color", "#888");
    this.brapi_endpoint = brapi_endpoint;
    this.studyDbId = studyDbId;

    // Parse Options
    this.opts = Object.assign(Object.create(DEFAULT_OPTS), opts || {});
    this.map = L.map(this.map_container.node(), {editable: true}).setView(this.opts.defaultPos, 16);
    this.map.scrollWheelZoom.disable();

    this.tilelayer = L.tileLayer.fallback('http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false', {
      attribution: '&copy; <a href="http://www.esri.com/">Esri</a>, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community',
      maxZoom: 28,
      maxNativeZoom: 19
    }).addTo(this.map);

    L.EditControl = L.Control.extend({
      options: {
        position: 'topleft',
        callback: null,
        kind: '',
        html: ''
      },
      onAdd: function (map) {
        var container = L.DomUtil.create('div', 'leaflet-control leaflet-bar'),
          link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = 'Create a new '+this.options.kind;
        link.innerHTML = this.options.html;
        L.DomEvent.on(link, 'click', L.DomEvent.stop)
          .on(link, 'click', function () {
            window.LAYER = this.options.callback.call(map.editTools);
          }, this);
        return container;
      }
    });

    let self = this;
    L.NewPolygonControl = L.EditControl.extend({
      options: {
        position: 'topleft',
        callback: function () {
          self.polygon = self.map.editTools.startPolygon();
          return self.polygon;
        },
        kind: 'polygon',
        html: '▰'
      }
    });
    L.NewMarkerControl = L.EditControl.extend({
      options: {
        position: 'topleft',
        callback: self.map.editTools.startMarker,
        kind: 'marker',
        html: '🖈'
      }
    });
    L.NewRectangleControl = L.EditControl.extend({
      options: {
        position: 'topleft',
        callback: function () {
          self.polygon = self.map.editTools.startRectangle();
          return self.polygon;
        },
        kind: 'rectangle',
        html: '⬛'
      }
    });

    this.map.addControl(new L.NewMarkerControl());
    this.map.addControl(new L.NewPolygonControl());
    this.map.addControl(new L.NewRectangleControl());

  }

  generate(studyDbId) {
    if (!this.polygon) return;
    this.geoJson = this.polygon.toGeoJSON();
    if (!this.geoJson) return;

    this.level();
    this.generatePlots(studyDbId);

    this.data.then((data)=>{
      let plots = data.plots;
      // rotate to original position
      plots = turf.transformRotate(plots, -this.rotation);
      if (this.plotsLayer) this.plotsLayer.remove();
      this.plotsLayer = L.featureGroup(plots.features
        .map((plot)=>L.polygon(this.featureToL(turf.transformScale(plot, this.opts.plotScaleFactor)), {
          color: '#444',
          weight: 1
        })))
        .addTo(this.map);
      this.polygon.remove();
    });
  }

  /**
   * Try to make the polygon horizontal before calculating row and col.
   *
   * Approximates a line that cuts the polygon in half by taking an average of lines to each point in a grid
   *
   * FIXME improve, it doesn't work well with near vertical polygons
   */
  level() {
    let cellSide = Math.sqrt(turf.area(this.geoJson))/1000/10/2;
    let grid = turf.pointGrid(turf.bbox(this.geoJson), cellSide, {mask: this.geoJson});
    let center = turf.getCoord(turf.centerOfMass(this.geoJson));
    let slopes = grid.features
      .map(f=>{
        let coord = turf.getCoord(f);
        let slope = (coord[1]-center[1])/(coord[0]-center[0]);
        return slope === Infinity ? Number.MAX_VALUE : slope === -Infinity ? Number.MIN_VALUE : slope;
      })
      .filter(x=>[NaN].indexOf(x) < 0);
    let avgSlope = slopes
      .reduce((prev, curr)=>{
        return prev+curr;
      }, 0)/grid.features.length;
    let bearing = turf.bearing(center, [center[0]+cellSide, center[1]+cellSide*avgSlope]);
    this.rotation = 180-bearing;
    this.geoJson = turf.transformRotate(this.geoJson, this.rotation);
  }

  generatePlots(studyDbId) {
    if (studyDbId) {
      return this.generateFromStudy(studyDbId);
    }

    // calculate cell centroids
    let bbox = turf.bbox(this.geoJson);
    let rows = d3.select("#rows").node().value,
      cols = d3.select("#cols").node().value,
      plotWidth = (bbox[3]-bbox[1])/rows,
      plotLength = (bbox[2]-bbox[0])/cols;
    let points = [];
    for (let i = 0; i < rows; i++) {
      for (let j = 0; j < cols; j++) {
        points.push(turf.point([bbox[0]+plotLength/2+j*plotLength, bbox[1]+plotWidth/2+i*plotWidth]));
      }
    }

    // generate plots
    let plots = turf.voronoi(turf.featureCollection(points), {bbox: turf.bbox(this.geoJson)})
      .features.filter(x=>x).map((plot)=>turf.intersect(plot, this.geoJson));
    plots = turf.featureCollection(plots);
    this.data = Promise.resolve({plots});
  }

  generateFromStudy(studyDbId) {
    let bbox = turf.bbox(this.geoJson);
    this.opts.defaultPos = [bbox[0], bbox[3]];
    this.load_ObsUnits(studyDbId)
      .then((data)=>{
        data.plots = turf.featureCollection(data.plots.map(p=>p._geoJSON));
      });
  }

  load_ObsUnits(studyDbId){
    this.new_data = true;
    this.data_parsed = 0;
    this.data_total = 0;
    if(this.data && this.data_parsed!=this.data_total){
      this.data.reject("New Load Started");
    }
    var rej;
    var rawdata = new Promise((resolve,reject)=>{
      rej = reject;
      const brapi = BrAPI(this.brapi_endpoint, "1.2", null);
      var results = {'plots':[]};
      brapi.phenotypes_search({
        "studyDbIds":[studyDbId],
        'pageSize':this.opts.brapi_pageSize
      })
        .each(ou=>{
          ou.X = parseFloat(ou.X);
          ou.Y = parseFloat(ou.Y);
          if(ou.observationLevel=="plot") results.plots.push(ou);
          this.data_parsed+=1;
          this.data_total = ou.__response.metadata.pagination.totalCount;
        })
        .all(()=>{
          // ensure unique
          var plot_map = {};
          results.plots = results.plots.reduce((acc,plot)=>{
            if(!plot_map[plot.observationUnitDbId]){
              plot_map[plot.observationUnitDbId] = plot;
              acc.push(plot);
            }
            return acc;
          },[]);

          // sort
          results.plots.sort(function(a,b){
            if(a.plotNumber!=b.plotNumber){
              return parseFloat(a.plotNumber)>parseFloat(b.plotNumber)?1:-1
            }
            return 1;
          });

          if(results.plots.length>0){
            results.blocks = d3.nest().key(plot=>plot.blockNumber).entries(results.plots);
            results.reps = d3.nest().key(plot=>plot.replicate).entries(results.plots);
          }

          clearInterval(this.while_downloading);
          resolve(results);
        });
    });
    this.data = rawdata.then((d)=>this.shape(d));
    this.data.reject = rej;
    this.while_downloading = setInterval(()=>{
      var status = this.data_parsed+"/"+this.data_total;
      console.log(status);
    },500);
    rawdata.catch(e=>{
      clearInterval(this.while_downloading);
      console.log(e);
    });
    return this.data;
  }

  shape(data){
    data.shape = {};

    // Determine what information is available for each obsUnit
    data.plots.forEach((ou)=>{
      ou._X = ou.X || ou.positionCoordinateX;
      ou._Y = ou.Y || ou.positionCoordinateY;
      ou._geoJSON = ou.observationUnitGeoJSON
      ou._type = ""
      if (!isNaN(ou._X) && !isNaN(ou._Y)){
        if(ou.positionCoordinateXType
          && ou.positionCoordinateYType){
          if(ou.positionCoordinateXType=="GRID_ROW" && ou.positionCoordinateYType=="GRID_COL"
            || ou.positionCoordinateXType=="GRID_COL" && ou.positionCoordinateYType=="GRID_ROW"){
            ou._row = parseInt(ou._Y) ? ou.positionCoordinateYType=="GRID_ROW" : ou._X;
            ou._col = parseInt(ou._X) ? ou.positionCoordinateXType=="GRID_COL" : ou._Y;
          }
          if(ou.positionCoordinateXType=="LONGITUDE" && ou.positionCoordinateYType=="LATITUDE"){
            if(!ou._geoJSON) ou._geoJSON = turf.point([ou._X,ou._Y]);
          }
        }
        else {
          if(ou._X==Math.floor(ou._X) && ou._Y==Math.floor(ou._Y)){
            ou._row = parseInt(ou._Y);
            ou._col = parseInt(ou._X);
          }
          else {
            try {
              if(!ou._geoJSON) ou._geoJSON = turf.point([ou._X,ou._Y]);
            } catch (e) {}
          }
        }
      }
      if(ou._geoJSON){
        ou._type = turf.getType(ou._geoJSON)
      }
    });

    // Generate a reasonable plot layout if there is missing row/col data
    if( data.plots.some(plot=>isNaN(plot._row)||isNaN(plot._col)) ){
      var lyt_width = this.layout_width(
        Math.round(d3.median(data.blocks,block=>block.values.length)),
        data.plots.length
      );
      data.plots.forEach((plot,pos)=>{
        let row = Math.floor(pos/lyt_width);
        let col = (pos%lyt_width);
        if (row%2==1) col = (lyt_width-1)-col;
        plot._col = col;
        plot._row = row;
      })
    }

    // Shape Plots
    let plots_shaped = false;
    if(data.plots.every(plot=>(plot._type=="Polygon"))){
      // Plot shapes already exist!
      plots_shaped = true;
    }
    else if(data.plots.every(plot=>(plot._type=="Point"||plot._type=="Polygon"))){
      // Create plot shapes using centroid Voronoi
      var centroids = turf.featureCollection(data.plots.map((plot,pos)=>{
        return turf.centroid(plot._geoJSON)
      }));
      var scale_factor = 50; //prevents rounding errors
      var scale_origin = turf.centroid(centroids);
      centroids = turf.transformScale(centroids,scale_factor,{origin:scale_origin});
      var bbox = turf.envelope(centroids);
      var area = turf.area(bbox);
      var offset = -Math.sqrt(area/data.plots.length)/1000/2;
      var hull = turf.polygonToLine(turf.convex(centroids, {units: 'kilometers'}));
      var crop = turf.lineToPolygon(turf.lineOffset(hull, offset, {units: 'kilometers'}));
      var voronoiBox = turf.lineToPolygon(turf.polygonToLine(turf.envelope(crop)));
      var cells = turf.voronoi(centroids,{bbox:turf.bbox(voronoiBox)});
      var cells_cropped = turf.featureCollection(cells.features.map(cell=>turf.intersect(cell,crop)));
      cells_cropped = turf.transformScale(cells_cropped,1/scale_factor,{origin:scale_origin});
      data.plots.forEach((plot,i)=>{
        plot._geoJSON = cells_cropped.features[i];
      })
      plots_shaped = true;
    }

    let plot_XY_groups = [];
    // group by plots with the same X/Y
    data.plots.forEach(plot=>{
      plot_XY_groups[plot._col] = plot_XY_groups[plot._col] || [];
      plot_XY_groups[plot._col][plot._row] = plot_XY_groups[plot._col][plot._row] || [];
      plot_XY_groups[plot._col][plot._row].push(plot);
    });

    if(!plots_shaped){
      const bbox = turf.bbox(this.geoJson),
        cols = plot_XY_groups.length,
        rows = plot_XY_groups.reduce((acc, col)=>{
          col.forEach((row, i)=>{
            if (!row) return;
            acc[i] = acc[i]+1 || 1;
          });
          return acc;
        }, []).filter(x=>x).length,
        plotLength = turf.length(turf.lineString([[bbox[0],bbox[1]],[bbox[0],bbox[3]]]))/rows,
        plotWidth = turf.length(turf.lineString([[bbox[0],bbox[1]],[bbox[2],bbox[1]]]))/cols;
      // Use default plot shapes/positions based on X/Y positions
      for (let X in plot_XY_groups) {
        if (plot_XY_groups.hasOwnProperty(X)) {
          for (let Y in plot_XY_groups[X]) {
            if (plot_XY_groups[X].hasOwnProperty(Y)) {
              X = parseInt(X)
              Y = parseInt(Y)
              let polygon = this.defaultPlot(Y, X, plotWidth, plotLength);
              // if for some reason plots have the same x/y, split that x/y region
              plot_XY_groups[X][Y].forEach((plot, i)=>{
                plot._geoJSON = this.splitPlot(polygon, plot_XY_groups[X][Y].length, i);
              })
            }
          }
        }
      }
    }

    return data;
  }

  layout_width(median_block_length,number_of_plots){
    let bllen = median_block_length;
    let squarelen = Math.round(Math.sqrt(number_of_plots));
    let lyt_width;
    if(squarelen==bllen){
      lyt_width = squarelen;
    }
    else if (squarelen>bllen) {
      lyt_width = Math.round(squarelen/bllen)*bllen;
    }
    else {
      let closest_up = (bllen%squarelen)/Math.floor(bllen/squarelen);
      let closest_down = (squarelen-bllen%squarelen)/Math.ceil(bllen/squarelen);
      lyt_width = Math.round(
        closest_up<=closest_down?
          squarelen+closest_up:
          squarelen-closest_down
      );
    }
    return lyt_width;
  }

  splitPlot(polygon,partitions,index){
    this.splitPlot_memo = this.splitPlot_memo || {};
    let memo_key = `(${partitions})${polygon.geometry.coordinates.join(",")}`;
    if(this.splitPlot_memo[memo_key]) return this.splitPlot_memo[memo_key][index];
    if(!partitions||partitions<2) return (this.splitPlot_memo[memo_key] = [polygon])[index];

    let scale_factor = 50; //prevents rounding errors
    let scale_origin = turf.getCoord(turf.centroid(polygon));
    polygon = turf.transformScale(polygon, scale_factor, {'origin':scale_origin});

    let row_width = Math.ceil(Math.sqrt(partitions));
    let row_counts = [];
    for (var i = 0; i < Math.floor(partitions/row_width); i++) {
      row_counts[i] = row_width
    }
    if(partitions%row_width) row_counts[row_counts.length] = partitions%row_width;

    let polygonbbox = turf.bbox(polygon);
    polygonbbox[0]-=0.00001; polygonbbox[1]-=0.00001; polygonbbox[2]+=0.00001; polygonbbox[3]+=0.00001;
    let w = Math.sqrt(turf.area(polygon))/1000;
    let area = 50+100*partitions;
    let grid_dist = w/Math.sqrt(area);
    let grid = turf.pointGrid(polygonbbox,grid_dist,{'mask':polygon});
    let points = grid.features;

    let points_per_part = Math.floor(points.length/partitions);

    let row_point_counts = row_counts.map(rc=>rc*points_per_part);

    points = points.sort((b,a)=>d3.ascending(turf.getCoord(a)[1],turf.getCoord(b)[1]));

    let t = 0;
    let rows = [];
    row_point_counts.forEach((rpc,i)=>{
      rows[i] = [];
      while (rows[i].length<rpc && t<points.length){
        rows[i].push(points[t++]);
      }
    })

    let collecs = [];
    rows.forEach((row,ri)=>{
      row = row.sort((a,b)=>d3.ascending(turf.getCoord(a)[0],turf.getCoord(b)[0]));
      let p = 0;
      let c0 = collecs.length;
      for (var ci = c0; ci < c0+row_counts[ri]; ci++) {
        collecs[ci] = []
        while (collecs[ci].length<points_per_part && p<row.length){
          collecs[ci].push(row[p++]);
        }
      }
    })
    let centroids = turf.featureCollection(collecs.map(c=>turf.centroid(turf.featureCollection(c))));
    var voronoi = turf.voronoi(
      centroids,
      {'bbox':polygonbbox}
    );
    this.splitPlot_memo[memo_key] = voronoi.features.map(vc=>{
      var mask = turf.mask(vc,turf.bboxPolygon(polygonbbox));
      var c = turf.difference(polygon,mask);
      return turf.transformScale(c, 1/scale_factor, {'origin':scale_origin})
    });
    return this.splitPlot_memo[memo_key][index];
  }

  featureToL(feature) {
    return turf.getCoords(turf.flip(feature));
  }

  setLocation(studyDbId) {
    this.brapi = BrAPI(this.brapi_endpoint, "1.2", null);
    this.brapi.studies_detail({studyDbId: studyDbId})
      .map((study)=>{
        if (!(study && study.location)) return;
        this.map.setView([study.location.latitude, study.location.longitude]);
      })
  }

  debug(feature) {
    L.geoJSON(feature).addTo(this.map);
    return feature;
  }
}

applyDefaultPlot(Fieldmap);
