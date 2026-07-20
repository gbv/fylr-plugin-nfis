const turf = require('@turf/turf');

function computeCoverage(objectFeatures, conceptFeature) {
    if (objectFeatures.some(feature => !['Polygon', 'MultiPolygon'].includes(feature.geometry.type))) return 100;

    const intersectionArea = computeIntersectionArea(objectFeatures, conceptFeature);
    const objectArea = computeObjectArea(objectFeatures);
    
    return (intersectionArea / objectArea) * 100;
}

function computeIntersectionArea(objectFeatures, conceptFeature) {
    return objectFeatures.reduce((result, objectFeature) => {
        const featureCollection = turf.featureCollection([objectFeature, conceptFeature]);
        const intersectionFeature = turf.intersect(featureCollection);
        if (intersectionFeature) result += turf.area(intersectionFeature);
        return result;
    }, 0);
}

function computeObjectArea(objectFeatures) {
    return objectFeatures.reduce((result, objectFeature) => {
        return result + turf.area(objectFeature);
    }, 0);
}
