const info = process.argv.length >= 3
    ? JSON.parse(process.argv[2])
    : {};

let input = '';
process.stdin.on('data', d => {
    try {
        input += d.toString();
    } catch (err) {
        console.error(`Could not read input into string: ${err.message}`, err.stack);
        process.exit(1);
    }
});

process.stdin.on('end', async () => {
    const data = JSON.parse(input);
    const changedObjects = [];

    for (let object of data.objects) {
        if (await processObject(object)) changedObjects.push(object);
    }

    console.log(JSON.stringify({ objects: changedObjects }));

    if (!changedObjects.length) {
        console.error('No changes');
        process.exit(0);
    }
});

async function processObject(object) {
    if (object._objecttype !== 'item' || object._uuid) return false;

    const objectGeometries = await getObjectGeometries(object);
    if (!objectGeometries?.length) {
        if (isInArchaeologyPool(object) && !hasLinkedAreas(object)) {
            throwErrorToFrontend('Bitte fügen Sie eine Geometrie hinzu, bevor Sie das Objekt speichern.');
        } else {
            return false;
        }
    }

    const arealUnitConcepts = await getDanteConcepts(objectGeometries, 'dante:gebietseinheit');
    setArealUnitConcepts(object, arealUnitConcepts);

    const districtConcepts = await getDanteConcepts(objectGeometries, 'dante:gemarkung');
    const typeConcept = await fetchDanteConcept('nld_area_type', '1d59bd25-81ea-4e17-b786-7677c595ab1c');

    for (let districtConcept of districtConcepts) {
        const area = await createArea(object.item._pool, districtConcept, typeConcept);
        linkArea(object, area);
        await addTitle(object, area, arealUnitConcepts);
    }

    return true;
}

function isInArchaeologyPool(object) {
    if (!object.item._pool) return false;

    return object.item._pool._path.some(entry => entry.pool.name?.['de-DE'] === 'Archäologie');
}

function setArealUnitConcepts(object, arealUnitConcepts) {
    const nestedFieldKey = '_nested:' + object._objecttype + '__politische_zugehoerigkeit';
    if (!object.item[nestedFieldKey]) {
        object.item[nestedFieldKey] = [];
    }
    for (let arealUnitConcept of arealUnitConcepts) {
        object.item[nestedFieldKey].push({ lk_politische_zugehoerigkeit: getConceptEntry(arealUnitConcept) });
    }
}

async function getObjectGeometries(object) {
    const geometryIds = object.item.lk_nfis_geometrie?.geometry_ids;
    if (!geometryIds?.length) return undefined;

    const geoPluginConfiguration = await getGeoPluginConfiguration();
    const wfsConfiguration = getWfsConfiguration('item', geoPluginConfiguration);
    const authorizationString = getAuthorizationString(geoPluginConfiguration);

    const result = [];
    for (let geometryId of geometryIds) {
        const filterXml = getGeometryIdFilterXml(geometryId, wfsConfiguration.geometryIdFieldName);
        const xmlData = await fetchWFSData(
            wfsConfiguration.wfsUrl,
            getWFSRequestXml(wfsConfiguration.featureType, filterXml, 'xml'),
            'xml',
            authorizationString
        );
        const geoJsonData = await fetchWFSData(
            wfsConfiguration.wfsUrl,
            getWFSRequestXml(wfsConfiguration.featureType, filterXml, 'geojson'),
            'geojson',
            authorizationString
        );
        const entry = {
            geometryId,
            xml: getGeometriesFromXml(xmlData)?.[0],
            geoJson: geoJsonData.features[0]
        };
        if (entry.xml && entry.geoJson) result.push(entry);
    }

    return result;
}

async function getGeoPluginConfiguration() {
    const url = 'http://fylr.localhost:8082/inspect/config';
    const headers = { 'Accept': 'application/json' };

    const configuration = await (await fetch(url, { headers })).json();
    return configuration.BaseConfigList.find(section => section.Name === 'nfisGeoservices').Values;
}

function getWfsConfiguration(objectType, geoPluginConfiguration) {
    const fieldConfiguration = geoPluginConfiguration.wfs_configuration.ValueTable
        .find(element => element.object_type.ValueText === objectType)
        ?.geometry_fields?.ValueTable.find(field => field.field_path?.ValueText === 'lk_nfis_geometrie');
    
    return {
        wfsUrl: fieldConfiguration.display_wfs_url.ValueText,
        featureType: fieldConfiguration.display_wfs_feature_type.ValueText,
        geometryIdFieldName: geoPluginConfiguration.wfs_geometry_id_field_name.ValueText
    };
}

function getAuthorizationString(geoPluginConfiguration) {
    const username = geoPluginConfiguration.geoserver_read_username.ValueText;
    const password = geoPluginConfiguration.geoserver_read_password.ValueText;

    return 'Basic ' + btoa(username + ':' + password);
}

