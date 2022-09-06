import d3 from "d3";
import L from "leaflet";
import "../lib/leaflet.tilelayer.fallback.js";
import "../lib/Leaflet.Editable";
import applyDefaultPlot from './defaultPlot.js';

const NO_POLYGON_ERROR = "Please select the area that contain the plots";

const DEFAULT_OPTS = {
  brapi_auth: null,
  brapi_pageSize: 1000,
  brapi_levelName: 'plot',
  defaultPos: [0, 0],
  defaultZoom: 2,
  normalZoom: 16,
  plotWidth: 0,
  plotLength: 0,
  plotScaleFactor: 1,
  style: {
    weight: 1
  },
  useGeoJson: true,
  tileLayer: {
    url: 'http://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}?blankTile=false',
    options: {
      attribution: '&copy; <a href="http://www.esri.com/">Esri</a>, DigitalGlobe, GeoEye, i-cubed, USDA FSA, USGS, AEX, Getmapping, Aerogrid, IGN, IGP, swisstopo, and the GIS User Community',
      maxZoom: 28,
      maxNativeZoom: 19
    }
  }
};

export default class Fieldmap {
  constructor(map_container, brapi_endpoint, opts) {
    this.map_container = d3.select(map_container).style("background-color", "#888");
    this.brapi_endpoint = brapi_endpoint;

    // Parse Options
    this.opts = Object.assign(Object.create(DEFAULT_OPTS), opts || {});
    this.map = L.map(this.map_container.node(), {editable: true}).setView(this.opts.defaultPos, 2);
    this.map.on('preclick', ()=>{
      if (this.editablePolygon) this.finishTranslate();
      if (this.editablePlot) this.finishPlotEdition();
    });

    this.tilelayer = L.tileLayer.fallback(this.opts.tileLayer.url, this.opts.tileLayer.options).addTo(this.map);

    L.EditControl = L.Control.extend({
      options: {
        position: 'topleft',
        callback: null,
        title: '',
        html: ''
      },
      onAdd: function (map) {
        var container = L.DomUtil.create('div', 'leaflet-control leaflet-bar'),
          link = L.DomUtil.create('a', '', container);
        link.href = '#';
        link.title = this.options.title;
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
          title: 'Creates a new polygon',
          html: String.fromCodePoint(0x25B1)
        }
      });
      L.NewRectangleControl = L.EditControl.extend({
        options: {
          position: 'topleft',
          callback: function () {
            self.polygon = self.map.editTools.startRectangle();
            return self.polygon;
          },
          title: 'Creates a new rectangle',
          html: String.fromCodePoint(0x25AD)
        }
      });
      L.NewClearControl = L.EditControl.extend({
        options: {
          position: 'topleft',
          callback: function () {
            self.map.editTools.featuresLayer.clearLayers();
          },
          title: 'Clears all polygons',
          html: String.fromCodePoint(0x1F6AB)
        }
      });

    this.map.addControl(new L.Control.Search({
      url: 'https://nominatim.openstreetmap.org/search?format=json&q={s}',
      jsonpParam: 'json_callback',
      propertyName: 'display_name',
      propertyLoc: ['lat', 'lon'],
      autoCollapse: true,
      autoType: false,
      minLength: 2,
      marker: false,
      zoom: this.opts.normalZoom
    }));

    this.polygonControl = new L.NewPolygonControl();
    this.rectangleControl = new L.NewRectangleControl();
    this.clearPolygonsControl = new L.NewClearControl();

    this.map.addControl(this.polygonControl);
    this.map.addControl(this.rectangleControl);
    this.map.addControl(this.clearPolygonsControl);

    this.info = this.map_container.append("div")
      .style("bottom","5px")
      .style("left","5px")
      .style("position","absolute")
      .style("z-index",999)
      .style("pointer-events","none")
      .style("background", "white")
      .style("border-radius", "5px");
  }

  removeControls() {
    this.map.removeControl(this.polygonControl);
    this.map.removeControl(this.rectangleControl);
    this.map.removeControl(this.clearPolygonsControl);
  }

  load(studyDbId) {
    this.generatePlots(studyDbId);
    return this.data.then(()=>{
      this.drawPlots(); return true;
    }).catch(resp=>{
      console.log(resp)
    });
  }

