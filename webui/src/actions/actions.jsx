import axios from 'axios';
import { apiPath, actionType } from '../constants';
import { addLanguageMapping, processLanguage, processMediatype, isDictionaryResource, isDictionaryTool, isNotDictionaryTool } from './utils';

let lastResourceID = 0;

function updateResource(resource) {
    return function (dispatch, getState) {
        dispatch({
            type: actionType.RESOURCE_UPDATE,
            data: resource,
        });
        dispatch(fetchMatchingTools());
    }
}

export function setResourceProfile(id, profileKey, value) {
    return function (dispatch, getState) {
        const resourceSI = getState().resourceList.find(r => r.id === id);
        if (!resourceSI) {
            console.error("cannot find resource with id", id);
            return;
        }
        const resource = resourceSI.asMutable({deep:true});
        resource.profile[profileKey] = value;
        dispatch({
            type: actionType.RESOURCE_UPDATE,
            data: resource,
        });
        // update matching tools because the profile has changed
        dispatch(fetchMatchingTools());
    }
}

export function setResourceContent(id, content) {
    return function (dispatch, getState) {
        const resourceSI = getState().resourceList.find(r => r.id === id);
        if (!resourceSI) {
            console.error("cannot find resource with id", id);
            return;
        }
        const resource = resourceSI.asMutable({deep:true});
        resource.content = content;
        dispatch({
            type: actionType.RESOURCE_UPDATE,
            data: resource,
        });
        // set content on server, but don't update matching tools because the profile is the same
        axios.put(apiPath.storageID(id), content, { headers: {'Content-Type': 'text/plain'} });
    }
}

export function clearResources() {
    return function (dispatch, getState) {
        dispatch({
            type: actionType.RESOURCE_CLEAR_ALL,
        });
    }
}

export function removeResource(resource) {
    return function (dispatch, getState) {
        dispatch({
            type: actionType.RESOURCE_REMOVE,
            data: resource,
        });
        dispatch(fetchMatchingTools());
    }
}

export function selectResourceMatch(toolName, matchIndex) {
    return function (dispatch, getState) {
        dispatch({
            type: actionType.SELECT_RESOURCE_MATCH,
            data: {toolName, matchIndex},
        });
    }
}

function uploadData(formData) {
    return function (dispatch, getState) {
        const apiinfo = getState().apiinfo;
        if (!apiinfo || !apiinfo.enableMultipleResources) {
            dispatch({
                type: actionType.RESOURCE_CLEAR_ALL,
            });
        }

        const newResource = {id: ++lastResourceID};
        dispatch(updateResource(newResource));
        axios
            .post(apiPath.storage, formData, {
                headers: {'Content-Type': 'multipart/form-data'}
            })
            .then(updateResourceCallback(dispatch, newResource))
            .catch(resourceErrorCallback(dispatch, newResource));
    }
}

function updateResourceCallback(dispatch, resource) {
    return response => {
        const res = response.data;
        if (res.localLink && res.localLink.startsWith(apiPath.api)) {
            res.localLink = window.origin + res.localLink;
        }
        if (resource.id !== res.id) {
            dispatch(removeResource(resource));
        }
        dispatch(updateResource(Object.assign({}, resource, res)));
    };
}

function resourceErrorCallback(dispatch, resource) {
    return error => {
        dispatch(removeResource(resource));
        errHandler(dispatch)(error);
    };
}

export function uploadLink(params) {
    var formData = new FormData();
    for (const key in params) {
        formData.append(key, params[key]);
    }
    return uploadData(formData);
}

export function uploadFile(file) {
    var formData = new FormData();
    formData.append("file", file, file.name);
    return uploadData(formData);
}

export function fetchAsyncResourceState(id) {
    return function (dispatch, getState) {
        const newResource = {id};
        dispatch(updateResource(newResource));
        axios.get(apiPath.storageInfo(id))
            .then(updateResourceCallback(dispatch, newResource))
            .catch(resourceErrorCallback(dispatch, newResource));
    }
}

export function fetchApiInfo() {
    return function (dispatch, getState) {
        axios.get(apiPath.apiinfo)
            .then(response => {
                dispatch({
                    type: actionType.APIINFO_FETCH_SUCCESS,
                    data: response.data
                });
            }).catch(errHandler(dispatch, "Cannot fetch API info"));
    }
}

