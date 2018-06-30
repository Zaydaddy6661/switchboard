// -------------------------------------------
// The CLARIN Language Resource Switchboard
// 2016-18 Claus Zinn, University of Tuebingen
// 
// File: DropArea.jsx
// Time-stamp: <2018-06-29 20:23:23 (zinn)>
// -------------------------------------------

import React from 'react';
import Loader from 'react-loader';
import Dropzone from 'react-dropzone';
import ResourceActions from '../actions/ResourceActions';
import TextareaAutosize from 'react-autosize-textarea';
import AlertURLFetchError from './AlertURLFetchError.jsx';
import AlertURLUploadError from './AlertURLUploadError.jsx';
import AlertShibboleth from './AlertShibboleth.jsx';


import Resolver from '../back-end/Resolver';
import Profiler from '../back-end/Profiler';
import Uploader from '../back-end/Uploader';
import Downloader from '../back-end/Downloader';
import {fileExtensionChooser, processLanguage, unfoldHandle} from '../back-end/util';

export default class DropArea extends React.Component {
    constructor(props) {
	super(props);

	this.showFiles   = this.showFiles.bind(this);
	this.onDrop      = this.onDrop.bind(this);
	
	this.state = {
	    isLoaded: true,	    
	    files: [],
	    textInputValue: "",
	    url: '',
	    showAlertShibboleth: false,	    
	    showAlertURLFetchError: false,
	    showAlertURLUploadError: false
	};
	
	this.handlePaste    = this.handlePaste.bind(this);	
	this.handleChange   = this.handleChange.bind(this);
	this.handleKeyPress = this.handleKeyPress.bind(this);

	this.handleTextInputChange   = this.handleTextInputChange.bind(this);
	this.handleTextInputSubmit   = this.handleTextInputSubmit.bind(this);

	this.processParameters         = this.processParameters.bind(this);
    }

    componentDidMount() {

	// fetch all parameter from router
	const parameters = this.props.match.params;

	// get the caller, one of VLO, VCR, FCS, or B2DROP, or D4SCIENCE
	const caller = this.props.caller;

	// process parameters
	this.processParameters(caller, parameters);
    }

    processParameters( caller, parameters ) {

	console.log('DropArea/processParameters', caller, parameters);	

	// when called from the VLO, these _might_ be set
	const language = parameters.fileLanguage;
	const mimeType = decodeURIComponent(parameters.fileMimetype);
	
	if ( (caller == "VCR")    || (caller == "FCS") || (caller == "VLO") || 
	     (caller == "B2DROP") || (caller == "D4SCIENCE") ) {
	    // remove prior resources
	    ResourceActions.reset();

	    // retrieve URL, and take care of 'hdl:' to be expanded 'hdl.handle.net'
	    var fileURL = unfoldHandle( parameters.fileURL);
	    var handleFound = fileURL.indexOf('hdl.handle.net');
	    
	    this.downloadAndProcessSharedLink( "VLO", fileURL);
	}
    }
    
    handleChange(event) {
	//console.log('A change took place.', event.target.value);
	this.handlePaste(event);
	// event.preventDefault();
    }

    handleTextInputSubmit(event) {
	var textContent = this.state.textInputValue;
	var blob = new Blob([textContent], {type: "text/plain"});
	this.uploadAndProcessFile( {currentFile: blob, type: 'data'} );

	// remove prior resources
	ResourceActions.reset();

	// clear task-oriented view
	this.props.clearDropzoneFun(); 
	
	this.setState({
	    textInputValue : "",  // reset textarea
	    files: [blob]         // put blob into file to trigger Resources
	});	
	
	event.preventDefault();
    }
    
    handleTextInputChange(event) {
	this.setState({textInputValue: event.target.value});
    }

