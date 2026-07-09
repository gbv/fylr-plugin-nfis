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

    const arealUnitUUID = getArealUnitUUID(object);
    if (!arealUnitUUID) return false;

    const polygonData = await getArealUnitPolygonData(arealUnitUUID);
    const districtConcepts = await getDistrictConcepts(polygonData);
    const typeConcept = await fetchDanteConcept('nld_area_type', '1d59bd25-81ea-4e17-b786-7677c595ab1c');
    const arealUnitConcept = getArealUnitConcept(object);

    for (let districtConcept of districtConcepts) {
        const area = await createArea(object.item._pool, arealUnitConcept, districtConcept, typeConcept);
        linkArea(object, area);
        await addTitle(object, area);
    }

    return true;
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

async function addTitle(object, area) {
    if (!object.item['_nested:item__titel']) object.item['_nested:item__titel'] = [];
    object.item['_nested:item__titel'].push({ titel: await getTitle(area) });
}

async function getTitle(area) {
    const commune = await getCommuneLabel(area);
    const findspotNumberEntry = area.flaeche['_nested:flaeche__fundstellennummer']?.[0];
    const districtLabel = findspotNumberEntry.lk_dante_gemarkung?.conceptName;
    const findspotNumber = addZeroes(findspotNumberEntry.nummer);
    
    return commune + ', Gmkg. ' + districtLabel + ' FStNr. ' + findspotNumber;
}

function addZeroes(number) {
    return number > 99999
        ? number
        : ('0000' + number).slice(-5); 
};

async function getCommuneLabel(area) {
    const arealUnitConcept = getArealUnitConcept(area);
    const ancestorLabels = await getAncestorLabels(arealUnitConcept);
    return ancestorLabels.length > 2 ? ancestorLabels[2] : undefined;
}

async function getAncestorLabels(danteConcept) {
    const response = await fetch(
        'https://api.dante.gbv.de/ancestors?uri=' + danteConcept.conceptURI + '&properties=-',
        { method: 'GET' }
    );
    const ancestors = await response.json();

    return ancestors.map(ancestor => ancestor.prefLabel.de ?? ancestor.prefLabel.zxx).reverse();
}

function getArealUnitUUID(object) {
    const conceptURI = getArealUnitConcept(object)?.conceptURI;
    return conceptURI.replace('http://uri.gbv.de/terminology/areal_unit_niedersachsen/', '')
        .replace('http://uri.gbv.de/terminology/areal_unit_bremen', '');
}

function getArealUnitConcept(object) {
    const nestedFieldKey = '_nested:' + object._objecttype + '__politische_zugehoerigkeit';
    return object[object._objecttype][nestedFieldKey]?.[0]?.lk_politische_zugehoerigkeit;
}

async function getArealUnitPolygonData(danteUUID) {
    const transactionUrl = getConfiguration().wfs_url + '?service=WFS&version=1.1.0&request=GetFeature';

    const requestXml = '<?xml version="1.0" ?>'
        + '<wfs:GetFeature '
        + 'version="1.1.0" '
        + 'service="WFS" '
        + 'xmlns:ogc="http://www.opengis.net/ogc" '
        + 'xmlns:wfs="http://www.opengis.net/wfs" '
        + 'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
        + 'xsi:schemaLocation="http://www.opengis.net/wfs">'
        + '<wfs:Query typeName="dante:gebietseinheit">'
        + '<ogc:Filter>'
        + '<ogc:PropertyIsEqualTo>'
        + '<ogc:PropertyName>dante:uuid</ogc:PropertyName>'
        + '<ogc:Literal>' + danteUUID + '</ogc:Literal>'
        + '</ogc:PropertyIsEqualTo>'
        + '</ogc:Filter>'
        + '</wfs:Query>'
        + '</wfs:GetFeature>';

    const response = await fetch(transactionUrl, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/xml'
        },
        body: requestXml
    });

    const xml = await response.text();
    return xml.match(/<gml:Polygon[\s\S]*?<\/gml:Polygon>/g);
}

async function getDistrictConcepts(polygonData) {
    const xml = await getDistrictXml(polygonData);
        
    const result = [];
    const matches = xml.matchAll(/<dante:gemarkung([\s\S]*?)<\/dante:gemarkung>/g);

    for (let match of matches) {
        const content = match[1];
        const uuid = content.match(/<dante:uuid>\s*(.+)\s*<\/dante:uuid>/)?.[1];
        const vocabulary = content.match(/<dante:dante_vocabulary>\s*(.+)\s*<\/dante:dante_vocabulary>/)?.[1];
        const concept = await fetchDanteConcept(vocabulary, uuid);
        if (concept) result.push(concept);
    }

    return result;
}

async function getDistrictXml(polygonData) {
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
        + '<wfs:Query typeName="dante:gemarkung">'
        + '<ogc:Filter>'
        + '<ogc:Intersects>'
        + '<ogc:PropertyName>geom</ogc:PropertyName>'
        + polygonData
        + '</ogc:Intersects>'
        + '</ogc:Filter>'
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

async function createArea(pool, arealUnitConcept, districtConcept, typeConcept) {
    const area = {
        _objecttype: 'flaeche',
        _mask: 'flaeche__all_fields',
        flaeche: {
            _pool: pool,
            lk_dante_art: getConceptEntry(typeConcept),
            ['_nested:flaeche__fundstellennummer']: [{
                lk_dante_gemarkung: getConceptEntry(districtConcept)
            }],
            ['_nested:flaeche__politische_zugehoerigkeit']: [{
                lk_politische_zugehoerigkeit: arealUnitConcept
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
    const url = 'https://api.dante.gbv.de/data?uri=' + uri;
    const response = await fetch(url, { method: 'GET' });

    if (!response.ok) throw response.status;
    
    return (await response.json())?.[0];
}

function getConfiguration() {
    return info.config.plugin.nfis.config.create_findspots;
}

function throwErrorToFrontend(error, description, realm) {
    console.log(
        JSON.stringify({
            error: {
                code: 'error.nfis',
                statuscode: 400,
                realm: realm ?? 'api',
                error,
                parameters: {},
                description
            }
        })
    );

    process.exit(0);
}
