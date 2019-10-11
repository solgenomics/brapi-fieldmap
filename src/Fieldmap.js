import d3 from "d3";
import L from "leaflet";
import "../lib/leaflet.tilelayer.fallback.js";
import "../lib/Leaflet.Editable";

const DEFAULT_OPTS = {
  brapi_auth:null,
  brapi_pageSize:1000,
  defaultPos: [42.464292, -76.451431],
};

export default class Fieldmap {
  constructor(map_container,brapi_endpoint,studyDbId,opts) {
    this.map_container = d3.select(map_container).style("background-color","#888");
    this.brapi_endpoint = brapi_endpoint;
    this.studyDbId = studyDbId;

    // Parse Options
    this.opts = Object.assign(Object.create(DEFAULT_OPTS),opts||{});
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

  subDivide() {
    if (!this.polygon) return;
    let geoJSON = this.polygon.toGeoJSON();
    if (!geoJSON) return;

    let bbox = turf.bbox(geoJSON);
    let rows = d3.select("#rows").node().value,
      cols = d3.select("#cols").node().value,
      plotWidth = (bbox[3]-bbox[1])/rows,
      plotLength = (bbox[2]-bbox[0])/cols;
    let points = [];
    for (let i = 0; i<rows; i++) {
      for (let j = 0; j<cols; j++) {
        points.push(turf.point([bbox[0]+plotLength/2+j*plotLength, bbox[1]+plotWidth/2+i*plotWidth]));
      }
    }
    let geo = turf.voronoi(turf.featureCollection(points), {bbox: turf.bbox(geoJSON)})
      .features.map((plot)=>turf.intersect(plot, geoJSON));
    geo.forEach(plot=>{
      L.polygon(this.featureToL(turf.transformScale(plot, 0.85))).addTo(this.map).enableEdit()
    });
    this.polygon.remove();

  }

  featureToL(feature) {
    return turf.getCoords(turf.flip(feature));
  }

  setLocation(studyDbId) {
    this.brapi = BrAPI(this.brapi_endpoint,"1.2",null);
    this.brapi.studies_detail({studyDbId: studyDbId})
      .map((study)=>{
        if (!(study && study.location)) return;
        this.map.setView([study.location.latitude, study.location.longitude]);
      })
  }
}