    handleKeyPress(event) {    
	console.log('handleKeyPress: A key has been pressed', event.target.value);
	return false;
	
	// Enumerate all supported clipboard, undo and redo keys
	var clipboardKeys = {
		winInsert : 45,
		winDelete : 46,
		SelectAll : 97,
		macCopy : 99,
		macPaste : 118,
		macCut : 120,
		redo : 121,	
		undo : 122
	}
	// Simulate readonly but allow all clipboard, undo and redo action keys
	var charCode = event.which;

	// Accept ctrl+v, ctrl+c, ctrl+z, ctrl+insert, shift+insert, shift+del and ctrl+a
	if (
		event.ctrlKey && charCode == clipboardKeys.redo ||		/* ctrl+y redo			*/
		event.ctrlKey && charCode == clipboardKeys.undo ||		/* ctrl+z undo			*/
		event.ctrlKey && charCode == clipboardKeys.macCut ||		/* ctrl+x mac cut		*/
		event.ctrlKey && charCode == clipboardKeys.macPaste ||		/* ctrl+v mac paste		*/
		event.ctrlKey && charCode == clipboardKeys.macCopy ||		/* ctrl+c mac copy		*/ 
		event.shiftKey && event.keyCode == clipboardKeys.winInsert ||	/* shift+ins windows paste	*/ 
		event.shiftKey && event.keyCode == clipboardKeys.winDelete ||	/* shift+del windows cut	*/ 
		event.ctrlKey && event.keyCode == clipboardKeys.winInsert  ||	/* ctrl+ins windows copy	*/ 
		event.ctrlKey && charCode == clipboardKeys.SelectAll		/* ctrl+a select all		*/
		){ return 0; }
	// Shun all remaining keys simulating readonly textbox
	var theEvent = event || window.event;
	var key = theEvent.keyCode || theEvent.which;
	key = String.fromCharCode(key);
	var regex = /[]|\./;
	if(!regex.test(key)) {
		theEvent.returnValue = false;
		theEvent.preventDefault();
	}
    }

    showFiles() {

        var files = this.state.files;
        if (files.length <= 0) {
            return '';
        }

	// don't duplicate file information (apart from the preview)
	return '';

        // return React.createElement(
        //     'div',
        //     null,
        //     React.createElement(
        //         'h2',
	// 	{ className: 'resource' },		
        //         'Dropped file(s): '
        //     ),
        //     React.createElement(
        //         'ul',
	// 	{ className: 'resource' },		
        //         [].map.call(files, function (f, i) {
        //             return React.createElement(
	// 		'li',
	// 		{
        //                     key: i 
	// 		},
	// 		React.createElement('img', {
        //                     src: f.preview,
        //                     width: 100 
	// 		}),
	// 		React.createElement(
	// 		    'div',
	// 		    null,
	// 		    f.name + ' : ' + f.size + ' bytes.'
	// 		)
        //             );
        //         })
        //     )
        // );
    }

    /* 
       Originally, the PASTE facility was advertised for Dropbox/B2DROP users (coming from known locations).
       Here, URL was rewritten and reverse-proxyied by nginx to tackle CORS-related issues.

       Now, users are allowed to paste arbitrary links. The switchboard uploads each file to its
       storage space, which is hosted on the same domain than the switchboard. Hence, all tools
       connected to the switchboard can download the resource from this location without running
       into CORS issues. 

       Note that the behaviour is extended to switchboard invocations from the VLO, VCR, FCS, B2DROP, D4SCIENCE.

     */
    downloadAndProcessSharedLink( caller, link ) {
	let downloader = new Downloader( link );
	let promiseDownload = downloader.downloadBlob();
	let that = this;
	this.setState( { isLoaded: false });
	promiseDownload.then(
	    function(resolve) {
		console.log('DropArea.jsx/downloadAndProcessSharedLink succeeded', resolve);
		let file = new File([resolve.body], resolve.req.url, {type: resolve.type});
		that.uploadAndProcessFile( {currentFile: file, type: 'file'} );		
		that.setState( { isLoaded: true });
	    },
	    function(reject) {
		console.log('DropArea.jsx/downloadAndProcessSharedLink failed', reject);
		that.setState({showAlertURLFetchError: true} );		
		that.setState( { isLoaded: true });
	    });
    }   

    uploadAndProcessFile( { currentFile, type = 'file' } = {} ) {

	this.setState( { isLoaded: false });
	let that = this;
	let uploader = new Uploader( {file: currentFile, type: type} );

	console.log('DropArea/uploadAndProcessFile', currentFile);
	let promiseUpload = uploader.uploadFile();
	
	promiseUpload.then(
	    function(resolve) {
		let profiler = new Profiler( currentFile, "dnd", uploader.remoteFilename );
		profiler.convertProcessFile();
		that.setState( { isLoaded: true });
	    },
	    function(reject) {
		console.log('DropArea.jsx/upload failed', reject);
		that.setState({showAlertURLUploadError: true} );				
		// alert('Error: unable to upload file');
		that.setState( { isLoaded: true });		
	    });
    }   
    
