# BrAPI-Fieldmap

Tool for editing field spatial layout using [GeoJson] information. 

![example demo](images/preview.gif)

## Requirements
- BrAPI v2 server
- [@solgenomics/brapijs](https://github.com/solgenomics/BrAPI.js)
- [D3.js](https://github.com/d3/d3) (v4)
- [Leaflet]
- [Leaflet.Editable]
- [Leaflet.Path.Transform]

## Usage

Specify a BrAPI endpoint and studyDbId to get the plot information. If the study observationUnits have geoJson information, 
it will draw them in the map. If they don't have it, you need to select an area over the map to draw the plots based on
other field layout information (e.g X/Y row-col design).
Left-click over plots to resize, move or rotate the entire layout. Right-click to edit individual plots.  

## TODO

- [ ] Extract common modules with [Brapi-HeatMap]?
- [x] Edit individual plots
- [x] Add search location input
- [x] Add option to specify plot length/width
- [ ] Implement [ImageOverlay] to allow a mix of real field images (aerial or drones) with map tiles layer.


## Authors and acknowledgment
Nahuel Soldevilla <nahuel@leafnode.io>

Inspired by and based on [BrAPI-HeatMap]. 
Developed at the [Boyce Thompson Institute] with the help of Mirella Flores, in collaboration with [Integrated Breeding Platform].

[GeoJson]: https://geojson.org/
[BrAPI-HeatMap]: https://github.com/solgenomics/BrAPI-HeatMap
[Leaflet.Editable]: https://github.com/Leaflet/Leaflet.Editable
[Leaflet]: https://leafletjs.com/
[Leaflet.Path.Transform]: https://github.com/w8r/Leaflet.Path.Transform
[Boyce Thompson Institute]: https://btiscience.org/
[Integrated Breeding Platform]: https://integratedbreeding.net/
[ImageOverlay]: https://leafletjs.com/reference-1.0.0.html#imageoverlay