  drawPlots() {
    if (this.plotsLayer) this.plotsLayer.remove();
    this.plotsLayer = L.featureGroup(this.plots.features.map((plot)=>{
      return L.geoJSON(turf.transformScale(plot, this.opts.plotScaleFactor), this.opts.style);
    })).on('contextmenu', (e)=>{
      if (this.editablePlot) {
        this.finishPlotEdition();
      }
      this.enableEdition(e.sourceTarget)
    }).on('click', (e)=>{
      this.enableTransform(e.target)
    }).on('mousemove', (e)=>{
      let sourceTarget = e.sourceTarget;
      let ou = this.plot_map[sourceTarget.feature.properties.observationUnitDbId];
      get_oup_rel(ou).forEach((levels)=>{ 
          if(levels.levelName == 'replicate'){ ou.replicate = levels.levelCode;}
        else if(levels.levelName == 'block'){ ou.blockNumber = levels.levelCode;}
        else if(levels.levelName == 'plot'){ ou.plotNumber = levels.levelCode;}});
      this.info.html(`<div style="padding: 5px"><div>Germplasm: ${ou.germplasmName}</div>
       <div>Replicate: ${ou.replicate}</div>
       <div>    Block: ${ou.blockNumber}</div>
       <div>  Row,Col: ${ou._row},${ou._col}</div>
       <div>   Plot #: ${ou.plotNumber}</div></div>`)
    }).on('mouseout', ()=>{
      this.info.html("");
    }).addTo(this.map);
  }

  enableEdition(plot) {
    this.editablePlot = plot;
    plot.enableEdit();
  }

  finishPlotEdition() {
    this.editablePlot.disableEdit();
    this.plots = turf.featureCollection(this.plots.features.map((plot)=>{
      if (plot.properties.observationUnitDbId == this.editablePlot.feature.properties.observationUnitDbId) {
        let geojson = this.editablePlot.toGeoJSON();
        plot = turf.convex(geojson);
        plot.properties = geojson.properties;
      }
      return plot;
    }));
    this.editablePlot = null;
  }

  enableTransform(plotGroup) {
    this.plotsLayer.remove();
    this.editablePolygon = L.polygon(Fieldmap.featureToL(turf.convex(plotGroup.toGeoJSON())),
      Object.assign({transform:true,draggable:true}, this.opts.style))
      .on('dragend', (e)=>{
        let target = e.target;
        let startPos = turf.center(this.plots);
        let endPos = turf.center(target.toGeoJSON());
        this.plots = turf.transformTranslate(this.plots,
          turf.distance(startPos, endPos),
          turf.bearing(startPos, endPos));
        this.finishTranslate();
      })
      .on('scaleend', (e)=>{
        let target = e.target;
        let startPos = turf.center(this.plots);
        let endPos = turf.center(target.toGeoJSON());
        let startArea = turf.area(this.plots);
        let endArea = turf.area(target.toGeoJSON());
        let factor = Math.sqrt(endArea/startArea);
        this.plots = turf.featureCollection(this.plots.features.map((plot)=>{
          let startCoord = turf.getCoords(startPos);
          let plotCoord = turf.getCoords(turf.center(plot));
          let bearing = turf.bearing(startCoord,plotCoord);
          let distance = turf.distance(startCoord,plotCoord);
          // after resize, bearing to centroid of all plots is the same, but scaled by the resize factor
          let plotEndCoord = turf.getCoords(turf.destination(turf.getCoords(endPos),distance*factor,bearing));
          plot = turf.transformTranslate(plot,
            turf.distance(plotCoord, plotEndCoord),
            turf.bearing(plotCoord, plotEndCoord));
          plot = turf.transformScale(plot, factor);
          return plot
        }));
        this.finishTranslate();
      })
      .on('rotateend', (e)=>{
        this.plots = turf.transformRotate(this.plots, turf.radiansToDegrees(e.rotation));
        this.finishTranslate();
      })
      .addTo(this.map);
      this.editablePolygon.transform.enable();
      this.editablePolygon.dragging.enable();
  }

  finishTranslate() {
    let polygon = this.editablePolygon;
    polygon.transform.disable();
    polygon.dragging.disable();
    this.drawPlots();
    setTimeout(()=>{
      this.editablePolygon.remove();
      this.editablePolygon = null;
    });
  }

