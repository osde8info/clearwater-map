;(function () {
  var window = this;

	// The top-level namespace. All public classes and modules will
	// be attached to this.
	var MapStory = this.MapStory = {};
  
  //--- Some feature detection ---//
  
  var retina = false; //window.devicePixelRatio >= 2;
  
  // Detect css transform
  var cssTransform = (function(){
    var prefixes = 'transform webkitTransform mozTransform oTransform msTransform'.split(' ')
      , el = document.createElement('div')
      , cssTransform
      , i = 0;
    while ( cssTransform === undefined ) { 
      cssTransform = document.createElement('div')
                      .style[prefixes[i]] != undefined ? prefixes[i] : undefined;
      i++;
   }
   return cssTransform;
  })();


  // Detect request animation frame
  var _requestAnimation = window.requestAnimationFrame 
                        || window.webkitRequestAnimationFrame
                        || window.mozRequestAnimationFrame
                        || window.msRequestAnimationFrame 
                        || window.oRequestAnimationFrame 
                        || function (callback) { window.setTimeout(callback, 1000/60) };
  
  //-- *************** --//
  //-- Customize below --//
  //-- *************** --//
    
  // Bing Maps API key for satellite layer
  // Register for key at http://...
  // NEEDS CHANGED: is currently only a trial key for 90 days
  var BING_API_KEY = "AnadQ9NziZo9MYVo8394fMtJjPrkZMasNfSqpt5wz4vUMSaATniZnKxvDgxrsrGB";
  
  // Bounds for the initial view of the map (Ecuador)
  var startBounds = [{ lat: -5.2, lon: -81.2 }, { lat: 1.8, lon: -74.9 }]; 
  var PROJECT_BOUNDS = [ [-1.1, -77.7], [0.5, -75.2]];
  
  // Array of locations for each story on the map
  // The first location is for the initial map view
  // it should be attached to the #map element which has offset().top = 0
  // bounds as [[ lonSouth, latWest], [lonNorth, latEast]] - blame d3 for this order.
  // TODO change this - not very obvious.
  var storyLocations = [
    { id: 'map', bounds: [ [-81.2, -5.2], [-74.9, 1.8] ] }
  ];
  
  // Data sources for overlay and markers (loaded with JSONP)
  var communitiesSql = 'SELECT ST_Simplify(the_geom, 0.0001)' +
                   'AS the_geom, community, nationality ' + 
                   'FROM communities WHERE active';
  var projectAreaSql = 'SELECT ST_Simplify(the_geom, 0.001)' +
                  'AS the_geom, name AS community ' + 
                  'FROM project_area';
  var markerSql = 'SELECT * FROM clearwater_well_installations';

  //-- ***************************** --//
  //-- End of customizable variables --//
  //-- ***************************** --//
  
  var satLayer,
      labelLayer,
      projectLayer,
      communityLayer,
      markerLayer,
      map,
      storyScrollPoints = [],
      layerScrollPoints = [],
      easings = [],
      easeHandler,
      reveals = [],
      lastPositionR = -1,
      wHeight = $(window).height(),
      mapPadding = {},
      markerBounds = [],
      projectLayerIsLoaded = false,
      communitiesLayerIsLoaded = false;;

  // Overwrite ModestMaps getMousePoint function - it does not like
  // the map in position: fixed and gets confused.
  // *WARNING* this will need modified if the map div has padding/margins
  // This only works when filling the browser window.
  MM.getMousePoint = function(e, map) {
      var point = new MM.Point(e.clientX, e.clientY);
      return point;
  };
  
  //--- Start of public functions of MapStory ---//

  MapStory.init = function (storyContainerId, mapContainerId, baseLayerId) {

    //--- Set up map layer objects ---//
    // composite false is necessary to stop mapbox trying to composite server-side
    satLayer = mapbox.layer().composite(false);
    labelLayer = mapbox.layer();
    communityLayer = d3layer("communities");
    projectLayer = d3layer("project-area");
    markerLayer = mapbox.markers.layer();
    
    // Set up the map, with no layers and no handlers.
    map = mapbox.map('map',null,null, []).setExtent(startBounds).setZoomRange(5,17);
    window.map = map; // export the map variable for debugging
    
    // Override the default MM.extentCoordinate function to add padding
    // so that zooms and eases are centered slightly to the right.
    map.extentCoordinate = _paddedExtentCoordinate;
    
    // Add all the map layers to the map, in order (they are empty at this point)
    map.addLayer(satLayer);
    map.addLayer(labelLayer);
    map.addLayer(projectLayer);
    map.addLayer(communityLayer);
    map.addLayer(markerLayer);

    // Set small tilesize if retina display. Set tilesource according to retina.
    if (retina) {
      map.tileSize = { x: 128, y: 128 };
      labelLayer.id('gmaclennan.map-lb73ione');
    } else {
      labelLayer.id('gmaclennan.clearwater,gmaclennan.map-y7pgvo15');
    }
    
    // Load GeoJSON for polygons and markers from CartoDB
    _loadData(communitiesSql, _onCommunitiesLoad);
    _loadData(markerSql, _onMarkerLoad);
    _loadData(projectAreaSql, _onProjectAreaLoad);
    
    // Load sat tiles from Bing
    // *TODO* Remove need for async function in MM.BingProvider
    var bingProvider = new MM.BingProvider(BING_API_KEY, 'Aerial', function() {
      satLayer.setProvider(bingProvider);
    });
    
    $('#stories').css('height',$('#stories').height());
    window.meter = new FPSMeter($("#pane")[0], {left: 'auto', right: '5px', graph: true, smoothing: 30});
    easeHandler = easeHandler();
    var lastResize = 0;
    $(window).resize(function () {
      $('html,body').stop(true);
      if (Date.now() - lastResize > 1000/60) {
        var y = $(window).scrollTop()
        mapPadding.left = $("#stories").outerWidth(true)
        _initReveals("#stories img:not(.nocollapse)");
        easeHandler.locations(storyLocations).map(map);
        window.eh = easeHandler;
        _initScrollTos("");
        _reveal(y);
      }
    })
    $(window).resize();

    _loopReveal()
    
  };

  //--- End of public functions of MapStory ---//
  

  
  //--- Private helper functions ---//

  var _paddedExtentCoordinate = function (locations, precise) {
    // coerce locations to an array if it's a Extent instance
    if (locations instanceof MM.Extent) {
        locations = locations.toArray();
    }

    var TL, BR;
    for (var i = 0; i < locations.length; i++) {
        var coordinate = this.projection.locationCoordinate(locations[i]);
        if (TL) {
            TL.row = Math.min(TL.row, coordinate.row);
            TL.column = Math.min(TL.column, coordinate.column);
            TL.zoom = Math.min(TL.zoom, coordinate.zoom);
            BR.row = Math.max(BR.row, coordinate.row);
            BR.column = Math.max(BR.column, coordinate.column);
            BR.zoom = Math.max(BR.zoom, coordinate.zoom);
        }
        else {
            TL = coordinate.copy();
            BR = coordinate.copy();
        }
    }

    var width = this.dimensions.x + 1 - mapPadding.left;
    var height = this.dimensions.y + 1;

    // multiplication factor between horizontal span and map width
    var hFactor = (BR.column - TL.column) / (width / this.tileSize.x);

    // multiplication factor expressed as base-2 logarithm, for zoom difference
    var hZoomDiff = Math.log(hFactor) / Math.log(2);

    // possible horizontal zoom to fit geographical extent in map width
    var hPossibleZoom = TL.zoom - (precise ? hZoomDiff : Math.ceil(hZoomDiff));

    // multiplication factor between vertical span and map height
    var vFactor = (BR.row - TL.row) / (height / this.tileSize.y);

    // multiplication factor expressed as base-2 logarithm, for zoom difference
    var vZoomDiff = Math.log(vFactor) / Math.log(2);

    // possible vertical zoom to fit geographical extent in map height
    var vPossibleZoom = TL.zoom - (precise ? vZoomDiff : Math.ceil(vZoomDiff));

    // initial zoom to fit extent vertically and horizontally
    var initZoom = Math.min(hPossibleZoom, vPossibleZoom);

    // additionally, make sure it's not outside the boundaries set by map limits
    initZoom = Math.min(initZoom, this.coordLimits[1].zoom);
    initZoom = Math.max(initZoom, this.coordLimits[0].zoom);

    // coordinate of extent center
    var centerRow = (TL.row + BR.row) / 2;
    var centerColumn = (TL.column + BR.column) / 2;
    var centerZoom = TL.zoom;
    return new MM.Coordinate(centerRow, centerColumn, centerZoom).zoomTo(initZoom).left(mapPadding.left / this.tileSize.x / 2);
  }

  // Set up onClick events to scroll the document between anchors
  var _initScrollTos = function () {
    wHeight = $(window).height();
    $("a[href*=#]").each(function () {
      var targetScroll
        , hash = $(this).attr("href").split("#")[1]
        , $target = $("#" + hash);
      if ($target.length == 0) {
        $target = $(this).parents("section").next();
        if ($target.length == 0) $target = $(this).parents("article").next().children().first();
      }
      
      if ($target.length > 0) {
        targetScroll = $target.offset().top - wHeight + $target.height();
      }
      $(this).data("target-scroll", targetScroll).click(_scrollTo);
    });
  }
  
  // Set up collapsing and revealing images as you scroll
  var _initReveals = function (selector) {
    wHeight = $(window).height();
    reveals = [];
    
    $(selector).each(function (i) {
      var $this = $(this)
      var $next = $this.next();
      var $parent = $this.parent();
      if (!$next.hasClass('background')) {
        $next = $this.nextAll().wrapAll('<div class="background" />').parent();
      }
      var $prev = $parent.prev();
      if ($prev.length == 0) $prev = $this.parent().parent().prev()
      var width = $this.width();

      $parent.removeClass('offscreen');
      $this.removeClass('collapsed');
      $next.removeClass('affixed').css('width', width);
      $this.parent().css('min-height', '');

      var offsetTop = $this.offset().top;
      var height = $this.height();
      var nextHeight = $next.height();

      $this.parent().css('min-height', height + nextHeight);

      reveals[i] = { 
        $el: $this,
        $next: $next,
        $prev: $prev,
        $parent: $this.parent(),
        offscreen: offsetTop - wHeight,
        start: offsetTop - wHeight + nextHeight,
        stop: offsetTop - wHeight + nextHeight + height
      }
    })
  }
  
  // Load data from external dataSrc via JSONP
  var _loadData = function (sql, callback) {
    $.ajax({
      url: 'http://clearwater.cartodb.com/api/v2/sql',
      data: { q: sql, format: 'geojson' },
      dataType: 'jsonp',
      success: callback
    });
  }
  
  // _onCommunitiesLoad adds geojson returned from the JSONP call to the map
  // and caches the bounds of each nationality in bounds[]
  var _onCommunitiesLoad = function(geojson) {
    communityLayer.data(geojson);
    storyLocations = storyLocations.concat(communityLayer.getLocations());
    communityLayer.draw();
    $(window).resize();
    if (projectLayerIsLoaded) easeHandler.enable();
    communitiesLayerIsLoaded = true
  }
  
  // _onProjectAreaLoad adds geojson returned from the JSONP call to the map
  var _onProjectAreaLoad = function(geojson) {
    projectLayer.data(geojson).draw().addFilters();
    storyLocations = storyLocations.concat(projectLayer.getLocations());
    $(window).resize();
    if (communitiesLayerIsLoaded) easeHandler.enable();
    projectLayerIsLoaded = true
  }

  // _onMarkerLoad processes the Google JSON returned from the spreadsheet
  // and adds it to the marker layer.
  var _onMarkerLoad = function(geojson) {
    markerLayer.features(geojson.features);
    var interaction = mapbox.markers.interaction(markerLayer);
    // Set a custom formatter for tooltips
    // Provide a function that returns html to be used in tooltip
    interaction.formatter(function(feature) {
        var o = '<img src="' + feature.properties.photo + '">' +
                '<p>' + feature.properties.name + '</p>';
        return o;
    });
    markerLayer.factory(function(f) {
    // Define a new factory function. This takes a GeoJSON object
    // as its input and returns an element - in this case an image -
    // that represents the point.
        var img = document.createElement('img');
        img.className = (f.properties.featured) ? 'featured marker' : 'marker';
        var src = (f.properties.featured) ? "images/cw-story.png" : "images/cw-system.png"
        img.setAttribute('src', src);
        $.data(img,'id',_sanitize(f.properties.community));
        return img;
    })
    preloadImages(geojson);
    storyLocations = storyLocations.concat(getMarkerLocations(geojson));
    markerBounds = _calculateMarkerBounds(geojson);
    $(window).resize();
    //Set up click events on the layer and parent
    $(markerLayer.parent).on("click","img",_clickMarkers);
    $(map.parent).on("click",_clickMarkers);
  }
  
  function getMarkerLocations (geojson) {
    locations = []
    _.forEach(geojson.features, function (v) {
      if (v.properties.featured) {
        var bounds = [[],[]];
        var id = _sanitize(v.properties.featured_url);
        bounds[0][0] = bounds[1][0] = v.geometry.coordinates[0];
        bounds[0][1] = bounds[1][1] = v.geometry.coordinates[1];
        locations.push({id: id, bounds: bounds});
      }
    })
    return locations;
  }
  
  var _calculateMarkerBounds = function (geojson) {
    var b = {};
    for (var i=0; i < geojson.features.length; i++) {
      var f = geojson.features[i];
      var id = _sanitize(f.properties.community);
      var x = f.geometry.coordinates[0];
      var y = f.geometry.coordinates[1];
      b[id] = b[id] || {};
      b[id].bounds = b[id].bounds || [[],[]];
      b[id].bounds[0][0] = (b[id].bounds[0][0] < x) ? b[id].bounds[0][0] : x;
      b[id].bounds[0][1] = (b[id].bounds[0][1] < y) ? b[id].bounds[0][1] : y;
      b[id].bounds[1][0] = (b[id].bounds[1][0] > x) ? b[id].bounds[1][0] : x;
      b[id].bounds[1][1] = (b[id].bounds[1][1] > y) ? b[id].bounds[1][1] : y;
      b[id].loc = _centerFromBounds(b[id].bounds);
    }
    return b;
  }
  
  var easeBack;
  var _clickMarkers = function (e) {
    var id = $.data(this,'id');
    var maxZoom = 17;
    var z = map.getZoom()
    var position = $(this).position();
    var markerClicked = this.nodeName == 'IMG';
    
    e.stopPropagation();
    var point = new MM.Point(position.left, position.top);
    // If the click is not on a marker, then we only want to continue
    // if we are already zoomed in to max, and we want to return.
    if (z < maxZoom && !markerClicked) return MM.cancelEvent(e);

    var to = map.pointCoordinate(point).zoomTo(maxZoom)
             .left(mapPadding.left / map.tileSize.x / 2);
    var backTo = (!!markerBounds[id]) ? markerBounds[id].loc : map.coordinate.copy()
    if (z < maxZoom) {
      if (!easeBack) easeBack = mapbox.ease().map(map).to(backTo).from(to);
      map.ease.to(to).optimal(0.9);
      easeHandler.setOverride(to);
    } else if (markerClicked) {
      easeBack.from(to);
      map.ease.to(to).optimal(0.9);
      easeHandler.setOverride(to);
    } else {
      easeBack.optimal(0.9, 1.42, function() { easeBack = undefined; });
      easeHandler.setOverride(easeBack.to());
    }
    return MM.cancelEvent(e);
  }
  
  // Get the map center point for a given bounds
  function _centerFromBounds (b) {
    var extent = new MM.Extent(b[1][1], b[0][0], b[0][1], b[1][0]);
    return map.extentCoordinate(extent, true);
  }
  
  // Continually loop and check for page scroll, calling animations that
  // need to fire when the page scrolls.
  function _loopReveal(){
    var y = $(window).scrollTop();
    
    // Avoid calculations if not needed and just loop again
    if (lastPositionR == y) {
        _requestAnimation(_loopReveal);
        return false;
    } else lastPositionR = y
    _reveal(y);
    _requestAnimation(_loopReveal);
  }

  // Checks scroll position and reveals images as you scroll
  var _reveal = function (scrollTop) {
    var i;
    for (i=0; i<reveals.length; i++) {
      pos = (scrollTop <= reveals[i].offscreen) ? 'offscreen' :
            (scrollTop < reveals[i].start) ? 'before' :
            (scrollTop >= reveals[i].start && scrollTop < reveals[i].stop) ? 'affix' :
            'after';
      var opacity = 1;
      if (pos == 'affix') {
        opacity = 1 - (scrollTop - reveals[i].start) / (reveals[i].stop - reveals[i].start);
        reveals[i].$prev.css('opacity', opacity * opacity);
      }
            
      if (reveals[i].lastpos !== pos) {
        if (pos == 'offscreen') {
          reveals[i].$parent.addClass('offscreen');
          reveals[i].$prev.css('opacity', 1);
        } else {
          reveals[i].$parent.removeClass('offscreen');
          if (pos == 'affix') {
            reveals[i].$el.addClass('collapsed');
            reveals[i].$next.addClass('affixed');
          } else if (pos == 'before') {
            reveals[i].$el.addClass('collapsed');
            reveals[i].$next.removeClass('affixed');
          } else if (pos == 'after') {
            reveals[i].$el.removeClass('collapsed');
            reveals[i].$next.removeClass('affixed');
            reveals[i].$prev.css('opacity', 0);
          }
        }
        reveals[i].lastpos = pos;
      }
    }
    
  }
  
  // Smooth scroll to an element on the page when clicking a link
  var _scrollTo = function () {
    event.preventDefault();
    if (map.getZoom() > 12 && this.parentNode.nodeName == 'g') return;
    $('html,body').stop(true);
    var scrollSrc = $(window).scrollTop();
    var targetScroll = $(this).data("target-scroll");
    $('htmll,body').animate({scrollTop:targetScroll}
      , Math.round(Math.abs(targetScroll - scrollSrc))* 5);
  }
  
  // Helper to _sanitize a string, replacing spaces with "-" and lowercasing
  function _sanitize(string) {
    if (typeof string != "undefined")
    return string.toLowerCase()
          .replace('http://www.giveclearwater.org/','a-')
          .split(" ").join("-").split("/").join("-");
  }
  
  function preloadImages(geojson) {
    _.forEach(geojson.features, function (v) {
      var img = new Image();
      img.src = v.properties.photo;
    });
  }
  
  function d3layerold(c) {
      var f = {}, bounds, feature, collection, enabled = true, c = c + " d3-vec";
      var div = d3.select(document.body)
          .append("div")
          .attr('class', c),
          svg = div.append('svg'),
          g = svg.append("g");
      var defs = svg.append("defs");

      // This adds filters to blur the polygons on the layer
      // Can only be added to one layer, otherwise things get strange
      f.addFilters = function () {
        // Blur effect for project area
        var blur = defs.append("filter")
            .attr("id", "blur")
        blur.append("feColorMatrix")
            .attr("in", "SourceAlpha")
            .attr("color-interpolation-filters", "sRGB")
            .attr("type", "matrix")
            .attr("values", "0 0 0 0.9450980392 0  "
                          + "0 0 0 0.7607843137 0  "
                          + "0 0 0 0.1098039216 0  "
                          + "0 0 0 1 0");
        blur.append("feGaussianBlur")
            .attr("stdDeviation", 10)
            .attr("result", "coloredBlur");
        blur.append("feMerge")
            .append("feMergeNode")
            .attr("in", "coloredBlur")

        // Hover effect for project area
        var blurHover = defs.append("filter")
            .attr("id", "blur-hover")
        blurHover.append("feColorMatrix")
            .attr("in", "SourceAlpha")
            .attr("color-interpolation-filters", "sRGB")
            .attr("type", "matrix")
            .attr("values", "0 0 0 0.6705882353 0  "
                          + "0 0 0 0.5450980392 0  "
                          + "0 0 0 0.1176470588 0  "
                          + "0 0 0 1 0");
        blurHover.append("feGaussianBlur")
            .attr("stdDeviation", 10)
            .attr("result", "coloredBlur");
        blurHover.append("feMerge")
            .append("feMergeNode")
            .attr("in", "coloredBlur");
        return f;
      }

      f.parent = div.node();

      f.project = function(x) {
        var point = f.map.locationPoint({ lat: x[1], lon: x[0] });
        return [point.x, point.y];
      };

      var first = true;
      f.draw = function() {
        if (!enabled) return;
        first && svg.attr("width", f.map.dimensions.x)
            .attr("height", f.map.dimensions.y)
            .style("margin-left", "0px")
            .style("margin-top", "0px") && (first = false);
        var i = 0, classString = c;
        while (i < f.map.getZoom()) {
          classString += " zoom" + i;
          i++;
        }
        div.attr('class', classString);
        path = d3.geo.path().projection(f.project);
        if (!!feature) feature.attr("d", path);
        return f;
      };

      f.data = function(x) {
          collection = x;
          var fs = collection.features;
          bounds = d3.geo.bounds(collection);
          feature = g.selectAll("polygon")
              .data(fs)
              .enter().append("a")
              .attr("xlink:href", function(d){ return "#" + _sanitize(d.properties.name); })
              .append("path");
          
          // Add the bounds of each feature to the storyLocations array
          for (i=0; i < fs.length; i++) {
            storyLocations.push({ 
              id: _sanitize(fs[i].properties.name),
              bounds: d3.geo.bounds(fs[i])
            });
          }

          // If we can't control filter and hover events from css, then add javascript event
          // and attach the filter directly to the svg element
          // Currently only WebKit (Safari & Chrome) support SVG filters from CSS
          if (!cssFilter) {
            feature.style("filter", "url(#blur)")
              .on("mouseover", function () {this.style.cssText = "filter: url(#blur-hover);"})
              .on("mouseout", function () {this.style.cssText = "filter: url(#blur);"});
          }
          return f;
      };
      
      f.enable = function() {
        enabled = true;
        div.style("display", "");
        return f;
      }
      
      f.disable = function() {
        enabled = false;
        div.style("display", "none");
        return f;
      }

      f.extent = function() {
          return new MM.Extent(
              new MM.Location(bounds[0][1], bounds[0][0]),
              new MM.Location(bounds[1][1], bounds[1][0]));
      };
      return f;
  };

  function easeHandler() {
    var eh = {},
        override,
        map,
        easings = [],
        locations,
        lastScroll,
        enabled = false;

    if (!mapbox.ease) throw 'Mapbox easey library not found';

    // Expects a mapbox v.0.6.x map object (ModestMaps)
    eh.map = function (m) {
      map = m;
      return eh;
    }

    // Locations is an array of objects with an id referring to an element id
    // and bounds, an array of two LatLon arrays, south-west, north-east
    // e.g. { id: 'elementid', bounds: [ [0, 0], [100, 100] ] }
    eh.locations = function (l) {
      if (!arguments.length) return locations;      
      locations = l;
      setScrollPoints();
      if (!!map) setEasings()
      return eh;
    }
  
    eh.enable = function () {
      if (enabled) return eh;
      if (!locations || !map) throw "Map and locations need to be set";
      if (!easings) setEasings();
      enabled = true;
      loop(this);
      return eh;
    }
  
    // Moves the map to the location corresponding to the current scroll position.
    // Returns false if there is no easing for this location.
    eh.easeTo = function (scrollTop) {
      scrollTop = Math.max(scrollTop, 0);
      if (!!override) {
        if (scrollTop > override.top && scrollTop < override.bottom) {
          map.coordinate = override.easings[scrollTop - override.top];
        } else {
          override = undefined;
        }
      } else {
        map.coordinate = easings[scrollTop] || _.last(easings);
      }
      map.draw();
      return eh;
    }
  
    // Sets an override easing function if the user has moved the map from the
    // pre-defined easing path, or if we need to move quickly between two 
    // points far apart on the page without moving through the intermediary steps 
    eh.setOverride = function (from,start,top,bottom) {
      var t, ease1, ease2,
          from = from || map.coordinate.copy(),
          start = start || $(window).scrollTop(),
          top = Math.max(top || start - 200, 0);
          bottom = bottom || start + 200;

      override = {top: top, bottom: bottom};
      topCoord = easings[top] || _.last(easings);
      bottomCoord = easings[bottom] || _.last(easings);
      ease1 = mapbox.ease().map(map).from(topCoord).to(from).setOptimalPath();
      ease2 = mapbox.ease().map(map).from(from).to(bottomCoord).setOptimalPath();
      override.easings = ease1.future(start - top).concat(ease2.future(bottom-start));

      return eh;
    }

    function setScrollPoints () {
      var wHeight = $(window).height();
    
      // Add the scroll point of each element with an id in location
      // remove items that are not found on the page
      // and sort locations by the scroll point on the page.
      locations = _.chain(locations)
                  .map(function (v) {
                    var $el = $("#" + v.id);
                    v.scrollPoint = ($el.length > 0) 
                      ? $el.offset().top - wHeight + $el.height() : -1;
                      return v;
                    })
                  .reject(function (v) { return v.scrollPoint < 0; })
                  .sortBy('scrollPoint').value();
    }
  
    function setEasings () {
      var easing, coord, prevCoord, prevScrollPoint;
      easings = [];
    
      _.forEach(locations, function (v, i) {
        coord = centerFromBounds(v.bounds);
        if (!!prevCoord) {
          easing = mapbox.ease().map(map).from(prevCoord).to(coord).easing('linear');
          easings = easings.concat(easing.future(v.scrollPoint - prevScrollPoint));
        }
        prevCoord = coord;
        prevScrollPoint = v.scrollPoint;
      });
    }

    // This loop uses requestAnimationFrame to check the scroll position and update the map.
    function loop() {
      var y = $(window).scrollTop();
      meter.tick()
      if (!enabled) return false;
      // Avoid calculations if not needed and just loop again
      if (lastScroll == y) {
          _requestAnimation(loop);
          return false;
      } else lastScroll = y
      eh.easeTo(y);
      _requestAnimation(loop);
    }
  
    // Get the map center point for a given bounds
    function centerFromBounds (b) {
      var extent = new MM.Extent(b[1][1], b[0][0], b[0][1], b[1][0]);
      return map.extentCoordinate(extent, true);
    }
    
    return eh;
  }

}).call(this);