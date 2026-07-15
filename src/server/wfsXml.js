async function getGeometriesForIds(geometryIds, wfsConfiguration, authorizationString) {
    const transactionUrl = wfsConfiguration.wfsUrl + '?service=WFS&version=1.1.0&request=GetFeature';

    const requestXml = '<?xml version="1.0" ?>'
        + '<wfs:GetFeature '
        + 'version="1.1.0" '
        + 'service="WFS" '
        + 'xmlns:ogc="http://www.opengis.net/ogc" '
        + 'xmlns:wfs="http://www.opengis.net/wfs" '
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xsi:schemaLocation="http://www.opengis.net/wfs">'
        + '<wfs:Query typeName="' + wfsConfiguration.featureType + '">'
        + getGeometryIdFilterXml(geometryIds, wfsConfiguration.geometryIdFieldName)
        + '</wfs:Query>'
        + '</wfs:GetFeature>';

    const response = await fetch(transactionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml',
            'Authorization': authorizationString
        },
        body: requestXml
    });

    return getGeometriesFromXml(await response.text());
}

function getGeometryIdFilterXml(geometryIds, geometryIdFieldName) {
    return '<ogc:Filter>'
        + (geometryIds.length === 1
            ? getGeometryIdFilterElementXml(geometryIdFieldName)(geometryIds[0])
            : '<ogc:Or>' + geometryIds.map(getGeometryIdFilterElementXml(geometryIdFieldName)).join('') + '</ogc:Or>'
        )
        + '</ogc:Filter>';
}

function getGeometryIdFilterElementXml(geometryIdFieldName) {
    return function(geometryId) {
        return '<ogc:PropertyIsEqualTo>'
            + '<ogc:PropertyName>' + geometryIdFieldName + '</ogc:PropertyName>'
            + '<ogc:Literal>' + geometryId + '</ogc:Literal>'
            + '</ogc:PropertyIsEqualTo>';
    }
}

function getGeometriesFromXml(xml) {
    return xml.match(/<gml:(Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon)[\s\S]*?<\/gml:\1>/g);
}

async function getWFSData(geometryData, typeName) {
    const transactionUrl = getConfiguration().wfs_url + '?service=WFS&version=1.1.0&request=GetFeature';

    const requestXml ='<?xml version="1.0" ?>'
        + '<wfs:GetFeature '
        + 'version="1.1.0" '
        + 'service="WFS" '
        + 'xmlns:ogc="http://www.opengis.net/ogc" '
        + 'xmlns:wfs="http://www.opengis.net/wfs" '
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xmlns:gml="http://www.opengis.net/gml" '
        + 'xsi:schemaLocation="http://www.opengis.net/wfs">'
        + '<wfs:Query typeName="' + typeName + '">'
        + getIntersectsFilter(geometryData, 'geom')
        + '</wfs:Query>'
        + '</wfs:GetFeature>';

    const response = await fetch(transactionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml'
        },
        body: requestXml
    });

    return response.text();
}

function getIntersectsFilter(geometries, propertyName) {
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