async function getDanteConcepts(geometries, typeName) {
    const filterXml = getIntersectsFilterXml(geometries.map(geometry => geometry.xml), 'geom');

    const xmlData = await fetchWFSData(
        getConfiguration().wfs_url,
        getWFSRequestXml(typeName, filterXml, 'xml'),
        'xml'
    );
    const geoJsonData = await fetchWFSData(
        getConfiguration().wfs_url,
        getWFSRequestXml(typeName, filterXml, 'geojson'),
        'geojson'
    );

    const regex = typeName === 'dante:gemarkung'
        ? /<dante:gemarkung([\s\S]*?)<\/dante:gemarkung>/g
        : /<dante:gebietseinheit([\s\S]*?)<\/dante:gebietseinheit>/g;

    const result = [];
    const matches = xmlData.matchAll(regex);

    for (let match of matches) {
        const content = match[1];
        const uuid = content.match(/<dante:uuid>\s*(.+)\s*<\/dante:uuid>/)?.[1];
        const vocabulary = content.match(/<dante:dante_vocabulary>\s*(.+)\s*<\/dante:dante_vocabulary>/)?.[1];
        const concept = await fetchDanteConcept(vocabulary, uuid);
        if (concept.narrower?.length) continue;
    
        const feature = geoJsonData.features.find(feature => {
            return feature.properties.uuid === uuid && feature.properties.dante_vocabulary === vocabulary;
        });
        const coverage = computeCoverage(geometries.map(geometry => geometry.geoJson), feature);
        if (coverage > 5) result.push({ concept, coverage });
    }

    result.sort((concept1, concept2) => concept2.coverage - concept1.coverage);

    return result.slice(0, 3).map(entry => entry.concept);
}

function linkArea(object, area) {
    if (!object.item['_reverse_nested:flaeche__objekt:lk_objekt']) {
        object.item['_reverse_nested:flaeche__objekt:lk_objekt'] = {};
    }

    object.item['_reverse_nested:flaeche__objekt:lk_objekt'].push({
        _version: 1,
        lk_flaeche: {
            flaeche: {
                _id: area.flaeche._id
            },
            _mask: area._mask,
            _objecttype: 'flaeche',
            _global_object_id: area._global_object_id
        }
    });
}

function hasLinkedAreas(object) {
    return object.item['_reverse_nested:flaeche__objekt:lk_objekt']?.length > 0;
}

async function addTitle(object, area, arealUnitConcepts) {
    if (!object.item['_nested:item__titel']) object.item['_nested:item__titel'] = [];
    object.item['_nested:item__titel'].push({ titel: await getTitle(area, arealUnitConcepts) });
}

async function getTitle(area, arealUnitConcepts) {
    const commune = await getCommuneLabel(arealUnitConcepts);
    const findspotNumberEntry = area.flaeche['_nested:flaeche__fundstellennummer']?.[0];
    const districtLabel = findspotNumberEntry.lk_dante_gemarkung?.conceptName;
    const findspotNumber = addZeroes(findspotNumberEntry.nummer);
    
    return commune + ', Gmkg. ' + districtLabel + ' FStNr. ' + findspotNumber;
}

async function getCommuneLabel(arealUnitConcepts) {
    const ancestorLabels = await getAncestorLabels(arealUnitConcepts[0]);
    return ancestorLabels.length > 2 ? ancestorLabels[2] : undefined;
}

async function getAncestorLabels(danteConcept) {
    const response = await fetch(
        'https://api.dante.gbv.de/ancestors?uri=' + danteConcept.uri + '&properties=-',
        { method: 'GET' }
    );
    const ancestors = await response.json();

    return ancestors.map(ancestor => ancestor.prefLabel.de ?? ancestor.prefLabel.zxx).reverse();
}

function addZeroes(number) {
    return number > 99999
        ? number
        : ('0000' + number).slice(-5); 
};

async function createArea(pool, districtConcept, typeConcept) {
    const area = {
        _objecttype: 'flaeche',
        _mask: 'flaeche__all_fields',
        flaeche: {
            _pool: pool,
            lk_dante_art: getConceptEntry(typeConcept),
            ['_nested:flaeche__fundstellennummer']: [{
                lk_dante_gemarkung: getConceptEntry(districtConcept)
            }]
        }
    };

    const savedArea = await saveObject(area);
    return fetchObject('flaeche', 'flaeche__all_fields', savedArea.flaeche._id);
}

function getConceptEntry(danteConcept) {
    return {
        conceptURI: danteConcept.uri,
        conceptName: danteConcept.prefLabel.de ?? danteConcept.prefLabel.zxx
    };
}

async function fetchObject(objectType, mask, id) {
    const url = info.api_url + '/api/v1/db/' + objectType + '/' + mask + '/' + id + '?access_token=' + info.api_user_access_token;

    const response = await fetch(url, { method: 'GET' });
    if (!response.ok) throw JSON.stringify(await response.json());
    const result = await response.json();

    return result?.length
        ? result[0]
        : undefined;
}

async function saveObject(object) {
    const url = info.api_url + '/api/v1/db/' + object._objecttype + '?access_token=' + info.api_user_access_token;

    const data = object[object._objecttype];
    data._version = data._version ? data._version += 1 : 1;

    const response = await fetch(url, { method: 'POST', body: JSON.stringify([object]) });
    if (!response.ok) throw JSON.stringify(await response.json());

    return (await response.json())?.[0];
}

async function fetchDanteConcept(vocabulary, uuid) {
    const uri = 'http://uri.gbv.de/terminology/' + vocabulary + '/' + uuid;
    const url = 'https://api.dante.gbv.de/data?uri=' + uri + '&properties=+narrower';
    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) throw response.status;
    
    return (await response.json())?.[0];
}

function getConfiguration() {
    return info.config.plugin.nfis.config.create_findspots;
}

function throwErrorToFrontend(error, realm) {
    console.log(
        JSON.stringify({
            error: {
                code: 'error.nfis',
                statuscode: 400,
                realm: realm ?? 'api',
                error,
                parameters: {}
            }
        })
    );

    process.exit(0);
}
