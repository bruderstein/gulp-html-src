var fs = require('fs'),
    path = require('path'),
    url = require('url'),
	File = require('vinyl'),
    cheerio = require('cheerio'),
    through = require('through2'),
    extend = require('extend'),
    q = require('q');

module.exports = function(options) {
	var defaults = {
		presets: 'script',
		includeHtmlInOutput: false,
		createReadStream : fs.createReadStream
	};

	var presets = {
		script : {
			selector: 'script:not([data-ignore=true], [data-remove=true])',
			getFileName: function(node) { return node.attr('src'); }
		},
		css : {
			selector: 'link[type="text/css"][rel=stylesheet]:not([data-ignore=true], [data-remove=true])',
			getFileName: function(node) { return node.attr('href'); }
		}
	}

	var selectedPresets = (options && options.presets && presets[options.presets]) ||
	                     presets[defaults.presets];

	
	options = extend({}, defaults, selectedPresets, options);
	
	var makeAbsoluteFileName = function makeAbsoluteFileName(file, fileName) {
		//return file.base + fileName; // path.join(file.base, fileName);
		return path.join(path.dirname(file.path), fileName);
	};

	var isRelative = function isRelative(path) {
		return (url.parse(path).protocol == null);
	}

	var streamToBuffer = function streamToBuffer(stream) {
		var buffers = [];
		var deferred = q.defer();
		var totalLength = 0;
		stream.on('readable', function() {
			data = stream.read();
			if (data !== null) {
				buffers.push(data);
				totalLength += data.length;
			}
		});

		stream.on('error', function(err) {
			deferred.reject(err);
		});

		stream.on('end', function() {
			deferred.resolve(Buffer.concat(buffers, totalLength));
		});

		return deferred.promise;
	}

	// Calls the callback for each matching in the contents, with an error object
	// and the filename.  callback(err, fileName).
	// fileName === null signals the end of the matches
	var transformFile = function transformFile(contents, callback) {
		var $ = cheerio.load(contents.toString());
		$(options.selector).each(function() {
			var element = $(this);
			var fileName = options.getFileName(element);
			callback(null, fileName);
		});

		callback(null, null);
	}


	var transform = function(file, enc, callback) {
		var stream = this;
		var bufferReadPromises = [];
		
		if (file.isNull()) {
			// No contents - do nothing
			stream.push(file);
			callback();
		}

		if (file.isStream()) {
			streamToBuffer(file.contents)
				.then(function(contents) {

					transformFile(contents, function(err, fileName) {

						if (fileName) { 
							if (isRelative(fileName)) {
								var absoluteFileName = makeAbsoluteFileName(file, fileName);
								stream.push(new File({
									cwd: file.cwd,
									base: file.base,
									path: absoluteFileName,
									contents: options.createReadStream(absoluteFileName)
								}));
							}
						} else {
							if (options.includeHtmlInOutput) {
								stream.push(file);	
							}
							callback();		
						}
						
					});

				}, function(err) {
					stream.emit('error', err);
				});
		}

		if (file.isBuffer()) {
			transformFile(file.contents, function(err, fileName) {
				var createdStream;
				if (fileName) {

					if (isRelative(fileName)) {
						try	{
							var absoluteFileName = makeAbsoluteFileName(file, fileName);
							var readPromise = streamToBuffer(options.createReadStream(absoluteFileName))
							.then(function(contents) {
								stream.push(new File({
									cwd: file.cwd,
									base: file.base,
									path: absoluteFileName,
									contents: contents
								}));
							}, function(err) {
								stream.emit('error', err);
							});
							bufferReadPromises.push(readPromise);
						} 
						catch(err) {
							stream.emit('error', err);
						}
					}
					
				} else {
					q.all(bufferReadPromises)
					 .then(function() {
						// end of contents, no further matches for this file
						if (options.includeHtmlInOutput) {
							stream.push(file);
						}
						callback();		
					});
				}
			});
		}
	};
	
	return through.obj(transform);
}
