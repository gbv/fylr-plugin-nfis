async function fetchWFSData(wfsUrl, requestXml, format, authorizationString) {
    const headers = {
        'Content-Type': 'application/xml'
    };

    if (authorizationString) headers.authorizationString = authorizationString;

    const response = await fetch(wfsUrl, {
        method: 'POST',
        headers,
        body: requestXml
    });

    try {
        return format === 'geojson'
            ? await response.json()
            : await response.text();
    } catch (err) {
        throwErrorToFrontend(JSON.stringify({ error: err.toString(), wfsUrl, requestXml, format }));
    }
}

function getWFSRequestXml(type, filterXml, format) {
    return '<?xml version="1.0" ?>'
        + '<wfs:GetFeature '
        + 'version="1.1.0" '
        + 'service="WFS" '
        + (format === 'geojson' ? 'outputFormat="json" ' : '')
        + 'xmlns:ogc="http://www.opengis.net/ogc" '
        + 'xmlns:wfs="http://www.opengis.net/wfs" '
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xsi:schemaLocation="http://www.opengis.net/wfs" '
        + 'xmlns:gml="http://www.opengis.net/gml">'
        + '<wfs:Query typeName="' + type + '"'
        + (format === 'geojson' ? ' srsName="EPSG:4326">' : '>')
        + filterXml
        + '</wfs:Query>'
        + '</wfs:GetFeature>';
}

function getGeometryIdFilterXml(geometryId, geometryIdFieldName) {
    return '<ogc:Filter>'
        + '<ogc:PropertyIsEqualTo>'
        + '<ogc:PropertyName>' + geometryIdFieldName + '</ogc:PropertyName>'
        + '<ogc:Literal>' + geometryId + '</ogc:Literal>'
        + '</ogc:PropertyIsEqualTo>'
        + '</ogc:Filter>';
}

function getIntersectsFilterXml(geometries, propertyName) {
    return '<ogc:Filter>'
        + (geometries.length > 1 ? '<ogc:Or>' : '')
        + geometries.map(geometry => getIntersectsFilterForGeometry(geometry, propertyName)).join('')
        + (geometries.length > 1 ? '</ogc:Or>' : '')
        + '</ogc:Filter>';
}

function getIntersectsFilterForGeometry(geometry, propertyName) {
    return '<ogc:Intersects>'
        + '<ogc:PropertyName>' + propertyName + '</ogc:PropertyName>'
        + geometry
        + '</ogc:Intersects>';
}

function getGeometriesFromXml(xml) {
    const matches = xml.match(/<gml:(Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon)[\s\S]*?<\/gml:\1>/g);
    return matches.map(match => {
        return match.replace('<gml:Point>', '<gml:Point srsName="EPSG:25832">')
            .replace('<gml:LineString>', '<gml:LineString srsName="EPSG:25832">')
            .replace('<gml:Polygon>', '<gml:Polygon srsName="EPSG:25832">')
            .replace('<gml:MultiPoint>', '<gml:MultiPoint srsName="EPSG:25832">')
            .replace('<gml:MultiLineString>', '<gml:MultiLineString srsName="EPSG:25832">')
            .replace('<gml:MultiPolygon>', '<gml:MultiPolygon srsName="EPSG:25832">');
    })
}