export function fetchMediatypes() {
    return function (dispatch, getState) {
        axios.get(apiPath.mediatypes)
            .then(response => {
                dispatch({
                    type: actionType.MEDIATYPES_FETCH_SUCCESS,
                    data: response.data.map(processMediatype).filter(x => x),
                });
            }).catch(errHandler(dispatch, "Cannot fetch mediatypes"));
    }
}

export function fetchLanguages() {
    return function (dispatch, getState) {
        axios.get(apiPath.languages)
            .then(response => {
                response.data.map(addLanguageMapping);
                dispatch({
                    type: actionType.LANGUAGES_FETCH_SUCCESS,
                    data: response.data
                            .map(x => processLanguage(x[0]))
                            .filter(x => x)
                            .sort((a,b) => a.label.localeCompare(b.label)),
                });
            }).catch(errHandler(dispatch, "Cannot fetch languages"));
    }
}

export function fetchAllTools() {
    return function (dispatch, getState) {
        axios.get(apiPath.tools)
            .then(response => {
                response.data.forEach(normalizeTool);
                dispatch({
                    type: actionType.ALL_TOOLS_FETCH_SUCCESS,
                    data: response.data,
                });
            }).catch(errHandler(dispatch, "Cannot fetch all tools data"));
    }
}

function fetchMatchingTools() {
    return function (dispatch, getState) {
        dispatch({
            type: actionType.MATCHING_TOOLS_FETCH_START,
        })

        const isDict = getState().resourceList.every(isDictionaryResource);

        const profiles = getState().resourceList
                .filter(r => r.localLink && r.profile)
                .map(r => {
                    const ret = Object.assign({}, r.profile);
                    if (r.content) {
                        ret["contentIsAvailable"] = true;
                    }
                    return ret;
                });

        if (!profiles.length) {
            return;
        }

        axios.post(apiPath.toolsMatch, profiles)
            .then(response => {
                const toolMatches = response.data;

                const tools = toolMatches.map(tm => {
                    const tool = tm.tool;
                    tool.matches = tm.matches;
                    tool.bestMatchPercent = tm.bestMatchPercent;
                    normalizeTool(tool);
                    return tool;
                })
                .filter(isDict ? isDictionaryTool : isNotDictionaryTool);

                dispatch({
                    type: actionType.MATCHING_TOOLS_FETCH_SUCCESS,
                    data: tools,
                });
            }).catch(errHandler(dispatch, "Cannot fetch matching tools"));

        _paq.push(['trackEvent', 'Tools', 'MatchTools', JSON.stringify(profiles)]);
    }
}

function normalizeTool(tool) {
    let searchString = "";
    for (const key of ['task', 'name', 'description']) {
        searchString += (tool[key] || "").toLowerCase();
        searchString += " ";
    }
    for (const kw in (tool.keywords||[])) {
        searchString += kw.toLowerCase();
        searchString += " ";
    }
    tool.searchString = searchString;

    if (tool.bestMatchPercent == 100 && tool.matches && tool.matches.length) {
        tool.invokeMatchIndex = 0;
    }
}

export function setMode(mode) {
    return function (dispatch, getState) {
        dispatch({
            type: actionType.MODE,
            mode: 'popup',
        });
    }
}

export function showError(errorMessage) {
    return function (dispatch, getState) {
        dispatch({
            type: actionType.ERROR,
            message: errorMessage,
        });
    }
}

function errHandler(dispatch, msg) {
    return function(err) {
        console.log({msg, err, response: err.response});
        msg = msg ? (msg + ": ") : "";

        if (!err.response) {
            dispatch({
                type: actionType.ERROR,
                message: msg + "Connection error",
            });
            return;
        }

        const data = err.response.data || {};
        const errorText = data.message ? data.message : err.response.statusText;

        dispatch({
            type: actionType.ERROR,
            message: msg + errorText,
            url: data.url,
        });
    }
}

export function clearAlerts() {
    return function (dispatch, getState) {
        dispatch({
            type: actionType.CLEAR_ERRORS,
        });
    }
}