  /**
   * Try to make the polygon vertical before calculating row and col,
   * by rotating it in an angle formed between the center and one of
   * the far ends.
   */
  level() {
    let cellSide = Math.sqrt(turf.area(this.geoJson))/1000/10/2;
    let grid = turf.pointGrid(turf.bbox(this.geoJson), cellSide, {mask: this.geoJson});
    let center = turf.getCoord(turf.centerOfMass(this.geoJson));
    let distances = grid.features.map(f=>turf.distance(center, turf.getCoord(f))).sort();
    let q3 = d3.quantile(distances, 0.75);
    let clusters = turf.clustersKmeans(turf.featureCollection(grid.features.filter((f)=>{
      return turf.distance(center,turf.getCoord(f)) > q3;
    })), {numberOfClusters: 2});
    let clusterCenters = [];
    turf.clusterEach(clusters, 'cluster', (cluster)=>{
      clusterCenters.push(turf.getCoord(turf.center(cluster)));
    });
    let bearing = turf.bearing(center, this.northernmost(clusterCenters[0], clusterCenters[1]));
    this.rotation = 90-( (Math.round(Math.abs(bearing)) == 0 || Math.round(Math.abs(bearing)) == 90) ? 90:bearing);
    this.geoJson = turf.transformRotate(this.geoJson, this.rotation);
  }

  northernmost() {
    return [].slice.call(arguments).sort((a,b)=>b[1] - a[1])[0];
  }

