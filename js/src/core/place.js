/**
 * A place can either be a polygon or a point
 * @param {object}	feature A geoJSON feature with properties and geometry
 */
cwm.Place = function(feature) {
	if (!(this instanceof cwm.Place))
		return new cwm.Place(feature);
	feature = feature || {};
	this.properties = feature.properties || {};
	this.geometry = feature.geometry || {};
	this.type = feature.type;

	// Add any custom events as arguments to d3.dispatch
	this.event = d3.dispatch('changed');

	// Default fields used for parentId and id.
	this.id("id").parentId("parent");
};

cwm.Place.prototype = Object.create(cwm.Base.prototype);

cwm.util.extend(cwm.Place.prototype, {

	// Set the field that contains the parent id. `v` can be a string or a function
	parentId: function(x) {
		if (!arguments.length) return this._parentId;
		this._parentId = typeof x === "function" ? x(this.properties) : x;
		return this;
	},

	/**
	 * Gets or sets attributes for a place
	 * @param  {string} key   Property to get or set
	 * @param  {string} value Value to set property
	 * @return {}             If value isNull, returns property value
	 */
	attr: function(key, value) {
		if (!value) return this.properties[key];
		this.properties[key] = value;
		this.event.changed(this);
		return this;
	},

    // If the place does not have bounds, return the bounds of its children. Cache the result.
    bounds: function() {
        if (typeof this._bounds !== "undefined") return this._bounds;
        
        this._bounds = d3.geo.bounds(this.asGeoJSON());
        
        if (!isNaN(this._bounds[0][0])) return this._bounds;

        if (this.children) {
            this._bounds = this.children.bounds();
        } else {
            this._bounds = null;
        }
        
        return this._bounds;
    },

	/**
     * @return {object} A geoJSON representation of the place
     */
    asGeoJSON: function() {
        return {
            type: this.type,
            properties: this.properties,
            geometry: this.geometry
        };
    }
});