    onDrop(files) {

	// clear resources view
	if (files.length > 0) {
	    ResourceActions.reset();
	}	

	// clear task-oriented view
	this.props.clearDropzoneFun();
	
	// process the file(s)
	for (var i=0; i<files.length; i++) {
	    this.uploadAndProcessFile( {currentFile: files[i]} );	    
	}

	// set the state
	// CZ: check whether no longer needed
	this.setState({
	    files: files
	});
    }

    handlePaste(event) {

	var link = event.target.value;
	console.log('DropArea/handlePaste', link);
	if ( /^(http[s]?:\/\/){0,1}(www\.){0,1}[a-zA-Z0-9\.\-]+\.[a-zA-Z]{2,5}[\.]{0,1}/.test(link) ) {
	    //console.log('A paste took place.', link);

	    // clear resources view	    
	    ResourceActions.reset();

	    // clear task-oriented view
	    this.props.clearDropzoneFun();
	    
	    this.downloadAndProcessSharedLink( "PASTE", link );	    
	    this.setState({
		files: link
	    });
	    event.target.value = "";
	} else {
	    console.log('The paste is not a URL', link);
	}
	// return false; // event.preventDefault();
    }


    render() {

	const { isLoaded } = this.state;		
	const transferalInfoStyle = {
	    fontSize: '0.5em',
	    margin: 2,
	    padding: 2	    
	};
		
	const transferalInfo = `Resource transferal from ${this.props.caller}. Please check the information below, then press "Show Tools"`;
	
        var styleDropbox = {
            borderWidth: 2,
            borderColor: 'black',
            borderStyle: 'dashed',
            borderRadius: 4,
            margin: 10,
            padding: 10,
            width: 200,
	    height:100,
	    resize: 'none',
	    transition: 'all 0.5s',
	    display:'inline-block'
        };

        var activeStyleDropbox = {
            borderStyle: 'solid',
            backgroundColor: '#eee',
            borderRadius: 8
        };

	// when invoked via VLO/B2DROP/D4Science/etc, we don't show the 3 areas for dropping resources
	if ( this.props.caller == "standalone" ) {
	    return (
		<div>
		<Loader loaded={this.state.isLoaded} />
		<table>
		  <tbody>
		    <tr>
		      <td>
			<Dropzone onDrop={this.onDrop}
				  style={styleDropbox}
				  activeStyle={activeStyleDropbox} >
			  Drop your file, or click to select the file to upload.
			</Dropzone>
		      </td>
		      <td>
			<TextareaAutosize rows={5}
					  maxRows={5}
					  style={styleDropbox}
					  onChange={this.handleChange}
					  onKeyPress={this.handleKeyPress}
					  placeholder='Paste your shared link from Dropbox and B2DROP. Or paste a persistent identifier.' />
		      </td>
		      <td>
			<form onSubmit={this.handleTextInputSubmit}>
			  <TextareaAutosize rows={5}
					    maxRows={5}
					    style={styleDropbox}
					    value={this.state.textInputValue}
					    onChange={this.handleTextInputChange}
					    placeholder='Enter your text here. For large input, create a file and drop it in the left-most area.' />		    
			  <input type="submit" value="Submit Text"/>
			</form>
		      </td>
		    </tr>
		  </tbody>
  		</table>
	        {this.state.showAlertURLFetchError ?
		 <AlertURLFetchError />
		 : null }
	        {this.state.showAlertURLUploadError ?
		 <AlertURLUploadError />
		 : null }
		{this.showFiles()}
		</div>
	    )	    
	} else {
	    return (
	       <Loader loaded={isLoaded}>
		<h2>
		   <div style={transferalInfoStyle} >
		     {transferalInfo}
                   </div>
		</h2>
		{this.state.showAlertShibboleth ?
    		 <AlertShibboleth />
		 : null }

	        {this.state.showAlertURLFetchError ?
		 <AlertURLFetchError />
		 : null }

	        {this.state.showAlertURLUploadError ?
		 <AlertURLUploadError />
		 : null }	    
               </Loader>		    
	    )
	}
    }
}