  generatePlots(studyDbId) {
    return this.load_ObsUnits(studyDbId)
      .then((data)=>{
        this.plots = turf.featureCollection(data.plots.map(p=>{
          return Object.assign(p._geoJSON, {properties: {observationUnitDbId: p.observationUnitDbId}});
        }));
        if (!data.plots_shaped) {
          // rotate to original position
          this.plots = turf.transformRotate(this.plots, -this.rotation);
        }
        this.fitBounds(this.plots);
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
      const brapi = BrAPI(this.brapi_endpoint, "2.0", this.opts.brapi_auth);
      var results = {'plots':[]};
      brapi.search_observationunits({
        "studyDbIds":[studyDbId],
        'pageSize':this.opts.brapi_pageSize,
        'observationLevels' : [{ "levelName" : this.opts.brapi_levelName }]
      })
        .each(ou=>{
          ou.X = parseFloat(ou.X);
          ou.Y = parseFloat(ou.Y);
          if(ou.observationUnitPosition.observationLevel.levelName.toUpperCase() === "PLOT") results.plots.push(ou);
          this.data_parsed+=1;
          this.data_total = ou.__response.metadata.pagination.totalCount;
        })
        .all(()=>{
          // ensure unique
          this.plot_map = {};
          results.plots = results.plots.reduce((acc,plot)=>{
            if(!this.plot_map[plot.observationUnitDbId]){
              this.plot_map[plot.observationUnitDbId] = plot;
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
            results.blocks = d3.nest().key(plot=>get_oup(plot).blockNumber).entries(results.plots);
            results.reps = d3.nest().key(plot=>get_oup(plot).replicate).entries(results.plots);
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
      const oup = get_oup(ou);
      ou._X = ou.X || oup.positionCoordinateX;
      ou._Y = ou.Y || oup.positionCoordinateY;
      try {
        ou._geoJSON = (this.opts.useGeoJson && oup.geoCoordinates)
                      || null;
      } catch (e) {}
      ou._type = ""
      if (!isNaN(ou._X) && !isNaN(ou._Y)){
        if(oup.positionCoordinateXType
          && oup.positionCoordinateYType){
          if(oup.positionCoordinateXType=="GRID_ROW" && oup.positionCoordinateYType=="GRID_COL"
            || oup.positionCoordinateXType=="GRID_COL" && oup.positionCoordinateYType=="GRID_ROW"){
            ou._row = oup.positionCoordinateYType=="GRID_ROW" ? parseInt(ou._Y) : parseInt(ou._X);
            ou._col = oup.positionCoordinateXType=="GRID_COL" ? parseInt(ou._X) : parseInt(ou._Y);
          }
          if(oup.positionCoordinateXType=="LONGITUDE" && oup.positionCoordinateYType=="LATITUDE"){
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
    data.plots_shaped = false;
    if(data.plots.every(plot=>(plot._type=="Polygon"))){
      // Plot shapes already exist!
      data.plots_shaped = this.opts.useGeoJson;
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
      data.plots_shaped = this.opts.useGeoJson;
    }

    let plot_XY_groups = {};
    // group by plots with the same X/Y
    data.plots.forEach(plot=>{
      plot_XY_groups[plot._col] = plot_XY_groups[plot._col] || {};
      plot_XY_groups[plot._col][plot._row] = plot_XY_groups[plot._col][plot._row] || {};
      plot_XY_groups[plot._col][plot._row]=[plot];
    });

    if(!data.plots_shaped){
      if (!this.polygon || !turf.area(this.polygon.toGeoJSON())) {
        throw NO_POLYGON_ERROR;
      }
      this.geoJson = this.polygon.toGeoJSON();
      this.polygon.remove();
      this.level();
      const bbox = turf.bbox(this.geoJson);
      this.opts.defaultPos = [bbox[0], bbox[3]];
      let plotLength = this.opts.plotLength/1000,
        plotWidth = this.opts.plotWidth/1000;
      const cols = Object.keys(plot_XY_groups).length,
        rows =  Object.values(plot_XY_groups).reduce((acc, col)=>{
          Object.keys(col).forEach((row, i)=>{
            if (!row) return;
            acc[i] = acc[i]+1 || 1;
          });
          return acc;
        }, []).filter(x=>x).length;
      plotLength = plotLength || turf.length(turf.lineString([[bbox[0], bbox[1]], [bbox[0], bbox[3]]]))/rows;
      plotWidth = plotWidth || turf.length(turf.lineString([[bbox[0], bbox[1]], [bbox[2], bbox[1]]]))/cols;
      // Use default plot shapes/positions based on X/Y positions
      for (let X in plot_XY_groups) {
        if (plot_XY_groups.hasOwnProperty(X)) {
          for (let Y in plot_XY_groups[X]) {
            if (plot_XY_groups[X].hasOwnProperty(Y)) {
              X = parseInt(X);
              Y = parseInt(Y);
              let polygon = this.defaultPlot(Y-1, X-1, plotWidth, plotLength);
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

  fitBounds(feature) {
    let bbox = turf.bbox(feature);
    this.map.fitBounds([[bbox[1], bbox[0]], [bbox[3], bbox[2]]]);
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

  static featureToL(feature) {
    return turf.getCoords(turf.flip(feature));
  }

  setLocation(studyDbId) {
    return new Promise((resolve, reject) => {
      this.brapi = BrAPI(this.brapi_endpoint, "2.0", this.opts.brapi_auth);
      this.brapi.studies_detail({studyDbId: studyDbId}).map((study) => {
        if (!study) {
          reject();
          return;
        }
        if (study.location && study.location.latitude && study.location.longitude) {
          // XXX some clients use the brapi v1 format
          this.map.setView([
            study.location.latitude,
            study.location.longitude
          ], this.opts.normalZoom);
          resolve();
        } else if (study.locationDbId) {
          this.brapi.locations_detail({locationDbId: study.locationDbId}).map((location) => {
            if (!location || !location.coordinates) {
              reject();
              return;
            }
            this.map.setView(Fieldmap.featureToL(location.coordinates), this.opts.normalZoom);
            resolve();
          });
        } else {
          reject();
        }
      });
    });
  }

  debug(feature) {
    L.geoJSON(feature, {color: 'red'}).addTo(this.map);
    return feature;
  }

  update() {
    if (!this.plots) {
      return Promise.reject('There are no plots loaded');
    }
    let brapi = BrAPI(this.brapi_endpoint, "2.0", this.opts.brapi_auth);
    let nodes = [];
    this.plots.features.forEach((plot)=>{
      let params = {
        observationUnitPosition: {geoCoordinates: plot, observationLevel:{levelName: this.opts.brapi_levelName }},
        observationUnitDbId: plot.properties.observationUnitDbId
      };
      // XXX Using internal brapijs method for now
      nodes.push(brapi.simple_brapi_call({
        'defaultMethod': 'put', // TODO patch
        'urlTemplate': '/observationunits/{observationUnitDbId}',
        'params': params,
        'behavior': 'map',
      }))
    });
    return new Promise((resolve, reject)=> {
      if (nodes.length > 0) {
        brapi.join(...nodes).all(()=> {
          resolve('Plots updated!')
        });
      } else {
        reject('There are no plots loaded')
      }
    })
  }
}

function get_oup(ou) {
  return ou.observationUnitPosition || {};
}

function get_oup_rel(ou) {
  return (ou.observationUnitPosition || {}).observationLevelRelationships || {};
}

applyDefaultPlot(Fieldmap);
